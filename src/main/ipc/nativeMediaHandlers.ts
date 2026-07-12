import { ipcMain } from "electron";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import type {
  NativeMediaCreatePlaybackSessionRequest,
  NativeMediaDecodeFrameRequest,
  NativeMediaDisposeRequest,
  NativeMediaEncodeTimelineRequest,
  NativeMediaOpenAssetRequest,
  NativeMediaProbeRequest,
  NativeMediaRenderFrameRequest,
  NativeMediaRenderAudioRequest,
  NativeMediaSeekRequest,
  NativeMediaSessionRequest
} from "@shared/ipc/contracts";
import type { AppServices } from "../services/appServices";

export const registerNativeMediaHandlers = (services: AppServices): void => {
  const runtime = services.nativeMediaRuntime;
  ipcMain.handle(IPC_CHANNELS.NATIVE_MEDIA_OPEN_ASSET, (_event, request: NativeMediaOpenAssetRequest) =>
    runtime.openAsset(request.path)
  );
  ipcMain.handle(IPC_CHANNELS.NATIVE_MEDIA_PROBE, (_event, request: NativeMediaProbeRequest) =>
    runtime.probe(request.path)
  );
  ipcMain.handle(IPC_CHANNELS.NATIVE_MEDIA_DECODE_FRAME, (_event, request: NativeMediaDecodeFrameRequest) =>
    runtime.decodeFrame(request.assetId, request.time)
  );
  ipcMain.handle(
    IPC_CHANNELS.NATIVE_MEDIA_CREATE_PLAYBACK_SESSION,
    (_event, request: NativeMediaCreatePlaybackSessionRequest) =>
      runtime.createPlaybackSession(request.timeline)
  );
  ipcMain.handle(IPC_CHANNELS.NATIVE_MEDIA_SEEK, (_event, request: NativeMediaSeekRequest) =>
    runtime.seek(request.sessionId, request.time)
  );
  ipcMain.handle(IPC_CHANNELS.NATIVE_MEDIA_PLAY, (_event, request: NativeMediaSessionRequest) =>
    runtime.play(request.sessionId)
  );
  ipcMain.handle(IPC_CHANNELS.NATIVE_MEDIA_PAUSE, (_event, request: NativeMediaSessionRequest) =>
    runtime.pause(request.sessionId)
  );
  ipcMain.handle(
    IPC_CHANNELS.NATIVE_MEDIA_RENDER_FRAME,
    (_event, request: NativeMediaRenderFrameRequest) =>
      runtime.renderFrame(request.sessionId, request.timelineTime)
  );
  ipcMain.handle(
    IPC_CHANNELS.NATIVE_MEDIA_RENDER_AUDIO,
    (_event, request: NativeMediaRenderAudioRequest) =>
      runtime.renderAudio(request.sessionId, request.timelineTime, request.duration)
  );
  ipcMain.handle(
    IPC_CHANNELS.NATIVE_MEDIA_ENCODE_TIMELINE,
    (_event, request: NativeMediaEncodeTimelineRequest) =>
      runtime.encodeTimeline(request.project, request.outputPath, request.settings)
  );
  ipcMain.handle(IPC_CHANNELS.NATIVE_MEDIA_DISPOSE, (_event, request: NativeMediaDisposeRequest) =>
    runtime.dispose(request.targetId)
  );
};
