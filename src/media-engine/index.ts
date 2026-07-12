import type { MediaEngineFacade } from "@shared/types/media-engine";
import { FfmpegFrameEngine } from "./frame/FfmpegFrameEngine";

export const createMediaEngineFacade = (): MediaEngineFacade => {
  return {
    frame: new FfmpegFrameEngine()
  };
};

export * from "./ffmpeg/commandRunner";
export * from "./frame/FfmpegFrameEngine";
