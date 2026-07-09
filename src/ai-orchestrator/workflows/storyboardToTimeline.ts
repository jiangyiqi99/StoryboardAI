import { randomUUID } from "node:crypto";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import {
  extname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve
} from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AiGenerateStoryboardRequest,
  AiStoryboardProgressEvent,
  AiStoryboardSegmentInput
} from "@shared/ipc/contracts";
import type {
  ApiRouter as AiApiRouter,
  GenerateVideoRequest,
  GenerateVideoResponse,
  GenerationJobStatus
} from "@shared/ai-routing";
import {
  createStoryboardAssociation,
  createStoryboardAssociationMetadata,
  createStoryboardAssociationTags
} from "@shared/storyboardAssociation";
import type { Asset } from "@shared/types/asset";
import type { AiGenerationJob, AiGenerationStatus } from "@shared/types/ai";
import type { MediaEngineFacade } from "@shared/types/media-engine";
import type { Project } from "@shared/types/project";
import type { StoryboardSegment } from "@shared/types/storyboard";
import type { Clip, Timeline, Track } from "@shared/types/timeline";
import type { LocalProjectFileService } from "@project-system/projectFile";
import {
  fromProjectRelativePath,
  getProjectDirectoryPath,
  toProjectRelativePath
} from "@project-system/projectPaths";

export interface StoryboardWorkflowServices {
  projectFiles: LocalProjectFileService;
  mediaEngine: MediaEngineFacade;
  apiRouter: AiApiRouter;
}

export interface StoryboardWorkflowRunOptions {
  onProgress?(event: AiStoryboardProgressEvent): void;
}

interface PlannedSegment {
  input: AiStoryboardSegmentInput;
  index: number;
  timelineStart: number;
  timelineEnd: number;
}

interface BoundaryFrame {
  assetId: string;
  framePath: string;
}

interface GeneratedOutputFile {
  projectRelativePath: string;
  thumbnailProjectRelativePath?: string;
  metadata: Asset["metadata"];
}

const STORYBOARD_METADATA_KEY = "storyboardAi";
const GENERATION_POLL_INTERVAL_MS = 5000;
const GENERATION_POLL_TIMEOUT_MS = 10 * 60 * 1000;

export class StoryboardToTimelineWorkflow {
  constructor(private readonly services: StoryboardWorkflowServices) {}

