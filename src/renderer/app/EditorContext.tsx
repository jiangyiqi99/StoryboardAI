import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import type {
  AiStoryboardProgressEvent,
  ProjectCreateRequest,
  ProjectRuntimeLayout,
  ProjectSession
} from "@shared/ipc/contracts";
import type { Project, ProjectRuntimeContext } from "@shared/types/project";
import type { StoryScriptDocumentBeat } from "@shared/storyScriptDocuments";
import {
  createEditorAssetFromFile,
  createEditorAssetFromImportedFile,
  updateEditorAssetFromImportedFile
} from "./mediaImport";
import type {
  EditorMediaAsset,
  EditorRgbColor,
  EditorStoryBeat,
  EditorTimelineClip,
  EditorTimelineTrackId,
  ImportMediaResult,
  StoryScriptImportMode
} from "./editorTypes";
import { desktopApi } from "../ipc/api";
import {
  normalizeRgbColor,
  normalizeSolidDuration,
  rgbColorToHex,
  rgbColorToLabel
} from "./solidColor";
import {
  createBlankStoryBeat,
  editorStateToProject,
  ensureTrailingBlankStoryBeat,
  isBlankStoryBeat,
  projectSessionToEditorState
} from "./projectMapping";

const TIMELINE_BASE_DURATION_SEC = 40;

export interface TimelinePreviewTarget {
  asset: EditorMediaAsset;
  clip: EditorTimelineClip;
  sourceTime: number;
  timelineTime: number;
}

export interface SolidColorTimelineOptions {
  color: EditorRgbColor;
  durationSec: number;
}

export interface SetPlayheadOptions {
  /** Playback is transient UI state and must not make the project dirty. */
  markProjectDirty?: boolean;
}

interface EditorContextValue {
  project?: Project;
  projectRuntime?: ProjectRuntimeContext;
  projectLayout?: ProjectRuntimeLayout;
  isProjectOpen: boolean;
  isProjectDirty: boolean;
  isProjectSaving: boolean;
  isAiGeneratingStoryboard: boolean;
  storyboardGenerationProgress?: AiStoryboardProgressEvent;
  projectMessage?: string;
  assets: EditorMediaAsset[];
  timelineClips: EditorTimelineClip[];
  selectedAssetId?: string;
  selectedClipId?: string;
  storyBeats: EditorStoryBeat[];
  selectedStoryBeatIdsForGeneration: string[];
  timelineDurationSec: number;
  timelineFps?: number;
  playheadSec: number;
  selectedAsset?: EditorMediaAsset;
  selectedClip?: EditorTimelineClip;
  activeTimelineClip?: EditorTimelineClip;
  activeTimelineAsset?: EditorMediaAsset;
  createProject(request: ProjectCreateRequest): Promise<ProjectOperationResult>;
  openProjectFromPicker(): Promise<ProjectOperationResult>;
  saveProject(): Promise<ProjectOperationResult>;
  generateStoryboardVideos(replaceBeatId?: string): Promise<ProjectOperationResult>;
  importFiles(files: FileList | File[]): Promise<ImportMediaResult>;
  importPaths(absolutePaths: string[]): Promise<ImportMediaResult>;
  openMediaPicker(): Promise<ImportMediaResult>;
  selectAsset(assetId: string): void;
  selectClip(clipId: string): void;
  updateStoryBeat(beatId: string, changes: Partial<Omit<EditorStoryBeat, "id">>): void;
  importStoryBeats(
    beats: StoryScriptDocumentBeat[],
    mode: StoryScriptImportMode
  ): void;
  toggleStoryBeatGenerationSelection(beatId: string): void;
  moveStoryBeat(beatId: string, targetBeatId: string): void;
  addAssetToTimeline(
    assetId: string,
    timelineStart?: number,
    targetTrackId?: EditorTimelineTrackId
  ): void;
  addSolidColorToTimeline(
    options: SolidColorTimelineOptions,
    timelineStart?: number
  ): void;
  moveClip(clipId: string, timelineStart: number): void;
  replaceClipAsset(clipId: string, assetId: string): void;
  deleteClip(clipId?: string): void;
  splitClip(clipId: string | undefined, splitTime: number): void;
  setPlayhead(time: number, options?: SetPlayheadOptions): void;
  nudgePlayhead(delta: number): void;
  resolveTimelinePreview(time: number): TimelinePreviewTarget | undefined;
}

export interface ProjectOperationResult {
  ok: boolean;
  cancelled?: boolean;
  message?: string;
}

const EditorContext = createContext<EditorContextValue | null>(null);

const initialAssets: EditorMediaAsset[] = [];
const initialTimelineClips: EditorTimelineClip[] = [];
const DEFAULT_STORY_BEAT_DURATION_SEC = 5;

