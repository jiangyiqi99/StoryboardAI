# libav Sidecar

This directory owns the native media process. Electron talks to it over
newline-delimited JSON-RPC on stdio. Preview uses a portable inline transport:
frames are uploaded by WebGL in the renderer and audio is scheduled by Web Audio.

## Build

Install Go 1.22+ plus development headers for `libavformat`, `libavcodec`,
`libavutil`, `libswscale`, and `libswresample`, then run:

```bash
go build -tags libav -o bin/libav-sidecar ./cmd/libav-sidecar
```

Build the sidecar on the target operating system and architecture; cgo links
against that machine's FFmpeg SDK and cannot turn a macOS binary into a Windows
or Linux binary. On Linux install `pkg-config`, `libavformat-dev`,
`libavcodec-dev`, `libavutil-dev`, `libswscale-dev`, and `libswresample-dev`.
On Windows, run the build from an MSYS2 MinGW shell with the matching
`mingw-w64-*-ffmpeg` and `mingw-w64-*-pkgconf` packages installed.
The audio resampler has compile-time branches for FFmpeg 4.4's legacy channel
layout API and FFmpeg 5+ `AVChannelLayout`, so both common Linux LTS and newer
MSYS2/Homebrew SDKs are supported.

For Electron development, set `LIBAV_SIDECAR_PATH` to the generated binary or
leave it at `native/libav/bin/libav-sidecar` (`.exe` on Windows). Production
packaging copies the binary into app resources together with its recursively
resolved FFmpeg runtime dependencies in `native/libav/runtime`. The staging
script rewrites macOS and Linux library search paths; the Electron main process
adds the bundled runtime directory to the sidecar environment on Windows and
Linux.

The FFmpeg packages used by this project are GPL builds. A binary release must
also provide the exact corresponding FFmpeg source, its build configuration,
and this project's complete corresponding source under GPLv3.

## Protocol promises

- Control RPC: `openAsset`, `probe`, `decodeFrame`, session create/seek/play/
  pause, `renderFrame`, `renderAudio`, `encodeTimeline`, `dispose`, and `shutdown`.
- `decodeFrame` performs `av_seek_frame` keyframe seek followed by codec flush
  and a decode loop. Conversion uses `sws_scale` to RGBA; renderer WebGL uploads
  the resulting inline RGBA pixels.
- `renderFrame` keeps the decoder cursor hot while a playback session advances
  normally, and only seeks/flushes for an explicit seek or a large time jump.
  It respects the project's quarter/half/full preview resolution before the
  inline transfer.
- `renderAudio` opens an independent audio demuxer/decoder for each active
  timeline asset, uses `swr_convert` to mix project-rate PCM, and returns
  short `s16le` batches for Web Audio scheduling. Audio packet reads therefore
  cannot disturb the hot video decoder cursor.
- `probe` replaces the current ffprobe-shaped metadata only after its output
  has parity tests. Current `media:*` import/preview/export behavior remains
  untouched.

The source is intentionally build-tagged. A binary compiled without `libav`
returns `LIBAV_NOT_LINKED`, rather than silently falling back to ffmpeg.
