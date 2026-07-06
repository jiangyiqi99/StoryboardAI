import type { ProviderAdapter } from "@shared/ai-routing";
import { KlingProviderAdapter } from "./klingProvider";
import { LumaProviderAdapter } from "./lumaProvider";
import { MockProviderAdapter } from "./mockProvider";
import { PikaProviderAdapter } from "./pikaProvider";
import { RunwayProviderAdapter } from "./runwayProvider";

export const createDefaultProviderAdapters = (): ProviderAdapter[] => {
  return [
    new MockProviderAdapter(),
    new RunwayProviderAdapter(),
    new KlingProviderAdapter(),
    new LumaProviderAdapter(),
    new PikaProviderAdapter()
  ];
};

export * from "./BaseMockProviderAdapter";
export * from "./klingProvider";
export * from "./lumaProvider";
export * from "./mockProvider";
export * from "./pikaProvider";
export * from "./runwayProvider";
