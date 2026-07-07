import {
  Crop,
  Mic2,
  MousePointer2,
  Music2,
  Scissors,
  Settings2,
  Text,
  Trash2,
  Volume2,
  WandSparkles,
  ZoomIn
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { useEditor } from "../../app/EditorContext";
import type { EditorTimelineClip, EditorTimelineTrackId } from "../../app/editorTypes";
import { formatFps, formatTimecode } from "../../app/mediaImport";
import { desktopApi } from "../../ipc/api";

const trackLabels = [
  { id: "video-1", code: "V", name: "视频" },
  { id: "source-audio-1", code: "VA", name: "视频原声" },
  { id: "voiceover-1", code: "VO", name: "配音" },
  { id: "music-1", code: "BGM", name: "背景音乐" }
] satisfies Array<{ id: EditorTimelineTrackId; code: string; name: string }>;

interface HoverPreview {
  time: number;
  x: number;
  assetName?: string;
  frameUrl?: string;
  sourceTime?: number;
  sourceFps?: number;
  loading?: boolean;
}

interface ClipDragState {
  clipId: string;
  grabOffsetSec: number;
  pointerId: number;
}

export const Timeline = () => {
  const {
    addAssetToTimeline,
    assets,
    deleteClip,
    playheadSec,
    resolveTimelinePreview,
    moveClip,
    selectClip,
    selectedClip,
    selectedClipId,
    setPlayhead,
    splitClip,
    timelineClips,
    timelineDurationSec,
    timelineFps
  } = useEditor();
  const canvasRef = useRef<HTMLDivElement>(null);
  const latestFrameRequest = useRef(0);
  const [dragState, setDragState] = useState<ClipDragState | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);

  const markers = useMemo(
    () =>
      Array.from({ length: 8 }, (_marker, index) =>
        formatTimecode((timelineDurationSec / 7) * index, timelineFps)
      ),
    [timelineDurationSec, timelineFps]
  );

  const getTimeFromClientX = (clientX: number): number => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) {
      return 0;
    }

    const x = Math.max(0, Math.min(bounds.width, clientX - bounds.left));
    return Math.round((x / bounds.width) * timelineDurationSec * 10) / 10;
  };

  const getCanvasX = (clientX: number): number => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) {
      return 0;
    }

    return Math.max(0, Math.min(bounds.width, clientX - bounds.left));
  };

  const getDropTrackId = (clientY: number): EditorTimelineTrackId => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) {
      return "music-1";
    }

    const rulerHeight = 31;
    const rowHeight = (bounds.height - rulerHeight) / trackLabels.length;
    const rowIndex = Math.max(
      0,
      Math.min(trackLabels.length - 1, Math.floor((clientY - bounds.top - rulerHeight) / rowHeight))
    );

    return trackLabels[rowIndex]?.id ?? "music-1";
  };

  const splitCandidate = useMemo(() => {
    if (selectedClip && canSplitClipAtTime(selectedClip, playheadSec)) {
      return selectedClip;
    }

    const previewClip = resolveTimelinePreview(playheadSec)?.clip;
    if (previewClip && canSplitClipAtTime(previewClip, playheadSec)) {
      return previewClip;
    }

    return timelineClips.find((clip) => canSplitClipAtTime(clip, playheadSec));
  }, [playheadSec, resolveTimelinePreview, selectedClip, timelineClips]);

  const canDeleteClip = Boolean(selectedClipId);

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes("application/x-aiv-clip-id")
      ? "move"
      : "copy";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const dropTime = getTimeFromClientX(event.clientX);
    const assetId = event.dataTransfer.getData("application/x-aiv-asset-id");
    const clipId = event.dataTransfer.getData("application/x-aiv-clip-id");

    if (clipId) {
      moveClip(clipId, dropTime);
      setPlayhead(dropTime);
      return;
    }

    if (assetId) {
      addAssetToTimeline(assetId, dropTime, getDropTrackId(event.clientY));
    }
  };

  const handleDeleteClick = () => {
    if (!selectedClipId) {
      return;
    }

    deleteClip(selectedClipId);
  };

  const handleSplitClick = () => {
    if (!splitCandidate) {
      return;
    }

    splitClip(splitCandidate.id, playheadSec);
  };

  const handleClipPointerDown = (
    clip: EditorTimelineClip,
    event: PointerEvent<HTMLDivElement>
  ) => {
    if (event.button !== 0) {
      return;
    }

    const pointerTime = getTimeFromClientX(event.clientX);
    const grabOffsetSec = Math.max(
      0,
      Math.min(clip.durationSec, pointerTime - clip.timelineStart)
    );

    event.stopPropagation();
    selectClip(clip.id);
    setHoverPreview(null);
    setIsScrubbing(false);
    setDragState({
      clipId: clip.id,
      grabOffsetSec,
      pointerId: event.pointerId
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleClipPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    const nextStart = getTimeFromClientX(event.clientX) - dragState.grabOffsetSec;
    moveClip(dragState.clipId, nextStart);
    setPlayhead(Math.max(0, nextStart));
  };

  const handleClipPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    setDragState(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".timeline-clip")) {
      return;
    }

    const nextTime = getTimeFromClientX(event.clientX);
    setPlayhead(nextTime);
    setIsScrubbing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const nextTime = getTimeFromClientX(event.clientX);
    const nextX = getCanvasX(event.clientX);
    setHoverPreview((current) => ({
      ...(current ?? {}),
      time: nextTime,
      x: nextX
    }));

    if (isScrubbing) {
      setPlayhead(nextTime);
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    setIsScrubbing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isEditableTarget(event.target) ||
        !selectedClipId ||
        (event.key !== "Delete" && event.key !== "Backspace")
      ) {
        return;
      }

      event.preventDefault();
      deleteClip(selectedClipId);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteClip, selectedClipId]);

  useEffect(() => {
    if (!hoverPreview) {
      return;
    }

    const previewTarget = resolveTimelinePreview(hoverPreview.time);
    if (!previewTarget) {
      setHoverPreview((current) =>
        current?.time === hoverPreview.time
          ? {
              time: current.time,
              x: current.x
            }
          : current
      );
      return;
    }

    const fallbackFrame =
      previewTarget.asset.thumbnailUrl ??
      previewTarget.asset.fileUrl ??
      previewTarget.asset.objectUrl;
    const shouldExtractFrame =
      previewTarget.asset.kind === "video" && Boolean(previewTarget.asset.absolutePath);

    setHoverPreview((current) =>
      current?.time === hoverPreview.time
        ? {
            ...current,
            assetName: previewTarget.asset.name,
            frameUrl: fallbackFrame,
            sourceTime: previewTarget.sourceTime,
            sourceFps: previewTarget.asset.fps,
            loading: shouldExtractFrame
          }
        : current
    );

    if (!shouldExtractFrame || !previewTarget.asset.absolutePath) {
      return;
    }

    const requestId = ++latestFrameRequest.current;
    const timeoutId = window.setTimeout(() => {
      void desktopApi.media
        .extractPreviewFrame({
          absolutePath: previewTarget.asset.absolutePath!,
          time: previewTarget.sourceTime,
          maxWidth: 320
        })
        .then((frame) => {
          if (latestFrameRequest.current !== requestId) {
            return;
          }

          setHoverPreview((current) =>
            current?.time === hoverPreview.time
              ? {
                  ...current,
                  frameUrl: frame.url,
                  loading: false
                }
              : current
          );
        })
        .catch(() => {
          if (latestFrameRequest.current !== requestId) {
            return;
          }

          setHoverPreview((current) =>
            current?.time === hoverPreview.time
              ? {
                  ...current,
                  loading: false
                }
              : current
          );
        });
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [hoverPreview?.time, resolveTimelinePreview]);

  const videoClips = timelineClips.filter((clip) => clip.trackId === "video-1");
  const sourceAudioClips = timelineClips.filter((clip) => clip.trackId === "source-audio-1");
  const voiceoverClips = timelineClips.filter((clip) => clip.trackId === "voiceover-1");
  const musicClips = timelineClips.filter((clip) => clip.trackId === "music-1");

  return (
    <section className="timeline-panel" data-panel="timeline">
      <div className="timeline-toolbar">
        <div className="timeline-toolset">
          <button className="icon-button is-active" title="选择工具" type="button">
            <MousePointer2 size={17} />
          </button>
          <button className="icon-button is-muted" disabled title="AI 工具即将接入" type="button">
            <WandSparkles size={17} />
          </button>
          <button className="icon-button is-muted" disabled title="轨道设置即将接入" type="button">
            <Settings2 size={17} />
          </button>
          <button
            className={splitCandidate ? "icon-button" : "icon-button is-muted"}
            disabled={!splitCandidate}
            onClick={handleSplitClick}
            title={splitCandidate ? "剪切当前片段" : "将播放头移动到片段内部后剪切"}
            type="button"
          >
            <Scissors size={17} />
          </button>
          <button className="icon-button is-muted" disabled title="文本工具即将接入" type="button">
            <Text size={17} />
          </button>
          <button
            className={canDeleteClip ? "icon-button" : "icon-button is-muted"}
            disabled={!canDeleteClip}
            onClick={handleDeleteClick}
            title={canDeleteClip ? "删除选中片段" : "先选择一个片段"}
            type="button"
          >
            <Trash2 size={17} />
          </button>
        </div>
        <div className="timeline-zoom">
          <ZoomIn size={16} />
          <span />
          <Crop size={16} />
        </div>
      </div>

      <div className="timeline-body">
        <aside className="track-header">
          {trackLabels.map(({ code, id, name }) => (
            <div className={id === "video-1" ? "track-label is-active" : "track-label"} key={id}>
              <span>{code}</span>
              <strong>{name}</strong>
              {id === "video-1" ? <Settings2 size={14} /> : <Volume2 size={14} />}
            </div>
          ))}
          <div className="fps-label">项目帧率：{formatFps(timelineFps)}</div>
        </aside>
        <div
          className="timeline-canvas"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onPointerCancel={handlePointerUp}
          onPointerDown={handlePointerDown}
          onPointerLeave={() => {
            if (!isScrubbing && !dragState) {
              setHoverPreview(null);
            }
          }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          ref={canvasRef}
        >
          <div className="time-ruler">
            {markers.map((marker) => (
              <span key={marker}>{marker}</span>
            ))}
          </div>
          <div
            className="playhead"
            style={{
              left: `${(playheadSec / timelineDurationSec) * 100}%`
            }}
          />
          {hoverPreview ? (
            <div
              className="timeline-hover-preview"
              style={{
                left: `${hoverPreview.x}px`
              }}
            >
              <div className="timeline-hover-thumb">
                {hoverPreview.frameUrl ? <img alt="" src={hoverPreview.frameUrl} /> : null}
              </div>
              <div className="timeline-hover-meta">
                <strong>{hoverPreview.assetName ?? "空白时间线"}</strong>
                <time>
                  {formatTimecode(hoverPreview.time, timelineFps)}
                  {hoverPreview.sourceTime !== undefined
                    ? ` · ${formatTimecode(hoverPreview.sourceTime, hoverPreview.sourceFps)}`
                    : ""}
                </time>
              </div>
            </div>
          ) : null}

          <div className="track-row video-row">
            {videoClips.map((clip) => {
              const asset = assets.find((candidate) => candidate.id === clip.assetId);
              const thumbnailUrl = asset?.thumbnailUrl ?? asset?.objectUrl;
              const className = [
                "timeline-clip",
                "video",
                clip.id === selectedClipId ? "selected" : "",
                dragState?.clipId === clip.id ? "is-dragging" : ""
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div
                  className={className}
                  key={clip.id}
                  onPointerCancel={handleClipPointerUp}
                  onPointerDown={(event) => handleClipPointerDown(clip, event)}
                  onPointerMove={handleClipPointerMove}
                  onPointerUp={handleClipPointerUp}
                  style={{
                    left: `${(clip.timelineStart / timelineDurationSec) * 100}%`,
                    width: `${(clip.durationSec / timelineDurationSec) * 100}%`
                  }}
                >
                  {thumbnailUrl ? (
                    <img alt="" draggable={false} src={thumbnailUrl} />
                  ) : (
                    <div className="timeline-clip-empty-thumb" />
                  )}
                  <span>{asset?.name ?? "未命名素材"}</span>
                </div>
              );
            })}
          </div>
          <div className="track-row audio-row">
            {sourceAudioClips.map((clip) =>
              renderAudioClip(
                clip,
                "source",
                assets,
                selectedClipId,
                dragState?.clipId,
                timelineDurationSec,
                handleClipPointerDown,
                handleClipPointerMove,
                handleClipPointerUp
              )
            )}
          </div>
          <div className="track-row audio-row">
            {voiceoverClips.map((clip) =>
              renderAudioClip(
                clip,
                "voiceover",
                assets,
                selectedClipId,
                dragState?.clipId,
                timelineDurationSec,
                handleClipPointerDown,
                handleClipPointerMove,
                handleClipPointerUp
              )
            )}
          </div>
          <div className="track-row audio-row">
            {musicClips.map((clip) =>
              renderAudioClip(
                clip,
                "music",
                assets,
                selectedClipId,
                dragState?.clipId,
                timelineDurationSec,
                handleClipPointerDown,
                handleClipPointerMove,
                handleClipPointerUp
              )
            )}
          </div>

        </div>
      </div>
    </section>
  );
};

function canSplitClipAtTime(clip: EditorTimelineClip, splitTime: number): boolean {
  const minimumSegmentDuration = 0.1;
  const clipStart = clip.timelineStart;
  const clipEnd = clip.timelineStart + clip.durationSec;

  return (
    splitTime > clipStart + minimumSegmentDuration &&
    splitTime < clipEnd - minimumSegmentDuration
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("input, textarea, [contenteditable='true']"))
  );
}

function renderAudioClip(
  clip: EditorTimelineClip,
  tone: "source" | "voiceover" | "music",
  assets: ReturnType<typeof useEditor>["assets"],
  selectedClipId: string | undefined,
  draggingClipId: string | undefined,
  timelineDurationSec: number,
  onClipPointerDown: (
    clip: EditorTimelineClip,
    event: PointerEvent<HTMLDivElement>
  ) => void,
  onClipPointerMove: (event: PointerEvent<HTMLDivElement>) => void,
  onClipPointerUp: (event: PointerEvent<HTMLDivElement>) => void
) {
  const asset = assets.find((candidate) => candidate.id === clip.assetId);
  const Icon = tone === "voiceover" ? Mic2 : Music2;
  const className = [
    "timeline-clip",
    "audio",
    tone,
    clip.id === selectedClipId ? "selected" : "",
    clip.id === draggingClipId ? "is-dragging" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      key={clip.id}
      onPointerCancel={onClipPointerUp}
      onPointerDown={(event) => onClipPointerDown(clip, event)}
      onPointerMove={onClipPointerMove}
      onPointerUp={onClipPointerUp}
      style={{
        left: `${(clip.timelineStart / timelineDurationSec) * 100}%`,
        width: `${(clip.durationSec / timelineDurationSec) * 100}%`
      }}
    >
      <Icon size={14} />
      <span>{tone === "source" ? `${asset?.name ?? "视频"} 原声` : asset?.name ?? "audio.wav"}</span>
    </div>
  );
}
