import { ipcMain } from "electron";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import type {
  ProjectCreateRequest,
  ProjectOpenRequest,
  ProjectSaveRequest
} from "@shared/ipc/contracts";
import type { AppServices } from "../services/appServices";

export const registerProjectHandlers = (services: AppServices): void => {
  ipcMain.handle(
    IPC_CHANNELS.PROJECT_CREATE,
    (_event, request: ProjectCreateRequest) =>
      services.projectFiles.createProject(request)
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_OPEN,
    (_event, request: ProjectOpenRequest) =>
      services.projectFiles.openProject(request)
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_SAVE,
    (_event, request: ProjectSaveRequest) =>
      services.projectFiles.saveProject(request)
  );
};
