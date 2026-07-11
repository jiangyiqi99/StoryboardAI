//go:build libav

package main

/*
#cgo pkg-config: libavformat libavcodec libavutil libswscale libswresample
#include <stdlib.h>
#include <stdint.h>
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavutil/error.h>
#include <libavutil/channel_layout.h>
#include <libavutil/imgutils.h>
#include <libavutil/pixfmt.h>
#include <libavutil/samplefmt.h>
#include <libavutil/version.h>
#include <libswscale/swscale.h>
#include <libswresample/swresample.h>

static AVStream* media_stream(AVFormatContext *ctx, int index) { return ctx->streams[index]; }
static int media_stream_type(AVStream *stream) { return stream->codecpar->codec_type; }
static int media_stream_codec_id(AVStream *stream) { return stream->codecpar->codec_id; }
static const char* media_stream_codec_name(AVStream *stream) { return avcodec_get_name(stream->codecpar->codec_id); }
static int media_stream_width(AVStream *stream) { return stream->codecpar->width; }
static int media_stream_height(AVStream *stream) { return stream->codecpar->height; }
static int media_stream_sample_rate(AVStream *stream) { return stream->codecpar->sample_rate; }
static int media_copy_parameters(AVCodecContext *codec, AVStream *stream) { return avcodec_parameters_to_context(codec, stream->codecpar); }
static int media_stream_timebase_num(AVStream *stream) { return stream->time_base.num; }
static int media_stream_timebase_den(AVStream *stream) { return stream->time_base.den; }
static int64_t media_stream_duration(AVStream *stream) { return stream->duration; }
static int media_stream_count(AVFormatContext *ctx) { return ctx->nb_streams; }
static const char* media_format_name(AVFormatContext *ctx) { return ctx->iformat ? ctx->iformat->name : ""; }
static int64_t media_format_duration(AVFormatContext *ctx) { return ctx->duration; }
static int64_t media_format_bitrate(AVFormatContext *ctx) { return ctx->bit_rate; }
static int media_packet_stream_index(AVPacket *packet) { return packet->stream_index; }
static int media_frame_width(AVFrame *frame) { return frame->width; }
static int media_frame_height(AVFrame *frame) { return frame->height; }
static int media_frame_format(AVFrame *frame) { return frame->format; }
static int media_frame_linesize0(AVFrame *frame) { return frame->linesize[0]; }
static uint8_t* media_frame_data0(AVFrame *frame) { return frame->data[0]; }
static int media_frame_sample_rate(AVFrame *frame) { return frame->sample_rate; }
static int64_t media_frame_pts(AVFrame *frame) {
  return frame->best_effort_timestamp == AV_NOPTS_VALUE ? frame->pts : frame->best_effort_timestamp;
}
static int media_frame_has_pts(AVFrame *frame) {
  return media_frame_pts(frame) != AV_NOPTS_VALUE;
}
static int media_allocate_rgba_frame(AVFrame *frame, int width, int height) {
  frame->format = AV_PIX_FMT_RGBA;
  frame->width = width;
  frame->height = height;
  return av_frame_get_buffer(frame, 1);
}
static int media_scale_to_rgba(struct SwsContext *sws, AVFrame *input, AVFrame *output) {
  return sws_scale(sws, (const uint8_t * const *)input->data, input->linesize, 0, input->height, output->data, output->linesize);
}
static SwrContext* media_swr_for_f32(AVFrame *input, int output_rate, int output_channels) {
#if LIBAVUTIL_VERSION_MAJOR >= 57
  if (input->sample_rate <= 0 || input->ch_layout.nb_channels <= 0) return NULL;
  AVChannelLayout output_layout;
  av_channel_layout_default(&output_layout, output_channels);
  SwrContext *swr = NULL;
  int code = swr_alloc_set_opts2(
    &swr,
    &output_layout,
    AV_SAMPLE_FMT_FLT,
    output_rate,
    &input->ch_layout,
    (enum AVSampleFormat)input->format,
    input->sample_rate,
    0,
    NULL
  );
  av_channel_layout_uninit(&output_layout);
  if (code < 0) {
    swr_free(&swr);
    return NULL;
  }
  if (swr_init(swr) < 0) {
    swr_free(&swr);
    return NULL;
  }
  return swr;
#else
  if (input->sample_rate <= 0 || input->channels <= 0) return NULL;
  uint64_t input_layout = input->channel_layout;
  if (!input_layout) input_layout = av_get_default_channel_layout(input->channels);
  SwrContext *swr = swr_alloc_set_opts(
    NULL,
    av_get_default_channel_layout(output_channels),
    AV_SAMPLE_FMT_FLT,
    output_rate,
    input_layout,
    (enum AVSampleFormat)input->format,
    input->sample_rate,
    0,
    NULL
  );
  if (!swr || swr_init(swr) < 0) {
    swr_free(&swr);
    return NULL;
  }
  return swr;
#endif
}
static int media_swr_output_capacity(SwrContext *swr, AVFrame *input, int output_rate) {
  int64_t delay = swr_get_delay(swr, input->sample_rate);
  return (int)av_rescale_rnd(delay + input->nb_samples, output_rate, input->sample_rate, AV_ROUND_UP);
}
static int media_allocate_f32_audio_frame(AVFrame *frame, int samples, int sample_rate, int channels) {
  frame->format = AV_SAMPLE_FMT_FLT;
  frame->sample_rate = sample_rate;
  frame->nb_samples = samples;
#if LIBAVUTIL_VERSION_MAJOR >= 57
  av_channel_layout_default(&frame->ch_layout, channels);
#else
  frame->channel_layout = av_get_default_channel_layout(channels);
  frame->channels = channels;
#endif
  return av_frame_get_buffer(frame, 0);
}
static int media_resample_to_f32(SwrContext *swr, AVFrame *input, AVFrame *output) {
  return swr_convert(
    swr,
    output->data,
    output->nb_samples,
    (const uint8_t * const *)input->extended_data,
    input->nb_samples
  );
}
static const char* media_error_string(int errnum) {
  static char buffer[AV_ERROR_MAX_STRING_SIZE];
  av_strerror(errnum, buffer, sizeof(buffer));
  return buffer;
}
static int media_error_again(void) { return AVERROR(EAGAIN); }
static int media_error_eof(void) { return AVERROR_EOF; }
*/
import "C"

