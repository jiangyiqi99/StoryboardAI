import type {
  GenerateVideoRequest,
  ModelRoutingContext,
  ProviderCapabilities
} from "@shared/ai-routing";
import { BaseMockProviderAdapter } from "./BaseMockProviderAdapter";

const capabilities: ProviderCapabilities = {
  providerId: "runway",
  displayName: "Runway Provider",
  authMode: "thin-model-proxy",
  supportedModes: [
    "text-to-video",
    "image-to-video",
    "first-frame-to-video",
    "first-last-frame-to-video",
    "replace-range"
  ],
  supportedModels: [
    {
      modelId: "runway-gen-placeholder",
      displayName: "Runway Gen Placeholder",
      supportedModes: [
        "text-to-video",
        "image-to-video",
        "first-frame-to-video",
        "first-last-frame-to-video",
        "replace-range"
      ],
      maxDurationSec: 10,
      supportedAspectRatios: ["16:9", "9:16", "1:1"]
    }
  ],
  supportsNegativePrompt: true,
  supportsSeed: true,
  supportsStylePreset: true,
  supportsCameraMotion: true,
  supportsReferenceImages: true,
  supportsFirstFrame: true,
  supportsLastFrame: true,
  supportsInputVideo: false,
  supportsMask: false,
  supportsPolling: true,
  supportsCancel: true,
  minDurationSec: 1,
  maxDurationSec: 10,
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
  supportedFps: [24]
};

export class RunwayProviderAdapter extends BaseMockProviderAdapter {
  constructor() {
    super(capabilities);
  }

  protected override mapCommonFields(
    request: GenerateVideoRequest,
    context: ModelRoutingContext
  ): Record<string, unknown> {
    const firstFrame = context.resolvedAssets.find(
      (asset) => asset.role === "first-frame"
    );
    const lastFrame = context.resolvedAssets.find(
      (asset) => asset.role === "last-frame"
    );

    return {
      promptText: request.prompt,
      negativePrompt: request.negativePrompt,
      duration: request.durationSec,
      ratio: request.aspectRatio,
      seed: request.seed,
      style: request.stylePreset,
      cameraMotion: request.cameraMotion,
      keyframes: {
        first: firstFrame?.uri,
        last: lastFrame?.uri
      }
    };
  }
}
