import type { ImportedMediaFile } from "@shared/ipc/contracts";
import type { EditorMediaAsset, EditorAssetKind } from "./editorTypes";

const getFileKind = (file: File): EditorAssetKind | null => {
  if (file.type.startsWith("video/")) {
    return "video";
  }

  if (file.type.startsWith("audio/")) {
    return "audio";
  }

  if (file.type.startsWith("image/")) {
    return "image";
  }

  return null;
};

const loadMediaMetadata = (
  file: File,
  objectUrl: string,
  kind: EditorAssetKind
): Promise<Pick<EditorMediaAsset, "durationSec" | "width" | "height" | "thumbnailUrl">> => {
  if (kind === "video") {
    return loadVideoMetadata(objectUrl);
  }

  if (kind === "audio") {
    return loadAudioMetadata(objectUrl);
  }

  return loadImageMetadata(objectUrl);
};

const loadVideoMetadata = (
  objectUrl: string
): Promise<Pick<EditorMediaAsset, "durationSec" | "width" | "height" | "thumbnailUrl">> => {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;

    const finish = (thumbnailUrl?: string) => {
      resolve({
        durationSec: Number.isFinite(video.duration) ? video.duration : 8,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        thumbnailUrl
      });
    };

    video.addEventListener(
      "loadedmetadata",
      () => {
        const targetTime = Math.min(0.2, Math.max(0, video.duration / 20));
        video.currentTime = targetTime;
      },
      { once: true }
    );

    video.addEventListener(
      "seeked",
      () => {
        finish(captureVideoFrame(video));
      },
      { once: true }
    );

    video.addEventListener(
      "error",
      () => {
        finish();
      },
      { once: true }
    );
  });
};

const loadAudioMetadata = (
  objectUrl: string
): Promise<Pick<EditorMediaAsset, "durationSec">> => {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = objectUrl;

    audio.addEventListener(
      "loadedmetadata",
      () => {
        resolve({
          durationSec: Number.isFinite(audio.duration) ? audio.duration : 8
        });
      },
      { once: true }
    );

    audio.addEventListener(
      "error",
      () => {
        resolve({ durationSec: 8 });
      },
      { once: true }
    );
  });
};

const loadImageMetadata = (
  objectUrl: string
): Promise<Pick<EditorMediaAsset, "durationSec" | "width" | "height" | "thumbnailUrl">> => {
  return new Promise((resolve) => {
    const image = new window.Image();
    image.src = objectUrl;

    image.addEventListener(
      "load",
      () => {
        resolve({
          durationSec: 5,
          width: image.naturalWidth,
          height: image.naturalHeight,
          thumbnailUrl: objectUrl
        });
      },
      { once: true }
    );

    image.addEventListener(
      "error",
      () => {
        resolve({ durationSec: 5, thumbnailUrl: objectUrl });
      },
      { once: true }
    );
  });
};

const captureVideoFrame = (video: HTMLVideoElement): string | undefined => {
  if (!video.videoWidth || !video.videoHeight) {
    return undefined;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * 320));
  const context = canvas.getContext("2d");
  if (!context) {
    return undefined;
  }

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
};

export const createEditorAssetFromFile = async (
  file: File
): Promise<EditorMediaAsset | null> => {
  const kind = getFileKind(file);
  if (!kind) {
    return null;
  }

  const objectUrl = URL.createObjectURL(file);
  const metadata = await loadMediaMetadata(file, objectUrl, kind);

  return {
    id: `asset-${crypto.randomUUID()}`,
    name: file.name,
    kind,
    objectUrl,
    durationSec: metadata.durationSec,
    width: metadata.width,
    height: metadata.height,
    thumbnailUrl: metadata.thumbnailUrl,
    imported: true
  };
};

export const createEditorAssetFromImportedFile = (
  importedFile: ImportedMediaFile
): EditorMediaAsset => {
  return createImportedEditorAsset(importedFile, {
    id: `asset-${crypto.randomUUID()}`
  });
};

export const updateEditorAssetFromImportedFile = (
  asset: EditorMediaAsset,
  importedFile: ImportedMediaFile
): EditorMediaAsset => {
  return createImportedEditorAsset(importedFile, {
    id: asset.id,
    objectUrl: asset.objectUrl,
    importedAt: asset.importedAt,
    variant: asset.variant,
    solidColor: asset.solidColor
  });
};

const createImportedEditorAsset = (
  importedFile: ImportedMediaFile,
  existing: Pick<EditorMediaAsset, "id"> &
    Partial<
      Pick<
        EditorMediaAsset,
        "objectUrl" | "importedAt" | "variant" | "solidColor"
      >
    >
): EditorMediaAsset => {
  const durationSec =
    importedFile.metadata.duration ?? (importedFile.kind === "image" ? 5 : 8);

  return {
    id: existing.id,
    name: importedFile.name,
    kind: importedFile.kind,
    absolutePath: importedFile.absolutePath,
    projectRelativePath: importedFile.projectRelativePath,
    fileUrl: importedFile.fileUrl,
    objectUrl: existing.objectUrl,
    thumbnailPath: importedFile.thumbnailPath,
    thumbnailUrl:
      importedFile.thumbnailUrl ??
      (importedFile.kind === "image" ? importedFile.fileUrl : undefined),
    thumbnailProjectRelativePath: importedFile.thumbnailProjectRelativePath,
    durationSec,
    width: importedFile.metadata.width,
    height: importedFile.metadata.height,
    fps: importedFile.metadata.fps,
    metadata: importedFile.metadata,
    imported: true,
    importedAt: existing.importedAt ?? new Date().toISOString(),
    variant: existing.variant,
    solidColor: existing.solidColor
  };
};

export const formatDuration = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
};

export const formatTimecode = (seconds: number, fps = 24): string => {
  const safeSeconds = Math.max(0, seconds);
  const wholeSeconds = Math.floor(safeSeconds);
  const frames = Math.floor((safeSeconds - wholeSeconds) * fps);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;

  return `00:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(
    2,
    "0"
  )}:${String(frames).padStart(2, "0")}`;
};

export const formatFps = (fps: number | undefined): string => {
  if (!fps) {
    return "未知";
  }

  const rounded = Number.isInteger(fps)
    ? String(fps)
    : fps.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");

  return `${rounded} fps`;
};