import (
	"encoding/base64"
	"fmt"
	"math"
	"sync"
	"unsafe"
)

// libavRuntime owns all AVFormatContext/AVCodecContext pairs. Contexts are
// deliberately confined to this process; Electron sees IDs and inline payloads.
type libavRuntime struct {
	mu       sync.Mutex
	nextID   uint64
	assets   map[string]*nativeAsset
	sessions map[string]*nativePlaybackSession
}

type nativePlaybackSession struct {
	id             string
	timeline       map[string]any
	paths          map[string]string
	assetIDs       map[string]string
	audioAssets    map[string]*nativeAudioAsset
	state          string
	time           float64
	forceSeek      bool
	audioForceSeek bool
}

type nativeAsset struct {
	id          string
	path        string
	format      *C.AVFormatContext
	videoCodec  *C.AVCodecContext
	videoStream int
	hasDecoded  bool
	lastPTS     int64
}

// Audio owns a separate demuxer and codec context from video. Reading packets
// from one AVFormatContext for both consumers would make preview video and
// Web Audio steal each other's cursor.
type nativeAudioAsset struct {
	path             string
	format           *C.AVFormatContext
	codec            *C.AVCodecContext
	stream           int
	hasDecoded       bool
	nextRequestedEnd float64
	remainder        []float32
	remainderStart   float64
}

func newRuntime() runtime {
	return &libavRuntime{
		assets: map[string]*nativeAsset{}, sessions: map[string]*nativePlaybackSession{},
	}
}

func (r *libavRuntime) Call(method string, params map[string]any) (any, *rpcError) {
	r.mu.Lock()
	defer r.mu.Unlock()

	switch method {
	case "openAsset":
		path, err := stringParam(params, "path")
		if err != nil {
			return nil, err
		}
		asset, callErr := r.open(path)
		if callErr != nil {
			return nil, callErr
		}
		probe := r.probeFor(asset.path, asset.format)
		return map[string]any{"id": asset.id, "path": asset.path, "probe": probe}, nil
	case "probe":
		path, err := stringParam(params, "path")
		if err != nil {
			return nil, err
		}
		return r.probePath(path)
	case "decodeFrame":
		assetID, err := stringParam(params, "assetId")
		if err != nil {
			return nil, err
		}
		time, err := numberParam(params, "time")
		if err != nil {
			return nil, err
		}
		asset := r.assets[assetID]
		if asset == nil {
			return nil, notFound("asset", assetID)
		}
		return r.decodeRGBA(asset, time, true, 0, 0)
	case "createPlaybackSession":
		timeline, ok := params["timeline"].(map[string]any)
		if !ok {
			return nil, invalid("timeline is required")
		}
		id := r.identifier("session")
		session := &nativePlaybackSession{
			id: id, timeline: timeline, paths: stringMap(timeline["assetPaths"]),
			assetIDs: map[string]string{}, audioAssets: map[string]*nativeAudioAsset{}, state: "paused", time: 0, forceSeek: true, audioForceSeek: true,
		}
		r.sessions[id] = session
		return session.result(), nil
	case "seek", "play", "pause":
		id, err := stringParam(params, "sessionId")
		if err != nil {
			return nil, err
		}
		session := r.sessions[id]
		if session == nil {
			return nil, notFound("session", id)
		}
		if method == "seek" {
			time, timeErr := numberParam(params, "time")
			if timeErr != nil {
				return nil, timeErr
			}
			session.time = math.Max(0, time)
			session.forceSeek = true
			session.audioForceSeek = true
		}
		if method == "play" {
			session.state = "playing"
		}
		if method == "pause" {
			session.state = "paused"
		}
		return session.result(), nil
	case "renderFrame":
		id, err := stringParam(params, "sessionId")
		if err != nil {
			return nil, err
		}
		time, err := numberParam(params, "timelineTime")
		if err != nil {
			return nil, err
		}
		session := r.sessions[id]
		if session == nil {
			return nil, notFound("session", id)
		}
		session.time = math.Max(0, time)
		return r.renderFrame(session)
	case "renderAudio":
		id, err := stringParam(params, "sessionId")
		if err != nil {
			return nil, err
		}
		time, err := numberParam(params, "timelineTime")
		if err != nil {
			return nil, err
		}
		duration, err := numberParam(params, "duration")
		if err != nil {
			return nil, err
		}
		session := r.sessions[id]
		if session == nil {
			return nil, notFound("session", id)
		}
		return r.renderAudio(session, math.Max(0, time), duration)
	case "encodeTimeline":
		return nil, &rpcError{Code: "TIMELINE_ENCODER_NOT_READY", Message: "Timeline encoding is not implemented in the initial decode sidecar."}
	case "dispose":
		id, err := stringParam(params, "targetId")
		if err != nil {
			return nil, err
		}
		if asset := r.assets[id]; asset != nil {
			asset.close()
			delete(r.assets, id)
		}
		if session := r.sessions[id]; session != nil {
			r.disposeSession(session)
			delete(r.sessions, id)
		}
		return map[string]any{}, nil
	case "shutdown":
		return map[string]any{}, nil
	default:
		return nil, &rpcError{Code: "UNKNOWN_METHOD", Message: fmt.Sprintf("Unsupported method: %s", method)}
	}
}

