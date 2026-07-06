import { Maximize2 } from "lucide-react";
import { useEditor } from "../../app/EditorContext";
import { formatDuration, formatTimecode } from "../../app/mediaImport";

export const Inspector = () => {
  const { selectedAsset, selectedClip } = useEditor();
  const clipRows = [
    ["名称", selectedAsset?.name ?? "未选择片段"],
    ["类型", selectedAsset?.kind === "audio" ? "音频" : selectedAsset?.kind === "image" ? "图片" : "视频"],
    ["时长", selectedAsset ? formatTimecode(selectedAsset.durationSec) : "00:00:00:00"],
    ["源文件", selectedAsset?.imported ? "本地导入" : "示例素材"],
    [
      "分辨率",
      selectedAsset?.width && selectedAsset.height
        ? `${selectedAsset.width} x ${selectedAsset.height}`
        : "1920 x 1080"
    ],
    ["帧率", "24 fps"],
    ["时间线入点", selectedClip ? formatTimecode(selectedClip.timelineStart) : "未放入时间线"],
    [
      "时间线出点",
      selectedClip
        ? formatTimecode(selectedClip.timelineStart + selectedClip.durationSec)
        : formatDuration(selectedAsset?.durationSec ?? 0)
    ]
  ];

  return (
    <section className="panel inspector-panel" data-panel="inspector">
      <div className="inspector-tabs">
        <button className="is-active" type="button">检查器</button>
        <button type="button">项目设置</button>
        <button className="icon-button" title="展开" type="button">
          <Maximize2 size={15} />
        </button>
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
            <dd>未来城市，科幻风格，壮丽景观，高质量，电影级画面</dd>
          </div>
          <div>
            <dt>模型</dt>
            <dd>Runway Gen-3</dd>
          </div>
          <div>
            <dt>生成时间</dt>
            <dd>2024-05-20 14:32</dd>
          </div>
        </dl>
        <button className="wide-secondary-button" type="button">在资源管理器中显示</button>
      </div>
    </section>
  );
};
