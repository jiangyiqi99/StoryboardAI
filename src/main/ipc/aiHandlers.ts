import { ipcMain } from "electron";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import type {
  AiGenerateVideoRequest,
  AiGenerateStoryboardRequest,
  AiGetJobStatusRequest,
  AiReplaceRangeRequest
} from "@shared/ipc/contracts";
import type { AppServices } from "../services/appServices";

export const registerAiHandlers = (services: AppServices): void => {
  ipcMain.handle(
    IPC_CHANNELS.AI_GENERATE_VIDEO,
    (_event, request: AiGenerateVideoRequest) =>
      services.apiRouter.generateVideo(request)
  );

  ipcMain.handle(
    IPC_CHANNELS.AI_GENERATE_STORYBOARD,
    (_event, request: AiGenerateStoryboardRequest) =>
      services.aiOrchestrator.generateStoryboard(request)
  );

  ipcMain.handle(
    IPC_CHANNELS.AI_REPLACE_RANGE,
    (_event, request: AiReplaceRangeRequest) =>
      services.aiOrchestrator.replaceRange(request)
  );

  ipcMain.handle(
    IPC_CHANNELS.AI_GET_JOB_STATUS,
    (_event, request: AiGetJobStatusRequest) =>
      services.aiOrchestrator.getJobStatus(request)
  );
};