export const EditorProvider = ({ children }: { children: ReactNode }) => {
  const [project, setProject] = useState<Project | undefined>();
  const [projectRuntime, setProjectRuntime] =
    useState<ProjectRuntimeContext | undefined>();
  const [projectLayout, setProjectLayout] =
    useState<ProjectRuntimeLayout | undefined>();
  const [isProjectDirty, setIsProjectDirty] = useState(false);
  const [isProjectSaving, setIsProjectSaving] = useState(false);
  const [isAiGeneratingStoryboard, setIsAiGeneratingStoryboard] = useState(false);
  const [storyboardGenerationProgress, setStoryboardGenerationProgress] =
    useState<AiStoryboardProgressEvent | undefined>();
  const [projectMessage, setProjectMessage] = useState<string | undefined>();
  const [assets, setAssets] = useState<EditorMediaAsset[]>(initialAssets);
  const [timelineClips, setTimelineClips] =
    useState<EditorTimelineClip[]>(initialTimelineClips);
  const [storyBeats, setStoryBeats] = useState<EditorStoryBeat[]>(() => [
    createBlankStoryBeat()
  ]);
  const [
    selectedStoryBeatIdsForGeneration,
    setSelectedStoryBeatIdsForGeneration
  ] = useState<string[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | undefined>();
  const [selectedClipId, setSelectedClipId] = useState<string | undefined>();
  const [playheadSec, setPlayheadSec] = useState<number>(0);

  const timelineDurationSec = useMemo(() => {
    const clipEnd = timelineClips.reduce(
      (maxEnd, clip) => Math.max(maxEnd, clip.timelineStart + clip.durationSec),
      TIMELINE_BASE_DURATION_SEC
    );

    return Math.max(TIMELINE_BASE_DURATION_SEC, Math.ceil(clipEnd / 5) * 5);
  }, [timelineClips]);

  const selectedClip = timelineClips.find((clip) => clip.id === selectedClipId);
  const selectedAsset =
    assets.find((asset) => asset.id === selectedClip?.assetId) ??
    assets.find((asset) => asset.id === selectedAssetId);
  const activeTimelinePreview = useMemo(
    () => resolveTimelinePreviewValue(playheadSec, timelineClips, assets),
    [assets, playheadSec, timelineClips]
  );
  const activeTimelineClip = activeTimelinePreview?.clip;
  const activeTimelineAsset = activeTimelinePreview?.asset;
  const timelineFps =
    activeTimelineAsset?.fps ??
    resolveFirstTimelineVideoFps(timelineClips, assets) ??
    selectedAsset?.fps;

  const markProjectDirty = useCallback(() => {
    if (!projectRuntime) {
      return;
    }

    setIsProjectDirty(true);
    setProjectMessage(undefined);
  }, [projectRuntime]);

  useEffect(() => {
    return desktopApi.ai.onStoryboardProgress((event) => {
      setStoryboardGenerationProgress(event);
      setProjectMessage(formatStoryboardProgressMessage(event));
    });
  }, []);

  const applyProjectSession = useCallback(
    (
      session: Awaited<ReturnType<typeof desktopApi.project.open>>,
      message?: string
    ) => {
      const editorState = projectSessionToEditorState(session);
      const selectedClip = editorState.timelineClips.find(
        (clip) => clip.id === editorState.selectedClipId
      );

      setProject(session.project);
      setProjectRuntime(session.runtime);
      setProjectLayout(session.layout);
      setAssets(editorState.assets);
      setTimelineClips(editorState.timelineClips);
      setStoryBeats(editorState.storyBeats);
      setSelectedStoryBeatIdsForGeneration([]);
      setSelectedClipId(editorState.selectedClipId);
      setSelectedAssetId(selectedClip?.assetId ?? editorState.assets[0]?.id);
      setPlayheadSec(editorState.playheadSec);
      setIsProjectDirty(false);
      setIsProjectSaving(false);
      setProjectMessage(message);
    },
    []
  );

  const confirmReplacingProject = useCallback(() => {
    return (
      !isProjectDirty ||
      window.confirm("当前项目有未保存更改，继续会丢失这些更改。要继续吗？")
    );
  }, [isProjectDirty]);

  const saveEditorStateToProject = useCallback(
    async (baseProject: Project, projectRootPath: string): Promise<ProjectSession> => {
      const storedAssets = await ensureImportedAssetsStoredInProject(
        assets,
        projectRootPath
      );
      const nextProject = editorStateToProject(baseProject, {
        assets: storedAssets,
        timelineClips,
        storyBeats,
        playheadSec,
        selectedClipId
      });

      return desktopApi.project.save({
        projectRootPath,
        project: nextProject
      });
    },
    [assets, playheadSec, selectedClipId, storyBeats, timelineClips]
  );

  const createProject = useCallback(
    async (request: ProjectCreateRequest): Promise<ProjectOperationResult> => {
      if (!confirmReplacingProject()) {
        return { ok: false, cancelled: true };
      }

      try {
        const session = await desktopApi.project.create(request);
        const shouldSaveCurrentWorkspace =
          !projectRuntime &&
          hasUnsavedStarterEditorState(assets, timelineClips, storyBeats);
        const projectSession = shouldSaveCurrentWorkspace
          ? await saveEditorStateToProject(
              session.project,
              session.runtime.projectRootPath
            )
          : session;

        applyProjectSession(projectSession, "已创建项目");
        return { ok: true, message: "已创建项目" };
      } catch (error) {
        const message = getErrorMessage(error);
        setProjectMessage(message);
        return { ok: false, message };
      }
    },
    [
      applyProjectSession,
      assets,
      confirmReplacingProject,
      projectRuntime,
      saveEditorStateToProject,
      storyBeats,
      timelineClips
    ]
  );

  const openProjectFromPicker = useCallback(async (): Promise<ProjectOperationResult> => {
    if (!confirmReplacingProject()) {
      return { ok: false, cancelled: true };
    }

    try {
      const selection = await desktopApi.project.selectOpenLocation({
        defaultPath: projectRuntime?.projectRootPath
      });
      if (!selection) {
        return { ok: false, cancelled: true };
      }

      const session = await desktopApi.project.open({
        projectRootPath: selection.projectRootPath
      });
      applyProjectSession(session, "已打开项目");
      return { ok: true, message: "已打开项目" };
    } catch (error) {
      const message = getErrorMessage(error);
      setProjectMessage(message);
      return { ok: false, message };
    }
  }, [applyProjectSession, confirmReplacingProject, projectRuntime]);

  const saveProject = useCallback(async (): Promise<ProjectOperationResult> => {
    if (!project || !projectRuntime) {
      const message = "请先新建或打开项目";
      setProjectMessage(message);
      return { ok: false, message };
    }

    try {
      setIsProjectSaving(true);
      const session = await saveEditorStateToProject(
        project,
        projectRuntime.projectRootPath
      );

      applyProjectSession(session, "已保存");
      return { ok: true, message: "已保存" };
    } catch (error) {
      const message = getErrorMessage(error);
      setProjectMessage(message);
      return { ok: false, message };
    } finally {
      setIsProjectSaving(false);
    }
  }, [
    assets,
    applyProjectSession,
    playheadSec,
    project,
    projectRuntime,
    saveEditorStateToProject,
    selectedClipId,
    storyBeats,
    timelineClips
  ]);

  const generateStoryboardVideos = useCallback(
    async (replaceBeatId?: string): Promise<ProjectOperationResult> => {
      if (!project || !projectRuntime) {
        const message = "请先新建或打开项目";
        setProjectMessage(message);
        return { ok: false, message };
      }

      const contentBeats = storyBeats.filter((beat) => !isBlankStoryBeat(beat));
      if (contentBeats.length === 0) {
        const message = "请先填写分镜脚本";
        setProjectMessage(message);
        return { ok: false, message };
      }

      if (
        replaceBeatId &&
        !contentBeats.some((beat) => beat.id === replaceBeatId)
      ) {
        const message = "没有找到要替换的分镜";
        setProjectMessage(message);
        return { ok: false, message };
      }

      const targetSegmentIds = replaceBeatId
        ? [replaceBeatId]
        : resolveStoryboardTargetSegmentIds({
            project,
            contentBeats,
            assets,
            timelineClips,
            selectedStoryBeatIdsForGeneration
          });
      if (targetSegmentIds.length === 0) {
        const message = "没有勾选分镜，也没有缺失的视频需要生成";
        setProjectMessage(message);
        return { ok: true, message };
      }
      const selectedContentBeatIds = selectedStoryBeatIdsForGeneration.filter(
        (beatId) => contentBeats.some((beat) => beat.id === beatId)
      );

      try {
        setIsAiGeneratingStoryboard(true);
        setStoryboardGenerationProgress(undefined);
        setProjectMessage(replaceBeatId ? "正在替换生成分镜视频..." : "正在生成分镜视频...");

        const projectRootPath = projectRuntime.projectRootPath;
        const savedSession = await saveEditorStateToProject(project, projectRootPath);
        const savedEditorState = projectSessionToEditorState(savedSession);
        setProject(savedSession.project);
        setProjectRuntime(savedSession.runtime);
        setProjectLayout(savedSession.layout);
        setAssets(savedEditorState.assets);
        setIsProjectDirty(false);

        const provider = await resolveStoryboardGenerationProvider();
        const jobs = await desktopApi.ai.generateStoryboard({
          projectRootPath,
          script: contentBeats.map((beat) => beat.description.trim()).join("\n"),
          segments: contentBeats.map((beat) => ({
            id: beat.id,
            text: beat.description.trim(),
            durationSec: beat.durationSec
          })),
          targetSegmentIds,
          replaceSegmentId: replaceBeatId,
          replaceExistingTargetClips:
            Boolean(replaceBeatId) || selectedContentBeatIds.length > 0,
          providerId: provider.providerId,
          modelId: provider.modelId,
          defaultDuration: DEFAULT_STORY_BEAT_DURATION_SEC,
          aspectRatio: formatProjectAspectRatio(
            savedSession.project.settings.width,
            savedSession.project.settings.height
          )
        });
        const refreshedSession = await desktopApi.project.open({ projectRootPath });
        const failedJobs = jobs.filter((job) => job.status === "failed");
        const message =
          failedJobs.length > 0
            ? `分镜视频有 ${failedJobs.length} 段提交失败`
            : replaceBeatId
              ? "已提交替换生成"
              : `已提交 ${jobs.length} 段分镜视频生成`;

        applyProjectSession(refreshedSession, message);
        setSelectedStoryBeatIdsForGeneration([]);
        return { ok: failedJobs.length === 0, message };
      } catch (error) {
        const message = getErrorMessage(error);
        setStoryboardGenerationProgress((current) =>
          current
            ? {
                ...current,
                stage: "error",
                message,
                timestamp: new Date().toISOString()
              }
            : current
        );
        setProjectMessage(message);
        return { ok: false, message };
      } finally {
        setIsAiGeneratingStoryboard(false);
      }
    },
    [
      applyProjectSession,
      assets,
      playheadSec,
      project,
      projectRuntime,
      saveEditorStateToProject,
    selectedClipId,
    selectedStoryBeatIdsForGeneration,
    storyBeats,
      timelineClips
    ]
  );

  const commitImportedAssets = useCallback((importedAssets: EditorMediaAsset[]) => {
    if (importedAssets.length === 0) {
      return;
    }

    setAssets((current) => [...importedAssets, ...current]);
    setSelectedAssetId(importedAssets[0].id);
    setSelectedClipId(undefined);
    markProjectDirty();
  }, [markProjectDirty]);

  const importPaths = useCallback(
    async (absolutePaths: string[]) => {
      if (absolutePaths.length === 0) {
        return { assets: [], errors: ["没有找到可导入的媒体文件"] };
      }

      try {
        const importedFiles = await desktopApi.media.importFiles({
          absolutePaths,
          projectRootPath: projectRuntime?.projectRootPath
        });
        const importedAssets = importedFiles.map(createEditorAssetFromImportedFile);
        commitImportedAssets(importedAssets);

        return {
          assets: importedAssets,
          errors: []
        };
      } catch (error) {
        return {
          assets: [],
          errors: [getErrorMessage(error)]
        };
      }
    },
    [commitImportedAssets, projectRuntime]
  );

  const openMediaPicker = useCallback(async () => {
    try {
      const importedFiles = await desktopApi.media.selectFiles({
        allowMultiple: true,
        projectRootPath: projectRuntime?.projectRootPath
      });
      const importedAssets = importedFiles.map(createEditorAssetFromImportedFile);
      commitImportedAssets(importedAssets);

      return {
        assets: importedAssets,
        errors: []
      };
    } catch (error) {
      return {
        assets: [],
        errors: [getErrorMessage(error)]
      };
    }
  }, [commitImportedAssets, projectRuntime]);

  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      const absolutePaths = fileArray
        .map((file) => getDesktopFilePath(file))
        .filter((path): path is string => Boolean(path));

      if (absolutePaths.length > 0) {
        return importPaths(absolutePaths);
      }

      const importedAssets: EditorMediaAsset[] = [];
      const errors: string[] = [];

      for (const file of fileArray) {
        const asset = await createEditorAssetFromFile(file);
        if (asset) {
          importedAssets.push(asset);
        } else {
          errors.push(`${file.name} 不是支持的视频、音频或图片格式`);
        }
      }

      commitImportedAssets(importedAssets);

      return {
        assets: importedAssets,
        errors
      };
    },
    [commitImportedAssets, importPaths]
  );

  const selectAsset = useCallback((assetId: string) => {
    setSelectedAssetId(assetId);
    setSelectedClipId(undefined);
  }, []);

  const selectClip = useCallback(
    (clipId: string) => {
      const clip = timelineClips.find((candidate) => candidate.id === clipId);
      setSelectedClipId(clipId);
      if (clip) {
        setSelectedAssetId(clip.assetId);
      }
    },
    [timelineClips]
  );

  const updateStoryBeat = useCallback(
    (beatId: string, changes: Partial<Omit<EditorStoryBeat, "id">>) => {
      setStoryBeats((current) =>
        ensureTrailingBlankStoryBeat(
          current.map((beat) =>
            beat.id === beatId
              ? {
                  ...beat,
                  ...changes,
                  durationSec:
                    changes.durationSec === undefined
                      ? beat.durationSec
                      : normalizeStoryBeatDuration(changes.durationSec)
                }
              : beat
          )
        )
      );
      markProjectDirty();
    },
    [markProjectDirty]
  );

  const importStoryBeats = useCallback(
    (beats: StoryScriptDocumentBeat[], mode: StoryScriptImportMode) => {
      if (beats.length === 0) {
        return;
      }

      const normalizedBeats = beats.map((beat) => ({
        description: beat.description.trim(),
        durationSec: normalizeStoryBeatDuration(beat.durationSec)
      }));
      setStoryBeats((current) => {
        const currentContent = current.filter((beat) => !isBlankStoryBeat(beat));
        if (mode === "append") {
          return ensureTrailingBlankStoryBeat([
            ...currentContent,
            ...normalizedBeats.map((beat) => ({
              id: createStoryBeatId(),
              ...beat
            }))
          ]);
        }

        const overwrittenBeats = currentContent.map((beat, index) =>
          normalizedBeats[index]
            ? {
                ...beat,
                ...normalizedBeats[index]
              }
            : beat
        );
        const addedBeats = normalizedBeats
          .slice(currentContent.length)
          .map((beat) => ({
            id: createStoryBeatId(),
            ...beat
          }));
        return ensureTrailingBlankStoryBeat(
          [...overwrittenBeats, ...addedBeats]
        );
      });
      markProjectDirty();
    },
    [markProjectDirty]
  );

  const toggleStoryBeatGenerationSelection = useCallback((beatId: string) => {
    setSelectedStoryBeatIdsForGeneration((current) =>
      current.includes(beatId)
        ? current.filter((selectedBeatId) => selectedBeatId !== beatId)
        : [...current, beatId]
    );
  }, []);

  const moveStoryBeat = useCallback((beatId: string, targetBeatId: string) => {
    if (beatId === targetBeatId) {
      return;
    }

    setStoryBeats((current) => {
      const contentBeats = current.filter((beat) => !isBlankStoryBeat(beat));
      const sourceIndex = contentBeats.findIndex((beat) => beat.id === beatId);
      const targetIndex = contentBeats.findIndex((beat) => beat.id === targetBeatId);

      if (sourceIndex < 0 || targetIndex < 0) {
        return current;
      }

      const nextBeats = [...contentBeats];
      const [movedBeat] = nextBeats.splice(sourceIndex, 1);
      nextBeats.splice(targetIndex, 0, movedBeat);
      setTimelineClips((currentClips) =>
        reorderTimelineClipsByStoryBeatOrder(
          currentClips,
          nextBeats.map((beat) => beat.id)
        )
      );

      return ensureTrailingBlankStoryBeat(nextBeats);
    });
    markProjectDirty();
  }, [markProjectDirty]);

  const addAssetToTimeline = useCallback(
    (assetId: string, timelineStart = 0, targetTrackId?: EditorTimelineTrackId) => {
      const asset = assets.find((candidate) => candidate.id === assetId);
      if (!asset) {
        return;
      }

      const durationSec = Math.max(asset.durationSec || (asset.kind === "image" ? 5 : 8), 0.2);
      const storyBeat =
        asset.kind === "audio"
          ? undefined
          : createStoryBeatForTimelineAsset(asset, durationSec);
      const nextClipId = `clip-${crypto.randomUUID()}`;
      const nextClip: EditorTimelineClip = {
        id: nextClipId,
        assetId,
        trackId: asset.kind === "audio" ? resolveAudioTargetTrack(targetTrackId) : "video-1",
        timelineStart: Math.max(0, timelineStart),
        durationSec,
        sourceIn: 0,
        sourceOut: durationSec,
        metadata: storyBeat ? createClipStoryMetadata(storyBeat) : undefined
      };
      const nextClips = [nextClip];

      if (asset.kind === "video" && (asset.metadata?.hasAudio ?? true)) {
        const sourceAudioClip: EditorTimelineClip = {
          ...nextClip,
          id: `clip-${crypto.randomUUID()}`,
          trackId: "source-audio-1",
          linkedClipId: nextClip.id
        };
        nextClip.linkedClipId = sourceAudioClip.id;
        nextClips.push(sourceAudioClip);
      }

      const nextTimelineClips = insertClipGroupMagnetically(
        timelineClips,
        nextClips,
        timelineStart
      );
      const insertedClipStart =
        nextTimelineClips.find((clip) => clip.id === nextClip.id)?.timelineStart ?? 0;

      if (storyBeat) {
        setStoryBeats((current) =>
          insertStoryBeatForClip(current, storyBeat, nextTimelineClips, nextClip.id)
        );
      }
      setTimelineClips(nextTimelineClips);
      setSelectedClipId(nextClip.id);
      setSelectedAssetId(assetId);
      setPlayheadSec(insertedClipStart);
      markProjectDirty();
    },
    [assets, markProjectDirty, timelineClips]
  );

  const addSolidColorToTimeline = useCallback(
    ({ color, durationSec }: SolidColorTimelineOptions, timelineStart = 0) => {
      const normalizedColor = normalizeRgbColor(color);
      const normalizedDuration = normalizeSolidDuration(durationSec);
      const assetId = `asset-${crypto.randomUUID()}`;
      const nextAsset: EditorMediaAsset = {
        id: assetId,
        name: `单色 ${rgbColorToLabel(normalizedColor)}`,
        kind: "image",
        durationSec: normalizedDuration,
        width: project?.settings.width ?? 1920,
        height: project?.settings.height ?? 1080,
        imported: false,
        variant: "solid-color",
        solidColor: normalizedColor,
        importedAt: new Date().toISOString()
      };
      const storyBeat = createStoryBeatForTimelineAsset(nextAsset, normalizedDuration);
      const nextClip: EditorTimelineClip = {
        id: createClipId(),
        assetId,
        trackId: "video-1",
        timelineStart: Math.max(0, timelineStart),
        durationSec: normalizedDuration,
        sourceIn: 0,
        sourceOut: normalizedDuration,
        metadata: createClipStoryMetadata(storyBeat)
      };

      setAssets((current) => [nextAsset, ...current]);
      const nextTimelineClips = insertClipGroupMagnetically(
        timelineClips,
        [nextClip],
        timelineStart
      );
      const insertedClipStart =
        nextTimelineClips.find((clip) => clip.id === nextClip.id)?.timelineStart ?? 0;

      setStoryBeats((current) =>
        insertStoryBeatForClip(current, storyBeat, nextTimelineClips, nextClip.id)
      );
      setTimelineClips(nextTimelineClips);
      setSelectedAssetId(assetId);
      setSelectedClipId(nextClip.id);
      setPlayheadSec(insertedClipStart);
      markProjectDirty();
    },
    [markProjectDirty, project, timelineClips]
  );

  const moveClip = useCallback((clipId: string, timelineStart: number) => {
    setTimelineClips((current) => {
      const nextClips = moveLinkedClipsMagnetically(current, clipId, timelineStart);
      setStoryBeats((currentBeats) =>
        reorderStoryBeatsByTimelineClips(currentBeats, nextClips)
      );
      return nextClips;
    });
    setSelectedClipId(clipId);
    markProjectDirty();
  }, [markProjectDirty]);

  const replaceClipAsset = useCallback(
    (clipId: string, assetId: string) => {
      const asset = assets.find((candidate) => candidate.id === assetId);
      if (!asset || asset.kind === "audio") {
        return;
      }

      setTimelineClips((current) => {
        const targetClip = findClipById(current, clipId);
        if (!targetClip) {
          return current;
        }

        const linkedClip = findLinkedClip(current, targetClip);
        const primaryVideoClip =
          targetClip.trackId === "video-1"
            ? targetClip
            : linkedClip?.trackId === "video-1"
              ? linkedClip
              : undefined;
        if (!primaryVideoClip) {
          return current;
        }

        const sourceAudioClip = findLinkedClip(current, primaryVideoClip);
        const durationSec = Math.max(
          asset.durationSec || (asset.kind === "image" ? 5 : 8),
          0.2
        );
        const storyBeat = createStoryBeatForTimelineAsset(
          asset,
          durationSec,
          getClipStorySegmentId(primaryVideoClip) ?? createStoryBeatId()
        );
        const replacementVideoClip: EditorTimelineClip = {
          ...primaryVideoClip,
          assetId,
          durationSec,
          sourceIn: 0,
          sourceOut: durationSec,
          linkedClipId: undefined,
          metadata: {
            ...(primaryVideoClip.metadata ?? {}),
            ...createClipStoryMetadata(storyBeat)
          }
        };
        let replacementAudioClip: EditorTimelineClip | undefined;

        if (asset.kind === "video" && (asset.metadata?.hasAudio ?? true)) {
          const sourceAudioClipId = sourceAudioClip?.id ?? createClipId();
          replacementVideoClip.linkedClipId = sourceAudioClipId;
          replacementAudioClip = {
            ...replacementVideoClip,
            id: sourceAudioClipId,
            trackId: "source-audio-1",
            linkedClipId: replacementVideoClip.id
          };
        }

        const nextClips = normalizeMagneticTimelineClips(
          current.flatMap((clip) => {
            if (clip.id === primaryVideoClip.id) {
              return replacementAudioClip
                ? [replacementVideoClip, replacementAudioClip]
                : [replacementVideoClip];
            }

            if (clip.id === sourceAudioClip?.id) {
              return [];
            }

            return [clip];
          })
        );

        setStoryBeats((currentBeats) =>
          updateStoryBeatAfterAssetReplacement(
            currentBeats,
            storyBeat,
            nextClips,
            replacementVideoClip.id
          )
        );
        return nextClips;
      });
      setSelectedClipId(clipId);
      setSelectedAssetId(assetId);
      markProjectDirty();
    },
    [assets, markProjectDirty]
  );

  const deleteClip = useCallback(
    (clipId?: string) => {
      const targetClip = findClipById(timelineClips, clipId ?? selectedClipId);
      if (!targetClip) {
        return;
      }

      const linkedClip = findLinkedClip(timelineClips, targetClip);
      const removedClipIds = new Set([targetClip.id, linkedClip?.id].filter(Boolean));
      const removedStoryBeatIds = new Set(
        [getClipStorySegmentId(targetClip), linkedClip ? getClipStorySegmentId(linkedClip) : undefined]
          .filter((beatId): beatId is string => Boolean(beatId))
      );

      setTimelineClips((current) => {
        const nextClips = normalizeMagneticTimelineClips(
          current.filter((clip) => !removedClipIds.has(clip.id))
        );
        setStoryBeats((currentBeats) =>
          removeDetachedStoryBeats(currentBeats, nextClips, removedStoryBeatIds)
        );
        return nextClips;
      });
      setSelectedClipId(undefined);
      setSelectedAssetId(targetClip.assetId);
      setPlayheadSec(clampPlayhead(targetClip.timelineStart, timelineDurationSec));
      markProjectDirty();
    },
    [markProjectDirty, selectedClipId, timelineClips, timelineDurationSec]
  );

  const splitClip = useCallback(
    (clipId: string | undefined, splitTime: number) => {
      const splitResult = splitTimelineClips(
        timelineClips,
        clipId ?? selectedClipId,
        splitTime
      );

      if (!splitResult) {
        return;
      }

      let nextClips = splitResult.clips;
      const leftVideoClip = splitResult.primaryVideoLeftClipId
        ? nextClips.find((clip) => clip.id === splitResult.primaryVideoLeftClipId)
        : undefined;
      const rightVideoClip = splitResult.primaryVideoRightClipId
        ? nextClips.find((clip) => clip.id === splitResult.primaryVideoRightClipId)
        : undefined;

      if (leftVideoClip && rightVideoClip) {
        const leftStoryBeat = resolveTimelineClipStoryBeat({
          clip: leftVideoClip,
          assets,
          storyBeats,
          durationSec: leftVideoClip.durationSec
        });
        const rightStoryBeat: EditorStoryBeat = {
          ...leftStoryBeat,
          id: createStoryBeatId(),
          durationSec: normalizeStoryBeatDuration(rightVideoClip.durationSec)
        };

        nextClips = updateClipGroupStoryMetadata(
          nextClips,
          leftVideoClip.id,
          leftStoryBeat
        );
        nextClips = updateClipGroupStoryMetadata(
          nextClips,
          rightVideoClip.id,
          rightStoryBeat
        );
        setStoryBeats((current) =>
          duplicateStoryBeatForSplit(
            current,
            leftStoryBeat,
            rightStoryBeat,
            nextClips
          )
        );
      }

      setTimelineClips(normalizeMagneticTimelineClips(nextClips));
      setSelectedClipId(splitResult.selectedClipId);
      setSelectedAssetId(splitResult.selectedAssetId);
      setPlayheadSec(clampPlayhead(splitTime, timelineDurationSec));
      markProjectDirty();
    },
    [assets, markProjectDirty, selectedClipId, storyBeats, timelineClips, timelineDurationSec]
  );

  const setPlayhead = useCallback(
    (time: number, options?: SetPlayheadOptions) => {
      setPlayheadSec(clampPlayhead(time, timelineDurationSec));
      if (options?.markProjectDirty !== false) {
        markProjectDirty();
      }
    },
    [markProjectDirty, timelineDurationSec]
  );

  const nudgePlayhead = useCallback(
    (delta: number) => {
      setPlayheadSec((current) => clampPlayhead(current + delta, timelineDurationSec));
      markProjectDirty();
    },
    [markProjectDirty, timelineDurationSec]
  );

  const resolveTimelinePreview = useCallback(
    (time: number) => resolveTimelinePreviewValue(time, timelineClips, assets),
    [assets, timelineClips]
  );

  const value = useMemo<EditorContextValue>(
    () => ({
      project,
      projectRuntime,
      projectLayout,
      isProjectOpen: Boolean(projectRuntime),
      isProjectDirty,
      isProjectSaving,
      isAiGeneratingStoryboard,
      storyboardGenerationProgress,
      projectMessage,
      assets,
      timelineClips,
      selectedAssetId,
      selectedClipId,
      storyBeats,
      selectedStoryBeatIdsForGeneration,
      selectedAsset,
      selectedClip,
      activeTimelineAsset,
      activeTimelineClip,
      timelineDurationSec,
      timelineFps,
      playheadSec,
      createProject,
      openProjectFromPicker,
      saveProject,
      generateStoryboardVideos,
      importFiles,
      importPaths,
      openMediaPicker,
      selectAsset,
      selectClip,
      updateStoryBeat,
      importStoryBeats,
      toggleStoryBeatGenerationSelection,
      moveStoryBeat,
      addAssetToTimeline,
      addSolidColorToTimeline,
      moveClip,
      replaceClipAsset,
      deleteClip,
      splitClip,
      setPlayhead,
      nudgePlayhead,
      resolveTimelinePreview
    }),
    [
      addAssetToTimeline,
      addSolidColorToTimeline,
      activeTimelineAsset,
      activeTimelineClip,
      assets,
      createProject,
      deleteClip,
      generateStoryboardVideos,
      importStoryBeats,
      importFiles,
      importPaths,
      isProjectDirty,
      isProjectSaving,
      isAiGeneratingStoryboard,
      storyboardGenerationProgress,
      moveClip,
      replaceClipAsset,
      nudgePlayhead,
      openMediaPicker,
      openProjectFromPicker,
      playheadSec,
      project,
      projectLayout,
      projectMessage,
      projectRuntime,
      resolveTimelinePreview,
      saveProject,
      selectAsset,
      selectClip,
      selectedAsset,
      selectedAssetId,
      selectedClip,
      selectedClipId,
      selectedStoryBeatIdsForGeneration,
      setPlayhead,
      storyBeats,
      toggleStoryBeatGenerationSelection,
      moveStoryBeat,
      splitClip,
      timelineFps,
      timelineDurationSec,
      timelineClips,
      updateStoryBeat
    ]
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
};

