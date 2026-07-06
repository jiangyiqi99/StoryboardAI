import type { ProviderCapabilities } from "@shared/ai-routing";
import { BaseMockProviderAdapter } from "./BaseMockProviderAdapter";

const capabilities: ProviderCapabilities = {
  providerId: "mock",
  displayName: "Mock Provider",
  authMode: "none",
  supportedModes: [
    "text-to-video",
    "image-to-video",
    "first-frame-to-video",
    "first-last-frame-to-video",
    "video-to-video",
    "replace-range"
  ],
  supportedModels: [
    {
      modelId: "mock-video-v1",
      displayName: "Mock Video v1",
      supportedModes: [
        "text-to-video",
        "image-to-video",
        "first-frame-to-video",
        "first-last-frame-to-video",
        "video-to-video",
        "replace-range"
      ]
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
  maxDurationSec: 30,
  supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3"],
  supportedFps: [12, 24, 30]
};

export class MockProviderAdapter extends BaseMockProviderAdapter {
  constructor() {
    super(capabilities);
  }
}
