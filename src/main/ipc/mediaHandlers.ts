import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { createHash } from "node:crypto";
import { copyFile, mkdir, stat } from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve
} from "node:path";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import type {
  ImportedMediaFile,
  ImportedMediaKind,
  MediaExportTimelineClipsRequest,
  MediaExportTimelineClipsResponse,
  MediaExtractPreviewFrameRequest,
  MediaImportFilesRequest,
  MediaExtractFrameRequest,
  MediaProbeRequest,
  MediaRenderTimelineRequest,
  MediaSelectFilesRequest
} from "@shared/ipc/contracts";
import {
  getProjectDirectoryPath,
  isAivProjectRoot,
  toProjectRelativePath
} from "@project-system/projectPaths";
import { pathToMediaResourceUrl } from "../mediaResourceProtocol";
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
      importMediaFiles(services, request.absolutePaths, request.projectRootPath)
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

      return importMediaFiles(
        services,
        result.filePaths,
        request.projectRootPath
      );
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
        url: pathToMediaResourceUrl(path),
        time: request.time
      };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.MEDIA_EXPORT_TIMELINE_CLIPS,
    (_event, request: MediaExportTimelineClipsRequest) =>
      exportTimelineClips(request)
  );

  ipcMain.handle(
    IPC_CHANNELS.MEDIA_RENDER_TIMELINE,
    (_event, request: MediaRenderTimelineRequest) =>
      services.mediaEngine.render.renderTimeline(request)
  );
};

async function importMediaFiles(
  services: AppServices,
  absolutePaths: string[],
  projectRootPath?: string
): Promise<ImportedMediaFile[]> {
  const normalizedProjectRootPath = normalizeImportProjectRootPath(projectRootPath);
  const uniquePaths = Array.from(new Set(absolutePaths.filter(Boolean)));
  const importedFiles: ImportedMediaFile[] = [];

  for (const absolutePath of uniquePaths) {
    const importedAbsolutePath = normalizedProjectRootPath
      ? await copyMediaIntoProject(normalizedProjectRootPath, absolutePath)
      : absolutePath;
    const metadata = await services.mediaEngine.frame.probe({
      absolutePath: importedAbsolutePath
    });
    const kind = getImportedMediaKind(importedAbsolutePath, metadata);
    const fileUrl = pathToMediaResourceUrl(importedAbsolutePath);
    const importedFile: ImportedMediaFile = {
      absolutePath: importedAbsolutePath,
      fileUrl,
      kind,
      name: basename(importedAbsolutePath),
      metadata
    };

    if (normalizedProjectRootPath) {
      importedFile.projectRelativePath = toProjectRelativePath(
        normalizedProjectRootPath,
        importedAbsolutePath
      );
    }

    if (kind === "image") {
      importedFile.thumbnailPath = importedAbsolutePath;
      importedFile.thumbnailUrl = fileUrl;
      importedFile.thumbnailProjectRelativePath =
        importedFile.projectRelativePath;
    }

    if (kind === "video") {
      const thumbnailTime = Math.min(0.25, Math.max(0, (metadata.duration ?? 1) / 20));
      const thumbnailPath = normalizedProjectRootPath
        ? createProjectThumbnailPath(
            normalizedProjectRootPath,
            importedAbsolutePath,
            thumbnailTime,
            480
          )
        : createCachePath("thumbnails", importedAbsolutePath, thumbnailTime, 480);
      importedFile.thumbnailPath = await services.mediaEngine.frame.createThumbnail({
        absolutePath: importedAbsolutePath,
        time: thumbnailTime,
        outputPath: thumbnailPath,
        maxWidth: 480
      });
      importedFile.thumbnailUrl = pathToMediaResourceUrl(importedFile.thumbnailPath);

      if (normalizedProjectRootPath) {
        importedFile.thumbnailProjectRelativePath = toProjectRelativePath(
          normalizedProjectRootPath,
          importedFile.thumbnailPath
        );
      }
    }

    importedFiles.push(importedFile);
  }

  return importedFiles;
}

async function exportTimelineClips(
  request: MediaExportTimelineClipsRequest
): Promise<MediaExportTimelineClipsResponse> {
  const projectRootPath = normalizeImportProjectRootPath(request.projectRootPath);
  if (!projectRootPath) {
    throw new Error("请先新建或打开项目");
  }

  const clips = request.clips
    .filter((clip) => clip.sourcePath)
    .sort((first, second) => first.timelineStart - second.timelineStart);
  if (clips.length === 0) {
    throw new Error("时间线上没有可导出的片段");
  }

  const outputDirectory = await getAvailableSequentialExportDirectory(
    projectRootPath
  );
  await mkdir(outputDirectory, { recursive: true });

  const indexWidth = Math.max(2, String(clips.length).length);
  const files: MediaExportTimelineClipsResponse["files"] = [];

  for (const [index, clip] of clips.entries()) {
    const sourcePath = resolve(clip.sourcePath);
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile()) {
      throw new Error(`${clip.assetName} 不是可导出的文件`);
    }

    const fileName = createSequentialClipFileName({
      index: index + 1,
      indexWidth,
      assetName: clip.assetName,
      sourcePath
    });
    const outputPath = join(outputDirectory, fileName);
    await copyFile(sourcePath, outputPath);
    files.push({
      clipId: clip.clipId,
      sourcePath,
      outputPath,
      fileName
    });
  }

  return {
    outputDirectory,
    files
  };
}

