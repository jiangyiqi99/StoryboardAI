import { ipcMain } from "electron";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import type {
  AppConfigGetRequest,
  AppConfigSaveRequest
} from "@shared/types/app-config";
import type { AppServices } from "../services/appServices";

export const registerAppConfigHandlers = (services: AppServices): void => {
  ipcMain.handle(
    IPC_CHANNELS.APP_CONFIG_GET,
    (_event, _request: AppConfigGetRequest = {}) =>
      services.appConfig.getConfig()
  );

  ipcMain.handle(
    IPC_CHANNELS.APP_CONFIG_SAVE,
    (_event, request: AppConfigSaveRequest) =>
      services.appConfig.saveConfig(request)
  );
};
