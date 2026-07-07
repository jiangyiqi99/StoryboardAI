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
import { useEditor } from "../../app/EditorContext";
import { formatTimecode } from "../../app/mediaImport";

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const timelinePreview = resolveTimelinePreview(playheadSec);
  const hasTimelineClips = timelineClips.length > 0;
  const previewAsset = timelinePreview?.asset ?? (hasTimelineClips ? undefined : selectedAsset);
  const mediaUrl = previewAsset?.fileUrl ?? previewAsset?.objectUrl;
  const canPlayVideo = previewAsset?.kind === "video" && Boolean(mediaUrl);
  const sourceTime = timelinePreview?.sourceTime ?? currentTime;
  const sourceKey = `${previewAsset?.id ?? "empty"}:${timelinePreview?.clip.id ?? "asset"}`;
  const displayTime = hasTimelineClips ? playheadSec : currentTime;

  const seekVideo = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(time)) {
      return;
    }

    const nextTime = Math.max(0, time);
    if (Math.abs(video.currentTime - nextTime) > 0.04) {
      video.currentTime = nextTime;
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      setCurrentTime(0);
      setIsPlaying(false);
      return;
    }

    video.pause();
    video.currentTime = 0;
    video.load();
    setCurrentTime(0);
    setIsPlaying(false);
  }, [sourceKey]);

  useEffect(() => {
    if (!canPlayVideo || isPlaying) {
      return;
    }

    seekVideo(sourceTime);
    setCurrentTime(sourceTime);
  }, [canPlayVideo, isPlaying, seekVideo, sourceTime]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const video = videoRef.current;
    const playbackClip = timelinePreview?.clip;
    if (!video) {
      return;
    }

    let frameId = 0;
    const tick = () => {
      const videoTime = video.currentTime;
      setCurrentTime(videoTime);

      if (playbackClip) {
        const clipEnd = playbackClip.timelineStart + playbackClip.durationSec;
        const timelineTime = playbackClip.timelineStart + (videoTime - playbackClip.sourceIn);

        if (videoTime >= playbackClip.sourceOut - 0.01 || timelineTime >= clipEnd) {
          video.pause();
          setIsPlaying(false);
          setPlayhead(Math.min(timelineDurationSec, clipEnd));
          return;
        }

        setPlayhead(timelineTime);
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [
    isPlaying,
    setPlayhead,
    timelineDurationSec,
    timelinePreview?.clip,
    timelinePreview?.clip?.durationSec,
    timelinePreview?.clip?.sourceIn,
    timelinePreview?.clip?.sourceOut,
    timelinePreview?.clip?.timelineStart
  ]);

  const handlePlay = async () => {
    const video = videoRef.current;
    if (!video || !canPlayVideo) {
      return;
    }

    if (timelinePreview) {
      seekVideo(timelinePreview.sourceTime);
    }

    await video.play();
    setIsPlaying(true);
  };

  const handlePause = () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.pause();
    setIsPlaying(false);
  };

  const seekBy = (delta: number) => {
    if (hasTimelineClips) {
      setPlayhead(Math.max(0, Math.min(timelineDurationSec, playheadSec + delta)));
      return;
    }

    const video = videoRef.current;
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
  const displayImage = previewAsset?.thumbnailUrl ?? previewAsset?.fileUrl ?? previewAsset?.objectUrl;

  return (
    <section className="panel preview-panel" data-panel="preview">
      <div className="preview-head">
        <button className="sequence-button" type="button">
          序列 01
          <span>⌄</span>
        </button>
        <div className="preview-controls">
          <button className="select-button" type="button">适合窗口</button>
          <button className="select-button" type="button">1/4</button>
          <button className="icon-button" title="截图" type="button">
            <Camera size={17} />
          </button>
        </div>
      </div>

      <div className="viewer">
        {canPlayVideo ? (
          <video
            controls={false}
            onEnded={() => setIsPlaying(false)}
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            poster={previewAsset?.thumbnailUrl}
            ref={videoRef}
            src={mediaUrl}
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
