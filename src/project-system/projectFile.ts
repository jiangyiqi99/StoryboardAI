import type {
  ProjectCreateRequest,
  ProjectOpenRequest,
  ProjectSaveRequest
} from "@shared/ipc/contracts";
import type { Project } from "@shared/types/project";
import {
  getProjectJsonPath,
  PROJECT_DIRECTORIES,
  PROJECT_FILE_NAME
} from "./projectPaths";

export interface ProjectFileService {
  createProject(request: ProjectCreateRequest): Promise<Project>;
  openProject(request: ProjectOpenRequest): Promise<Project>;
  saveProject(request: ProjectSaveRequest): Promise<Project>;
}

export class LocalProjectFileService implements ProjectFileService {
  async createProject(_request: ProjectCreateRequest): Promise<Project> {
    // TODO: create <name>.aivproj, ensure PROJECT_DIRECTORIES, then write project.json.
    throw new Error("Project creation is not implemented in the architecture scaffold.");
  }

  async openProject(_request: ProjectOpenRequest): Promise<Project> {
    // TODO: read project.json, validate schema version, then hydrate runtime context.
    throw new Error("Project loading is not implemented in the architecture scaffold.");
  }

  async saveProject(_request: ProjectSaveRequest): Promise<Project> {
    // TODO: atomically persist project.json without touching original media files.
    throw new Error("Project saving is not implemented in the architecture scaffold.");
  }

  describeLayout(projectRootPath: string): Record<string, string> {
    return {
      [PROJECT_FILE_NAME]: getProjectJsonPath(projectRootPath),
      ...Object.fromEntries(
        PROJECT_DIRECTORIES.map((directoryName) => [
          directoryName,
          `${projectRootPath}/${directoryName}`
        ])
      )
    };
  }
}
