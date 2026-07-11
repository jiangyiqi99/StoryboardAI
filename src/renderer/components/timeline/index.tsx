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
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type PointerEvent
} from "react";
import { useEditor } from "../../app/EditorContext";
import { previewClock } from "../../app/previewClock";
import type {
  EditorRgbColor,
  EditorTimelineClip,
  EditorTimelineTrackId
} from "../../app/editorTypes";
import { formatFps, formatTimecode } from "../../app/mediaImport";
import {
  DEFAULT_SOLID_COLOR,
  normalizeRgbColor,
  normalizeSolidDuration,
  rgbColorToCss
} from "../../app/solidColor";
import { desktopApi } from "../../ipc/api";

const trackLabels = [
  { id: "video-1", code: "V", name: "视频" },
  { id: "source-audio-1", code: "VA", name: "视频原声" },
  { id: "voiceover-1", code: "VO", name: "配音" },
  { id: "music-1", code: "BGM", name: "背景音乐" }
] satisfies Array<{ id: EditorTimelineTrackId; code: string; name: string }>;

const ABSOLUTE_MIN_PIXELS_PER_SECOND = 0.01;
const MAX_PIXELS_PER_SECOND = 96;
const DEFAULT_PIXELS_PER_SECOND = 32;
const MIN_TIMELINE_AREA_SEC = 40;
const TRAILING_AREA_SEC = 12;
const FIT_ZOOM_EPSILON = 0.05;

interface HoverPreview {
  time: number;
  x: number;
  assetName?: string;
  frameUrl?: string;
  solidColor?: EditorRgbColor;
  sourceTime?: number;
  sourceFps?: number;
  loading?: boolean;
}

interface ClipDragState {
  clipId: string;
  grabOffsetSec: number;
  pointerId: number;
}

interface PendingSolidDrop {
  timelineStart: number;
  durationSec: number;
}