  async run(
    request: AiGenerateStoryboardRequest,
    options: StoryboardWorkflowRunOptions = {}
  ): Promise<AiGenerationJob[]> {
    try {
      this.emitProgress(options, request, {
        stage: "workflow-start",
        message: "开始生成分镜视频",
        providerId: request.providerId,
        modelId: request.modelId
      });

      const snapshot = await this.services.projectFiles.openProject({
        projectRootPath: request.projectRootPath
      });
      this.emitProgress(options, request, {
        stage: "project-opened",
        message: "已读取项目文件"
      });

      const project = snapshot.project;
      const segments = resolveStoryboardInputs(request);
      if (segments.length === 0) {
        this.emitProgress(options, request, {
          stage: "workflow-complete",
          message: "没有可生成的分镜片段",
          segmentCount: 0
        });
        return [];
      }

      const targetSegmentIds = resolveTargetSegmentIds(request, segments);
      const plannedSegments = planSegments(segments);
      this.emitProgress(options, request, {
        stage: "segments-planned",
        message: request.replaceSegmentId
          ? `已规划 ${plannedSegments.length} 个分镜，将替换 1 个片段`
          : `已规划 ${plannedSegments.length} 个分镜片段`,
        segmentCount: plannedSegments.length,
        details: {
          targetSegmentIds: Array.from(targetSegmentIds),
          timelineRanges: plannedSegments.map((segment) => ({
            segmentId: segment.input.id,
            start: segment.timelineStart,
            end: segment.timelineEnd
          }))
        }
      });

      const now = new Date().toISOString();
      const jobs: AiGenerationJob[] = [];
      let stoppedOnFailure = false;
      const nextProject: Project = {
        ...project,
        storyboardSegments: mergeStoryboardSegments(
          project.storyboardSegments,
          plannedSegments,
          targetSegmentIds
        ),
        timeline: removeGeneratedStoryboardClips(project.timeline, targetSegmentIds),
        updatedAt: now
      };

      for (const plannedSegment of plannedSegments) {
        if (!targetSegmentIds.has(plannedSegment.input.id)) {
          continue;
        }

        this.emitSegmentProgress(options, request, plannedSegment, plannedSegments.length, {
          stage: "segment-start",
          message: `开始生成第 ${plannedSegment.index + 1}/${plannedSegments.length} 个片段`,
          providerId: request.providerId,
          modelId: request.modelId
        });

        const previousSegment = plannedSegments[plannedSegment.index - 1];
        const nextSegment = plannedSegments[plannedSegment.index + 1];
        this.emitSegmentProgress(options, request, plannedSegment, plannedSegments.length, {
          stage: "boundary-resolving",
          message: "正在解析首尾参考帧"
        });
        const previousBoundary = previousSegment
          ? await this.resolveBoundaryFrame(
              nextProject,
              request.projectRootPath,
              previousSegment.input.id,
              "last"
            )
          : undefined;
        const nextBoundary =
          request.replaceSegmentId && nextSegment
            ? await this.resolveBoundaryFrame(
                nextProject,
                request.projectRootPath,
                nextSegment.input.id,
                "first"
            )
          : undefined;
        if (
          previousSegment &&
          hasStoryboardOutput(nextProject, previousSegment.input.id) &&
          !previousBoundary
        ) {
          const failedJob = createLocalFailedGenerationJob({
            request,
            plannedSegment,
            message:
              "上一段视频已存在，但无法抽取尾帧作为当前段首帧，已停止生成以避免画面不连续。",
            now
          });
          jobs.push(failedJob);
          nextProject.aiGenerationJobs = upsertById(
            nextProject.aiGenerationJobs,
            failedJob
          );
          nextProject.storyboardSegments = updateSegmentAfterFailedGeneration(
            nextProject.storyboardSegments,
            plannedSegment,
            failedJob
          );
          stoppedOnFailure = true;
          this.emitSegmentProgress(options, request, plannedSegment, plannedSegments.length, {
            stage: "error",
            message: failedJob.errorMessage ?? "无法解析上一段尾帧",
            providerId: request.providerId,
            modelId: request.modelId,
            jobId: failedJob.id,
            status: failedJob.status,
            details: {
              previousSegmentId: previousSegment.input.id
            }
          });
          break;
        }
        this.emitSegmentProgress(options, request, plannedSegment, plannedSegments.length, {
          stage: "boundary-ready",
          message: "参考帧解析完成",
          details: {
            previousBoundaryAssetId: previousBoundary?.assetId,
            previousBoundaryFramePath: previousBoundary?.framePath,
            nextBoundaryAssetId: nextBoundary?.assetId,
            nextBoundaryFramePath: nextBoundary?.framePath
          }
        });
        const generationRequest = buildGenerateVideoRequest({
          project: nextProject,
          projectRootPath: request.projectRootPath,
          request,
          plannedSegment,
          plannedSegments,
          previousBoundary,
          nextBoundary
        });
        this.emitSegmentProgress(options, request, plannedSegment, plannedSegments.length, {
          stage: "task-creating",
          message: "正在创建生成任务",
          providerId: generationRequest.providerId,
          modelId: generationRequest.modelId,
          details: {
            requestId: generationRequest.requestId,
            mode: generationRequest.mode,
            durationSec: generationRequest.durationSec,
            aspectRatio: generationRequest.aspectRatio,
            width: generationRequest.width,
            height: generationRequest.height,
            fps: generationRequest.fps
          }
        });
        const submittedResponse =
          await this.services.apiRouter.generateVideo(generationRequest);
        this.emitSegmentProgress(options, request, plannedSegment, plannedSegments.length, {
          stage: "task-created",
          message: "任务创建完成",
          providerId: submittedResponse.providerId,
          modelId: submittedResponse.modelId,
          jobId: submittedResponse.jobId,
          providerJobId: submittedResponse.providerJobId,
          status: submittedResponse.status,
          outputUri: submittedResponse.outputUri,
          progress: submittedResponse.progress,
          details: {
            route: submittedResponse.route,
            error: submittedResponse.error
          }
        });
        this.emitSegmentProgress(options, request, plannedSegment, plannedSegments.length, {
          stage: "waiting-output",
          message: "等待生成结果输出",
          providerId: submittedResponse.providerId,
          modelId: submittedResponse.modelId,
          jobId: submittedResponse.jobId,
          providerJobId: submittedResponse.providerJobId,
          status: submittedResponse.status
        });
        const response = await this.waitForGenerationOutput(
          submittedResponse,
          request,
          plannedSegment,
          plannedSegments.length,
          options
        );
        this.emitSegmentProgress(options, request, plannedSegment, plannedSegments.length, {
          stage: response.outputUri ? "output-ready" : "error",
          message: response.outputUri
            ? "生成输出已返回"
            : `生成结束但没有返回可保存的视频输出，状态：${response.status}`,
          providerId: response.providerId,
          modelId: response.modelId,
          jobId: response.jobId,
          providerJobId: response.providerJobId,
          status: response.status,
          outputUri: response.outputUri,
          progress: response.progress,
          details: {
            error: response.error,
            rawProviderResponse: response.rawProviderResponse
          }
        });
        const job = createGenerationJob(response, generationRequest, plannedSegment, request, now);
        this.emitSegmentProgress(options, request, plannedSegment, plannedSegments.length, {
          stage: "saving-output",
          message: response.outputUri && isRemoteHttpUri(response.outputUri)
            ? "等待下载生成视频"
            : "正在保存生成视频到项目素材",
          providerId: response.providerId,
          modelId: response.modelId,
          jobId: response.jobId,
          providerJobId: response.providerJobId,
          status: response.status,
          outputUri: response.outputUri
        });
        const generatedOutput = await this.resolveGeneratedOutputFile(
          response,
          request.projectRootPath,
          plannedSegment
        );
        const finalJob: AiGenerationJob = generatedOutput
          ? job
          : {
              ...job,
              status: "failed",
              outputAssetId: undefined,
              errorMessage:
                response.error?.message ??
                "Provider returned an output URL, but StoryboardAI could not download or save it as a local project asset."
            };
        this.emitSegmentProgress(options, request, plannedSegment, plannedSegments.length, {
          stage: generatedOutput ? "download-complete" : "error",
          message: generatedOutput
            ? "下载完成，已写入项目素材"
            : "没有生成可用的本地视频文件",
          providerId: response.providerId,
          modelId: response.modelId,
          jobId: response.jobId,
          providerJobId: response.providerJobId,
          status: response.status,
          outputUri: response.outputUri,
          outputPath: generatedOutput?.projectRelativePath,
          details: {
            thumbnailProjectRelativePath: generatedOutput?.thumbnailProjectRelativePath,
            metadata: generatedOutput?.metadata,
            localOutputPath: outputUriToLocalPath(response.outputUri),
            isRemoteHttpOutput: response.outputUri
              ? isRemoteHttpUri(response.outputUri)
              : false
          }
        });

        jobs.push(finalJob);
        nextProject.aiGenerationJobs = upsertById(
          nextProject.aiGenerationJobs,
          finalJob
        );

        if (!generatedOutput) {
          stoppedOnFailure = true;
          nextProject.storyboardSegments = updateSegmentAfterFailedGeneration(
            nextProject.storyboardSegments,
            plannedSegment,
            finalJob
          );
          this.emitSegmentProgress(options, request, plannedSegment, plannedSegments.length, {
            stage: "segment-complete",
            message: `第 ${plannedSegment.index + 1}/${plannedSegments.length} 个片段处理完成（未生成可用素材）`,
            providerId: response.providerId,
            modelId: response.modelId,
            jobId: response.jobId,
            providerJobId: response.providerJobId,
            status: finalJob.status,
            outputUri: response.outputUri
          });
          break;
        }

        const asset = createGeneratedAsset(
          finalJob,
          plannedSegment,
          project,
          response,
          now,
          generatedOutput
        );
        const clip = createGeneratedClip(asset, plannedSegment);

        nextProject.assets = upsertById(nextProject.assets, asset);
        nextProject.storyboardSegments = updateSegmentAfterGeneration(
          nextProject.storyboardSegments,
          plannedSegment,
          finalJob,
          asset
        );
        nextProject.timeline = insertGeneratedClip(nextProject.timeline, clip);
        if (finalJob.status === "failed" || finalJob.status === "cancelled") {
          stoppedOnFailure = true;
        }
        this.emitSegmentProgress(options, request, plannedSegment, plannedSegments.length, {
          stage: "segment-complete",
          message: `第 ${plannedSegment.index + 1}/${plannedSegments.length} 个片段处理完成`,
          providerId: response.providerId,
          modelId: response.modelId,
          jobId: response.jobId,
          providerJobId: response.providerJobId,
          status: finalJob.status,
          outputUri: response.outputUri,
          outputPath: generatedOutput?.projectRelativePath
        });

        if (stoppedOnFailure) {
          break;
        }
      }

      nextProject.timeline = {
        ...nextProject.timeline,
        duration: roundTimelineTime(
          nextProject.timeline.tracks.reduce(
            (maxEnd, track) =>
              Math.max(
                maxEnd,
                ...track.clips.map((clip) => clip.timelineEnd)
              ),
            0
          )
        )
      };

      this.emitProgress(options, request, {
        stage: "project-saving",
        message: "正在保存项目文件",
        segmentCount: plannedSegments.length
      });
      await this.services.projectFiles.saveProject({
        projectRootPath: request.projectRootPath,
        project: nextProject
      });
      this.emitProgress(options, request, {
        stage: "project-saved",
        message: "项目文件已保存",
        segmentCount: plannedSegments.length
      });
      this.emitProgress(options, request, {
        stage: "workflow-complete",
        message: stoppedOnFailure
          ? `分镜生成已因失败停止，共处理 ${jobs.length} 个任务`
          : `分镜生成流程完成，共处理 ${jobs.length} 个任务`,
        segmentCount: plannedSegments.length,
        details: {
          jobIds: jobs.map((job) => job.id),
          stoppedOnFailure
        }
      });

      return jobs;
    } catch (error) {
      this.emitProgress(options, request, {
        stage: "error",
        message: error instanceof Error ? error.message : String(error),
        providerId: request.providerId,
        modelId: request.modelId,
        details: {
          stack: error instanceof Error ? error.stack : undefined
        }
      });
      throw error;
    }
  }

