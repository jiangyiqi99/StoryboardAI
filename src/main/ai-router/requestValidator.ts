import type { GenerateVideoRequest } from "@shared/ai-routing";
import { AiRoutingError } from "./errors";

const modesRequiringVisualInput = new Set([
  "image-to-video",
  "first-frame-to-video",
  "first-last-frame-to-video",
  "video-to-video",
  "replace-range"
]);

export class GenerateVideoRequestValidator {
  validate(request: GenerateVideoRequest): void {
    if (!request.prompt.trim()) {
      throw new AiRoutingError({
        code: "VALIDATION_ERROR",
        message: "prompt is required for video generation.",
        retryable: false
      });
    }

    if (request.durationSec !== undefined && request.durationSec <= 0) {
      throw new AiRoutingError({
        code: "VALIDATION_ERROR",
        message: "durationSec must be greater than zero.",
        retryable: false
      });
    }

    if (request.width !== undefined && request.width <= 0) {
      throw new AiRoutingError({
        code: "VALIDATION_ERROR",
        message: "width must be greater than zero.",
        retryable: false
      });
    }

    if (request.height !== undefined && request.height <= 0) {
      throw new AiRoutingError({
        code: "VALIDATION_ERROR",
        message: "height must be greater than zero.",
        retryable: false
      });
    }

    if (
      modesRequiringVisualInput.has(request.mode) &&
      !request.referenceImages?.length &&
      !request.firstFrameAssetId &&
      !request.lastFrameAssetId &&
      !request.inputVideoAssetId
    ) {
      throw new AiRoutingError({
        code: "VALIDATION_ERROR",
        message: `${request.mode} requires at least one visual input reference.`,
        retryable: false
      });
    }
  }
}
