export const APP_CONFIG_SCHEMA_VERSION = "0.1.0";

export interface VolcengineSeedanceConfig {
  enabled?: boolean;
  alias?: string;
  apiKey?: string;
  baseUrl?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  reqKey?: string;
  apiHost?: string;
  apiVersion?: string;
  region?: string;
  service?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export interface GoogleVeoConfig {
  enabled?: boolean;
  alias?: string;
  apiKey?: string;
  projectId?: string;
  location?: string;
  textImageModel?: string;
  extensionModel?: string;
  outputGcsUri?: string;
  defaultSampleCount?: number;
  defaultAspectRatio?: string;
  defaultResolution?: string;
  defaultPersonGeneration?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export interface AppProviderConfig {
  volcengineSeedance: VolcengineSeedanceConfig;
  googleVeo: GoogleVeoConfig;
}

export interface AppConfig {
  schemaVersion: string;
  updatedAt: string;
  providers: AppProviderConfig;
}

export interface AppConfigGetRequest {}

export interface AppConfigReadOptions {
  includeSecrets?: boolean;
}

export interface AppConfigSaveRequest {
  config: AppConfigUpdate;
}

export interface AppConfigUpdate {
  providers?: {
    volcengineSeedance?: Partial<VolcengineSeedanceConfig>;
    googleVeo?: Partial<GoogleVeoConfig>;
  };
}
