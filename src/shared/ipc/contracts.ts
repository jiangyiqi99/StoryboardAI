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
import type {
  Project,
  ProjectRuntimeContext,
  ProjectSettings
} from "../types/project";
import type { TimelineRange, TrackId } from "../types/timeline";
import type { StoryScriptDocumentFormat } from "../storyScriptDocuments";
import type {
  NativeEncodeResult,
  NativeEncodeSettings,
  NativeAudioBuffer,
  NativeMediaAsset,
  NativeMediaProbe,
  NativePlaybackSession,
  NativeTimelineProject,
  NativeVideoFrame
} from "../types/native-media";

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

export interface ProjectRuntimeLayout {
  [name: string]: string;
}

export interface ProjectRuntimeAssetFile {
  assetId: string;
  absolutePath?: string;
  fileUrl?: string;
  thumbnailPath?: string;
  thumbnailUrl?: string;
  proxyPath?: string;
  proxyUrl?: string;
}

export interface ProjectSession {
  project: Project;
  runtime: ProjectRuntimeContext;
  layout: ProjectRuntimeLayout;
  assetFiles: ProjectRuntimeAssetFile[];
}

export interface ProjectSelectCreateDirectoryRequest {
  defaultPath?: string;
}

export interface ProjectSelectCreateDirectoryResponse {
  directoryPath: string;
}

export interface ProjectSelectOpenLocationRequest {
  defaultPath?: string;
}

export interface ProjectSelectOpenLocationResponse {
  projectRootPath: string;
}

export interface StoryScriptSelectImportFileRequest {
  defaultPath?: string;
}

export interface StoryScriptImportFile {
  filePath: string;
  fileName: string;
  format: StoryScriptDocumentFormat;
  content: string;
}

export interface StoryScriptSaveTemplateRequest {
  format: StoryScriptDocumentFormat;
  defaultPath?: string;
}

export interface StoryScriptSaveTemplateResponse {
  filePath: string;
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
  projectRelativePath?: string;
  thumbnailPath?: string;
  thumbnailUrl?: string;
  thumbnailProjectRelativePath?: string;
}

export interface MediaImportFilesRequest {
  absolutePaths: string[];
  projectRootPath?: string;
}

