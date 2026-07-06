import { join } from "node:path";
import type { TimelineRange } from "@shared/types/timeline";
import { getProjectDirectoryPath } from "./projectPaths";

export interface CacheKeyParts {
  assetId?: string;
  range?: TimelineRange;
  fingerprint?: string;
}

export class CacheManager {
  getThumbnailPath(projectRootPath: string, assetId: string): string {
    return join(
      getProjectDirectoryPath(projectRootPath, "thumbnails"),
      `${assetId}.jpg`
    );
  }

  getProxyPath(projectRootPath: string, assetId: string): string {
    return join(getProjectDirectoryPath(projectRootPath, "proxies"), `${assetId}.mp4`);
  }

  getFrameDirectory(projectRootPath: string, jobId: string): string {
    return join(getProjectDirectoryPath(projectRootPath, "frames"), jobId);
  }

  getRenderCachePath(projectRootPath: string, cacheId: string): string {
    return join(getProjectDirectoryPath(projectRootPath, "cache"), `${cacheId}.mp4`);
  }

  createCacheFingerprint(_parts: CacheKeyParts): string {
    // TODO: derive a stable hash from asset ids, source ranges, settings, and edit graph.
    throw new Error("Cache fingerprinting is not implemented in the scaffold.");
  }
}
