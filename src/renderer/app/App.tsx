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
import type { NativeEncodeSettings, NativeTimelineProject } from "@shared/types/native-media";
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
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | undefined>();
  const [exportSettings, setExportSettings] =
    useState<ExportSettings>(defaultExportSettings);
  const {
    assets,
    createProject,
    isAiGeneratingStoryboard,
    isProjectDirty,
    isProjectOpen,
    isProjectSaving,
    openProjectFromPicker,
    project,
    projectMessage,
    projectRuntime,
    saveProject,
    storyboardGenerationProgress,
    timelineClips
  } = useEditor();

  const projectStatus = resolveProjectStatus({
    isAiGeneratingStoryboard,
    isProjectDirty,
    isProjectOpen,
    isProjectSaving,
    projectMessage,
    storyboardGenerationProgressStage: storyboardGenerationProgress?.stage
  });

  const openProject = async () => {
    setIsProjectMenuOpen(false);
    await openProjectFromPicker();
  };

  const saveCurrentProject = async () => {
    setIsProjectMenuOpen(false);
    await saveProject();
  };

  const openExportDialog = () => {
    setExportStatus(undefined);
    setIsExportOpen(true);
  };

  const updateExportSettings = (nextSettings: ExportSettings) => {
    setExportStatus(undefined);
    setExportSettings(nextSettings);
  };

  const confirmExport = async () => {
    if (exportSettings.mode === "rendered-video") {
      if (!projectRuntime || !project) {
        setExportStatus("请先新建或打开项目");
        return;
      }
      const nativeTimeline = createNativeExportTimeline({
        assets,
        clips: timelineClips,
        project
      });
      if (!nativeTimeline) {
        setExportStatus("时间线上没有可导出的视频片段");
        return;
      }
      const settings = parseNativeEncodeSettings(exportSettings);
      if (!settings) {
        setExportStatus("请填写有效的分辨率、帧率和码率");
        return;
      }
      try {
        setIsExporting(true);
        setExportStatus("正在使用 libav 渲染完整视频…");
        const outputPath = `${projectRuntime.projectRootPath}/renders/${safeFileName(project.name)}-${formatExportFileTimestamp(new Date())}.mp4`;
        const result = await desktopApi.nativeMedia.encodeTimeline({
          project: nativeTimeline,
          outputPath,
          settings
        });
        setExportStatus(`导出完成：${result.outputPath}`);
      } catch (error) {
        setExportStatus(getErrorMessage(error));
      } finally {
        setIsExporting(false);
      }
      return;
    }

    if (!projectRuntime) {
      setExportStatus("请先新建或打开项目");
      return;
    }

    const exportableClips = createSequentialClipExportInputs(timelineClips, assets);
    if (exportableClips.length === 0) {
      setExportStatus("时间线上没有可导出的片段");
      return;
    }

    try {
      setIsExporting(true);
      const result = await desktopApi.media.exportTimelineClips({
        projectRootPath: projectRuntime.projectRootPath,
        clips: exportableClips
      });
      const videoClipCount = countPrimaryVideoTimelineClips(timelineClips, assets);
      const skippedCount = Math.max(0, videoClipCount - result.files.length);
      setExportStatus(
        skippedCount > 0
          ? `已导出 ${result.files.length} 个片段，跳过 ${skippedCount} 个无源文件片段：${result.outputDirectory}`
          : `已导出 ${result.files.length} 个片段：${result.outputDirectory}`
      );
    } catch (error) {
      setExportStatus(getErrorMessage(error));
    } finally {
      setIsExporting(false);
    }
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
            disabled={!isProjectOpen}
            onClick={openExportDialog}
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
        isExporting={isExporting}
        onChange={updateExportSettings}
        onClose={() => setIsExportOpen(false)}
        onConfirm={confirmExport}
        settings={exportSettings}
        status={exportStatus}
      />
      <NewProjectDialog
        isOpen={isNewProjectOpen}
        onClose={() => setIsNewProjectOpen(false)}
        onCreate={createProject}
      />
    </div>
  );
};

function createSequentialClipExportInputs(
  timelineClips: ReturnType<typeof useEditor>["timelineClips"],
  assets: ReturnType<typeof useEditor>["assets"]
) {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

  return timelineClips
    .map((clip) => {
      const asset = assetsById.get(clip.assetId);
      if (
        clip.trackId !== "video-1" ||
        !asset ||
        asset.kind === "audio" ||
        !asset.absolutePath
      ) {
        return undefined;
      }

      return {
        clipId: clip.id,
        assetName: asset.name,
        sourcePath: asset.absolutePath,
        timelineStart: clip.timelineStart
      };
    })
    .filter((clip): clip is NonNullable<typeof clip> => Boolean(clip))
    .sort((first, second) => first.timelineStart - second.timelineStart);
}

