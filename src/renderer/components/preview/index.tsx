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
import { previewClock } from "../../app/previewClock";
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

const FRAME_CACHE_CAPACITY = 3;
const PREFETCH_LEAD_FRAMES = 1;

interface QueuedRenderRequest {
  timelineTime: number;
  seek: boolean;
  display: boolean;
  frameKey: number;
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
  const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const canvasImageDataRef = useRef<ImageData>();
  const sessionIdRef = useRef<string>();
  const sessionGenerationRef = useRef(0);
  const framePendingRef = useRef(false);
  const queuedRenderRef = useRef<QueuedRenderRequest>();
  const pendingFrameKeysRef = useRef(new Set<number>());
  const frameCacheRef = useRef(new Map<number, NativeVideoFrame>());
  const lastDisplayedFrameKeyRef = useRef<number>();
  const activeFrameKeyRef = useRef(0);
  const hasFrameRef = useRef(false);
  const playheadRef = useRef(playheadSec);
  const resolveTimelinePreviewRef = useRef(resolveTimelinePreview);
  const selectedAssetRef = useRef(selectedAsset);
  const hasTimelineClipsRef = useRef(timelineClips.length > 0);
  const playbackStartPerformanceRef = useRef(0);
  const playbackStartTimelineRef = useRef(0);
  const playbackLastFrameKeyRef = useRef(-1);
  const skipNextPausedRenderRef = useRef(false);
  const frameOpacityRef = useRef(1);
  const renderAtRef = useRef<(
    time: number,
    seek: boolean,
    display?: boolean
  ) => Promise<void>>(
    async () => undefined
  );
  const [previewState, setPreviewState] = useState<NativePreviewState>("idle");
  const [previewError, setPreviewError] = useState<string>();
  const [isPlaying, setIsPlaying] = useState(false);
  const [previewTime, setPreviewTime] = useState(playheadSec);

  const timelinePreview = resolveTimelinePreview(previewTime);
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
  const frameKeyForTime = useCallback(
    (time: number) => Math.max(0, Math.round(time / frameStep)),
    [frameStep]
  );
  const frameTimeForKey = useCallback(
    (frameKey: number) => Math.min(playbackEndSec, frameKey * frameStep),
    [frameStep, playbackEndSec]
  );

  useEffect(() => {
    playheadRef.current = previewTime;
    resolveTimelinePreviewRef.current = resolveTimelinePreview;
    selectedAssetRef.current = selectedAsset;
    hasTimelineClipsRef.current = hasTimelineClips;
  }, [hasTimelineClips, previewTime, resolveTimelinePreview, selectedAsset]);

