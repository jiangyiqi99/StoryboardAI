import type { ProjectSettings } from "@shared/types/project";

export const PROJECT_SCHEMA_VERSION = "0.1.0";

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  width: 1920,
  height: 1080,
  fps: 24,
  audioSampleRate: 48000,
  colorSpace: "rec709",
  defaultDurationSeconds: 4,
  previewResolution: "half"
};
