import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState
} from "react";
import {
  createEditorAssetFromFile,
  createEditorAssetFromImportedFile
} from "./mediaImport";
import type {
  EditorMediaAsset,
  EditorStoryBeat,
  EditorTimelineClip,
  EditorTimelineTrackId,
  ImportMediaResult
} from "./editorTypes";
import { desktopApi } from "../ipc/api";

const TIMELINE_BASE_DURATION_SEC = 40;

export interface TimelinePreviewTarget {
  asset: EditorMediaAsset;
  clip: EditorTimelineClip;
  sourceTime: number;
  timelineTime: number;
}

interface EditorContextValue {
  assets: EditorMediaAsset[];
  timelineClips: EditorTimelineClip[];
  selectedAssetId?: string;
  selectedClipId?: string;
  storyBeats: EditorStoryBeat[];
  timelineDurationSec: number;
  timelineFps?: number;
  playheadSec: number;
  selectedAsset?: EditorMediaAsset;
  selectedClip?: EditorTimelineClip;
  activeTimelineClip?: EditorTimelineClip;
  activeTimelineAsset?: EditorMediaAsset;
  importFiles(files: FileList | File[]): Promise<ImportMediaResult>;
  importPaths(absolutePaths: string[]): Promise<ImportMediaResult>;
  openMediaPicker(): Promise<ImportMediaResult>;
  selectAsset(assetId: string): void;
  selectClip(clipId: string): void;
  updateStoryBeat(beatId: string, changes: Partial<Omit<EditorStoryBeat, "id">>): void;
  moveStoryBeat(beatId: string, targetBeatId: string): void;
  addAssetToTimeline(
    assetId: string,
    timelineStart?: number,
    targetTrackId?: EditorTimelineTrackId
  ): void;
  moveClip(clipId: string, timelineStart: number): void;
  deleteClip(clipId?: string): void;
  splitClip(clipId: string | undefined, splitTime: number): void;
  setPlayhead(time: number): void;
  nudgePlayhead(delta: number): void;
  resolveTimelinePreview(time: number): TimelinePreviewTarget | undefined;
}

const EditorContext = createContext<EditorContextValue | null>(null);

const initialAssets: EditorMediaAsset[] = [];
const initialTimelineClips: EditorTimelineClip[] = [];
const DEFAULT_STORY_BEAT_DURATION_SEC = 5;

