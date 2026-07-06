import type {
  GenerateVideoRequest,
  ModelRoutingContext,
  ProviderCapabilities
} from "@shared/ai-routing";
import { BaseMockProviderAdapter } from "./BaseMockProviderAdapter";

const capabilities: ProviderCapabilities = {
  providerId: "kling",
  displayName: "Kling Provider",
  authMode: "thin-model-proxy",
  supportedModes: ["image-to-video", "first-frame-to-video"],
  supportedModels: [
    {
      modelId: "kling-video-placeholder",
      displayName: "Kling Video Placeholder",
      supportedModes: ["image-to-video", "first-frame-to-video"],
      maxDurationSec: 10,
      supportedAspectRatios: ["16:9", "9:16"]
    }
  ],
  supportsNegativePrompt: true,
  supportsSeed: false,
  supportsStylePreset: false,
  supportsCameraMotion: true,
  supportsReferenceImages: true,
  supportsFirstFrame: true,
  supportsLastFrame: false,
  supportsInputVideo: false,
  supportsMask: false,
  supportsPolling: true,
  supportsCancel: true,
  minDurationSec: 1,
  maxDurationSec: 10,
  supportedAspectRatios: ["16:9", "9:16"],
  supportedFps: [24, 30]
};

export class KlingProviderAdapter extends BaseMockProviderAdapter {
  constructor() {
    super(capabilities);
  }

  protected override mapCommonFields(
    request: GenerateVideoRequest,
    context: ModelRoutingContext
  ): Record<string, unknown> {
    const firstImage =
      context.resolvedAssets.find((asset) => asset.role === "first-frame") ??
      context.resolvedAssets.find((asset) => asset.role === "reference-image");

    return {
      prompt: request.prompt,
      negative_prompt: request.negativePrompt,
      duration_sec: request.durationSec,
      aspect_ratio: request.aspectRatio,
      resolution: request.width && request.height ? `${request.width}x${request.height}` : undefined,
      motion: request.cameraMotion,
      image: firstImage?.uri
    };
  }
}