  private async resolveBoundaryFrame(
    project: Project,
    projectRootPath: string,
    segmentId: string,
    edge: "first" | "last"
  ): Promise<BoundaryFrame | undefined> {
    const segment = project.storyboardSegments.find((candidate) => candidate.id === segmentId);
    if (!segment?.outputAssetId) {
      return undefined;
    }

    const asset = project.assets.find((candidate) => candidate.id === segment.outputAssetId);
    if (!asset) {
      return undefined;
    }

    const sourcePath = resolveProjectAssetPath(projectRootPath, asset);
    if (!sourcePath) {
      return undefined;
    }

      const association = createStoryboardAssociation(segment.id, segment.index);
      const outputPath = join(
        getProjectDirectoryPath(projectRootPath, "frames"),
        `${segment.storyboardRef ?? association.storyboardRef}-${edge}.png`
      );
    const time =
      edge === "first"
        ? 0
        : resolveLastFrameTime(
            asset.metadata.duration ?? segment.targetDuration,
            project.settings.fps
          );

    try {
      const framePath = await this.services.mediaEngine.frame.extractFrame({
        absolutePath: sourcePath,
        time,
        outputPath
      });

      return {
        assetId: asset.id,
        framePath
      };
    } catch {
      return undefined;
    }
  }

  private async waitForGenerationOutput(
    response: GenerateVideoResponse,
    workflowRequest: AiGenerateStoryboardRequest,
    plannedSegment: PlannedSegment,
    segmentCount: number,
    options: StoryboardWorkflowRunOptions
  ): Promise<GenerateVideoResponse> {
    if (!shouldPollGeneration(response)) {
      return response;
    }

    const deadline = Date.now() + GENERATION_POLL_TIMEOUT_MS;
    let latestResponse = response;

    while (Date.now() < deadline) {
      await delay(GENERATION_POLL_INTERVAL_MS);
      const polledResponse = await this.services.apiRouter.getJobStatus({
        jobId: response.jobId,
        providerId: response.providerId,
        providerJobId: response.providerJobId
      });
      latestResponse = mergePolledGenerationResponse(response, polledResponse);
      this.emitSegmentProgress(options, workflowRequest, plannedSegment, segmentCount, {
        stage: "polling",
        message: "已轮询生成任务状态",
        providerId: latestResponse.providerId,
        modelId: latestResponse.modelId,
        jobId: latestResponse.jobId,
        providerJobId: latestResponse.providerJobId,
        status: latestResponse.status,
        outputUri: latestResponse.outputUri,
        progress: latestResponse.progress,
        details: {
          error: latestResponse.error,
          rawProviderResponse: latestResponse.rawProviderResponse
        }
      });

      if (!shouldPollGeneration(latestResponse)) {
        return latestResponse;
      }
    }

    this.emitSegmentProgress(options, workflowRequest, plannedSegment, segmentCount, {
      stage: "error",
      message: "等待生成输出超时",
      providerId: latestResponse.providerId,
      modelId: latestResponse.modelId,
      jobId: latestResponse.jobId,
      providerJobId: latestResponse.providerJobId,
      status: latestResponse.status,
      outputUri: latestResponse.outputUri,
      progress: latestResponse.progress
    });
    return latestResponse;
  }

