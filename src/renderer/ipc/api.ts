import type { AivDesktopApi } from "@shared/ipc/desktop-api";

const DESKTOP_FILE_ACCESS_ERROR = "请使用桌面应用访问文件";

const createUnavailableDesktopApi = (): AivDesktopApi => {
  const rejectDesktopUnavailable = () =>
    Promise.reject(new Error(DESKTOP_FILE_ACCESS_ERROR));

  return {
    config: {
      get: rejectDesktopUnavailable,
      save: rejectDesktopUnavailable
    },
    project: {
      create: rejectDesktopUnavailable,
      open: rejectDesktopUnavailable,
      save: rejectDesktopUnavailable
    },
    media: {
      probe: rejectDesktopUnavailable,
      importFiles: rejectDesktopUnavailable,
      selectFiles: rejectDesktopUnavailable,
      extractFrame: rejectDesktopUnavailable,
      extractPreviewFrame: rejectDesktopUnavailable,
      renderTimeline: rejectDesktopUnavailable,
      getPathForFile: () => {
        throw new Error(DESKTOP_FILE_ACCESS_ERROR);
      }
    },
    ai: {
      generateVideo: rejectDesktopUnavailable,
      generateStoryboard: rejectDesktopUnavailable,
      replaceRange: rejectDesktopUnavailable,
      getJobStatus: rejectDesktopUnavailable
    }
  };
};

export const isDesktopApiAvailable = (): boolean => {
  return Boolean(window.aiv);
};

export const desktopApi: AivDesktopApi = window.aiv ?? createUnavailableDesktopApi();
