import type {
  ConcatRequest,
  NormalizeRequest,
  RenderEngine,
  RenderRequest,
  TrimRequest
} from "@shared/types/media-engine";
import { MediaCommandRunner } from "../ffmpeg/commandRunner";

export class FfmpegRenderEngine implements RenderEngine {
  constructor(private readonly commandRunner = new MediaCommandRunner()) {}

  async trim(_request: TrimRequest): Promise<string> {
    void this.commandRunner;
    // TODO: trim without mutating the source asset.
    throw new Error("Trim rendering is not implemented in the architecture scaffold.");
  }

  async normalize(_request: NormalizeRequest): Promise<string> {
    // TODO: normalize generated media to project resolution, fps, audio, and container.
    throw new Error("Normalize rendering is not implemented in the architecture scaffold.");
  }

  async concat(_request: ConcatRequest): Promise<string> {
    // TODO: concatenate normalized intermediate files.
    throw new Error("Concat rendering is not implemented in the architecture scaffold.");
  }

  async renderSelection(_request: RenderRequest): Promise<string> {
    // TODO: render the selected TimelineRange using cache-aware intermediate files.
    throw new Error("Selection rendering is not implemented in the architecture scaffold.");
  }

  async renderTimeline(_request: RenderRequest): Promise<string> {
    // TODO: traverse timeline tracks and clips, then render a final timeline output.
    throw new Error("Timeline rendering is not implemented in the architecture scaffold.");
  }

  async renderReplacementRange(_request: RenderRequest): Promise<string> {
    // TODO: render only the replace range context when needed by AI workflows.
    throw new Error(
      "Replacement range rendering is not implemented in the architecture scaffold."
    );
  }

  async exportTimeline(request: RenderRequest): Promise<string> {
    return this.renderTimeline(request);
  }
}
