import { Film, Folder, Sparkles } from "lucide-react";
import { useMemo, type DragEvent } from "react";
import { useEditor } from "../../app/EditorContext";
import type { EditorMediaAsset, EditorStoryBeat } from "../../app/editorTypes";
import { formatDuration } from "../../app/mediaImport";

interface AiSegmentFolder {
  id: string;
  label: string;
  text: string;
  currentAssetId?: string;
  candidates: EditorMediaAsset[];
}

export const AIAssetsPanel = () => {
  const { assets, project, selectedAssetId, selectAsset, storyBeats } = useEditor();
  const segmentFolders = useMemo(
    () => createSegmentFolders(storyBeats, assets, project?.storyboardSegments),
    [assets, project?.storyboardSegments, storyBeats]
  );
  const candidateCount = segmentFolders.reduce(
    (count, folder) => count + folder.candidates.length,
    0
  );

  const handleAssetDragStart = (
    event: DragEvent<HTMLElement>,
    assetId: string
  ) => {
    event.dataTransfer.setData("application/x-aiv-asset-id", assetId);
    event.dataTransfer.setData("text/plain", assetId);
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <section className="panel ai-assets-panel" data-panel="ai-assets">
      <div className="panel-heading">
        <h2 className="panel-title">AI 素材</h2>
        <div className="panel-actions">
          <button className="icon-button is-muted" disabled title="更多 AI 素材即将接入" type="button">
            <Sparkles size={17} />
          </button>
        </div>
      </div>

      <div className="ai-segment-list">
        {segmentFolders.length > 0 ? (
          segmentFolders.map((folder) => (
            <details
              className="ai-segment-folder"
              defaultOpen={folder.candidates.length > 0}
              key={folder.id}
            >
              <summary>
                <span className="ai-folder-icon">
                  <Folder size={17} />
                </span>
                <span className="ai-folder-title">{folder.label}</span>
                <span className="ai-folder-text">{folder.text}</span>
                <span className="ai-folder-count">{folder.candidates.length}</span>
              </summary>

              <div className="ai-candidate-list">
                {folder.candidates.length > 0 ? (
                  folder.candidates.map((asset) => {
                    const isCurrent = asset.id === folder.currentAssetId;
                    const className = [
                      "ai-candidate-card",
                      asset.id === selectedAssetId ? "is-selected" : "",
                      isCurrent ? "is-current" : ""
                    ]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <article
                        className={className}
                        draggable
                        key={asset.id}
                        onClick={() => selectAsset(asset.id)}
                        onDragStart={(event) => handleAssetDragStart(event, asset.id)}
                      >
                        <div className="ai-candidate-thumb">
                          {asset.thumbnailUrl ?? asset.objectUrl ? (
                            <img alt="" src={asset.thumbnailUrl ?? asset.objectUrl} />
                          ) : (
                            <Film size={28} />
                          )}
                        </div>
                        <div className="ai-candidate-body">
                          <div className="asset-meta">
                            <span>{asset.name}</span>
                            <time>{formatDuration(asset.durationSec)}</time>
                          </div>
                          <div className="ai-candidate-foot">
                            <span>{formatCandidateTime(asset.importedAt)}</span>
                            {isCurrent ? <strong>当前</strong> : null}
                          </div>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <p className="ai-folder-empty">暂无生成候选</p>
                )}
              </div>
            </details>
          ))
        ) : (
          <div className="ai-assets-empty">
            <Folder size={24} />
            <span>暂无分镜目录</span>
          </div>
        )}
      </div>

      <p className="import-status">已归档 {candidateCount} 个 AI 生成视频</p>
    </section>
  );
};

function createSegmentFolders(
  storyBeats: EditorStoryBeat[],
  assets: EditorMediaAsset[],
  projectSegments:
    | Array<{
        id: string;
        outputAssetId?: string;
      }>
    | undefined
): AiSegmentFolder[] {
  const projectSegmentById = new Map(
    (projectSegments ?? []).map((segment) => [segment.id, segment])
  );

  return storyBeats
    .filter((beat) => beat.description.trim().length > 0)
    .map((beat, index) => {
      const currentAssetId = projectSegmentById.get(beat.id)?.outputAssetId;
      const candidates = assets
        .filter((asset) => isStoryboardGeneratedVideo(asset, beat.id))
        .sort((first, second) =>
          compareCandidates(first, second, currentAssetId)
        );

      return {
        id: beat.id,
        label: `分镜 ${index + 1}`,
        text: beat.description.trim(),
        currentAssetId,
        candidates
      };
    });
}

function isStoryboardGeneratedVideo(
  asset: EditorMediaAsset,
  segmentId: string
): boolean {
  if (asset.imported || asset.kind !== "video") {
    return false;
  }

  return (
    asset.storyboardSegmentId === segmentId
  );
}

function compareCandidates(
  first: EditorMediaAsset,
  second: EditorMediaAsset,
  currentAssetId: string | undefined
): number {
  if (first.id === currentAssetId && second.id !== currentAssetId) {
    return -1;
  }

  if (second.id === currentAssetId && first.id !== currentAssetId) {
    return 1;
  }

  const firstTime = Date.parse(first.importedAt ?? "");
  const secondTime = Date.parse(second.importedAt ?? "");
  if (Number.isFinite(firstTime) && Number.isFinite(secondTime) && firstTime !== secondTime) {
    return secondTime - firstTime;
  }

  return first.name.localeCompare(second.name, "zh-Hans-CN");
}

function formatCandidateTime(value: string | undefined): string {
  if (!value) {
    return "生成记录";
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "生成记录";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}
