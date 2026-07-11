import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url);
const source = join(root.pathname, "src", "frame_shared_memory_bridge.cc");
const outputDir = join(root.pathname, "bin");
const output = join(outputDir, "frame-shared-memory-bridge.node");
const electronVersion = JSON.parse(readFileSync(join(process.cwd(), "node_modules/electron/package.json"), "utf8")).version;

mkdirSync(outputDir, { recursive: true });

if (process.platform === "win32") {
  console.warn("native shared-memory bridge is not implemented for Windows yet; inline transport will be used.");
  process.exit(0);
}

const headerRoots = [
  join(homedir(), "Library", "Caches", "node-gyp", electronVersion),
  join(homedir(), ".cache", "node-gyp", electronVersion)
];
let headerRoot = headerRoots.find((candidate) => existsSync(join(candidate, "include", "node", "node.h")));
if (!headerRoot) {
  const install = spawnSync(
    process.execPath,
    [
      "node_modules/node-gyp/bin/node-gyp.js",
      "install",
      `--target=${electronVersion}`,
      "--dist-url=https://electronjs.org/headers"
    ],
    { cwd: process.cwd(), stdio: "inherit" }
  );
  if (install.error) throw install.error;
  if (install.status !== 0) process.exit(install.status ?? 1);
  headerRoot = headerRoots.find((candidate) => existsSync(join(candidate, "include", "node", "node.h")));
}
if (!headerRoot) throw new Error(`Electron ${electronVersion} headers were not installed.`);
const nodeGyp = join(process.cwd(), "node_modules", "node-gyp", "bin", "node-gyp.js");
const build = spawnSync(
  process.execPath,
  [
    nodeGyp,
    "rebuild",
    `--target=${electronVersion}`,
    `--arch=${process.arch}`,
    "--dist-url=https://electronjs.org/headers",
    `--directory=${root.pathname}`
  ],
  { stdio: "inherit" }
);
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
cpSync(join(root.pathname, "build", "Release", "frame_shared_memory_bridge.node"), output);
