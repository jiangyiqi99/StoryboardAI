import type {
  GenerateVideoRequest,
  ModelRoutingContext,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderRouteRule,
  SelectedProviderRoute
} from "@shared/ai-routing";
import { AiRoutingError } from "./errors";

export interface MatchedProviderRoute {
  adapter: ProviderAdapter;
  route: SelectedProviderRoute;
}

export class ProviderRouteMatcher {
  selectAdapter(
    request: GenerateVideoRequest,
    adapters: ProviderAdapter[],
    routeRules: ProviderRouteRule[],
    context: ModelRoutingContext
  ): MatchedProviderRoute {
    if (request.providerId) {
      const adapter = adapters.find(
        (candidate) => candidate.providerId === request.providerId
      );
      if (adapter && this.supportsRequest(adapter.getCapabilities(), request)) {
        return {
          adapter,
          route: {
            providerId: adapter.providerId,
            modelId: request.modelId,
            reason: "Explicit providerId matched capabilities."
          }
        };
      }
    }

    const sortedRules = routeRules
      .filter((rule) => rule.enabled)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      const adapter = adapters.find(
        (candidate) => candidate.providerId === rule.providerId
      );
      if (!adapter) {
        continue;
      }

      const capabilities = adapter.getCapabilities();
      if (
        this.ruleMatches(rule, request) &&
        this.supportsRequest(capabilities, request) &&
        adapter.canHandle(context)
      ) {
        return {
          adapter,
          route: {
            ruleId: rule.id,
            providerId: adapter.providerId,
            modelId: request.modelId ?? rule.modelId,
            reason: "Highest-priority route rule matched request and capabilities."
          }
        };
      }
    }

    const fallback = adapters.find((adapter) => {
      const capabilities = adapter.getCapabilities();
      return this.supportsRequest(capabilities, request) && adapter.canHandle(context);
    });

    if (fallback) {
      return {
        adapter: fallback,
        route: {
          providerId: fallback.providerId,
          modelId: request.modelId,
          reason: "Fallback provider matched capabilities."
        }
      };
    }

    throw new AiRoutingError({
      code: "NO_ROUTE",
      message: `No AI provider route can handle mode ${request.mode}.`,
      retryable: false
    });
  }

  private ruleMatches(
    rule: ProviderRouteRule,
    request: GenerateVideoRequest
  ): boolean {
    if (!rule.modes.includes(request.mode)) {
      return false;
    }

    if (rule.aspectRatios && request.aspectRatio) {
      if (!rule.aspectRatios.includes(request.aspectRatio)) {
        return false;
      }
    }

    if (request.durationSec !== undefined) {
      if (rule.minDurationSec !== undefined && request.durationSec < rule.minDurationSec) {
        return false;
      }

      if (rule.maxDurationSec !== undefined && request.durationSec > rule.maxDurationSec) {
        return false;
      }
    }

    if (request.width !== undefined) {
      if (rule.minWidth !== undefined && request.width < rule.minWidth) {
        return false;
      }

      if (rule.maxWidth !== undefined && request.width > rule.maxWidth) {
        return false;
      }
    }

    if (request.height !== undefined) {
      if (rule.minHeight !== undefined && request.height < rule.minHeight) {
        return false;
      }

      if (rule.maxHeight !== undefined && request.height > rule.maxHeight) {
        return false;
      }
    }

    if (rule.fps && request.fps && !rule.fps.includes(request.fps)) {
      return false;
    }

    return true;
  }

  private supportsRequest(
    capabilities: ProviderCapabilities,
    request: GenerateVideoRequest
  ): boolean {
    if (!capabilities.supportedModes.includes(request.mode)) {
      return false;
    }

    if (request.modelId) {
      const model = capabilities.supportedModels.find(
        (candidate) => candidate.modelId === request.modelId
      );
      if (!model || !model.supportedModes.includes(request.mode)) {
        return false;
      }
    }

    if (request.durationSec !== undefined) {
      if (
        capabilities.minDurationSec !== undefined &&
        request.durationSec < capabilities.minDurationSec
      ) {
        return false;
      }

      if (
        capabilities.maxDurationSec !== undefined &&
        request.durationSec > capabilities.maxDurationSec
      ) {
        return false;
      }
    }

    if (
      request.aspectRatio &&
      capabilities.supportedAspectRatios &&
      !capabilities.supportedAspectRatios.includes(request.aspectRatio)
    ) {
      return false;
    }

    if (
      request.fps &&
      capabilities.supportedFps &&
      !capabilities.supportedFps.includes(request.fps)
    ) {
      return false;
    }

    if (request.negativePrompt && !capabilities.supportsNegativePrompt) {
      return false;
    }

    if (request.seed !== undefined && !capabilities.supportsSeed) {
      return false;
    }

    if (request.referenceImages?.length && !capabilities.supportsReferenceImages) {
      return false;
    }

    if (request.firstFrameAssetId && !capabilities.supportsFirstFrame) {
      return false;
    }

    if (request.lastFrameAssetId && !capabilities.supportsLastFrame) {
      return false;
    }

    if (request.inputVideoAssetId && !capabilities.supportsInputVideo) {
      return false;
    }

    if (request.maskAssetId && !capabilities.supportsMask) {
      return false;
    }

    return true;
  }
}
