import type {
  GenerateVideoRequest,
  ResolvedAssetReference
} from "@shared/ai-routing";
import { pathToFileURL } from "node:url";

export class AssetReferenceResolver {
  async resolve(request: GenerateVideoRequest): Promise<ResolvedAssetReference[]> {
    const references: ResolvedAssetReference[] = [];

    for (const [index, referenceImage] of (request.referenceImages ?? []).entries()) {
      if (referenceImage.assetId || referenceImage.uri || referenceImage.absolutePath) {
        const role =
          referenceImage.role === "first-frame" ||
          referenceImage.role === "last-frame"
            ? referenceImage.role
            : "reference-image";
        references.push({
          assetId: referenceImage.assetId ?? `external-reference-${index}`,
          role,
          uri:
            referenceImage.uri ??
            (referenceImage.absolutePath
              ? pathToFileURL(referenceImage.absolutePath).toString()
              : `aiv-asset://${referenceImage.assetId}`),
          absolutePath: referenceImage.absolutePath,
          mimeType: referenceImage.mimeType
        });
      }
    }

    if (request.firstFrameAssetId) {
      references.push({
        assetId: request.firstFrameAssetId,
        role: "first-frame",
        uri: `aiv-frame://${request.firstFrameAssetId}/first`
      });
    }

    if (request.firstFrameUri || request.firstFramePath) {
      references.push({
        assetId: "external-first-frame",
        role: "first-frame",
        uri: request.firstFrameUri ?? pathToFileURL(request.firstFramePath!).toString(),
        absolutePath: request.firstFramePath
      });
    }

    if (request.lastFrameAssetId) {
      references.push({
        assetId: request.lastFrameAssetId,
        role: "last-frame",
        uri: `aiv-frame://${request.lastFrameAssetId}/last`
      });
    }

    if (request.lastFrameUri || request.lastFramePath) {
      references.push({
        assetId: "external-last-frame",
        role: "last-frame",
        uri: request.lastFrameUri ?? pathToFileURL(request.lastFramePath!).toString(),
        absolutePath: request.lastFramePath
      });
    }

    if (request.inputVideoAssetId) {
      references.push({
        assetId: request.inputVideoAssetId,
        role: "input-video",
        uri: `aiv-asset://${request.inputVideoAssetId}`
      });
    }

    if (request.inputVideoUri || request.inputVideoPath) {
      references.push({
        assetId: "external-input-video",
        role: "input-video",
        uri: request.inputVideoUri ?? pathToFileURL(request.inputVideoPath!).toString(),
        absolutePath: request.inputVideoPath
      });
    }

    if (request.maskAssetId) {
      references.push({
        assetId: request.maskAssetId,
        role: "mask",
        uri: `aiv-asset://${request.maskAssetId}`
      });
    }

    if (request.maskUri || request.maskPath) {
      references.push({
        assetId: "external-mask",
        role: "mask",
        uri: request.maskUri ?? pathToFileURL(request.maskPath!).toString(),
        absolutePath: request.maskPath
      });
    }

    // TODO: resolve project-relative Asset paths, uploadable temp files, or proxy URLs.
    return references;
  }
}
