import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState
} from "react";
import { mediaAssets, timelineAudioClips, timelineVideoClips } from "./mockWorkspace";
import {
  createEditorAssetFromFile,
  createEditorAssetFromImportedFile
} from "./mediaImport";
import type {
  EditorMediaAsset,
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
  timelineDurationSec: number;
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
  addAssetToTimeline(
    assetId: string,
    timelineStart?: number,
    targetTrackId?: EditorTimelineTrackId
  ): void;
  moveClip(clipId: string, timelineStart: number): void;
  setPlayhead(time: number): void;
  nudgePlayhead(delta: number): void;
  resolveTimelinePreview(time: number): TimelinePreviewTarget | undefined;
}

const EditorContext = createContext<EditorContextValue | null>(null);

const initialAssets: EditorMediaAsset[] = mediaAssets.map((asset) => ({
  id: asset.id,
  name: asset.name,
  kind: asset.kind,
  durationSec: asset.duration ? parseDurationText(asset.duration) : asset.kind === "image" ? 5 : 8,
  thumbnailUrl: asset.thumbnail,
  imported: false,
  variant: asset.variant
}));

const initialVideoTrackClips: EditorTimelineClip[] = timelineVideoClips.map((clip, index) => {
  const durationSec = Math.max(
    2,
    Math.round((clip.width / 100) * TIMELINE_BASE_DURATION_SEC * 10) / 10
  );

  return {
    id: `clip-video-${index + 1}`,
    assetId: resolveInitialAssetId(index),
    trackId: "video-1",
    timelineStart: Math.round((clip.left / 100) * TIMELINE_BASE_DURATION_SEC * 10) / 10,
    durationSec,
    sourceIn: 0,
    sourceOut: durationSec
  };
});

const initialSourceAudioClips: EditorTimelineClip[] = initialVideoTrackClips
  .filter((clip) => {
    const asset = initialAssets.find((candidate) => candidate.id === clip.assetId);
    return asset?.kind === "video";
  })
  .map((clip) => ({
    ...clip,
    id: clip.id.replace("clip-video", "clip-source-audio"),
    trackId: "source-audio-1",
    linkedClipId: clip.id
  }));

initialVideoTrackClips.forEach((clip) => {
  const linkedClip = initialSourceAudioClips.find((candidate) => candidate.linkedClipId === clip.id);
  if (linkedClip) {
    clip.linkedClipId = linkedClip.id;
  }
});

const initialTimelineClips: EditorTimelineClip[] = [
  ...initialVideoTrackClips,
  ...initialSourceAudioClips,
  ...timelineAudioClips.map((clip, index) => {
    const durationSec = Math.max(
      2,
      Math.round((clip.width / 100) * TIMELINE_BASE_DURATION_SEC * 10) / 10
    );

    return {
      id: `clip-audio-${index + 1}`,
      assetId: index === 0 ? "audio" : "voiceover",
      trackId: index === 0 ? "music-1" : "voiceover-1",
      timelineStart: Math.round((clip.left / 100) * TIMELINE_BASE_DURATION_SEC * 10) / 10,
      durationSec,
      sourceIn: 0,
      sourceOut: durationSec
    };
  })
];

export const EditorProvider = ({ children }: { children: ReactNode }) => {
  const [assets, setAssets] = useState<EditorMediaAsset[]>(initialAssets);
  const [timelineClips, setTimelineClips] =
    useState<EditorTimelineClip[]>(initialTimelineClips);
  const [selectedAssetId, setSelectedAssetId] = useState<string>("shot-01");
  const [selectedClipId, setSelectedClipId] = useState<string>("clip-video-4");
  const [playheadSec, setPlayheadSec] = useState<number>(15.2);

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
        setPlayheadSec(clip.timelineStart);
      }
    },
    [timelineClips]
  );

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
      selectedAsset,
      selectedClip,
      activeTimelineAsset,
      activeTimelineClip,
      timelineDurationSec,
      playheadSec,
      importFiles,
      importPaths,
      openMediaPicker,
      selectAsset,
      selectClip,
      addAssetToTimeline,
      moveClip,
      setPlayhead,
      nudgePlayhead,
      resolveTimelinePreview
    }),
    [
      addAssetToTimeline,
      activeTimelineAsset,
      activeTimelineClip,
      assets,
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
      timelineDurationSec,
      timelineClips
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

function parseDurationText(duration: string): number {
  const parts = duration.split(":").map(Number);
  if (parts.length !== 2 || parts.some(Number.isNaN)) {
    return 8;
  }

  return parts[0] * 60 + parts[1];
}

function resolveInitialAssetId(index: number): string {
  const ids = ["shot-01", "shot-03", "shot-02", "scene", "store", "shot-04", "shot-02"];
  return ids[index] ?? "shot-01";
}

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
        timelineStart: nextStart
      };
    }

    if (linkedClipId && clip.id === linkedClipId) {
      return {
        ...clip,
        timelineStart: clampTimelineStart(
          clip.timelineStart + delta,
          clip.durationSec,
          timelineDurationSec
        )
      };
    }

    return clip;
  });
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