export const useEditor = (): EditorContextValue => {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error("useEditor must be used within EditorProvider.");
  }

  return context;
};

interface StoryboardGenerationProvider {
  providerId: string;
  modelId?: string;
}

async function resolveStoryboardGenerationProvider(): Promise<StoryboardGenerationProvider> {
  try {
    const config = await desktopApi.config.get();
    if (config.providers.googleVeo.enabled) {
      return {
        providerId: "google-veo",
        modelId: config.providers.googleVeo.textImageModel
      };
    }

    if (config.providers.volcengineSeedance.enabled) {
      return {
        providerId: "volcengine-seedance",
        modelId: config.providers.volcengineSeedance.reqKey
      };
    }
  } catch {
    return {
      providerId: "mock",
      modelId: "mock-video-v1"
    };
  }

  return {
    providerId: "mock",
    modelId: "mock-video-v1"
  };
}

function formatProjectAspectRatio(width: number, height: number): string {
  const normalizedWidth = Math.max(1, Math.round(width));
  const normalizedHeight = Math.max(1, Math.round(height));
  const divisor = greatestCommonDivisor(normalizedWidth, normalizedHeight);

  return `${normalizedWidth / divisor}:${normalizedHeight / divisor}`;
}

function greatestCommonDivisor(first: number, second: number): number {
  let a = Math.abs(first);
  let b = Math.abs(second);

  while (b > 0) {
    const next = a % b;
    a = b;
    b = next;
  }

  return a || 1;
}

