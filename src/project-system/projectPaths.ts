import { extname, join, relative, resolve } from "node:path";

export const AIV_PROJECT_EXTENSION = ".aivproj";
export const PROJECT_FILE_NAME = "project.json";

export const PROJECT_DIRECTORIES = [
  "assets",
  "frames",
  "cache",
  "proxies",
  "thumbnails",
  "renders",
  "ai"
] as const;

export type ProjectDirectoryName = (typeof PROJECT_DIRECTORIES)[number];

export const isAivProjectRoot = (projectRootPath: string): boolean => {
  return extname(projectRootPath) === AIV_PROJECT_EXTENSION;
};

export const getProjectJsonPath = (projectRootPath: string): string => {
  return join(projectRootPath, PROJECT_FILE_NAME);
};

export const getProjectDirectoryPath = (
  projectRootPath: string,
  directoryName: ProjectDirectoryName
): string => {
  return join(projectRootPath, directoryName);
};

export const toProjectRelativePath = (
  projectRootPath: string,
  absolutePath: string
): string => {
  return relative(resolve(projectRootPath), resolve(absolutePath));
};

export const fromProjectRelativePath = (
  projectRootPath: string,
  projectRelativePath: string
): string => {
  return resolve(projectRootPath, projectRelativePath);
};