export const EditorProvider = ({ children }: { children: ReactNode }) => {
  const [assets, setAssets] = useState<EditorMediaAsset[]>(initialAssets);
  const [timelineClips, setTimelineClips] =
    useState<EditorTimelineClip[]>(initialTimelineClips);
  const [storyBeats, setStoryBeats] = useState<EditorStoryBeat[]>(() => [
    createBlankStoryBeat()
  ]);
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

  const commitImportedAssets = useCallback((importedAssets: EditorMediaAsset[]) => {
    if (importedAssets.length === 0) {
      return;
    }

    setAssets((current) => [...importedAssets, ...current]);
    setSelectedAssetId(importedAssets[0].id);
    setSelectedClipId(undefined);
  }, []);

  const importPaths = useCallback(
    async (absolutePaths: string[]) => {
      if (absolutePaths.length === 0) {
        return { assets: [], errors: ["没有找到可导入的媒体文件"] };
      }

      try {
        const importedFiles = await desktopApi.media.importFiles({ absolutePaths });
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
    [commitImportedAssets]
  );

  const openMediaPicker = useCallback(async () => {
    try {
      const importedFiles = await desktopApi.media.selectFiles({ allowMultiple: true });
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
  }, [commitImportedAssets]);

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
    },
    []
  );

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

      return ensureTrailingBlankStoryBeat(nextBeats);
    });
  }, []);

  const addAssetToTimeline = useCallback(
    (assetId: string, timelineStart = 0, targetTrackId?: EditorTimelineTrackId) => {
      const asset = assets.find((candidate) => candidate.id === assetId);
      if (!asset) {
        return;
      }

      const durationSec = Math.max(asset.durationSec || (asset.kind === "image" ? 5 : 8), 0.2);
      const nextStart = Math.max(0, timelineStart);
      const nextClipId = `clip-${crypto.randomUUID()}`;
      const nextClip: EditorTimelineClip = {
        id: nextClipId,
        assetId,
        trackId: asset.kind === "audio" ? resolveAudioTargetTrack(targetTrackId) : "video-1",
        timelineStart: nextStart,
        durationSec,
        sourceIn: 0,
        sourceOut: durationSec
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

      setTimelineClips((current) => [...current, ...nextClips]);
      setSelectedClipId(nextClip.id);
      setSelectedAssetId(assetId);
      setPlayheadSec(nextClip.timelineStart);
    },
    [assets]
  );

  const moveClip = useCallback((clipId: string, timelineStart: number) => {
    setTimelineClips((current) =>
      moveLinkedClips(current, clipId, timelineStart, timelineDurationSec)
    );
    setSelectedClipId(clipId);
  }, [timelineDurationSec]);

  const deleteClip = useCallback(
    (clipId?: string) => {
      const targetClip = findClipById(timelineClips, clipId ?? selectedClipId);
      if (!targetClip) {
        return;
      }

      const linkedClip = findLinkedClip(timelineClips, targetClip);
      const removedClipIds = new Set([targetClip.id, linkedClip?.id].filter(Boolean));

      setTimelineClips((current) =>
        current.filter((clip) => !removedClipIds.has(clip.id))
      );
      setSelectedClipId(undefined);
      setSelectedAssetId(targetClip.assetId);
      setPlayheadSec(clampPlayhead(targetClip.timelineStart, timelineDurationSec));
    },
    [selectedClipId, timelineClips, timelineDurationSec]
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

      setTimelineClips(splitResult.clips);
      setSelectedClipId(splitResult.selectedClipId);
      setSelectedAssetId(splitResult.selectedAssetId);
      setPlayheadSec(clampPlayhead(splitTime, timelineDurationSec));
    },
    [selectedClipId, timelineClips, timelineDurationSec]
  );

  const setPlayhead = useCallback(
    (time: number) => {
      setPlayheadSec(clampPlayhead(time, timelineDurationSec));
    },
    [timelineDurationSec]
  );

  const nudgePlayhead = useCallback(
    (delta: number) => {
      setPlayheadSec((current) => clampPlayhead(current + delta, timelineDurationSec));
    },
    [timelineDurationSec]
  );

  const resolveTimelinePreview = useCallback(
    (time: number) => resolveTimelinePreviewValue(time, timelineClips, assets),
    [assets, timelineClips]
  );

  const value = useMemo<EditorContextValue>(
    () => ({
      assets,
      timelineClips,
      selectedAssetId,
      selectedClipId,
      storyBeats,
      selectedAsset,
      selectedClip,
      activeTimelineAsset,
      activeTimelineClip,
      timelineDurationSec,
      timelineFps,
      playheadSec,
      importFiles,
      importPaths,
      openMediaPicker,
      selectAsset,
      selectClip,
      updateStoryBeat,
      moveStoryBeat,
      addAssetToTimeline,
      moveClip,
      deleteClip,
      splitClip,
      setPlayhead,
      nudgePlayhead,
      resolveTimelinePreview
    }),
    [
      addAssetToTimeline,
      activeTimelineAsset,
      activeTimelineClip,
      assets,
      deleteClip,
      importFiles,
      importPaths,
      moveClip,
      nudgePlayhead,
      openMediaPicker,
      playheadSec,
      resolveTimelinePreview,
      selectAsset,
      selectClip,
      selectedAsset,
      selectedAssetId,
      selectedClip,
      selectedClipId,
      setPlayhead,
      storyBeats,
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

function clampTimelineStart(
  timelineStart: number,
  durationSec: number,
  timelineDurationSec: number
): number {
  return Math.max(
    0,
    Math.min(
      timelineDurationSec - Math.min(durationSec, timelineDurationSec),
      timelineStart
    )
  );
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

function moveLinkedClips(
  clips: EditorTimelineClip[],
  clipId: string,
  timelineStart: number,
  timelineDurationSec: number
): EditorTimelineClip[] {
  const targetClip = clips.find((clip) => clip.id === clipId);
  if (!targetClip) {
    return clips;
  }

  const nextStart = clampTimelineStart(
    timelineStart,
    targetClip.durationSec,
    timelineDurationSec
  );
  const delta = nextStart - targetClip.timelineStart;
  const linkedClipId = targetClip.linkedClipId;

  return clips.map((clip) => {
    if (clip.id === clipId) {
      return {
        ...clip,
        timelineStart: roundTimelineTime(nextStart)
      };
    }

    if (linkedClipId && clip.id === linkedClipId) {
      return {
        ...clip,
        timelineStart: roundTimelineTime(
          clampTimelineStart(
            clip.timelineStart + delta,
            clip.durationSec,
            timelineDurationSec
          )
        )
      };
    }

    return clip;
  });
}

interface SplitTimelineResult {
  clips: EditorTimelineClip[];
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

function createBlankStoryBeat(): EditorStoryBeat {
  return {
    id: `story-${crypto.randomUUID()}`,
    description: "",
    durationSec: DEFAULT_STORY_BEAT_DURATION_SEC
  };
}

function ensureTrailingBlankStoryBeat(beats: EditorStoryBeat[]): EditorStoryBeat[] {
  const nextBeats = beats.length > 0 ? [...beats] : [createBlankStoryBeat()];

  while (
    nextBeats.length > 1 &&
    isBlankStoryBeat(nextBeats[nextBeats.length - 1]) &&
    isBlankStoryBeat(nextBeats[nextBeats.length - 2])
  ) {
    nextBeats.pop();
  }

  if (!isBlankStoryBeat(nextBeats[nextBeats.length - 1])) {
    nextBeats.push(createBlankStoryBeat());
  }

  return nextBeats;
}

function isBlankStoryBeat(beat: EditorStoryBeat): boolean {
  return beat.description.trim().length === 0;
}

function normalizeStoryBeatDuration(durationSec: number): number {
  if (!Number.isFinite(durationSec)) {
    return DEFAULT_STORY_BEAT_DURATION_SEC;
  }

  return Math.max(0.1, Math.round(durationSec * 10) / 10);
}

function getDesktopFilePath(file: File): string | undefined {
  try {
    return desktopApi.media.getPathForFile(file) || undefined;
  } catch {
    return undefined;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
