import {
  Camera,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume2,
  ZoomIn
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NativeTimelineProject, NativeVideoFrame } from "@shared/types/native-media";
import type { EditorMediaAsset, EditorTimelineClip } from "../../app/editorTypes";
import { useEditor } from "../../app/EditorContext";
import { formatTimecode } from "../../app/mediaImport";
import { rgbColorToCss } from "../../app/solidColor";
import { desktopApi } from "../../ipc/api";

type NativePreviewState =
  | "idle"
  | "loading"
  | "decode-pending"
  | "ready"
  | "decode-failed"
  | "end-of-stream";

const PREVIEW_CLOCK_COMMIT_INTERVAL_MS = 33;

interface QueuedRenderRequest {
  timelineTime: number;
  seek: boolean;
}

export const Preview = () => {
  const {
    assets,
    playheadSec,
    resolveTimelinePreview,
    selectedAsset,
    setPlayhead,
    timelineClips,
    timelineDurationSec,
    timelineFps,
    project
  } = useEditor();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionIdRef = useRef<string>();
  const sessionGenerationRef = useRef(0);
  const framePendingRef = useRef(false);
  const queuedRenderRef = useRef<QueuedRenderRequest>();
  const hasFrameRef = useRef(false);
  const playheadRef = useRef(playheadSec);
  const resolveTimelinePreviewRef = useRef(resolveTimelinePreview);
  const selectedAssetRef = useRef(selectedAsset);
  const hasTimelineClipsRef = useRef(timelineClips.length > 0);
  const playbackStartPerformanceRef = useRef(0);
  const playbackStartTimelineRef = useRef(0);
  const playbackLastCommitPerformanceRef = useRef(0);
  const playbackLastQueuedFrameTimeRef = useRef(-Infinity);
  const renderAtRef = useRef<(time: number, seek: boolean) => Promise<void>>(
    async () => undefined
  );
  const [previewState, setPreviewState] = useState<NativePreviewState>("idle");
  const [previewError, setPreviewError] = useState<string>();
  const [isPlaying, setIsPlaying] = useState(false);
  const [frameOpacity, setFrameOpacity] = useState(1);

  const timelinePreview = resolveTimelinePreview(playheadSec);
  const hasTimelineClips = timelineClips.length > 0;
  const previewAsset = timelinePreview?.asset ?? (hasTimelineClips ? undefined : selectedAsset);
  const hasNativeVideoAtPlayhead = previewAsset?.kind === "video";
  const displayImage = previewAsset?.solidColor
    ? undefined
    : previewAsset?.thumbnailUrl ?? previewAsset?.fileUrl ?? previewAsset?.objectUrl;
  const nativePoster = previewAsset?.thumbnailUrl;
  const playbackEndSec = useMemo(() => {
    const timelineEnd = timelineClips.reduce(
      (end, clip) => Math.max(end, clip.timelineStart + clip.durationSec),
      0
    );
    return timelineEnd || selectedAsset?.durationSec || timelineDurationSec;
  }, [selectedAsset?.durationSec, timelineClips, timelineDurationSec]);
  const frameStep = useMemo(
    () => 1 / (timelineFps ?? previewAsset?.fps ?? 24),
    [previewAsset?.fps, timelineFps]
  );
  const nativeTimeline = useMemo(
    () =>
      createNativePreviewTimeline({
        assets,
        clips: timelineClips,
        selectedAsset,
        hasTimelineClips,
        timelineDurationSec: playbackEndSec,
        fps: timelineFps ?? project?.settings.fps ?? 24,
        settings: project?.settings
      }),
    [
      assets,
      hasTimelineClips,
      playbackEndSec,
      project?.settings,
      selectedAsset,
      timelineClips,
      timelineFps
    ]
  );

  useEffect(() => {
    playheadRef.current = playheadSec;
    resolveTimelinePreviewRef.current = resolveTimelinePreview;
    selectedAssetRef.current = selectedAsset;
    hasTimelineClipsRef.current = hasTimelineClips;
  }, [hasTimelineClips, playheadSec, resolveTimelinePreview, selectedAsset]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    hasFrameRef.current = false;
  }, []);

  const drawFrame = useCallback((frame: NativeVideoFrame) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const image = frameToImageData(frame);
    canvas.width = frame.width;
    canvas.height = frame.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("无法创建原生预览画布上下文");
    }
    context.putImageData(image, 0, 0);
    setFrameOpacity(frame.opacity);
  }, []);

  const renderAt = useCallback(
    async (timelineTime: number, seek: boolean) => {
      const queued = queuedRenderRef.current;
      // A native frame is considerably more expensive than a browser video
      // paint. Keep only the newest clock position while one request is in
      // flight, so scrubbing and RAF ticks cannot form an IPC backlog.
      queuedRenderRef.current = {
        timelineTime,
        seek: seek || queued?.seek === true
      };
      if (framePendingRef.current) return;

      const pumpGeneration = sessionGenerationRef.current;
      framePendingRef.current = true;
      try {
        while (queuedRenderRef.current) {
          if (pumpGeneration !== sessionGenerationRef.current) break;
          const request = queuedRenderRef.current;
          queuedRenderRef.current = undefined;
          const sessionId = sessionIdRef.current;
          const activeAsset = hasTimelineClipsRef.current
            ? resolveTimelinePreviewRef.current(request.timelineTime)?.asset
            : selectedAssetRef.current;

          if (activeAsset?.kind !== "video") {
            clearCanvas();
            setPreviewState("idle");
            setPreviewError(undefined);
            continue;
          }
          if (!activeAsset.absolutePath) {
            setPreviewState("decode-failed");
            setPreviewError("素材没有可供 native preview 打开的本地路径。");
            continue;
          }
          if (!sessionId) continue;

          const generation = sessionGenerationRef.current;
          // Do not cover a valid frame with a spinner while the next frame is
          // decoding. It makes normal playback look permanently stalled.
          if (!hasFrameRef.current) setPreviewState("decode-pending");
          setPreviewError(undefined);
          try {
            if (request.seek) {
              await desktopApi.nativeMedia.seek({ sessionId, time: request.timelineTime });
            }
            const frame = await desktopApi.nativeMedia.renderFrame({
              sessionId,
              timelineTime: request.timelineTime
            });
            if (generation !== sessionGenerationRef.current) continue;
            drawFrame(frame);
            hasFrameRef.current = true;
            setPreviewState("ready");
          } catch (error) {
            if (generation !== sessionGenerationRef.current) continue;
            setPreviewState("decode-failed");
            setPreviewError(formatNativePreviewError(error));
          }
        }
      } finally {
        if (pumpGeneration === sessionGenerationRef.current) {
          framePendingRef.current = false;
        }
      }
    },
    [clearCanvas, drawFrame]
  );

  renderAtRef.current = renderAt;

  useEffect(() => {
    sessionGenerationRef.current += 1;
    const generation = sessionGenerationRef.current;
    const previousSessionId = sessionIdRef.current;
    sessionIdRef.current = undefined;
    framePendingRef.current = false;
    queuedRenderRef.current = undefined;
    hasFrameRef.current = false;
    setIsPlaying(false);
    clearCanvas();

    if (previousSessionId) {
      void desktopApi.nativeMedia.dispose({ targetId: previousSessionId });
    }
    if (!nativeTimeline) {
      setPreviewState("idle");
      setPreviewError(undefined);
      return;
    }

    let disposed = false;
    setPreviewState("loading");
    setPreviewError(undefined);
    void desktopApi.nativeMedia
      .createPlaybackSession({ timeline: nativeTimeline })
      .then(async (session) => {
        if (disposed || generation !== sessionGenerationRef.current) {
          await desktopApi.nativeMedia.dispose({ targetId: session.id });
          return;
        }
        sessionIdRef.current = session.id;
        await renderAtRef.current(playheadRef.current, true);
      })
      .catch((error) => {
        if (disposed || generation !== sessionGenerationRef.current) {
          return;
        }
        setPreviewState("decode-failed");
        setPreviewError(formatNativePreviewError(error));
      });

    return () => {
      disposed = true;
      queuedRenderRef.current = undefined;
      hasFrameRef.current = false;
      if (sessionIdRef.current) {
        void desktopApi.nativeMedia.dispose({ targetId: sessionIdRef.current });
        sessionIdRef.current = undefined;
      }
    };
  }, [clearCanvas, nativeTimeline]);

  useEffect(() => {
    if (isPlaying || !sessionIdRef.current) {
      return;
    }
    void renderAt(playheadSec, true);
  }, [isPlaying, playheadSec, renderAt]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    let frameId = 0;
    const tick = () => {
      const now = performance.now();
      const elapsedSec = (now - playbackStartPerformanceRef.current) / 1000;
      const nextTimelineTime = Math.min(
        playbackEndSec,
        playbackStartTimelineRef.current + elapsedSec
      );
      if (nextTimelineTime - playbackLastQueuedFrameTimeRef.current >= frameStep * 0.9) {
        playbackLastQueuedFrameTimeRef.current = nextTimelineTime;
        void renderAt(nextTimelineTime, false);
      }

      if (now - playbackLastCommitPerformanceRef.current >= PREVIEW_CLOCK_COMMIT_INTERVAL_MS) {
        playbackLastCommitPerformanceRef.current = now;
        setPlayhead(nextTimelineTime);
      }
      if (nextTimelineTime >= playbackEndSec - 0.001) {
        const sessionId = sessionIdRef.current;
        if (sessionId) {
          void desktopApi.nativeMedia.pause({ sessionId });
        }
        setIsPlaying(false);
        setPreviewState("end-of-stream");
        return;
      }
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [frameStep, isPlaying, playbackEndSec, renderAt, setPlayhead]);

  const handlePlay = async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !hasNativeVideoAtPlayhead || !previewAsset?.absolutePath) {
      return;
    }
    const startTime = playheadSec >= playbackEndSec - 0.001 ? 0 : playheadSec;
    try {
      await desktopApi.nativeMedia.play({ sessionId });
      if (startTime !== playheadSec) {
        setPlayhead(startTime);
      }
      playbackStartTimelineRef.current = startTime;
      playbackStartPerformanceRef.current = performance.now();
      playbackLastCommitPerformanceRef.current = 0;
      playbackLastQueuedFrameTimeRef.current = startTime;
      if (!hasFrameRef.current) setPreviewState("decode-pending");
      setIsPlaying(true);
      void renderAt(startTime, true);
    } catch (error) {
      setPreviewState("decode-failed");
      setPreviewError(formatNativePreviewError(error));
    }
  };

  const handlePause = () => {
    const sessionId = sessionIdRef.current;
    if (sessionId) {
      void desktopApi.nativeMedia.pause({ sessionId });
    }
    setIsPlaying(false);
  };

  const seekBy = (delta: number) => {
    const nextTime = Math.max(0, Math.min(playbackEndSec, playheadSec + delta));
    setPlayhead(nextTime);
    void renderAt(nextTime, true);
  };

  const showNativeCanvas = hasNativeVideoAtPlayhead;
  const canPlay = Boolean(sessionIdRef.current && hasNativeVideoAtPlayhead && previewAsset?.absolutePath);

  return (
    <section className="panel preview-panel" data-panel="preview">
      <div className="preview-head">
        <button className="sequence-button" type="button">
          序列 01
          <span>⌄</span>
        </button>
        <div className="preview-controls">
          <button className="preview-control icon" title="截图" type="button">
            <Camera size={17} />
          </button>
        </div>
      </div>

      <div className="viewer">
        {showNativeCanvas ? (
          <>
            {nativePoster && previewState !== "ready" ? (
              <img alt="素材缩略图" className="viewer-native-poster" src={nativePoster} />
            ) : null}
            <canvas
              aria-label="原生视频预览"
              className="viewer-native-canvas"
              ref={canvasRef}
              style={{ opacity: previewState === "ready" ? frameOpacity : 0 }}
            />
            {previewState !== "ready" ? (
              <div className={`viewer-native-status is-${previewState}`} role="status">
                {nativePreviewStatusText(previewState, previewError)}
              </div>
            ) : null}
          </>
        ) : previewAsset?.solidColor ? (
          <div
            className="viewer-solid-color"
            style={{ background: rgbColorToCss(previewAsset.solidColor) }}
          />
        ) : displayImage ? (
          <img alt="素材预览画面" src={displayImage} />
        ) : (
          <div className="viewer-empty" />
        )}
        {previewAsset ? <div className="viewer-label">{previewAsset.name}</div> : null}
      </div>

      <div className="transport">
        <time>{formatTimecode(playheadSec, timelineFps ?? previewAsset?.fps)}</time>
        <div className="transport-buttons">
          <button className="icon-button" onClick={() => seekBy(-frameStep)} title="上一帧" type="button">
            <SkipBack size={18} />
          </button>
          <button className="icon-button" onClick={() => seekBy(-1)} title="后退" type="button">
            <RotateCcw size={17} />
          </button>
          {isPlaying ? (
            <button className="play-button" onClick={handlePause} title="暂停" type="button">
              <Pause size={20} fill="currentColor" />
            </button>
          ) : (
            <button className="play-button" disabled={!canPlay} onClick={handlePlay} title="播放" type="button">
              <Play size={20} fill="currentColor" />
            </button>
          )}
          <button className="icon-button" onClick={() => seekBy(frameStep)} title="下一帧" type="button">
            <SkipForward size={18} />
          </button>
        </div>
        <div className="monitor-tools">
          <Camera size={16} />
          <Volume2 size={16} />
          <ZoomIn size={16} />
          <div className="volume-line"><span /></div>
          <Maximize2 size={16} />
        </div>
      </div>
    </section>
  );
};

