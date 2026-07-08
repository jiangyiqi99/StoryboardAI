import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type {
  ProjectCreateRequest,
  ProjectOpenRequest,
  ProjectSaveRequest
} from "@shared/ipc/contracts";
import type { Project, ProjectSettings } from "@shared/types/project";
import type { Timeline } from "@shared/types/timeline";
import {
  AIV_PROJECT_EXTENSION,
  getProjectDirectoryPath,
  getProjectJsonPath,
  isAivProjectRoot,
  PROJECT_DIRECTORIES,
  PROJECT_FILE_NAME
} from "./projectPaths";
import {
  DEFAULT_PROJECT_SETTINGS,
  PROJECT_SCHEMA_VERSION
} from "./projectSchema";

export interface ProjectFileService {
  createProject(request: ProjectCreateRequest): Promise<Project>;
  openProject(request: ProjectOpenRequest): Promise<Project>;
  saveProject(request: ProjectSaveRequest): Promise<Project>;
}

export class LocalProjectFileService implements ProjectFileService {
  async createProject(request: ProjectCreateRequest): Promise<Project> {
    const projectRootPath = resolveProjectCreatePath(request);
    const projectJsonPath = getProjectJsonPath(projectRootPath);

    await ensureProjectLayout(projectRootPath);
    await assertProjectDoesNotExist(projectJsonPath);

    const project = createEmptyProject(request);
    await writeProjectJson(projectJsonPath, project);
    return project;
  }

  async openProject(request: ProjectOpenRequest): Promise<Project> {
    const projectRootPath = normalizeProjectRootPath(request.projectRootPath);
    assertProjectRootPath(projectRootPath);

    const projectJsonPath = getProjectJsonPath(projectRootPath);
    const project = await readProjectJson(projectJsonPath);
    await ensureProjectLayout(projectRootPath);
    return project;
  }

  async saveProject(request: ProjectSaveRequest): Promise<Project> {
    const projectRootPath = normalizeProjectRootPath(request.projectRootPath);
    assertProjectRootPath(projectRootPath);
    await ensureProjectLayout(projectRootPath);

    const project = normalizeProject({
      ...request.project,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      updatedAt: new Date().toISOString()
    });
    await writeProjectJson(getProjectJsonPath(projectRootPath), project);
    return project;
  }

  describeLayout(projectRootPath: string): Record<string, string> {
    return {
      [PROJECT_FILE_NAME]: getProjectJsonPath(projectRootPath),
      ...Object.fromEntries(
        PROJECT_DIRECTORIES.map((directoryName) => [
          directoryName,
          getProjectDirectoryPath(projectRootPath, directoryName)
        ])
      )
    };
  }
}

const createEmptyProject = (request: ProjectCreateRequest): Project => {
  const now = new Date().toISOString();
  const settings = normalizeProjectSettings({
    ...DEFAULT_PROJECT_SETTINGS,
    ...request.settings
  });

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: `project-${randomUUID()}`,
    name: normalizeProjectName(request.name),
    createdAt: now,
    updatedAt: now,
    settings,
    assets: [],
    timeline: createDefaultTimeline(settings),
    storyboardSegments: [],
    aiGenerationJobs: [],
    renderCache: [],
    editHistory: {
      past: [],
      future: []
    }
  };
};

const createDefaultTimeline = (settings: ProjectSettings): Timeline => ({
  id: "timeline-main",
  fps: settings.fps,
  duration: 0,
  playhead: 0,
  tracks: [
    {
      id: "track-video-1",
      kind: "video",
      name: "V1",
      order: 0,
      clips: [],
      locked: false,
      muted: false,
      visible: true
    },
    {
      id: "track-audio-1",
      kind: "audio",
      name: "A1",
      order: 1,
      clips: [],
      locked: false,
      muted: false,
      visible: true
    }
  ]
});

const ensureProjectLayout = async (projectRootPath: string): Promise<void> => {
  await mkdir(projectRootPath, { recursive: true });
  await Promise.all(
    PROJECT_DIRECTORIES.map((directoryName) =>
      mkdir(getProjectDirectoryPath(projectRootPath, directoryName), {
        recursive: true
      })
    )
  );
};

const readProjectJson = async (projectJsonPath: string): Promise<Project> => {
  const raw = await readFile(projectJsonPath, "utf8");
  return normalizeProject(JSON.parse(raw));
};

