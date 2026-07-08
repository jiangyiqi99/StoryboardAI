import type {
  GenerateVideoRequest,
  GenerateVideoResponse,
  ModelRoutingContext,
  ProviderAdapter,
  ProviderAdapterJob,
  ProviderCapabilities,
  SelectedProviderRoute
} from "@shared/ai-routing";
import { AiRoutingError } from "@main/ai-router/errors";

export abstract class BaseCloudProviderAdapter implements ProviderAdapter {
  readonly providerId: string;

  protected constructor(private readonly capabilities: ProviderCapabilities) {
    this.providerId = capabilities.providerId;
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities;
  }

  canHandle(context: ModelRoutingContext): boolean {
    return this.capabilities.supportedModes.includes(context.request.mode);
  }

  async cancelJob(_providerJobId: string): Promise<void> {
    throw new AiRoutingError({
      code: "CANCEL_FAILED",
      message: `${this.capabilities.displayName} does not support cancellation yet.`,
      providerId: this.providerId,
      retryable: false
    });
  }

  mapResponse(
    job: ProviderAdapterJob,
    request: GenerateVideoRequest,
    route: SelectedProviderRoute
  ): GenerateVideoResponse {
    return {
      requestId: request.requestId,
      jobId: `${this.providerId}:${job.providerJobId}`,
      providerId: this.providerId,
      providerJobId: job.providerJobId,
      modelId: route.modelId ?? request.modelId,
      mode: request.mode,
      status: job.status,
      outputUri: job.outputUri,
      progress: job.progress,
      error: job.error,
      route,
      rawProviderResponse: job.rawResponse
    };
  }
}