function clampPlayhead(time: number, timelineDurationSec: number): number {
  return Math.max(0, Math.min(timelineDurationSec, time));
}

function resolveTimelinePreviewValue(
  time: number,
  clips: EditorTimelineClip[],
  assets: EditorMediaAsset[]
): TimelinePreviewTarget | undefined {
  const clip = clips
    .filter((candidate) => candidate.trackId === "video-1")
    .find(
      (candidate) =>
        time >= candidate.timelineStart &&
        time < candidate.timelineStart + candidate.durationSec
    );

  if (!clip) {
    return undefined;
  }

  const asset = assets.find((candidate) => candidate.id === clip.assetId);
  if (!asset) {
    return undefined;
  }

  const clipProgress = Math.max(0, time - clip.timelineStart);
  const sourceTime =
    asset.kind === "image"
      ? 0
      : Math.min(Math.max(clip.sourceIn, clip.sourceOut - 0.001), clip.sourceIn + clipProgress);

  return {
    asset,
    clip,
    sourceTime,
    timelineTime: time
  };
}

function resolveFirstTimelineVideoFps(
  clips: EditorTimelineClip[],
  assets: EditorMediaAsset[]
): number | undefined {
  const videoClip = clips.find((clip) => clip.trackId === "video-1");
  if (!videoClip) {
    return undefined;
  }

  return assets.find((asset) => asset.id === videoClip.assetId)?.fps;
}

