import type { AssetMetadata } from "./asset";
import type { Project } from "./project";
import type { TimelineRange } from "./timeline";

export interface PreviewLoadRequest {
  project: Project;
  previewRootPath: string;
}

export interface PreviewEngine {
  loadTimeline(request: PreviewLoadRequest): Promise<void>;
  seek(time: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  scrub(time: number): Promise<void>;
  setQuality(quality: "quarter" | "half" | "full"): Promise<void>;
  dispose(): Promise<void>;
}

export interface ProbeRequest {
  absolutePath: string;
}

export interface ExtractFrameRequest {
  absolutePath: string;
  time: number;
  outputPath: string;
}

export interface ExtractFirstLastFramesRequest {
  absolutePath: string;
  sourceIn: number;
  sourceOut: number;
  outputDirectory: string;
}

export interface ThumbnailRequest extends ExtractFrameRequest {
  maxWidth: number;
}

export interface ProxyRequest {
  absolutePath: string;
  outputPath: string;
  maxWidth: number;
}

export interface FrameEngine {
  probe(request: ProbeRequest): Promise<AssetMetadata>;
  seek(request: ExtractFrameRequest): Promise<string>;
  extractFrame(request: ExtractFrameRequest): Promise<string>;
  extractFirstLastFrames(
    request: ExtractFirstLastFramesRequest
  ): Promise<{ firstFramePath: string; lastFramePath: string }>;
  createThumbnail(request: ThumbnailRequest): Promise<string>;
  createProxy(request: ProxyRequest): Promise<string>;
}

export interface RenderRequest {
  project: Project;
  outputPath: string;
  range?: TimelineRange;
}

export interface TrimRequest {
  inputPath: string;
  outputPath: string;
  sourceIn: number;
  sourceOut: number;
}

export interface NormalizeRequest {
  inputPath: string;
  outputPath: string;
  settings: Project["settings"];
}

export interface ConcatRequest {
  inputPaths: string[];
  outputPath: string;
  settings: Project["settings"];
}

export interface RenderEngine {
  trim(request: TrimRequest): Promise<string>;
  normalize(request: NormalizeRequest): Promise<string>;
  concat(request: ConcatRequest): Promise<string>;
  renderSelection(request: RenderRequest): Promise<string>;
  renderTimeline(request: RenderRequest): Promise<string>;
  renderReplacementRange(request: RenderRequest): Promise<string>;
  exportTimeline(request: RenderRequest): Promise<string>;
}

export interface MediaEngineFacade {
  preview: PreviewEngine;
  frame: FrameEngine;
  render: RenderEngine;
}
