import type { Asset } from "@shared/types/asset";
import type { Project } from "@shared/types/project";

export interface RegisterAssetRequest {
  project: Project;
  asset: Asset;
}

export class AssetRegistry {
  registerImportedAsset(_request: RegisterAssetRequest): Project {
    // TODO: copy or reference local media according to project policy, then append Asset.
    throw new Error("Asset registration is not implemented in the architecture scaffold.");
  }

  registerGeneratedAsset(_request: RegisterAssetRequest): Project {
    // TODO: store generated output under ai/ or assets/, then append a generated Asset.
    throw new Error(
      "Generated asset registration is not implemented in the architecture scaffold."
    );
  }
}
