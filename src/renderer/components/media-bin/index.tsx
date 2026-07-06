import { ChevronDown, Filter, MoreVertical, Music2, Plus, Search } from "lucide-react";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useEditor } from "../../app/EditorContext";
import { formatDuration } from "../../app/mediaImport";

export const MediaBin = () => {
  const { assets, importFiles, openMediaPicker, selectAsset, selectedAssetId } = useEditor();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importMessage, setImportMessage] = useState<string>("素材就绪");

  const handleImportClick = async () => {
    const result = await openMediaPicker();
    const importedCount = result.assets.length;
    if (importedCount > 0) {
      setImportMessage(`已导入 ${importedCount} 个素材`);
      return;
    }

    setImportMessage(result.errors[0] ?? "未选择素材");
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) {
      return;
    }

    const result = await importFiles(event.target.files);
    const importedCount = result.assets.length;
    if (importedCount > 0) {
      setImportMessage(`已导入 ${importedCount} 个素材`);
    } else if (result.errors.length > 0) {
      setImportMessage(result.errors[0]);
    }

    event.target.value = "";
  };

  const handlePanelDragOver = (event: DragEvent<HTMLElement>) => {
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  };

  const handlePanelDrop = async (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.files.length) {
      return;
    }

    event.preventDefault();
    const result = await importFiles(event.dataTransfer.files);
    setImportMessage(
      result.assets.length > 0 ? `已导入 ${result.assets.length} 个素材` : result.errors[0] ?? "导入失败"
    );
  };

  return (
    <section
      className="panel media-bin-panel"
      data-panel="media-bin"
      onDragOver={handlePanelDragOver}
      onDrop={handlePanelDrop}
    >
      <div className="panel-heading">
        <h2 className="panel-title">媒体库</h2>
        <div className="panel-actions">
          <button className="primary-button compact" onClick={handleImportClick} type="button">
            <Plus size={16} />
            <span>导入</span>
          </button>
          <input
            accept="video/*,audio/*,image/*"
            className="media-input-hidden"
            multiple
            onChange={handleFileChange}
            ref={fileInputRef}
            type="file"
          />
          <button className="icon-button" title="筛选" type="button">
            <Filter size={17} />
          </button>
          <button className="icon-button" title="更多" type="button">
            <MoreVertical size={17} />
          </button>
        </div>
      </div>

      <div className="tabs">
        {["全部", "视频", "图片", "音频", "文件夹"].map((tab, index) => (
          <button className={index === 0 ? "is-active" : ""} key={tab} type="button">
            {tab}
          </button>
        ))}
      </div>

      <div className="media-toolbar">
        <button className="select-button" type="button">
          <span>全部素材</span>
          <ChevronDown size={15} />
        </button>
        <label className="search-field">
          <Search size={15} />
          <input placeholder="搜索素材" />
        </label>
      </div>

      <div className="asset-grid">
        {assets.map((asset) => (
          <article
            className={asset.id === selectedAssetId ? "asset-card is-selected" : "asset-card"}
            draggable
            key={asset.id}
            onClick={() => selectAsset(asset.id)}
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-aiv-asset-id", asset.id);
              event.dataTransfer.setData("text/plain", asset.id);
              event.dataTransfer.effectAllowed = "copy";
            }}
          >
            <div className={`asset-thumb ${asset.variant ?? ""}`}>
              {asset.kind === "audio" ? (
                <div className="audio-thumb">
                  <Music2 size={38} />
                </div>
              ) : (
                <img alt="" src={asset.thumbnailUrl ?? asset.objectUrl} />
              )}
            </div>
            <div className="asset-meta">
              <span>{asset.name}</span>
              <time>{formatDuration(asset.durationSec)}</time>
            </div>
          </article>
        ))}
      </div>
      <p className="import-status">{importMessage}</p>
    </section>
  );
};
