import {
  Clock3,
  FileUp,
  GripVertical,
  Image,
  Paperclip,
  Play,
  RefreshCw,
  Sparkles,
  X
} from "lucide-react";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useEditor } from "../../app/EditorContext";
import type {
  EditorMediaAsset,
  EditorStoryBeat,
  EditorStoryReferenceAsset
} from "../../app/editorTypes";
import { StoryScriptImportDialog } from "../story-script-import";

interface MentionState {
  beatId: string;
  start: number;
  end: number;
  query: string;
}

export const StoryScriptPanel = () => {
  const {
    assets,
    generateStoryboardVideos,
    importFiles,
    isAiGeneratingStoryboard,
    moveStoryBeat,
    selectedStoryBeatIdsForGeneration,
    storyboardGenerationProgress,
    storyBeats,
    storyGenerationMode,
    storyReferenceAssets,
    toggleStoryBeatGenerationSelection,
    updateStoryBeat,
    updateStoryGenerationMode,
    updateStoryReferenceAssets
  } = useEditor();
  const [draggedBeatId, setDraggedBeatId] = useState<string>();
  const [dropTargetId, setDropTargetId] = useState<string>();
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [mention, setMention] = useState<MentionState>();
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const contentBeats = storyBeats.filter(
    (beat) => beat.description.trim().length > 0
  );
  const activeContentBeats = contentBeats.filter(
    (beat) => beat.generationMode === storyGenerationMode
  );
  const hasStoryContent = activeContentBeats.length > 0;
  const selectedContentBeatCount = selectedStoryBeatIdsForGeneration.filter(
    (beatId) =>
      activeContentBeats.some((beat) => beat.id === beatId)
  ).length;
  const references = storyReferenceAssets
    .map((reference) => ({
      ...reference,
      asset: assets.find((asset) => asset.id === reference.assetId)
    }))
    .filter(
      (reference): reference is typeof reference & { asset: EditorMediaAsset } =>
        Boolean(reference.asset)
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

  const handleReferenceUpload = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const files = event.currentTarget.files;
    if (!files?.length) {
      return;
    }

    const result = await importFiles(files);
    const supportedAssets = result.assets.filter(
      (asset) => asset.kind === "image" || asset.kind === "video"
    );
    if (supportedAssets.length > 0) {
      updateStoryReferenceAssets(
        appendReferenceAssets(storyReferenceAssets, supportedAssets)
      );
    }
    event.currentTarget.value = "";
  };

  const handleDescriptionChange = (
    beat: EditorStoryBeat,
    event: ChangeEvent<HTMLTextAreaElement>
  ) => {
    const description = event.currentTarget.value;
    const caret = event.currentTarget.selectionStart ?? description.length;
    updateStoryBeat(beat.id, {
      description,
      referenceAssetIds:
        beat.generationMode === "reference-to-video"
          ? resolveMentionedReferenceIds(description, storyReferenceAssets)
          : []
    });
    setMention(
      storyGenerationMode === "reference-to-video"
        ? findMention(description, caret, beat.id)
        : undefined
    );
  };

  const insertMention = (
    beat: EditorStoryBeat,
    reference: EditorStoryReferenceAsset
  ) => {
    if (!mention || mention.beatId !== beat.id) {
      return;
    }

    const token = `@${reference.label}`;
    const description = `${beat.description.slice(0, mention.start)}${token} ${beat.description.slice(mention.end)}`;
    const nextCaret = mention.start + token.length + 1;
    updateStoryBeat(beat.id, {
      description,
      referenceAssetIds: resolveMentionedReferenceIds(
        description,
        storyReferenceAssets
      )
    });
    setMention(undefined);
    requestAnimationFrame(() => {
      const textarea = textareaRefs.current[beat.id];
      textarea?.focus();
      textarea?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  return (
    <section className="panel story-script-panel" data-panel="story-script">
      <div className="story-script-head">
        <div>
          <h2 className="panel-title">分镜脚本</h2>
          <p>{contentBeats.length} 个分镜</p>
        </div>
        <div className="story-script-actions">
          <button
            className="ghost-button compact story-import-button"
            onClick={() => setIsImportDialogOpen(true)}
            type="button"
          >
            <FileUp size={14} />
            <span>导入</span>
          </button>
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

      <div className="story-generation-modes" role="tablist">
        <button
          aria-selected={storyGenerationMode === "reference-to-video"}
          className={storyGenerationMode === "reference-to-video" ? "is-active" : ""}
          onClick={() => updateStoryGenerationMode("reference-to-video")}
          role="tab"
          type="button"
        >
          参考生成
        </button>
        <button
          aria-selected={storyGenerationMode === "boundary-frames"}
          className={storyGenerationMode === "boundary-frames" ? "is-active" : ""}
          onClick={() => {
            updateStoryGenerationMode("boundary-frames");
            setMention(undefined);
          }}
          role="tab"
          type="button"
        >
          首尾帧生成
        </button>
      </div>

      {storyGenerationMode === "reference-to-video" ? (
        <section className="story-reference-library">
          <div className="story-reference-library-head">
            <div>
              <strong>参考素材</strong>
              <span>统一上传，在分镜提示词中输入 @ 选择引用</span>
            </div>
            <label className="story-reference-upload">
              <Paperclip size={13} />
              <span>上传图片/视频</span>
              <input
                accept="image/*,video/*"
                multiple
                onChange={(event) => void handleReferenceUpload(event)}
                type="file"
              />
            </label>
          </div>
          {references.length > 0 ? (
            <div className="story-reference-library-assets">
              {references.map((reference) => {
                const usageCount = storyBeats.filter((beat) =>
                  beat.referenceAssetIds?.includes(reference.id)
                ).length;
                return (
                  <div className="story-reference-library-item" key={reference.assetId}>
                    <div className="story-reference-library-thumb">
                      {reference.asset.kind === "image" ? (
                        <img
                          alt=""
                          src={
                            reference.asset.thumbnailUrl ??
                            reference.asset.objectUrl ??
                            reference.asset.fileUrl
                          }
                        />
                      ) : reference.asset.thumbnailUrl ? (
                        <img alt="" src={reference.asset.thumbnailUrl} />
                      ) : (
                        <Play size={18} />
                      )}
                    </div>
                    <div className="story-reference-library-meta">
                      <strong>{reference.label}</strong>
                      <span>{usageCount > 0 ? `${usageCount} 个分镜引用` : "尚未引用"}</span>
                    </div>
                    <button
                      aria-label={`删除${reference.label}`}
                      onClick={() => removeGlobalReference(reference)}
                      title="从参考素材库删除"
                      type="button"
                    >
                      <X size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="story-reference-empty">尚未上传参考素材</p>
          )}
        </section>
      ) : (
        <div className="story-boundary-mode-note">
          首尾帧模式使用相邻分镜的边界画面保持镜头连续，不使用参考素材库。
        </div>
      )}

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
          const isInactiveMode = beat.generationMode !== storyGenerationMode;
          const isInteractionDisabled = isTrailingBlank || isInactiveMode;
          const mentionOptions =
            storyGenerationMode === "reference-to-video" && mention?.beatId === beat.id
              ? references.filter(({ label }) =>
                  label.toLowerCase().includes(mention.query.toLowerCase())
                )
              : [];

          return (
            <article
              className={[
                "story-script-row",
                isTrailingBlank ? "is-blank" : "",
                isDragging ? "is-dragging" : "",
                isDropTarget ? "is-drop-target" : "",
                isInactiveMode ? "is-inactive-mode" : "",
                !isInactiveMode &&
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
              onDragOver={(event) =>
                handleDragOver(event, beat.id, isInteractionDisabled)
              }
              onDrop={(event) =>
                handleDrop(event, beat.id, isInteractionDisabled)
              }
              >
              <label className="story-select-field" title="勾选后只生成这些分镜">
                <input
                  aria-label={`选择生成分镜 ${index + 1}`}
                  checked={
                    !isInactiveMode &&
                    selectedStoryBeatIdsForGeneration.includes(beat.id)
                  }
                  disabled={isInteractionDisabled || isAiGeneratingStoryboard}
                  onChange={() => toggleStoryBeatGenerationSelection(beat.id)}
                  type="checkbox"
                />
              </label>

              <button
                aria-label={`拖动分镜 ${index + 1}`}
                className="story-drag-handle"
                disabled={isInteractionDisabled}
                draggable={!isInteractionDisabled}
                onDragStart={(event) =>
                  handleDragStart(event, beat.id, isInteractionDisabled)
                }
                title="拖动排序"
                type="button"
              >
                <GripVertical size={16} />
              </button>

              <div className="story-description-field">
                <span className="story-segment-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className={`story-generation-type is-${beat.generationMode}`}>
                  {beat.generationMode === "reference-to-video"
                    ? "参考"
                    : "首尾帧"}
                </span>
                <textarea
                  aria-label={`分镜 ${index + 1} 描述`}
                  onBlur={() => {
                    window.setTimeout(() => {
                      setMention((current) =>
                        current?.beatId === beat.id ? undefined : current
                      );
                    }, 120);
                  }}
                  onChange={(event) => handleDescriptionChange(beat, event)}
                  onClick={(event) => {
                    const caret = event.currentTarget.selectionStart;
                    setMention(
                      !isInactiveMode &&
                        storyGenerationMode === "reference-to-video"
                        ? findMention(beat.description, caret, beat.id)
                        : undefined
                    );
                  }}
                  placeholder={
                    storyGenerationMode === "reference-to-video"
                      ? "分镜描述；输入 @ 引用图片或视频"
                      : "分镜描述；首尾帧将自动衔接相邻镜头"
                  }
                  ref={(element) => {
                    textareaRefs.current[beat.id] = element;
                  }}
                  readOnly={isInactiveMode}
                  rows={2}
                  value={beat.description}
                />
                {mention?.beatId === beat.id ? (
                  <div className="story-mention-menu" role="listbox">
                    {mentionOptions.length > 0 ? (
                      mentionOptions.map((reference) => (
                        <button
                          key={reference.assetId}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => insertMention(beat, reference)}
                          role="option"
                          type="button"
                        >
                          {reference.asset.kind === "image" ? (
                            <Image size={14} />
                          ) : (
                            <Play size={14} />
                          )}
                          <span>@{reference.label}</span>
                          <small>{reference.asset.name}</small>
                        </button>
                      ))
                    ) : (
                      <p>请先为当前分镜添加参考图片或视频</p>
                    )}
                  </div>
                ) : null}
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
                  disabled={isInteractionDisabled}
                  value={formatDurationInput(beat.durationSec)}
                />
                <span>秒</span>
              </label>

              <button
                aria-label={`替换生成分镜 ${index + 1}`}
                className="story-regenerate-button"
                disabled={isInteractionDisabled || isAiGeneratingStoryboard}
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
      <StoryScriptImportDialog
        isOpen={isImportDialogOpen}
        onClose={() => setIsImportDialogOpen(false)}
      />
    </section>
  );

  function removeGlobalReference(
    reference: EditorStoryReferenceAsset
  ) {
    const escapedLabel = escapeRegExp(reference.label);
    updateStoryReferenceAssets(
      storyReferenceAssets.filter(
        (candidate) => candidate.assetId !== reference.assetId
      )
    );
    for (const beat of storyBeats) {
      const description = beat.description
        .replace(new RegExp(`@${escapedLabel}(?!\\d)\\s?`, "g"), "")
        .replace(/ {2,}/g, " ");
      if (
        description !== beat.description ||
        beat.referenceAssetIds?.includes(reference.id)
      ) {
        updateStoryBeat(beat.id, {
          description,
          referenceAssetIds: (beat.referenceAssetIds ?? []).filter(
            (referenceId) => referenceId !== reference.id
          )
        });
      }
    }
  }
};

function appendReferenceAssets(
  current: EditorStoryReferenceAsset[],
  assets: EditorMediaAsset[]
): EditorStoryReferenceAsset[] {
  const existingIds = new Set(current.map((reference) => reference.assetId));
  const next = [...current];

  for (const asset of assets) {
    if (
      existingIds.has(asset.id) ||
      (asset.kind !== "image" && asset.kind !== "video")
    ) {
      continue;
    }
    next.push({
      id: `story-reference-${crypto.randomUUID()}`,
      assetId: asset.id,
      kind: asset.kind,
      label: uniqueReferenceLabel(asset.name, next)
    });
    existingIds.add(asset.id);
  }

  return next;
}

function uniqueReferenceLabel(
  originalName: string,
  references: EditorStoryReferenceAsset[]
): string {
  const normalizedName = originalName.trim() || "未命名素材";
  const usedLabels = new Set(references.map((reference) => reference.label));
  if (!usedLabels.has(normalizedName)) {
    return normalizedName;
  }

  let suffix = 2;
  while (usedLabels.has(`${normalizedName} (${suffix})`)) {
    suffix += 1;
  }
  return `${normalizedName} (${suffix})`;
}

function findMention(
  description: string,
  caret: number,
  beatId: string
): MentionState | undefined {
  const beforeCaret = description.slice(0, caret);
  const match = beforeCaret.match(/@([^\s@]*)$/);
  if (!match || match.index === undefined) {
    return undefined;
  }
  return {
    beatId,
    start: match.index,
    end: caret,
    query: match[1]
  };
}

function hasMention(description: string, label: string): boolean {
  return new RegExp(`@${escapeRegExp(label)}(?!\\d)`).test(description);
}

function resolveMentionedReferenceIds(
  description: string,
  references: EditorStoryReferenceAsset[]
): string[] {
  return references
    .map((reference) => ({
      reference,
      mentionIndex: description.indexOf(`@${reference.label}`)
    }))
    .filter(({ reference }) => hasMention(description, reference.label))
    .sort((first, second) => first.mentionIndex - second.mentionIndex)
    .map(({ reference }) => reference)
    .map((reference) => reference.id);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
    case "polling-start":
    case "polling":
      return 0.58;
    case "polling-complete":
      return 0.7;
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