  private async resolveGeneratedOutputFile(
    response: GenerateVideoResponse,
    projectRootPath: string,
    plannedSegment: PlannedSegment
  ): Promise<GeneratedOutputFile | undefined> {
    if (!response.outputUri) {
      return undefined;
    }

    const assetsDirectory = getProjectDirectoryPath(projectRootPath, "assets");
    await mkdir(assetsDirectory, { recursive: true });
    const outputPath = outputUriToLocalPath(response.outputUri);
    const projectOutputPath = outputPath
      ? isPathInsideDirectory(assetsDirectory, outputPath)
        ? outputPath
        : await copyGeneratedOutputIntoProject(
            assetsDirectory,
            outputPath,
            plannedSegment
          )
      : isRemoteHttpUri(response.outputUri)
        ? await downloadGeneratedOutputIntoProject(
            assetsDirectory,
            response.outputUri,
            plannedSegment
          )
        : undefined;

    if (!projectOutputPath) {
      return undefined;
    }

    const metadata = await this.services.mediaEngine.frame.probe({
      absolutePath: projectOutputPath
    });
    const thumbnailTime = Math.min(0.25, Math.max(0, (metadata.duration ?? 1) / 20));
    const thumbnailOutputPath = join(
      getProjectDirectoryPath(projectRootPath, "thumbnails"),
      `${parse(projectOutputPath).name}.jpg`
    );
    let thumbnailProjectRelativePath: string | undefined;

    try {
      const thumbnailPath = await this.services.mediaEngine.frame.createThumbnail({
        absolutePath: projectOutputPath,
        time: thumbnailTime,
        outputPath: thumbnailOutputPath,
        maxWidth: 480
      });
      thumbnailProjectRelativePath = toProjectRelativePath(
        projectRootPath,
        thumbnailPath
      );
    } catch {
      thumbnailProjectRelativePath = undefined;
    }

    return {
      projectRelativePath: toProjectRelativePath(projectRootPath, projectOutputPath),
      thumbnailProjectRelativePath,
      metadata
    };
  }

  private emitSegmentProgress(
    options: StoryboardWorkflowRunOptions,
    request: AiGenerateStoryboardRequest,
    plannedSegment: PlannedSegment,
    segmentCount: number,
    event: Omit<
      AiStoryboardProgressEvent,
      "runId" | "projectRootPath" | "timestamp" | "segmentId" | "segmentIndex" | "segmentCount"
    >
  ): void {
    this.emitProgress(options, request, {
      ...event,
      segmentId: plannedSegment.input.id,
      segmentIndex: plannedSegment.index,
      segmentCount
    });
  }

  private emitProgress(
    options: StoryboardWorkflowRunOptions,
    request: AiGenerateStoryboardRequest,
    event: Omit<
      AiStoryboardProgressEvent,
      "runId" | "projectRootPath" | "timestamp"
    >
  ): void {
    options.onProgress?.({
      ...event,
      runId: "pending",
      projectRootPath: request.projectRootPath,
      timestamp: new Date().toISOString()
    });
  }
}

function shouldPollGeneration(response: GenerateVideoResponse): boolean {
  return (
    response.providerId !== "mock" &&
    Boolean(response.providerJobId) &&
    !response.outputUri &&
    !isTerminalGenerationStatus(response.status)
  );
}

