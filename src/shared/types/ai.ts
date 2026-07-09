import type { AssetId } from "./asset";

export type AiWorkflowKind = "storyboard-to-video" | "replace-range";

export type AiGenerationMode =
  | "text-to-video"
  | "image-to-video"
  | "first-frame"
  | "first-last-frame";

export type AiGenerationStatus =
  | "queued"
  | "submitted"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface ProviderCapabilities {
  providerId: string;
  displayName: string;
  supportsTextToVideo: boolean;
  supportsImageToVideo: boolean;
  supportsFirstFrame: boolean;
  supportsFirstLastFrame: boolean;
  supportsPolling: boolean;
  supportsCancel: boolean;
  maxDurationSeconds?: number;
  supportedAspectRatios?: string[];
  supportedFps?: number[];
}

export interface ProviderJobRef {
  providerId: string;
  providerJobId: string;
  status: AiGenerationStatus;
  outputUri?: string;
  errorMessage?: string;
}

export interface AiGenerationJob {
  id: string;
  storyboardRef?: string;
  storyboardSegmentId?: string;
  storyboardSegmentIndex?: number;
  storyboardSegmentNumber?: number;
  workflow: AiWorkflowKind;
  mode: AiGenerationMode;
  status: AiGenerationStatus;
  providerId: string;
  modelId?: string;
  prompt: string;
  duration: number;
  inputAssetIds: AssetId[];
  inputFramePaths?: string[];
  outputAssetId?: AssetId;
  providerJobId?: string;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface TextToVideoRequest {
  prompt: string;
  duration: number;
  aspectRatio: string;
  fps?: number;
  modelId?: string;
}

export interface ImageToVideoRequest extends TextToVideoRequest {
  imagePath: string;
}

export interface FirstFrameVideoRequest extends TextToVideoRequest {
  firstFramePath: string;
}

export interface FirstLastFrameVideoRequest extends FirstFrameVideoRequest {
  lastFramePath: string;
}

export interface VideoModelProvider {
  getCapabilities(): ProviderCapabilities;
  submitTextToVideo(request: TextToVideoRequest): Promise<ProviderJobRef>;
  submitImageToVideo(request: ImageToVideoRequest): Promise<ProviderJobRef>;
  submitFirstFrameVideo(request: FirstFrameVideoRequest): Promise<ProviderJobRef>;
  submitFirstLastFrameVideo(
    request: FirstLastFrameVideoRequest
  ): Promise<ProviderJobRef>;
  getJobStatus(providerJobId: string): Promise<ProviderJobRef>;
  cancelJob(providerJobId: string): Promise<void>;
}
