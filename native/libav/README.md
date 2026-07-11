# libav Sidecar

This directory owns the native media process. Electron talks to it over
newline-delimited JSON-RPC on stdio. The contract supports shared-memory lease
descriptors so high-rate frames need not cross Electron IPC as base64.

## Build

Install Go 1.22+ plus development headers for `libavformat`, `libavcodec`,
`libavutil`, `libswscale`, and `libswresample`, then run:

```bash
go build -tags libav -o bin/libav-sidecar ./cmd/libav-sidecar
```

For Electron development, set `LIBAV_SIDECAR_PATH` to the generated binary or
leave it at `native/libav/bin/libav-sidecar` (`.exe` on Windows). `npm run
native:libav` also builds the Electron-version-matched shared-memory bridge at
`native/shared-memory-bridge/bin`. Production packaging copies both native
components into the app resources directory.

## Protocol promises

- Control RPC: `openAsset`, `probe`, `decodeFrame`, session create/seek/play/
  pause, `renderFrame`, `encodeTimeline`, `dispose`, and `shutdown`.
- `decodeFrame` performs `av_seek_frame` keyframe seek followed by codec flush
  and a decode loop. Conversion uses `sws_scale` to RGBA. When the ABI-matched
  Electron bridge is present, frames use a private `0600` memory-mapped lease;
  only the lease descriptor crosses Electron IPC and preload maps it directly
  into a WebGL2 texture upload. Inline/base64 remains the compatibility fallback.
- `renderFrame` keeps the decoder cursor hot while a playback session advances
  normally, and only seeks/flushes for an explicit seek or a large time jump.
  It respects the project's quarter/half/full preview resolution before the
  inline transfer.
- `probe` replaces the current ffprobe-shaped metadata only after its output
  has parity tests. Current `media:*` import/preview/export behavior remains
  untouched.
- Each shared-memory response carries an opaque `leaseId`; preload releases it
  after mapping. The mapping remains valid until its `SharedArrayBuffer` is
  collected, while the renderer's GPU texture owns the uploaded pixels.

The source is intentionally build-tagged. A binary compiled without `libav`
returns `LIBAV_NOT_LINKED`, rather than silently falling back to ffmpeg.
