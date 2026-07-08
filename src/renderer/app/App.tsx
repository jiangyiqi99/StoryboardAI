import {
  ChevronDown,
  Clapperboard,
  Download,
  FilePlus2,
  Film,
  Folder,
  FolderOpen,
  Save,
  Settings,
  X
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import {
  defaultExportSettings,
  ExportDialog,
  type ExportSettings
} from "../components/export";
import { AIAssetsPanel } from "../components/ai-assets";
import { Inspector } from "../components/inspector";
import { MediaBin } from "../components/media-bin";
import { ModelSettingsPanel } from "../components/model-settings";
import { Preview } from "../components/preview";
import { ReplaceSelectionPanel } from "../components/replace-selection";
import { StoryScriptPanel } from "../components/story-script";
import { StoryboardPanel } from "../components/storyboard";
import { Timeline } from "../components/timeline";
import { desktopApi } from "../ipc/api";
import {
  EditorProvider,
  type ProjectOperationResult,
  useEditor
} from "./EditorContext";

type LeftTool = "media-bin" | "story-script" | "assets" | "model-settings";

const toolItems: Array<{
  key: LeftTool;
  label: string;
  icon: typeof Folder;
}> = [
  { key: "media-bin", label: "媒体库", icon: Folder },
  { key: "story-script", label: "分镜脚本", icon: Film },
  { key: "assets", label: "AI 素材", icon: Folder },
  { key: "model-settings", label: "模型设置", icon: Settings }
];

export const App = () => {
  return (
    <EditorProvider>
      <EditorWorkspace />
    </EditorProvider>
  );
};

const EditorWorkspace = () => {
  const [activeTool, setActiveTool] = useState<LeftTool>("media-bin");
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [exportSettings, setExportSettings] =
    useState<ExportSettings>(defaultExportSettings);
  const {
    createProject,
    isProjectDirty,
    isProjectOpen,
    isProjectSaving,
    openProjectFromPicker,
    project,
    projectMessage,
    projectRuntime,
    saveProject
  } = useEditor();

  const projectStatus = resolveProjectStatus({
    isProjectDirty,
    isProjectOpen,
    isProjectSaving,
    projectMessage
  });

  const openProject = async () => {
    setIsProjectMenuOpen(false);
    await openProjectFromPicker();
  };

  const saveCurrentProject = async () => {
    setIsProjectMenuOpen(false);
    await saveProject();
  };

  return (
    <div className="desktop-frame">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Clapperboard size={21} />
          </div>
          <strong>StoryboardAI</strong>
        </div>
        <nav className="app-menu" aria-label="应用菜单">
          <div className="menu-root">
            <button
              aria-expanded={isProjectMenuOpen}
              className="menu-trigger"
              onClick={() => setIsProjectMenuOpen((current) => !current)}
              type="button"
            >
              <span>项目</span>
              <ChevronDown size={14} />
            </button>
            {isProjectMenuOpen ? (
              <div className="project-menu-popover" role="menu">
                <button
                  onClick={() => {
                    setIsProjectMenuOpen(false);
                    setIsNewProjectOpen(true);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <FilePlus2 size={15} />
                  <span>新建项目</span>
                </button>
                <button onClick={openProject} role="menuitem" type="button">
                  <FolderOpen size={15} />
                  <span>打开项目</span>
                </button>
                <button
                  disabled={!isProjectOpen || isProjectSaving}
                  onClick={saveCurrentProject}
                  role="menuitem"
                  type="button"
                >
                  <Save size={15} />
                  <span>保存项目</span>
                </button>
              </div>
            ) : null}
          </div>
          <button type="button">编辑</button>
          <button type="button">视图</button>
          <button type="button">关于</button>
        </nav>
        <div className="project-state">
          <span title={projectRuntime?.projectRootPath}>
            {project ? formatProjectPackageName(project.name) : "未打开项目"}
          </span>
          <span className={projectStatus.className}>{projectStatus.label}</span>
        </div>
        <div className="topbar-actions">
          <button
            className="ghost-button compact"
            disabled={!isProjectOpen || isProjectSaving}
            onClick={saveCurrentProject}
            type="button"
          >
            <Save size={15} />
            <span>{isProjectSaving ? "保存中" : "保存"}</span>
          </button>
          <button
            className="primary-button"
            onClick={() => setIsExportOpen(true)}
            type="button"
          >
            <Download size={16} />
            <span>导出</span>
          </button>
          <button className="window-button" title="最小化" type="button">
            -
          </button>
          <button className="window-button" title="关闭" type="button">
            <X size={16} />
          </button>
        </div>
      </header>

      <main className="app-shell">
        <aside className="tool-rail" aria-label="主工具栏">
          {toolItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.key === activeTool;
            return (
              <button
                aria-pressed={isActive}
                className={isActive ? "tool-item is-active" : "tool-item"}
                key={item.key}
                onClick={() => setActiveTool(item.key)}
                title={item.label}
                type="button"
              >
                <Icon size={21} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </aside>

        <section className="workspace-grid">
          <aside className="left-stack">
            {activeTool === "story-script" ? (
              <StoryScriptPanel />
            ) : activeTool === "assets" ? (
              <AIAssetsPanel />
            ) : activeTool === "model-settings" ? (
              <ModelSettingsPanel />
            ) : (
              <MediaBin />
            )}
          </aside>
          <section className="center-stack">
            <Preview />
            <StoryboardPanel />
          </section>
          <aside className="right-stack">
            <Inspector />
            <ReplaceSelectionPanel />
          </aside>
        </section>

        <Timeline />
      </main>
      <ExportDialog
        isOpen={isExportOpen}
        onChange={setExportSettings}
        onClose={() => setIsExportOpen(false)}
        onConfirm={() => setIsExportOpen(false)}
        settings={exportSettings}
      />
      <NewProjectDialog
        isOpen={isNewProjectOpen}
        onClose={() => setIsNewProjectOpen(false)}
        onCreate={createProject}
      />
    </div>
  );
};

interface ProjectStatusInput {
  isProjectDirty: boolean;
  isProjectOpen: boolean;
  isProjectSaving: boolean;
  projectMessage?: string;
}

const resolveProjectStatus = ({
  isProjectDirty,
  isProjectOpen,
  isProjectSaving,
  projectMessage
}: ProjectStatusInput): { label: string; className: string } => {
  if (projectMessage && !["已保存", "已打开项目", "已创建项目"].includes(projectMessage)) {
    return { label: projectMessage, className: "saved-state is-error" };
  }

  if (isProjectSaving) {
    return { label: "保存中", className: "saved-state" };
  }

  if (isProjectDirty) {
    return { label: "未保存", className: "saved-state is-dirty" };
  }

  if (isProjectOpen) {
    return { label: projectMessage ?? "已保存", className: "saved-state" };
  }

  return { label: "请选择项目", className: "saved-state" };
};

interface NewProjectDialogProps {
  isOpen: boolean;
  onClose(): void;
  onCreate(request: {
    name: string;
    parentDirectory: string;
  }): Promise<ProjectOperationResult>;
}

const NewProjectDialog = ({
  isOpen,
  onClose,
  onCreate
}: NewProjectDialogProps) => {
  const [name, setName] = useState("未命名项目");
  const [parentDirectory, setParentDirectory] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [isChoosingDirectory, setIsChoosingDirectory] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setName("未命名项目");
    setParentDirectory("");
    setErrorMessage(undefined);
    setIsChoosingDirectory(false);
    setIsCreating(false);
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const chooseDirectory = async () => {
    try {
      setIsChoosingDirectory(true);
      const selection = await desktopApi.project.selectCreateDirectory();
      if (selection) {
        setParentDirectory(selection.directoryPath);
        setErrorMessage(undefined);
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsChoosingDirectory(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim() || "未命名项目";
    if (!parentDirectory) {
      setErrorMessage("请选择项目保存位置");
      return;
    }

    setIsCreating(true);
    const result = await onCreate({
      name: trimmedName,
      parentDirectory
    });
    setIsCreating(false);

    if (result.ok) {
      onClose();
      return;
    }

    if (!result.cancelled) {
      setErrorMessage(result.message ?? "新建项目失败");
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="project-dialog" onSubmit={submit}>
        <header>
          <h2>新建项目</h2>
          <button
            aria-label="关闭"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </header>
        <label className="field-stack">
          <span>项目名称</span>
          <input
            autoFocus
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <label className="field-stack">
          <span>项目位置</span>
          <div className="path-picker-row">
            <input
              placeholder="请选择保存位置"
              readOnly
              title={parentDirectory}
              value={parentDirectory}
            />
            <button
              className="ghost-button compact"
              disabled={isChoosingDirectory || isCreating}
              onClick={chooseDirectory}
              type="button"
            >
              <FolderOpen size={15} />
              <span>{isChoosingDirectory ? "选择中" : "浏览"}</span>
            </button>
          </div>
        </label>
        <p className="project-dialog-hint">
          将创建为{" "}
          <strong>{formatProjectPackageName(name.trim() || "未命名项目")}</strong>
          ，并包含 project.json、assets、thumbnails、renders 等目录。
        </p>
        {errorMessage ? <p className="dialog-error">{errorMessage}</p> : null}
        <footer>
          <button className="ghost-button" onClick={onClose} type="button">
            取消
          </button>
          <button
            className="primary-button"
            disabled={isCreating}
            type="submit"
          >
            <FilePlus2 size={16} />
            <span>{isCreating ? "创建中" : "创建项目"}</span>
          </button>
        </footer>
      </form>
    </div>
  );
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function formatProjectPackageName(name: string): string {
  return name.endsWith(".aivproj") ? name : `${name}.aivproj`;
}
