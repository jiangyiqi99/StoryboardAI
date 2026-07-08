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
import type { MutableRefObject } from "react";
import { useEditor } from "../../app/EditorContext";
import { formatTimecode } from "../../app/mediaImport";
import { rgbColorToCss } from "../../app/solidColor";
import type { TimelinePreviewTarget } from "../../app/EditorContext";

type VideoBufferIndex = 0 | 1;

interface VideoBufferState {
  sourceKey: string;
  url?: string;
  poster?: string;
  sourceTime: number;
}

interface VideoBufferRequest {
  sourceKey: string;
  url: string;
  poster?: string;
  sourceTime: number;
}

const emptyVideoBuffer = (index: VideoBufferIndex): VideoBufferState => ({
  sourceKey: `empty-${index}`,
  sourceTime: 0
});

export const Preview = () => {
  const {
    playheadSec,
    resolveTimelinePreview,
    selectedAsset,
    setPlayhead,
    timelineClips,
    timelineDurationSec,
    timelineFps
  } = useEditor();
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([null, null]);
  const autoPlayOnSourceChangeRef = useRef(false);
  const activeBufferIndexRef = useRef<VideoBufferIndex>(0);
  const videoBuffersRef = useRef<[VideoBufferState, VideoBufferState]>([
    emptyVideoBuffer(0),
    emptyVideoBuffer(1)
  ]);
  const isPlayingRef = useRef(false);
  const pendingSeekTimeRef = useRef<number | undefined>();
  const playbackLastCommitPerformanceRef = useRef(0);
  const playbackSourceKeyRef = useRef<string | undefined>();
  const playbackStartPerformanceRef = useRef(0);
  const playbackStartTimelineRef = useRef(0);
  const suppressPauseRef = useRef(false);
  const sourceTimeRef = useRef(0);
  const [activeBufferIndex, setActiveBufferIndex] = useState<VideoBufferIndex>(0);
  const [videoBuffers, setVideoBuffers] = useState<[VideoBufferState, VideoBufferState]>([
    emptyVideoBuffer(0),
    emptyVideoBuffer(1)
  ]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const timelinePreview = resolveTimelinePreview(playheadSec);
  const hasTimelineClips = timelineClips.length > 0;
  const previewAsset = timelinePreview?.asset ?? (hasTimelineClips ? undefined : selectedAsset);
  const mediaUrl = previewAsset?.fileUrl ?? previewAsset?.objectUrl;
  const canPlayVideo = previewAsset?.kind === "video" && Boolean(mediaUrl);
  const sourceTime = timelinePreview?.sourceTime ?? currentTime;
  const sourceKey = timelinePreview
    ? getTimelinePreviewSourceKey(timelinePreview)
    : `${previewAsset?.id ?? "empty"}:asset`;
  const displayTime = hasTimelineClips ? playheadSec : currentTime;
  const timelinePlaybackEndSec = useMemo(
    () =>
      timelineClips.reduce(
        (maxEnd, clip) => Math.max(maxEnd, clip.timelineStart + clip.durationSec),
        0
      ),
    [timelineClips]
  );
  const currentBufferRequest = useMemo<VideoBufferRequest | undefined>(() => {
    if (!canPlayVideo || !mediaUrl) {
      return undefined;
    }

    return {
      sourceKey,
      url: mediaUrl,
      poster: previewAsset?.thumbnailUrl,
      sourceTime
    };
  }, [canPlayVideo, mediaUrl, previewAsset?.thumbnailUrl, sourceKey, sourceTime]);
  const nextTimelinePreview = useMemo(() => {
    const clip = timelinePreview?.clip;
    if (!clip) {
      return undefined;
    }

    const nextTimelineTime = Math.min(
      timelineDurationSec,
      clip.timelineStart + clip.durationSec
    );
    const nextPreview =
      resolveTimelinePreview(nextTimelineTime) ??
      resolveTimelinePreview(Math.min(timelineDurationSec, nextTimelineTime + 0.001));

    return nextPreview?.clip.id === clip.id ? undefined : nextPreview;
  }, [resolveTimelinePreview, timelineDurationSec, timelinePreview?.clip]);
  const nextBufferRequest = useMemo(
    () => getVideoBufferRequest(nextTimelinePreview),
    [nextTimelinePreview]
  );
  const activeBuffer = videoBuffers[activeBufferIndex];
  const standbyBufferIndex = getStandbyBufferIndex(activeBufferIndex);
  const standbyBuffer = videoBuffers[standbyBufferIndex];

  useEffect(() => {
    sourceTimeRef.current = sourceTime;
  }, [sourceTime]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    activeBufferIndexRef.current = activeBufferIndex;
  }, [activeBufferIndex]);

  useEffect(() => {
    videoBuffersRef.current = videoBuffers;
  }, [videoBuffers]);

  useEffect(() => {
    setVideoBuffers((current) => {
      const activeIndex = activeBufferIndexRef.current;
      const activeBuffer = current[activeIndex];
      const nextActiveBuffer = currentBufferRequest
        ? {
            ...activeBuffer,
            ...currentBufferRequest
          }
        : emptyVideoBuffer(activeIndex);

      if (
        activeBuffer.sourceKey === nextActiveBuffer.sourceKey &&
        activeBuffer.url === nextActiveBuffer.url &&
        activeBuffer.poster === nextActiveBuffer.poster
      ) {
        return current;
      }

      return replaceVideoBuffer(current, activeIndex, nextActiveBuffer);
    });
  }, [
    currentBufferRequest?.poster,
    currentBufferRequest?.sourceKey,
    currentBufferRequest?.url
  ]);

  useEffect(() => {
    setVideoBuffers((current) => {
      const standbyIndex = getStandbyBufferIndex(activeBufferIndexRef.current);
      const currentStandbyBuffer = current[standbyIndex];
      const nextStandbyBuffer = nextBufferRequest
        ? {
            ...currentStandbyBuffer,
            ...nextBufferRequest
          }
        : emptyVideoBuffer(standbyIndex);

      if (
        currentStandbyBuffer.sourceKey === nextStandbyBuffer.sourceKey &&
        currentStandbyBuffer.url === nextStandbyBuffer.url &&
        currentStandbyBuffer.poster === nextStandbyBuffer.poster &&
        Math.abs(currentStandbyBuffer.sourceTime - nextStandbyBuffer.sourceTime) <= 0.001
      ) {
        return current;
      }

      return replaceVideoBuffer(current, standbyIndex, nextStandbyBuffer);
    });
  }, [
    activeBufferIndex,
    nextBufferRequest?.poster,
    nextBufferRequest?.sourceKey,
    nextBufferRequest?.sourceTime,
    nextBufferRequest?.url
  ]);

  const seekVideo = useCallback((time: number) => {
    const video = videoRefs.current[activeBufferIndexRef.current];
    if (!video || !Number.isFinite(time)) {
      return false;
    }

    const nextTime = Math.max(0, time);
    if (video.readyState < 1) {
      pendingSeekTimeRef.current = nextTime;
      return false;
    }

    if (Math.abs(video.currentTime - nextTime) > 0.04) {
      video.currentTime = nextTime;
    }
    pendingSeekTimeRef.current = undefined;
    return true;
  }, []);

  const seekVideoAndWait = useCallback(async (time: number) => {
    const video = videoRefs.current[activeBufferIndexRef.current];
    if (!video || !Number.isFinite(time)) {
      return;
    }

    const nextTime = Math.max(0, time);
    if (video.readyState < 1) {
      pendingSeekTimeRef.current = nextTime;
      await waitForMediaEvent(video, "loadedmetadata", 700);
    }

    if (Math.abs(video.currentTime - nextTime) <= 0.04) {
      pendingSeekTimeRef.current = undefined;
      setCurrentTime(nextTime);
      return;
    }

    video.currentTime = nextTime;
    setCurrentTime(nextTime);
    pendingSeekTimeRef.current = undefined;
    await waitForMediaEvent(video, "seeked", 700);
  }, []);

  useEffect(() => {
    const video = videoRefs.current[activeBufferIndex];
    if (!video || !activeBuffer.url) {
      pendingSeekTimeRef.current = undefined;
      setCurrentTime(0);
      setIsPlaying(false);
      return;
    }

    const initialSourceTime = activeBuffer.sourceTime;
    const shouldResumePlayback =
      canPlayVideo && (autoPlayOnSourceChangeRef.current || isPlayingRef.current);
    autoPlayOnSourceChangeRef.current = false;

    const isAlreadyPlayingCorrectly =
      shouldResumePlayback &&
      !video.paused &&
      !video.ended &&
      video.readyState >= 2 &&
      Math.abs(video.currentTime - initialSourceTime) < 1.5;

    if (isAlreadyPlayingCorrectly) {
      pendingSeekTimeRef.current = undefined;
      setCurrentTime(video.currentTime);
      setIsPlaying(true);
      return;
    }

    pendingSeekTimeRef.current = canPlayVideo ? initialSourceTime : undefined;
    const shouldLoad = video.readyState < 1;
    if (shouldLoad) {
      suppressPauseRef.current = true;
      video.pause();
      video.load();
      window.setTimeout(() => {
        suppressPauseRef.current = false;
      }, 0);
    }
    setCurrentTime(canPlayVideo ? initialSourceTime : 0);

    if (!shouldResumePlayback) {
      setIsPlaying(false);
      return;
    }

    let cancelled = false;

    const attemptPlay = async () => {
      await seekVideoAndWait(initialSourceTime);
      if (cancelled) return;
      try {
        await video.play();
        if (!cancelled) setIsPlaying(true);
      } catch {
        if (cancelled) return;
        try {
          video.muted = true;
          await video.play();
          if (!cancelled) setIsPlaying(true);
        } catch {
          if (!cancelled && !hasTimelineClips) setIsPlaying(false);
        }
      }
    };

    void attemptPlay();

    return () => {
      cancelled = true;
    };
  }, [
    activeBuffer.sourceKey,
    activeBuffer.url,
    activeBufferIndex,
    canPlayVideo,
    hasTimelineClips,
    seekVideoAndWait
  ]);

  useEffect(() => {
    if (!canPlayVideo) {
      return;
    }

    if (hasTimelineClips && isPlaying) {
      return;
    }

    seekVideo(sourceTime);
    if (!isPlaying) {
      setCurrentTime(sourceTime);
    }
  }, [canPlayVideo, hasTimelineClips, isPlaying, seekVideo, sourceTime]);

  useEffect(() => {
    const standbyVideo = videoRefs.current[standbyBufferIndex];
    if (!standbyVideo || !standbyBuffer.url) {
      return;
    }

    let cancelled = false;
    const nextSourceTime = Math.max(0, standbyBuffer.sourceTime);
    const warmSeek = () => {
      if (cancelled || standbyVideo.readyState < 1) {
        return;
      }

      if (Math.abs(standbyVideo.currentTime - nextSourceTime) > 0.04) {
        standbyVideo.currentTime = nextSourceTime;
      }
    };

    standbyVideo.load();
    warmSeek();
    standbyVideo.addEventListener("loadedmetadata", warmSeek);

    return () => {
      cancelled = true;
      standbyVideo.removeEventListener("loadedmetadata", warmSeek);
    };
  }, [
    standbyBuffer.sourceKey,
    standbyBuffer.sourceTime,
    standbyBuffer.url,
    standbyBufferIndex
  ]);

  useEffect(() => {
    if (!isPlaying || !hasTimelineClips) {
      return;
    }

    const playbackEndSec = timelinePlaybackEndSec || timelineDurationSec;
    let frameId = 0;

    const tick = () => {
      const now = performance.now();
      const elapsedSec = (now - playbackStartPerformanceRef.current) / 1000;
      const nextTimelineTime = Math.min(
        playbackEndSec,
        playbackStartTimelineRef.current + elapsedSec
      );
      const nextPreview =
        resolveTimelinePreview(nextTimelineTime) ??
        resolveTimelinePreview(Math.min(playbackEndSec, nextTimelineTime + 0.001));
      const nextSourceKey = nextPreview
        ? getTimelinePreviewSourceKey(nextPreview)
        : undefined;

      if (
        nextPreview &&
        nextSourceKey &&
        playbackSourceKeyRef.current &&
        nextSourceKey !== playbackSourceKeyRef.current
      ) {
        const activeVideo = videoRefs.current[activeBufferIndexRef.current];
        playbackSourceKeyRef.current = nextSourceKey;

        if (activeVideo) {
          const didPromoteBuffer = promoteStandbyBuffer({
            activeVideo,
            nextPreview,
            setVideoBuffers,
            setActiveBufferIndex,
            setCurrentTime,
            activeBufferIndexRef,
            autoPlayOnSourceChangeRef,
            suppressPauseRef,
            videoBuffersRef,
            videoRefs
          });

          if (!didPromoteBuffer) {
            autoPlayOnSourceChangeRef.current = true;
          }
        }
      }

      const shouldCommitPlayhead =
        nextTimelineTime >= playbackEndSec - 0.001 ||
        now - playbackLastCommitPerformanceRef.current >= 33;
      if (shouldCommitPlayhead) {
        playbackLastCommitPerformanceRef.current = now;
        setPlayhead(nextTimelineTime);
      }

      if (nextTimelineTime >= playbackEndSec - 0.001) {
        pauseAllVideos(videoRefs);
        setIsPlaying(false);
        return;
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [
    hasTimelineClips,
    isPlaying,
    resolveTimelinePreview,
    setPlayhead,
    timelineDurationSec,
    timelinePlaybackEndSec
  ]);

  const handlePlay = async () => {
    const video = videoRefs.current[activeBufferIndexRef.current];
    if (!video || !canPlayVideo) {
      return;
    }

    const playbackEndSec = timelinePlaybackEndSec || timelineDurationSec;
    const playbackStartSec =
      hasTimelineClips && playheadSec >= playbackEndSec - 0.001 ? 0 : playheadSec;

    playbackStartTimelineRef.current = playbackStartSec;
    playbackStartPerformanceRef.current = performance.now();
    playbackLastCommitPerformanceRef.current = 0;
    playbackSourceKeyRef.current = timelinePreview
      ? getTimelinePreviewSourceKey(timelinePreview)
      : undefined;

    if (hasTimelineClips && playbackStartSec !== playheadSec) {
      setPlayhead(playbackStartSec);
    }

    if (timelinePreview) {
      await seekVideoAndWait(timelinePreview.sourceTime);
    }

    try {
      await video.play();
    } catch {
      if (!hasTimelineClips) {
        setIsPlaying(false);
        return;
      }
    }
    setIsPlaying(true);
  };

  const handlePause = () => {
    const video = videoRefs.current[activeBufferIndexRef.current];
    if (!video) {
      return;
    }

    pauseAllVideos(videoRefs);
    setIsPlaying(false);
  };

  const handleLoadedMetadata = () => {
    const pendingSeekTime = pendingSeekTimeRef.current;
    if (pendingSeekTime === undefined) {
      return;
    }

    seekVideo(pendingSeekTime);
    setCurrentTime(pendingSeekTime);
  };

  const seekBy = (delta: number) => {
    if (hasTimelineClips) {
      setPlayhead(Math.max(0, Math.min(timelineDurationSec, playheadSec + delta)));
      return;
    }

    const video = videoRefs.current[activeBufferIndexRef.current];
    if (!video) {
      return;
    }

    const nextTime = Math.max(0, Math.min(video.duration || Number.MAX_SAFE_INTEGER, video.currentTime + delta));
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const frameStep = useMemo(
    () => 1 / (timelineFps ?? previewAsset?.fps ?? 24),
    [previewAsset?.fps, timelineFps]
  );
  const displayImage = previewAsset?.solidColor
    ? undefined
    : previewAsset?.thumbnailUrl ?? previewAsset?.fileUrl ?? previewAsset?.objectUrl;

  return (
    <section className="panel preview-panel" data-panel="preview">
      <div className="preview-head">
        <button className="sequence-button" type="button">
          序列 01
          <span>⌄</span>
        </button>
        <div className="preview-controls">
          <button className="preview-control fit" type="button">
            <span>适合窗口</span>
          </button>
          <button className="preview-control scale" type="button">
            <span>1/4</span>
          </button>
          <button className="preview-control icon" title="截图" type="button">
            <Camera size={17} />
          </button>
        </div>
      </div>

      <div className="viewer">
        {canPlayVideo ? (
          videoBuffers.map((buffer, index) => {
            const bufferIndex = index as VideoBufferIndex;
            const isActive = bufferIndex === activeBufferIndex;

            return (
              <video
                aria-hidden={!isActive}
                className={isActive ? "viewer-video-buffer is-active" : "viewer-video-buffer"}
                controls={false}
                key={bufferIndex}
                muted={!isActive}
                onEnded={() => {
                  if (!hasTimelineClips && bufferIndex === activeBufferIndexRef.current) {
                    setIsPlaying(false);
                  }
                }}
                onLoadedMetadata={() => {
                  if (bufferIndex === activeBufferIndexRef.current) {
                    handleLoadedMetadata();
                  }
                }}
                onPause={() => {
                  if (
                    !hasTimelineClips &&
                    bufferIndex === activeBufferIndexRef.current &&
                    !suppressPauseRef.current
                  ) {
                    setIsPlaying(false);
                  }
                }}
                onPlay={() => {
                  if (bufferIndex === activeBufferIndexRef.current) {
                    setIsPlaying(true);
                  }
                }}
                onTimeUpdate={(event) => {
                  if (bufferIndex === activeBufferIndexRef.current) {
                    setCurrentTime(event.currentTarget.currentTime);
                  }
                }}
                playsInline
                poster={buffer.poster}
                preload="auto"
                ref={(node) => {
                  videoRefs.current[bufferIndex] = node;
                }}
                src={buffer.url}
                tabIndex={isActive ? undefined : -1}
              />
            );
          })
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
        <time>{formatTimecode(displayTime, timelineFps ?? previewAsset?.fps)}</time>
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
            <button
              className="play-button"
              disabled={!canPlayVideo}
              onClick={handlePlay}
              title="播放"
              type="button"
            >
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
          <div className="volume-line">
            <span />
          </div>
          <Maximize2 size={16} />
        </div>
      </div>
    </section>
  );
};

function getTimelinePreviewSourceKey(preview: TimelinePreviewTarget): string {
  return [
    preview.asset.id,
    preview.clip.id,
    preview.clip.sourceIn,
    preview.clip.sourceOut
  ].join(":");
}

function getVideoBufferRequest(
  preview: TimelinePreviewTarget | undefined
): VideoBufferRequest | undefined {
  if (!preview || preview.asset.kind !== "video") {
    return undefined;
  }

  const url = preview.asset.fileUrl ?? preview.asset.objectUrl;
  if (!url) {
    return undefined;
  }

  return {
    sourceKey: getTimelinePreviewSourceKey(preview),
    url,
    poster: preview.asset.thumbnailUrl,
    sourceTime: preview.sourceTime
  };
}

function getStandbyBufferIndex(activeBufferIndex: VideoBufferIndex): VideoBufferIndex {
  return activeBufferIndex === 0 ? 1 : 0;
}

function replaceVideoBuffer(
  buffers: [VideoBufferState, VideoBufferState],
  index: VideoBufferIndex,
  buffer: VideoBufferState
): [VideoBufferState, VideoBufferState] {
  return index === 0 ? [buffer, buffers[1]] : [buffers[0], buffer];
}

function pauseAllVideos(
  videoRefs: MutableRefObject<Array<HTMLVideoElement | null>>
): void {
  videoRefs.current.forEach((video) => video?.pause());
}

function promoteStandbyBuffer({
  activeVideo,
  nextPreview,
  setVideoBuffers,
  setActiveBufferIndex,
  setCurrentTime,
  activeBufferIndexRef,
  autoPlayOnSourceChangeRef,
  suppressPauseRef,
  videoBuffersRef,
  videoRefs
}: {
  activeVideo: HTMLVideoElement;
  nextPreview: TimelinePreviewTarget;
  setVideoBuffers(
    updater: (buffers: [VideoBufferState, VideoBufferState]) => [VideoBufferState, VideoBufferState]
  ): void;
  setActiveBufferIndex(index: VideoBufferIndex): void;
  setCurrentTime(time: number): void;
  activeBufferIndexRef: MutableRefObject<VideoBufferIndex>;
  autoPlayOnSourceChangeRef: MutableRefObject<boolean>;
  suppressPauseRef: MutableRefObject<boolean>;
  videoBuffersRef: MutableRefObject<[VideoBufferState, VideoBufferState]>;
  videoRefs: MutableRefObject<Array<HTMLVideoElement | null>>;
}): boolean {
  const activeIndex = activeBufferIndexRef.current;
  const standbyIndex = getStandbyBufferIndex(activeIndex);
  const standbyVideo = videoRefs.current[standbyIndex];
  const standbyBuffer = videoBuffersRef.current[standbyIndex];
  const nextRequest = getVideoBufferRequest(nextPreview);

  if (!nextRequest) {
    return false;
  }

  const hasPreparedStandby =
    Boolean(standbyVideo) &&
    standbyBuffer.sourceKey === nextRequest.sourceKey &&
    standbyBuffer.url === nextRequest.url;

  activeVideo.muted = true;
  suppressPauseRef.current = true;
  window.setTimeout(() => {
    suppressPauseRef.current = false;
  }, 250);

  autoPlayOnSourceChangeRef.current = true;
  activeBufferIndexRef.current = standbyIndex;

  setVideoBuffers((current) =>
    replaceVideoBuffer(current, standbyIndex, {
      ...current[standbyIndex],
      ...nextRequest
    })
  );
  setCurrentTime(nextRequest.sourceTime);
  setActiveBufferIndex(standbyIndex);

  if (standbyVideo && hasPreparedStandby && standbyVideo.readyState >= 1) {
    standbyVideo.muted = false;
    if (Math.abs(standbyVideo.currentTime - nextRequest.sourceTime) > 0.06) {
      standbyVideo.currentTime = nextRequest.sourceTime;
    }

    void standbyVideo.play().catch(() => {
      autoPlayOnSourceChangeRef.current = true;
    });
  }

  window.setTimeout(() => activeVideo.pause(), 80);

  return true;
}

function waitForMediaEvent(
  video: HTMLVideoElement,
  eventName: keyof HTMLMediaElementEventMap,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      video.removeEventListener(eventName, finish);
      resolve();
    };
    const timeoutId = window.setTimeout(finish, timeoutMs);

    video.addEventListener(eventName, finish, { once: true });
  });
}
