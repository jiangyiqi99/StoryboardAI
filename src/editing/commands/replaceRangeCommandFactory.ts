import { randomUUID } from "node:crypto";
import type { ReplaceRangeCommand } from "@shared/types/editing";
import type { TimelineRange, TrackId } from "@shared/types/timeline";

export interface CreateReplaceRangeCommandRequest {
  range: TimelineRange;
  trackId: TrackId;
  generatedAssetId: string;
  affectedClipIds: string[];
}

export const createReplaceRangeCommand = (
  request: CreateReplaceRangeCommandRequest
): ReplaceRangeCommand => {
  return {
    id: `command-${randomUUID()}`,
    type: "REPLACE_RANGE",
    createdAt: new Date().toISOString(),
    label: "Replace selected range",
    range: request.range,
    trackId: request.trackId,
    generatedAssetId: request.generatedAssetId,
    affectedClipIds: request.affectedClipIds
  };
};
