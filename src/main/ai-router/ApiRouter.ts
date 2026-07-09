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
    logAiRouter("generateVideo:start", {
      requestId: requestWithId.requestId,
      providerId: requestWithId.providerId,
      modelId: requestWithId.modelId,
      mode: requestWithId.mode,
      durationSec: requestWithId.durationSec,
      aspectRatio: requestWithId.aspectRatio,
      size: `${requestWithId.width ?? "?"}x${requestWithId.height ?? "?"}`,
      fps: requestWithId.fps,
      metadata: requestWithId.metadata
    });

    try {
      this.validator.validate(requestWithId);
      logAiRouter("generateVideo:validated", {
        requestId: requestWithId.requestId
      });

      const resolvedAssets = await this.assetResolver.resolve(requestWithId);
      logAiRouter("generateVideo:assetsResolved", {
        requestId: requestWithId.requestId,
        resolvedAssets: resolvedAssets.map((asset) => ({
          assetId: asset.assetId,
          role: asset.role,
          hasAbsolutePath: Boolean(asset.absolutePath),
          uriKind: describeUriKind(asset.uri),
          mimeType: asset.mimeType
        }))
      });
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
      logAiRouter("generateVideo:routeSelected", {
        requestId: requestWithId.requestId,
        route,
        adapterClass: adapter.constructor.name,
        providerId: adapter.providerId
      });
      const selectedContext = { ...context, selectedRoute: route };
      const adapterInput = await adapter.mapRequest(requestWithId, selectedContext);
      logAiRouter("generateVideo:adapterMappedRequest", {
        requestId: requestWithId.requestId,
        adapterClass: adapter.constructor.name,
        providerId: adapterInput.providerId,
        providerJobName: adapterInput.providerJobName,
        modelId: adapterInput.modelId,
        mode: adapterInput.mode,
        bodyKeys: Object.keys(adapterInput.body),
        fileCount: adapterInput.files.length,
        bodyPreview: redactLargeValues(adapterInput.body)
      });
      logAiRouter("generateVideo:providerSubmit:start", {
        requestId: requestWithId.requestId,
        adapterClass: adapter.constructor.name,
        providerId: adapter.providerId
      });
      const providerJob = await adapter.submitGeneration(adapterInput);
      logAiRouter("generateVideo:providerSubmit:done", {
        requestId: requestWithId.requestId,
        adapterClass: adapter.constructor.name,
        providerId: providerJob.providerId,
        providerJobId: providerJob.providerJobId,
        status: providerJob.status,
        progress: providerJob.progress,
        outputUri: providerJob.outputUri,
        error: providerJob.error,
        rawResponsePreview: redactLargeValues(providerJob.rawResponse)
      });

      const mappedResponse = adapter.mapResponse(providerJob, requestWithId, route);
      logAiRouter("generateVideo:mappedResponse", {
        requestId: requestWithId.requestId,
        jobId: mappedResponse.jobId,
        providerId: mappedResponse.providerId,
        providerJobId: mappedResponse.providerJobId,
        status: mappedResponse.status,
        outputUri: mappedResponse.outputUri,
        error: mappedResponse.error
      });
      return mappedResponse;
    } catch (error) {
      const info = toRoutingErrorInfo(error);
      logAiRouter("generateVideo:error", {
        requestId: requestWithId.requestId,
        error: info
      });
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
    logAiRouter("getJobStatus:start", request);
    const adapter = this.providerRegistry.get(request.providerId);
    logAiRouter("getJobStatus:provider:start", {
      adapterClass: adapter.constructor.name,
      providerId: adapter.providerId,
      providerJobId: request.providerJobId
    });
    const providerJob = await adapter.getJobStatus(request.providerJobId);
    logAiRouter("getJobStatus:provider:done", {
      adapterClass: adapter.constructor.name,
      providerId: providerJob.providerId,
      providerJobId: providerJob.providerJobId,
      status: providerJob.status,
      progress: providerJob.progress,
      outputUri: providerJob.outputUri,
      error: providerJob.error,
      rawResponsePreview: redactLargeValues(providerJob.rawResponse)
    });

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

const logAiRouter = (stage: string, details: Record<string, unknown>): void => {
  console.log(`[StoryboardAI][ai-router] ${stage}`, details);
};

const describeUriKind = (uri: string): string => {
  if (uri.startsWith("file://")) {
    return "file";
  }

  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    return "http";
  }

  if (uri.startsWith("gs://")) {
    return "gcs";
  }

  return "other";
};

const redactLargeValues = (value: unknown): unknown => {
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => redactLargeValues(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 30)
      .map(([key, item]) => [key, redactLargeValues(item)])
  );
};
