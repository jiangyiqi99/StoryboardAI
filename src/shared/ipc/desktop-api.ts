import type {
  AiGenerateVideoRequest,
  AiGenerateStoryboardRequest,
  AiGetJobStatusRequest,
  AiReplaceRangeRequest,
  ImportedMediaFile,
  MediaExtractFrameRequest,
  MediaExtractPreviewFrameRequest,
  MediaImportFilesRequest,
  MediaProbeRequest,
  MediaPreviewFrame,
  MediaRenderTimelineRequest,
  MediaSelectFilesRequest,
  ProjectCreateRequest,
  ProjectOpenRequest,
  ProjectSaveRequest
} from "./contracts";
import type { GenerateVideoResponse } from "../ai-routing";
import type {
  AppConfig,
  AppConfigGetRequest,
  AppConfigSaveRequest
} from "../types/app-config";
import type { AiGenerationJob } from "../types/ai";
import type { AssetMetadata } from "../types/asset";
import type { Project } from "../types/project";

export interface AivDesktopApi {
  config: {
    get(request?: AppConfigGetRequest): Promise<AppConfig>;
    save(request: AppConfigSaveRequest): Promise<AppConfig>;
  };
  project: {
    create(request: ProjectCreateRequest): Promise<Project>;
    open(request: ProjectOpenRequest): Promise<Project>;
    save(request: ProjectSaveRequest): Promise<Project>;
  };
  media: {
    probe(request: MediaProbeRequest): Promise<AssetMetadata>;
    importFiles(request: MediaImportFilesRequest): Promise<ImportedMediaFile[]>;
    selectFiles(request?: MediaSelectFilesRequest): Promise<ImportedMediaFile[]>;
    extractFrame(request: MediaExtractFrameRequest): Promise<string>;
    extractPreviewFrame(
      request: MediaExtractPreviewFrameRequest
    ): Promise<MediaPreviewFrame>;
    renderTimeline(request: MediaRenderTimelineRequest): Promise<string>;
    getPathForFile(file: File): string;
  };
  ai: {
    generateVideo(request: AiGenerateVideoRequest): Promise<GenerateVideoResponse>;
    generateStoryboard(
      request: AiGenerateStoryboardRequest
    ): Promise<AiGenerationJob[]>;
    replaceRange(request: AiReplaceRangeRequest): Promise<AiGenerationJob>;
    getJobStatus(request: AiGetJobStatusRequest): Promise<AiGenerationJob>;
  };
}
