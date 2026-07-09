import type {
  GenerateVideoRequest,
  GenerationJobStatus,
  ModelRoutingContext,
  ProviderAdapterInput,
  ProviderAdapterJob,
  ProviderCapabilities,
  ResolvedAssetReference
} from "@shared/ai-routing";
import type { VolcengineSeedanceConfig } from "@shared/types/app-config";
import { AiRoutingError } from "@main/ai-router/errors";
import type { LocalAppConfigService } from "../services/appConfigService";
import { BaseCloudProviderAdapter } from "./BaseCloudProviderAdapter";
import { extractVideoOutputs } from "./videoOutput";
import { decodeProviderJobId, encodeProviderJobId } from "./providerJobId";
import {
  isGcsUri,
  isRemoteHttpUri,
  loadMediaReference
} from "./mediaReference";

const DEFAULT_REQ_KEY = "doubao-seedance-2-0-260128";
const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const SEEDANCE_MODES = [
  "text-to-video",
  "first-frame-to-video",
  "first-last-frame-to-video"
] as const;

const capabilities: ProviderCapabilities = {
  providerId: "volcengine-seedance",
  displayName: "Volcengine Ark Seedance",
  authMode: "bearer-token",
  supportedModes: [...SEEDANCE_MODES],
  supportedModels: [
    {
      modelId: DEFAULT_REQ_KEY,
      displayName: "Doubao Seedance 2.0",
      supportedModes: [...SEEDANCE_MODES]
    }
  ],
  supportsNegativePrompt: false,
  supportsSeed: false,
  supportsStylePreset: false,
  supportsCameraMotion: false,
  supportsReferenceImages: false,
  supportsFirstFrame: true,
  supportsLastFrame: true,
  supportsInputVideo: false,
  supportsMask: false,
  supportsPolling: true,
  supportsCancel: false,
  minDurationSec: 4,
  maxDurationSec: 15,
  supportedAspectRatios: [
    "16:9",
    "4:3",
    "1:1",
    "3:4",
    "9:16",
    "21:9",
    "adaptive"
  ],
  supportedFps: [24, 30]
};

export class SeedanceProviderAdapter extends BaseCloudProviderAdapter {
  constructor(private readonly appConfig: LocalAppConfigService) {
    super(capabilities);
  }

  async mapRequest(
    request: GenerateVideoRequest,
    context: ModelRoutingContext
  ): Promise<ProviderAdapterInput> {
    const config = await this.getConfig();
    const modelId =
      request.modelId ??
      context.selectedRoute?.modelId ??
      config.reqKey ??
      DEFAULT_REQ_KEY;
    const body: Record<string, unknown> = {
      model: modelId,
      content: [
        {
          type: "text",
          text: request.prompt
        }
      ]
    };

    const imageReferences = await this.resolveImageReferences(request, context);
    if (imageReferences.length > 0) {
      const content = body.content as ArkContentPart[];
      content.push(
        ...(await Promise.all(
          imageReferences.map((reference) => mapSeedanceImageReference(reference))
        ))
      );
    }

    if (request.seed !== undefined && modelSupportsSeed(modelId)) {
      body.seed = request.seed;
    }

    if (request.durationSec !== undefined) {
      body.duration = Math.max(1, Math.round(request.durationSec));
    } else if (request.fps !== undefined) {
      body.framespersecond = request.fps;
    }

    if (request.aspectRatio) {
      body.ratio = request.aspectRatio;
    }

    return {
      providerId: this.providerId,
      providerJobName: `${this.providerId}-${request.mode}`,
      modelId,
      mode: request.mode,
      body,
      files: context.resolvedAssets,
      originalRequest: request
    };
  }

  async submitGeneration(input: ProviderAdapterInput): Promise<ProviderAdapterJob> {
    const config = await this.getConfig();
    const client = new SeedanceRestClient(config);
    logSeedance("submitGeneration:start", {
      modelId: input.modelId,
      mode: input.mode,
      bodyKeys: Object.keys(input.body),
      fileCount: input.files.length
    });
    const result = await client.createTask(input.body);
    const taskId = firstStringByKeys(result, ["id", "task_id", "taskId"]);
    if (!taskId) {
      throw new AiRoutingError({
        code: "PROVIDER_ERROR",
        message: "Seedance submit response did not include a task id.",
        providerId: this.providerId,
        retryable: false,
        details: { response: result }
      });
    }

    const modelId = stringValue(input.body.model) ?? config.reqKey ?? DEFAULT_REQ_KEY;
    logSeedance("submitGeneration:taskCreated", {
      modelId,
      taskId,
      rawResponsePreview: compactLogValue(result)
    });
    return {
      providerId: this.providerId,
      providerJobId: encodeProviderJobId(modelId, taskId),
      status: "submitted",
      rawResponse: result
    };
  }

