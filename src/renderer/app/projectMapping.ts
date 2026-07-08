import type { ProjectSession } from "@shared/ipc/contracts";
import type { Asset, AssetKind, AssetMetadata } from "@shared/types/asset";
import type { Project } from "@shared/types/project";
import type { StoryboardSegment } from "@shared/types/storyboard";
import type { Clip, Timeline, Track, TrackKind } from "@shared/types/timeline";
import type {
  EditorMediaAsset,
  EditorRgbColor,
  EditorStoryBeat,
  EditorTimelineClip,
  EditorTimelineTrackId
} from "./editorTypes";

const EDITOR_METADATA_KEY = "storyboardAiEditor";
const DEFAULT_STORY_BEAT_DURATION_SEC = 5;

export interface EditorProjectState {
  assets: EditorMediaAsset[];
  timelineClips: EditorTimelineClip[];
  storyBeats: EditorStoryBeat[];
  playheadSec: number;
  selectedClipId?: string;
}

export interface ProjectSaveState extends EditorProjectState {
  selectedClipId?: string;
}

export const projectSessionToEditorState = (
  session: ProjectSession
): EditorProjectState => {
  const assetFilesById = new Map(
    session.assetFiles.map((assetFile) => [assetFile.assetId, assetFile])
  );

  return {
    assets: session.project.assets.map((asset) =>
      projectAssetToEditorAsset(asset, assetFilesById.get(asset.id))
    ),
    timelineClips: projectTimelineToEditorClips(session.project.timeline),
    storyBeats: projectSegmentsToStoryBeats(session.project.storyboardSegments),
    playheadSec: session.project.timeline.playhead,
    selectedClipId: session.project.timeline.selection?.clipIds[0]
  };
};

export const editorStateToProject = (
  baseProject: Project,
  state: ProjectSaveState
): Project => {
  return {
    ...baseProject,
    assets: state.assets.map(editorAssetToProjectAsset),
    timeline: editorClipsToProjectTimeline(baseProject, state),
    storyboardSegments: editorStoryBeatsToProjectSegments(
      state.storyBeats,
      baseProject.storyboardSegments
    )
  };
};

export const createBlankStoryBeat = (): EditorStoryBeat => ({
  id: `story-${crypto.randomUUID()}`,
  description: "",
  durationSec: DEFAULT_STORY_BEAT_DURATION_SEC
});

export const ensureTrailingBlankStoryBeat = (
  beats: EditorStoryBeat[]
): EditorStoryBeat[] => {
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
};

export const isBlankStoryBeat = (beat: EditorStoryBeat): boolean => {
  return beat.description.trim().length === 0;
};

const projectAssetToEditorAsset = (
  asset: Asset,
  assetFile:
    | {
        absolutePath?: string;
        fileUrl?: string;
        thumbnailPath?: string;
        thumbnailUrl?: string;
      }
    | undefined
): EditorMediaAsset => {
  const editorMetadata = readEditorAssetMetadata(asset.metadata);
  const kind = projectAssetKindToEditorKind(asset.kind);
  const durationSec = normalizePositiveNumber(
    asset.metadata.duration,
    kind === "image" ? 5 : 8
  );

  return {
    id: asset.id,
    name: asset.name,
    kind,
    absolutePath: assetFile?.absolutePath,
    projectRelativePath: asset.projectRelativePath,
    fileUrl: assetFile?.fileUrl,
    thumbnailPath: assetFile?.thumbnailPath,
    thumbnailUrl:
      assetFile?.thumbnailUrl ??
      (kind === "image" ? assetFile?.fileUrl : undefined),
    thumbnailProjectRelativePath: asset.thumbnailPath,
    durationSec,
    width: asset.metadata.width,
    height: asset.metadata.height,
    fps: asset.metadata.fps,
    metadata: asset.metadata,
    imported: asset.origin === "imported",
    importedAt: asset.importedAt,
    variant: editorMetadata.variant,
    solidColor: editorMetadata.solidColor
  };
};

const editorAssetToProjectAsset = (asset: EditorMediaAsset): Asset => {
  const metadata = withEditorAssetMetadata(asset);

  return {
    id: asset.id,
    kind: editorAssetKindToProjectKind(asset),
    origin: asset.imported ? "imported" : "generated",
    name: asset.name,
    projectRelativePath: asset.projectRelativePath,
    metadata,
    thumbnailPath: asset.thumbnailProjectRelativePath,
    importedAt: asset.importedAt ?? new Date().toISOString()
  };
};

const projectTimelineToEditorClips = (
  timeline: Timeline
): EditorTimelineClip[] => {
  return timeline.tracks.flatMap((track) =>
    track.clips.map((clip) => {
      const durationSec = normalizePositiveNumber(
        clip.timelineEnd - clip.timelineStart,
        clip.sourceOut - clip.sourceIn
      );

      return {
        id: clip.id,
        assetId: clip.assetId,
        trackId: normalizeEditorTrackId(track.id, track.kind),
        timelineStart: clip.timelineStart,
        durationSec,
        sourceIn: clip.sourceIn,
        sourceOut: clip.sourceOut,
        linkedClipId: readLinkedClipId(clip),
        metadata: clip.metadata
      };
    })
  );
};

const editorClipsToProjectTimeline = (
  baseProject: Project,
  state: ProjectSaveState
): Timeline => {
  const duration = state.timelineClips.reduce(
    (maxEnd, clip) => Math.max(maxEnd, clip.timelineStart + clip.durationSec),
    0
  );

  return {
    id: baseProject.timeline.id,
    fps: baseProject.settings.fps,
    duration: roundTimelineTime(duration),
    playhead: roundTimelineTime(state.playheadSec),
    tracks: EDITOR_TRACKS.map((track) => ({
      ...track,
      clips: state.timelineClips
        .filter((clip) => clip.trackId === track.id)
        .map(editorClipToProjectClip)
    })),
    selection: state.selectedClipId
      ? {
          clipIds: [state.selectedClipId]
        }
      : undefined
  };
};