export interface MediaSelectFilesRequest {
  allowMultiple?: boolean;
  projectRootPath?: string;
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

export interface NativeMediaOpenAssetRequest {
  path: string;
}

export interface NativeMediaProbeRequest {
  path: string;
}

export interface NativeMediaDecodeFrameRequest {
  assetId: string;
  time: number;
}

export interface NativeMediaCreatePlaybackSessionRequest {
  timeline: NativeTimelineProject;
}

export interface NativeMediaSessionRequest {
  sessionId: string;
}

export interface NativeMediaSeekRequest extends NativeMediaSessionRequest {
  time: number;
}

export interface NativeMediaRenderFrameRequest extends NativeMediaSessionRequest {
  timelineTime: number;
}

export interface NativeMediaRenderAudioRequest extends NativeMediaSessionRequest {
  timelineTime: number;
  /** Timeline seconds to decode and mix; preview requests short buffered chunks. */
  duration: number;
}

export interface NativeMediaEncodeTimelineRequest {
  project: NativeTimelineProject;
  outputPath: string;
  settings: NativeEncodeSettings;
}

export interface NativeMediaDisposeRequest {
  targetId: string;
}

export interface MediaExportTimelineClipInput {
  clipId: string;
  assetName: string;
  sourcePath: string;
  timelineStart: number;
}

export interface MediaExportTimelineClipsRequest {
  projectRootPath: string;
  clips: MediaExportTimelineClipInput[];
}

export interface MediaExportTimelineClipFile {
  clipId: string;
  sourcePath: string;
  outputPath: string;
  fileName: string;
}

export interface MediaExportTimelineClipsResponse {
  outputDirectory: string;
  files: MediaExportTimelineClipFile[];
}

export interface AiGenerateStoryboardRequest {
  projectRootPath: string;
  script: string;
  segments?: AiStoryboardSegmentInput[];
  targetSegmentIds?: string[];
  replaceSegmentId?: string;
  replaceExistingTargetClips?: boolean;
  providerId: string;
  modelId?: string;
  defaultDuration: number;
  aspectRatio: string;
}

export type AiStoryboardProgressStage =
  | "workflow-start"
  | "project-opened"
  | "segments-planned"
  | "segment-start"
  | "boundary-resolving"
  | "boundary-ready"
  | "task-creating"
  | "task-created"
  | "waiting-output"
  | "polling-start"
  | "polling"
  | "polling-complete"
  | "output-ready"
  | "saving-output"
  | "download-complete"
  | "segment-complete"
  | "project-saving"
  | "project-saved"
  | "workflow-complete"
  | "error";

export interface AiStoryboardProgressEvent {
  runId: string;
  projectRootPath: string;
  stage: AiStoryboardProgressStage;
  message: string;
  segmentId?: string;
  segmentIndex?: number;
  segmentCount?: number;
  providerId?: string;
  modelId?: string;
  jobId?: string;
  providerJobId?: string;
  status?: string;
  outputUri?: string;
  outputPath?: string;
  progress?: number;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface AiStoryboardSegmentInput {
  id: string;
  text: string;
  durationSec: number;
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
    response: ProjectSession;
  };
  "project:open": {
    request: ProjectOpenRequest;
    response: ProjectSession;
  };
  "project:save": {
    request: ProjectSaveRequest;
    response: ProjectSession;
  };
  "project:selectCreateDirectory": {
    request: ProjectSelectCreateDirectoryRequest;
    response: ProjectSelectCreateDirectoryResponse | null;
  };
  "project:selectOpenLocation": {
    request: ProjectSelectOpenLocationRequest;
    response: ProjectSelectOpenLocationResponse | null;
  };
  "storyScript:selectImportFile": {
    request: StoryScriptSelectImportFileRequest;
    response: StoryScriptImportFile | null;
  };
  "storyScript:saveTemplate": {
    request: StoryScriptSaveTemplateRequest;
    response: StoryScriptSaveTemplateResponse | null;
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
  "media:exportTimelineClips": {
    request: MediaExportTimelineClipsRequest;
    response: MediaExportTimelineClipsResponse;
  };
  "nativeMedia:openAsset": {
    request: NativeMediaOpenAssetRequest;
    response: NativeMediaAsset;
  };
  "nativeMedia:probe": {
    request: NativeMediaProbeRequest;
    response: NativeMediaProbe;
  };
  "nativeMedia:decodeFrame": {
    request: NativeMediaDecodeFrameRequest;
    response: NativeVideoFrame;
  };
  "nativeMedia:createPlaybackSession": {
    request: NativeMediaCreatePlaybackSessionRequest;
    response: NativePlaybackSession;
  };
  "nativeMedia:seek": {
    request: NativeMediaSeekRequest;
    response: NativePlaybackSession;
  };
  "nativeMedia:play": {
    request: NativeMediaSessionRequest;
    response: NativePlaybackSession;
  };
  "nativeMedia:pause": {
    request: NativeMediaSessionRequest;
    response: NativePlaybackSession;
  };
  "nativeMedia:renderFrame": {
    request: NativeMediaRenderFrameRequest;
    response: NativeVideoFrame;
  };
  "nativeMedia:renderAudio": {
    request: NativeMediaRenderAudioRequest;
    response: NativeAudioBuffer;
  };
  "nativeMedia:encodeTimeline": {
    request: NativeMediaEncodeTimelineRequest;
    response: NativeEncodeResult;
  };
  "nativeMedia:dispose": {
    request: NativeMediaDisposeRequest;
    response: void;
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
