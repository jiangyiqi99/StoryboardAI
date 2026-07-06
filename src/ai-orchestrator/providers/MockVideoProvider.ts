import { randomUUID } from "node:crypto";
import type {
  FirstFrameVideoRequest,
  FirstLastFrameVideoRequest,
  ImageToVideoRequest,
  ProviderCapabilities,
  ProviderJobRef,
  TextToVideoRequest,
  VideoModelProvider
} from "@shared/types/ai";

export class MockVideoProvider implements VideoModelProvider {
  getCapabilities(): ProviderCapabilities {
    return {
      providerId: "mock",
      displayName: "Mock Video Provider",
      supportsTextToVideo: true,
      supportsImageToVideo: true,
      supportsFirstFrame: true,
      supportsFirstLastFrame: true,
      supportsPolling: true,
      supportsCancel: true,
      maxDurationSeconds: 10,
      supportedAspectRatios: ["16:9", "9:16", "1:1"],
      supportedFps: [24, 30]
    };
  }

  async submitTextToVideo(_request: TextToVideoRequest): Promise<ProviderJobRef> {
    return this.createMockJobRef();
  }

  async submitImageToVideo(_request: ImageToVideoRequest): Promise<ProviderJobRef> {
    return this.createMockJobRef();
  }

  async submitFirstFrameVideo(
    _request: FirstFrameVideoRequest
  ): Promise<ProviderJobRef> {
    return this.createMockJobRef();
  }

  async submitFirstLastFrameVideo(
    _request: FirstLastFrameVideoRequest
  ): Promise<ProviderJobRef> {
    return this.createMockJobRef();
  }

  async getJobStatus(providerJobId: string): Promise<ProviderJobRef> {
    return {
      providerId: "mock",
      providerJobId,
      status: "running"
    };
  }

  async cancelJob(_providerJobId: string): Promise<void> {
    // TODO: forward cancellation to the real provider or thin model proxy.
  }

  private createMockJobRef(): ProviderJobRef {
    return {
      providerId: "mock",
      providerJobId: `mock-${randomUUID()}`,
      status: "submitted"
    };
  }
}
