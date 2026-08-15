import type { ProviderRouteRule } from "@shared/ai-routing";

export const DEFAULT_PROVIDER_ROUTE_RULES: ProviderRouteRule[] = [
  {
    id: "seedance-reference-video",
    providerId: "volcengine-seedance",
    priority: 20,
    enabled: true,
    modes: ["reference-to-video"]
  },
  {
    id: "google-veo-boundary-frames",
    providerId: "google-veo",
    priority: 10,
    enabled: true,
    modes: ["text-to-video", "first-frame-to-video", "first-last-frame-to-video"]
  },
  {
    id: "seedance-video",
    providerId: "volcengine-seedance",
    priority: 5,
    enabled: true,
    modes: ["text-to-video", "first-frame-to-video", "first-last-frame-to-video"]
  }
];
