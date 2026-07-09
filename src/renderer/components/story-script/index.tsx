import { Clock3, GripVertical, RefreshCw, Sparkles } from "lucide-react";
import { useState, type DragEvent } from "react";
import { useEditor } from "../../app/EditorContext";

export const StoryScriptPanel = () => {
  const {
    generateStoryboardVideos,
    isAiGeneratingStoryboard,
    moveStoryBeat,
    selectedStoryBeatIdsForGeneration,
    storyboardGenerationProgress,
    storyBeats,
    toggleStoryBeatGenerationSelection,
    updateStoryBeat
  } = useEditor();
  const [draggedBeatId, setDraggedBeatId] = useState<string>();
  const [dropTargetId, setDropTargetId] = useState<string>();
  const hasStoryContent = storyBeats.some(
    (beat) => beat.description.trim().length > 0
  );
  const selectedContentBeatCount = selectedStoryBeatIdsForGeneration.filter(
    (beatId) =>
      storyBeats.some(
        (beat) => beat.id === beatId && beat.description.trim().length > 0
      )
  ).length;

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
            title="有勾选时生成选中分镜；没有勾选时只生成缺失分镜"
            type="button"
          >
            <Sparkles size={15} />
            <span>
              {isAiGeneratingStoryboard
                ? "生成中"
                : selectedContentBeatCount > 0
                  ? `生成选中 ${selectedContentBeatCount}`
                  : "生成缺失"}
            </span>
          </button>
          <div className="story-script-total">
            <Clock3 size={15} />
            <span>{formatStoryTotal(storyBeats)} 秒</span>
          </div>
        </div>
      </div>

      {isAiGeneratingStoryboard && storyboardGenerationProgress ? (
        <div className="story-progress-card">
          <div className="story-progress-title">
            <Sparkles size={14} />
            <strong>{storyboardGenerationProgress.message}</strong>
          </div>
          <div className="story-progress-meta">
            {storyboardGenerationProgress.segmentIndex !== undefined &&
            storyboardGenerationProgress.segmentCount !== undefined ? (
              <span>
                片段 {storyboardGenerationProgress.segmentIndex + 1}/
                {storyboardGenerationProgress.segmentCount}
              </span>
            ) : null}
            {storyboardGenerationProgress.providerId ? (
              <span>{storyboardGenerationProgress.providerId}</span>
            ) : null}
            {storyboardGenerationProgress.status ? (
              <span>{storyboardGenerationProgress.status}</span>
            ) : null}
            {storyboardGenerationProgress.jobId ? (
              <span title={storyboardGenerationProgress.jobId}>
                {compactJobId(storyboardGenerationProgress.jobId)}
              </span>
            ) : null}
          </div>
          <div className="story-progress-track">
            <span
              style={{
                width: `${resolveProgressPercent(storyboardGenerationProgress)}%`
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="story-script-list">
        {storyBeats.map((beat, index) => {
          const isTrailingBlank =
            index === storyBeats.length - 1 && beat.description.trim().length === 0;
          const isDragging = draggedBeatId === beat.id;
          const isDropTarget = dropTargetId === beat.id;
          const isGeneratingCurrent =
            isAiGeneratingStoryboard &&
            storyboardGenerationProgress?.segmentId === beat.id;

          return (
            <article
              className={[
                "story-script-row",
                isTrailingBlank ? "is-blank" : "",
                isDragging ? "is-dragging" : "",
                isDropTarget ? "is-drop-target" : "",
                selectedStoryBeatIdsForGeneration.includes(beat.id)
                  ? "is-selected-for-generation"
                  : "",
                isGeneratingCurrent ? "is-generating" : ""
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
              <label className="story-select-field" title="勾选后只生成这些分镜">
                <input
                  aria-label={`选择生成分镜 ${index + 1}`}
                  checked={selectedStoryBeatIdsForGeneration.includes(beat.id)}
                  disabled={isTrailingBlank || isAiGeneratingStoryboard}
                  onChange={() => toggleStoryBeatGenerationSelection(beat.id)}
                  type="checkbox"
                />
              </label>

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
                {isGeneratingCurrent ? (
                  <small>{storyboardGenerationProgress.message}</small>
                ) : null}
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

function resolveProgressPercent(progress: NonNullable<ReturnType<typeof useEditor>["storyboardGenerationProgress"]>): number {
  if (progress.progress !== undefined) {
    return Math.max(4, Math.min(100, Math.round(progress.progress * 100)));
  }

  if (
    progress.segmentIndex !== undefined &&
    progress.segmentCount !== undefined &&
    progress.segmentCount > 0
  ) {
    const segmentBase = progress.segmentIndex / progress.segmentCount;
    const stageWeight = stageProgressWeight(progress.stage) / progress.segmentCount;
    return Math.max(4, Math.min(98, Math.round((segmentBase + stageWeight) * 100)));
  }

  return stageProgressWeight(progress.stage) * 100;
}

function stageProgressWeight(stage: string): number {
  switch (stage) {
    case "workflow-start":
    case "project-opened":
    case "segments-planned":
      return 0.08;
    case "segment-start":
    case "boundary-resolving":
    case "boundary-ready":
      return 0.16;
    case "task-creating":
      return 0.28;
    case "task-created":
    case "waiting-output":
      return 0.4;
    case "polling":
      return 0.58;
    case "output-ready":
    case "saving-output":
      return 0.78;
    case "download-complete":
    case "segment-complete":
      return 0.92;
    case "project-saved":
    case "workflow-complete":
      return 1;
    default:
      return 0.5;
  }
}

function compactJobId(jobId: string): string {
  return jobId.length > 22 ? `${jobId.slice(0, 10)}...${jobId.slice(-8)}` : jobId;
}

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
