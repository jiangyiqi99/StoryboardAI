import type { Asset } from "./asset";
import type { AiGenerationJob } from "./ai";
import type { EditCommand } from "./editing";
import type { StoryboardSegment } from "./storyboard";
import type { Timeline } from "./timeline";

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
  audioSampleRate: number;
  colorSpace: "srgb" | "rec709" | "display-p3";
  defaultDurationSeconds: number;
  previewResolution: "quarter" | "half" | "full";
}

export interface RenderCacheEntry {
  id: string;
  timelineRange?: {
    start: number;
    end: number;
  };
  outputPath: string;
  fingerprint: string;
  createdAt: string;
}

export interface EditHistory {
  past: EditCommand[];
  future: EditCommand[];
}

export interface Project {
  schemaVersion: string;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: ProjectSettings;
  assets: Asset[];
  timeline: Timeline;
  storyboardSegments: StoryboardSegment[];
  aiGenerationJobs: AiGenerationJob[];
  renderCache: RenderCacheEntry[];
  editHistory: EditHistory;
}

export interface ProjectRuntimeContext {
  projectRootPath: string;
  projectJsonPath: string;
}
