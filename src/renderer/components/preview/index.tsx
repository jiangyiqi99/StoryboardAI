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
import type {
  NativeAudioBuffer,
  NativeTimelineProject,
  NativeVideoFrame
} from "@shared/types/native-media";
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
const TRANSITION_PREFETCH_EPSILON_SEC = 0.001;
const TRANSIENT_STATUS_DELAY_MS = 100;
const PLAYBACK_FAILURE_TOLERANCE_FRAMES = 3;
const AUDIO_CHUNK_DURATION_SEC = 0.5;
const AUDIO_BUFFER_LEAD_SEC = 1.1;

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
  const canvas2dContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const webglRendererRef = useRef<PreviewWebglRenderer | null>(null);
  const canvasImageDataRef = useRef<ImageData>();
  const sessionIdRef = useRef<string>();
  const sessionGenerationRef = useRef(0);
  const framePendingRef = useRef(false);
  const queuedRenderRef = useRef<QueuedRenderRequest>();
  const pendingFrameKeysRef = useRef(new Set<number>());
  const frameCacheRef = useRef(new Map<number, NativeVideoFrame>());
  const transitionFrameCacheRef = useRef(new Map<number, NativeVideoFrame>());
  const transitionPrefetchPendingRef = useRef(new Set<number>());
  const lastDisplayedFrameKeyRef = useRef<number>();
  const consecutivePlaybackFailuresRef = useRef(0);
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
  const audioContextRef = useRef<AudioContext>();
  const audioSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const audioGenerationRef = useRef(0);
  const audioRequestPendingRef = useRef(false);
  const audioActiveRef = useRef(false);
  const audioTimerRef = useRef<number>();
  const audioAnchorTimelineRef = useRef(0);
  const audioAnchorContextRef = useRef(0);
  const audioNextTimelineRef = useRef(0);
  const scheduleAudioRef = useRef<() => void>(() => undefined);
  const renderAtRef = useRef<(
    time: number,
    seek: boolean,
    display?: boolean
  ) => Promise<void>>(
    async () => undefined
  );
  const preloadNextClipRef = useRef<(time: number) => void>(() => undefined);
  const [previewState, setPreviewState] = useState<NativePreviewState>("idle");
  const [previewError, setPreviewError] = useState<string>();
  const [showTransientStatus, setShowTransientStatus] = useState(false);
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

  useEffect(() => {
    const isTransient = previewState === "loading" || previewState === "decode-pending";
    if (!isTransient) {
      setShowTransientStatus(false);
      return;
    }

    // A prepared transition frame normally arrives within one paint. Avoid
    // flashing a loading label for that single-frame hand-off, while keeping
    // feedback for a decode that is genuinely taking noticeable time.
    setShowTransientStatus(false);
    const timer = window.setTimeout(
      () => setShowTransientStatus(true),
      TRANSIENT_STATUS_DELAY_MS
    );
    return () => window.clearTimeout(timer);
  }, [previewState]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas2dContextRef.current;
    if (webglRendererRef.current) {
      webglRendererRef.current.clear();
    } else if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    canvasImageDataRef.current = undefined;
    lastDisplayedFrameKeyRef.current = undefined;
    hasFrameRef.current = false;
  }, []);

  const stopPreviewAudio = useCallback(() => {
    audioActiveRef.current = false;
    audioGenerationRef.current += 1;
    audioRequestPendingRef.current = false;
    if (audioTimerRef.current !== undefined) {
      window.clearTimeout(audioTimerRef.current);
      audioTimerRef.current = undefined;
    }
    for (const source of audioSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // A source may have reached its natural end between the loop and stop.
      }
    }
    audioSourcesRef.current.clear();
  }, []);

  const schedulePreviewAudio = useCallback(() => {
    if (audioRequestPendingRef.current || !audioActiveRef.current) return;
    const sessionId = sessionIdRef.current;
    const context = audioContextRef.current;
    const timelineTime = audioNextTimelineRef.current;
    if (!sessionId || !context || timelineTime >= playbackEndSec - 0.001) return;

    const generation = audioGenerationRef.current;
    const duration = Math.min(AUDIO_CHUNK_DURATION_SEC, playbackEndSec - timelineTime);
    audioRequestPendingRef.current = true;
    // Reserve the window before the async request so only one chunk can be
    // in flight and calls cannot build an audio IPC backlog.
    audioNextTimelineRef.current += duration;
    void desktopApi.nativeMedia
      .renderAudio({ sessionId, timelineTime, duration })
      .then((nativeBuffer) => {
        if (!audioActiveRef.current || generation !== audioGenerationRef.current) return;
        const audioBuffer = nativeAudioToWebAudioBuffer(context, nativeBuffer);
        const source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(context.destination);
        const bufferTimelineTime = nativeBuffer.pts * nativeBuffer.timebase.numerator / nativeBuffer.timebase.denominator;
        const expectedWhen =
          audioAnchorContextRef.current + (bufferTimelineTime - audioAnchorTimelineRef.current);
        const lateBy = Math.max(0, context.currentTime - expectedWhen);
        if (lateBy < audioBuffer.duration) {
          audioSourcesRef.current.add(source);
          source.addEventListener("ended", () => audioSourcesRef.current.delete(source), { once: true });
          source.start(Math.max(expectedWhen, context.currentTime + 0.005), lateBy);
        }
      })
      .catch(() => {
        // Audio is an enhancement to preview; a bad stream must not interrupt
        // the independently decoded video image.
      })
      .finally(() => {
        audioRequestPendingRef.current = false;
        if (!audioActiveRef.current || generation !== audioGenerationRef.current) return;
        const currentTimeline =
          audioAnchorTimelineRef.current +
          Math.max(0, context.currentTime - audioAnchorContextRef.current);
        const lead = audioNextTimelineRef.current - currentTimeline;
        if (lead < AUDIO_BUFFER_LEAD_SEC) {
          scheduleAudioRef.current();
          return;
        }
        audioTimerRef.current = window.setTimeout(
          () => scheduleAudioRef.current(),
          Math.max(20, (lead - AUDIO_BUFFER_LEAD_SEC) * 1000)
        );
      });
  }, [playbackEndSec]);

  scheduleAudioRef.current = schedulePreviewAudio;

  const startPreviewAudio = useCallback(
    async (timelineTime: number) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      stopPreviewAudio();
      const generation = audioGenerationRef.current;
      const context = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = context;
      try {
        await context.resume();
      } catch {
        return;
      }
      if (generation !== audioGenerationRef.current || sessionId !== sessionIdRef.current) return;
      // `AudioContext.resume()` may take a noticeable fraction of a frame on
      // the first user gesture. Anchor at the current preview-clock position,
      // not at the earlier button-click time, so sound never starts late.
      const elapsedSincePlaybackStart =
        (performance.now() - playbackStartPerformanceRef.current) / 1000;
      const currentTimelineTime = Math.min(
        playbackEndSec,
        Math.max(timelineTime, playbackStartTimelineRef.current + elapsedSincePlaybackStart)
      );
      audioAnchorTimelineRef.current = currentTimelineTime;
      audioAnchorContextRef.current = context.currentTime + 0.04;
      audioNextTimelineRef.current = currentTimelineTime;
      audioActiveRef.current = true;
      scheduleAudioRef.current();
    },
    [playbackEndSec, stopPreviewAudio]
  );

  const drawFrame = useCallback((frame: NativeVideoFrame) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    if (canvas.width !== frame.width || canvas.height !== frame.height) {
      canvas.width = frame.width;
      canvas.height = frame.height;
      canvas2dContextRef.current = null;
      canvasImageDataRef.current = undefined;
      webglRendererRef.current?.resize(frame.width, frame.height);
    }

    const webgl = webglRendererRef.current ?? createPreviewWebglRenderer(canvas);
    if (webgl) {
      webglRendererRef.current = webgl;
      const upload = frameToPixelUpload(frame, canvasImageDataRef.current);
      if (upload.image) canvasImageDataRef.current = upload.image;
      webgl.draw(frame, upload.pixels);
    } else {
      const image = frameToImageData(frame, canvasImageDataRef.current);
      canvasImageDataRef.current = image;
      const context =
        canvas2dContextRef.current ??
        canvas.getContext("2d", { alpha: false, desynchronized: true });
      if (!context) {
        throw new Error("无法创建原生预览画布上下文");
      }
      canvas2dContextRef.current = context;
      context.putImageData(image, 0, 0);
    }
    frameOpacityRef.current = frame.opacity;
    canvas.style.opacity = String(frame.opacity);
  }, []);

  const displayCachedFrame = useCallback(
    (frameKey: number): boolean => {
      let selectedKey: number | undefined;
      let selectedFrame: NativeVideoFrame | undefined;
      for (const cachedKey of frameCacheRef.current.keys()) {
        if (cachedKey <= frameKey && (selectedKey === undefined || cachedKey > selectedKey)) {
          selectedKey = cachedKey;
          selectedFrame = frameCacheRef.current.get(cachedKey);
        }
      }
      for (const [cachedKey, cachedFrame] of transitionFrameCacheRef.current) {
        if (cachedKey <= frameKey && (selectedKey === undefined || cachedKey > selectedKey)) {
          selectedKey = cachedKey;
          selectedFrame = cachedFrame;
        }
      }
      if (selectedKey === undefined || selectedKey === lastDisplayedFrameKeyRef.current) {
        return false;
      }
      const frame = selectedFrame;
      if (!frame) return false;
      drawFrame(frame);
      lastDisplayedFrameKeyRef.current = selectedKey;
      hasFrameRef.current = true;
      setPreviewState("ready");
      return true;
    },
    [drawFrame]
  );

  const preloadNextClip = useCallback(
    (timelineTime: number) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId || !hasTimelineClipsRef.current) return;
      const nextClip = timelineClips
        .filter(
          (clip) =>
            clip.trackId === "video-1" &&
            clip.timelineStart > timelineTime + TRANSITION_PREFETCH_EPSILON_SEC
        )
        .sort((first, second) => first.timelineStart - second.timelineStart)[0];
      if (!nextClip) return;
      const asset = assets.find((candidate) => candidate.id === nextClip.assetId);
      if (asset?.kind !== "video" || !asset.absolutePath) return;
      const frameKey = frameKeyForTime(nextClip.timelineStart);
      if (
        transitionFrameCacheRef.current.has(frameKey) ||
        transitionPrefetchPendingRef.current.has(frameKey)
      ) {
        return;
      }

      const generation = sessionGenerationRef.current;
      transitionPrefetchPendingRef.current.add(frameKey);
      // Decode and retain the next clip's first frame while the current clip is
      // still playing. Each asset has its own native decoder, so this both
      // opens/warms the next decoder and gives the renderer an immediate frame
      // to display at the edit point.
      void desktopApi.nativeMedia
        .renderFrame({ sessionId, timelineTime: nextClip.timelineStart })
        .then((frame) => {
          if (
            generation !== sessionGenerationRef.current ||
            sessionId !== sessionIdRef.current
          ) {
            return;
          }
          transitionFrameCacheRef.current.set(frameKey, frame);
        })
        .catch(() => {
          // Normal render remains the fallback if a speculative preload fails.
        })
        .finally(() => transitionPrefetchPendingRef.current.delete(frameKey));
    },
    [assets, frameKeyForTime, timelineClips]
  );

  preloadNextClipRef.current = preloadNextClip;

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
            consecutivePlaybackFailuresRef.current = 0;
            const replacedFrame = frameCacheRef.current.get(request.frameKey);
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
            if (previewClock.getSnapshot().isPlaying && hasFrameRef.current) {
              consecutivePlaybackFailuresRef.current += 1;
              if (
                consecutivePlaybackFailuresRef.current <=
                PLAYBACK_FAILURE_TOLERANCE_FRAMES
              ) {
                // A request can briefly land between adjacent clips because
                // the preview clock and source frame timestamps use different
                // timebases. Keep the last/preloaded frame and let the next RAF
                // recover instead of flashing a one-frame decode error.
                setPreviewState("ready");
                setPreviewError(undefined);
                continue;
              }
            }
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
    transitionFrameCacheRef.current.clear();
    transitionPrefetchPendingRef.current.clear();
    consecutivePlaybackFailuresRef.current = 0;
    activeFrameKeyRef.current = frameKeyForTime(playheadRef.current);
    hasFrameRef.current = false;
    stopPreviewAudio();
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
        preloadNextClipRef.current(playheadRef.current);
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
      transitionFrameCacheRef.current.clear();
      transitionPrefetchPendingRef.current.clear();
      consecutivePlaybackFailuresRef.current = 0;
      hasFrameRef.current = false;
      stopPreviewAudio();
      if (sessionIdRef.current) {
        void desktopApi.nativeMedia.dispose({ targetId: sessionIdRef.current });
        sessionIdRef.current = undefined;
      }
    };
  }, [clearCanvas, frameKeyForTime, nativeTimeline, stopPreviewAudio]);

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
        preloadNextClipRef.current(nextTimelineTime);

        // Once a real frame from the new clip is available, older transition
        // frames no longer need to remain in renderer memory.
        for (const cachedKey of transitionFrameCacheRef.current.keys()) {
          if (cachedKey < frameKey) transitionFrameCacheRef.current.delete(cachedKey);
        }

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
        stopPreviewAudio();
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
    setPlayhead,
    stopPreviewAudio
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
      void startPreviewAudio(startTime);
      preloadNextClipRef.current(startTime);
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
    stopPreviewAudio();
    skipNextPausedRenderRef.current = true;
    setPlayhead(pausedTime, { markProjectDirty: false });
    setIsPlaying(false);
  };

  useEffect(() => {
    return previewClock.subscribe((snapshot) => {
      if (snapshot.isPlaying || !isPlaying) return;
      const sessionId = sessionIdRef.current;
      if (sessionId) void desktopApi.nativeMedia.pause({ sessionId });
      stopPreviewAudio();
      playheadRef.current = snapshot.time;
      setPreviewTime(snapshot.time);
      activeFrameKeyRef.current = frameKeyForTime(snapshot.time);
      setIsPlaying(false);
      void renderAtRef.current(snapshot.time, true);
    });
  }, [frameKeyForTime, isPlaying, stopPreviewAudio]);

  const seekBy = (delta: number) => {
    const nextTime = Math.max(0, Math.min(playbackEndSec, previewTime + delta));
    playheadRef.current = nextTime;
    setPreviewTime(nextTime);
    previewClock.seek(nextTime);
    activeFrameKeyRef.current = frameKeyForTime(nextTime);
    setPlayhead(nextTime);
    if (isPlaying) {
      playbackStartTimelineRef.current = nextTime;
      playbackStartPerformanceRef.current = performance.now();
      playbackLastFrameKeyRef.current = activeFrameKeyRef.current;
      previewClock.seek(nextTime);
      void startPreviewAudio(nextTime);
    }
    void renderAt(nextTime, true);
  };

  const showNativeCanvas = hasNativeVideoAtPlayhead;
  const canPlay = Boolean(sessionIdRef.current && nativeTimeline);
  const shouldShowNativeStatus =
    previewState !== "ready" &&
    (previewState !== "loading" && previewState !== "decode-pending"
      ? true
      : showTransientStatus);

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
            {shouldShowNativeStatus ? (
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
      .filter(
        (asset) =>
          (asset.kind === "video" || asset.kind === "audio") && Boolean(asset.absolutePath)
      )
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

  const toNativeClip = (clip: EditorTimelineClip) => ({
    id: clip.id,
    assetId: clip.assetId,
    trackId: clip.trackId,
    name: "Preview clip",
    sourceIn: clip.sourceIn,
    sourceOut: clip.sourceOut,
    timelineStart: clip.timelineStart,
    timelineEnd: clip.timelineStart + clip.durationSec,
    speed: 1,
    opacity: 1
  });
  const audioTracks = (["source-audio-1", "voiceover-1", "music-1"] as const)
    .map((trackId, order) => ({
      id: trackId,
      kind: "audio" as const,
      name: trackId,
      order: order + 1,
      locked: false,
      muted: false,
      visible: true,
      clips: clips
        .filter((clip) => clip.trackId === trackId && Boolean(assetPaths[clip.assetId]))
        .map(toNativeClip)
    }))
    .filter((track) => track.clips.length > 0);

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
          clips: videoClips.map(toNativeClip)
        },
        ...audioTracks
      ]
    }
  };
}

