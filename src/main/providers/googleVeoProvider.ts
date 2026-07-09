import { randomUUID } from "node:crypto";
import type {
  GenerateVideoRequest,
  ModelRoutingContext,
  ProviderAdapterInput,
  ProviderAdapterJob,
  ProviderCapabilities,
  ResolvedAssetReference
} from "@shared/ai-routing";
import type { GoogleVeoConfig } from "@shared/types/app-config";
import { AiRoutingError } from "@main/ai-router/errors";
import type { LocalAppConfigService } from "../services/appConfigService";
import { BaseCloudProviderAdapter } from "./BaseCloudProviderAdapter";
import { loadMediaReference } from "./mediaReference";
import { decodeProviderJobId, encodeProviderJobId } from "./providerJobId";
import { extractVideoOutputs } from "./videoOutput";

const DEFAULT_TEXT_IMAGE_MODEL = "veo-3.0-generate-preview";
const CONFIGURED_MODEL_ID = "veo-configured";
const VEO_MODES = [
  "text-to-video",
  "first-frame-to-video",
  "first-last-frame-to-video"
] as const;

const capabilities: ProviderCapabilities = {
  providerId: "google-veo",
  displayName: "Google Veo",
  authMode: "api-key",
  supportedModes: [...VEO_MODES],
  supportedModels: [
    {
      modelId: CONFIGURED_MODEL_ID,
      displayName: "Configured Veo Text/Image Model",
      supportedModes: [...VEO_MODES]
    },
    {
      modelId: DEFAULT_TEXT_IMAGE_MODEL,
      displayName: "Veo 3.0 Generate Preview",
      supportedModes: [...VEO_MODES]
    },
    {
      modelId: "veo-2.0-generate-001",
      displayName: "Veo 2.0 Generate",
      supportedModes: [...VEO_MODES]
    }
  ],
  supportsNegativePrompt: true,
  supportsSeed: true,
  supportsStylePreset: false,
  supportsCameraMotion: false,
  supportsReferenceImages: false,
  supportsFirstFrame: true,
  supportsLastFrame: true,
  supportsInputVideo: false,
  supportsMask: false,
  supportsPolling: true,
  supportsCancel: false,
  minDurationSec: 1,
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
  supportedFps: [24]
};

export class GoogleVeoProviderAdapter extends BaseCloudProviderAdapter {
  constructor(private readonly appConfig: LocalAppConfigService) {
    super(capabilities);
  }

  async mapRequest(
    request: GenerateVideoRequest,
    context: ModelRoutingContext
  ): Promise<ProviderAdapterInput> {
    const config = await this.getConfig();
    const modelId = resolveModelId(
      request.modelId ?? context.selectedRoute?.modelId,
      config
    );
    const instance = await this.mapInstance(request, context);
    const parameters = compactObject({
      sampleCount:
        numberMetadata(request, "sampleCount") ?? config.defaultSampleCount ?? 1,
      aspectRatio:
        request.aspectRatio ??
        stringMetadata(request, "aspectRatio") ??
        config.defaultAspectRatio ??
        "16:9",
      durationSeconds: request.durationSec,
      resolution: stringMetadata(request, "resolution") ?? config.defaultResolution,
      negativePrompt: request.negativePrompt,
      seed: request.seed,
      personGeneration:
        stringMetadata(request, "personGeneration") ??
        config.defaultPersonGeneration
    });

    return {
      providerId: this.providerId,
      providerJobName: `${this.providerId}-${request.mode}`,
      modelId,
      mode: request.mode,
      body: {
        instances: [instance],
        parameters
      },
      files: context.resolvedAssets,
      originalRequest: request
    };
  }

  async submitGeneration(input: ProviderAdapterInput): Promise<ProviderAdapterJob> {
    const config = await this.getConfig();
    const client = new GoogleVeoRestClient(config);
    const modelId = input.modelId ?? config.textImageModel;
    logGoogleVeo("submitGeneration:start", {
      modelId,
      mode: input.mode,
      bodyKeys: Object.keys(input.body),
      fileCount: input.files.length
    });
    const result = await client.post(modelId, "predictLongRunning", input.body);
    const operationName = stringValue(result.name);

    if (operationName) {
      logGoogleVeo("submitGeneration:operationCreated", {
        modelId,
        operationName,
        rawResponsePreview: compactLogValue(result)
      });
      return {
        providerId: this.providerId,
        providerJobId: encodeProviderJobId(modelId, operationName),
        status: "submitted",
        rawResponse: result
      };
    }

    const outputs = await extractGoogleVeoByteOutputs(result);
    logGoogleVeo("submitGeneration:directOutput", {
      modelId,
      outputCount: outputs.length,
      outputUri: outputs[0],
      rawResponsePreview: compactLogValue(result)
    });
    return {
      providerId: this.providerId,
      providerJobId: encodeProviderJobId(modelId, `direct-${randomUUID()}`),
      status: outputs.length > 0 ? "succeeded" : "unknown",
      outputUri: outputs[0],
      rawResponse: result
    };
  }

