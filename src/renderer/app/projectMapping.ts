import type { ProjectSession } from "@shared/ipc/contracts";
import {
  createStoryboardAssociation,
  createStoryboardAssociationMetadata,
  createStoryboardAssociationTags,
  type StoryboardAssociation
} from "@shared/storyboardAssociation";
import type { Asset, AssetKind, AssetMetadata } from "@shared/types/asset";
import type { AiGenerationJob } from "@shared/types/ai";
import type { Project } from "@shared/types/project";
import type { StoryboardSegment } from "@shared/types/storyboard";
import type { Clip, Timeline, Track } from "@shared/types/timeline";
import type {
  EditorMediaAsset,
  EditorRgbColor,
  EditorStoryBeat,
  EditorTimelineClip,
  EditorTimelineTrackId
} from "./editorTypes";

const EDITOR_METADATA_KEY = "storyboardAiEditor";
const STORYBOARD_METADATA_KEY = "storyboardAi";
const DEFAULT_STORY_BEAT_DURATION_SEC = 5;

interface StoryboardAssociationBinding {
  association: StoryboardAssociation;
  segment: StoryboardSegment;
}

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
  const existingAssetById = new Map(
    baseProject.assets.map((asset) => [asset.id, asset])
  );
  const editorAssetById = new Map(state.assets.map((asset) => [asset.id, asset]));
  const timelineClipByStoryBeatId = createTimelineClipByStoryBeatId(
    state.timelineClips
  );
  const storyboardSegments = editorStoryBeatsToProjectSegments(
    state.storyBeats,
    baseProject.storyboardSegments,
    timelineClipByStoryBeatId
  );
  const storyboardBindings = createStoryboardAssociationBindings(storyboardSegments);
  const storyboardBindingBySegmentId = new Map(
    storyboardBindings.map((binding) => [binding.segment.id, binding])
  );
  const storyboardBindingByAssetId = new Map(
    storyboardBindings
      .filter((binding) => Boolean(binding.segment.outputAssetId))
      .filter((binding) =>
        shouldApplyStoryboardAssetBinding(
          binding,
          editorAssetById,
          existingAssetById
        )
      )
      .map((binding) => [binding.segment.outputAssetId!, binding])
  );
  const storyboardBindingByJobId = new Map(
    storyboardBindings
      .filter((binding) => Boolean(binding.segment.aiJobId))
      .map((binding) => [binding.segment.aiJobId!, binding])
  );

  return {
    ...baseProject,
    assets: state.assets.map((asset) =>
      editorAssetToProjectAsset(
        asset,
        existingAssetById.get(asset.id),
        storyboardBindingByAssetId.get(asset.id)
      )
    ),
    timeline: editorClipsToProjectTimeline(
      baseProject,
      state,
      storyboardBindingBySegmentId,
      storyboardBindingByAssetId
    ),
    storyboardSegments,
    aiGenerationJobs: baseProject.aiGenerationJobs.map((job) =>
      applyStoryboardJobAssociation(job, storyboardBindingByJobId.get(job.id))
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
    generatedByJobId: asset.generatedByJobId,
    storyboardRef: asset.storyboardRef,
    storyboardSegmentId: asset.storyboardSegmentId,
    storyboardSegmentIndex: asset.storyboardSegmentIndex,
    storyboardSegmentNumber: asset.storyboardSegmentNumber,
    variant: editorMetadata.variant,
    solidColor: editorMetadata.solidColor
  };
};

