import { useEditor } from "../../app/EditorContext";
import { formatDuration, formatFps, formatTimecode } from "../../app/mediaImport";
import { rgbColorToLabel } from "../../app/solidColor";

export const Inspector = () => {
  const { selectedAsset, selectedClip } = useEditor();
  const assetFps = selectedAsset?.fps;
  const clipRows = [
    ["名称", selectedAsset?.name ?? "未选择片段"],
    [
      "类型",
      selectedAsset
        ? selectedAsset.solidColor
          ? "单色"
          : selectedAsset.kind === "audio"
          ? "音频"
          : selectedAsset.kind === "image"
            ? "图片"
            : "视频"
        : "未选择"
    ],
    ["时长", selectedAsset ? formatTimecode(selectedAsset.durationSec, assetFps) : "00:00:00:00"],
    [
      "源文件",
      selectedAsset
        ? selectedAsset.solidColor
          ? "AI 内置素材"
          : selectedAsset.imported
            ? "本地导入"
            : "示例素材"
        : "未选择"
    ],
    [
      "分辨率",
      selectedAsset?.width && selectedAsset.height
        ? `${selectedAsset.width} x ${selectedAsset.height}`
        : "未知"
    ],
    ["帧率", formatFps(assetFps)],
    ["时间线入点", selectedClip ? formatTimecode(selectedClip.timelineStart, assetFps) : "未放入时间线"],
    [
      "时间线出点",
      selectedClip
        ? formatTimecode(selectedClip.timelineStart + selectedClip.durationSec, assetFps)
        : formatDuration(selectedAsset?.durationSec ?? 0)
    ]
  ];

  return (
    <section className="panel inspector-panel" data-panel="inspector">
      <div className="inspector-tabs">
        <button className="is-active" type="button">检查器</button>
      </div>
      <div className="inspector-section">
        <h3>片段</h3>
        <dl className="property-list">
          {clipRows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="inspector-section">
        <h3>AI 生成信息</h3>
        <dl className="property-list">
          <div className="property-block">
            <dt>提示词</dt>
            <dd>
              {selectedAsset?.solidColor
                ? rgbColorToLabel(selectedAsset.solidColor)
                : selectedAsset
                  ? "本地导入素材"
                  : "未选择素材"}
            </dd>
          </div>
          <div>
            <dt>模型</dt>
            <dd>{selectedAsset ? "无" : "未生成"}</dd>
          </div>
          <div>
            <dt>生成时间</dt>
            <dd>{selectedAsset ? "无" : "未生成"}</dd>
          </div>
        </dl>
        <button className="wide-secondary-button" type="button">在资源管理器中显示</button>
      </div>
    </section>
  );
};