func (r *libavRuntime) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, session := range r.sessions {
		r.disposeSession(session)
	}
	for _, asset := range r.assets {
		asset.close()
	}
	r.assets = map[string]*nativeAsset{}
	r.sessions = map[string]*nativePlaybackSession{}
}

func (r *libavRuntime) renderFrame(session *nativePlaybackSession) (any, *rpcError) {
	clip, err := activeVideoClip(session.timeline, session.time)
	if err != nil {
		return nil, err
	}
	assetID, ok := clip["assetId"].(string)
	if !ok || assetID == "" {
		return nil, invalid("active video clip has no assetId")
	}
	asset, err := r.assetForSession(session, assetID)
	if err != nil {
		return nil, err
	}
	sourceTime := sourceTimeForClip(clip, session.time)
	width, height := previewFrameSize(session.timeline)
	frame, decodeErr := r.decodeRGBA(asset, sourceTime, session.forceSeek, width, height)
	if decodeErr != nil {
		return nil, decodeErr
	}
	session.forceSeek = false
	if frameData, ok := frame.(map[string]any); ok {
		frameData["opacity"] = numberOr(clip["opacity"], 1)
	}
	return frame, nil
}

func (r *libavRuntime) renderAudio(session *nativePlaybackSession, timelineTime, duration float64) (any, *rpcError) {
	if duration <= 0 || math.IsNaN(duration) {
		return nil, invalid("duration must be a positive number")
	}
	duration = math.Min(duration, 2)
	sampleRate := previewAudioSampleRate(session.timeline)
	channels := 2
	frames := int(math.Ceil(duration * float64(sampleRate)))
	if frames <= 0 {
		return nil, invalid("duration is too short to produce an audio buffer")
	}
	mix := make([]float32, frames*channels)
	for _, clip := range activeAudioClips(session.timeline, timelineTime, timelineTime+duration) {
		assetID, ok := clip["assetId"].(string)
		if !ok || assetID == "" {
			continue
		}
		asset, assetErr := r.audioAssetForSession(session, assetID)
		if assetErr != nil {
			// Some imported videos legitimately have no audio stream. Silent
			// source-audio clips must not make the video preview fail.
			continue
		}
		clipStart := numberOr(clip["timelineStart"], 0)
		clipEnd := numberOr(clip["timelineEnd"], clipStart)
		overlapStart := math.Max(timelineTime, clipStart)
		overlapEnd := math.Min(timelineTime+duration, clipEnd)
		if overlapEnd <= overlapStart {
			continue
		}
		speed := numberOr(clip["speed"], 1)
		if speed <= 0 {
			speed = 1
		}
		sourceSamples, decodeErr := decodeAudioF32(
			asset,
			sourceTimeForClip(clip, overlapStart),
			(overlapEnd-overlapStart)*speed,
			sampleRate,
			channels,
			session.audioForceSeek,
		)
		if decodeErr != nil {
			continue
		}
		session.audioForceSeek = false
		destinationFrames := int(math.Round((overlapEnd - overlapStart) * float64(sampleRate)))
		destinationOffset := int(math.Round((overlapStart - timelineTime) * float64(sampleRate)))
		mixAudioSamples(mix, sourceSamples, destinationOffset, destinationFrames, channels)
	}
	return map[string]any{
		"format": "s16le", "sampleRate": sampleRate, "channels": channels, "frames": frames,
		"pts":      int64(math.Round(timelineTime * float64(sampleRate))),
		"timebase": map[string]any{"numerator": 1, "denominator": sampleRate},
		"duration": float64(frames) / float64(sampleRate),
		"data": map[string]any{
			"kind": "inline", "encoding": "base64", "data": base64.StdEncoding.EncodeToString(pcmS16Bytes(mix)), "byteLength": len(mix) * 2,
		},
	}, nil
}

func (r *libavRuntime) assetForSession(session *nativePlaybackSession, assetID string) (*nativeAsset, *rpcError) {
	if nativeID := session.assetIDs[assetID]; nativeID != "" {
		if asset := r.assets[nativeID]; asset != nil {
			return asset, nil
		}
	}
	path := session.paths[assetID]
	if path == "" {
		return nil, &rpcError{Code: "ASSET_PATH_MISSING", Message: "No local path was provided for timeline asset: " + assetID}
	}
	asset, err := r.open(path)
	if err != nil {
		return nil, err
	}
	session.assetIDs[assetID] = asset.id
	return asset, nil
}

func (r *libavRuntime) audioAssetForSession(session *nativePlaybackSession, assetID string) (*nativeAudioAsset, *rpcError) {
	if asset := session.audioAssets[assetID]; asset != nil {
		return asset, nil
	}
	path := session.paths[assetID]
	if path == "" {
		return nil, &rpcError{Code: "ASSET_PATH_MISSING", Message: "No local path was provided for timeline audio asset: " + assetID}
	}
	asset, err := r.openAudio(path)
	if err != nil {
		return nil, err
	}
	session.audioAssets[assetID] = asset
	return asset, nil
}