function isTerminalGenerationStatus(status: GenerationJobStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function mergePolledGenerationResponse(
  submittedResponse: GenerateVideoResponse,
  polledResponse: GenerateVideoResponse
): GenerateVideoResponse {
  return {
    ...submittedResponse,
    ...polledResponse,
    requestId: submittedResponse.requestId,
    modelId: polledResponse.modelId ?? submittedResponse.modelId,
    mode: submittedResponse.mode,
    route: submittedResponse.route,
    rawProviderResponse:
      polledResponse.rawProviderResponse ?? submittedResponse.rawProviderResponse
  };
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, durationMs);
  });
}

function buildGenerateVideoRequest({
  project,
  projectRootPath,
  request,
  plannedSegment,
  plannedSegments,
  previousBoundary,
  nextBoundary
}: {
  project: Project;
  projectRootPath: string;
  request: AiGenerateStoryboardRequest;
  plannedSegment: PlannedSegment;
  plannedSegments: PlannedSegment[];
  previousBoundary?: BoundaryFrame;
  nextBoundary?: BoundaryFrame;
}): GenerateVideoRequest {
  const previousSegment = plannedSegments[plannedSegment.index - 1];
  const nextSegment = plannedSegments[plannedSegment.index + 1];
  const association = createStoryboardAssociation(
    plannedSegment.input.id,
    plannedSegment.index
  );
  const mode = selectGenerationMode({
    isReplacement: Boolean(request.replaceSegmentId),
    previousBoundary,
    nextBoundary
  });

  return {
    requestId: `${association.storyboardRef}-${randomUUID()}`,
    projectId: project.id,
    projectRootPath,
    providerId: request.providerId,
    modelId: request.modelId,
    mode,
    prompt: plannedSegment.input.text,
    durationSec: plannedSegment.input.durationSec,
    width: project.settings.width,
    height: project.settings.height,
    fps: project.settings.fps,
    aspectRatio: request.aspectRatio,
    firstFrameAssetId: previousBoundary?.assetId,
    firstFramePath: previousBoundary?.framePath,
    lastFrameAssetId: nextBoundary?.assetId,
    lastFramePath: nextBoundary?.framePath,
    metadata: {
      workflow: "storyboard-to-video",
      ...createStoryboardAssociationMetadata(association),
      storyText: plannedSegment.input.text,
      timelineStart: plannedSegment.timelineStart,
      timelineEnd: plannedSegment.timelineEnd,
      continuity:
        request.replaceSegmentId && previousBoundary && nextBoundary
          ? "replace-with-first-last-frame"
          : request.replaceSegmentId
            ? "replace-with-available-boundary-frame"
            : previousBoundary
            ? "continue-from-previous-tail-frame"
            : "start-from-text",
      previousSegmentId: previousSegment?.input.id,
      nextSegmentId: nextSegment?.input.id,
      hasPreviousTailFrame: Boolean(previousBoundary),
      hasNextHeadFrame: Boolean(nextBoundary)
    }
  };
}

function selectGenerationMode({
  isReplacement,
  previousBoundary,
  nextBoundary
}: {
  isReplacement: boolean;
  previousBoundary?: BoundaryFrame;
  nextBoundary?: BoundaryFrame;
}): GenerateVideoRequest["mode"] {
  if (isReplacement && previousBoundary && nextBoundary) {
    return "first-last-frame-to-video";
  }

  if (previousBoundary) {
    return "first-frame-to-video";
  }

  return "text-to-video";
}

function resolveStoryboardInputs(
  request: AiGenerateStoryboardRequest
): AiStoryboardSegmentInput[] {
  const explicitSegments = request.segments
    ?.map((segment) => ({
      id: segment.id,
      text: segment.text.trim(),
      durationSec: normalizeDuration(segment.durationSec, request.defaultDuration)
    }))
    .filter((segment) => segment.text.length > 0);

  if (explicitSegments?.length) {
    return explicitSegments;
  }

  return request.script
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({
      id: `story-${randomUUID()}`,
      text,
      durationSec: normalizeDuration(request.defaultDuration, 5)
    }));
}

function resolveTargetSegmentIds(
  request: AiGenerateStoryboardRequest,
  segments: AiStoryboardSegmentInput[]
): Set<string> {
  if (request.replaceSegmentId) {
    return new Set([request.replaceSegmentId]);
  }

  const requestedIds = request.targetSegmentIds?.filter(Boolean);
  if (requestedIds?.length) {
    const validSegmentIds = new Set(segments.map((segment) => segment.id));
    return new Set(requestedIds.filter((segmentId) => validSegmentIds.has(segmentId)));
  }

  return new Set(segments.map((segment) => segment.id));
}

function planSegments(segments: AiStoryboardSegmentInput[]): PlannedSegment[] {
  let cursor = 0;

  return segments.map((segment, index) => {
    const timelineStart = roundTimelineTime(cursor);
    cursor += segment.durationSec;
    return {
      input: segment,
      index,
      timelineStart,
      timelineEnd: roundTimelineTime(cursor)
    };
  });
}

