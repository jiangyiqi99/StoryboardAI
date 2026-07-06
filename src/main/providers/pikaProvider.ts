import type {
  GenerateVideoRequest,
  ModelRoutingContext,
  ProviderCapabilities
} from "@shared/ai-routing";
import { BaseMockProviderAdapter } from "./BaseMockProviderAdapter";

const capabilities: ProviderCapabilities = {
  providerId: "pika",
  displayName: "Pika Provider",
  authMode: "thin-model-proxy",
  supportedModes: ["image-to-video", "video-to-video", "replace-range"],
  supportedModels: [
    {
      modelId: "pika-video-placeholder",
      displayName: "Pika Video Placeholder",
      supportedModes: ["image-to-video", "video-to-video", "replace-range"],
      maxDurationSec: 6
    }
  ],
  supportsNegativePrompt: true,
  supportsSeed: true,
  supportsStylePreset: true,
  supportsCameraMotion: true,
  supportsReferenceImages: true,
  supportsFirstFrame: true,
  supportsLastFrame: true,
  supportsInputVideo: true,
  supportsMask: true,
  supportsPolling: true,
  supportsCancel: true,
  minDurationSec: 1,
  maxDurationSec: 6,
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
  supportedFps: [24]
};

export class PikaProviderAdapter extends BaseMockProviderAdapter {
  constructor() {
    super(capabilities);
  }

  protected override mapCommonFields(
    request: GenerateVideoRequest,
    context: ModelRoutingContext
  ): Record<string, unknown> {
    const inputVideo = context.resolvedAssets.find(
      (asset) => asset.role === "input-video"
    );
    const mask = context.resolvedAssets.find((asset) => asset.role === "mask");

    return {
      prompt: request.prompt,
      negative_prompt: request.negativePrompt,
      seconds: request.durationSec,
      options: {
        aspect_ratio: request.aspectRatio,
        resolution:
          request.width && request.height
            ? `${request.width}x${request.height}`
            : undefined,
        fps: request.fps,
        seed: request.seed,
        style: request.stylePreset,
        motion: request.cameraMotion
      },
      video_url: inputVideo?.uri,
      mask_url: mask?.uri,
      references: context.resolvedAssets
        .filter((asset) => asset.role !== "input-video" && asset.role !== "mask")
        .map((asset) => asset.uri)
    };
  }
}
