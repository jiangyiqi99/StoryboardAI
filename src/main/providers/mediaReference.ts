import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedAssetReference } from "@shared/ai-routing";

export interface LoadedMediaReference {
  mimeType: string;
  bytesBase64Encoded?: string;
  uri?: string;
  gcsUri?: string;
}

const MIME_TYPES_BY_EXTENSION = new Map<string, string>([
  [".apng", "image/apng"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".webp", "image/webp"],
  [".m4v", "video/mp4"],
  [".mkv", "video/x-matroska"],
  [".mov", "video/quicktime"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"]
]);

export const loadMediaReference = async (
  reference: ResolvedAssetReference
): Promise<LoadedMediaReference> => {
  const mimeType = reference.mimeType ?? inferMimeType(reference);

  if (reference.uri.startsWith("gs://")) {
    return {
      gcsUri: reference.uri,
      mimeType
    };
  }

  if (reference.uri.startsWith("http://") || reference.uri.startsWith("https://")) {
    const response = await fetch(reference.uri);
    if (!response.ok) {
      throw new Error(`Failed to fetch media reference: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      bytesBase64Encoded: Buffer.from(arrayBuffer).toString("base64"),
      mimeType: response.headers.get("content-type") ?? mimeType
    };
  }

  const absolutePath = reference.absolutePath ?? uriToPath(reference.uri);
  if (!absolutePath) {
    throw new Error(
      `Media reference ${reference.assetId} must resolve to a file, HTTP URL, or GCS URI.`
    );
  }

  const bytes = await readFile(absolutePath);
  return {
    bytesBase64Encoded: bytes.toString("base64"),
    mimeType
  };
};

export const isRemoteHttpUri = (uri: string): boolean => {
  return uri.startsWith("http://") || uri.startsWith("https://");
};

export const isGcsUri = (uri: string): boolean => {
  return uri.startsWith("gs://");
};

const uriToPath = (uri: string): string | undefined => {
  if (uri.startsWith("file://")) {
    return fileURLToPath(uri);
  }

  if (uri.startsWith("/")) {
    return uri;
  }

  return undefined;
};

const inferMimeType = (reference: ResolvedAssetReference): string => {
  const sourcePath = reference.absolutePath ?? uriToPath(reference.uri) ?? reference.uri;
  const extension = extname(sourcePath).toLowerCase();
  return MIME_TYPES_BY_EXTENSION.get(extension) ?? "application/octet-stream";
};