export const Timeline = () => {
  const {
    addAssetToTimeline,
    addSolidColorToTimeline,
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
  const playheadIndicatorRef = useRef<HTMLDivElement>(null);
  const pixelsPerSecondRef = useRef(DEFAULT_PIXELS_PER_SECOND);
  const latestFrameRequest = useRef(0);
  const [dragState, setDragState] = useState<ClipDragState | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);
  const [pendingSolidDrop, setPendingSolidDrop] = useState<PendingSolidDrop | null>(null);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND);

  useEffect(() => {
    pixelsPerSecondRef.current = pixelsPerSecond;
    const clock = previewClock.getSnapshot();
    if (clock.isPlaying && playheadIndicatorRef.current) {
      playheadIndicatorRef.current.style.left = `${clock.time * pixelsPerSecond}px`;
    }
  }, [pixelsPerSecond]);

  useEffect(() => {
    const updatePlayhead = ({ isPlaying, time }: ReturnType<typeof previewClock.getSnapshot>) => {
      if (!isPlaying || !playheadIndicatorRef.current) {
        return;
      }
      playheadIndicatorRef.current.style.left = `${time * pixelsPerSecondRef.current}px`;
    };

    updatePlayhead(previewClock.getSnapshot());
    return previewClock.subscribe(updatePlayhead);
  }, []);

  const fitTimelineDurationSec = Math.max(MIN_TIMELINE_AREA_SEC, timelineDurationSec);
  const minPixelsPerSecond =
    timelineViewportWidth > 0
      ? clampNumber(
          timelineViewportWidth / Math.max(1, fitTimelineDurationSec),
          ABSOLUTE_MIN_PIXELS_PER_SECOND,
          MAX_PIXELS_PER_SECOND
        )
      : ABSOLUTE_MIN_PIXELS_PER_SECOND;
  const isFitZoom = pixelsPerSecond <= minPixelsPerSecond + FIT_ZOOM_EPSILON;
  const visibleDurationSec =
    timelineViewportWidth > 0 ? timelineViewportWidth / pixelsPerSecond : MIN_TIMELINE_AREA_SEC;
  const trailingAreaSec = isFitZoom
    ? 0
    : Math.max(TRAILING_AREA_SEC, visibleDurationSec * 0.35);
  const timelineAreaDurationSec = Math.max(
    fitTimelineDurationSec,
    timelineDurationSec + trailingAreaSec,
    visibleDurationSec
  );
  const timelineAreaWidth =
    isFitZoom && timelineViewportWidth > 0
      ? timelineViewportWidth
      : Math.ceil(timelineAreaDurationSec * pixelsPerSecond);
  const rulerStepSec = getRulerStepSec(pixelsPerSecond);
  const rulerMarkers = useMemo(
    () =>
      Array.from(
        { length: Math.floor(timelineAreaDurationSec / rulerStepSec) + 1 },
        (_marker, index) => {
          const time = index * rulerStepSec;

          return {
            time,
            label: formatTimecode(time, timelineFps)
          };
        }
      ),
    [rulerStepSec, timelineAreaDurationSec, timelineFps]
  );
  const timelineContentStyle = {
    width: `${timelineAreaWidth}px`,
    "--timeline-minor-grid": `${Math.max(8, (rulerStepSec * pixelsPerSecond) / 4)}px`,
    "--timeline-major-grid": `${Math.max(24, rulerStepSec * pixelsPerSecond)}px`
  } satisfies CSSProperties & Record<"--timeline-minor-grid" | "--timeline-major-grid", string>;

  const getTimeFromClientX = (clientX: number): number => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) {
      return 0;
    }

    const viewportX = Math.max(0, Math.min(bounds.width, clientX - bounds.left));
    const scrollLeft = canvasRef.current?.scrollLeft ?? 0;
    const timelineX = Math.min(timelineAreaWidth, viewportX + scrollLeft);

    return Math.round((timelineX / pixelsPerSecond) * 10) / 10;
  };

  const getTimelineX = (clientX: number): number => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) {
      return 0;
    }

    const viewportX = Math.max(0, Math.min(bounds.width, clientX - bounds.left));
    return Math.min(timelineAreaWidth, viewportX + (canvasRef.current?.scrollLeft ?? 0));
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
    const aiMaterial = event.dataTransfer.getData("application/x-aiv-ai-material");

    if (aiMaterial === "solid-color") {
      const durationSec = normalizeSolidDuration(
        Number(event.dataTransfer.getData("application/x-aiv-solid-duration"))
      );
      setPendingSolidDrop({ timelineStart: dropTime, durationSec });
      return;
    }

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

  const handleZoomChange = (nextPixelsPerSecond: number) => {
    const viewport = canvasRef.current;
    const clampedPixelsPerSecond = clampNumber(
      nextPixelsPerSecond,
      minPixelsPerSecond,
      MAX_PIXELS_PER_SECOND
    );
    const focusTime =
      viewport && pixelsPerSecond > 0
        ? (viewport.scrollLeft + viewport.clientWidth / 2) / pixelsPerSecond
        : playheadSec;

    setPixelsPerSecond(clampedPixelsPerSecond);

    window.requestAnimationFrame(() => {
      if (!viewport) {
        return;
      }

      viewport.scrollLeft =
        clampedPixelsPerSecond <= minPixelsPerSecond + FIT_ZOOM_EPSILON
          ? 0
          : Math.max(0, focusTime * clampedPixelsPerSecond - viewport.clientWidth / 2);
    });
  };

  const handleFitTimelineToViewport = () => {
    const viewport = canvasRef.current;
    if (!viewport) {
      return;
    }

    const fittedPixelsPerSecond = minPixelsPerSecond;

    setPixelsPerSecond(fittedPixelsPerSecond);
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = 0;
    });
  };

  const handleSolidColorConfirm = (
    color: EditorRgbColor,
    durationSec: number
  ) => {
    if (!pendingSolidDrop) {
      return;
    }

    addSolidColorToTimeline(
      {
        color,
        durationSec
      },
      pendingSolidDrop.timelineStart
    );
    setPendingSolidDrop(null);
  };

  const beginScrubbing = (event: PointerEvent<HTMLElement>) => {
    const nextTime = getTimeFromClientX(event.clientX);
    event.stopPropagation();
    setPlayhead(nextTime);
    setIsScrubbing(true);
    canvasRef.current?.setPointerCapture(event.pointerId);
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
    setPlayhead(pointerTime);
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
    const pointerTime = getTimeFromClientX(event.clientX);
    const nextStart = pointerTime - dragState.grabOffsetSec;
    moveClip(dragState.clipId, nextStart);
    setPlayhead(pointerTime);
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

    beginScrubbing(event);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const nextTime = getTimeFromClientX(event.clientX);
    const nextX = getTimelineX(event.clientX);
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
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const updateViewportWidth = () => setTimelineViewportWidth(canvas.clientWidth);
    updateViewportWidth();

    const resizeObserver = new ResizeObserver(updateViewportWidth);
    resizeObserver.observe(canvas);

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    setPixelsPerSecond((current) =>
      clampNumber(current, minPixelsPerSecond, MAX_PIXELS_PER_SECOND)
    );
  }, [minPixelsPerSecond]);

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

    const fallbackFrame = previewTarget.asset.solidColor
      ? undefined
      : previewTarget.asset.thumbnailUrl ??
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
            solidColor: previewTarget.asset.solidColor,
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
          <button
            className="icon-button timeline-zoom-button"
            onClick={() => handleZoomChange(pixelsPerSecond - 8)}
            title="缩小时间线"
            type="button"
          >
            <ZoomOut size={15} />
          </button>
          <input
            aria-label="时间线缩放"
            className="timeline-zoom-slider"
            max={MAX_PIXELS_PER_SECOND}
            min={minPixelsPerSecond}
            onChange={(event) => handleZoomChange(Number(event.currentTarget.value))}
            step="0.1"
            type="range"
            value={pixelsPerSecond}
          />
          <button
            className="icon-button timeline-zoom-button"
            onClick={() => handleZoomChange(pixelsPerSecond + 8)}
            title="放大时间线"
            type="button"
          >
            <ZoomIn size={15} />
          </button>
          <button
            className="icon-button timeline-zoom-button"
            onClick={handleFitTimelineToViewport}
            title="适配当前时间线区域"
            type="button"
          >
            <Crop size={15} />
          </button>
          <span className="timeline-zoom-value">
            {formatPixelsPerSecond(pixelsPerSecond)} px/s
          </span>
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
          <div className="timeline-content" style={timelineContentStyle}>
            <div className="time-ruler">
              {rulerMarkers.map((marker) => (
                <span
                  key={`${marker.time}-${marker.label}`}
                  style={{ left: `${marker.time * pixelsPerSecond}px` }}
                >
                  {marker.label}
                </span>
              ))}
            </div>
            <div
              className="playhead"
              onPointerDown={beginScrubbing}
              ref={playheadIndicatorRef}
              style={{
                left: `${playheadSec * pixelsPerSecond}px`
              }}
            />
            {hoverPreview ? (
              <div
                className="timeline-hover-preview"
                style={{
                  left: `${hoverPreview.x}px`
                }}
              >
                <div
                  className="timeline-hover-thumb"
                  style={
                    hoverPreview.solidColor
                      ? { background: rgbColorToCss(hoverPreview.solidColor) }
                      : undefined
                  }
                >
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
                const thumbnailUrl = asset?.solidColor
                  ? undefined
                  : asset?.thumbnailUrl ?? asset?.objectUrl;
                const className = [
                  "timeline-clip",
                  "video",
                  asset?.variant === "solid-color" ? "solid-color" : "",
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
                      left: `${clip.timelineStart * pixelsPerSecond}px`,
                      width: `${Math.max(8, clip.durationSec * pixelsPerSecond)}px`
                    }}
                  >
                    {thumbnailUrl ? (
                      <img alt="" draggable={false} src={thumbnailUrl} />
                    ) : asset?.solidColor ? (
                      <div
                        className="timeline-clip-solid-thumb"
                        style={{ background: rgbColorToCss(asset.solidColor) }}
                      />
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
                  pixelsPerSecond,
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
                  pixelsPerSecond,
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
                  pixelsPerSecond,
                  handleClipPointerDown,
                  handleClipPointerMove,
                  handleClipPointerUp
                )
              )}
            </div>
          </div>

        </div>
      </div>
      {pendingSolidDrop ? (
        <SolidColorDropDialog
          initialDurationSec={pendingSolidDrop.durationSec}
          onCancel={() => setPendingSolidDrop(null)}
          onConfirm={handleSolidColorConfirm}
        />
      ) : null}
    </section>
  );
};

