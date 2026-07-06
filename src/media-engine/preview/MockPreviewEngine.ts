import type {
  PreviewEngine,
  PreviewLoadRequest
} from "@shared/types/media-engine";

export class MockPreviewEngine implements PreviewEngine {
  async loadTimeline(_request: PreviewLoadRequest): Promise<void> {
    // TODO: renderer stage can bind this to HTMLVideoElement before native preview backends.
  }

  async seek(_time: number): Promise<void> {
    // TODO: map timeline time to active clip and preview source time.
  }

  async play(): Promise<void> {
    // TODO: start preview clock.
  }

  async pause(): Promise<void> {
    // TODO: pause preview clock.
  }

  async scrub(_time: number): Promise<void> {
    // TODO: low-latency seek path for pointer drag.
  }

  async setQuality(_quality: "quarter" | "half" | "full"): Promise<void> {
    // TODO: switch proxy or preview resolution policy.
  }

  async dispose(): Promise<void> {
    // TODO: release preview resources.
  }
}
