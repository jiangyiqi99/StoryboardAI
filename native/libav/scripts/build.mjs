import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { stageRuntimeLibraries } from "./stage-runtime.mjs";

const environment = { ...process.env };
const outputName = process.platform === "win32" ? "libav-sidecar.exe" : "libav-sidecar";

if (process.platform === "darwin" && !canRun("pkg-config", environment)) {
  const brew = spawnSync("brew", ["--prefix", "pkgconf"], {
    encoding: "utf8",
    env: environment
  });
  const pkgconfBin = brew.status === 0 ? join(brew.stdout.trim(), "bin") : "";
  if (pkgconfBin && existsSync(join(pkgconfBin, "pkg-config"))) {
    environment.PATH = [pkgconfBin, environment.PATH].filter(Boolean).join(delimiter);
  }
}

if (!canRun("pkg-config", environment)) {
  throw new Error(pkgConfigInstallHint());
}

rmSync(new URL(`../bin/${outputName}`, import.meta.url), { force: true });

const build = spawnSync(
  "go",
  ["build", "-tags", "libav", "-o", `bin/${outputName}`, "./cmd/libav-sidecar"],
  { cwd: new URL("..", import.meta.url), stdio: "inherit", env: environment }
);

if (build.error) {
  throw build.error;
}
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

stageRuntimeLibraries({
  sidecarPath: join(new URL("..", import.meta.url).pathname, "bin", outputName)
});

function canRun(command, env) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore", env });
  return result.status === 0;
}

function pkgConfigInstallHint() {
  if (process.platform === "win32") {
    return "pkg-config and FFmpeg development packages are required. Use an MSYS2 MinGW shell with mingw-w64-*-ffmpeg and mingw-w64-*-pkgconf on PATH.";
  }
  if (process.platform === "linux") {
    return "pkg-config and libav development packages are required. Install pkg-config plus libavformat-dev, libavcodec-dev, libavutil-dev, libswscale-dev, and libswresample-dev.";
  }
  return "pkg-config is required to find libav. Install pkgconf (for example: brew install pkgconf).";
}
