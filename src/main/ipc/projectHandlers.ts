import { BrowserWindow, dialog, ipcMain } from "electron";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import type {
  ProjectCreateRequest,
  ProjectOpenRequest,
  ProjectRuntimeAssetFile,
  ProjectSaveRequest,
  ProjectSelectCreateDirectoryRequest,
  ProjectSelectCreateDirectoryResponse,
  ProjectSelectOpenLocationRequest,
  ProjectSelectOpenLocationResponse,
  ProjectSession
} from "@shared/ipc/contracts";
import type { Asset } from "@shared/types/asset";
import type { ProjectFileSnapshot } from "@project-system/projectFile";
import {
  fromProjectRelativePath,
  PROJECT_FILE_NAME
} from "@project-system/projectPaths";
import { pathToMediaResourceUrl } from "../mediaResourceProtocol";
import type { AppServices } from "../services/appServices";

export const registerProjectHandlers = (services: AppServices): void => {
  ipcMain.handle(
    IPC_CHANNELS.PROJECT_CREATE,
    (_event, request: ProjectCreateRequest) =>
      services.projectFiles
        .createProject(request)
        .then((snapshot) => toProjectSession(snapshot))
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_OPEN,
    (_event, request: ProjectOpenRequest) =>
      services.projectFiles
        .openProject(request)
        .then((snapshot) => toProjectSession(snapshot))
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_SAVE,
    (_event, request: ProjectSaveRequest) =>
      services.projectFiles
        .saveProject(request)
        .then((snapshot) => toProjectSession(snapshot))
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_SELECT_CREATE_DIRECTORY,
    async (
      event,
      request: ProjectSelectCreateDirectoryRequest
    ): Promise<ProjectSelectCreateDirectoryResponse | null> => {
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.OpenDialogOptions = {
        title: "选择新项目保存位置",
        buttonLabel: "选择此位置",
        defaultPath: request.defaultPath,
        properties: ["openDirectory", "createDirectory", "promptToCreate"]
      };
      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, options)
        : await dialog.showOpenDialog(options);

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return { directoryPath: result.filePaths[0] };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_SELECT_OPEN_LOCATION,
    async (
      event,
      request: ProjectSelectOpenLocationRequest
    ): Promise<ProjectSelectOpenLocationResponse | null> => {
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.OpenDialogOptions = {
        title: "打开 StoryboardAI 项目",
        buttonLabel: "打开项目",
        defaultPath: request.defaultPath,
        message: `请选择 .aivproj 项目文件夹，或包含 ${PROJECT_FILE_NAME} 的项目包。`,
        properties: ["openDirectory", "treatPackageAsDirectory"]
      };
      const result = parentWindow
        ? await dialog.showOpenDialog(parentWindow, options)
        : await dialog.showOpenDialog(options);

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return { projectRootPath: result.filePaths[0] };
    }
  );
};

const toProjectSession = (snapshot: ProjectFileSnapshot): ProjectSession => ({
  project: snapshot.project,
  runtime: snapshot.runtime,
  layout: snapshot.layout,
  assetFiles: snapshot.project.assets.map((asset) =>
    resolveProjectAssetFile(snapshot.runtime.projectRootPath, asset)
  )
});

const resolveProjectAssetFile = (
  projectRootPath: string,
  asset: Asset
): ProjectRuntimeAssetFile => {
  const absolutePath = resolveProjectStoredPath(
    projectRootPath,
    asset.projectRelativePath
  );
  const thumbnailPath = resolveProjectStoredPath(
    projectRootPath,
    asset.thumbnailPath
  );
  const proxyPath = resolveProjectStoredPath(projectRootPath, asset.proxyPath);

  return {
    assetId: asset.id,
    absolutePath,
    fileUrl: toFileUrl(absolutePath),
    thumbnailPath,
    thumbnailUrl: toFileUrl(thumbnailPath),
    proxyPath,
    proxyUrl: toFileUrl(proxyPath)
  };
};

const resolveProjectStoredPath = (
  projectRootPath: string,
  projectRelativePath: string | undefined
): string | undefined => {
  if (!projectRelativePath) {
    return undefined;
  }

  return fromProjectRelativePath(projectRootPath, projectRelativePath);
};

const toFileUrl = (absolutePath: string | undefined): string | undefined => {
  return absolutePath ? pathToMediaResourceUrl(absolutePath) : undefined;
};
