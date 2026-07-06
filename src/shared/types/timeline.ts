import type { AssetId } from "./asset";

export type TimelineId = string;
export type TrackId = string;
export type ClipId = string;
export type TimelineSeconds = number;

export type TrackKind = "video" | "audio" | "overlay" | "caption";

export interface TimelineRange {
  start: TimelineSeconds;
  end: TimelineSeconds;
}

export interface Clip {
  id: ClipId;
  assetId: AssetId;
  trackId: TrackId;
  name?: string;
  sourceIn: TimelineSeconds;
  sourceOut: TimelineSeconds;
  timelineStart: TimelineSeconds;
  timelineEnd: TimelineSeconds;
  speed: number;
  muted?: boolean;
  opacity?: number;
  metadata?: Record<string, unknown>;
}

export interface Track {
  id: TrackId;
  kind: TrackKind;
  name: string;
  order: number;
  clips: Clip[];
  locked: boolean;
  muted: boolean;
  visible: boolean;
}

export interface TimelineSelection {
  clipIds: ClipId[];
  range?: TimelineRange;
}

export interface Timeline {
  id: TimelineId;
  fps: number;
  duration: TimelineSeconds;
  playhead: TimelineSeconds;
  tracks: Track[];
  selection?: TimelineSelection;
}
