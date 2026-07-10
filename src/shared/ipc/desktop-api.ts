import type {
  AiGenerateVideoRequest,
  AiGenerateStoryboardRequest,
  AiStoryboardProgressEvent,
  AiGetJobStatusRequest,
  AiReplaceRangeRequest,
  ImportedMediaFile,
  MediaExtractFrameRequest,
  MediaExtractPreviewFrameRequest,
  MediaExportTimelineClipsRequest,
  MediaExportTimelineClipsResponse,
  MediaImportFilesRequest,
  MediaProbeRequest,
  MediaPreviewFrame,
  MediaRenderTimelineRequest,
  MediaSelectFilesRequest,
  ProjectCreateRequest,
  ProjectOpenRequest,
  ProjectSaveRequest,
  ProjectSelectCreateDirectoryRequest,
  ProjectSelectCreateDirectoryResponse,
  ProjectSelectOpenLocationRequest,
  ProjectSelectOpenLocationResponse,
  ProjectSession,
  StoryScriptImportFile,
  StoryScriptSaveTemplateRequest,
  StoryScriptSaveTemplateResponse,
  StoryScriptSelectImportFileRequest
} from "./contracts";
import type { GenerateVideoResponse } from "../ai-routing";
import type {
  AppConfig,
  AppConfigGetRequest,
  AppConfigSaveRequest
} from "../types/app-config";
import type { AiGenerationJob } from "../types/ai";
import type { AssetMetadata } from "../types/asset";

export interface AivDesktopApi {
  config: {
    get(request?: AppConfigGetRequest): Promise<AppConfig>;
    save(request: AppConfigSaveRequest): Promise<AppConfig>;
  };
  project: {
    create(request: ProjectCreateRequest): Promise<ProjectSession>;
    open(request: ProjectOpenRequest): Promise<ProjectSession>;
    save(request: ProjectSaveRequest): Promise<ProjectSession>;
    selectCreateDirectory(
      request?: ProjectSelectCreateDirectoryRequest
    ): Promise<ProjectSelectCreateDirectoryResponse | null>;
    selectOpenLocation(
      request?: ProjectSelectOpenLocationRequest
    ): Promise<ProjectSelectOpenLocationResponse | null>;
  };
  storyScript: {
    selectImportFile(
      request?: StoryScriptSelectImportFileRequest
    ): Promise<StoryScriptImportFile | null>;
    saveTemplate(
      request: StoryScriptSaveTemplateRequest
    ): Promise<StoryScriptSaveTemplateResponse | null>;
  };
  media: {
    probe(request: MediaProbeRequest): Promise<AssetMetadata>;
    importFiles(request: MediaImportFilesRequest): Promise<ImportedMediaFile[]>;
    selectFiles(request?: MediaSelectFilesRequest): Promise<ImportedMediaFile[]>;
    extractFrame(request: MediaExtractFrameRequest): Promise<string>;
    extractPreviewFrame(
      request: MediaExtractPreviewFrameRequest
    ): Promise<MediaPreviewFrame>;
    exportTimelineClips(
      request: MediaExportTimelineClipsRequest
    ): Promise<MediaExportTimelineClipsResponse>;
    renderTimeline(request: MediaRenderTimelineRequest): Promise<string>;
    getPathForFile(file: File): string;
  };
  ai: {
    generateVideo(request: AiGenerateVideoRequest): Promise<GenerateVideoResponse>;
    generateStoryboard(
      request: AiGenerateStoryboardRequest
    ): Promise<AiGenerationJob[]>;
    onStoryboardProgress(
      listener: (event: AiStoryboardProgressEvent) => void
    ): () => void;
    replaceRange(request: AiReplaceRangeRequest): Promise<AiGenerationJob>;
    getJobStatus(request: AiGetJobStatusRequest): Promise<AiGenerationJob>;
  };
}
