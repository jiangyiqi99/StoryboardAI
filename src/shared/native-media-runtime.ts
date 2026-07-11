import type {
  NativeEncodeResult,
  NativeAudioBuffer,
  NativeMediaAsset,
  NativeMediaProbe,
  NativePlaybackSession,
  NativeTimelineProject,
  NativeVideoFrame
} from "./types/native-media";

/**
 * A transport-neutral media runtime.  The current implementation is backed by
 * a Go/libav sidecar; the renderer only sees this stable contract.
 */
export interface NativeMediaRuntime {
  openAsset(path: string): Promise<NativeMediaAsset>;
  probe(path: string): Promise<NativeMediaProbe>;
  decodeFrame(assetId: string, time: number): Promise<NativeVideoFrame>;
  createPlaybackSession(timeline: NativeTimelineProject): Promise<NativePlaybackSession>;
  seek(sessionId: string, time: number): Promise<NativePlaybackSession>;
  play(sessionId: string): Promise<NativePlaybackSession>;
  pause(sessionId: string): Promise<NativePlaybackSession>;
  renderFrame(sessionId: string, timelineTime: number): Promise<NativeVideoFrame>;
  renderAudio(
    sessionId: string,
    timelineTime: number,
    duration: number
  ): Promise<NativeAudioBuffer>;
  encodeTimeline(
    project: NativeTimelineProject,
    outputPath: string
  ): Promise<NativeEncodeResult>;
  /** Releases an opened asset or playback session. */
  dispose(targetId: string): Promise<void>;
  shutdown(): Promise<void>;
}
