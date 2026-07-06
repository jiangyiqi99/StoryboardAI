import type { MediaEngineFacade } from "@shared/types/media-engine";
import { FfmpegFrameEngine } from "./frame/FfmpegFrameEngine";
import { MockPreviewEngine } from "./preview/MockPreviewEngine";
import { FfmpegRenderEngine } from "./render/FfmpegRenderEngine";

export const createMediaEngineFacade = (): MediaEngineFacade => {
  return {
    preview: new MockPreviewEngine(),
    frame: new FfmpegFrameEngine(),
    render: new FfmpegRenderEngine()
  };
};

export * from "./ffmpeg/commandRunner";
export * from "./frame/FfmpegFrameEngine";
export * from "./preview/MockPreviewEngine";
export * from "./render/FfmpegRenderEngine";