const editorAssetToProjectAsset = (
  asset: EditorMediaAsset,
  existingAsset: Asset | undefined,
  storyboardBinding: StoryboardAssociationBinding | undefined
): Asset => {
  const metadata = storyboardBinding
    ? applyStoryboardAssetMetadata(
        withEditorAssetMetadata(asset),
        storyboardBinding
      )
    : withEditorAssetMetadata(asset);
  const association = storyboardBinding?.association;

  return {
    ...existingAsset,
    id: asset.id,
    storyboardRef: association?.storyboardRef ?? existingAsset?.storyboardRef,
    storyboardSegmentId: association?.segmentId ?? existingAsset?.storyboardSegmentId,
    storyboardSegmentIndex:
      association?.segmentIndex ?? existingAsset?.storyboardSegmentIndex,
    storyboardSegmentNumber:
      association?.segmentNumber ?? existingAsset?.storyboardSegmentNumber,
    kind: editorAssetKindToProjectKind(asset),
    origin: asset.imported ? "imported" : "generated",
    name: asset.name,
    projectRelativePath: asset.projectRelativePath,
    metadata,
    thumbnailPath: asset.thumbnailProjectRelativePath,
    tags: mergeStoryboardAssociationTags(existingAsset?.tags, association),
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
        trackId: editorTrackIdField(track.id),
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
  state: ProjectSaveState,
  storyboardBindingBySegmentId: Map<string, StoryboardAssociationBinding> =
    new Map(),
  storyboardBindingByAssetId: Map<string, StoryboardAssociationBinding> = new Map()
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
        .map((clip) =>
          editorClipToProjectClip(
            clip,
            storyboardBindingBySegmentId.get(getClipStorySegmentId(clip) ?? "") ??
              storyboardBindingByAssetId.get(clip.assetId)
          )
        )
    })),
    selection: state.selectedClipId
      ? {
          clipIds: [state.selectedClipId]
        }
      : undefined
  };
};

const editorClipToProjectClip = (
  clip: EditorTimelineClip,
  storyboardBinding?: StoryboardAssociationBinding
): Clip => {
  const timelineStart = roundTimelineTime(clip.timelineStart);
  const timelineEnd = roundTimelineTime(clip.timelineStart + clip.durationSec);
  const baseMetadata = clip.linkedClipId
    ? {
        ...(clip.metadata ?? {}),
        linkedClipId: clip.linkedClipId
      }
    : clip.metadata;
  const metadata = storyboardBinding
    ? {
        ...(baseMetadata ?? {}),
        ...createStoryboardAssociationMetadata(storyboardBinding.association),
        storyText: storyboardBinding.segment.text
      }
    : baseMetadata;

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
  existingSegments: StoryboardSegment[],
  timelineClipByStoryBeatId: Map<string, EditorTimelineClip>
): StoryboardSegment[] => {
  const existingById = new Map(
    existingSegments.map((segment) => [segment.id, segment])
  );

  return storyBeats
    .filter((beat) => !isBlankStoryBeat(beat))
    .map((beat, index) => {
      const existingSegment = existingById.get(beat.id);
      const timelineClip = timelineClipByStoryBeatId.get(beat.id);
      const association = createStoryboardAssociation(beat.id, index);
      return {
        ...existingSegment,
        id: beat.id,
        index,
        storyboardRef: association.storyboardRef,
        storyboardNumber: association.segmentNumber,
        text: beat.description.trim(),
        targetDuration: normalizePositiveNumber(
          beat.durationSec,
          DEFAULT_STORY_BEAT_DURATION_SEC
        ),
        status: existingSegment?.status ?? "draft",
        outputAssetId: timelineClip?.assetId ?? existingSegment?.outputAssetId,
        timelineStart: timelineClip?.timelineStart ?? existingSegment?.timelineStart,
        timelineEnd: timelineClip
          ? roundTimelineTime(timelineClip.timelineStart + timelineClip.durationSec)
          : existingSegment?.timelineEnd
      };
    });
};

const createStoryboardAssociationBindings = (
  segments: StoryboardSegment[]
): StoryboardAssociationBinding[] =>
  segments.map((segment) => ({
    association: createStoryboardAssociation(segment.id, segment.index),
    segment
  }));

const createTimelineClipByStoryBeatId = (
  clips: EditorTimelineClip[]
): Map<string, EditorTimelineClip> => {
  const clipsByStoryBeatId = new Map<string, EditorTimelineClip>();

  clips
    .filter((clip) => clip.trackId === "video-1")
    .sort((first, second) => first.timelineStart - second.timelineStart)
    .forEach((clip) => {
      const storySegmentId = getClipStorySegmentId(clip);
      if (storySegmentId && !clipsByStoryBeatId.has(storySegmentId)) {
        clipsByStoryBeatId.set(storySegmentId, clip);
      }
    });

  return clipsByStoryBeatId;
};

