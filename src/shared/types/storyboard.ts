import type { AssetId } from "./asset";

export type StoryboardSegmentId = string;

export type StoryboardSegmentStatus =
  | "draft"
  | "queued"
  | "generating"
  | "generated"
  | "inserted"
  | "failed";

export interface StoryboardReferenceAsset {
  id: string;
  assetId: AssetId;
  kind: "image" | "video";
  label: string;
}

export interface StoryboardSegment {
  id: StoryboardSegmentId;
  index: number;
  storyboardRef?: string;
  storyboardNumber?: number;
  text: string;
  generationMode?: "reference-to-video" | "boundary-frames";
  prompt?: string;
  referenceAssetIds?: string[];
  /** @deprecated Migrated to Project.storyboardReferenceAssets + referenceAssetIds. */
  referenceAssets?: StoryboardReferenceAsset[];
  targetDuration: number;
  status: StoryboardSegmentStatus;
  inputFirstFrameAssetId?: AssetId;
  inputLastFrameAssetId?: AssetId;
  outputAssetId?: AssetId;
  aiJobId?: string;
  timelineStart?: number;
  timelineEnd?: number;
}
