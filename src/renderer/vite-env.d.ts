/// <reference types="vite/client" />

import type { AivDesktopApi } from "@shared/ipc/desktop-api";

declare global {
  interface Window {
    aiv?: AivDesktopApi;
  }
}

export {};
