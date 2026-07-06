import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { createHash } from "node:crypto";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import type {
  ImportedMediaFile,
  ImportedMediaKind,
  MediaExtractPreviewFrameRequest,
  MediaImportFilesRequest,
  MediaExtractFrameRequest,
  MediaProbeRequest,
  MediaRenderTimelineRequest,
  MediaSelectFilesRequest
} from "@shared/ipc/contracts";
import type { AppServices } from "../services/appServices";

const IMAGE_EXTENSIONS = new Set([
  ".apng",
  ".avif",
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp"
]);

export const registerMediaHandlers = (services: AppServices): void => {
  ipcMain.handle(
    IPC_CHANNELS.MEDIA_PROBE,
    (_event, request: MediaProbeRequest) => services.mediaEngine.frame.probe(request)
  );

  ipcMain.handle(
    IPC_CHANNELS.MEDIA_IMPORT_FILES,
    (_event, request: MediaImportFilesRequest) =>
      importMediaFiles(services, request.absolutePaths)
  );

  ipcMain.handle(
    IPC_CHANNELS.MEDIA_SELECT_FILES,
    async (event, request: MediaSelectFilesRequest) => {
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.OpenDialogOptions = {
        properties:
          request.allowMultiple === false ? ["openFile"] : ["openFile", "multiSelections"],
        filters: [
          {
            name: "Media",
            extensions: [
              "mp4",
              "mov",
              "m4v",
              "mkv",
              "webm",
              "avi",
              "wav",
              "mp3",
              "aac",
              "m4a",
              "flac",
              "ogg",
              "png",
              "jpg",
              "jpeg",
              "webp",
              "gif",
              "bmp",
              "tiff"
            ]
          },
          { name: "All Files", extensions: ["*"] }
        ]
      };
      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, options)
        : await dialog.showOpenDialog(options);

      if (result.canceled || result.filePaths.length === 0) {
        return [];
      }

      return importMediaFiles(services, result.filePaths);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.MEDIA_EXTRACT_FRAME,
    (_event, request: MediaExtractFrameRequest) =>
      services.mediaEngine.frame.extractFrame(request)
  );

  ipcMain.handle(
    IPC_CHANNELS.MEDIA_EXTRACT_PREVIEW_FRAME,
    async (_event, request: MediaExtractPreviewFrameRequest) => {
      const outputPath = createCachePath(
        "preview-frames",
        request.absolutePath,
        request.time,
        request.maxWidth ?? 360
      );
      const path = await services.mediaEngine.frame.createThumbnail({
        absolutePath: request.absolutePath,
        time: request.time,
        outputPath,
        maxWidth: request.maxWidth ?? 360
      });

      return {
        path,
        url: pathToFileURL(path).toString(),
        time: request.time
      };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.MEDIA_RENDER_TIMELINE,
    (_event, request: MediaRenderTimelineRequest) =>
      services.mediaEngine.render.renderTimeline(request)
  );
};

async function importMediaFiles(
  services: AppServices,
  absolutePaths: string[]
): Promise<ImportedMediaFile[]> {
  const uniquePaths = Array.from(new Set(absolutePaths.filter(Boolean)));
  const importedFiles: ImportedMediaFile[] = [];

  for (const absolutePath of uniquePaths) {
    const metadata = await services.mediaEngine.frame.probe({ absolutePath });
    const kind = getImportedMediaKind(absolutePath, metadata);
    const fileUrl = pathToFileURL(absolutePath).toString();
    const importedFile: ImportedMediaFile = {
      absolutePath,
      fileUrl,
      kind,
      name: basename(absolutePath),
      metadata
    };

    if (kind === "image") {
      importedFile.thumbnailPath = absolutePath;
      importedFile.thumbnailUrl = fileUrl;
    }

    if (kind === "video") {
      const thumbnailTime = Math.min(0.25, Math.max(0, (metadata.duration ?? 1) / 20));
      const thumbnailPath = createCachePath(
        "thumbnails",
        absolutePath,
        thumbnailTime,
        480
      );
      importedFile.thumbnailPath = await services.mediaEngine.frame.createThumbnail({
        absolutePath,
        time: thumbnailTime,
        outputPath: thumbnailPath,
        maxWidth: 480
      });
      importedFile.thumbnailUrl = pathToFileURL(importedFile.thumbnailPath).toString();
    }

    importedFiles.push(importedFile);
  }

  return importedFiles;
}

function getImportedMediaKind(
  absolutePath: string,
  metadata: ImportedMediaFile["metadata"]
): ImportedMediaKind {
  const extension = extname(absolutePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }

  if (metadata.width && metadata.height) {
    return "video";
  }

  if (metadata.hasAudio) {
    return "audio";
  }

  throw new Error(`Unsupported media file: ${absolutePath}`);
}

function createCachePath(
  directoryName: string,
  absolutePath: string,
  time: number,
  maxWidth: number
): string {
  const cacheKey = createHash("sha1")
    .update(`${absolutePath}:${time.toFixed(3)}:${maxWidth}`)
    .digest("hex")
    .slice(0, 18);

  return join(app.getPath("userData"), "media-cache", directoryName, `${cacheKey}.jpg`);
}
