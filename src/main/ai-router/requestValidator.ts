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
      !request.firstFrameUri &&
      !request.firstFramePath &&
      !request.lastFrameAssetId &&
      !request.lastFrameUri &&
      !request.lastFramePath &&
      !request.inputVideoAssetId &&
      !request.inputVideoUri &&
      !request.inputVideoPath
    ) {
      throw new AiRoutingError({
        code: "VALIDATION_ERROR",
        message: `${request.mode} requires at least one visual input reference.`,
        retryable: false
      });
    }

    if (request.mode === "first-frame-to-video" && !hasFirstFrameInput(request)) {
      throw new AiRoutingError({
        code: "VALIDATION_ERROR",
        message: "first-frame-to-video requires a first frame input.",
        retryable: false
      });
    }

    if (
      request.mode === "first-last-frame-to-video" &&
      (!hasFirstFrameInput(request) || !hasLastFrameInput(request))
    ) {
      throw new AiRoutingError({
        code: "VALIDATION_ERROR",
        message:
          "first-last-frame-to-video requires both first and last frame inputs.",
        retryable: false
      });
    }
  }
}

const hasFirstFrameInput = (request: GenerateVideoRequest): boolean => {
  return Boolean(
    request.firstFrameAssetId ||
      request.firstFrameUri ||
      request.firstFramePath ||
      request.referenceImages?.some((reference) => reference.role === "first-frame")
  );
};

const hasLastFrameInput = (request: GenerateVideoRequest): boolean => {
  return Boolean(
    request.lastFrameAssetId ||
      request.lastFrameUri ||
      request.lastFramePath ||
      request.referenceImages?.some((reference) => reference.role === "last-frame")
  );
};
