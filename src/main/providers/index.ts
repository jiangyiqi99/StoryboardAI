import type { ProviderAdapter } from "@shared/ai-routing";
import type { LocalAppConfigService } from "../services/appConfigService";
import { GoogleVeoProviderAdapter } from "./googleVeoProvider";
import { KlingProviderAdapter } from "./klingProvider";
import { LumaProviderAdapter } from "./lumaProvider";
import { MockProviderAdapter } from "./mockProvider";
import { PikaProviderAdapter } from "./pikaProvider";
import { RunwayProviderAdapter } from "./runwayProvider";
import { SeedanceProviderAdapter } from "./seedanceProvider";

export const createDefaultProviderAdapters = (
  appConfig: LocalAppConfigService
): ProviderAdapter[] => {
  return [
    new MockProviderAdapter(),
    new SeedanceProviderAdapter(appConfig),
    new GoogleVeoProviderAdapter(appConfig),
    new RunwayProviderAdapter(),
    new KlingProviderAdapter(),
    new LumaProviderAdapter(),
    new PikaProviderAdapter()
  ];
};

export * from "./BaseMockProviderAdapter";
export * from "./BaseCloudProviderAdapter";
export * from "./googleVeoProvider";
export * from "./klingProvider";
export * from "./lumaProvider";
export * from "./mockProvider";
export * from "./pikaProvider";
export * from "./runwayProvider";
export * from "./seedanceProvider";