func (r *libavRuntime) disposeSession(session *nativePlaybackSession) {
	for _, nativeID := range session.assetIDs {
		if asset := r.assets[nativeID]; asset != nil {
			asset.close()
			delete(r.assets, nativeID)
		}
	}
	for _, asset := range session.audioAssets {
		asset.close()
	}
	session.audioAssets = map[string]*nativeAudioAsset{}
}

func (session *nativePlaybackSession) result() map[string]any {
	return map[string]any{"id": session.id, "timeline": session.timeline, "state": session.state, "time": session.time}
}

func (r *libavRuntime) open(path string) (*nativeAsset, *rpcError) {
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))
	var format *C.AVFormatContext
	if code := C.avformat_open_input(&format, cPath, nil, nil); code < 0 {
		return nil, libavError("avformat_open_input", code)
	}
	if code := C.avformat_find_stream_info(format, nil); code < 0 {
		C.avformat_close_input(&format)
		return nil, libavError("avformat_find_stream_info", code)
	}
	streamIndex := C.av_find_best_stream(format, C.AVMEDIA_TYPE_VIDEO, -1, -1, nil, 0)
	if streamIndex < 0 {
		C.avformat_close_input(&format)
		return nil, libavError("av_find_best_stream(video)", streamIndex)
	}
	stream := C.media_stream(format, streamIndex)
	codec := C.avcodec_find_decoder(C.enum_AVCodecID(C.media_stream_codec_id(stream)))
	if codec == nil {
		C.avformat_close_input(&format)
		return nil, &rpcError{Code: "CODEC_NOT_FOUND", Message: "No libav decoder is available for the selected video stream."}
	}
	codecContext := C.avcodec_alloc_context3(codec)
	if codecContext == nil {
		C.avformat_close_input(&format)
		return nil, &rpcError{Code: "ALLOCATION_FAILED", Message: "avcodec_alloc_context3 returned nil."}
	}
	if code := C.media_copy_parameters(codecContext, stream); code < 0 {
		C.avcodec_free_context(&codecContext)
		C.avformat_close_input(&format)
		return nil, libavError("avcodec_parameters_to_context", code)
	}
	if code := C.avcodec_open2(codecContext, codec, nil); code < 0 {
		C.avcodec_free_context(&codecContext)
		C.avformat_close_input(&format)
		return nil, libavError("avcodec_open2", code)
	}
	asset := &nativeAsset{id: r.identifier("asset"), path: path, format: format, videoCodec: codecContext, videoStream: int(streamIndex)}
	r.assets[asset.id] = asset
	return asset, nil
}

func (r *libavRuntime) openAudio(path string) (*nativeAudioAsset, *rpcError) {
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))
	var format *C.AVFormatContext
	if code := C.avformat_open_input(&format, cPath, nil, nil); code < 0 {
		return nil, libavError("avformat_open_input", code)
	}
	if code := C.avformat_find_stream_info(format, nil); code < 0 {
		C.avformat_close_input(&format)
		return nil, libavError("avformat_find_stream_info", code)
	}
	streamIndex := C.av_find_best_stream(format, C.AVMEDIA_TYPE_AUDIO, -1, -1, nil, 0)
	if streamIndex < 0 {
		C.avformat_close_input(&format)
		return nil, &rpcError{Code: "AUDIO_STREAM_NOT_FOUND", Message: "No audio stream exists in this timeline asset."}
	}
	stream := C.media_stream(format, streamIndex)
	codec := C.avcodec_find_decoder(C.enum_AVCodecID(C.media_stream_codec_id(stream)))
	if codec == nil {
		C.avformat_close_input(&format)
		return nil, &rpcError{Code: "AUDIO_CODEC_NOT_FOUND", Message: "No libav decoder is available for the selected audio stream."}
	}
	codecContext := C.avcodec_alloc_context3(codec)
	if codecContext == nil {
		C.avformat_close_input(&format)
		return nil, &rpcError{Code: "ALLOCATION_FAILED", Message: "avcodec_alloc_context3 returned nil for audio."}
	}
	if code := C.media_copy_parameters(codecContext, stream); code < 0 {
		C.avcodec_free_context(&codecContext)
		C.avformat_close_input(&format)
		return nil, libavError("avcodec_parameters_to_context(audio)", code)
	}
	if code := C.avcodec_open2(codecContext, codec, nil); code < 0 {
		C.avcodec_free_context(&codecContext)
		C.avformat_close_input(&format)
		return nil, libavError("avcodec_open2(audio)", code)
	}
	return &nativeAudioAsset{path: path, format: format, codec: codecContext, stream: int(streamIndex)}, nil
}

func (r *libavRuntime) probePath(path string) (any, *rpcError) {
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))
	var format *C.AVFormatContext
	if code := C.avformat_open_input(&format, cPath, nil, nil); code < 0 {
		return nil, libavError("avformat_open_input", code)
	}
	defer C.avformat_close_input(&format)
	if code := C.avformat_find_stream_info(format, nil); code < 0 {
		return nil, libavError("avformat_find_stream_info", code)
	}
	return r.probeFor(path, format), nil
}