function mergeStoryboardSegments(
  currentSegments: StoryboardSegment[],
  plannedSegments: PlannedSegment[],
  targetSegmentIds: Set<string>
): StoryboardSegment[] {
  const currentById = new Map(currentSegments.map((segment) => [segment.id, segment]));

  return plannedSegments.map((plannedSegment) => {
    const current = currentById.get(plannedSegment.input.id);
    const shouldGenerate = targetSegmentIds.has(plannedSegment.input.id);
    const association = createStoryboardAssociation(
      plannedSegment.input.id,
      plannedSegment.index
    );

    return {
      ...current,
      id: plannedSegment.input.id,
      index: plannedSegment.index,
      storyboardRef: association.storyboardRef,
      storyboardNumber: association.segmentNumber,
      text: plannedSegment.input.text,
      targetDuration: plannedSegment.input.durationSec,
      status: shouldGenerate ? "generating" : current?.status ?? "draft",
      timelineStart: plannedSegment.timelineStart,
      timelineEnd: plannedSegment.timelineEnd
    };
  });
}

function createGenerationJob(
  response: GenerateVideoResponse,
  request: GenerateVideoRequest,
  plannedSegment: PlannedSegment,
  workflowRequest: AiGenerateStoryboardRequest,
  now: string
): AiGenerationJob {
  const association = createStoryboardAssociation(
    plannedSegment.input.id,
    plannedSegment.index
  );

  return {
    id: `${association.jobIdPrefix}-${randomUUID()}`,
    storyboardRef: association.storyboardRef,
    storyboardSegmentId: association.segmentId,
    storyboardSegmentIndex: association.segmentIndex,
    storyboardSegmentNumber: association.segmentNumber,
    workflow: "storyboard-to-video",
    mode:
      request.mode === "first-last-frame-to-video"
        ? "first-last-frame"
        : request.mode === "first-frame-to-video"
          ? "first-frame"
          : "text-to-video",
    status: mapRoutingStatus(response.status),
    providerId: response.providerId,
    modelId: response.modelId ?? workflowRequest.modelId,
    prompt: plannedSegment.input.text,
    duration: plannedSegment.input.durationSec,
    inputAssetIds: [
      request.firstFrameAssetId,
      request.lastFrameAssetId
    ].filter((assetId): assetId is string => Boolean(assetId)),
    inputFramePaths: [
      request.firstFramePath,
      request.lastFramePath
    ].filter((path): path is string => Boolean(path)),
    outputAssetId: association.assetId,
    providerJobId: response.providerJobId,
    createdAt: now,
    updatedAt: now,
    errorMessage: response.error?.message,
    metadata: {
      ...request.metadata,
      ...createStoryboardAssociationMetadata(association),
      routedJobId: response.jobId,
      routedMode: response.mode,
      route: response.route,
      rawProviderResponse: response.rawProviderResponse,
      outputUri: response.outputUri
    }
  };
}

function createLocalFailedGenerationJob({
  request,
  plannedSegment,
  message,
  now
}: {
  request: AiGenerateStoryboardRequest;
  plannedSegment: PlannedSegment;
  message: string;
  now: string;
}): AiGenerationJob {
  const association = createStoryboardAssociation(
    plannedSegment.input.id,
    plannedSegment.index
  );

  return {
    id: `${association.jobIdPrefix}-failed-${randomUUID()}`,
    storyboardRef: association.storyboardRef,
    storyboardSegmentId: association.segmentId,
    storyboardSegmentIndex: association.segmentIndex,
    storyboardSegmentNumber: association.segmentNumber,
    workflow: "storyboard-to-video",
    mode: "text-to-video",
    status: "failed",
    providerId: request.providerId,
    modelId: request.modelId,
    prompt: plannedSegment.input.text,
    duration: plannedSegment.input.durationSec,
    inputAssetIds: [],
    outputAssetId: undefined,
    createdAt: now,
    updatedAt: now,
    errorMessage: message,
    metadata: {
      workflow: "storyboard-to-video",
      ...createStoryboardAssociationMetadata(association)
    }
  };
}

function createGeneratedAsset(
  job: AiGenerationJob,
  plannedSegment: PlannedSegment,
  project: Project,
  response: GenerateVideoResponse,
  now: string,
  generatedOutput?: GeneratedOutputFile
): Asset {
  const outputMetadata = generatedOutput?.metadata;
  const association = createStoryboardAssociation(
    plannedSegment.input.id,
    plannedSegment.index
  );

  return {
    id: job.outputAssetId ?? association.assetId,
    storyboardRef: association.storyboardRef,
    storyboardSegmentId: association.segmentId,
    storyboardSegmentIndex: association.segmentIndex,
    storyboardSegmentNumber: association.segmentNumber,
    kind: "generated-video",
    origin: "generated",
    name: `分镜 ${plannedSegment.index + 1} - ${truncateName(plannedSegment.input.text)}`,
    projectRelativePath: generatedOutput?.projectRelativePath,
    metadata: {
      ...outputMetadata,
      duration: outputMetadata?.duration ?? plannedSegment.input.durationSec,
      width: outputMetadata?.width ?? project.settings.width,
      height: outputMetadata?.height ?? project.settings.height,
      fps: outputMetadata?.fps ?? project.settings.fps,
      hasAudio: outputMetadata?.hasAudio ?? false,
      probe: {
        ...(outputMetadata?.probe ?? {}),
        [STORYBOARD_METADATA_KEY]: {
          ...createStoryboardAssociationMetadata(association),
          segmentId: plannedSegment.input.id,
          segmentIndex: plannedSegment.index,
          segmentNumber: association.segmentNumber,
          text: plannedSegment.input.text,
          jobId: job.id,
          providerId: job.providerId,
          modelId: job.modelId,
          status: job.status,
          outputUri: response.outputUri
        }
      }
    },
    thumbnailPath: generatedOutput?.thumbnailProjectRelativePath,
    generatedByJobId: job.id,
    importedAt: now,
    tags: [
      "ai-generated",
      "storyboard",
      ...createStoryboardAssociationTags(association)
    ]
  };
}

