import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AssetMetadata } from "@shared/types/asset";
import type {
  ExtractFirstLastFramesRequest,
  ExtractFrameRequest,
  FrameEngine,
  ProbeRequest,
  ProxyRequest,
  ThumbnailRequest
} from "@shared/types/media-engine";
import { MediaCommandRunner } from "../ffmpeg/commandRunner";

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number | string;
  height?: number | string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string | number;
  sample_rate?: string | number;
  channels?: string | number;
}

interface FfprobeFormat {
  duration?: string | number;
  format_name?: string;
}

interface FfprobePayload {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

export class FfmpegFrameEngine implements FrameEngine {
  constructor(private readonly commandRunner = new MediaCommandRunner()) {}

  async probe(request: ProbeRequest): Promise<AssetMetadata> {
    const result = await this.commandRunner.run({
      binary: "ffprobe",
      args: [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        request.absolutePath
      ]
    });

    ensureCommandSucceeded("ffprobe", result.exitCode, result.stderr);

    const probe = parseProbePayload(result.stdout);
    const streams = Array.isArray(probe.streams) ? probe.streams : [];
    const videoStream = streams.find((stream) => stream.codec_type === "video");
    const audioStream = streams.find((stream) => stream.codec_type === "audio");
    const duration =
      readNumber(probe.format?.duration) ??
      readNumber(videoStream?.duration) ??
      readNumber(audioStream?.duration);

    return {
      duration,
      width: readNumber(videoStream?.width),
      height: readNumber(videoStream?.height),
      fps: parseFrameRate(videoStream?.avg_frame_rate || videoStream?.r_frame_rate),
      codec: videoStream?.codec_name ?? audioStream?.codec_name,
      container: probe.format?.format_name,
      hasAudio: Boolean(audioStream),
      sampleRate: readNumber(audioStream?.sample_rate),
      channels: readNumber(audioStream?.channels),
      probe: probe as Record<string, unknown>
    };
  }

  async seek(request: ExtractFrameRequest): Promise<string> {
    return this.extractFrame(request);
  }

  async extractFrame(request: ExtractFrameRequest): Promise<string> {
    await mkdir(dirname(request.outputPath), { recursive: true });

    const result = await this.commandRunner.run({
      binary: "ffmpeg",
      args: [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        formatSeconds(request.time),
        "-i",
        request.absolutePath,
        "-frames:v",
        "1",
        "-update",
        "1",
        "-an",
        request.outputPath
      ]
    });

    ensureCommandSucceeded("ffmpeg frame extraction", result.exitCode, result.stderr);
    await ensureOutputFileWritten("ffmpeg frame extraction", request.outputPath);
    return request.outputPath;
  }

  async extractFirstLastFrames(
    request: ExtractFirstLastFramesRequest
  ): Promise<{ firstFramePath: string; lastFramePath: string }> {
    await mkdir(request.outputDirectory, { recursive: true });

    const firstFramePath = join(request.outputDirectory, "first-frame.jpg");
    const lastFramePath = join(request.outputDirectory, "last-frame.jpg");
    const lastFrameTime = Math.max(request.sourceIn, request.sourceOut - 1 / 24);

    await this.extractFrame({
      absolutePath: request.absolutePath,
      time: request.sourceIn,
      outputPath: firstFramePath
    });
    await this.extractFrame({
      absolutePath: request.absolutePath,
      time: lastFrameTime,
      outputPath: lastFramePath
    });

    return { firstFramePath, lastFramePath };
  }

  async createThumbnail(request: ThumbnailRequest): Promise<string> {
    await mkdir(dirname(request.outputPath), { recursive: true });

    const result = await this.commandRunner.run({
      binary: "ffmpeg",
      args: [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        formatSeconds(request.time),
        "-i",
        request.absolutePath,
        "-frames:v",
        "1",
        "-update",
        "1",
        "-an",
        "-vf",
        `scale=min(${Math.max(1, Math.round(request.maxWidth))}\\,iw):-2`,
        "-q:v",
        "3",
        request.outputPath
      ]
    });

    ensureCommandSucceeded("ffmpeg thumbnail extraction", result.exitCode, result.stderr);
    await ensureOutputFileWritten("ffmpeg thumbnail extraction", request.outputPath);
    return request.outputPath;
  }

  async createProxy(request: ProxyRequest): Promise<string> {
    await mkdir(dirname(request.outputPath), { recursive: true });

    const result = await this.commandRunner.run({
      binary: "ffmpeg",
      args: [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        request.absolutePath,
        "-vf",
        `scale=min(${Math.max(1, Math.round(request.maxWidth))}\\,iw):-2`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "24",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        request.outputPath
      ]
    });

    ensureCommandSucceeded("ffmpeg proxy generation", result.exitCode, result.stderr);
    return request.outputPath;
  }
}

function parseProbePayload(stdout: string): FfprobePayload {
  try {
    return JSON.parse(stdout) as FfprobePayload;
  } catch (error) {
    throw new Error(
      `Unable to parse ffprobe output. ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function readNumber(value: number | string | undefined): number | undefined {
  if (value === undefined || value === null || value === "N/A") {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseFrameRate(value: string | undefined): number | undefined {
  if (!value || value === "0/0") {
    return undefined;
  }

  const [numeratorText, denominatorText] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText ?? "1");
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return undefined;
  }

  const fps = numerator / denominator;
  return Number.isFinite(fps) ? Math.round(fps * 1000) / 1000 : undefined;
}

function formatSeconds(seconds: number): string {
  return Math.max(0, seconds).toFixed(3);
}

function ensureCommandSucceeded(command: string, exitCode: number, stderr: string): void {
  if (exitCode === 0) {
    return;
  }

  throw new Error(`${command} failed with exit code ${exitCode}: ${stderr.trim()}`);
}

async function ensureOutputFileWritten(
  operation: string,
  outputPath: string
): Promise<void> {
  try {
    const stats = await stat(outputPath);
    if (stats.size > 0) {
      return;
    }
  } catch {
    // Throw a consistent media-operation error below.
  }

  throw new Error(`${operation} did not write an output file: ${outputPath}`);
}
