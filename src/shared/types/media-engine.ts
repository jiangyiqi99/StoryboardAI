import type { AssetMetadata } from "./asset";

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

export interface MediaEngineFacade {
  frame: FrameEngine;
}