  async getJobStatus(providerJobId: string): Promise<ProviderAdapterJob> {
    const config = await this.getConfig();
    const [firstPart, secondPart] = decodeProviderJobId(providerJobId, 2);
    const modelId = secondPart ? firstPart : config.textImageModel;
    const operationName = secondPart ?? firstPart;
    if (!operationName) {
      throw new AiRoutingError({
        code: "VALIDATION_ERROR",
        message: "Google Veo providerJobId is empty.",
        providerId: this.providerId,
        retryable: false
      });
    }

    const client = new GoogleVeoRestClient(config);
    const result = await client.post(modelId, "fetchPredictOperation", {
      operationName
    });

    if (!result.done) {
      return {
        providerId: this.providerId,
        providerJobId,
        status: "running",
        rawResponse: result
      };
    }

    if (result.error) {
      return {
        providerId: this.providerId,
        providerJobId,
        status: "failed",
        rawResponse: result,
        error: {
          code: "PROVIDER_ERROR",
          message: stringifyProviderError(result.error),
          providerId: this.providerId,
          retryable: false
        }
      };
    }

    const outputs = await extractGoogleVeoByteOutputs(result);
    return {
      providerId: this.providerId,
      providerJobId,
      status: "succeeded",
      outputUri: outputs[0],
      rawResponse: result
    };
  }

  private async mapInstance(
    request: GenerateVideoRequest,
    context: ModelRoutingContext
  ): Promise<Record<string, unknown>> {
    if (request.mode === "text-to-video") {
      return { prompt: request.prompt };
    }

    const firstFrame = context.resolvedAssets.find(
      (asset) => asset.role === "first-frame"
    );
    if (!firstFrame) {
      throw new AiRoutingError({
        code: "VALIDATION_ERROR",
        message: "Google Veo image generation requires a first frame.",
        providerId: this.providerId,
        retryable: false
      });
    }

    const instance: Record<string, unknown> = {
      prompt: request.prompt,
      image: await mapVeoMedia(firstFrame)
    };

    if (request.mode === "first-last-frame-to-video") {
      const lastFrame = context.resolvedAssets.find(
        (asset) => asset.role === "last-frame"
      );
      if (!lastFrame) {
        throw new AiRoutingError({
          code: "VALIDATION_ERROR",
          message: "Google Veo first-last-frame generation requires a last frame.",
          providerId: this.providerId,
          retryable: false
        });
      }

      instance.lastFrame = await mapVeoMedia(lastFrame);
    }

    return instance;
  }

  private async getConfig(): Promise<RequiredGoogleVeoConfig> {
    const config = (await this.appConfig.getConfig({ includeSecrets: true }))
      .providers.googleVeo;
    if (!config.apiKey || !config.projectId) {
      throw new AiRoutingError({
        code: "PROVIDER_UNAVAILABLE",
        message:
          "Google Veo REST config is not complete. Set GOOGLE_API_KEY/GOOGLE_CLOUD_PROJECT or save them in app config.",
        providerId: this.providerId,
        retryable: false
      });
    }

    return {
      apiKey: config.apiKey,
      projectId: config.projectId,
      location: config.location ?? "global",
      textImageModel: config.textImageModel ?? DEFAULT_TEXT_IMAGE_MODEL,
      extensionModel: config.extensionModel,
      defaultSampleCount: config.defaultSampleCount ?? 1,
      defaultAspectRatio: config.defaultAspectRatio ?? "16:9",
      defaultResolution: config.defaultResolution,
      defaultPersonGeneration: config.defaultPersonGeneration,
      timeoutMs: config.timeoutMs ?? 60_000,
      pollIntervalMs: config.pollIntervalMs ?? 5_000,
      pollTimeoutMs: config.pollTimeoutMs ?? 600_000
    };
  }
}

interface RequiredGoogleVeoConfig {
  apiKey: string;
  projectId: string;
  location: string;
  textImageModel: string;
  extensionModel?: string;
  defaultSampleCount: number;
  defaultAspectRatio: string;
  defaultResolution?: string;
  defaultPersonGeneration?: string;
  timeoutMs: number;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

class GoogleVeoRestClient {
  constructor(private readonly config: RequiredGoogleVeoConfig) {}

