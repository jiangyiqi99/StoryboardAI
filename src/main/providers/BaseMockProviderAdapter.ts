import { randomUUID } from "node:crypto";
import type {
  GenerateVideoRequest,
  GenerateVideoResponse,
  ModelRoutingContext,
  ProviderAdapter,
  ProviderAdapterInput,
  ProviderAdapterJob,
  ProviderCapabilities,
  SelectedProviderRoute
} from "@shared/ai-routing";

export abstract class BaseMockProviderAdapter implements ProviderAdapter {
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

  async mapRequest(
    request: GenerateVideoRequest,
    context: ModelRoutingContext
  ): Promise<ProviderAdapterInput> {
    return {
      providerId: this.providerId,
      providerJobName: `${this.providerId}-${request.mode}`,
      modelId: request.modelId,
      mode: request.mode,
      body: this.mapCommonFields(request, context),
      files: context.resolvedAssets,
      originalRequest: request
    };
  }

  async submitGeneration(input: ProviderAdapterInput): Promise<ProviderAdapterJob> {
    return {
      providerId: this.providerId,
      providerJobId: `${this.providerId}-${randomUUID()}`,
      status: "submitted",
      rawResponse: {
        mock: true,
        provider: this.providerId,
        mappedRequestBody: input.body,
        mappedFiles: input.files
      }
    };
  }

  async getJobStatus(providerJobId: string): Promise<ProviderAdapterJob> {
    return {
      providerId: this.providerId,
      providerJobId,
      status: "running",
      progress: 0.25,
      rawResponse: {
        mock: true,
        provider: this.providerId,
        providerJobId
      }
    };
  }

  async cancelJob(_providerJobId: string): Promise<void> {
    // TODO: call provider-specific cancel endpoint or thin model proxy route.
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

  protected mapCommonFields(
    request: GenerateVideoRequest,
    context: ModelRoutingContext
  ): Record<string, unknown> {
    return {
      prompt: request.prompt,
      negativePrompt: request.negativePrompt,
      durationSec: request.durationSec,
      width: request.width,
      height: request.height,
      fps: request.fps,
      aspectRatio: request.aspectRatio,
      seed: request.seed,
      stylePreset: request.stylePreset,
      cameraMotion: request.cameraMotion,
      mode: request.mode,
      referenceUris: context.resolvedAssets.map((asset) => ({
        role: asset.role,
        uri: asset.uri
      }))
    };
  }
}
