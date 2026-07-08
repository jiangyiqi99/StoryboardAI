import { randomUUID } from "node:crypto";
import { copyFile, mkdir, stat } from "node:fs/promises";
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
  AiStoryboardSegmentInput
} from "@shared/ipc/contracts";
import type {
  ApiRouter as AiApiRouter,
  GenerateVideoRequest,
  GenerateVideoResponse,
  GenerationJobStatus
} from "@shared/ai-routing";
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

  async run(request: AiGenerateStoryboardRequest): Promise<AiGenerationJob[]> {
    const snapshot = await this.services.projectFiles.open({
      projectRootPath: request.projectRootPath
    });
    const project = snapshot.project;
    const segments = resolveStoryboardInputs(request);
    if (segments.length === 0) {
      return [];
    }

    const targetSegmentIds = new Set(
      request.replaceSegmentId ? [request.replaceSegmentId] : segments.map((segment) => segment.id)
    );
    const plannedSegments = planSegments(segments);
    const now = new Date().toISOString();
    const jobs: AiGenerationJob[] = [];
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

      const previousSegment = plannedSegments[plannedSegment.index - 1];
      const nextSegment = plannedSegments[plannedSegment.index + 1];
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
      const generationRequest = buildGenerateVideoRequest({
        project: nextProject,
        projectRootPath: request.projectRootPath,
        request,
        plannedSegment,
        plannedSegments,
        previousBoundary,
        nextBoundary
      });
      const submittedResponse =
        await this.services.apiRouter.generateVideo(generationRequest);
      const response = await this.waitForGenerationOutput(submittedResponse);
      const job = createGenerationJob(response, generationRequest, plannedSegment, request, now);
      const generatedOutput = await this.resolveGeneratedOutputFile(
        response,
        request.projectRootPath,
        plannedSegment
      );
      const asset = createGeneratedAsset(
        job,
        plannedSegment,
        project,
        response,
        now,
        generatedOutput
      );
      const clip = createGeneratedClip(asset, plannedSegment);

      jobs.push(job);
      nextProject.assets = upsertById(nextProject.assets, asset);
      nextProject.aiGenerationJobs = upsertById(nextProject.aiGenerationJobs, job);
      nextProject.storyboardSegments = updateSegmentAfterGeneration(
        nextProject.storyboardSegments,
        plannedSegment,
        job,
        asset
      );
      nextProject.timeline = insertGeneratedClip(nextProject.timeline, clip);
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

    await this.services.projectFiles.save({
      projectRootPath: request.projectRootPath,
      project: nextProject
    });

    return jobs;
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

    const outputPath = join(
      getProjectDirectoryPath(projectRootPath, "frames"),
      `storyboard-${segmentId}-${edge}.jpg`
    );
    const time =
      edge === "first"
        ? 0
        : Math.max(0, (asset.metadata.duration ?? segment.targetDuration) - 1 / project.settings.fps);

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
    response: GenerateVideoResponse
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

      if (!shouldPollGeneration(latestResponse)) {
        return latestResponse;
      }
    }

    return latestResponse;
  }

  private async resolveGeneratedOutputFile(
    response: GenerateVideoResponse,
    projectRootPath: string,
    plannedSegment: PlannedSegment
  ): Promise<GeneratedOutputFile | undefined> {
    const outputPath = outputUriToLocalPath(response.outputUri);
    if (!outputPath) {
      return undefined;
    }

    const assetsDirectory = getProjectDirectoryPath(projectRootPath, "assets");
    await mkdir(assetsDirectory, { recursive: true });
    const projectOutputPath = isPathInsideDirectory(assetsDirectory, outputPath)
      ? outputPath
      : await copyGeneratedOutputIntoProject(
          assetsDirectory,
          outputPath,
          plannedSegment
        );
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
  const mode = selectGenerationMode({
    isReplacement: Boolean(request.replaceSegmentId),
    previousBoundary,
    nextBoundary
  });

  return {
    requestId: `storyboard-${plannedSegment.input.id}-${randomUUID()}`,
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
      storySegmentId: plannedSegment.input.id,
      storySegmentIndex: plannedSegment.index,
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

    return {
      ...current,
      id: plannedSegment.input.id,
      index: plannedSegment.index,
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
  return {
    id: response.jobId,
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
    outputAssetId: `asset-storyboard-${plannedSegment.input.id}`,
    providerJobId: response.providerJobId,
    createdAt: now,
    updatedAt: now,
    errorMessage: response.error?.message,
    metadata: {
      ...request.metadata,
      routedMode: response.mode,
      route: response.route,
      rawProviderResponse: response.rawProviderResponse,
      outputUri: response.outputUri
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

  return {
    id: job.outputAssetId ?? `asset-storyboard-${plannedSegment.input.id}`,
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
          segmentId: plannedSegment.input.id,
          segmentIndex: plannedSegment.index,
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
    tags: ["ai-generated", "storyboard", `story-segment:${plannedSegment.input.id}`]
  };
}

function createGeneratedClip(asset: Asset, plannedSegment: PlannedSegment): Clip {
  return {
    id: `clip-storyboard-${plannedSegment.input.id}`,
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
      storySegmentId: plannedSegment.input.id,
      storySegmentIndex: plannedSegment.index,
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
  return segments.map((segment) =>
    segment.id === plannedSegment.input.id
      ? {
          ...segment,
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

async function getAvailableGeneratedAssetPath(
  assetsDirectory: string,
  sourcePath: string,
  plannedSegment: PlannedSegment
): Promise<string> {
  const parsedSource = parse(sourcePath);
  const extension = parsedSource.ext || extname(sourcePath) || ".mp4";
  const baseName = sanitizeFileName(
    `storyboard-${String(plannedSegment.index + 1).padStart(2, "0")}-${plannedSegment.input.id}`
  );

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
