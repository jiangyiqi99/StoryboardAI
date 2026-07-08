export type GenerationMode =
  | "text-to-video"
  | "image-to-video"
  | "first-frame-to-video"
  | "first-last-frame-to-video"
  | "video-to-video"
  | "replace-range";

export type GenerationJobStatus =
  | "queued"
  | "validating"
  | "routing"
  | "submitted"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";

export type ProviderAuthMode =
  | "none"
  | "api-key"
  | "bearer-token"
  | "thin-model-proxy";

export interface ReferenceImageInput {
  assetId?: string;
  uri?: string;
  absolutePath?: string;
  mimeType?: string;
  role?:
    | "reference"
    | "style"
    | "character"
    | "composition"
    | "first-frame"
    | "last-frame";
  weight?: number;
}

export interface GenerateVideoRequest {
  requestId?: string;
  projectId?: string;
  projectRootPath?: string;
  providerId?: string;
  modelId?: string;
  mode: GenerationMode;
  prompt: string;
  negativePrompt?: string;
  durationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  aspectRatio?: string;
  seed?: number;
  stylePreset?: string;
  cameraMotion?: string;
  referenceImages?: ReferenceImageInput[];
  firstFrameAssetId?: string;
  firstFrameUri?: string;
  firstFramePath?: string;
  lastFrameAssetId?: string;
  lastFrameUri?: string;
  lastFramePath?: string;
  inputVideoAssetId?: string;
  inputVideoUri?: string;
  inputVideoPath?: string;
  maskAssetId?: string;
  maskUri?: string;
  maskPath?: string;
  metadata?: Record<string, unknown>;
}

export interface GenerateVideoResponse {
  requestId?: string;
  jobId: string;
  providerId: string;
  providerJobId: string;
  modelId?: string;
  mode: GenerationMode;
  status: GenerationJobStatus;
  outputUri?: string;
  outputAssetId?: string;
  progress?: number;
  error?: AiRoutingErrorInfo;
  route?: SelectedProviderRoute;
  rawProviderResponse?: unknown;
}

export interface GetGenerationJobStatusRequest {
  jobId: string;
  providerId: string;
  providerJobId: string;
}

export interface CancelGenerationJobRequest {
  jobId: string;
  providerId: string;
  providerJobId: string;
}

export interface AiRoutingErrorInfo {
  code:
    | "VALIDATION_ERROR"
    | "NO_ROUTE"
    | "PROVIDER_UNAVAILABLE"
    | "PROVIDER_ERROR"
    | "CANCEL_FAILED"
    | "UNKNOWN";
  message: string;
  providerId?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface ProviderResolution {
  width: number;
  height: number;
  label?: string;
}

export interface ProviderModelCapabilities {
  modelId: string;
  displayName: string;
  supportedModes: GenerationMode[];
  minDurationSec?: number;
  maxDurationSec?: number;
  supportedAspectRatios?: string[];
  supportedResolutions?: ProviderResolution[];
  supportedFps?: number[];
}

export interface ProviderCapabilities {
  providerId: string;
  displayName: string;
  authMode: ProviderAuthMode;
  supportedModes: GenerationMode[];
  supportedModels: ProviderModelCapabilities[];
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  supportsStylePreset: boolean;
  supportsCameraMotion: boolean;
  supportsReferenceImages: boolean;
  supportsFirstFrame: boolean;
  supportsLastFrame: boolean;
  supportsInputVideo: boolean;
  supportsMask: boolean;
  supportsPolling: boolean;
  supportsCancel: boolean;
  minDurationSec?: number;
  maxDurationSec?: number;
  supportedAspectRatios?: string[];
  supportedResolutions?: ProviderResolution[];
  supportedFps?: number[];
}

export interface ProviderRouteRule {
  id: string;
  providerId: string;
  modelId?: string;
  priority: number;
  enabled: boolean;
  modes: GenerationMode[];
  aspectRatios?: string[];
  minDurationSec?: number;
  maxDurationSec?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  fps?: number[];
}

export interface SelectedProviderRoute {
  ruleId?: string;
  providerId: string;
  modelId?: string;
  reason: string;
}

export interface ResolvedAssetReference {
  assetId: string;
  role:
    | "reference-image"
    | "first-frame"
    | "last-frame"
    | "input-video"
    | "mask";
  uri: string;
  absolutePath?: string;
  mimeType?: string;
}

export interface ModelRoutingContext {
  request: GenerateVideoRequest;
  routeRules: ProviderRouteRule[];
  providerCapabilities: ProviderCapabilities[];
  resolvedAssets: ResolvedAssetReference[];
  selectedRoute?: SelectedProviderRoute;
}

export interface ProviderAdapterInput {
  providerId: string;
  providerJobName?: string;
  modelId?: string;
  mode: GenerationMode;
  body: Record<string, unknown>;
  files: ResolvedAssetReference[];
  originalRequest: GenerateVideoRequest;
}

export interface ProviderAdapterJob {
  providerId: string;
  providerJobId: string;
  status: GenerationJobStatus;
  outputUri?: string;
  progress?: number;
  rawResponse?: unknown;
  error?: AiRoutingErrorInfo;
}

export interface VideoModelProvider {
  readonly providerId: string;
  getCapabilities(): ProviderCapabilities;
}

export interface ProviderAdapter extends VideoModelProvider {
  canHandle(context: ModelRoutingContext): boolean;
  mapRequest(
    request: GenerateVideoRequest,
    context: ModelRoutingContext
  ): Promise<ProviderAdapterInput>;
  submitGeneration(input: ProviderAdapterInput): Promise<ProviderAdapterJob>;
  getJobStatus(providerJobId: string): Promise<ProviderAdapterJob>;
  cancelJob(providerJobId: string): Promise<void>;
  mapResponse(
    job: ProviderAdapterJob,
    request: GenerateVideoRequest,
    route: SelectedProviderRoute
  ): GenerateVideoResponse;
}

export interface ApiRouter {
  generateVideo(request: GenerateVideoRequest): Promise<GenerateVideoResponse>;
  getJobStatus(
    request: GetGenerationJobStatusRequest
  ): Promise<GenerateVideoResponse>;
  cancelJob(
    request: CancelGenerationJobRequest
  ): Promise<GenerateVideoResponse>;
}
