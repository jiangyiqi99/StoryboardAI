import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type {
  ProjectCreateRequest,
  ProjectOpenRequest,
  ProjectSaveRequest
} from "@shared/ipc/contracts";
import type {
  Project,
  ProjectRuntimeContext,
  ProjectSettings
} from "@shared/types/project";
import type {
  StoryboardSegment,
  StoryboardSegmentStatus
} from "@shared/types/storyboard";
import type { Clip, Timeline, Track, TrackKind } from "@shared/types/timeline";
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
  createProject(request: ProjectCreateRequest): Promise<ProjectFileSnapshot>;
  openProject(request: ProjectOpenRequest): Promise<ProjectFileSnapshot>;
  saveProject(request: ProjectSaveRequest): Promise<ProjectFileSnapshot>;
}

export interface ProjectFileSnapshot {
  project: Project;
  runtime: ProjectRuntimeContext;
  layout: Record<string, string>;
}

export class LocalProjectFileService implements ProjectFileService {
  async createProject(request: ProjectCreateRequest): Promise<ProjectFileSnapshot> {
    const projectRootPath = resolveProjectCreatePath(request);
    const projectJsonPath = getProjectJsonPath(projectRootPath);

    await assertProjectDoesNotExist(projectJsonPath);
    await ensureProjectLayout(projectRootPath);

    const project = createEmptyProject(request);
    await writeProjectJson(projectJsonPath, project);
    return createProjectFileSnapshot(projectRootPath, project);
  }

  async openProject(request: ProjectOpenRequest): Promise<ProjectFileSnapshot> {
    const projectRootPath = normalizeProjectRootPath(request.projectRootPath);
    assertProjectRootPath(projectRootPath);

    const projectJsonPath = getProjectJsonPath(projectRootPath);
    const project = await readProjectJson(projectJsonPath);
    await ensureProjectLayout(projectRootPath);
    return createProjectFileSnapshot(projectRootPath, project);
  }

  async saveProject(request: ProjectSaveRequest): Promise<ProjectFileSnapshot> {
    const projectRootPath = normalizeProjectRootPath(request.projectRootPath);
    assertProjectRootPath(projectRootPath);
    await ensureProjectLayout(projectRootPath);

    const project = normalizeProject({
      ...request.project,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      updatedAt: new Date().toISOString()
    });
    await writeProjectJson(getProjectJsonPath(projectRootPath), project);
    return createProjectFileSnapshot(projectRootPath, project);
  }

  describeLayout(projectRootPath: string): Record<string, string> {
    return describeProjectLayout(projectRootPath);
  }
}

export const createProjectFileSnapshot = (
  projectRootPath: string,
  project: Project
): ProjectFileSnapshot => ({
  project,
  runtime: {
    projectRootPath,
    projectJsonPath: getProjectJsonPath(projectRootPath)
  },
  layout: describeProjectLayout(projectRootPath)
});

