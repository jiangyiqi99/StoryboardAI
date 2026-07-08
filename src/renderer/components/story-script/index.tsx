import { Clock3, GripVertical, RefreshCw, Sparkles } from "lucide-react";
import { useState, type DragEvent } from "react";
import { useEditor } from "../../app/EditorContext";

export const StoryScriptPanel = () => {
  const {
    generateStoryboardVideos,
    isAiGeneratingStoryboard,
    moveStoryBeat,
    storyBeats,
    updateStoryBeat
  } = useEditor();
  const [draggedBeatId, setDraggedBeatId] = useState<string>();
  const [dropTargetId, setDropTargetId] = useState<string>();
  const hasStoryContent = storyBeats.some(
    (beat) => beat.description.trim().length > 0
  );

  const handleDragStart = (
    event: DragEvent<HTMLElement>,
    beatId: string,
    isTrailingBlank: boolean
  ) => {
    if (isTrailingBlank) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-aiv-story-beat-id", beatId);
    setDraggedBeatId(beatId);
  };

  const handleDragOver = (
    event: DragEvent<HTMLElement>,
    beatId: string,
    isTrailingBlank: boolean
  ) => {
    if (!draggedBeatId || beatId === draggedBeatId || isTrailingBlank) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetId(beatId);
  };

  const handleDrop = (
    event: DragEvent<HTMLElement>,
    beatId: string,
    isTrailingBlank: boolean
  ) => {
    event.preventDefault();
    if (!draggedBeatId || isTrailingBlank) {
      return;
    }

    moveStoryBeat(draggedBeatId, beatId);
    setDraggedBeatId(undefined);
    setDropTargetId(undefined);
  };

  return (
    <section className="panel story-script-panel" data-panel="story-script">
      <div className="story-script-head">
        <div>
          <h2 className="panel-title">分镜脚本</h2>
          <p>{storyBeats.length - 1} 个分镜</p>
        </div>
        <div className="story-script-actions">
          <button
            className="story-generate-button"
            disabled={!hasStoryContent || isAiGeneratingStoryboard}
            onClick={() => {
              void generateStoryboardVideos();
            }}
            title="按顺序生成所有分镜视频"
            type="button"
          >
            <Sparkles size={15} />
            <span>{isAiGeneratingStoryboard ? "生成中" : "生成视频"}</span>
          </button>
          <div className="story-script-total">
            <Clock3 size={15} />
            <span>{formatStoryTotal(storyBeats)} 秒</span>
          </div>
        </div>
      </div>

      <div className="story-script-list">
        {storyBeats.map((beat, index) => {
          const isTrailingBlank =
            index === storyBeats.length - 1 && beat.description.trim().length === 0;
          const isDragging = draggedBeatId === beat.id;
          const isDropTarget = dropTargetId === beat.id;

          return (
            <article
              className={[
                "story-script-row",
                isTrailingBlank ? "is-blank" : "",
                isDragging ? "is-dragging" : "",
                isDropTarget ? "is-drop-target" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              key={beat.id}
              onDragEnd={() => {
                setDraggedBeatId(undefined);
                setDropTargetId(undefined);
              }}
              onDragLeave={() => {
                if (dropTargetId === beat.id) {
                  setDropTargetId(undefined);
                }
              }}
              onDragOver={(event) => handleDragOver(event, beat.id, isTrailingBlank)}
              onDrop={(event) => handleDrop(event, beat.id, isTrailingBlank)}
            >
              <button
                aria-label={`拖动分镜 ${index + 1}`}
                className="story-drag-handle"
                disabled={isTrailingBlank}
                draggable={!isTrailingBlank}
                onDragStart={(event) =>
                  handleDragStart(event, beat.id, isTrailingBlank)
                }
                title="拖动排序"
                type="button"
              >
                <GripVertical size={16} />
              </button>

              <div className="story-description-field">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <textarea
                  aria-label={`分镜 ${index + 1} 描述`}
                  onChange={(event) =>
                    updateStoryBeat(beat.id, { description: event.target.value })
                  }
                  placeholder="分镜描述"
                  rows={2}
                  value={beat.description}
                />
              </div>

              <label className="story-duration-field">
                <input
                  aria-label={`分镜 ${index + 1} 秒数`}
                  min={0.1}
                  onChange={(event) =>
                    updateStoryBeat(beat.id, {
                      durationSec: event.currentTarget.valueAsNumber
                    })
                  }
                  step={0.1}
                  type="number"
                  value={formatDurationInput(beat.durationSec)}
                />
                <span>秒</span>
              </label>

              <button
                aria-label={`替换生成分镜 ${index + 1}`}
                className="story-regenerate-button"
                disabled={isTrailingBlank || isAiGeneratingStoryboard}
                onClick={() => {
                  void generateStoryboardVideos(beat.id);
                }}
                title="替换生成本段视频"
                type="button"
              >
                <RefreshCw size={14} />
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
};

function formatDurationInput(durationSec: number): string {
  return Number.isInteger(durationSec) ? String(durationSec) : durationSec.toFixed(1);
}

function formatStoryTotal(storyBeats: { description: string; durationSec: number }[]): string {
  const totalSec = storyBeats.reduce((total, beat) => {
    if (beat.description.trim().length === 0) {
      return total;
    }

    return total + beat.durationSec;
  }, 0);

  return Number.isInteger(totalSec) ? String(totalSec) : totalSec.toFixed(1);
}
