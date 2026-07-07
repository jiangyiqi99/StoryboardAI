import type { AivDesktopApi } from "@shared/ipc/desktop-api";

const createUnavailableDesktopApi = (): AivDesktopApi => {
  const rejectUnavailable = () =>
    Promise.reject(new Error("桌面 API 暂不可用，请使用本地文件选择导入素材。"));

  return {
    project: {
      create: rejectUnavailable,
      open: rejectUnavailable,
      save: rejectUnavailable
    },
    media: {
      probe: rejectUnavailable,
      importFiles: rejectUnavailable,
      selectFiles: rejectUnavailable,
      extractFrame: rejectUnavailable,
      extractPreviewFrame: rejectUnavailable,
      renderTimeline: rejectUnavailable,
      getPathForFile: () => {
        throw new Error("桌面 API 暂不可用");
      }
    },
    ai: {
      generateStoryboard: rejectUnavailable,
      replaceRange: rejectUnavailable,
      getJobStatus: rejectUnavailable
    }
  };
};

export const isDesktopApiAvailable = (): boolean => {
  return Boolean(window.aiv?.media);
};

export const desktopApi: AivDesktopApi = window.aiv ?? createUnavailableDesktopApi();