  useEffect(() => {
    if (isPlaying) return;
    playheadRef.current = playheadSec;
    setPreviewTime(playheadSec);
    previewClock.seek(playheadSec);
  }, [isPlaying, playheadSec]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvasContextRef.current;
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    canvasImageDataRef.current = undefined;
    lastDisplayedFrameKeyRef.current = undefined;
    hasFrameRef.current = false;
  }, []);

  const drawFrame = useCallback((frame: NativeVideoFrame) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    if (canvas.width !== frame.width || canvas.height !== frame.height) {
      canvas.width = frame.width;
      canvas.height = frame.height;
      canvasContextRef.current = null;
      canvasImageDataRef.current = undefined;
    }
    const image = frameToImageData(frame, canvasImageDataRef.current);
    canvasImageDataRef.current = image;
    const context =
      canvasContextRef.current ??
      canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!context) {
      throw new Error("无法创建原生预览画布上下文");
    }
    canvasContextRef.current = context;
    context.putImageData(image, 0, 0);
    frameOpacityRef.current = frame.opacity;
    canvas.style.opacity = String(frame.opacity);
  }, []);

  const displayCachedFrame = useCallback(
    (frameKey: number): boolean => {
      let selectedKey: number | undefined;
      for (const cachedKey of frameCacheRef.current.keys()) {
        if (cachedKey <= frameKey && (selectedKey === undefined || cachedKey > selectedKey)) {
          selectedKey = cachedKey;
        }
      }
      if (selectedKey === undefined || selectedKey === lastDisplayedFrameKeyRef.current) {
        return false;
      }
      const frame = frameCacheRef.current.get(selectedKey);
      if (!frame) return false;
      drawFrame(frame);
      lastDisplayedFrameKeyRef.current = selectedKey;
      hasFrameRef.current = true;
      setPreviewState("ready");
      return true;
    },
    [drawFrame]
  );

  const renderAt = useCallback(
    async (timelineTime: number, seek: boolean, display = true) => {
      const frameKey = frameKeyForTime(timelineTime);
      if (!seek && frameCacheRef.current.has(frameKey)) {
        if (display) displayCachedFrame(frameKey);
        return;
      }
      if (pendingFrameKeysRef.current.has(frameKey)) {
        return;
      }
      const queued = queuedRenderRef.current;
      if (queued) {
        pendingFrameKeysRef.current.delete(queued.frameKey);
      }
      // A native frame is considerably more expensive than a browser video
      // paint. Keep only the newest clock position while one request is in
      // flight, so scrubbing and RAF ticks cannot form an IPC backlog.
      queuedRenderRef.current = {
        timelineTime,
        seek: seek || queued?.seek === true,
        display: display || queued?.display === true,
        frameKey
      };
      pendingFrameKeysRef.current.add(frameKey);
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
            pendingFrameKeysRef.current.delete(request.frameKey);
            clearCanvas();
            setPreviewState("idle");
            setPreviewError(undefined);
            continue;
          }
          if (!activeAsset.absolutePath) {
            pendingFrameKeysRef.current.delete(request.frameKey);
            setPreviewState("decode-failed");
            setPreviewError("素材没有可供 native preview 打开的本地路径。");
            continue;
          }
          if (!sessionId) {
            pendingFrameKeysRef.current.delete(request.frameKey);
            continue;
          }

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
            pendingFrameKeysRef.current.delete(request.frameKey);
            if (generation !== sessionGenerationRef.current) continue;
            frameCacheRef.current.set(request.frameKey, frame);
            while (frameCacheRef.current.size > FRAME_CACHE_CAPACITY) {
              const oldestKey = frameCacheRef.current.keys().next().value;
              if (oldestKey === undefined) break;
              frameCacheRef.current.delete(oldestKey);
            }
            if (request.display || request.frameKey <= activeFrameKeyRef.current) {
              displayCachedFrame(request.frameKey);
            }
            if (
              request.display &&
              previewClock.getSnapshot().isPlaying
            ) {
              // If the first seek completed after the clock moved on, decode
              // the active frame first; otherwise keep one frame ready ahead.
              const nextFrameKey = Math.max(
                request.frameKey + PREFETCH_LEAD_FRAMES,
                activeFrameKeyRef.current
              );
              const prefetchTime = frameTimeForKey(nextFrameKey);
              if (prefetchTime < playbackEndSec - frameStep * 0.25) {
                void renderAtRef.current(
                  prefetchTime,
                  false,
                  nextFrameKey <= activeFrameKeyRef.current
                );
              }
            }
          } catch (error) {
            pendingFrameKeysRef.current.delete(request.frameKey);
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
    [
      clearCanvas,
      displayCachedFrame,
      frameKeyForTime,
      frameStep,
      frameTimeForKey,
      playbackEndSec
    ]
  );

  renderAtRef.current = renderAt;

  useEffect(() => {
    sessionGenerationRef.current += 1;
    const generation = sessionGenerationRef.current;
    const previousSessionId = sessionIdRef.current;
    sessionIdRef.current = undefined;
    framePendingRef.current = false;
    queuedRenderRef.current = undefined;
    pendingFrameKeysRef.current.clear();
    frameCacheRef.current.clear();
    activeFrameKeyRef.current = frameKeyForTime(playheadRef.current);
    hasFrameRef.current = false;
    previewClock.pause(playheadRef.current);
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
      pendingFrameKeysRef.current.clear();
      frameCacheRef.current.clear();
      hasFrameRef.current = false;
      if (sessionIdRef.current) {
        void desktopApi.nativeMedia.dispose({ targetId: sessionIdRef.current });
        sessionIdRef.current = undefined;
      }
    };
  }, [clearCanvas, frameKeyForTime, nativeTimeline]);

  useEffect(() => {
    if (isPlaying || !sessionIdRef.current) {
      return;
    }
    if (skipNextPausedRenderRef.current) {
      skipNextPausedRenderRef.current = false;
      return;
    }
    activeFrameKeyRef.current = frameKeyForTime(previewTime);
    void renderAt(previewTime, true);
  }, [frameKeyForTime, isPlaying, previewTime, renderAt]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    let frameId = 0;
    const tick = () => {
      const now = performance.now();
      const elapsedSec = (now - playbackStartPerformanceRef.current) / 1000;
      const rawTimelineTime = Math.min(
        playbackEndSec,
        playbackStartTimelineRef.current + elapsedSec
      );
      const frameKey = frameKeyForTime(rawTimelineTime);
      const nextTimelineTime = frameTimeForKey(frameKey);

      if (frameKey !== playbackLastFrameKeyRef.current) {
        playbackLastFrameKeyRef.current = frameKey;
        activeFrameKeyRef.current = frameKey;
        playheadRef.current = nextTimelineTime;
        setPreviewTime(nextTimelineTime);
        previewClock.advance(nextTimelineTime);
        displayCachedFrame(frameKey);

        if (hasFrameRef.current) {
          const prefetchKey = frameKey + PREFETCH_LEAD_FRAMES;
          const prefetchTime = frameTimeForKey(prefetchKey);
          if (prefetchTime < playbackEndSec - frameStep * 0.25) {
            void renderAt(prefetchTime, false, false);
          }
        }
      }

      if (rawTimelineTime >= playbackEndSec - 0.001) {
        const sessionId = sessionIdRef.current;
        if (sessionId) {
          void desktopApi.nativeMedia.pause({ sessionId });
        }
        previewClock.pause(playbackEndSec);
        playheadRef.current = playbackEndSec;
        setPreviewTime(playbackEndSec);
        skipNextPausedRenderRef.current = true;
        setPlayhead(playbackEndSec, { markProjectDirty: false });
        setIsPlaying(false);
        setPreviewState(hasFrameRef.current ? "ready" : "end-of-stream");
        return;
      }
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [
    displayCachedFrame,
    frameKeyForTime,
    frameStep,
    frameTimeForKey,
    isPlaying,
    playbackEndSec,
    renderAt,
    setPlayhead
  ]);

  const handlePlay = async () => {
    const sessionId = sessionIdRef.current;
    const startTime = previewTime >= playbackEndSec - 0.001 ? 0 : previewTime;
    const startAsset = hasTimelineClips
      ? resolveTimelinePreviewRef.current(startTime)?.asset
      : selectedAssetRef.current;
    if (!sessionId || startAsset?.kind !== "video" || !startAsset.absolutePath) {
      return;
    }
    try {
      await desktopApi.nativeMedia.play({ sessionId });
      playheadRef.current = startTime;
      setPreviewTime(startTime);
      if (startTime !== playheadSec) setPlayhead(startTime, { markProjectDirty: false });
      playbackStartTimelineRef.current = startTime;
      playbackStartPerformanceRef.current = performance.now();
      playbackLastFrameKeyRef.current = frameKeyForTime(startTime);
      activeFrameKeyRef.current = playbackLastFrameKeyRef.current;
      previewClock.start(startTime);
      if (!hasFrameRef.current) setPreviewState("decode-pending");
      setIsPlaying(true);
      if (!displayCachedFrame(playbackLastFrameKeyRef.current)) {
        void renderAt(startTime, true);
      }
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
    const pausedTime = playheadRef.current;
    previewClock.pause(pausedTime);
    skipNextPausedRenderRef.current = true;
    setPlayhead(pausedTime, { markProjectDirty: false });
    setIsPlaying(false);
  };

  const seekBy = (delta: number) => {
    const nextTime = Math.max(0, Math.min(playbackEndSec, previewTime + delta));
    playheadRef.current = nextTime;
    setPreviewTime(nextTime);
    previewClock.seek(nextTime);
    activeFrameKeyRef.current = frameKeyForTime(nextTime);
    setPlayhead(nextTime);
    void renderAt(nextTime, true);
  };

  const showNativeCanvas = hasNativeVideoAtPlayhead;
  const canPlay = Boolean(sessionIdRef.current && nativeTimeline);

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
              style={{ opacity: previewState === "ready" ? frameOpacityRef.current : 0 }}
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
        <time>{formatTimecode(previewTime, timelineFps ?? previewAsset?.fps)}</time>
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

function frameToImageData(frame: NativeVideoFrame, reusable?: ImageData): ImageData {
  if (frame.data.kind !== "inline") {
    throw new Error("当前 renderer 尚不能映射 shared-memory 帧。");
  }
  if (frame.format !== "rgba" && frame.format !== "bgra") {
    throw new Error(`Canvas MVP 只支持 RGBA/BGRA，收到 ${frame.format}。`);
  }

  const binary = atob(frame.data.data);
  const image =
    reusable && reusable.width === frame.width && reusable.height === frame.height
      ? reusable
      : new ImageData(frame.width, frame.height);
  const rgba = image.data;
  for (let row = 0; row < frame.height; row += 1) {
    const sourceOffset = row * frame.stride;
    const destinationOffset = row * frame.width * 4;
    const rowByteLength = frame.width * 4;
    if (frame.format === "rgba") {
      for (let offset = 0; offset < rowByteLength; offset += 1) {
        rgba[destinationOffset + offset] = binary.charCodeAt(sourceOffset + offset);
      }
      continue;
    }
    for (let offset = 0; offset < rowByteLength; offset += 4) {
      rgba[destinationOffset + offset] = binary.charCodeAt(sourceOffset + offset + 2);
      rgba[destinationOffset + offset + 1] = binary.charCodeAt(sourceOffset + offset + 1);
      rgba[destinationOffset + offset + 2] = binary.charCodeAt(sourceOffset + offset);
      rgba[destinationOffset + offset + 3] = binary.charCodeAt(sourceOffset + offset + 3);
    }
  }
  return image;
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
