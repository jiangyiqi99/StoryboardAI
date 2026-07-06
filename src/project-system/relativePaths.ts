import {
  fromProjectRelativePath,
  toProjectRelativePath
} from "./projectPaths";

export class ProjectRelativePathManager {
  toStoredPath(projectRootPath: string, absolutePath: string): string {
    return toProjectRelativePath(projectRootPath, absolutePath);
  }

  toAbsolutePath(projectRootPath: string, projectRelativePath: string): string {
    return fromProjectRelativePath(projectRootPath, projectRelativePath);
  }
}