func (r *libavRuntime) probeFor(path string, format *C.AVFormatContext) map[string]any {
	streams := make([]any, 0, int(C.media_stream_count(format)))
	var video, audio map[string]any
	for index := 0; index < int(C.media_stream_count(format)); index++ {
		stream := C.media_stream(format, C.int(index))
		kind := streamKind(C.media_stream_type(stream))
		entry := map[string]any{
			"index": index, "kind": kind, "codec": C.GoString(C.media_stream_codec_name(stream)),
			"timebase": timebase(stream), "duration": seconds(C.media_stream_duration(stream), stream),
		}
		if kind == "video" {
			entry["width"] = int(C.media_stream_width(stream))
			entry["height"] = int(C.media_stream_height(stream))
			video = entry
		}
		if kind == "audio" {
			entry["sampleRate"] = int(C.media_stream_sample_rate(stream))
			audio = entry
		}
		streams = append(streams, entry)
	}
	metadata := map[string]any{"duration": float64(C.media_format_duration(format)) / float64(C.AV_TIME_BASE), "container": C.GoString(C.media_format_name(format)), "hasAudio": audio != nil}
	if video != nil {
		metadata["width"] = video["width"]
		metadata["height"] = video["height"]
		metadata["codec"] = video["codec"]
	}
	if audio != nil {
		metadata["sampleRate"] = audio["sampleRate"]
		if _, ok := metadata["codec"]; !ok {
			metadata["codec"] = audio["codec"]
		}
	}
	return map[string]any{"path": path, "format": C.GoString(C.media_format_name(format)), "duration": metadata["duration"], "bitRate": int64(C.media_format_bitrate(format)), "streams": streams, "assetMetadata": metadata}
}

func (r *libavRuntime) decodeRGBA(asset *nativeAsset, time float64, forceSeek bool, outputWidth, outputHeight int) (any, *rpcError) {
	stream := C.media_stream(asset.format, C.int(asset.videoStream))
	numerator := float64(C.media_stream_timebase_num(stream))
	denominator := float64(C.media_stream_timebase_den(stream))
	if numerator <= 0 || denominator <= 0 {
		return nil, &rpcError{Code: "INVALID_TIMEBASE", Message: "Selected video stream has an invalid timebase."}
	}
	target := C.int64_t(math.Round(math.Max(0, time) * denominator / numerator))
	// Sequential playback must keep the demuxer/decoder cursor hot. Seeking to
	// a keyframe for every RAF tick makes an otherwise tiny time advance decode
	// the entire GOP again. Large jumps still seek to bound catch-up work.
	seekThreshold := int64(math.Ceil(2 * denominator / numerator))
	// The renderer clock is continuous but a decoded frame is quantized to the
	// source FPS, so a following request can be a few ticks behind lastPTS.
	// Explicit seeks always reset; small unforced deltas keep decoding forward.
	shouldSeek := forceSeek || !asset.hasDecoded || int64(target) < asset.lastPTS-seekThreshold || int64(target)-asset.lastPTS > seekThreshold
	if shouldSeek {
		if code := C.av_seek_frame(asset.format, C.int(asset.videoStream), target, C.AVSEEK_FLAG_BACKWARD); code < 0 {
			return nil, libavError("av_seek_frame", code)
		}
		C.avcodec_flush_buffers(asset.videoCodec)
		asset.hasDecoded = false
	}
	packet := C.av_packet_alloc()
	frame := C.av_frame_alloc()
	if packet == nil || frame == nil {
		if packet != nil {
			C.av_packet_free(&packet)
		}
		if frame != nil {
			C.av_frame_free(&frame)
		}
		return nil, &rpcError{Code: "ALLOCATION_FAILED", Message: "Unable to allocate packet/frame for decode."}
	}
	defer C.av_packet_free(&packet)
	defer C.av_frame_free(&frame)
	for {
		code := C.avcodec_receive_frame(asset.videoCodec, frame)
		if code == 0 {
			pts := C.media_frame_pts(frame)
			if pts < target {
				C.av_frame_unref(frame)
				continue
			}
			result, convertErr := r.rgbaFrame(frame, numerator, denominator, outputWidth, outputHeight)
			if convertErr == nil {
				asset.hasDecoded = true
				asset.lastPTS = int64(pts)
			}
			return result, convertErr
		}
		if code != C.media_error_again() && code != C.media_error_eof() {
			return nil, libavError("avcodec_receive_frame", code)
		}
		if code == C.media_error_eof() {
			break
		}
		code = C.av_read_frame(asset.format, packet)
		if code < 0 {
			break
		}
		if C.media_packet_stream_index(packet) != C.int(asset.videoStream) {
			C.av_packet_unref(packet)
			continue
		}
		if code = C.avcodec_send_packet(asset.videoCodec, packet); code < 0 {
			C.av_packet_unref(packet)
			return nil, libavError("avcodec_send_packet", code)
		}
		C.av_packet_unref(packet)
	}
	return nil, &rpcError{Code: "FRAME_NOT_FOUND", Message: "No decoded video frame exists at or after the requested time."}
}