function resolveAudioTargetTrack(
  targetTrackId: EditorTimelineTrackId | undefined
): "voiceover-1" | "music-1" {
  return targetTrackId === "voiceover-1" ? "voiceover-1" : "music-1";
}

function createStoryBeatId(): string {
  return `story-${crypto.randomUUID()}`;
}

function createStoryBeatForTimelineAsset(
  asset: EditorMediaAsset,
  durationSec: number,
  id = createStoryBeatId()
): EditorStoryBeat {
  return {
    id,
    description: createTimelineAssetStoryDescription(asset),
    durationSec: normalizeStoryBeatDuration(durationSec)
  };
}

function createTimelineAssetStoryDescription(asset: EditorMediaAsset): string {
  if (asset.variant === "solid-color" && asset.solidColor) {
    return `单色：${rgbColorToHex(asset.solidColor)}`;
  }

  if (asset.imported) {
    return `导入：${asset.name}`;
  }

  return readStoryboardAssetText(asset) ?? asset.name;
}

function readStoryboardAssetText(asset: EditorMediaAsset): string | undefined {
  const storyboardMetadata = asset.metadata?.probe?.storyboardAi;
  if (!isRecord(storyboardMetadata)) {
    return undefined;
  }

  const text = storyboardMetadata.text ?? storyboardMetadata.storyText;
  return typeof text === "string" && text.trim().length > 0
    ? text.trim()
    : undefined;
}

