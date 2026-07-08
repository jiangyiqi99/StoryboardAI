import { createHash, createHmac } from "node:crypto";
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

const DEFAULT_REQ_KEY = "jimeng_ti2v_v30_pro";
const SEEDANCE_MODES = [
  "text-to-video",
  "first-frame-to-video",
  "first-last-frame-to-video"
] as const;

const ERROR_MESSAGES = new Map<number, string>([
  [10000, "成功"],
  [50411, "输入图片风控未通过"],
  [50511, "输出图片风控未通过"],
  [50412, "输入文本风控未通过"],
  [50512, "输出文本风控未通过"],
  [50413, "输出文本风控未通过"],
  [50516, "输出视频风控未通过"],
  [50517, "输出音频风控未通过"],
  [50518, "输入图片版权风控未通过"],
  [50519, "输出图片版权风控未通过"],
  [50520, "风控内部错误"],
  [50521, "反低俗服务内部错误"],
  [50522, "图片版权服务内部错误"],
  [50429, "API 调用达到限流，请稍后重试"],
  [50430, "API 并发达到限制"],
  [50500, "服务内部错误"],
  [50501, "服务内部 RPC 错误"]
]);

const capabilities: ProviderCapabilities = {
  providerId: "volcengine-seedance",
  displayName: "Volcengine Seedance",
  authMode: "api-key",
  supportedModes: [...SEEDANCE_MODES],
  supportedModels: [
    {
      modelId: DEFAULT_REQ_KEY,
      displayName: "Seedance / Jimeng T2V v3.0 Pro",
      supportedModes: [...SEEDANCE_MODES]
    }
  ],
  supportsNegativePrompt: false,
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
    const reqKey =
      request.modelId ??
      context.selectedRoute?.modelId ??
      config.reqKey ??
      DEFAULT_REQ_KEY;
    const body: Record<string, unknown> = {
      req_key: reqKey,
      prompt: request.prompt
    };

    const imageReferences = await this.resolveImageReferences(request, context);
    if (imageReferences.length > 0) {
      const mappedImages = await Promise.all(
        imageReferences.map((reference) => mapSeedanceImageReference(reference))
      );
      const imageUrls = mappedImages
        .map((image) => image.url)
        .filter((value): value is string => Boolean(value));
      const binaryDataBase64 = mappedImages
        .map((image) => image.binaryDataBase64)
        .filter((value): value is string => Boolean(value));

      if (imageUrls.length > 0) {
        body.image_urls = imageUrls;
      }

      if (binaryDataBase64.length > 0) {
        body.binary_data_base64 = binaryDataBase64;
      }
    }

    if (request.seed !== undefined) {
      body.seed = request.seed;
    }

    if (request.durationSec !== undefined && request.fps !== undefined) {
      body.frames = Math.round(request.durationSec * request.fps);
    }

    if (request.aspectRatio) {
      body.aspect_ratio = request.aspectRatio;
    }

    return {
      providerId: this.providerId,
      providerJobName: `${this.providerId}-${request.mode}`,
      modelId: reqKey,
      mode: request.mode,
      body,
      files: context.resolvedAssets,
      originalRequest: request
    };
  }

  async submitGeneration(input: ProviderAdapterInput): Promise<ProviderAdapterJob> {
    const config = await this.getConfig();
    const client = new SeedanceRestClient(config);
    const result = await client.request("CVSync2AsyncSubmitTask", input.body);
    const taskId = firstStringByKeys(result, ["task_id", "taskId"]);
    if (!taskId) {
      throw new AiRoutingError({
        code: "PROVIDER_ERROR",
        message: "Seedance submit response did not include a task_id.",
        providerId: this.providerId,
        retryable: false,
        details: { response: result }
      });
    }

    const reqKey = stringValue(input.body.req_key) ?? config.reqKey ?? DEFAULT_REQ_KEY;
    return {
      providerId: this.providerId,
      providerJobId: encodeProviderJobId(reqKey, taskId),
      status: "submitted",
      rawResponse: result
    };
  }

  async getJobStatus(providerJobId: string): Promise<ProviderAdapterJob> {
    const config = await this.getConfig();
    const [firstPart, secondPart] = decodeProviderJobId(providerJobId, 2);
    const reqKey = secondPart ? firstPart : config.reqKey ?? DEFAULT_REQ_KEY;
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
    const result = await client.request("CVSync2AsyncGetResult", {
      req_key: reqKey,
      task_id: taskId
    });
    const outputs = await extractVideoOutputs(result, this.providerId);
    const status = parseSeedanceStatus(result, outputs);
    const errorMessage =
      status === "failed"
        ? firstStringByKeys(result, ["message", "error", "error_message"])
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
    if (!config.accessKeyId || !config.secretAccessKey) {
      throw new AiRoutingError({
        code: "PROVIDER_UNAVAILABLE",
        message:
          "Volcengine Seedance credentials are not configured. Set VOLCENGINE_ACCESS_KEY_ID/VOLCENGINE_SECRET_ACCESS_KEY or save them in app config.",
        providerId: this.providerId,
        retryable: false
      });
    }

    return {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      sessionToken: config.sessionToken,
      reqKey: config.reqKey ?? DEFAULT_REQ_KEY,
      apiHost: config.apiHost ?? "visual.volcengineapi.com",
      apiVersion: config.apiVersion ?? "2022-08-31",
      region: config.region ?? "cn-north-1",
      service: config.service ?? "cv",
      timeoutMs: config.timeoutMs ?? 60_000,
      pollIntervalMs: config.pollIntervalMs ?? 5_000,
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
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  reqKey: string;
  apiHost: string;
  apiVersion: string;
  region: string;
  service: string;
  timeoutMs: number;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

interface SeedanceImageReference {
  url?: string;
  binaryDataBase64?: string;
}

class SeedanceRestClient {
  constructor(private readonly config: RequiredSeedanceConfig) {}

  async request(
    action: "CVSync2AsyncSubmitTask" | "CVSync2AsyncGetResult",
    body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const params = {
      Action: action,
      Version: this.config.apiVersion
    };
    const bodyText = JSON.stringify(body);
    const headers = this.signedHeaders("POST", "/", params, bodyText);
    const url = `https://${this.config.apiHost}/?${canonicalQuery(params)}`;
    const response = await fetch(url, {
      method: "POST",
      body: Buffer.from(bodyText, "utf8"),
      headers,
      signal: AbortSignal.timeout(this.config.timeoutMs)
    });
    const responseText = await response.text();
    let payload: Record<string, unknown>;

    try {
      payload = JSON.parse(responseText) as Record<string, unknown>;
    } catch (error) {
      throw new AiRoutingError({
        code: "PROVIDER_ERROR",
        message: `Seedance returned non-JSON content, HTTP ${response.status}.`,
        providerId: capabilities.providerId,
        retryable: response.status >= 500,
        details: { httpStatus: response.status, text: responseText.slice(0, 1000) }
      });
    }

    const code = numberValue(payload.code);
    if (response.status >= 400 && code === undefined) {
      throw new AiRoutingError({
        code: "PROVIDER_ERROR",
        message: `Seedance HTTP ${response.status}: ${responseText.slice(0, 300)}`,
        providerId: capabilities.providerId,
        retryable: response.status >= 500,
        details: { httpStatus: response.status, response: payload }
      });
    }

    if (code !== 10000) {
      const friendly = code === undefined ? undefined : ERROR_MESSAGES.get(code);
      const providerMessage = stringValue(payload.message);
      throw new AiRoutingError({
        code: code === 50429 || code === 50430 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_ERROR",
        message:
          friendly && providerMessage && !providerMessage.includes(friendly)
            ? `${friendly}: ${providerMessage}`
            : friendly ?? providerMessage ?? "Seedance provider returned an error.",
        providerId: capabilities.providerId,
        retryable: code === 50429 || code === 50430 || response.status >= 500,
        details: { httpStatus: response.status, response: payload }
      });
    }

    return payload;
  }

  private signedHeaders(
    method: string,
    path: string,
    queryParams: Record<string, string>,
    bodyText: string
  ): Record<string, string> {
    const now = new Date();
    const xDate = formatAmzDate(now);
    const shortDate = xDate.slice(0, 8);
    const payloadHash = sha256Hex(bodyText);
    const headerItems: [string, string][] = [
      ["content-type", "application/json"],
      ["host", this.config.apiHost],
      ["x-content-sha256", payloadHash],
      ["x-date", xDate]
    ];

    if (this.config.sessionToken) {
      headerItems.push(["x-security-token", this.config.sessionToken]);
    }

    headerItems.sort(([left], [right]) => left.localeCompare(right));
    const canonicalHeaders = headerItems
      .map(([key, value]) => `${key}:${value}\n`)
      .join("");
    const signedHeaders = headerItems.map(([key]) => key).join(";");
    const canonicalRequest = [
      method,
      path,
      canonicalQuery(queryParams),
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join("\n");
    const credentialScope = `${shortDate}/${this.config.region}/${this.config.service}/request`;
    const stringToSign = [
      "HMAC-SHA256",
      xDate,
      credentialScope,
      sha256Hex(canonicalRequest)
    ].join("\n");
    const signature = hmacHex(
      this.signingKey(shortDate),
      Buffer.from(stringToSign, "utf8")
    );
    const authorization =
      `HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const headers: Record<string, string> = {
      Authorization: authorization,
      "Content-Type": "application/json",
      Host: this.config.apiHost,
      "X-Content-Sha256": payloadHash,
      "X-Date": xDate
    };

    if (this.config.sessionToken) {
      headers["X-Security-Token"] = this.config.sessionToken;
    }

    return headers;
  }

  private signingKey(shortDate: string): Buffer {
    const dateKey = hmacDigest(
      Buffer.from(this.config.secretAccessKey, "utf8"),
      shortDate
    );
    const regionKey = hmacDigest(dateKey, this.config.region);
    const serviceKey = hmacDigest(regionKey, this.config.service);
    return hmacDigest(serviceKey, "request");
  }
}

const mapSeedanceImageReference = async (
  reference: ResolvedAssetReference
): Promise<SeedanceImageReference> => {
  if (isRemoteHttpUri(reference.uri)) {
    return { url: reference.uri };
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

  return { binaryDataBase64: media.bytesBase64Encoded };
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

  if (status && ["failed", "fail", "error", "cancelled", "canceled"].includes(status)) {
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

  if (status && ["queued", "pending", "submitted"].includes(status)) {
    return "submitted";
  }

  return "running";
};

const canonicalQuery = (params: Record<string, string>): string => {
  return Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
};

const encodeRfc3986 = (value: string): string => {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
};

const formatAmzDate = (date: Date): string => {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
};

const sha256Hex = (value: string): string => {
  return createHash("sha256").update(value, "utf8").digest("hex");
};

const hmacDigest = (key: Buffer, value: string): Buffer => {
  return createHmac("sha256", key).update(value, "utf8").digest();
};

const hmacHex = (key: Buffer, value: Buffer): string => {
  return createHmac("sha256", key).update(value).digest("hex");
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

const numberValue = (value: unknown): number | undefined => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};