func decodeAudioF32(asset *nativeAudioAsset, time, duration float64, sampleRate, channels int, forceSeek bool) ([]float32, *rpcError) {
	stream := C.media_stream(asset.format, C.int(asset.stream))
	numerator := float64(C.media_stream_timebase_num(stream))
	denominator := float64(C.media_stream_timebase_den(stream))
	if numerator <= 0 || denominator <= 0 {
		return nil, &rpcError{Code: "INVALID_TIMEBASE", Message: "Selected audio stream has an invalid timebase."}
	}
	targetFrames := int(math.Ceil(duration * float64(sampleRate)))
	if targetFrames <= 0 {
		return []float32{}, nil
	}
	shouldSeek := forceSeek || !asset.hasDecoded || math.Abs(time-asset.nextRequestedEnd) > 0.04
	if shouldSeek {
		target := C.int64_t(math.Round(math.Max(0, time) * denominator / numerator))
		if code := C.av_seek_frame(asset.format, C.int(asset.stream), target, C.AVSEEK_FLAG_BACKWARD); code < 0 {
			return nil, libavError("av_seek_frame(audio)", code)
		}
		C.avcodec_flush_buffers(asset.codec)
		asset.remainder = nil
		asset.remainderStart = 0
	}

	result := make([]float32, targetFrames*channels)
	writtenFrames := 0
	if !shouldSeek && len(asset.remainder) > 0 {
		remainderFrames := len(asset.remainder) / channels
		remainderEnd := asset.remainderStart + float64(remainderFrames)/float64(sampleRate)
		if time >= asset.remainderStart-0.001 && time < remainderEnd {
			offset := int(math.Round(math.Max(0, time-asset.remainderStart) * float64(sampleRate)))
			available := remainderFrames - offset
			writtenFrames = minInt(targetFrames, available)
			copy(result, asset.remainder[offset*channels:(offset+writtenFrames)*channels])
			remainingOffset := offset + writtenFrames
			if remainingOffset < remainderFrames {
				asset.remainder = append([]float32(nil), asset.remainder[remainingOffset*channels:]...)
				asset.remainderStart += float64(remainingOffset) / float64(sampleRate)
			} else {
				asset.remainder = nil
			}
		} else if time >= remainderEnd {
			asset.remainder = nil
		}
	}

	packet := C.av_packet_alloc()
	frame := C.av_frame_alloc()
	if packet == nil || frame == nil {
		if packet != nil {
			C.av_packet_free(&packet)
		}
		if frame != nil {
			C.av_frame_free(&frame)
		}
		return nil, &rpcError{Code: "ALLOCATION_FAILED", Message: "Unable to allocate packet/frame for audio decode."}
	}
	defer C.av_packet_free(&packet)
	defer C.av_frame_free(&frame)

	for writtenFrames < targetFrames {
		code := C.avcodec_receive_frame(asset.codec, frame)
		if code == 0 {
			frameSampleRate := int(C.media_frame_sample_rate(frame))
			if frameSampleRate <= 0 {
				C.av_frame_unref(frame)
				continue
			}
			frameStart := float64(C.media_frame_pts(frame)) * numerator / denominator
			if C.media_frame_has_pts(frame) == 0 || math.IsNaN(frameStart) || math.IsInf(frameStart, 0) {
				frameStart = time + float64(writtenFrames)/float64(sampleRate)
			}
			values, convertErr := resampleFrameToF32(frame, sampleRate, channels)
			C.av_frame_unref(frame)
			if convertErr != nil {
				return nil, convertErr
			}
			frameCount := len(values) / channels
			if frameCount == 0 {
				continue
			}
			expectedTime := time + float64(writtenFrames)/float64(sampleRate)
			if frameStart > expectedTime+0.001 {
				writtenFrames = minInt(targetFrames, int(math.Round((frameStart-time)*float64(sampleRate))))
			}
			sourceOffset := int(math.Round(math.Max(0, expectedTime-frameStart) * float64(sampleRate)))
			if sourceOffset >= frameCount {
				continue
			}
			copyFrames := minInt(targetFrames-writtenFrames, frameCount-sourceOffset)
			copy(
				result[writtenFrames*channels:(writtenFrames+copyFrames)*channels],
				values[sourceOffset*channels:(sourceOffset+copyFrames)*channels],
			)
			writtenFrames += copyFrames
			if sourceOffset+copyFrames < frameCount {
				asset.remainder = append([]float32(nil), values[(sourceOffset+copyFrames)*channels:]...)
				asset.remainderStart = frameStart + float64(sourceOffset+copyFrames)/float64(sampleRate)
			}
			continue
		}
		if code != C.media_error_again() && code != C.media_error_eof() {
			return nil, libavError("avcodec_receive_frame(audio)", code)
		}
		if code == C.media_error_eof() {
			break
		}
		code = C.av_read_frame(asset.format, packet)
		if code < 0 {
			break
		}
		if C.media_packet_stream_index(packet) != C.int(asset.stream) {
			C.av_packet_unref(packet)
			continue
		}
		if code = C.avcodec_send_packet(asset.codec, packet); code < 0 {
			C.av_packet_unref(packet)
			return nil, libavError("avcodec_send_packet(audio)", code)
		}
		C.av_packet_unref(packet)
	}
	asset.hasDecoded = true
	asset.nextRequestedEnd = time + duration
	return result, nil
}

func resampleFrameToF32(input *C.AVFrame, sampleRate, channels int) ([]float32, *rpcError) {
	swr := C.media_swr_for_f32(input, C.int(sampleRate), C.int(channels))
	if swr == nil {
		return nil, &rpcError{Code: "SWR_CONTEXT_FAILED", Message: "Unable to configure the libav audio resampler."}
	}
	defer C.swr_free(&swr)
	capacity := C.media_swr_output_capacity(swr, input, C.int(sampleRate))
	if capacity <= 0 {
		return []float32{}, nil
	}
	output := C.av_frame_alloc()
	if output == nil {
		return nil, &rpcError{Code: "ALLOCATION_FAILED", Message: "Unable to allocate resampled audio frame."}
	}
	defer C.av_frame_free(&output)
	if code := C.media_allocate_f32_audio_frame(output, capacity, C.int(sampleRate), C.int(channels)); code < 0 {
		return nil, libavError("av_frame_get_buffer(audio)", code)
	}
	converted := C.media_resample_to_f32(swr, input, output)
	if converted < 0 {
		return nil, libavError("swr_convert", converted)
	}
	if converted == 0 {
		return []float32{}, nil
	}
	bytes := C.GoBytes(unsafe.Pointer(C.media_frame_data0(output)), C.int(converted*C.int(channels)*4))
	values := append([]float32(nil), unsafe.Slice((*float32)(unsafe.Pointer(&bytes[0])), int(converted)*channels)...)
	return values, nil
}