function createGeneratedClip(asset: Asset, plannedSegment: PlannedSegment): Clip {
  const association = createStoryboardAssociation(
    plannedSegment.input.id,
    plannedSegment.index
  );

  return {
    id: association.clipId,
    assetId: asset.id,
    trackId: "video-1",
    name: asset.name,
    sourceIn: 0,
    sourceOut: plannedSegment.input.durationSec,
    timelineStart: plannedSegment.timelineStart,
    timelineEnd: plannedSegment.timelineEnd,
    speed: 1,
    metadata: {
      source: "storyboard-to-video",
      ...createStoryboardAssociationMetadata(association),
      storyText: plannedSegment.input.text
    }
  };
}

function updateSegmentAfterGeneration(
  segments: StoryboardSegment[],
  plannedSegment: PlannedSegment,
  job: AiGenerationJob,
  asset: Asset
): StoryboardSegment[] {
  const association = createStoryboardAssociation(
    plannedSegment.input.id,
    plannedSegment.index
  );

  return segments.map((segment) =>
    segment.id === plannedSegment.input.id
      ? {
          ...segment,
          storyboardRef: association.storyboardRef,
          storyboardNumber: association.segmentNumber,
          status: mapJobStatusToSegmentStatus(job.status),
          outputAssetId: asset.id,
          aiJobId: job.id,
          inputFirstFrameAssetId: job.inputAssetIds[0],
          inputLastFrameAssetId: job.inputAssetIds[1],
          timelineStart: plannedSegment.timelineStart,
          timelineEnd: plannedSegment.timelineEnd
        }
      : segment
  );
}

function updateSegmentAfterFailedGeneration(
  segments: StoryboardSegment[],
  plannedSegment: PlannedSegment,
  job: AiGenerationJob
): StoryboardSegment[] {
  const association = createStoryboardAssociation(
    plannedSegment.input.id,
    plannedSegment.index
  );

  return segments.map((segment) =>
    segment.id === plannedSegment.input.id
      ? {
          ...segment,
          storyboardRef: association.storyboardRef,
          storyboardNumber: association.segmentNumber,
          status: "failed",
          outputAssetId: undefined,
          aiJobId: job.id,
          timelineStart: plannedSegment.timelineStart,
          timelineEnd: plannedSegment.timelineEnd
        }
      : segment
  );
}

function removeGeneratedStoryboardClips(
  timeline: Timeline,
  targetSegmentIds: Set<string>
): Timeline {
  return {
    ...timeline,
    tracks: ensureVideoTrack(timeline.tracks).map((track) => ({
      ...track,
      clips: track.clips.filter((clip) => {
        const storySegmentId = clip.metadata?.storySegmentId;
        return !(
          typeof storySegmentId === "string" &&
          targetSegmentIds.has(storySegmentId)
        );
      })
    }))
  };
}

function insertGeneratedClip(timeline: Timeline, clip: Clip): Timeline {
  const tracks = ensureVideoTrack(timeline.tracks).map((track) => {
    if (track.id !== "video-1") {
      return track;
    }

    const clips = [
      ...track.clips.filter((candidate) => candidate.id !== clip.id),
      clip
    ].sort((first, second) => first.timelineStart - second.timelineStart);

    return {
      ...track,
      clips
    };
  });

  return {
    ...timeline,
    tracks
  };
}

function ensureVideoTrack(tracks: Track[]): Track[] {
  if (tracks.some((track) => track.id === "video-1")) {
    return tracks;
  }

  return [
    {
      id: "video-1",
      kind: "video",
      name: "V1",
      order: 0,
      clips: [],
      locked: false,
      muted: false,
      visible: true
    },
    ...tracks
  ];
}

function resolveProjectAssetPath(
  projectRootPath: string,
  asset: Asset
): string | undefined {
  return asset.projectRelativePath
    ? fromProjectRelativePath(projectRootPath, asset.projectRelativePath)
    : undefined;
}

function hasStoryboardOutput(project: Project, segmentId: string): boolean {
  const segment = project.storyboardSegments.find(
    (candidate) => candidate.id === segmentId
  );
  if (!segment?.outputAssetId) {
    return false;
  }

  return project.assets.some(
    (asset) => asset.id === segment.outputAssetId && Boolean(asset.projectRelativePath)
  );
}

function resolveLastFrameTime(durationSec: number, fps: number): number {
  const safeDuration = Math.max(0, durationSec);
  const frameMargin = 2 / Math.max(1, fps);
  const margin = Math.max(0.25, frameMargin);
  return Math.max(0, safeDuration - margin);
}

function outputUriToLocalPath(outputUri: string | undefined): string | undefined {
  if (!outputUri) {
    return undefined;
  }

  if (outputUri.startsWith("file://")) {
    return fileURLToPath(outputUri);
  }

  return isAbsolute(outputUri) ? outputUri : undefined;
}

async function copyGeneratedOutputIntoProject(
  assetsDirectory: string,
  sourcePath: string,
  plannedSegment: PlannedSegment
): Promise<string> {
  const destinationPath = await getAvailableGeneratedAssetPath(
    assetsDirectory,
    sourcePath,
    plannedSegment
  );
  await copyFile(sourcePath, destinationPath);
  return destinationPath;
}

