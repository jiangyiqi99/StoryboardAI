import { Download, FileText, FileUp, Table2, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  parseStoryScriptDocument,
  type StoryScriptDocumentFormat
} from "@shared/storyScriptDocuments";
import { useEditor } from "../../app/EditorContext";
import type { StoryScriptImportMode } from "../../app/editorTypes";
import { desktopApi } from "../../ipc/api";

interface StoryScriptImportDialogProps {
  isOpen: boolean;
  onClose(): void;
}

interface ImportDialogStatus {
  kind: "error" | "success";
  message: string;
}

export const StoryScriptImportDialog = ({
  isOpen,
  onClose
}: StoryScriptImportDialogProps) => {
  const { importStoryBeats, storyBeats } = useEditor();
  const [mode, setMode] = useState<StoryScriptImportMode>("overwrite");
  const [isWorking, setIsWorking] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string>();
  const [status, setStatus] = useState<ImportDialogStatus>();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setMode("overwrite");
    setIsWorking(false);
    setSelectedFileName(undefined);
    setStatus(undefined);
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const chooseImportFile = async () => {
    try {
      setIsWorking(true);
      setStatus(undefined);
      const selectedFile = await desktopApi.storyScript.selectImportFile();
      if (!selectedFile) {
        return;
      }

      setSelectedFileName(selectedFile.fileName);
      const parsed = parseStoryScriptDocument(
        selectedFile.format,
        selectedFile.content
      );
      if (parsed.errors.length > 0) {
        setStatus({
          kind: "error",
          message: formatImportErrors(parsed.errors)
        });
        return;
      }

      const existingBeatCount = storyBeats.filter(
        (beat) => beat.description.trim().length > 0
      ).length;
      importStoryBeats(parsed.beats, mode);
      setStatus({
        kind: "success",
        message: formatImportSuccessMessage({
          fileName: selectedFile.fileName,
          importedCount: parsed.beats.length,
          existingCount: existingBeatCount,
          mode
        })
      });
    } catch (error) {
      setStatus({ kind: "error", message: getErrorMessage(error) });
    } finally {
      setIsWorking(false);
    }
  };

  const saveTemplate = async (format: StoryScriptDocumentFormat) => {
    try {
      setIsWorking(true);
      setStatus(undefined);
      const result = await desktopApi.storyScript.saveTemplate({ format });
      if (result) {
        setStatus({
          kind: "success",
          message: `模板已保存：${result.filePath}`
        });
      }
    } catch (error) {
      setStatus({ kind: "error", message: getErrorMessage(error) });
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div
      aria-labelledby="story-import-dialog-title"
      aria-modal="true"
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isWorking) {
          onClose();
        }
      }}
      role="dialog"
    >
      <section className="export-dialog story-import-dialog">
        <header className="export-dialog-head">
          <div>
            <h2 id="story-import-dialog-title">导入分镜脚本</h2>
            <p>Markdown 或 CSV</p>
          </div>
          <button
            className="icon-button"
            disabled={isWorking}
            onClick={onClose}
            title="关闭"
            type="button"
          >
            <X size={17} />
          </button>
        </header>

        <fieldset className="export-fieldset">
          <legend>导入方式</legend>
          <div className="segmented-control story-import-mode">
            <button
              aria-pressed={mode === "overwrite"}
              className={mode === "overwrite" ? "is-active" : ""}
              onClick={() => setMode("overwrite")}
              title="按顺序覆盖已有分镜，保留分镜 ID、视频资产和未覆盖的尾部分镜"
              type="button"
            >
              覆盖文本和时长
            </button>
            <button
              aria-pressed={mode === "append"}
              className={mode === "append" ? "is-active" : ""}
              onClick={() => setMode("append")}
              title="把导入分镜新增到当前脚本末尾"
              type="button"
            >
              追加到末尾
            </button>
          </div>
        </fieldset>

        <button
          className="primary-button story-import-file-button"
          disabled={isWorking}
          onClick={() => void chooseImportFile()}
          type="button"
        >
          <FileUp size={17} />
          <span>{isWorking ? "处理中" : "选择 .md 或 .csv 文件"}</span>
        </button>
        {selectedFileName ? (
          <p className="story-import-file-name" title={selectedFileName}>
            {selectedFileName}
          </p>
        ) : null}

        <div className="story-template-section">
          <h3>导入模板</h3>
          <div className="story-template-grid">
            <TemplateOption
              format="markdown"
              icon={FileText}
              isWorking={isWorking}
              onSave={saveTemplate}
              preview={"## 分镜 01\n时长（秒）: 5\n\n分镜描述..."}
              title="Markdown"
            />
            <TemplateOption
              format="csv"
              icon={Table2}
              isWorking={isWorking}
              onSave={saveTemplate}
              preview={"序号,分镜描述,时长（秒）\n1,分镜描述...,5"}
              title="CSV"
            />
          </div>
        </div>

        {status ? (
          <p
            className={
              status.kind === "error"
                ? "story-import-status is-error"
                : "story-import-status is-success"
            }
          >
            {status.message}
          </p>
        ) : null}
      </section>
    </div>
  );
};

interface TemplateOptionProps {
  format: StoryScriptDocumentFormat;
  icon: typeof FileText;
  isWorking: boolean;
  onSave(format: StoryScriptDocumentFormat): Promise<void>;
  preview: string;
  title: string;
}

const TemplateOption = ({
  format,
  icon: Icon,
  isWorking,
  onSave,
  preview,
  title
}: TemplateOptionProps) => (
  <article className="story-template-option">
    <header>
      <Icon size={16} />
      <strong>{title}</strong>
      <span>.{format === "markdown" ? "md" : "csv"}</span>
    </header>
    <pre>{preview}</pre>
    <button
      className="ghost-button compact"
      disabled={isWorking}
      onClick={() => void onSave(format)}
      type="button"
    >
      <Download size={14} />
      <span>另存模板</span>
    </button>
  </article>
);

function formatImportErrors(errors: string[]): string {
  const displayedErrors = errors.slice(0, 4);
  return `${displayedErrors.join("；")}${
    errors.length > displayedErrors.length
      ? `；另有 ${errors.length - displayedErrors.length} 个错误`
      : ""
  }`;
}

function formatImportSuccessMessage({
  fileName,
  importedCount,
  existingCount,
  mode
}: {
  fileName: string;
  importedCount: number;
  existingCount: number;
  mode: StoryScriptImportMode;
}): string {
  if (mode === "append") {
    return `已从 ${fileName} 追加 ${importedCount} 个分镜`;
  }

  const overwrittenCount = Math.min(importedCount, existingCount);
  const addedCount = Math.max(0, importedCount - existingCount);
  const retainedCount = Math.max(0, existingCount - importedCount);
  const changes = [
    overwrittenCount > 0 ? `覆盖 ${overwrittenCount} 个` : undefined,
    addedCount > 0 ? `新增 ${addedCount} 个` : undefined,
    retainedCount > 0 ? `保留 ${retainedCount} 个未覆盖分镜` : undefined
  ].filter((change): change is string => Boolean(change));

  return `已从 ${fileName} ${changes.join("，")}；视频资产和时间线片段保持不变`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "导入分镜脚本失败";
}