function createClipStoryMetadata(
  beat: EditorStoryBeat
): Record<string, string> {
  return {
    storySegmentId: beat.id,
    storyText: beat.description
  };
}

function getClipStorySegmentId(clip: EditorTimelineClip): string | undefined {
  const storySegmentId = clip.metadata?.storySegmentId;
  return typeof storySegmentId === "string" && storySegmentId.length > 0
    ? storySegmentId
    : undefined;
}

function insertStoryBeatForClip(
  storyBeats: EditorStoryBeat[],
  storyBeat: EditorStoryBeat,
  clips: EditorTimelineClip[],
  clipId: string
): EditorStoryBeat[] {
  const contentBeats = storyBeats.filter((beat) => !isBlankStoryBeat(beat));
  const nextContentBeats = contentBeats.filter((beat) => beat.id !== storyBeat.id);
  const targetIndex = getOrderedTrackClips(clips, "video-1").findIndex(
    (clip) => clip.id === clipId
  );
  const insertIndex =
    targetIndex === -1
      ? nextContentBeats.length
      : Math.max(0, Math.min(nextContentBeats.length, targetIndex));

  nextContentBeats.splice(insertIndex, 0, storyBeat);
  return ensureTrailingBlankStoryBeat(nextContentBeats);
}

function reorderStoryBeatsByTimelineClips(
  storyBeats: EditorStoryBeat[],
  clips: EditorTimelineClip[]
): EditorStoryBeat[] {
  const contentBeats = storyBeats.filter((beat) => !isBlankStoryBeat(beat));
  const beatById = new Map(contentBeats.map((beat) => [beat.id, beat]));
  const orderedStoryBeatIds = uniqueStrings(
    getOrderedTrackClips(clips, "video-1")
      .map(getClipStorySegmentId)
      .filter((beatId): beatId is string => Boolean(beatId))
  );
  const orderedClipBeats = orderedStoryBeatIds
    .map((beatId) => beatById.get(beatId))
    .filter((beat): beat is EditorStoryBeat => Boolean(beat));
  const orderedBeatIdSet = new Set(orderedStoryBeatIds);
  const remainingBeats = contentBeats.filter((beat) => !orderedBeatIdSet.has(beat.id));

  return ensureTrailingBlankStoryBeat([...orderedClipBeats, ...remainingBeats]);
}

function reorderTimelineClipsByStoryBeatOrder(
  clips: EditorTimelineClip[],
  storySegmentIds: string[]
): EditorTimelineClip[] {
  const storySegmentOrder = new Map(storySegmentIds.map((beatId, index) => [beatId, index]));
  const orderedVideoClips = getOrderedTrackClips(clips, "video-1");
  const fallbackOrder = new Map(orderedVideoClips.map((clip, index) => [clip.id, index]));
  const sortedVideoClips = [...orderedVideoClips].sort((firstClip, secondClip) => {
    const firstStoryOrder = storySegmentOrder.get(getClipStorySegmentId(firstClip) ?? "");
    const secondStoryOrder = storySegmentOrder.get(getClipStorySegmentId(secondClip) ?? "");

    return (
      (firstStoryOrder ?? Number.MAX_SAFE_INTEGER) -
        (secondStoryOrder ?? Number.MAX_SAFE_INTEGER) ||
      (fallbackOrder.get(firstClip.id) ?? 0) - (fallbackOrder.get(secondClip.id) ?? 0)
    );
  });

  return normalizeMagneticTimelineClips(
    replaceTrackOrder(clips, "video-1", sortedVideoClips)
  );
}

function removeDetachedStoryBeats(
  storyBeats: EditorStoryBeat[],
  clips: EditorTimelineClip[],
  removedStoryBeatIds: Set<string>
): EditorStoryBeat[] {
  if (removedStoryBeatIds.size === 0) {
    return storyBeats;
  }

  const remainingStoryBeatIds = new Set(
    getOrderedTrackClips(clips, "video-1")
      .map(getClipStorySegmentId)
      .filter((beatId): beatId is string => Boolean(beatId))
  );
  const nextBeats = storyBeats
    .filter((beat) => !isBlankStoryBeat(beat))
    .filter(
      (beat) =>
        !removedStoryBeatIds.has(beat.id) || remainingStoryBeatIds.has(beat.id)
    );

  return ensureTrailingBlankStoryBeat(nextBeats);
}

function resolveTimelineClipStoryBeat({
  clip,
  assets,
  storyBeats,
  durationSec
}: {
  clip: EditorTimelineClip;
  assets: EditorMediaAsset[];
  storyBeats: EditorStoryBeat[];
  durationSec: number;
}): EditorStoryBeat {
  const storySegmentId = getClipStorySegmentId(clip) ?? createStoryBeatId();
  const existingBeat = storyBeats.find((beat) => beat.id === storySegmentId);
  if (existingBeat) {
    return {
      ...existingBeat,
      durationSec: normalizeStoryBeatDuration(durationSec)
    };
  }

  const asset = assets.find((candidate) => candidate.id === clip.assetId);
  return asset
    ? createStoryBeatForTimelineAsset(asset, durationSec, storySegmentId)
    : {
        id: storySegmentId,
        description: "片段",
        durationSec: normalizeStoryBeatDuration(durationSec)
      };
}

function updateClipGroupStoryMetadata(
  clips: EditorTimelineClip[],
  clipId: string,
  storyBeat: EditorStoryBeat
): EditorTimelineClip[] {
  const clip = findClipById(clips, clipId);
  if (!clip) {
    return clips;
  }

  const clipIds = new Set([clip.id]);
  if (clip.linkedClipId) {
    clipIds.add(clip.linkedClipId);
  }
  clips.forEach((candidate) => {
    if (candidate.linkedClipId === clip.id) {
      clipIds.add(candidate.id);
    }
  });

  return clips.map((candidate) =>
    clipIds.has(candidate.id)
      ? {
          ...candidate,
          metadata: {
            ...(candidate.metadata ?? {}),
            ...createClipStoryMetadata(storyBeat)
          }
        }
      : candidate
  );
}

function duplicateStoryBeatForSplit(
  storyBeats: EditorStoryBeat[],
  leftStoryBeat: EditorStoryBeat,
  rightStoryBeat: EditorStoryBeat,
  clips: EditorTimelineClip[]
): EditorStoryBeat[] {
  const contentBeats = storyBeats.filter((beat) => !isBlankStoryBeat(beat));
  const beatById = new Map(contentBeats.map((beat) => [beat.id, beat]));
  beatById.set(leftStoryBeat.id, leftStoryBeat);
  beatById.set(rightStoryBeat.id, rightStoryBeat);

  const orderedStoryBeatIds = uniqueStrings(
    getOrderedTrackClips(clips, "video-1")
      .map(getClipStorySegmentId)
      .filter((beatId): beatId is string => Boolean(beatId))
  );
  const orderedClipBeats = orderedStoryBeatIds
    .map((beatId) => beatById.get(beatId))
    .filter((beat): beat is EditorStoryBeat => Boolean(beat));
  const orderedBeatIdSet = new Set(orderedStoryBeatIds);
  const remainingBeats = contentBeats.filter((beat) => !orderedBeatIdSet.has(beat.id));

  return ensureTrailingBlankStoryBeat([...orderedClipBeats, ...remainingBeats]);
}

