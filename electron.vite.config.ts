import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const alias = {
  "@shared": resolve("src/shared"),
  "@main": resolve("src/main"),
  "@renderer": resolve("src/renderer"),
  "@project-system": resolve("src/project-system"),
  "@media-engine": resolve("src/media-engine"),
  "@ai-orchestrator": resolve("src/ai-orchestrator"),
  "@editing": resolve("src/editing"),
  "@model-proxy": resolve("src/model-proxy")
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: resolve("src/main/index.ts")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: resolve("src/preload/index.ts")
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: resolve("src/renderer/index.html")
      }
    }
  }
});