const getClipStorySegmentId = (clip: EditorTimelineClip): string | undefined => {
  const storySegmentId = clip.metadata?.storySegmentId;
  return typeof storySegmentId === "string" && storySegmentId.length > 0
    ? storySegmentId
    : undefined;
};

const shouldApplyStoryboardAssetBinding = (
  binding: StoryboardAssociationBinding,
  editorAssetById: Map<string, EditorMediaAsset>,
  existingAssetById: Map<string, Asset>
): boolean => {
  const assetId = binding.segment.outputAssetId;
  if (!assetId) {
    return false;
  }

  const editorAsset = editorAssetById.get(assetId);
  const existingAsset = existingAssetById.get(assetId);
  if (!editorAsset || editorAsset.imported || editorAsset.variant === "solid-color") {
    return false;
  }

  return (
    editorAsset.storyboardSegmentId === binding.segment.id ||
    existingAsset?.storyboardSegmentId === binding.segment.id
  );
};

const applyStoryboardAssetMetadata = (
  metadata: AssetMetadata,
  binding: StoryboardAssociationBinding
): AssetMetadata => {
  const existingStoryboardMetadata = metadata.probe?.[STORYBOARD_METADATA_KEY];
  const existingRecord = isRecord(existingStoryboardMetadata)
    ? existingStoryboardMetadata
    : {};
  const associationMetadata = createStoryboardAssociationMetadata(
    binding.association
  );

  return {
    ...metadata,
    probe: {
      ...(metadata.probe ?? {}),
      [STORYBOARD_METADATA_KEY]: {
        ...existingRecord,
        ...associationMetadata,
        segmentId: binding.segment.id,
        segmentIndex: binding.segment.index,
        segmentNumber: binding.association.segmentNumber,
        text: binding.segment.text,
        jobId: binding.segment.aiJobId,
        outputAssetId: binding.segment.outputAssetId
      }
    }
  };
};

const applyStoryboardJobAssociation = (
  job: AiGenerationJob,
  binding: StoryboardAssociationBinding | undefined
): AiGenerationJob => {
  if (!binding) {
    return job;
  }

  const associationMetadata = createStoryboardAssociationMetadata(
    binding.association
  );

  return {
    ...job,
    storyboardRef: binding.association.storyboardRef,
    storyboardSegmentId: binding.association.segmentId,
    storyboardSegmentIndex: binding.association.segmentIndex,
    storyboardSegmentNumber: binding.association.segmentNumber,
    outputAssetId: binding.segment.outputAssetId ?? job.outputAssetId,
    metadata: {
      ...(job.metadata ?? {}),
      ...associationMetadata,
      storyText: binding.segment.text,
      outputAssetId: binding.segment.outputAssetId ?? job.outputAssetId
    }
  };
};

const mergeStoryboardAssociationTags = (
  tags: string[] | undefined,
  association: StoryboardAssociation | undefined
): string[] | undefined => {
  if (!association) {
    return tags;
  }

  const retainedTags = (tags ?? []).filter((tag) => !isStoryboardAssociationTag(tag));
  const nextTags = [...retainedTags, ...createStoryboardAssociationTags(association)];
  return Array.from(new Set(nextTags));
};

const isStoryboardAssociationTag = (tag: string): boolean => {
  return (
    tag.startsWith("storyboard-ref:") ||
    tag.startsWith("story-segment:") ||
    tag.startsWith("story-index:") ||
    tag.startsWith("story-number:")
  );
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

const editorTrackIdField = (trackId: string): EditorTimelineTrackId => {
  if (
    trackId === "video-1" ||
    trackId === "source-audio-1" ||
    trackId === "voiceover-1" ||
    trackId === "music-1"
  ) {
    return trackId;
  }

  throw new Error(`Invalid project file: unknown timeline track id ${trackId}.`);
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
