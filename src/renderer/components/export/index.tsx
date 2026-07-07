import { Download, X } from "lucide-react";

export type ExportPreset = "faster" | "balanced" | "better";
export type ExportCodec = "H264" | "HEVC" | "Prores" | "ProresHQ" | "ProresLT";

export interface ExportSettings {
  bitrate: string;
  resolution: string;
  preset: ExportPreset;
  codec: ExportCodec;
}

interface ExportDialogProps {
  isOpen: boolean;
  settings: ExportSettings;
  onChange(settings: ExportSettings): void;
  onClose(): void;
  onConfirm(): void;
}

const resolutionOptions = ["原始分辨率", "3840 x 2160", "1920 x 1080", "1280 x 720"];
const presetOptions: Array<{ label: string; value: ExportPreset }> = [
  { label: "更快", value: "faster" },
  { label: "平衡", value: "balanced" },
  { label: "更好", value: "better" }
];
const codecOptions: ExportCodec[] = ["H264", "HEVC", "Prores", "ProresHQ", "ProresLT"];

export const defaultExportSettings: ExportSettings = {
  bitrate: "16 Mbps",
  resolution: "1920 x 1080",
  preset: "balanced",
  codec: "H264"
};

export const ExportDialog = ({
  isOpen,
  settings,
  onChange,
  onClose,
  onConfirm
}: ExportDialogProps) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      aria-labelledby="export-dialog-title"
      aria-modal="true"
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
    >
      <section className="export-dialog">
        <header className="export-dialog-head">
          <div>
            <h2 id="export-dialog-title">导出设置</h2>
            <p>我的项目.aivproj</p>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭" type="button">
            <X size={17} />
          </button>
        </header>

        <div className="export-fields">
          <label className="export-field">
            <span>码率</span>
            <input
              inputMode="text"
              onChange={(event) =>
                onChange({
                  ...settings,
                  bitrate: event.target.value
                })
              }
              placeholder="例如 16 Mbps"
              type="text"
              value={settings.bitrate}
            />
          </label>

          <label className="export-field">
            <span>分辨率</span>
            <select
              onChange={(event) =>
                onChange({
                  ...settings,
                  resolution: event.target.value
                })
              }
              value={settings.resolution}
            >
              {resolutionOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="export-fieldset">
            <legend>预设</legend>
            <div className="export-option-grid three">
              {presetOptions.map((option) => (
                <button
                  aria-pressed={settings.preset === option.value}
                  className={
                    settings.preset === option.value
                      ? "export-option is-active"
                      : "export-option"
                  }
                  key={option.value}
                  onClick={() =>
                    onChange({
                      ...settings,
                      preset: option.value
                    })
                  }
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="export-fieldset">
            <legend>编码格式</legend>
            <div className="export-option-grid codec">
              {codecOptions.map((codec) => (
                <button
                  aria-pressed={settings.codec === codec}
                  className={
                    settings.codec === codec ? "export-option is-active" : "export-option"
                  }
                  key={codec}
                  onClick={() =>
                    onChange({
                      ...settings,
                      codec
                    })
                  }
                  type="button"
                >
                  {codec}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <footer className="export-dialog-actions">
          <button className="ghost-button" onClick={onClose} type="button">
            取消
          </button>
          <button className="primary-button" onClick={onConfirm} type="button">
            <Download size={16} />
            <span>确认</span>
          </button>
        </footer>
      </section>
    </div>
  );
};
