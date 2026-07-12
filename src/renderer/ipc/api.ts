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
      save: rejectDesktopUnavailable,
      selectCreateDirectory: rejectDesktopUnavailable,
      selectOpenLocation: rejectDesktopUnavailable
    },
    storyScript: {
      selectImportFile: rejectDesktopUnavailable,
      saveTemplate: rejectDesktopUnavailable
    },
    media: {
      probe: rejectDesktopUnavailable,
      importFiles: rejectDesktopUnavailable,
      selectFiles: rejectDesktopUnavailable,
      extractFrame: rejectDesktopUnavailable,
      extractPreviewFrame: rejectDesktopUnavailable,
      exportTimelineClips: rejectDesktopUnavailable,
      getPathForFile: () => {
        throw new Error(DESKTOP_FILE_ACCESS_ERROR);
      }
    },
    nativeMedia: {
      openAsset: rejectDesktopUnavailable,
      probe: rejectDesktopUnavailable,
      decodeFrame: rejectDesktopUnavailable,
      createPlaybackSession: rejectDesktopUnavailable,
      seek: rejectDesktopUnavailable,
      play: rejectDesktopUnavailable,
      pause: rejectDesktopUnavailable,
      renderFrame: rejectDesktopUnavailable,
      renderAudio: rejectDesktopUnavailable,
      encodeTimeline: rejectDesktopUnavailable,
      dispose: rejectDesktopUnavailable
    },
    ai: {
      generateVideo: rejectDesktopUnavailable,
      generateStoryboard: rejectDesktopUnavailable,
      onStoryboardProgress: () => {
        return () => undefined;
      },
      replaceRange: rejectDesktopUnavailable,
      getJobStatus: rejectDesktopUnavailable
    }
  };
};

export const isDesktopApiAvailable = (): boolean => {
  return Boolean(window.aiv);
};

export const desktopApi: AivDesktopApi = window.aiv ?? createUnavailableDesktopApi();