func (r *libavRuntime) rgbaFrame(input *C.AVFrame, numerator, denominator float64, outputWidth, outputHeight int) (any, *rpcError) {
	width, height := C.media_frame_width(input), C.media_frame_height(input)
	if outputWidth <= 0 || outputHeight <= 0 {
		outputWidth, outputHeight = int(width), int(height)
	}
	scaledWidth, scaledHeight := C.int(outputWidth), C.int(outputHeight)
	sws := C.sws_getContext(width, height, C.enum_AVPixelFormat(C.media_frame_format(input)), scaledWidth, scaledHeight, C.AV_PIX_FMT_RGBA, C.SWS_BILINEAR, nil, nil, nil)
	if sws == nil {
		return nil, &rpcError{Code: "SWS_CONTEXT_FAILED", Message: "sws_getContext returned nil."}
	}
	defer C.sws_freeContext(sws)
	output := C.av_frame_alloc()
	if output == nil {
		return nil, &rpcError{Code: "ALLOCATION_FAILED", Message: "Unable to allocate converted frame."}
	}
	defer C.av_frame_free(&output)
	if code := C.media_allocate_rgba_frame(output, scaledWidth, scaledHeight); code < 0 {
		return nil, libavError("av_frame_get_buffer", code)
	}
	if C.media_scale_to_rgba(sws, input, output) <= 0 {
		return nil, &rpcError{Code: "SWS_SCALE_FAILED", Message: "sws_scale did not produce an RGBA frame."}
	}
	stride := C.media_frame_linesize0(output)
	byteLength := int(stride * scaledHeight)
	pts := C.media_frame_pts(input)
	bytes := C.GoBytes(unsafe.Pointer(C.media_frame_data0(output)), C.int(byteLength))
	return map[string]any{
		"format": "rgba", "width": int(scaledWidth), "height": int(scaledHeight), "stride": int(stride),
		"planes": []any{map[string]any{"offset": 0, "byteLength": byteLength, "stride": int(stride)}},
		"pts":    int64(pts), "timebase": map[string]any{"numerator": numerator, "denominator": denominator},
		"duration": 0, "colorSpace": "unknown", "opacity": 1, "hasAlpha": true,
		"data": map[string]any{
			"kind": "inline", "encoding": "base64", "data": base64.StdEncoding.EncodeToString(bytes), "byteLength": byteLength,
		},
	}, nil
}

func (asset *nativeAsset) close() {
	if asset.videoCodec != nil {
		C.avcodec_free_context(&asset.videoCodec)
	}
	if asset.format != nil {
		C.avformat_close_input(&asset.format)
	}
}

func (asset *nativeAudioAsset) close() {
	if asset.codec != nil {
		C.avcodec_free_context(&asset.codec)
	}
	if asset.format != nil {
		C.avformat_close_input(&asset.format)
	}
}

func pcmS16Bytes(values []float32) []byte {
	if len(values) == 0 {
		return []byte{}
	}
	bytes := make([]byte, len(values)*2)
	packed := unsafe.Slice((*int16)(unsafe.Pointer(&bytes[0])), len(values))
	for index, value := range values {
		// Mixing may exceed the Web Audio nominal range. Keep the returned PCM
		// bounded so multiple overlapping tracks cannot cause hard clipping.
		value = float32(math.Max(-1, math.Min(1, float64(value))))
		packed[index] = int16(math.Round(float64(value) * 32767))
	}
	return bytes
}

func mixAudioSamples(destination, source []float32, destinationOffset, destinationFrames, channels int) {
	if channels <= 0 || destinationFrames <= 0 || len(source) < channels {
		return
	}
	sourceFrames := len(source) / channels
	for frame := 0; frame < destinationFrames; frame++ {
		destinationFrame := destinationOffset + frame
		if destinationFrame < 0 || (destinationFrame+1)*channels > len(destination) {
			break
		}
		position := float64(frame) * float64(sourceFrames) / float64(destinationFrames)
		left := minInt(sourceFrames-1, int(position))
		right := minInt(sourceFrames-1, left+1)
		fraction := float32(position - float64(left))
		for channel := 0; channel < channels; channel++ {
			first := source[left*channels+channel]
			second := source[right*channels+channel]
			destination[destinationFrame*channels+channel] += first + (second-first)*fraction
		}
	}
}

func (r *libavRuntime) identifier(prefix string) string {
	r.nextID++
	return fmt.Sprintf("%s-%d", prefix, r.nextID)
}
func stringParam(params map[string]any, key string) (string, *rpcError) {
	value, ok := params[key].(string)
	if !ok || value == "" {
		return "", invalid(key + " is required")
	}
	return value, nil
}
func numberParam(params map[string]any, key string) (float64, *rpcError) {
	value, ok := params[key].(float64)
	if !ok || math.IsNaN(value) {
		return 0, invalid(key + " must be a number")
	}
	return value, nil
}
func numberOr(value any, fallback float64) float64 {
	number, ok := value.(float64)
	if !ok || math.IsNaN(number) {
		return fallback
	}
	return number
}

