import type {
  AiGenerateStoryboardRequest,
  AiGetJobStatusRequest,
  AiReplaceRangeRequest
} from "@shared/ipc/contracts";
import type {
  ApiRouter as AiApiRouter,
  GenerationJobStatus
} from "@shared/ai-routing";
import type { AiGenerationJob, AiGenerationStatus } from "@shared/types/ai";
import type { MediaEngineFacade } from "@shared/types/media-engine";
import type { LocalProjectFileService } from "@project-system/projectFile";
import { ReplaceRangeWorkflow } from "./workflows/replaceRange";
import { StoryboardToTimelineWorkflow } from "./workflows/storyboardToTimeline";

export interface AiOrchestratorServices {
  projectFiles: LocalProjectFileService;
  mediaEngine: MediaEngineFacade;
  apiRouter: AiApiRouter;
}

export class AiOrchestrator {
  private readonly storyboardWorkflow: StoryboardToTimelineWorkflow;
  private readonly replaceRangeWorkflow: ReplaceRangeWorkflow;
  private readonly apiRouter: AiApiRouter;

  constructor(services: AiOrchestratorServices) {
    this.apiRouter = services.apiRouter;
    this.storyboardWorkflow = new StoryboardToTimelineWorkflow({
      projectFiles: services.projectFiles,
      mediaEngine: services.mediaEngine,
      apiRouter: services.apiRouter
    });
    this.replaceRangeWorkflow = new ReplaceRangeWorkflow({
      projectFiles: services.projectFiles,
      mediaEngine: services.mediaEngine,
      apiRouter: services.apiRouter
    });
  }

  generateStoryboard(
    request: AiGenerateStoryboardRequest
  ): Promise<AiGenerationJob[]> {
    return this.storyboardWorkflow.run(request);
  }

  replaceRange(request: AiReplaceRangeRequest): Promise<AiGenerationJob> {
    return this.replaceRangeWorkflow.run(request);
  }

  async getJobStatus(request: AiGetJobStatusRequest): Promise<AiGenerationJob> {
    const routedJob = await this.apiRouter.getJobStatus({
      jobId: request.jobId,
      providerId: request.providerId,
      providerJobId: request.providerJobId ?? request.jobId
    });

    return {
      id: request.jobId,
      workflow: "storyboard-to-video",
      mode: "text-to-video",
      status: mapRoutingStatus(routedJob.status),
      providerId: routedJob.providerId,
      providerJobId: routedJob.providerJobId,
      prompt: "",
      duration: 0,
      inputAssetIds: [],
      outputAssetId: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      errorMessage: routedJob.error?.message
    };
  }
}

const mapRoutingStatus = (
  status: GenerationJobStatus
): AiGenerationStatus => {
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
};

export * from "./providers/MockVideoProvider";
export * from "./providers/providerRegistry";
export * from "./workflows/replaceRange";
export * from "./workflows/storyboardToTimeline";