function createNativeExportTimeline({
  assets,
  clips,
  project
}: {
  assets: ReturnType<typeof useEditor>["assets"];
  clips: ReturnType<typeof useEditor>["timelineClips"];
  project: NonNullable<ReturnType<typeof useEditor>["project"]>;
}): NativeTimelineProject | undefined {
  const assetPaths = Object.fromEntries(
    assets
      .filter((asset) => Boolean(asset.absolutePath))
      .map((asset) => [asset.id, asset.absolutePath!])
  );
  const projectAssetById = new Map(project.assets.map((asset) => [asset.id, asset]));
  const nativeAssets = assets.map((asset) => {
    const existing = projectAssetById.get(asset.id);
    return {
      ...existing,
      id: asset.id,
      kind: existing?.kind ?? asset.kind,
      origin: existing?.origin ?? (asset.imported ? "imported" as const : "generated" as const),
      name: asset.name,
      metadata: {
        ...(asset.metadata ?? existing?.metadata),
        duration: asset.durationSec,
        width: asset.width,
        height: asset.height,
        fps: asset.fps,
        probe: {
          ...(asset.metadata?.probe ?? existing?.metadata.probe),
          storyboardAiEditor: {
            variant: asset.variant,
            solidColor: asset.solidColor
          }
        }
      },
      importedAt: asset.importedAt ?? existing?.importedAt ?? new Date().toISOString()
    };
  });
  const toNativeClip = (clip: (typeof clips)[number]) => ({
    id: clip.id,
    assetId: clip.assetId,
    trackId: clip.trackId,
    sourceIn: clip.sourceIn,
    sourceOut: clip.sourceOut,
    timelineStart: clip.timelineStart,
    timelineEnd: clip.timelineStart + clip.durationSec,
    speed: 1,
    opacity: 1
  });
  const videoClips = clips
    .filter((clip) => {
      const asset = assets.find((candidate) => candidate.id === clip.assetId);
      return clip.trackId === "video-1" && Boolean(asset) && asset?.kind !== "audio";
    })
    .map(toNativeClip);
  if (videoClips.length === 0) return undefined;
  const audioTracks = (["source-audio-1", "voiceover-1", "music-1"] as const)
    .map((trackId, index) => ({
      id: trackId,
      kind: "audio" as const,
      name: trackId,
      order: index + 1,
      locked: false,
      muted: false,
      visible: true,
      clips: clips
        .filter((clip) => clip.trackId === trackId && Boolean(assetPaths[clip.assetId]))
        .map(toNativeClip)
    }))
    .filter((track) => track.clips.length > 0);
  return {
    assets: nativeAssets,
    assetPaths,
    settings: project.settings,
    timeline: {
      ...project.timeline,
      tracks: [
        {
          id: "video-1", kind: "video", name: "Video", order: 0,
          locked: false, muted: false, visible: true, clips: videoClips
        },
        ...audioTracks
      ],
      duration: Math.max(...clips.map((clip) => clip.timelineStart + clip.durationSec))
    }
  };
}

function parseNativeEncodeSettings(settings: ExportSettings): NativeEncodeSettings | undefined {
  const resolution = settings.resolution === "自定义" ? settings.customResolution : settings.resolution;
  const match = /^(\d+)\s*x\s*(\d+)$/i.exec(resolution.trim());
  const width = match ? Number(match[1]) : undefined;
  const height = match ? Number(match[2]) : undefined;
  const fps = Number(settings.fps);
  const bitrateMatch = /^\s*(\d+(?:\.\d+)?)\s*(k|m|g)?(?:bps)?\s*$/i.exec(settings.bitrate);
  const multiplier = ({ k: 1_000, m: 1_000_000, g: 1_000_000_000 } as const)[bitrateMatch?.[2]?.toLowerCase() as "k" | "m" | "g"] ?? 1;
  const bitRate = bitrateMatch ? Number(bitrateMatch[1]) * multiplier : NaN;
  const codec = ({ H264: "h264", HEVC: "hevc" } as const)[settings.codec];
  if (!width || !height || width % 2 || height % 2 || width > 16384 || height > 16384 || width * height > 134_217_728 || !Number.isFinite(fps) || fps <= 0 || fps > 240 || !Number.isFinite(bitRate) || bitRate <= 0 || bitRate > 2_000_000_000) return undefined;
  return { width, height, fps, bitRate, codec, preset: settings.preset };
}

function safeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, "-").trim() || "export";
}

function formatExportFileTimestamp(date: Date): string {
  return date.toISOString().replace(/\D/g, "");
}

function countPrimaryVideoTimelineClips(
  timelineClips: ReturnType<typeof useEditor>["timelineClips"],
  assets: ReturnType<typeof useEditor>["assets"]
): number {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

  return timelineClips.filter((clip) => {
    const asset = assetsById.get(clip.assetId);
    return clip.trackId === "video-1" && asset && asset.kind !== "audio";
  }).length;
}

interface ProjectStatusInput {
  isAiGeneratingStoryboard: boolean;
  isProjectDirty: boolean;
  isProjectOpen: boolean;
  isProjectSaving: boolean;
  projectMessage?: string;
  storyboardGenerationProgressStage?: string;
}

const resolveProjectStatus = ({
  isAiGeneratingStoryboard,
  isProjectDirty,
  isProjectOpen,
  isProjectSaving,
  projectMessage,
  storyboardGenerationProgressStage
}: ProjectStatusInput): { label: string; className: string } => {
  if (storyboardGenerationProgressStage === "error" && projectMessage) {
    return { label: projectMessage, className: "saved-state is-error" };
  }

  if (isAiGeneratingStoryboard && projectMessage) {
    return { label: projectMessage, className: "saved-state" };
  }

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
