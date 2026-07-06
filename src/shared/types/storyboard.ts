import type { AssetId } from "./asset";

export type StoryboardSegmentId = string;

export type StoryboardSegmentStatus =
  | "draft"
  | "queued"
  | "generating"
  | "generated"
  | "inserted"
  | "failed";

export interface StoryboardSegment {
  id: StoryboardSegmentId;
  index: number;
  text: string;
  prompt?: string;
  targetDuration: number;
  status: StoryboardSegmentStatus;
  inputFirstFrameAssetId?: AssetId;
  inputLastFrameAssetId?: AssetId;
  outputAssetId?: AssetId;
  aiJobId?: string;
  timelineStart?: number;
  timelineEnd?: number;
}
