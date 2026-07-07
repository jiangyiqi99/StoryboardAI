import type { AssetMetadata } from "@shared/types/asset";

export type EditorAssetKind = "video" | "audio" | "image";
export type EditorTimelineTrackId =
  | "video-1"
  | "source-audio-1"
  | "voiceover-1"
  | "music-1";

export interface EditorMediaAsset {
  id: string;
  name: string;
  kind: EditorAssetKind;
  absolutePath?: string;
  fileUrl?: string;
  objectUrl?: string;
  thumbnailUrl?: string;
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
  metadata?: AssetMetadata;
  imported: boolean;
  variant?: string;
}

export interface EditorTimelineClip {
  id: string;
  assetId: string;
  trackId: EditorTimelineTrackId;
  timelineStart: number;
  durationSec: number;
  sourceIn: number;
  sourceOut: number;
  linkedClipId?: string;
}

export interface EditorStoryBeat {
  id: string;
  description: string;
  durationSec: number;
}

export interface ImportMediaResult {
  assets: EditorMediaAsset[];
  errors: string[];
}
