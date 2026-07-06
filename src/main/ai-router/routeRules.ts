import type { ProviderRouteRule } from "@shared/ai-routing";

export const DEFAULT_PROVIDER_ROUTE_RULES: ProviderRouteRule[] = [
  {
    id: "mock-default",
    providerId: "mock",
    priority: 10,
    enabled: true,
    modes: [
      "text-to-video",
      "image-to-video",
      "first-frame-to-video",
      "first-last-frame-to-video",
      "video-to-video",
      "replace-range"
    ]
  },
  {
    id: "runway-first-last-frame",
    providerId: "runway",
    priority: 8,
    enabled: true,
    modes: ["first-frame-to-video", "first-last-frame-to-video", "replace-range"],
    maxDurationSec: 10,
    aspectRatios: ["16:9", "9:16", "1:1"]
  },
  {
    id: "kling-image-to-video",
    providerId: "kling",
    priority: 7,
    enabled: true,
    modes: ["image-to-video", "first-frame-to-video"],
    maxDurationSec: 10,
    aspectRatios: ["16:9", "9:16"]
  },
  {
    id: "luma-text-and-image",
    providerId: "luma",
    priority: 6,
    enabled: true,
    modes: ["text-to-video", "image-to-video", "first-frame-to-video"],
    maxDurationSec: 8
  },
  {
    id: "pika-video-to-video",
    providerId: "pika",
    priority: 5,
    enabled: true,
    modes: ["video-to-video", "replace-range"],
    maxDurationSec: 6
  }
];
