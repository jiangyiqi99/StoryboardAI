import { Lock, Shuffle } from "lucide-react";
import { previewImage } from "../../app/mockWorkspace";

export const ReplaceSelectionPanel = () => {
  return (
    <section className="panel replace-panel" data-panel="replace-selection">
      <h2 className="panel-title">替换选区</h2>
      <p className="range-text">00:00:12:00 - 00:00:20:00（共 8s）</p>

      <div className="segmented-control">
        <button className="is-active" type="button">选区信息</button>
        <button type="button">首尾帧</button>
      </div>

      <div className="frame-pair">
        <figure>
          <img alt="" src={previewImage} />
          <figcaption>首帧</figcaption>
        </figure>
        <span>›</span>
        <figure>
          <img alt="" src={previewImage} />
          <figcaption>尾帧</figcaption>
        </figure>
      </div>

      <label className="field-stack">
        <span>提示词</span>
        <input defaultValue="在沙漠中飞行的未来飞船" />
      </label>

      <div className="replace-form-grid">
        <label className="field-stack">
          <span>时长（秒）</span>
          <input defaultValue="8.0" />
        </label>
        <button className="icon-field" title="锁定时长" type="button">
          <Lock size={16} />
        </button>
        <label className="field-stack">
          <span>宽高比</span>
          <input defaultValue="16:9" />
        </label>
      </div>

      <label className="field-stack">
        <span>分辨率</span>
        <div className="input-with-icon">
          <input defaultValue="1920x1080" />
          <Shuffle size={14} />
        </div>
      </label>

      <button className="primary-button generate-button" type="button">
        生成替换片段
      </button>
    </section>
  );
};
