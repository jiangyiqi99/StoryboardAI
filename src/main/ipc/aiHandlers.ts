import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import type {
  AiGenerateVideoRequest,
  AiGenerateStoryboardRequest,
  AiStoryboardProgressEvent,
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
    (event, request: AiGenerateStoryboardRequest) => {
      const runId = `storyboard-run-${randomUUID()}`;

      return services.aiOrchestrator.generateStoryboard(request, {
        onStoryboardProgress: (progressEvent) => {
          const eventWithRunId: AiStoryboardProgressEvent = {
            ...progressEvent,
            runId
          };

          logStoryboardProgress(eventWithRunId);
          event.sender.send(
            IPC_CHANNELS.AI_STORYBOARD_PROGRESS,
            eventWithRunId
          );
        }
      });
    }
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

const logStoryboardProgress = (event: AiStoryboardProgressEvent): void => {
  const segment =
    event.segmentIndex !== undefined && event.segmentCount !== undefined
      ? ` segment=${event.segmentIndex + 1}/${event.segmentCount}`
      : "";
  const provider = event.providerId ? ` provider=${event.providerId}` : "";
  const model = event.modelId ? ` model=${event.modelId}` : "";
  const job = event.jobId ? ` job=${event.jobId}` : "";
  const providerJob = event.providerJobId
    ? ` providerJob=${event.providerJobId}`
    : "";
  const status = event.status ? ` status=${event.status}` : "";
  const progress =
    event.progress !== undefined ? ` progress=${Math.round(event.progress * 100)}%` : "";
  const output = event.outputUri ? ` outputUri=${event.outputUri}` : "";
  const outputPath = event.outputPath ? ` outputPath=${event.outputPath}` : "";

  console.log(
    `[StoryboardAI][storyboard] run=${event.runId} stage=${event.stage}${segment}${provider}${model}${job}${providerJob}${status}${progress}${output}${outputPath} message=${event.message}`
  );

  if (event.details) {
    console.log("[StoryboardAI][storyboard] details", event.details);
  }
};
