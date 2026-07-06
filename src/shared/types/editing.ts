import type { Clip, ClipId, TimelineRange, TrackId } from "./timeline";

export type EditCommandType =
  | "ADD_CLIP"
  | "REMOVE_CLIP"
  | "SPLIT_CLIP"
  | "TRIM_CLIP"
  | "MOVE_CLIP"
  | "REPLACE_RANGE";

export interface EditCommandBase<TType extends EditCommandType> {
  id: string;
  type: TType;
  createdAt: string;
  label?: string;
}

export interface AddClipCommand extends EditCommandBase<"ADD_CLIP"> {
  clip: Clip;
  trackId: TrackId;
}

export interface RemoveClipCommand extends EditCommandBase<"REMOVE_CLIP"> {
  clipId: ClipId;
  trackId: TrackId;
}

export interface SplitClipCommand extends EditCommandBase<"SPLIT_CLIP"> {
  clipId: ClipId;
  splitTime: number;
}

export interface TrimClipCommand extends EditCommandBase<"TRIM_CLIP"> {
  clipId: ClipId;
  sourceIn: number;
  sourceOut: number;
  timelineStart: number;
  timelineEnd: number;
}

export interface MoveClipCommand extends EditCommandBase<"MOVE_CLIP"> {
  clipId: ClipId;
  fromTrackId: TrackId;
  toTrackId: TrackId;
  timelineStart: number;
}

export interface ReplaceRangeCommand extends EditCommandBase<"REPLACE_RANGE"> {
  range: TimelineRange;
  trackId: TrackId;
  generatedAssetId: string;
  affectedClipIds: ClipId[];
}

export type EditCommand =
  | AddClipCommand
  | RemoveClipCommand
  | SplitClipCommand
  | TrimClipCommand
  | MoveClipCommand
  | ReplaceRangeCommand;

export interface EditCommandExecutor {
  execute(command: EditCommand): Promise<void>;
  undo(command: EditCommand): Promise<void>;
}
