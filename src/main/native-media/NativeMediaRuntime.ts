import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import type { NativeMediaRuntime } from "@shared/native-media-runtime";
import type {
  NativeEncodeResult,
  NativeAudioBuffer,
  NativeMediaAsset,
  NativeMediaLogEvent,
  NativeMediaProbe,
  NativePlaybackSession,
  NativeTimelineProject,
  NativeVideoFrame
} from "@shared/types/native-media";

type SidecarMethod =
  | "openAsset"
  | "probe"
  | "decodeFrame"
  | "createPlaybackSession"
  | "seek"
  | "play"
  | "pause"
  | "renderFrame"
  | "renderAudio"
  | "encodeTimeline"
  | "dispose"
  | "shutdown";

interface SidecarRequest {
  id: number;
  method: SidecarMethod;
  params: Record<string, unknown>;
}

interface SidecarSuccess {
  id: number;
  result: unknown;
}

interface SidecarFailure {
  id: number;
  error: {
    code?: string;
    message?: string;
    nativeCode?: number;
    details?: Record<string, unknown>;
  };
}

interface PendingRequest {
  operation: SidecarMethod;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export class NativeMediaRuntimeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeMediaRuntimeUnavailableError";
  }
}

/**
 * Lifecycle owner for the Go sidecar. Control messages use line-delimited JSON
 * over stdio. Frames are uploaded to WebGL in the renderer; preview audio is
 * sent as short buffered PCM batches so Web Audio can schedule it independently
 * from the video decoder.
 */
export class GoSidecarNativeMediaRuntime implements NativeMediaRuntime {
  private process?: ChildProcessWithoutNullStreams;
  private startPromise?: Promise<void>;
  private nextRequestId = 1;
  private stdoutBuffer = "";
  private readonly pending = new Map<number, PendingRequest>();
  private readonly logListeners = new Set<(event: NativeMediaLogEvent) => void>();

  onLog(listener: (event: NativeMediaLogEvent) => void): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  openAsset(path: string): Promise<NativeMediaAsset> {
    return this.invoke("openAsset", { path });
  }

  probe(path: string): Promise<NativeMediaProbe> {
    return this.invoke("probe", { path });
  }

  decodeFrame(assetId: string, time: number): Promise<NativeVideoFrame> {
    return this.invoke("decodeFrame", { assetId, time });
  }

  createPlaybackSession(
    timeline: NativeTimelineProject
  ): Promise<NativePlaybackSession> {
    return this.invoke("createPlaybackSession", { timeline });
  }

  seek(sessionId: string, time: number): Promise<NativePlaybackSession> {
    return this.invoke("seek", { sessionId, time });
  }

  play(sessionId: string): Promise<NativePlaybackSession> {
    return this.invoke("play", { sessionId });
  }

  pause(sessionId: string): Promise<NativePlaybackSession> {
    return this.invoke("pause", { sessionId });
  }

  renderFrame(sessionId: string, timelineTime: number): Promise<NativeVideoFrame> {
    return this.invoke("renderFrame", {
      sessionId,
      timelineTime
    });
  }

  renderAudio(
    sessionId: string,
    timelineTime: number,
    duration: number
  ): Promise<NativeAudioBuffer> {
    return this.invoke("renderAudio", { sessionId, timelineTime, duration });
  }

  encodeTimeline(
    project: NativeTimelineProject,
    outputPath: string
  ): Promise<NativeEncodeResult> {
    return this.invoke("encodeTimeline", { project, outputPath });
  }

  async dispose(targetId: string): Promise<void> {
    await this.invoke("dispose", { targetId });
  }

  async shutdown(): Promise<void> {
    if (!this.process) {
      return;
    }

    try {
      await this.invoke("shutdown", {});
    } catch {
      // A process that is already exiting does not need a second shutdown error.
    }
    this.process.kill();
    this.process = undefined;
    this.startPromise = undefined;
  }

  private async invoke<T>(
    method: SidecarMethod,
    params: Record<string, unknown>
  ): Promise<T> {
    await this.ensureStarted();
    const process = this.process;
    if (!process?.stdin.writable) {
      throw new NativeMediaRuntimeUnavailableError("libav sidecar is not writable.");
    }

    const id = this.nextRequestId++;
    const request: SidecarRequest = { id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { operation: method, resolve, reject });
      process.stdin.write(`${JSON.stringify(request)}\n`, "utf8", (error) => {
        if (!error) {
          return;
        }
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private ensureStarted(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.start();
    }
    return this.startPromise;
  }

  private async start(): Promise<void> {
    const sidecarPath = await resolveSidecarPath();
    const child = spawn(sidecarPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.process = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.readStdout(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.emitLog({ level: "warning", component: "libav-sidecar", message: chunk.trim() });
    });
    child.on("error", (error) => this.failPending(error));
    child.on("exit", (code, signal) => {
      this.process = undefined;
      this.startPromise = undefined;
      this.failPending(
        new NativeMediaRuntimeUnavailableError(
          `libav sidecar exited (${signal ?? code ?? "unknown"}).`
        )
      );
    });
  }

  private readStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        this.handleMessage(line);
      }
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  private handleMessage(line: string): void {
    let message: SidecarSuccess | SidecarFailure | { event: "log"; payload: NativeMediaLogEvent };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      this.emitLog({ level: "warning", component: "libav-sidecar", message: `Invalid JSON: ${line}` });
      return;
    }

    if ("event" in message) {
      this.emitLog(message.payload);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    if ("error" in message) {
      const error = message.error;
      pending.reject(
        new Error(
          `[${error.code ?? "NATIVE_MEDIA_ERROR"}] ${pending.operation}: ${error.message ?? "sidecar request failed"}`
        )
      );
      return;
    }
    pending.resolve(message.result);
  }

  private emitLog(event: NativeMediaLogEvent): void {
    for (const listener of this.logListeners) {
      listener(event);
    }
  }

  private failPending(error: Error): void {
    for (const { reject } of this.pending.values()) {
      reject(error);
    }
    this.pending.clear();
  }
}

async function resolveSidecarPath(): Promise<string> {
  const configuredPath = process.env.LIBAV_SIDECAR_PATH;
  const candidates = configuredPath
    ? [configuredPath]
    : [
        join(
          app.isPackaged ? process.resourcesPath : process.cwd(),
          "native",
          "libav",
          "bin",
          sidecarName()
        ),
        join(dirname(process.execPath), "native", "libav", "bin", sidecarName())
      ];

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Check all known development and packaged locations before failing.
    }
  }

  throw new NativeMediaRuntimeUnavailableError(
    `libav sidecar was not found. Build native/libav with \`npm run native:libav\` or set LIBAV_SIDECAR_PATH. Checked: ${candidates.join(", ")}`
  );
}

function sidecarName(): string {
  return process.platform === "win32" ? "libav-sidecar.exe" : "libav-sidecar";
}
