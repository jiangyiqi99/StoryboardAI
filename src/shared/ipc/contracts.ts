import type {
  GenerateVideoRequest,
  GenerateVideoResponse
} from "../ai-routing";
import type {
  AppConfig,
  AppConfigGetRequest,
  AppConfigSaveRequest
} from "../types/app-config";
import type { AiGenerationJob } from "../types/ai";
import type { AssetMetadata } from "../types/asset";
import type { Project, ProjectSettings } from "../types/project";
import type { TimelineRange, TrackId } from "../types/timeline";

export interface ProjectCreateRequest {
  name: string;
  parentDirectory: string;
  settings?: Partial<ProjectSettings>;
}

export interface ProjectOpenRequest {
  projectRootPath: string;
}

export interface ProjectSaveRequest {
  projectRootPath: string;
  project: Project;
}

export interface MediaProbeRequest {
  absolutePath: string;
}

export type ImportedMediaKind = "video" | "audio" | "image";

export interface ImportedMediaFile {
  absolutePath: string;
  fileUrl: string;
  kind: ImportedMediaKind;
  name: string;
  metadata: AssetMetadata;
  thumbnailPath?: string;
  thumbnailUrl?: string;
}

export interface MediaImportFilesRequest {
  absolutePaths: string[];
}

export interface MediaSelectFilesRequest {
  allowMultiple?: boolean;
}

export interface MediaExtractFrameRequest {
  absolutePath: string;
  time: number;
  outputPath: string;
}

export interface MediaExtractPreviewFrameRequest {
  absolutePath: string;
  time: number;
  maxWidth?: number;
}

export interface MediaPreviewFrame {
  path: string;
  url: string;
  time: number;
}

export interface MediaRenderTimelineRequest {
  project: Project;
  outputPath: string;
  range?: TimelineRange;
}

export interface AiGenerateStoryboardRequest {
  projectRootPath: string;
  script: string;
  providerId: string;
  modelId?: string;
  defaultDuration: number;
  aspectRatio: string;
}

export interface AiReplaceRangeRequest {
  projectRootPath: string;
  range: TimelineRange;
  trackId: TrackId;
  prompt: string;
  providerId: string;
  modelId?: string;
}

export interface AiGetJobStatusRequest {
  jobId: string;
  providerJobId?: string;
  providerId: string;
}

export type AiGenerateVideoRequest = GenerateVideoRequest;

export interface IpcInvokeMap {
  "project:create": {
    request: ProjectCreateRequest;
    response: Project;
  };
  "project:open": {
    request: ProjectOpenRequest;
    response: Project;
  };
  "project:save": {
    request: ProjectSaveRequest;
    response: Project;
  };
  "media:probe": {
    request: MediaProbeRequest;
    response: AssetMetadata;
  };
  "media:importFiles": {
    request: MediaImportFilesRequest;
    response: ImportedMediaFile[];
  };
  "media:selectFiles": {
    request: MediaSelectFilesRequest;
    response: ImportedMediaFile[];
  };
  "media:extractFrame": {
    request: MediaExtractFrameRequest;
    response: string;
  };
  "media:extractPreviewFrame": {
    request: MediaExtractPreviewFrameRequest;
    response: MediaPreviewFrame;
  };
  "media:renderTimeline": {
    request: MediaRenderTimelineRequest;
    response: string;
  };
  "appConfig:get": {
    request: AppConfigGetRequest;
    response: AppConfig;
  };
  "appConfig:save": {
    request: AppConfigSaveRequest;
    response: AppConfig;
  };
  "ai:generateVideo": {
    request: AiGenerateVideoRequest;
    response: GenerateVideoResponse;
  };
  "ai:generateStoryboard": {
    request: AiGenerateStoryboardRequest;
    response: AiGenerationJob[];
  };
  "ai:replaceRange": {
    request: AiReplaceRangeRequest;
    response: AiGenerationJob;
  };
  "ai:getJobStatus": {
    request: AiGetJobStatusRequest;
    response: AiGenerationJob;
  };
}
