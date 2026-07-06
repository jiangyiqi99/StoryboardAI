import { randomUUID } from "node:crypto";
import type {
  ApiRouter as ApiRouterContract,
  CancelGenerationJobRequest,
  GenerateVideoRequest,
  GenerateVideoResponse,
  GetGenerationJobStatusRequest,
  ModelRoutingContext,
  ProviderAdapter,
  ProviderRouteRule
} from "@shared/ai-routing";
import { AssetReferenceResolver } from "./assetReferenceResolver";
import { toRoutingErrorInfo } from "./errors";
import { AiProviderRegistry } from "./providerRegistry";
import { ProviderRouteMatcher } from "./routeMatcher";
import { DEFAULT_PROVIDER_ROUTE_RULES } from "./routeRules";
import { GenerateVideoRequestValidator } from "./requestValidator";

export interface ApiRouterOptions {
  providers: ProviderAdapter[];
  routeRules?: ProviderRouteRule[];
}

export class ApiRouter implements ApiRouterContract {
  private readonly providerRegistry: AiProviderRegistry;
  private readonly routeRules: ProviderRouteRule[];
  private readonly validator = new GenerateVideoRequestValidator();
  private readonly assetResolver = new AssetReferenceResolver();
  private readonly routeMatcher = new ProviderRouteMatcher();

  constructor(options: ApiRouterOptions) {
    this.providerRegistry = new AiProviderRegistry(options.providers);
    this.routeRules = options.routeRules ?? DEFAULT_PROVIDER_ROUTE_RULES;
  }

  async generateVideo(
    request: GenerateVideoRequest
  ): Promise<GenerateVideoResponse> {
    const requestWithId = {
      ...request,
      requestId: request.requestId ?? `request-${randomUUID()}`
    };

    try {
      this.validator.validate(requestWithId);

      const resolvedAssets = await this.assetResolver.resolve(requestWithId);
      const adapters = this.providerRegistry.list();
      const context: ModelRoutingContext = {
        request: requestWithId,
        routeRules: this.routeRules,
        providerCapabilities: adapters.map((adapter) => adapter.getCapabilities()),
        resolvedAssets
      };

      const { adapter, route } = this.routeMatcher.selectAdapter(
        requestWithId,
        adapters,
        this.routeRules,
        context
      );
      const selectedContext = { ...context, selectedRoute: route };
      const adapterInput = await adapter.mapRequest(requestWithId, selectedContext);
      const providerJob = await adapter.submitGeneration(adapterInput);

      return adapter.mapResponse(providerJob, requestWithId, route);
    } catch (error) {
      const info = toRoutingErrorInfo(error);
      return {
        requestId: requestWithId.requestId,
        jobId: `failed-${randomUUID()}`,
        providerId: requestWithId.providerId ?? "unrouted",
        providerJobId: "unsubmitted",
        modelId: requestWithId.modelId,
        mode: requestWithId.mode,
        status: "failed",
        error: info
      };
    }
  }

  async getJobStatus(
    request: GetGenerationJobStatusRequest
  ): Promise<GenerateVideoResponse> {
    const adapter = this.providerRegistry.get(request.providerId);
    const providerJob = await adapter.getJobStatus(request.providerJobId);

    return {
      jobId: request.jobId,
      providerId: request.providerId,
      providerJobId: request.providerJobId,
      mode: "text-to-video",
      status: providerJob.status,
      outputUri: providerJob.outputUri,
      progress: providerJob.progress,
      rawProviderResponse: providerJob.rawResponse,
      error: providerJob.error
    };
  }

  async cancelJob(
    request: CancelGenerationJobRequest
  ): Promise<GenerateVideoResponse> {
    try {
      const adapter = this.providerRegistry.get(request.providerId);
      await adapter.cancelJob(request.providerJobId);

      return {
        jobId: request.jobId,
        providerId: request.providerId,
        providerJobId: request.providerJobId,
        mode: "text-to-video",
        status: "cancelled"
      };
    } catch (error) {
      return {
        jobId: request.jobId,
        providerId: request.providerId,
        providerJobId: request.providerJobId,
        mode: "text-to-video",
        status: "failed",
        error: {
          ...toRoutingErrorInfo(error),
          code: "CANCEL_FAILED"
        }
      };
    }
  }
}
