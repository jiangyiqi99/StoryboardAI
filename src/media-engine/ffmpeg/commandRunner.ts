import { spawn } from "node:child_process";

const MEDIA_BINARY_ENV: Record<MediaCommand["binary"], string> = {
  ffmpeg: "FFMPEG_PATH",
  ffprobe: "FFPROBE_PATH"
};

export interface MediaCommand {
  binary: "ffmpeg" | "ffprobe";
  args: string[];
  cwd?: string;
}

export interface MediaCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class MediaCommandRunner {
  run(command: MediaCommand): Promise<MediaCommandResult> {
    return new Promise((resolve, reject) => {
      const binary = process.env[MEDIA_BINARY_ENV[command.binary]] || command.binary;
      const child = spawn(binary, command.args, {
        cwd: command.cwd,
        windowsHide: true
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error) => {
        reject(
          new Error(
            `Unable to start ${command.binary}. Install ffmpeg/libav or set ${
              MEDIA_BINARY_ENV[command.binary]
            }. ${error.message}`
          )
        );
      });
      child.on("close", (exitCode) => {
        resolve({
          stdout,
          stderr,
          exitCode: exitCode ?? 0
        });
      });
    });
  }
}
