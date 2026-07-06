import type { AiGenerateStoryboardRequest } from "@shared/ipc/contracts";
import type { ApiRouter as AiApiRouter } from "@shared/ai-routing";
import type { AiGenerationJob } from "@shared/types/ai";
import type { MediaEngineFacade } from "@shared/types/media-engine";
import type { LocalProjectFileService } from "@project-system/projectFile";

export interface StoryboardWorkflowServices {
  projectFiles: LocalProjectFileService;
  mediaEngine: MediaEngineFacade;
  apiRouter: AiApiRouter;
}

export class StoryboardToTimelineWorkflow {
  constructor(private readonly services: StoryboardWorkflowServices) {}

  async run(request: AiGenerateStoryboardRequest): Promise<AiGenerationJob[]> {
    void this.services.projectFiles;
    void this.services.mediaEngine;
    void this.services.apiRouter;

    // TODO:
    // 1. Load project.json from request.projectRootPath.
    // 2. Split script into StoryboardSegment records.
    // 3. Generate the first segment through ApiRouter.generateVideo({ mode: "text-to-video" }).
    // 4. Extract the previous segment tail frame.
    // 5. Generate following segments through ApiRouter.generateVideo({ mode: "first-frame-to-video" }).
    // 6. Register generated outputs as Asset records.
    // 7. Insert each asset as a non-destructive Timeline Clip.
    // 8. Save project.json with segments, jobs, assets, timeline, and edit history.
    return [];
  }
}