async function downloadGeneratedOutputIntoProject(
  assetsDirectory: string,
  outputUri: string,
  plannedSegment: PlannedSegment
): Promise<string> {
  logStoryboardDownload("download:start", {
    segmentId: plannedSegment.input.id,
    segmentIndex: plannedSegment.index,
    outputUri
  });
  const response = await fetch(outputUri);
  logStoryboardDownload("download:response", {
    segmentId: plannedSegment.input.id,
    segmentIndex: plannedSegment.index,
    httpStatus: response.status,
    ok: response.ok,
    contentType: response.headers.get("content-type"),
    contentLength: response.headers.get("content-length")
  });
  if (!response.ok) {
    throw new Error(
      `Failed to download generated video: HTTP ${response.status} ${response.statusText}`
    );
  }

  const contentType = response.headers.get("content-type");
  const destinationPath = await getAvailableGeneratedAssetPathForExtension(
    assetsDirectory,
    extensionForGeneratedOutput(outputUri, contentType),
    plannedSegment
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(destinationPath, bytes);
  logStoryboardDownload("download:written", {
    segmentId: plannedSegment.input.id,
    segmentIndex: plannedSegment.index,
    destinationPath,
    bytes: bytes.byteLength
  });
  return destinationPath;
}

const logStoryboardDownload = (
  stage: string,
  details: Record<string, unknown>
): void => {
  console.log(`[StoryboardAI][storyboard-download] ${stage}`, details);
};

async function getAvailableGeneratedAssetPath(
  assetsDirectory: string,
  sourcePath: string,
  plannedSegment: PlannedSegment
): Promise<string> {
  const parsedSource = parse(sourcePath);
  const extension = parsedSource.ext || extname(sourcePath) || ".mp4";
  const association = createStoryboardAssociation(
    plannedSegment.input.id,
    plannedSegment.index
  );
  const baseName = sanitizeFileName(association.storyboardRef);

  for (let index = 0; index < 10000; index += 1) {
    const candidateName =
      index === 0 ? `${baseName}${extension}` : `${baseName}-${index}${extension}`;
    const candidatePath = join(assetsDirectory, candidateName);
    if (!(await pathExists(candidatePath))) {
      return candidatePath;
    }
  }

  throw new Error(`Unable to allocate generated media path for ${sourcePath}`);
}

function sanitizeFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  return sanitized || "generated-video";
}

async function getAvailableGeneratedAssetPathForExtension(
  assetsDirectory: string,
  extension: string,
  plannedSegment: PlannedSegment
): Promise<string> {
  const association = createStoryboardAssociation(
    plannedSegment.input.id,
    plannedSegment.index
  );
  const baseName = sanitizeFileName(association.storyboardRef);

  for (let index = 0; index < 10000; index += 1) {
    const candidateName =
      index === 0 ? `${baseName}${extension}` : `${baseName}-${index}${extension}`;
    const candidatePath = join(assetsDirectory, candidateName);
    if (!(await pathExists(candidatePath))) {
      return candidatePath;
    }
  }

  throw new Error(`Unable to allocate generated media path for ${baseName}`);
}

function extensionForGeneratedOutput(outputUri: string, contentType: string | null): string {
  const pathExtension = extensionFromUri(outputUri);
  if (pathExtension) {
    return pathExtension;
  }

  switch (contentType?.split(";")[0]?.trim().toLowerCase()) {
    case "video/mp4":
      return ".mp4";
    case "video/webm":
      return ".webm";
    case "video/quicktime":
      return ".mov";
    default:
      return ".mp4";
  }
}

function extensionFromUri(outputUri: string): string | undefined {
  try {
    const parsed = new URL(outputUri);
    return extname(parsed.pathname) || undefined;
  } catch {
    return extname(outputUri) || undefined;
  }
}

function isRemoteHttpUri(outputUri: string): boolean {
  return outputUri.startsWith("http://") || outputUri.startsWith("https://");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function isPathInsideDirectory(directoryPath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(directoryPath), resolve(candidatePath));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function upsertById<TValue extends { id: string }>(
  values: TValue[],
  value: TValue
): TValue[] {
  const nextValues = values.filter((candidate) => candidate.id !== value.id);
  nextValues.push(value);
  return nextValues;
}

function normalizeDuration(value: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value * 10) / 10
    : fallback;
}

function roundTimelineTime(value: number): number {
  return Math.round(Math.max(0, value) * 1000) / 1000;
}

function truncateName(text: string): string {
  return text.length > 24 ? `${text.slice(0, 24)}...` : text;
}

function mapRoutingStatus(status: GenerationJobStatus): AiGenerationStatus {
  switch (status) {
    case "queued":
    case "validating":
    case "routing":
      return "queued";
    case "submitted":
      return "submitted";
    case "running":
      return "running";
    case "succeeded":
      return "succeeded";
    case "failed":
    case "unknown":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      status satisfies never;
      return "failed";
  }
}

function mapJobStatusToSegmentStatus(
  status: AiGenerationStatus
): StoryboardSegment["status"] {
  switch (status) {
    case "queued":
    case "submitted":
    case "running":
      return "generating";
    case "succeeded":
      return "generated";
    case "failed":
    case "cancelled":
      return "failed";
    default:
      status satisfies never;
      return "failed";
  }
}