const editorClipToProjectClip = (clip: EditorTimelineClip): Clip => {
  const timelineStart = roundTimelineTime(clip.timelineStart);
  const timelineEnd = roundTimelineTime(clip.timelineStart + clip.durationSec);
  const metadata = clip.linkedClipId
    ? {
        ...(clip.metadata ?? {}),
        linkedClipId: clip.linkedClipId
      }
    : clip.metadata;

  return {
    id: clip.id,
    assetId: clip.assetId,
    trackId: clip.trackId,
    sourceIn: roundTimelineTime(clip.sourceIn),
    sourceOut: roundTimelineTime(clip.sourceOut),
    timelineStart,
    timelineEnd,
    speed: 1,
    metadata
  };
};

const projectSegmentsToStoryBeats = (
  segments: StoryboardSegment[]
): EditorStoryBeat[] => {
  const beats = [...segments]
    .sort((first, second) => first.index - second.index)
    .map((segment) => ({
      id: segment.id,
      description: segment.text,
      durationSec: normalizePositiveNumber(
        segment.targetDuration,
        DEFAULT_STORY_BEAT_DURATION_SEC
      )
    }));

  return ensureTrailingBlankStoryBeat(beats);
};

const editorStoryBeatsToProjectSegments = (
  storyBeats: EditorStoryBeat[],
  existingSegments: StoryboardSegment[]
): StoryboardSegment[] => {
  const existingById = new Map(
    existingSegments.map((segment) => [segment.id, segment])
  );

  return storyBeats
    .filter((beat) => !isBlankStoryBeat(beat))
    .map((beat, index) => {
      const existingSegment = existingById.get(beat.id);
      return {
        ...existingSegment,
        id: beat.id,
        index,
        text: beat.description.trim(),
        targetDuration: normalizePositiveNumber(
          beat.durationSec,
          DEFAULT_STORY_BEAT_DURATION_SEC
        ),
        status: existingSegment?.status ?? "draft"
      };
    });
};

const withEditorAssetMetadata = (asset: EditorMediaAsset): AssetMetadata => {
  const probe = {
    ...(asset.metadata?.probe ?? {}),
    [EDITOR_METADATA_KEY]: {
      variant: asset.variant,
      solidColor: asset.solidColor
    }
  };

  return {
    ...(asset.metadata ?? {}),
    duration: asset.durationSec,
    width: asset.width ?? asset.metadata?.width,
    height: asset.height ?? asset.metadata?.height,
    fps: asset.fps ?? asset.metadata?.fps,
    probe
  };
};

const readEditorAssetMetadata = (
  metadata: AssetMetadata
): {
  variant?: string;
  solidColor?: EditorRgbColor;
} => {
  const value = metadata.probe?.[EDITOR_METADATA_KEY];
  if (!isRecord(value)) {
    return {};
  }

  return {
    variant: typeof value.variant === "string" ? value.variant : undefined,
    solidColor: readSolidColor(value.solidColor)
  };
};

const readSolidColor = (value: unknown): EditorRgbColor | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const r = readColorChannel(value.r);
  const g = readColorChannel(value.g);
  const b = readColorChannel(value.b);
  if (r === undefined || g === undefined || b === undefined) {
    return undefined;
  }

  return { r, g, b };
};

const readColorChannel = (value: unknown): number | undefined => {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(255, Math.round(value)))
    : undefined;
};

const readLinkedClipId = (clip: Clip): string | undefined => {
  const linkedClipId = clip.metadata?.linkedClipId;
  return typeof linkedClipId === "string" ? linkedClipId : undefined;
};

const projectAssetKindToEditorKind = (
  kind: AssetKind
): EditorMediaAsset["kind"] => {
  if (kind === "audio") {
    return "audio";
  }

  if (kind === "image" || kind === "generated-image") {
    return "image";
  }

  return "video";
};

const editorAssetKindToProjectKind = (asset: EditorMediaAsset): AssetKind => {
  if (!asset.imported && asset.kind === "video") {
    return "generated-video";
  }

  if (!asset.imported && asset.kind === "image" && asset.variant !== "solid-color") {
    return "generated-image";
  }

  return asset.kind;
};

const normalizeEditorTrackId = (
  trackId: string,
  trackKind: TrackKind
): EditorTimelineTrackId => {
  if (
    trackId === "video-1" ||
    trackId === "source-audio-1" ||
    trackId === "voiceover-1" ||
    trackId === "music-1"
  ) {
    return trackId;
  }

  return trackKind === "video" ? "video-1" : "music-1";
};

const normalizePositiveNumber = (value: unknown, fallback: number): number => {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
};

const roundTimelineTime = (time: number): number => {
  return Math.round(Math.max(0, time) * 1000) / 1000;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const EDITOR_TRACKS: Track[] = [
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
    name: "源音频",
    order: 1,
    clips: [],
    locked: false,
    muted: false,
    visible: true
  },
  {
    id: "voiceover-1",
    kind: "audio",
    name: "旁白",
    order: 2,
    clips: [],
    locked: false,
    muted: false,
    visible: true
  },
  {
    id: "music-1",
    kind: "audio",
    name: "音乐",
    order: 3,
    clips: [],
    locked: false,
    muted: false,
    visible: true
  }
];
