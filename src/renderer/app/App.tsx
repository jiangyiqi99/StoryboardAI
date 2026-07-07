import {
  Bot,
  Clapperboard,
  Download,
  Film,
  Folder,
  Sparkles,
  X
} from "lucide-react";
import { useState } from "react";
import {
  defaultExportSettings,
  ExportDialog,
  type ExportSettings
} from "../components/export";
import { Inspector } from "../components/inspector";
import { MediaBin } from "../components/media-bin";
import { Preview } from "../components/preview";
import { ReplaceSelectionPanel } from "../components/replace-selection";
import { StoryScriptPanel } from "../components/story-script";
import { StoryboardPanel } from "../components/storyboard";
import { Timeline } from "../components/timeline";
import { EditorProvider } from "./EditorContext";

type LeftTool = "media-bin" | "story-script" | "assets" | "ai-tools";

const toolItems: Array<{
  key: LeftTool;
  label: string;
  icon: typeof Folder;
}> = [
  { key: "media-bin", label: "媒体库", icon: Folder },
  { key: "story-script", label: "分镜脚本", icon: Film },
  { key: "assets", label: "素材", icon: Folder },
  { key: "ai-tools", label: "AI 工具", icon: Sparkles }
];

export const App = () => {
  const [activeTool, setActiveTool] = useState<LeftTool>("media-bin");
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportSettings, setExportSettings] =
    useState<ExportSettings>(defaultExportSettings);

  return (
    <EditorProvider>
      <div className="desktop-frame">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark">
              <Clapperboard size={21} />
            </div>
            <strong>StoryboardAI</strong>
          </div>
          <nav className="app-menu" aria-label="应用菜单">
            <button type="button">项目</button>
            <button type="button">编辑</button>
            <button type="button">视图</button>
            <button type="button">关于</button>
          </nav>
          <div className="project-state">
            <span>我的项目.aivproj</span>
            <span className="saved-state">已保存</span>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" type="button">
              <Bot size={16} />
              <span>AI 助手</span>
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
              {activeTool === "story-script" ? <StoryScriptPanel /> : <MediaBin />}
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
      </div>
    </EditorProvider>
  );
};
