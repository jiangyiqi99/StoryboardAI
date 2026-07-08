import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import type { IpcInvokeMap } from "@shared/ipc/contracts";
import type { AivDesktopApi } from "@shared/ipc/desktop-api";

const invoke = <TChannel extends keyof IpcInvokeMap>(
  channel: TChannel,
  request: IpcInvokeMap[TChannel]["request"]
): Promise<IpcInvokeMap[TChannel]["response"]> => {
  return ipcRenderer.invoke(channel, request);
};

export const desktopApi: AivDesktopApi = {
  config: {
    get: (request = {}) => invoke(IPC_CHANNELS.APP_CONFIG_GET, request),
    save: (request) => invoke(IPC_CHANNELS.APP_CONFIG_SAVE, request)
  },
  project: {
    create: (request) => invoke(IPC_CHANNELS.PROJECT_CREATE, request),
    open: (request) => invoke(IPC_CHANNELS.PROJECT_OPEN, request),
    save: (request) => invoke(IPC_CHANNELS.PROJECT_SAVE, request)
  },
  media: {
    probe: (request) => invoke(IPC_CHANNELS.MEDIA_PROBE, request),
    importFiles: (request) => invoke(IPC_CHANNELS.MEDIA_IMPORT_FILES, request),
    selectFiles: (request = {}) => invoke(IPC_CHANNELS.MEDIA_SELECT_FILES, request),
    extractFrame: (request) =>
      invoke(IPC_CHANNELS.MEDIA_EXTRACT_FRAME, request),
    extractPreviewFrame: (request) =>
      invoke(IPC_CHANNELS.MEDIA_EXTRACT_PREVIEW_FRAME, request),
    renderTimeline: (request) =>
      invoke(IPC_CHANNELS.MEDIA_RENDER_TIMELINE, request),
    getPathForFile: (file) => webUtils.getPathForFile(file)
  },
  ai: {
    generateVideo: (request) => invoke(IPC_CHANNELS.AI_GENERATE_VIDEO, request),
    generateStoryboard: (request) =>
      invoke(IPC_CHANNELS.AI_GENERATE_STORYBOARD, request),
    replaceRange: (request) => invoke(IPC_CHANNELS.AI_REPLACE_RANGE, request),
    getJobStatus: (request) => invoke(IPC_CHANNELS.AI_GET_JOB_STATUS, request)
  }
};

contextBridge.exposeInMainWorld("aiv", desktopApi);