export const describeProjectLayout = (
  projectRootPath: string
): Record<string, string> => ({
  [PROJECT_FILE_NAME]: getProjectJsonPath(projectRootPath),
  ...Object.fromEntries(
    PROJECT_DIRECTORIES.map((directoryName) => [
      directoryName,
      getProjectDirectoryPath(projectRootPath, directoryName)
    ])
  )
});

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
      id: "video-1",
      kind: "video",
      name: "V1",
      order: 0,
      clips: [],
      locked: false,
      muted: false,
      visible: true
    },
    {
      id: "source-audio-1",
      kind: "audio",
      name: "视频原声",
      order: 1,
      clips: [],
      locked: false,
      muted: false,
      visible: true
    },
    {
      id: "voiceover-1",
      kind: "audio",
      name: "配音",
      order: 2,
      clips: [],
      locked: false,
      muted: false,
      visible: true
    },
    {
      id: "music-1",
      kind: "audio",
      name: "背景音乐",
      order: 3,
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

export const normalizeProjectRootPath = (projectRootPath: string): string => {
  const resolved = resolve(projectRootPath);
  return basename(resolved) === PROJECT_FILE_NAME ? dirname(resolved) : resolved;
};

export const assertProjectRootPath = (projectRootPath: string): void => {
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

  return {
    schemaVersion,
    id: stringField(record, "id"),
    name: normalizeProjectName(stringField(record, "name")),
    createdAt: stringField(record, "createdAt"),
    updatedAt: stringField(record, "updatedAt"),
    settings: projectSettingsField(record, "settings"),
    assets: arrayField(record, "assets"),
    timeline: timelineField(record, "timeline"),
    storyboardSegments: arrayField(record, "storyboardSegments").map((segment, index) =>
      storyboardSegmentField(segment, `project.storyboardSegments[${index}]`)
    ),
    aiGenerationJobs: arrayField(record, "aiGenerationJobs"),
    renderCache: arrayField(record, "renderCache"),
    editHistory: editHistoryField(record, "editHistory")
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

const normalizeProjectName = (name: string): string => {
  const trimmed = name.trim();
  const withoutExtension = trimmed.endsWith(AIV_PROJECT_EXTENSION)
    ? trimmed.slice(0, -AIV_PROJECT_EXTENSION.length).trim()
    : trimmed;
  return withoutExtension || "Untitled Project";
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

const optionalStringField = (
  record: Record<string, unknown>,
  key: string
): string | undefined => {
  return record[key] === undefined ? undefined : stringField(record, key);
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

const booleanField = (
  record: Record<string, unknown>,
  key: string
): boolean => {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`Invalid project file: ${key} must be a boolean.`);
  }

  return value;
};

const projectSettingsField = (
  record: Record<string, unknown>,
  key: string
): ProjectSettings => {
  const settings = asRecord(record[key], `project.${key}`);
  const colorSpace = settings.colorSpace;
  const previewResolution = settings.previewResolution;

  if (colorSpace !== "srgb" && colorSpace !== "rec709" && colorSpace !== "display-p3") {
    throw new Error(`Invalid project file: ${key}.colorSpace is unsupported.`);
  }

  if (
    previewResolution !== "quarter" &&
    previewResolution !== "half" &&
    previewResolution !== "full"
  ) {
    throw new Error(`Invalid project file: ${key}.previewResolution is unsupported.`);
  }

  return {
    width: positiveNumberField(settings, "width"),
    height: positiveNumberField(settings, "height"),
    fps: positiveNumberField(settings, "fps"),
    audioSampleRate: positiveNumberField(settings, "audioSampleRate"),
    colorSpace,
    defaultDurationSeconds: positiveNumberField(settings, "defaultDurationSeconds"),
    previewResolution
  };
};

const timelineField = (
  record: Record<string, unknown>,
  key: string
): Timeline => {
  const timeline = asRecord(record[key], `project.${key}`);
  const selection = timeline.selection;

  return {
    id: stringField(timeline, "id"),
    fps: positiveNumberField(timeline, "fps"),
    duration: nonNegativeNumberField(timeline, "duration"),
    playhead: nonNegativeNumberField(timeline, "playhead"),
    tracks: arrayField(timeline, "tracks").map((track, index) =>
      trackField(track, `project.timeline.tracks[${index}]`)
    ),
    selection: selection === undefined ? undefined : selectionField(selection)
  };
};

const trackField = (value: unknown, label: string): Track => {
  const track = asRecord(value, label);
  const kind = trackKindField(track, "kind");

  return {
    id: editorTrackIdField(track, "id"),
    kind,
    name: stringField(track, "name"),
    order: nonNegativeNumberField(track, "order"),
    clips: arrayField(track, "clips").map((clip, index) =>
      clipField(clip, `${label}.clips[${index}]`)
    ),
    locked: booleanField(track, "locked"),
    muted: booleanField(track, "muted"),
    visible: booleanField(track, "visible")
  };
};

const clipField = (value: unknown, label: string): Clip => {
  const clip = asRecord(value, label);
  const name = clip.name;
  const muted = clip.muted;
  const opacity = clip.opacity;
  const metadata = clip.metadata;

  return {
    id: stringField(clip, "id"),
    assetId: stringField(clip, "assetId"),
    trackId: editorTrackIdField(clip, "trackId"),
    name: name === undefined ? undefined : stringField(clip, "name"),
    sourceIn: nonNegativeNumberField(clip, "sourceIn"),
    sourceOut: nonNegativeNumberField(clip, "sourceOut"),
    timelineStart: nonNegativeNumberField(clip, "timelineStart"),
    timelineEnd: nonNegativeNumberField(clip, "timelineEnd"),
    speed: positiveNumberField(clip, "speed"),
    muted: muted === undefined ? undefined : booleanField(clip, "muted"),
    opacity: opacity === undefined ? undefined : nonNegativeNumberField(clip, "opacity"),
    metadata:
      metadata === undefined
        ? undefined
        : (asRecord(metadata, `${label}.metadata`) as Record<string, unknown>)
  };
};

const trackKindField = (
  record: Record<string, unknown>,
  key: string
): TrackKind => {
  const value = record[key];
  if (value === "video" || value === "audio" || value === "overlay" || value === "caption") {
    return value;
  }

  throw new Error(`Invalid project file: ${key} is an unsupported track kind.`);
};

const editorTrackIdField = (
  record: Record<string, unknown>,
  key: string
): Track["id"] => {
  const trackId = stringField(record, key);
  if (
    trackId === "video-1" ||
    trackId === "source-audio-1" ||
    trackId === "voiceover-1" ||
    trackId === "music-1"
  ) {
    return trackId;
  }

  throw new Error(`Invalid project file: ${key} is an unsupported timeline track id.`);
};

const selectionField = (value: unknown): Timeline["selection"] => {
  const selection = asRecord(value, "project.timeline.selection");
  const range = selection.range;

  return {
    clipIds: arrayField<string>(selection, "clipIds"),
    range: range === undefined ? undefined : rangeField(range)
  };
};

const storyboardSegmentField = (
  value: unknown,
  label: string
): StoryboardSegment => {
  const segment = asRecord(value, label);

  return {
    id: stringField(segment, "id"),
    index: nonNegativeNumberField(segment, "index"),
    storyboardRef: optionalStringField(segment, "storyboardRef"),
    storyboardNumber: optionalPositiveNumberField(segment, "storyboardNumber"),
    text: stringField(segment, "text"),
    prompt: optionalStringField(segment, "prompt"),
    targetDuration: positiveNumberField(segment, "targetDuration"),
    status: storyboardSegmentStatusField(segment, "status"),
    inputFirstFrameAssetId: optionalStringField(segment, "inputFirstFrameAssetId"),
    inputLastFrameAssetId: optionalStringField(segment, "inputLastFrameAssetId"),
    outputAssetId: optionalStringField(segment, "outputAssetId"),
    aiJobId: optionalStringField(segment, "aiJobId"),
    timelineStart: optionalNonNegativeNumberField(segment, "timelineStart"),
    timelineEnd: optionalNonNegativeNumberField(segment, "timelineEnd")
  };
};

const storyboardSegmentStatusField = (
  record: Record<string, unknown>,
  key: string
): StoryboardSegmentStatus => {
  const value = record[key];
  if (
    value === "draft" ||
    value === "queued" ||
    value === "generating" ||
    value === "generated" ||
    value === "inserted" ||
    value === "failed"
  ) {
    return value;
  }

  throw new Error(`Invalid project file: ${key} is an unsupported storyboard status.`);
};

const rangeField = (value: unknown): NonNullable<Timeline["selection"]>["range"] => {
  const range = asRecord(value, "project.timeline.selection.range");

  return {
    start: nonNegativeNumberField(range, "start"),
    end: nonNegativeNumberField(range, "end")
  };
};

const editHistoryField = (
  record: Record<string, unknown>,
  key: string
): Project["editHistory"] => {
  const editHistory = asRecord(record[key], `project.${key}`);

  return {
    past: arrayField(editHistory, "past"),
    future: arrayField(editHistory, "future")
  };
};

const positiveNumber = (value: unknown, fallback: number): number => {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
};

const positiveNumberField = (
  record: Record<string, unknown>,
  key: string
): number => {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid project file: ${key} must be a positive number.`);
  }

  return value;
};

const optionalPositiveNumberField = (
  record: Record<string, unknown>,
  key: string
): number | undefined => {
  return record[key] === undefined ? undefined : positiveNumberField(record, key);
};

const nonNegativeNumberField = (
  record: Record<string, unknown>,
  key: string
): number => {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid project file: ${key} must be a non-negative number.`);
  }

  return value;
};

const optionalNonNegativeNumberField = (
  record: Record<string, unknown>,
  key: string
): number | undefined => {
  return record[key] === undefined ? undefined : nonNegativeNumberField(record, key);
};
