import { app } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const VIDEO_URI_KEYS = new Set([
  "gcsUri",
  "uri",
  "url",
  "videoUri",
  "videoUrl",
  "videoURL",
  "video_url",
  "outputUri",
  "output_url"
]);

const VIDEO_BASE64_KEYS = new Set([
  "bytesBase64Encoded",
  "videoBytes",
  "video_bytes",
  "base64",
  "videoBase64"
]);

interface ExtractVideoOutputOptions {
  includeUriOutputs?: boolean;
}

export const extractVideoOutputs = async (
  value: unknown,
  providerId: string,
  options: ExtractVideoOutputOptions = {}
): Promise<string[]> => {
  const outputs: string[] = [];
  await collectVideoOutputs(value, providerId, outputs, undefined, {
    includeUriOutputs: options.includeUriOutputs ?? true
  });
  return Array.from(new Set(outputs));
};

const collectVideoOutputs = async (
  value: unknown,
  providerId: string,
  outputs: string[],
  inheritedMimeType: string | undefined,
  options: Required<ExtractVideoOutputOptions>
): Promise<void> => {
  if (Array.isArray(value)) {
    for (const item of value) {
      await collectVideoOutputs(item, providerId, outputs, inheritedMimeType, options);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const mimeType =
    stringValue(record.mimeType) ??
    stringValue(record.mime_type) ??
    inheritedMimeType;

  for (const [key, item] of Object.entries(record)) {
    if (options.includeUriOutputs && VIDEO_URI_KEYS.has(key) && typeof item === "string") {
      outputs.push(item);
      continue;
    }

    if (VIDEO_BASE64_KEYS.has(key) && typeof item === "string") {
      outputs.push(await saveVideoBase64(item, mimeType, providerId));
      continue;
    }

    await collectVideoOutputs(item, providerId, outputs, mimeType, options);
  }
};

const saveVideoBase64 = async (
  videoBase64: string,
  mimeType: string | undefined,
  providerId: string
): Promise<string> => {
  const generatedDir = join(app.getPath("userData"), "generated-videos", providerId);
  await mkdir(generatedDir, { recursive: true });
  const extension = extensionForMimeType(mimeType);
  const path = join(generatedDir, `${randomUUID()}${extension}`);
  await writeFile(path, Buffer.from(videoBase64, "base64"));
  return pathToFileURL(path).toString();
};

const extensionForMimeType = (mimeType: string | undefined): string => {
  switch (mimeType) {
    case "video/mp4":
      return ".mp4";
    case "video/webm":
      return ".webm";
    case "video/quicktime":
      return ".mov";
    default:
      return ".bin";
  }
};

const stringValue = (value: unknown): string | undefined => {
  return typeof value === "string" ? value : undefined;
};
