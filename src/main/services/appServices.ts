import { AiOrchestrator } from "@ai-orchestrator/index";
import { ApiRouter } from "@main/ai-router";
import { createDefaultProviderAdapters } from "@main/providers";
import { createMediaEngineFacade } from "@media-engine/index";
import { LocalProjectFileService } from "@project-system/projectFile";
import type { MediaEngineFacade } from "@shared/types/media-engine";

export interface AppServices {
  projectFiles: LocalProjectFileService;
  mediaEngine: MediaEngineFacade;
  apiRouter: ApiRouter;
  aiOrchestrator: AiOrchestrator;
}

export const createAppServices = (): AppServices => {
  const projectFiles = new LocalProjectFileService();
  const mediaEngine = createMediaEngineFacade();
  const apiRouter = new ApiRouter({
    providers: createDefaultProviderAdapters()
  });
  const aiOrchestrator = new AiOrchestrator({
    projectFiles,
    mediaEngine,
    apiRouter
  });

  return {
    projectFiles,
    mediaEngine,
    apiRouter,
    aiOrchestrator
  };
};
