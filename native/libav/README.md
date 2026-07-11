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
place it at `native/bin/libav-sidecar` (`.exe` on Windows). Production
packaging must copy the same binary and its dynamically linked libraries to
the app resources directory.

## Protocol promises

- Control RPC: `openAsset`, `probe`, `decodeFrame`, session create/seek/play/
  pause, `renderFrame`, `encodeTimeline`, `dispose`, and `shutdown`.
- `decodeFrame` performs `av_seek_frame` keyframe seek followed by codec flush
  and a decode loop. Conversion uses `sws_scale` to RGBA. The initial native
  decoder returns the documented `inline` transport for functional parity;
  platform shared-memory allocation/mapping is the next data-plane step.
- `probe` replaces the current ffprobe-shaped metadata only after its output
  has parity tests. Current `media:*` import/preview/export behavior remains
  untouched.
- Each future shared-memory response will carry an opaque `leaseId`; the host
  must invoke `dispose` after the renderer has consumed it. A native bridge
  will map that lease into `SharedArrayBuffer`; Canvas/WebGL integration is not
  switched on by this change.

The source is intentionally build-tagged. A binary compiled without `libav`
returns `LIBAV_NOT_LINKED`, rather than silently falling back to ffmpeg.
