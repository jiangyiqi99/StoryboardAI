import type {
  GenerateVideoRequest,
  ModelRoutingContext,
  ProviderCapabilities
} from "@shared/ai-routing";
import { BaseMockProviderAdapter } from "./BaseMockProviderAdapter";

const capabilities: ProviderCapabilities = {
  providerId: "luma",
  displayName: "Luma Provider",
  authMode: "thin-model-proxy",
  supportedModes: ["text-to-video", "image-to-video", "first-frame-to-video"],
  supportedModels: [
    {
      modelId: "luma-dream-placeholder",
      displayName: "Luma Dream Placeholder",
      supportedModes: ["text-to-video", "image-to-video", "first-frame-to-video"],
      maxDurationSec: 8
    }
  ],
  supportsNegativePrompt: false,
  supportsSeed: true,
  supportsStylePreset: true,
  supportsCameraMotion: true,
  supportsReferenceImages: true,
  supportsFirstFrame: true,
  supportsLastFrame: false,
  supportsInputVideo: false,
  supportsMask: false,
  supportsPolling: true,
  supportsCancel: true,
  minDurationSec: 1,
  maxDurationSec: 8,
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
  supportedFps: [24]
};

export class LumaProviderAdapter extends BaseMockProviderAdapter {
  constructor() {
    super(capabilities);
  }

  protected override mapCommonFields(
    request: GenerateVideoRequest,
    context: ModelRoutingContext
  ): Record<string, unknown> {
    const firstFrame = context.resolvedAssets.find(
      (asset) => asset.role === "first-frame" || asset.role === "reference-image"
    );

    return {
      generation: {
        prompt: request.prompt,
        duration_seconds: request.durationSec,
        aspect_ratio: request.aspectRatio,
        resolution:
          request.width && request.height
            ? {
                width: request.width,
                height: request.height
              }
            : undefined,
        seed: request.seed,
        style_preset: request.stylePreset,
        camera_motion: request.cameraMotion
      },
      keyframes: firstFrame
        ? {
            frame0: {
              type: "image",
              url: firstFrame.uri
            }
          }
        : undefined
    };
  }
}