interface PreviewWebglRenderer {
  clear(): void;
  draw(frame: NativeVideoFrame, pixels: Uint8Array): void;
  resize(width: number, height: number): void;
}

function createPreviewWebglRenderer(canvas: HTMLCanvasElement): PreviewWebglRenderer | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    desynchronized: true,
    preserveDrawingBuffer: false
  });
  if (!gl) return null;

  const vertex = gl.createShader(gl.VERTEX_SHADER);
  const fragment = gl.createShader(gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  const texture = gl.createTexture();
  const vertexBuffer = gl.createBuffer();
  if (!vertex || !fragment || !program || !texture || !vertexBuffer) return null;

  gl.shaderSource(
    vertex,
    `#version 300 es
      in vec2 aPosition;
      out vec2 vUv;
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
        vUv = vec2((aPosition.x + 1.0) * 0.5, 1.0 - (aPosition.y + 1.0) * 0.5);
      }`
  );
  gl.shaderSource(
    fragment,
    `#version 300 es
      precision mediump float;
      uniform sampler2D uFrame;
      in vec2 vUv;
      out vec4 outColor;
      void main() { outColor = texture(uFrame, vUv); }`
  );
  gl.compileShader(vertex);
  gl.compileShader(fragment);
  if (!gl.getShaderParameter(vertex, gl.COMPILE_STATUS) || !gl.getShaderParameter(fragment, gl.COMPILE_STATUS)) {
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

  const position = gl.getAttribLocation(program, "aPosition");
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, "uFrame"), 0);

  const resize = (width: number, height: number) => gl.viewport(0, 0, width, height);
  resize(canvas.width, canvas.height);

  return {
    clear: () => {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    resize,
    draw: (frame, pixels) => {
      gl.viewport(0, 0, frame.width, frame.height);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, frame.stride === frame.width * 4 ? 0 : frame.stride / 4);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        frame.width,
        frame.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels
      );
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  };
}