  async getJobStatus(providerJobId: string): Promise<ProviderAdapterJob> {
    const config = await this.getConfig();
    const [firstPart, secondPart] = decodeProviderJobId(providerJobId, 2);
    const taskId = secondPart ?? firstPart;
    if (!taskId) {
      throw new AiRoutingError({
        code: "VALIDATION_ERROR",
        message: "Seedance providerJobId is empty.",
        providerId: this.providerId,
        retryable: false
      });
    }

    const client = new SeedanceRestClient(config);
    const result = await client.getTask(taskId);
    const outputs = await extractVideoOutputs(result, this.providerId);
    const status = parseSeedanceStatus(result, outputs);
    const errorMessage =
      status === "failed"
        ? firstStringByKeys(result, ["message", "error", "error_message", "code"])
        : undefined;

    return {
      providerId: this.providerId,
      providerJobId,
      status,
      outputUri: outputs[0],
      progress: firstNumberByKeys(result, ["progress", "percent"]),
      rawResponse: result,
      error: errorMessage
        ? {
            code: "PROVIDER_ERROR",
            message: errorMessage,
            providerId: this.providerId,
            retryable: false
          }
        : undefined
    };
  }

  private async getConfig(): Promise<RequiredSeedanceConfig> {
    const config = (await this.appConfig.getConfig({ includeSecrets: true }))
      .providers.volcengineSeedance;
    if (!config.apiKey) {
      throw new AiRoutingError({
        code: "PROVIDER_UNAVAILABLE",
        message:
          "Volcengine Ark Seedance API key is not configured. Set ARK_API_KEY or save it in app config.",
        providerId: this.providerId,
        retryable: false
      });
    }

    return {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      reqKey: config.reqKey ?? DEFAULT_REQ_KEY,
      timeoutMs: config.timeoutMs ?? 60_000,
      pollIntervalMs: config.pollIntervalMs ?? 30_000,
      pollTimeoutMs: config.pollTimeoutMs ?? 600_000
    };
  }

  private async resolveImageReferences(
    request: GenerateVideoRequest,
    context: ModelRoutingContext
  ): Promise<ResolvedAssetReference[]> {
    if (request.mode === "text-to-video") {
      return [];
    }

    const firstFrame = context.resolvedAssets.find(
      (asset) => asset.role === "first-frame"
    );
    const lastFrame = context.resolvedAssets.find(
      (asset) => asset.role === "last-frame"
    );

    if (request.mode === "first-frame-to-video") {
      if (!firstFrame) {
        throw new AiRoutingError({
          code: "VALIDATION_ERROR",
          message: "Seedance first-frame generation requires a first frame.",
          providerId: this.providerId,
          retryable: false
        });
      }
      return [firstFrame];
    }

    if (!firstFrame || !lastFrame) {
      throw new AiRoutingError({
        code: "VALIDATION_ERROR",
        message: "Seedance first-last-frame generation requires both frames.",
        providerId: this.providerId,
        retryable: false
      });
    }

    return [firstFrame, lastFrame];
  }
}

interface RequiredSeedanceConfig {
  apiKey: string;
  baseUrl: string;
  reqKey: string;
  timeoutMs: number;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

interface ArkContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
  };
  role?: "reference_image";
}

class SeedanceRestClient {
  constructor(private readonly config: RequiredSeedanceConfig) {}

  async createTask(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("POST", "contents/generations/tasks", body);
  }

  async getTask(taskId: string): Promise<Record<string, unknown>> {
    return this.request(
      "GET",
      `contents/generations/tasks/${encodeURIComponent(taskId)}`
    );
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const bodyText = body ? JSON.stringify(body) : undefined;
    const url = this.url(path);
    const shouldLogHttp = method !== "GET";
    if (shouldLogHttp) {
      logSeedance("http:start", {
        method,
        url,
        bodyBytes: bodyText ? Buffer.byteLength(bodyText, "utf8") : 0
      });
    }
    const response = await fetch(url, {
      method,
      body: bodyText ? Buffer.from(bodyText, "utf8") : undefined,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json"
      },
      signal: AbortSignal.timeout(this.config.timeoutMs)
    });
    const responseText = await response.text();
    if (shouldLogHttp) {
      logSeedance("http:response", {
        method,
        url,
        httpStatus: response.status,
        ok: response.ok,
        responseBytes: Buffer.byteLength(responseText, "utf8")
      });
    }
    const payload = parseJsonResponse(responseText, response.status);

    if (response.status >= 400) {
      const providerMessage = arkErrorMessage(payload, `Seedance HTTP ${response.status}`);
      throw new AiRoutingError({
        code: response.status === 429 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_ERROR",
        message: normalizeSeedanceErrorMessage(providerMessage),
        providerId: capabilities.providerId,
        retryable: response.status === 429 || response.status >= 500,
        details: {
          httpStatus: response.status,
          response: payload,
          reason: seedanceErrorReason(providerMessage)
        }
      });
    }