function updateStoryBeatAfterAssetReplacement(
  storyBeats: EditorStoryBeat[],
  storyBeat: EditorStoryBeat,
  clips: EditorTimelineClip[],
  clipId: string
): EditorStoryBeat[] {
  if (storyBeats.some((beat) => beat.id === storyBeat.id)) {
    return ensureTrailingBlankStoryBeat(
      storyBeats
        .filter((beat) => !isBlankStoryBeat(beat))
        .map((beat) => (beat.id === storyBeat.id ? storyBeat : beat))
    );
  }

  return insertStoryBeatForClip(storyBeats, storyBeat, clips, clipId);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function insertClipGroupMagnetically(
  clips: EditorTimelineClip[],
  insertedClips: EditorTimelineClip[],
  timelineStart: number
): EditorTimelineClip[] {
  const videoClip = insertedClips.find((clip) => clip.trackId === "video-1");
  if (videoClip) {
    return normalizeMagneticTimelineClips([
      ...insertClipsIntoTrackOrder(clips, "video-1", [videoClip], timelineStart),
      ...insertedClips.filter((clip) => clip.id !== videoClip.id)
    ]);
  }

  const [firstClip] = insertedClips;
  if (!firstClip) {
    return normalizeMagneticTimelineClips(clips);
  }

  return normalizeMagneticTimelineClips(
    insertClipsIntoTrackOrder(clips, firstClip.trackId, insertedClips, timelineStart)
  );
}

function moveLinkedClipsMagnetically(
  clips: EditorTimelineClip[],
  clipId: string,
  timelineStart: number
): EditorTimelineClip[] {
  const targetClip = clips.find((clip) => clip.id === clipId);
  if (!targetClip) {
    return clips;
  }

  const linkedClip = findLinkedClip(clips, targetClip);
  const primaryVideoClip =
    targetClip.trackId === "video-1"
      ? targetClip
      : linkedClip?.trackId === "video-1"
        ? linkedClip
        : undefined;

  if (primaryVideoClip) {
    return normalizeMagneticTimelineClips(
      moveClipWithinTrackOrder(clips, "video-1", primaryVideoClip.id, timelineStart)
    );
  }

  return normalizeMagneticTimelineClips(
    moveClipWithinTrackOrder(clips, targetClip.trackId, targetClip.id, timelineStart)
  );
}

function normalizeMagneticTimelineClips(
  clips: EditorTimelineClip[]
): EditorTimelineClip[] {
  let nextClips = normalizeTrackByOrder(clips, "video-1");
  const videoClipStarts = new Map(
    nextClips
      .filter((clip) => clip.trackId === "video-1")
      .map((clip) => [clip.id, clip.timelineStart])
  );

  nextClips = nextClips.map((clip) => {
    if (clip.trackId !== "source-audio-1" || !clip.linkedClipId) {
      return clip;
    }

    const linkedVideoStart = videoClipStarts.get(clip.linkedClipId);
    if (linkedVideoStart === undefined) {
      return clip;
    }

    return {
      ...clip,
      timelineStart: linkedVideoStart
    };
  });

  return normalizeTrackByOrder(
    normalizeTrackByOrder(nextClips, "voiceover-1"),
    "music-1"
  );
}

function insertClipsIntoTrackOrder(
  clips: EditorTimelineClip[],
  trackId: EditorTimelineTrackId,
  insertedClips: EditorTimelineClip[],
  timelineStart: number
): EditorTimelineClip[] {
  const orderedTrackClips = getOrderedTrackClips(clips, trackId);
  const insertIndex = getMagneticInsertionIndex(orderedTrackClips, timelineStart);
  const nextTrackOrder = [
    ...orderedTrackClips.slice(0, insertIndex),
    ...insertedClips,
    ...orderedTrackClips.slice(insertIndex)
  ];

  return replaceTrackOrder(clips, trackId, nextTrackOrder);
}

function moveClipWithinTrackOrder(
  clips: EditorTimelineClip[],
  trackId: EditorTimelineTrackId,
  clipId: string,
  timelineStart: number
): EditorTimelineClip[] {
  const targetClip = clips.find((clip) => clip.id === clipId);
  if (!targetClip) {
    return clips;
  }

  const orderedTrackClips = getOrderedTrackClips(clips, trackId).filter(
    (clip) => clip.id !== clipId
  );
  const insertIndex = getMagneticInsertionIndex(orderedTrackClips, timelineStart);
  const nextTrackOrder = [
    ...orderedTrackClips.slice(0, insertIndex),
    targetClip,
    ...orderedTrackClips.slice(insertIndex)
  ];

  return replaceTrackOrder(clips, trackId, nextTrackOrder);
}

function normalizeTrackByOrder(
  clips: EditorTimelineClip[],
  trackId: EditorTimelineTrackId
): EditorTimelineClip[] {
  const orderedTrackClips = clips.filter((clip) => clip.trackId === trackId);
  let timelineCursor = 0;
  const updatedTrackClips = orderedTrackClips.map((clip) => {
    const normalizedClip = {
      ...clip,
      timelineStart: roundTimelineTime(timelineCursor)
    };
    timelineCursor += clip.durationSec;
    return normalizedClip;
  });

  return replaceTrackOrder(clips, trackId, updatedTrackClips);
}

function replaceTrackOrder(
  clips: EditorTimelineClip[],
  trackId: EditorTimelineTrackId,
  orderedTrackClips: EditorTimelineClip[]
): EditorTimelineClip[] {
  return [
    ...clips.filter((clip) => clip.trackId !== trackId),
    ...orderedTrackClips
  ];
}

function getOrderedTrackClips(
  clips: EditorTimelineClip[],
  trackId: EditorTimelineTrackId
): EditorTimelineClip[] {
  const originalOrder = new Map(clips.map((clip, index) => [clip.id, index]));

  return clips
    .filter((clip) => clip.trackId === trackId)
    .sort(
      (firstClip, secondClip) =>
        firstClip.timelineStart - secondClip.timelineStart ||
        (originalOrder.get(firstClip.id) ?? 0) - (originalOrder.get(secondClip.id) ?? 0)
    );
}

function getMagneticInsertionIndex(
  orderedTrackClips: EditorTimelineClip[],
  timelineStart: number
): number {
  const targetStart = Math.max(0, timelineStart);
  const insertIndex = orderedTrackClips.findIndex(
    (clip) => targetStart < clip.timelineStart + clip.durationSec / 2
  );

  return insertIndex === -1 ? orderedTrackClips.length : insertIndex;
}

interface SplitTimelineResult {
  clips: EditorTimelineClip[];
  primaryVideoLeftClipId?: string;
  primaryVideoRightClipId?: string;
  selectedAssetId: string;
  selectedClipId: string;
}

function splitTimelineClips(
  clips: EditorTimelineClip[],
  clipId: string | undefined,
  splitTime: number
): SplitTimelineResult | undefined {
  const targetClip =
    findClipById(clips, clipId) ?? findSplitCandidate(clips, splitTime);
  if (!targetClip || !canSplitClipAtTime(targetClip, splitTime)) {
    return undefined;
  }

  const linkedClip = findLinkedClip(clips, targetClip);
  if (linkedClip && !canSplitClipAtTime(linkedClip, splitTime)) {
    return undefined;
  }

  const targetRightId = createClipId();
  const linkedRightId = linkedClip ? createClipId() : undefined;
  const primaryVideoClip =
    targetClip.trackId === "video-1"
      ? targetClip
      : linkedClip?.trackId === "video-1"
        ? linkedClip
        : undefined;
  const primaryVideoRightClipId =
    primaryVideoClip?.id === targetClip.id ? targetRightId : linkedRightId;
  const selectedClipId = targetRightId;
  const nextClips = clips.flatMap((clip) => {
    if (clip.id === targetClip.id) {
      return splitOneClip(clip, splitTime, targetRightId, linkedRightId);
    }

    if (linkedClip && clip.id === linkedClip.id && linkedRightId) {
      return splitOneClip(clip, splitTime, linkedRightId, targetRightId);
    }

    return [clip];
  });

  return {
    clips: nextClips,
    primaryVideoLeftClipId: primaryVideoClip?.id,
    primaryVideoRightClipId,
    selectedAssetId: targetClip.assetId,
    selectedClipId
  };
}

function splitOneClip(
  clip: EditorTimelineClip,
  splitTime: number,
  rightClipId: string,
  rightLinkedClipId?: string
): [EditorTimelineClip, EditorTimelineClip] {
  const timelineOffset = roundTimelineTime(splitTime - clip.timelineStart);
  const sourceSplit = roundTimelineTime(clip.sourceIn + timelineOffset);
  const leftClip: EditorTimelineClip = {
    ...clip,
    durationSec: timelineOffset,
    sourceOut: sourceSplit
  };
  const rightClip: EditorTimelineClip = {
    ...clip,
    id: rightClipId,
    timelineStart: roundTimelineTime(splitTime),
    durationSec: roundTimelineTime(clip.durationSec - timelineOffset),
    sourceIn: sourceSplit,
    linkedClipId: rightLinkedClipId
  };

  return [leftClip, rightClip];
}

function findClipById(
  clips: EditorTimelineClip[],
  clipId: string | undefined
): EditorTimelineClip | undefined {
  if (!clipId) {
    return undefined;
  }

  return clips.find((clip) => clip.id === clipId);
}

function findLinkedClip(
  clips: EditorTimelineClip[],
  clip: EditorTimelineClip
): EditorTimelineClip | undefined {
  return clips.find(
    (candidate) =>
      candidate.id === clip.linkedClipId || candidate.linkedClipId === clip.id
  );
}

function findSplitCandidate(
  clips: EditorTimelineClip[],
  splitTime: number
): EditorTimelineClip | undefined {
  return (
    clips.find(
      (clip) => clip.trackId === "video-1" && canSplitClipAtTime(clip, splitTime)
    ) ?? clips.find((clip) => canSplitClipAtTime(clip, splitTime))
  );
}

function canSplitClipAtTime(clip: EditorTimelineClip, splitTime: number): boolean {
  const minimumSegmentDuration = 0.1;
  const clipStart = clip.timelineStart;
  const clipEnd = clip.timelineStart + clip.durationSec;

  return (
    splitTime > clipStart + minimumSegmentDuration &&
    splitTime < clipEnd - minimumSegmentDuration
  );
}

function createClipId(): string {
  return `clip-${crypto.randomUUID()}`;
}

function roundTimelineTime(time: number): number {
  return Math.round(time * 1000) / 1000;
}

function normalizeStoryBeatDuration(durationSec: number): number {
  if (!Number.isFinite(durationSec)) {
    return DEFAULT_STORY_BEAT_DURATION_SEC;
  }

  return Math.max(0.1, Math.round(durationSec * 10) / 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getDesktopFilePath(file: File): string | undefined {
  try {
    return desktopApi.media.getPathForFile(file) || undefined;
  } catch {
    return undefined;
  }
}

function hasUnsavedStarterEditorState(
  assets: EditorMediaAsset[],
  timelineClips: EditorTimelineClip[],
  storyBeats: EditorStoryBeat[]
): boolean {
  return (
    assets.length > 0 ||
    timelineClips.length > 0 ||
    storyBeats.some((beat) => !isBlankStoryBeat(beat))
  );
}

async function ensureImportedAssetsStoredInProject(
  assets: EditorMediaAsset[],
  projectRootPath: string
): Promise<EditorMediaAsset[]> {
  const assetsNeedingStorage = assets.filter(
    (asset) => asset.imported && asset.absolutePath && !asset.projectRelativePath
  );

  if (assetsNeedingStorage.length === 0) {
    return assets;
  }

  const sourcePaths = Array.from(
    new Set(
      assetsNeedingStorage
        .map((asset) => asset.absolutePath)
        .filter((path): path is string => Boolean(path))
    )
  );
  const importedFiles = await desktopApi.media.importFiles({
    absolutePaths: sourcePaths,
    projectRootPath
  });
  const importedFilesBySourcePath = new Map(
    sourcePaths.map((sourcePath, index) => [sourcePath, importedFiles[index]])
  );

  return assets.map((asset) => {
    if (!asset.imported || !asset.absolutePath || asset.projectRelativePath) {
      return asset;
    }

    const importedFile = importedFilesBySourcePath.get(asset.absolutePath);
    return importedFile
      ? updateEditorAssetFromImportedFile(asset, importedFile)
      : asset;
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function formatStoryboardProgressMessage(event: AiStoryboardProgressEvent): string {
  const segment =
    event.segmentIndex !== undefined && event.segmentCount !== undefined
      ? `第 ${event.segmentIndex + 1}/${event.segmentCount} 段`
      : "";
  const progress =
    event.progress !== undefined ? ` ${Math.round(event.progress * 100)}%` : "";
  const prefix = segment ? `${segment}：` : "";

  return `${prefix}${event.message}${progress}`;
}

function resolveStoryboardTargetSegmentIds({
  project,
  contentBeats,
  assets,
  timelineClips,
  selectedStoryBeatIdsForGeneration
}: {
  project: Project;
  contentBeats: EditorStoryBeat[];
  assets: EditorMediaAsset[];
  timelineClips: EditorTimelineClip[];
  selectedStoryBeatIdsForGeneration: string[];
}): string[] {
  const contentBeatIds = new Set(contentBeats.map((beat) => beat.id));
  const selectedTargetIds = selectedStoryBeatIdsForGeneration.filter((beatId) =>
    contentBeatIds.has(beatId)
  );

  if (selectedTargetIds.length > 0) {
    return selectedTargetIds;
  }

  return contentBeats
    .filter(
      (beat) => !hasUsableStoryboardOutput(project, assets, timelineClips, beat.id)
    )
    .map((beat) => beat.id);
}

function hasUsableStoryboardOutput(
  project: Project,
  assets: EditorMediaAsset[],
  timelineClips: EditorTimelineClip[],
  beatId: string
): boolean {
  const segment = project.storyboardSegments.find(
    (candidate) => candidate.id === beatId
  );
  if (
    segment?.outputAssetId &&
    hasUsableStoryboardAsset(project, assets, segment.outputAssetId)
  ) {
    return true;
  }

  return timelineClips.some(
    (clip) =>
      clip.trackId === "video-1" &&
      getClipStorySegmentId(clip) === beatId &&
      hasUsableStoryboardAsset(project, assets, clip.assetId)
  );
}

function hasUsableStoryboardAsset(
  project: Project,
  assets: EditorMediaAsset[],
  assetId: string
): boolean {
  const projectAsset = project.assets.find(
    (asset) => asset.id === assetId
  );
  const editorAsset = assets.find((asset) => asset.id === assetId);

  return Boolean(
    projectAsset?.projectRelativePath ||
      editorAsset?.projectRelativePath ||
      editorAsset?.absolutePath ||
      editorAsset?.objectUrl ||
      editorAsset?.variant === "solid-color"
  );
}
