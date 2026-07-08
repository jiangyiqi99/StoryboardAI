import { protocol } from "electron";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import { Readable } from "node:stream";

const MEDIA_RESOURCE_PROTOCOL = "aiv-media";
const MEDIA_RESOURCE_HOST = "file";

export const registerMediaResourceProtocolScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_RESOURCE_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true
      }
    }
  ]);
};

export const registerMediaResourceProtocol = (): void => {
  protocol.handle(MEDIA_RESOURCE_PROTOCOL, async (request) => {
    const absolutePath = mediaResourceUrlToPath(request.url);
    if (!absolutePath) {
      return new Response("Invalid media resource URL.", { status: 400 });
    }

    try {
      const stats = await stat(absolutePath);
      if (!stats.isFile()) {
        return new Response("Not a file.", { status: 404 });
      }

      const totalSize = stats.size;
      const contentType = inferContentType(absolutePath);
      const rangeHeader = request.headers.get("range");
      const range = parseRangeHeader(rangeHeader, totalSize);

      if (range) {
        const { start, end } = range;
        const chunkSize = end - start + 1;
        const stream = toWebStream(createReadStream(absolutePath, { start, end }));

        return new Response(stream, {
          status: 206,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(chunkSize),
            "Content-Range": `bytes ${start}-${end}/${totalSize}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache"
          }
        });
      }

      const stream = toWebStream(createReadStream(absolutePath));
      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(totalSize),
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-cache"
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(`Failed to load media: ${message}`, { status: 500 });
    }
  });
};

export const pathToMediaResourceUrl = (absolutePath: string): string => {
  return `${MEDIA_RESOURCE_PROTOCOL}://${MEDIA_RESOURCE_HOST}/${encodeURIComponent(
    absolutePath
  )}`;
};

const mediaResourceUrlToPath = (resourceUrl: string): string | undefined => {
  try {
    const url = new URL(resourceUrl);
    if (
      url.protocol !== `${MEDIA_RESOURCE_PROTOCOL}:` ||
      url.hostname !== MEDIA_RESOURCE_HOST
    ) {
      return undefined;
    }

    const absolutePath = decodeURIComponent(url.pathname.slice(1));
    return isAbsolute(absolutePath) ? absolutePath : undefined;
  } catch {
    return undefined;
  }
};

interface ByteRange {
  start: number;
  end: number;
}

const parseRangeHeader = (
  rangeHeader: string | null,
  totalSize: number
): ByteRange | undefined => {
  if (!rangeHeader || totalSize <= 0) {
    return undefined;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) {
    return undefined;
  }

  const [, rawStart, rawEnd] = match;
  const hasStart = rawStart.length > 0;
  const hasEnd = rawEnd.length > 0;

  let start: number;
  let end: number;

  if (hasStart) {
    start = Number(rawStart);
    end = hasEnd ? Number(rawEnd) : totalSize - 1;
  } else if (hasEnd) {
    const suffixLength = Number(rawEnd);
    if (suffixLength <= 0) {
      return undefined;
    }
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else {
    return undefined;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return undefined;
  }

  end = Math.min(end, totalSize - 1);
  if (start > end || start < 0) {
    return undefined;
  }

  return { start, end };
};

const toWebStream = (nodeStream: NodeJS.ReadableStream): ReadableStream => {
  return Readable.toWeb(nodeStream as Readable) as unknown as ReadableStream;
};

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp"
};

const inferContentType = (absolutePath: string): string => {
  const ext = extname(absolutePath).toLowerCase();
  return CONTENT_TYPE_BY_EXTENSION[ext] ?? "application/octet-stream";
};
