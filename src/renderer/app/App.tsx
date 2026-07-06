import {
  Bot,
  Clapperboard,
  Download,
  Film,
  Folder,
  Layers3,
  Music2,
  Sparkles,
  Sticker,
  Text,
  WandSparkles,
  X
} from "lucide-react";
import { Inspector } from "../components/inspector";
import { MediaBin } from "../components/media-bin";
import { Preview } from "../components/preview";
import { ReplaceSelectionPanel } from "../components/replace-selection";
import { StoryboardPanel } from "../components/storyboard";
import { Timeline } from "../components/timeline";
import { EditorProvider } from "./EditorContext";

const toolItems = [
  { label: "媒体库", icon: Folder, active: true },
  { label: "分镜脚本", icon: Film },
  { label: "素材", icon: Folder },
  { label: "音频", icon: Music2 },
  { label: "文本", icon: Text },
  { label: "转场", icon: Layers3 },
  { label: "特效", icon: WandSparkles },
  { label: "贴纸", icon: Sticker },
  { label: "AI 工具", icon: Sparkles }
];

export const App = () => {
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
          <button type="button">导出</button>
          <button type="button">帮助</button>
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
          <button className="primary-button" type="button">
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
            return (
              <button
                className={item.active ? "tool-item is-active" : "tool-item"}
                key={item.label}
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
            <MediaBin />
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
      </div>
    </EditorProvider>
  );
};
