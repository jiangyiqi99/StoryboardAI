import type { ProviderAdapter } from "@shared/ai-routing";
import type { LocalAppConfigService } from "../services/appConfigService";
import { GoogleVeoProviderAdapter } from "./googleVeoProvider";
import { SeedanceProviderAdapter } from "./seedanceProvider";

export const createDefaultProviderAdapters = (
  appConfig: LocalAppConfigService
): ProviderAdapter[] => {
  return [
    new SeedanceProviderAdapter(appConfig),
    new GoogleVeoProviderAdapter(appConfig)
  ];
};

export * from "./BaseCloudProviderAdapter";
export * from "./googleVeoProvider";
export * from "./seedanceProvider";