function createNativePreviewTimeline({
  assets,
  clips,
  selectedAsset,
  hasTimelineClips,
  timelineDurationSec,
  fps,
  settings
}: {
  assets: EditorMediaAsset[];
  clips: EditorTimelineClip[];
  selectedAsset: EditorMediaAsset | undefined;
  hasTimelineClips: boolean;
  timelineDurationSec: number;
  fps: number;
  settings: NativeTimelineProject["settings"] | undefined;
}): NativeTimelineProject | undefined {
  const assetPaths = Object.fromEntries(
    assets
      .filter((asset) => asset.kind === "video" && Boolean(asset.absolutePath))
      .map((asset) => [asset.id, asset.absolutePath!])
  );
  const videoClips = hasTimelineClips
    ? clips.filter((clip) => clip.trackId === "video-1")
    : selectedAsset?.kind === "video"
      ? [
          {
            id: `native-preview-${selectedAsset.id}`,
            assetId: selectedAsset.id,
            trackId: "video-1" as const,
            timelineStart: 0,
            durationSec: selectedAsset.durationSec,
            sourceIn: 0,
            sourceOut: selectedAsset.durationSec
          }
        ]
      : [];
  if (videoClips.length === 0) {
    return undefined;
  }

  return {
    assets: [],
    assetPaths,
    settings:
      settings ?? {
        width: 1920,
        height: 1080,
        fps,
        audioSampleRate: 48000,
        colorSpace: "rec709",
        defaultDurationSeconds: 5,
        previewResolution: "half"
      },
    timeline: {
      id: "native-preview",
      fps,
      duration: timelineDurationSec,
      playhead: 0,
      tracks: [
        {
          id: "video-1",
          kind: "video",
          name: "Preview",
          order: 0,
          locked: false,
          muted: false,
          visible: true,
          clips: videoClips.map((clip) => ({
            id: clip.id,
            assetId: clip.assetId,
            trackId: "video-1",
            name: "Preview clip",
            sourceIn: clip.sourceIn,
            sourceOut: clip.sourceOut,
            timelineStart: clip.timelineStart,
            timelineEnd: clip.timelineStart + clip.durationSec,
            speed: 1,
            opacity: 1
          }))
        }
      ]
    }
  };
}