func boolOr(value any, fallback bool) bool {
	boolean, ok := value.(bool)
	if !ok {
		return fallback
	}
	return boolean
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}
func stringMap(value any) map[string]string {
	result := map[string]string{}
	values, ok := value.(map[string]any)
	if !ok {
		return result
	}
	for key, value := range values {
		if path, ok := value.(string); ok && path != "" {
			result[key] = path
		}
	}
	return result
}
func previewAudioSampleRate(project map[string]any) int {
	settings, ok := project["settings"].(map[string]any)
	if !ok {
		return 48000
	}
	rate := int(numberOr(settings["audioSampleRate"], 48000))
	if rate < 8000 || rate > 192000 {
		return 48000
	}
	return rate
}

func activeAudioClips(project map[string]any, start, end float64) []map[string]any {
	timeline, ok := project["timeline"].(map[string]any)
	if !ok {
		return nil
	}
	tracks, ok := timeline["tracks"].([]any)
	if !ok {
		return nil
	}
	clips := make([]map[string]any, 0)
	for _, trackValue := range tracks {
		track, ok := trackValue.(map[string]any)
		if !ok || track["kind"] != "audio" || boolOr(track["muted"], false) {
			continue
		}
		trackClips, ok := track["clips"].([]any)
		if !ok {
			continue
		}
		for _, clipValue := range trackClips {
			clip, ok := clipValue.(map[string]any)
			if !ok || boolOr(clip["muted"], false) {
				continue
			}
			clipStart := numberOr(clip["timelineStart"], 0)
			clipEnd := numberOr(clip["timelineEnd"], clipStart)
			if clipEnd > start && clipStart < end {
				clips = append(clips, clip)
			}
		}
	}
	return clips
}
func activeVideoClip(project map[string]any, timelineTime float64) (map[string]any, *rpcError) {
	timeline, ok := project["timeline"].(map[string]any)
	if !ok {
		return nil, invalid("session timeline is invalid")
	}
	tracks, ok := timeline["tracks"].([]any)
	if !ok {
		return nil, invalid("session timeline has no tracks")
	}
	for _, trackValue := range tracks {
		track, ok := trackValue.(map[string]any)
		if !ok || track["kind"] != "video" {
			continue
		}
		clips, ok := track["clips"].([]any)
		if !ok {
			continue
		}
		for _, clipValue := range clips {
			clip, ok := clipValue.(map[string]any)
			if !ok {
				continue
			}
			start := numberOr(clip["timelineStart"], 0)
			end := numberOr(clip["timelineEnd"], start)
			if timelineTime >= start && timelineTime < end {
				return clip, nil
			}
		}
	}
	return nil, &rpcError{Code: "NO_VIDEO_AT_TIME", Message: "No video clip is active at the requested timeline time."}
}
func sourceTimeForClip(clip map[string]any, timelineTime float64) float64 {
	start := numberOr(clip["timelineStart"], 0)
	sourceIn := numberOr(clip["sourceIn"], 0)
	sourceOut := numberOr(clip["sourceOut"], sourceIn)
	speed := numberOr(clip["speed"], 1)
	if speed <= 0 {
		speed = 1
	}
	sourceTime := sourceIn + math.Max(0, timelineTime-start)*speed
	if sourceOut > sourceIn {
		return math.Min(sourceTime, math.Max(sourceIn, sourceOut-0.0001))
	}
	return sourceTime
}
func previewFrameSize(project map[string]any) (int, int) {
	settings, ok := project["settings"].(map[string]any)
	if !ok {
		return 0, 0
	}
	width := int(numberOr(settings["width"], 0))
	height := int(numberOr(settings["height"], 0))
	if width <= 0 || height <= 0 {
		return 0, 0
	}
	scale := 1.0
	switch settings["previewResolution"] {
	case "quarter":
		scale = 0.25
	case "half":
		scale = 0.5
	}
	if scale == 1 {
		return width, height
	}
	return int(math.Max(2, math.Round(float64(width)*scale))), int(math.Max(2, math.Round(float64(height)*scale)))
}
func invalid(message string) *rpcError { return &rpcError{Code: "INVALID_ARGUMENT", Message: message} }
func notFound(kind, id string) *rpcError {
	return &rpcError{Code: "NOT_FOUND", Message: kind + " not found: " + id}
}
func libavError(operation string, code C.int) *rpcError {
	native := int(code)
	return &rpcError{Code: "LIBAV_ERROR", Message: operation + ": " + C.GoString(C.media_error_string(code)), NativeCode: &native}
}
func streamKind(kind C.int) string {
	if kind == C.AVMEDIA_TYPE_VIDEO {
		return "video"
	}
	if kind == C.AVMEDIA_TYPE_AUDIO {
		return "audio"
	}
	if kind == C.AVMEDIA_TYPE_SUBTITLE {
		return "subtitle"
	}
	if kind == C.AVMEDIA_TYPE_DATA {
		return "data"
	}
	return "unknown"
}
func timebase(stream *C.AVStream) map[string]any {
	return map[string]any{"numerator": int(C.media_stream_timebase_num(stream)), "denominator": int(C.media_stream_timebase_den(stream))}
}
func seconds(duration C.int64_t, stream *C.AVStream) float64 {
	return float64(duration) * float64(C.media_stream_timebase_num(stream)) / float64(C.media_stream_timebase_den(stream))
}
