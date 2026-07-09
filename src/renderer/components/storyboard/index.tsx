import { Clock3, Film, Grid2X2, Plus, Sparkles } from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";
import { useEditor } from "../../app/EditorContext";
import type { EditorMediaAsset, EditorTimelineClip } from "../../app/editorTypes";
import { formatDuration } from "../../app/mediaImport";
import { rgbColorToCss } from "../../app/solidColor";

interface StoryboardItem {
  clip: EditorTimelineClip;
  asset?: EditorMediaAsset;
  storyText: string;
}

export const StoryboardPanel = () => {
  const {
    assets,
    moveClip,
    replaceClipAsset,
    selectClip,
    selectedClipId,
    setPlayhead,
    storyBeats,
    timelineClips
  } = useEditor();
  const [draggedClipId, setDraggedClipId] = useState<string>();
  const [dropTargetClipId, setDropTargetClipId] = useState<string>();
  const storyboardItems = useMemo(
    () => createStoryboardItems(timelineClips, assets, storyBeats),
    [assets, storyBeats, timelineClips]
  );

  const handleDragStart = (
    event: DragEvent<HTMLElement>,
    clipId: string
  ) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-aiv-clip-id", clipId);
    setDraggedClipId(clipId);
  };

  const handleDragOver = (
    event: DragEvent<HTMLElement>,
    clipId: string
  ) => {
    const isAssetDrop = event.dataTransfer.types.includes("application/x-aiv-asset-id");
    if (!isAssetDrop && (!draggedClipId || draggedClipId === clipId)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = isAssetDrop ? "copy" : "move";
    setDropTargetClipId(clipId);
  };

  const handleDrop = (
    event: DragEvent<HTMLElement>,
    targetClip: EditorTimelineClip
  ) => {
    event.preventDefault();
    const assetId = event.dataTransfer.getData("application/x-aiv-asset-id");
    if (assetId) {
      replaceClipAsset(targetClip.id, assetId);
      setDraggedClipId(undefined);
      setDropTargetClipId(undefined);
      return;
    }

    const sourceClipId =
      draggedClipId || event.dataTransfer.getData("application/x-aiv-clip-id");
    if (!sourceClipId || sourceClipId === targetClip.id) {
      return;
    }

    moveClip(sourceClipId, targetClip.timelineStart);
    setDraggedClipId(undefined);
    setDropTargetClipId(undefined);
  };

  return (
    <section className="panel storyboard-panel" data-panel="storyboard">
      <div className="storyboard-tools">
        <div className="small-tool-group">
          <button className="icon-button is-muted" title="网格" type="button">
            <Grid2X2 size={16} />
          </button>
          <button className="icon-button is-muted" title="分镜设置" type="button">
            <Sparkles size={16} />
          </button>
        </div>
        <div className="panel-actions">
          <button className="ghost-button compact" type="button">
            <Sparkles size={15} />
            <span>生成分镜</span>
          </button>
          <button className="ghost-button compact" type="button">
            <Plus size={15} />
            <span>导入脚本</span>
          </button>
        </div>
      </div>

      <div className="storyboard-strip" aria-label="分镜缩略图">
        {storyboardItems.map((item, index) => {
          const { asset, clip, storyText } = item;
          const isSelected = clip.id === selectedClipId;
          const className = [
            "story-card",
            isSelected ? "is-selected" : "",
            draggedClipId === clip.id ? "is-dragging" : "",
            dropTargetClipId === clip.id ? "is-drop-target" : ""
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <article
              className={className}
              draggable
              key={clip.id}
              onClick={() => {
                selectClip(clip.id);
                setPlayhead(clip.timelineStart);
              }}
              onDragEnd={() => {
                setDraggedClipId(undefined);
                setDropTargetClipId(undefined);
              }}
              onDragLeave={() => {
                if (dropTargetClipId === clip.id) {
                  setDropTargetClipId(undefined);
                }
              }}
              onDragOver={(event) => handleDragOver(event, clip.id)}
              onDragStart={(event) => handleDragStart(event, clip.id)}
              onDrop={(event) => handleDrop(event, clip)}
              title={storyText}
            >
              <span className="story-index">{String(index + 1).padStart(2, "0")}</span>
              <div className="story-image">
                {asset?.solidColor ? (
                  <div
                    className="story-solid-thumb"
                    style={{ background: rgbColorToCss(asset.solidColor) }}
                  />
                ) : asset?.thumbnailUrl ?? asset?.objectUrl ? (
                  <img alt="" draggable={false} src={asset.thumbnailUrl ?? asset.objectUrl} />
                ) : (
                  <div className="story-missing-thumb">
                    <Film size={24} />
                  </div>
                )}
              </div>
              <p>{storyText}</p>
              <div className="story-card-foot">
                <span>{asset?.name ?? "未命名素材"}</span>
                <span>
                  <Clock3 size={12} />
                  {formatDuration(clip.durationSec)}
                </span>
              </div>
              <div className="story-card-tooltip">{storyText}</div>
            </article>
          );
        })}

        {storyboardItems.length === 0 ? (
          <button className="story-add" type="button" title="新增分镜">
            <Plus size={34} />
          </button>
        ) : null}
      </div>
    </section>
  );
};

function createStoryboardItems(
  timelineClips: EditorTimelineClip[],
  assets: EditorMediaAsset[],
  storyBeats: Array<{ id: string; description: string }>
): StoryboardItem[] {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const storyBeatById = new Map(storyBeats.map((beat) => [beat.id, beat]));

  return timelineClips
    .filter((clip) => clip.trackId === "video-1")
    .sort((first, second) => first.timelineStart - second.timelineStart)
    .map((clip) => {
      const asset = assetById.get(clip.assetId);
      const storySegmentId = getClipStorySegmentId(clip);
      const storyText =
        (storySegmentId ? storyBeatById.get(storySegmentId)?.description : undefined) ??
        readClipStoryText(clip) ??
        asset?.name ??
        "未命名分镜";

      return {
        clip,
        asset,
        storyText
      };
    });
}

function getClipStorySegmentId(clip: EditorTimelineClip): string | undefined {
  const storySegmentId = clip.metadata?.storySegmentId;
  return typeof storySegmentId === "string" && storySegmentId.length > 0
    ? storySegmentId
    : undefined;
}

function readClipStoryText(clip: EditorTimelineClip): string | undefined {
  const storyText = clip.metadata?.storyText;
  return typeof storyText === "string" && storyText.trim().length > 0
    ? storyText.trim()
    : undefined;
}
