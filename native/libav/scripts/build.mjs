import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

const environment = { ...process.env };

if (!canRun("pkg-config", environment)) {
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
  throw new Error(
    "pkg-config is required to find libav. Install pkgconf (for example: brew install pkgconf)."
  );
}

const build = spawnSync(
  "go",
  ["build", "-tags", "libav", "-o", "bin/libav-sidecar", "./cmd/libav-sidecar"],
  { cwd: new URL("..", import.meta.url), stdio: "inherit", env: environment }
);

if (build.error) {
  throw build.error;
}
process.exit(build.status ?? 1);

function canRun(command, env) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore", env });
  return result.status === 0;
}