    if (payload.error) {
      const providerMessage = arkErrorMessage(
        payload,
        "Seedance provider returned an error."
      );
      throw new AiRoutingError({
        code: "PROVIDER_ERROR",
        message: normalizeSeedanceErrorMessage(providerMessage),
        providerId: capabilities.providerId,
        retryable: false,
        details: {
          httpStatus: response.status,
          response: payload,
          reason: seedanceErrorReason(providerMessage)
        }
      });
    }

    return payload;
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  }
}

const parseJsonResponse = (
  responseText: string,
  httpStatus: number
): Record<string, unknown> => {
  try {
    return JSON.parse(responseText) as Record<string, unknown>;
  } catch (error) {
    throw new AiRoutingError({
      code: "PROVIDER_ERROR",
      message: `Seedance returned non-JSON content, HTTP ${httpStatus}.`,
      providerId: capabilities.providerId,
      retryable: httpStatus >= 500,
      details: { httpStatus, text: responseText.slice(0, 1000) }
    });
  }
};

const arkErrorMessage = (
  payload: Record<string, unknown>,
  fallback: string
): string => {
  const error = payload.error;
  if (error && typeof error === "object") {
    return (
      firstStringByKeys(error, ["message", "code", "type"]) ??
      firstStringByKeys(payload, ["message", "error_message"]) ??
      fallback
    );
  }

  return firstStringByKeys(payload, ["message", "error_message"]) ?? fallback;
};

const seedanceErrorReason = (message: string): string | undefined => {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("input image") &&
    normalized.includes("real person")
  ) {
    return "INPUT_IMAGE_MAY_CONTAIN_REAL_PERSON";
  }

  return undefined;
};

const normalizeSeedanceErrorMessage = (message: string): string => {
  if (seedanceErrorReason(message) === "INPUT_IMAGE_MAY_CONTAIN_REAL_PERSON") {
    return "Seedance 拒绝了首帧参考图：图片可能包含真人，无法用于 image-to-video / first-frame-to-video。上一段视频已生成成功，但下一段连续生成被 provider 拦截。";
  }

  return message;
};

const logSeedance = (stage: string, details: Record<string, unknown>): void => {
  console.log(`[StoryboardAI][provider:seedance] ${stage}`, details);
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

const mapSeedanceImageReference = async (
  reference: ResolvedAssetReference
): Promise<ArkContentPart> => {
  if (isRemoteHttpUri(reference.uri)) {
    return arkImagePart(reference.uri);
  }

  if (isGcsUri(reference.uri)) {
    throw new AiRoutingError({
      code: "VALIDATION_ERROR",
      message:
        "Seedance image inputs must be HTTP(S) URLs or local files; gs:// inputs are only passed through for Google Veo.",
      providerId: capabilities.providerId,
      retryable: false
    });
  }

  const media = await loadMediaReference(reference);
  if (!media.bytesBase64Encoded) {
    throw new AiRoutingError({
      code: "VALIDATION_ERROR",
      message: `Seedance image reference ${reference.assetId} did not resolve to uploadable bytes.`,
      providerId: capabilities.providerId,
      retryable: false
    });
  }

  return arkImagePart(`data:${media.mimeType};base64,${media.bytesBase64Encoded}`);
};

const arkImagePart = (url: string): ArkContentPart => ({
  type: "image_url",
  image_url: { url },
  role: "reference_image"
});

const modelSupportsSeed = (modelId: string): boolean => {
  return !modelId.toLowerCase().includes("seedance-2-0");
};

const parseSeedanceStatus = (
  result: Record<string, unknown>,
  outputs: string[]
): GenerationJobStatus => {
  const status = firstStringByKeys(result, [
    "status",
    "state",
    "task_status",
    "taskStatus"
  ])?.toLowerCase();

  if (
    status &&
    ["failed", "fail", "error", "expired", "cancelled", "canceled"].includes(status)
  ) {
    return status === "cancelled" || status === "canceled" ? "cancelled" : "failed";
  }

  if (outputs.length > 0) {
    return "succeeded";
  }

  if (
    status &&
    ["success", "succeeded", "done", "completed", "complete"].includes(status)
  ) {
    return "succeeded";
  }

  if (status === "queued") {
    return "queued";
  }

  if (status && ["pending", "submitted"].includes(status)) {
    return "submitted";
  }

  return "running";
};

const firstStringByKeys = (
  value: unknown,
  keys: string[]
): string | undefined => {
  const found = firstValueByKeys(value, keys);
  return typeof found === "string" ? found : undefined;
};

const firstNumberByKeys = (
  value: unknown,
  keys: string[]
): number | undefined => {
  const found = firstValueByKeys(value, keys);
  return typeof found === "number" ? found : undefined;
};

const firstValueByKeys = (value: unknown, keys: string[]): unknown => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstValueByKeys(item, keys);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key];
    }
  }

  for (const item of Object.values(record)) {
    const found = firstValueByKeys(item, keys);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
};

const stringValue = (value: unknown): string | undefined => {
  return typeof value === "string" ? value : undefined;
};
