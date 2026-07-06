import { randomUUID } from "node:crypto";
import type { AiReplaceRangeRequest } from "@shared/ipc/contracts";
import type { ApiRouter as AiApiRouter } from "@shared/ai-routing";
import type { AiGenerationJob } from "@shared/types/ai";
import type { MediaEngineFacade } from "@shared/types/media-engine";
import type { LocalProjectFileService } from "@project-system/projectFile";

export interface ReplaceRangeWorkflowServices {
  projectFiles: LocalProjectFileService;
  mediaEngine: MediaEngineFacade;
  apiRouter: AiApiRouter;
}

export class ReplaceRangeWorkflow {
  constructor(private readonly services: ReplaceRangeWorkflowServices) {}

  async run(request: AiReplaceRangeRequest): Promise<AiGenerationJob> {
    const duration = request.range.end - request.range.start;
    void this.services.projectFiles;
    void this.services.mediaEngine;
    void this.services.apiRouter;

    // TODO:
    // 1. Load project and resolve selected clips from request.range + request.trackId.
    // 2. Ask FrameEngine to extract first and last boundary frames.
    // 3. Submit generation through ApiRouter.generateVideo({ mode: "replace-range" }).
    // 4. Normalize provider output through RenderEngine.normalize.
    // 5. Register the generated output as a new Asset.
    // 6. Create a REPLACE_RANGE command.
    // 7. Split original clips into before/replacement/after without changing source media.
    // 8. Save project.json and append the command to editHistory.past.
    return {
      id: `replace-range-${randomUUID()}`,
      workflow: "replace-range",
      mode: "first-last-frame",
      status: "queued",
      providerId: request.providerId,
      modelId: request.modelId,
      prompt: request.prompt,
      duration,
      inputAssetIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }
}
