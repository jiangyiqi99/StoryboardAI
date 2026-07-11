import type { AssetMetadata } from "./asset";
import type { Project } from "./project";

/**
 * The pixel formats accepted at the Electron/native-media boundary.  The
 * sidecar always describes plane layout explicitly, so callers must not infer
 * a plane's byte length from width and height alone.
 */
export type NativePixelFormat = "rgba" | "bgra" | "yuv420p";

export type NativeAudioSampleFormat = "f32le" | "s16le";

export type NativeColorSpace = "srgb" | "rec709" | "display-p3" | "unknown";

export interface NativeTimebase {
  numerator: number;
  denominator: number;
}

export interface NativeFramePlane {
  /** Byte offset from the start of the transferred buffer. */
  offset: number;
  /** Number of valid bytes in this plane. */
  byteLength: number;
  /** Bytes between adjacent rows in this plane. */
  stride: number;
}

/**
 * `inline` is intended only for diagnostics and small frames. Playback uses a
 * named shared-memory mapping so the renderer can avoid a JSON/base64 copy.
 */
export type NativeBufferTransport =
  | {
      kind: "inline";
      encoding: "base64";
      data: string;
      byteLength: number;
    }
  | {
      kind: "shared-memory";
      name: string;
      byteLength: number;
      /** Opaque lease; it must be released with `dispose` when no longer used. */
      leaseId: string;
    };

export interface NativeVideoFrame {
  format: NativePixelFormat;
  width: number;
  height: number;
  /** Convenience alias for the first plane's stride. */
  stride: number;
  planes: NativeFramePlane[];
  pts: number;
  timebase: NativeTimebase;
  duration: number;
  colorSpace: NativeColorSpace;
  /** Per-frame opacity after timeline compositing, in the inclusive range 0–1. */
  opacity: number;
  hasAlpha: boolean;
  data: NativeBufferTransport;
}

export interface NativeAudioBuffer {
  format: NativeAudioSampleFormat;
  sampleRate: number;
  channels: number;
  frames: number;
  pts: number;
  timebase: NativeTimebase;
  duration: number;
  data: NativeBufferTransport;
}

export interface NativeMediaStream {
  index: number;
  kind: "video" | "audio" | "subtitle" | "data" | "unknown";
  codec?: string;
  timebase: NativeTimebase;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  sampleRate?: number;
  channels?: number;
  pixelFormat?: string;
}

export interface NativeMediaProbe {
  path: string;
  format?: string;
  duration?: number;
  bitRate?: number;
  streams: NativeMediaStream[];
  /** Compatibility projection for callers that currently use AssetMetadata. */
  assetMetadata: AssetMetadata;
}

export interface NativeMediaAsset {
  id: string;
  path: string;
  probe: NativeMediaProbe;
}

export type NativeTimelineProject = Pick<Project, "assets" | "settings" | "timeline">;

export interface NativePlaybackSession {
  id: string;
  timeline: NativeTimelineProject;
  state: "paused" | "playing";
  time: number;
}

export interface NativeEncodeResult {
  outputPath: string;
  duration: number;
}

export interface NativeMediaRuntimeError {
  code: string;
  operation: string;
  message: string;
  /** Native/libav error number when the failure originates from libav. */
  nativeCode?: number;
  details?: Record<string, unknown>;
}

export interface NativeMediaLogEvent {
  level: "trace" | "debug" | "info" | "warning" | "error";
  message: string;
  component?: string;
  assetId?: string;
  sessionId?: string;
}
