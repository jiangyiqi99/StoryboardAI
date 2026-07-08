import { app } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AppConfig,
  AppConfigReadOptions,
  AppConfigSaveRequest,
  AppConfigUpdate,
  GoogleVeoConfig,
  VolcengineSeedanceConfig
} from "@shared/types/app-config";
import { APP_CONFIG_SCHEMA_VERSION } from "@shared/types/app-config";

const REDACTED_SECRET = "********";
const CONFIG_FILE_NAME = "app-config.json";

const numberFromEnv = (name: string): number | undefined => {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const defaultConfig = (): AppConfig => ({
  schemaVersion: APP_CONFIG_SCHEMA_VERSION,
  updatedAt: new Date().toISOString(),
  providers: {
    volcengineSeedance: {
      enabled: false,
      apiKey: process.env.ARK_API_KEY ?? process.env.VOLCENGINE_API_KEY,
      baseUrl:
        process.env.ARK_BASE_URL ??
        process.env.SEEDANCE_BASE_URL ??
        "https://ark.cn-beijing.volces.com/api/v3",
      reqKey:
        process.env.SEEDANCE_MODEL_ID ??
        process.env.ARK_SEEDANCE_MODEL_ID ??
        process.env.SEEDANCE_REQ_KEY ??
        "doubao-seedance-2-0-260128",
      timeoutMs: numberFromEnv("SEEDANCE_TIMEOUT_MS") ?? 60_000,
      pollIntervalMs: numberFromEnv("SEEDANCE_POLL_INTERVAL_MS") ?? 30_000,
      pollTimeoutMs: numberFromEnv("SEEDANCE_POLL_TIMEOUT_MS") ?? 600_000
    },
    googleVeo: {
      enabled: false,
      apiKey: process.env.GOOGLE_API_KEY,
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION ?? "global",
      textImageModel:
        process.env.VEO_TEXT_IMAGE_MODEL ??
        process.env.GOOGLE_VEO_MODEL ??
        "veo-3.0-generate-preview",
      extensionModel: process.env.VEO_EXTENSION_MODEL,
      defaultSampleCount: numberFromEnv("GOOGLE_VEO_SAMPLE_COUNT") ?? 1,
      defaultAspectRatio: process.env.GOOGLE_VEO_ASPECT_RATIO ?? "16:9",
      defaultResolution: process.env.GOOGLE_VEO_RESOLUTION,
      defaultPersonGeneration: process.env.GOOGLE_VEO_PERSON_GENERATION,
      timeoutMs: numberFromEnv("GOOGLE_VEO_TIMEOUT_MS") ?? 60_000,
      pollIntervalMs: numberFromEnv("GOOGLE_VEO_POLL_INTERVAL_MS") ?? 5_000,
      pollTimeoutMs: numberFromEnv("GOOGLE_VEO_POLL_TIMEOUT_MS") ?? 600_000
    }
  }
});

export class LocalAppConfigService {
  readonly configPath: string;

  constructor(configPath = join(app.getPath("userData"), CONFIG_FILE_NAME)) {
    this.configPath = configPath;
  }

  async getConfig(request: AppConfigReadOptions = {}): Promise<AppConfig> {
    const config = await this.readConfig();
    return request.includeSecrets ? config : redactConfig(config);
  }

  async saveConfig(request: AppConfigSaveRequest): Promise<AppConfig> {
    const existing = await this.readConfig();
    const merged = mergeConfig(existing, request.config);
    const next = {
      ...merged,
      schemaVersion: APP_CONFIG_SCHEMA_VERSION,
      updatedAt: new Date().toISOString()
    };

    await this.writeConfig(next);
    return redactConfig(next);
  }

  private async readConfig(): Promise<AppConfig> {
    try {
      const raw = await readFile(this.configPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      return mergeConfig(defaultConfig(), parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return defaultConfig();
      }

      throw error;
    }
  }

  private async writeConfig(config: AppConfig): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    const temporaryPath = `${this.configPath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.configPath);
  }
}

const mergeConfig = (
  base: AppConfig,
  update: Partial<AppConfig> | AppConfigUpdate
): AppConfig => {
  return {
    ...base,
    ...("schemaVersion" in update ? { schemaVersion: update.schemaVersion } : {}),
    providers: {
      volcengineSeedance: mergeVolcengineSeedanceConfig(
        base.providers.volcengineSeedance,
        update.providers?.volcengineSeedance
      ),
      googleVeo: mergeGoogleVeoConfig(
        base.providers.googleVeo,
        update.providers?.googleVeo
      )
    },
    updatedAt:
      "updatedAt" in update && typeof update.updatedAt === "string"
        ? update.updatedAt
        : base.updatedAt
  };
};

const mergeVolcengineSeedanceConfig = (
  base: VolcengineSeedanceConfig,
  update: Partial<VolcengineSeedanceConfig> = {}
): VolcengineSeedanceConfig => {
  return mergeSecretsAware(base, update, [
    "apiKey",
    "accessKeyId",
    "secretAccessKey",
    "sessionToken"
  ]);
};

const mergeGoogleVeoConfig = (
  base: GoogleVeoConfig,
  update: Partial<GoogleVeoConfig> = {}
): GoogleVeoConfig => {
  return mergeSecretsAware(base, update, ["apiKey"]);
};

const mergeSecretsAware = <TConfig extends Record<string, unknown>>(
  base: TConfig,
  update: Partial<TConfig>,
  secretKeys: (keyof TConfig)[]
): TConfig => {
  const merged = { ...base, ...update };
  for (const key of secretKeys) {
    if (update[key] === REDACTED_SECRET) {
      merged[key] = base[key];
    }
  }

  return merged;
};

const redactConfig = (config: AppConfig): AppConfig => ({
  ...config,
  providers: {
    volcengineSeedance: {
      ...config.providers.volcengineSeedance,
      apiKey: redactSecret(config.providers.volcengineSeedance.apiKey),
      accessKeyId: redactSecret(config.providers.volcengineSeedance.accessKeyId),
      secretAccessKey: redactSecret(
        config.providers.volcengineSeedance.secretAccessKey
      ),
      sessionToken: redactSecret(config.providers.volcengineSeedance.sessionToken)
    },
    googleVeo: {
      ...config.providers.googleVeo,
      apiKey: redactSecret(config.providers.googleVeo.apiKey)
    }
  }
});

const redactSecret = (value: string | undefined): string | undefined => {
  return value ? REDACTED_SECRET : undefined;
};
