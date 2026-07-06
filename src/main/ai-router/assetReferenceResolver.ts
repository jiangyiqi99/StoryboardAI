import type {
  GenerateVideoRequest,
  ResolvedAssetReference
} from "@shared/ai-routing";

export class AssetReferenceResolver {
  async resolve(request: GenerateVideoRequest): Promise<ResolvedAssetReference[]> {
    const references: ResolvedAssetReference[] = [];

    for (const [index, referenceImage] of (request.referenceImages ?? []).entries()) {
      if (referenceImage.assetId || referenceImage.uri) {
        references.push({
          assetId: referenceImage.assetId ?? `external-reference-${index}`,
          role: "reference-image",
          uri: referenceImage.uri ?? `aiv-asset://${referenceImage.assetId}`
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

    if (request.lastFrameAssetId) {
      references.push({
        assetId: request.lastFrameAssetId,
        role: "last-frame",
        uri: `aiv-frame://${request.lastFrameAssetId}/last`
      });
    }

    if (request.inputVideoAssetId) {
      references.push({
        assetId: request.inputVideoAssetId,
        role: "input-video",
        uri: `aiv-asset://${request.inputVideoAssetId}`
      });
    }

    if (request.maskAssetId) {
      references.push({
        assetId: request.maskAssetId,
        role: "mask",
        uri: `aiv-asset://${request.maskAssetId}`
      });
    }

    // TODO: resolve project-relative Asset paths, uploadable temp files, or proxy URLs.
    return references;
  }
}