function SolidColorDropDialog({
  initialDurationSec,
  onCancel,
  onConfirm
}: {
  initialDurationSec: number;
  onCancel(): void;
  onConfirm(color: EditorRgbColor, durationSec: number): void;
}) {
  const [color, setColor] = useState<EditorRgbColor>(DEFAULT_SOLID_COLOR);
  const [durationSec, setDurationSec] = useState(initialDurationSec);
  const normalizedColor = normalizeRgbColor(color);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onConfirm(normalizedColor, normalizeSolidDuration(durationSec));
  };

  const updateChannel = (channel: keyof EditorRgbColor, value: number) => {
    setColor((current) => ({
      ...current,
      [channel]: value
    }));
  };

  return (
    <div
      className="modal-backdrop solid-color-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <form className="export-dialog solid-color-dialog" onSubmit={handleSubmit}>
        <div className="export-dialog-head">
          <div>
            <h2>单色素材</h2>
            <p>RGB 颜色</p>
          </div>
          <button className="icon-button" onClick={onCancel} title="关闭" type="button">
            <X size={17} />
          </button>
        </div>

        <div className="solid-color-picker">
          <div
            className="solid-color-preview"
            style={{ background: rgbColorToCss(normalizedColor) }}
          />
          <div className="rgb-field-grid">
            {(["r", "g", "b"] as const).map((channel) => (
              <label className="field-stack" key={channel}>
                <span>{channel.toUpperCase()}</span>
                <input
                  max="255"
                  min="0"
                  onChange={(event) => updateChannel(channel, Number(event.currentTarget.value))}
                  step="1"
                  type="number"
                  value={color[channel]}
                />
              </label>
            ))}
          </div>
        </div>

        <label className="field-stack">
          <span>时长</span>
          <input
            min="0.2"
            onChange={(event) => setDurationSec(Number(event.currentTarget.value))}
            step="0.1"
            type="number"
            value={durationSec}
          />
        </label>

        <div className="export-dialog-actions">
          <button className="ghost-button compact" onClick={onCancel} type="button">
            取消
          </button>
          <button className="primary-button compact" type="submit">
            添加
          </button>
        </div>
      </form>
    </div>
  );
}

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

function getRulerStepSec(pixelsPerSecond: number): number {
  const targetStepPx = 130;
  const rawStep = targetStepPx / pixelsPerSecond;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;

  if (normalized <= 1) {
    return magnitude;
  }

  if (normalized <= 2) {
    return 2 * magnitude;
  }

  if (normalized <= 5) {
    return 5 * magnitude;
  }

  return 10 * magnitude;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

function formatPixelsPerSecond(value: number): string {
  if (value < 1) {
    return value.toFixed(2);
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function renderAudioClip(
  clip: EditorTimelineClip,
  tone: "source" | "voiceover" | "music",
  assets: ReturnType<typeof useEditor>["assets"],
  selectedClipId: string | undefined,
  draggingClipId: string | undefined,
  pixelsPerSecond: number,
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
        left: `${clip.timelineStart * pixelsPerSecond}px`,
        width: `${Math.max(8, clip.durationSec * pixelsPerSecond)}px`
      }}
    >
      <Icon size={14} />
      <span>{tone === "source" ? `${asset?.name ?? "视频"} 原声` : asset?.name ?? "audio.wav"}</span>
    </div>
  );
}