function frameToImageData(frame: NativeVideoFrame): ImageData {
  if (frame.data.kind !== "inline") {
    throw new Error("当前 renderer 尚不能映射 shared-memory 帧。");
  }
  if (frame.format !== "rgba" && frame.format !== "bgra") {
    throw new Error(`Canvas MVP 只支持 RGBA/BGRA，收到 ${frame.format}。`);
  }

  const source = Uint8ClampedArray.from(atob(frame.data.data), (byte) => byte.charCodeAt(0));
  const rgba = new Uint8ClampedArray(frame.width * frame.height * 4);
  for (let row = 0; row < frame.height; row += 1) {
    const sourceOffset = row * frame.stride;
    const destinationOffset = row * frame.width * 4;
    rgba.set(source.subarray(sourceOffset, sourceOffset + frame.width * 4), destinationOffset);
  }
  if (frame.format === "bgra") {
    for (let index = 0; index < rgba.length; index += 4) {
      const red = rgba[index];
      rgba[index] = rgba[index + 2];
      rgba[index + 2] = red;
    }
  }
  return new ImageData(rgba, frame.width, frame.height);
}

function nativePreviewStatusText(state: NativePreviewState, error: string | undefined): string {
  if (state === "loading") return "正在启动 native preview…";
  if (state === "decode-pending") return "正在解码画面…";
  if (state === "end-of-stream") return "播放结束";
  if (state === "decode-failed") return error ?? "原生解码失败";
  return "";
}

function formatNativePreviewError(error: unknown): string {
  return error instanceof Error ? error.message : "原生解码失败";
}
