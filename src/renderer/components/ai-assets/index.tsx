import { Palette, Sparkles } from "lucide-react";
import { useState, type DragEvent } from "react";
import { formatDuration } from "../../app/mediaImport";
import {
  DEFAULT_SOLID_DURATION_SEC,
  normalizeSolidDuration
} from "../../app/solidColor";

export const AIAssetsPanel = () => {
  const [durationSec, setDurationSec] = useState(DEFAULT_SOLID_DURATION_SEC);
  const safeDurationSec = normalizeSolidDuration(durationSec);

  const handleSolidDragStart = (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.setData("application/x-aiv-ai-material", "solid-color");
    event.dataTransfer.setData("application/x-aiv-solid-duration", String(safeDurationSec));
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

      <div className="ai-material-list">
        <article
          className="ai-material-card"
          draggable
          onDragStart={handleSolidDragStart}
        >
          <div className="ai-material-thumb solid-template">
            <Palette size={32} />
          </div>
          <div className="asset-meta">
            <span>单色素材</span>
            <time>{formatDuration(safeDurationSec)}</time>
          </div>
        </article>
      </div>

      <label className="field-stack ai-duration-field">
        <span>时长</span>
        <input
          min="0.2"
          onChange={(event) => setDurationSec(Number(event.currentTarget.value))}
          step="0.1"
          type="number"
          value={durationSec}
        />
      </label>
    </section>
  );
};
