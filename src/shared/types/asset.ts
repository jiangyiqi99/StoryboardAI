export type AssetId = string;

export type AssetKind =
  | "video"
  | "audio"
  | "image"
  | "generated-video"
  | "generated-image";

export type AssetOrigin =
  | "imported"
  | "generated"
  | "proxy"
  | "render-cache";

export interface AssetMetadata {
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  container?: string;
  hasAudio?: boolean;
  sampleRate?: number;
  channels?: number;
  probe?: Record<string, unknown>;
}

export interface Asset {
  id: AssetId;
  kind: AssetKind;
  origin: AssetOrigin;
  name: string;
  projectRelativePath?: string;
  metadata: AssetMetadata;
  thumbnailPath?: string;
  proxyPath?: string;
  generatedByJobId?: string;
  importedAt: string;
  tags?: string[];
}
