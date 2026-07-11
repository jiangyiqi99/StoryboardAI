import { createRequire } from "node:module";
import { join } from "node:path";
import { app } from "electron";

interface SharedMemoryBridgeAddon {
  isAvailable(): boolean;
}

const require = createRequire(import.meta.url);

/**
 * Checks whether Electron can load the ABI-matched bridge. The preload world
 * performs the actual mapping and WebGL upload because Electron IPC cannot
 * serialize SharedArrayBuffer values.
 */
export const loadSharedMemoryBridge = (): SharedMemoryBridgeAddon | undefined => {
  if (process.platform === "win32") return undefined;

  const roots = app.isPackaged
    ? [process.resourcesPath]
    : [process.cwd(), join(process.cwd(), "..")];
  for (const root of roots) {
    const addonPath = join(
      root,
      "native",
      "shared-memory-bridge",
      "bin",
      "frame-shared-memory-bridge.node"
    );
    try {
      const addon = require(addonPath) as SharedMemoryBridgeAddon;
      if (addon.isAvailable()) return addon;
    } catch {
      // The inline transport remains available when the optional native bridge
      // is absent or Electron does not expose external SharedArrayBuffers.
    }
  }
  return undefined;
};
