export const IPC_CHANNELS = {
  PROJECT_CREATE: "project:create",
  PROJECT_OPEN: "project:open",
  PROJECT_SAVE: "project:save",
  MEDIA_PROBE: "media:probe",
  MEDIA_IMPORT_FILES: "media:importFiles",
  MEDIA_SELECT_FILES: "media:selectFiles",
  MEDIA_EXTRACT_FRAME: "media:extractFrame",
  MEDIA_EXTRACT_PREVIEW_FRAME: "media:extractPreviewFrame",
  MEDIA_RENDER_TIMELINE: "media:renderTimeline",
  APP_CONFIG_GET: "appConfig:get",
  APP_CONFIG_SAVE: "appConfig:save",
  AI_GENERATE_VIDEO: "ai:generateVideo",
  AI_GENERATE_STORYBOARD: "ai:generateStoryboard",
  AI_REPLACE_RANGE: "ai:replaceRange",
  AI_GET_JOB_STATUS: "ai:getJobStatus"
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
