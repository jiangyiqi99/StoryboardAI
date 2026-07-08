import type { AssetMetadata } from "@shared/types/asset";

export type EditorAssetKind = "video" | "audio" | "image";
export type EditorTimelineTrackId =
  | "video-1"
  | "source-audio-1"
  | "voiceover-1"
  | "music-1";

export interface EditorRgbColor {
  r: number;
  g: number;
  b: number;
}

export interface EditorMediaAsset {
  id: string;
  name: string;
  kind: EditorAssetKind;
  absolutePath?: string;
  projectRelativePath?: string;
  fileUrl?: string;
  objectUrl?: string;
  thumbnailPath?: string;
  thumbnailUrl?: string;
  thumbnailProjectRelativePath?: string;
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
  metadata?: AssetMetadata;
  imported: boolean;
  importedAt?: string;
  variant?: string;
  solidColor?: EditorRgbColor;
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
  metadata?: Record<string, unknown>;
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