  async post(
    modelId: string,
    method: "predictLongRunning" | "fetchPredictOperation",
    body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl()}/${this.modelPath(modelId)}:${method}`);
    url.searchParams.set("key", this.config.apiKey);
    const shouldLogHttp = method !== "fetchPredictOperation";
    if (shouldLogHttp) {
      logGoogleVeo("http:start", {
        method: "POST",
        url: redactGoogleApiKey(url),
        bodyBytes: Buffer.byteLength(JSON.stringify(body), "utf8")
      });
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs)
    });
    const responseText = await response.text();
    if (shouldLogHttp) {
      logGoogleVeo("http:response", {
        method: "POST",
        url: redactGoogleApiKey(url),
        httpStatus: response.status,
        ok: response.ok,
        responseBytes: Buffer.byteLength(responseText, "utf8")
      });
    }
    let payload: Record<string, unknown>;

    try {
      payload = JSON.parse(responseText) as Record<string, unknown>;
    } catch (error) {
      throw new AiRoutingError({
        code: "PROVIDER_ERROR",
        message: `Google Veo returned non-JSON content, HTTP ${response.status}.`,
        providerId: capabilities.providerId,
        retryable: response.status >= 500,
        details: { httpStatus: response.status, text: responseText.slice(0, 1000) }
      });
    }

    if (!response.ok) {
      throw new AiRoutingError({
        code: response.status === 429 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_ERROR",
        message: `Google Veo HTTP ${response.status}: ${responseText.slice(0, 300)}`,
        providerId: capabilities.providerId,
        retryable: response.status === 429 || response.status >= 500,
        details: { httpStatus: response.status, response: payload }
      });
    }

    return payload;
  }

  private baseUrl(): string {
    if (this.config.location === "global") {
      return "https://aiplatform.googleapis.com/v1";
    }

    return `https://${this.config.location}-aiplatform.googleapis.com/v1`;
  }

  private modelPath(modelId: string): string {
    return [
      "projects",
      encodeURIComponent(this.config.projectId),
      "locations",
      encodeURIComponent(this.config.location),
      "publishers",
      "google",
      "models",
      encodeURIComponent(modelId)
    ].join("/");
  }
}

const mapVeoMedia = async (
  reference: ResolvedAssetReference
): Promise<Record<string, unknown>> => {
  const media = await loadMediaReference(reference);
  if (media.gcsUri) {
    return {
      gcsUri: media.gcsUri,
      mimeType: media.mimeType
    };
  }

  if (!media.bytesBase64Encoded) {
    throw new AiRoutingError({
      code: "VALIDATION_ERROR",
      message: `Google Veo media reference ${reference.assetId} did not resolve to uploadable bytes.`,
      providerId: capabilities.providerId,
      retryable: false
    });
  }

  return {
    bytesBase64Encoded: media.bytesBase64Encoded,
    mimeType: media.mimeType
  };
};

const extractGoogleVeoByteOutputs = async (
  result: Record<string, unknown>
): Promise<string[]> => {
  return extractVideoOutputs(result, capabilities.providerId, {
    includeUriOutputs: false
  });
};

const resolveModelId = (
  requestedModelId: string | undefined,
  config: RequiredGoogleVeoConfig
): string => {
  if (!requestedModelId || requestedModelId === CONFIGURED_MODEL_ID) {
    return config.textImageModel;
  }

  return requestedModelId;
};

const compactObject = (
  record: Record<string, unknown>
): Record<string, unknown> => {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  );
};

const stringMetadata = (
  request: GenerateVideoRequest,
  key: string
): string | undefined => {
  const value = request.metadata?.[key];
  return typeof value === "string" && value ? value : undefined;
};

const numberMetadata = (
  request: GenerateVideoRequest,
  key: string
): number | undefined => {
  const value = request.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const stringValue = (value: unknown): string | undefined => {
  return typeof value === "string" ? value : undefined;
};

const logGoogleVeo = (stage: string, details: Record<string, unknown>): void => {
  console.log(`[StoryboardAI][provider:google-veo] ${stage}`, details);
};

const redactGoogleApiKey = (url: URL): string => {
  const redacted = new URL(url.toString());
  if (redacted.searchParams.has("key")) {
    redacted.searchParams.set("key", "[redacted]");
  }

  return redacted.toString();
};

const compactLogValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => compactLogValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 30)
      .map(([key, item]) => [key, compactLogValue(item)])
  );
};

const stringifyProviderError = (error: unknown): string => {
  if (!error || typeof error !== "object") {
    return String(error);
  }

  const record = error as Record<string, unknown>;
  return (
    stringValue(record.message) ??
    stringValue(record.status) ??
    JSON.stringify(error)
  );
};