async function getAvailableSequentialExportDirectory(
  projectRootPath: string
): Promise<string> {
  const rendersDirectory = getProjectDirectoryPath(projectRootPath, "renders");
  const baseName = `sequential-clips-${formatExportTimestamp(new Date())}`;

  for (let index = 0; index < 10000; index += 1) {
    const candidateName = index === 0 ? baseName : `${baseName}-${index}`;
    const candidatePath = join(rendersDirectory, candidateName);
    if (!(await pathExists(candidatePath))) {
      return candidatePath;
    }
  }

  throw new Error("Unable to allocate export directory.");
}

function createSequentialClipFileName({
  index,
  indexWidth,
  assetName,
  sourcePath
}: {
  index: number;
  indexWidth: number;
  assetName: string;
  sourcePath: string;
}): string {
  const safeName = sanitizeImportedFileName(assetName);
  const parsedName = parse(safeName);
  const extension = parsedName.ext || extname(sourcePath);
  const baseName = (parsedName.name || "clip").replace(/\.+$/g, "") || "clip";
  const prefix = String(index).padStart(indexWidth, "0");

  return `${prefix}-${baseName}${extension}`;
}

function formatExportTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function normalizeImportProjectRootPath(
  projectRootPath: string | undefined
): string | undefined {
  if (!projectRootPath) {
    return undefined;
  }

  const resolvedProjectRootPath = resolve(projectRootPath);
  if (!isAivProjectRoot(resolvedProjectRootPath)) {
    throw new Error(`Invalid project root: ${projectRootPath}`);
  }

  return resolvedProjectRootPath;
}

async function copyMediaIntoProject(
  projectRootPath: string,
  sourcePath: string
): Promise<string> {
  const assetsDirectory = getProjectDirectoryPath(projectRootPath, "assets");
  const resolvedSourcePath = resolve(sourcePath);

  if (isPathInsideDirectory(assetsDirectory, resolvedSourcePath)) {
    return resolvedSourcePath;
  }

  await mkdir(assetsDirectory, { recursive: true });
  const destinationPath = await getAvailableImportedAssetPath(
    assetsDirectory,
    resolvedSourcePath
  );
  await copyFile(resolvedSourcePath, destinationPath);
  return destinationPath;
}

async function getAvailableImportedAssetPath(
  assetsDirectory: string,
  sourcePath: string
): Promise<string> {
  const safeName = sanitizeImportedFileName(basename(sourcePath));
  const parsedName = parse(safeName);
  const baseName = parsedName.name || "asset";
  const extension = parsedName.ext || extname(sourcePath);

  for (let index = 0; index < 10000; index += 1) {
    const candidateName =
      index === 0 ? `${baseName}${extension}` : `${baseName}-${index}${extension}`;
    const candidatePath = join(assetsDirectory, candidateName);
    if (!(await pathExists(candidatePath))) {
      return candidatePath;
    }
  }

  throw new Error(`Unable to allocate imported media path for ${sourcePath}`);
}

function sanitizeImportedFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  return sanitized || "asset";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function isPathInsideDirectory(directoryPath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(directoryPath), resolve(candidatePath));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
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

function createProjectThumbnailPath(
  projectRootPath: string,
  absolutePath: string,
  time: number,
  maxWidth: number
): string {
  return join(
    getProjectDirectoryPath(projectRootPath, "thumbnails"),
    `${createCacheKey(absolutePath, time, maxWidth)}.jpg`
  );
}

function createCachePath(
  directoryName: string,
  absolutePath: string,
  time: number,
  maxWidth: number
): string {
  return join(
    app.getPath("userData"),
    "media-cache",
    directoryName,
    `${createCacheKey(absolutePath, time, maxWidth)}.jpg`
  );
}

function createCacheKey(
  absolutePath: string,
  time: number,
  maxWidth: number
): string {
  const cacheKey = createHash("sha1")
    .update(`${absolutePath}:${time.toFixed(3)}:${maxWidth}`)
    .digest("hex")
    .slice(0, 18);

  return cacheKey;
}
