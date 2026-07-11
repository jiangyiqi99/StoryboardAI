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
  NativeMediaCreatePlaybackSessionRequest,
  NativeMediaDecodeFrameRequest,
  NativeMediaRenderAudioRequest,
  NativeMediaDisposeRequest,
  NativeMediaEncodeTimelineRequest,
  NativeMediaOpenAssetRequest,
  NativeMediaProbeRequest,
  NativeMediaRenderFrameRequest,
  NativeMediaSeekRequest,
  NativeMediaSessionRequest,
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
import type {
  NativeEncodeResult,
  NativeAudioBuffer,
  NativeMediaAsset,
  NativeMediaProbe,
  NativePlaybackSession,
  NativeVideoFrame
} from "../types/native-media";

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
  /**
   * Experimental sidecar-backed libav API. It is intentionally separate from
   * `media` until native playback/export is promoted from the MVP path.
   */
  nativeMedia: {
    openAsset(request: NativeMediaOpenAssetRequest): Promise<NativeMediaAsset>;
    probe(request: NativeMediaProbeRequest): Promise<NativeMediaProbe>;
    decodeFrame(request: NativeMediaDecodeFrameRequest): Promise<NativeVideoFrame>;
    createPlaybackSession(
      request: NativeMediaCreatePlaybackSessionRequest
    ): Promise<NativePlaybackSession>;
    seek(request: NativeMediaSeekRequest): Promise<NativePlaybackSession>;
    play(request: NativeMediaSessionRequest): Promise<NativePlaybackSession>;
    pause(request: NativeMediaSessionRequest): Promise<NativePlaybackSession>;
    renderFrame(request: NativeMediaRenderFrameRequest): Promise<NativeVideoFrame>;
    renderAudio(request: NativeMediaRenderAudioRequest): Promise<NativeAudioBuffer>;
    encodeTimeline(request: NativeMediaEncodeTimelineRequest): Promise<NativeEncodeResult>;
    dispose(request: NativeMediaDisposeRequest): Promise<void>;
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