const writeProjectJson = async (
  projectJsonPath: string,
  project: Project
): Promise<void> => {
  await mkdir(dirname(projectJsonPath), { recursive: true });
  const temporaryPath = join(
    dirname(projectJsonPath),
    `.${basename(projectJsonPath)}.${process.pid}.${Date.now()}.tmp`
  );
  await writeFile(temporaryPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  await rename(temporaryPath, projectJsonPath);
};

const assertProjectDoesNotExist = async (
  projectJsonPath: string
): Promise<void> => {
  try {
    await readFile(projectJsonPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }

    throw error;
  }

  throw new Error(`Project already exists: ${projectJsonPath}`);
};

const resolveProjectCreatePath = (request: ProjectCreateRequest): string => {
  const safeProjectName = sanitizeProjectDirectoryName(request.name);
  const directoryName = safeProjectName.endsWith(AIV_PROJECT_EXTENSION)
    ? safeProjectName
    : `${safeProjectName}${AIV_PROJECT_EXTENSION}`;

  return resolve(request.parentDirectory, directoryName);
};

const normalizeProjectRootPath = (projectRootPath: string): string => {
  const resolved = resolve(projectRootPath);
  return basename(resolved) === PROJECT_FILE_NAME ? dirname(resolved) : resolved;
};

const assertProjectRootPath = (projectRootPath: string): void => {
  if (!isAivProjectRoot(projectRootPath)) {
    throw new Error(
      `Project root must be a ${AIV_PROJECT_EXTENSION} directory: ${projectRootPath}`
    );
  }
};

const normalizeProject = (value: unknown): Project => {
  const record = asRecord(value, "project");
  const schemaVersion = stringField(record, "schemaVersion");
  if (schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported project schema version: ${schemaVersion}. Expected ${PROJECT_SCHEMA_VERSION}.`
    );
  }

  const settings = normalizeProjectSettings(record.settings);

  return {
    schemaVersion,
    id: stringField(record, "id"),
    name: normalizeProjectName(stringField(record, "name")),
    createdAt: stringField(record, "createdAt"),
    updatedAt: stringField(record, "updatedAt"),
    settings,
    assets: arrayField(record, "assets"),
    timeline: normalizeTimeline(record.timeline, settings),
    storyboardSegments: arrayField(record, "storyboardSegments"),
    aiGenerationJobs: arrayField(record, "aiGenerationJobs"),
    renderCache: arrayField(record, "renderCache"),
    editHistory: normalizeEditHistory(record.editHistory)
  };
};

const normalizeProjectSettings = (value: unknown): ProjectSettings => {
  const record = isRecord(value) ? value : {};
  const settings = {
    ...DEFAULT_PROJECT_SETTINGS,
    ...record
  };

  return {
    width: positiveNumber(settings.width, DEFAULT_PROJECT_SETTINGS.width),
    height: positiveNumber(settings.height, DEFAULT_PROJECT_SETTINGS.height),
    fps: positiveNumber(settings.fps, DEFAULT_PROJECT_SETTINGS.fps),
    audioSampleRate: positiveNumber(
      settings.audioSampleRate,
      DEFAULT_PROJECT_SETTINGS.audioSampleRate
    ),
    colorSpace:
      settings.colorSpace === "srgb" ||
      settings.colorSpace === "rec709" ||
      settings.colorSpace === "display-p3"
        ? settings.colorSpace
        : DEFAULT_PROJECT_SETTINGS.colorSpace,
    defaultDurationSeconds: positiveNumber(
      settings.defaultDurationSeconds,
      DEFAULT_PROJECT_SETTINGS.defaultDurationSeconds
    ),
    previewResolution:
      settings.previewResolution === "quarter" ||
      settings.previewResolution === "half" ||
      settings.previewResolution === "full"
        ? settings.previewResolution
        : DEFAULT_PROJECT_SETTINGS.previewResolution
  };
};

const normalizeTimeline = (
  value: unknown,
  settings: ProjectSettings
): Timeline => {
  if (!isRecord(value)) {
    return createDefaultTimeline(settings);
  }

  const fallback = createDefaultTimeline(settings);
  return {
    id: typeof value.id === "string" ? value.id : fallback.id,
    fps: positiveNumber(value.fps, settings.fps),
    duration: nonNegativeNumber(value.duration, fallback.duration),
    playhead: nonNegativeNumber(value.playhead, fallback.playhead),
    tracks: Array.isArray(value.tracks) ? value.tracks : fallback.tracks,
    selection: isRecord(value.selection)
      ? (value.selection as Timeline["selection"])
      : undefined
  };
};

const normalizeEditHistory = (
  value: unknown
): Project["editHistory"] => {
  if (!isRecord(value)) {
    return { past: [], future: [] };
  }

  return {
    past: Array.isArray(value.past) ? value.past : [],
    future: Array.isArray(value.future) ? value.future : []
  };
};

const normalizeProjectName = (name: string): string => {
  const trimmed = name.trim();
  return trimmed || "Untitled Project";
};

const sanitizeProjectDirectoryName = (name: string): string => {
  const baseName = normalizeProjectName(name);
  const nameWithoutExtension = baseName.endsWith(AIV_PROJECT_EXTENSION)
    ? baseName.slice(0, -AIV_PROJECT_EXTENSION.length)
    : baseName;
  const normalized = nameWithoutExtension
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\.+$/g, "")
    .trim();

  return normalized || "Untitled Project";
};

const asRecord = (
  value: unknown,
  label: string
): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}: expected an object.`);
  }

  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const stringField = (
  record: Record<string, unknown>,
  key: string
): string => {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid project file: ${key} must be a non-empty string.`);
  }

  return value;
};

const arrayField = <TValue = never>(
  record: Record<string, unknown>,
  key: string
): TValue[] => {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`Invalid project file: ${key} must be an array.`);
  }

  return value as TValue[];
};

const positiveNumber = (value: unknown, fallback: number): number => {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
};

const nonNegativeNumber = (value: unknown, fallback: number): number => {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
};