function frameToPixelUpload(
  frame: NativeVideoFrame,
  reusable?: ImageData
): { pixels: Uint8Array; image?: ImageData } {
  const image = frameToImageData(frame, reusable);
  return { pixels: image.data, image };
}

function frameToImageData(frame: NativeVideoFrame, reusable?: ImageData): ImageData {
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

function nativeAudioToWebAudioBuffer(
  context: AudioContext,
  nativeBuffer: NativeAudioBuffer
): AudioBuffer {
  if (nativeBuffer.data.kind !== "inline") {
    throw new Error("Web Audio 预览仅支持内联 PCM 音频缓冲区。");
  }
  if (nativeBuffer.format !== "f32le" && nativeBuffer.format !== "s16le") {
    throw new Error(`不支持的原生 PCM 格式：${nativeBuffer.format}`);
  }
  const binary = atob(nativeBuffer.data.data);
  const bytesPerSample = nativeBuffer.format === "f32le" ? 4 : 2;
  const expectedByteLength = nativeBuffer.frames * nativeBuffer.channels * bytesPerSample;
  if (binary.length < expectedByteLength) {
    throw new Error("原生 PCM 音频缓冲区长度不足。");
  }
  const data = new Uint8Array(expectedByteLength);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = binary.charCodeAt(index);
  }
  const view = new DataView(data.buffer);
  const buffer = context.createBuffer(
    nativeBuffer.channels,
    nativeBuffer.frames,
    nativeBuffer.sampleRate
  );
  for (let channel = 0; channel < nativeBuffer.channels; channel += 1) {
    const output = buffer.getChannelData(channel);
    for (let frame = 0; frame < nativeBuffer.frames; frame += 1) {
      const offset = (frame * nativeBuffer.channels + channel) * bytesPerSample;
      output[frame] =
        nativeBuffer.format === "f32le"
          ? view.getFloat32(offset, true)
          : view.getInt16(offset, true) / 32768;
    }
  }
  return buffer;
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
