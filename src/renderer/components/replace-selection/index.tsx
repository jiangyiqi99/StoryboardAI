import { Lock, Shuffle } from "lucide-react";

export const ReplaceSelectionPanel = () => {
  return (
    <section className="panel replace-panel" data-panel="replace-selection">
      <h2 className="panel-title">替换选区</h2>
      <p className="range-text">未选择时间线片段</p>

      <div className="segmented-control">
        <button className="is-active" type="button">选区信息</button>
        <button type="button">首尾帧</button>
      </div>

      <div className="frame-pair">
        <figure>
          <div className="frame-placeholder" />
          <figcaption>首帧</figcaption>
        </figure>
        <span>›</span>
        <figure>
          <div className="frame-placeholder" />
          <figcaption>尾帧</figcaption>
        </figure>
      </div>

      <label className="field-stack">
        <span>提示词</span>
        <input placeholder="选择片段后输入替换提示词" />
      </label>

      <div className="replace-form-grid">
        <label className="field-stack">
          <span>时长（秒）</span>
          <input placeholder="0.0" />
        </label>
        <button className="icon-field" title="锁定时长" type="button">
          <Lock size={16} />
        </button>
        <label className="field-stack">
          <span>宽高比</span>
          <input placeholder="16:9" />
        </label>
      </div>

      <label className="field-stack">
        <span>分辨率</span>
        <div className="input-with-icon">
          <input placeholder="1920x1080" />
          <Shuffle size={14} />
        </div>
      </label>

      <button className="primary-button generate-button" type="button">
        生成替换片段
      </button>
    </section>
  );
};
