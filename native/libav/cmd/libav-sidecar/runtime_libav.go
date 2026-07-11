//go:build libav

package main

/*
#cgo pkg-config: libavformat libavcodec libavutil libswscale libswresample
#include <stdlib.h>
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavutil/error.h>
#include <libavutil/imgutils.h>
#include <libavutil/pixfmt.h>
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
static int64_t media_frame_pts(AVFrame *frame) {
  return frame->best_effort_timestamp == AV_NOPTS_VALUE ? frame->pts : frame->best_effort_timestamp;
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
// deliberately confined to this process; Electron sees IDs and data leases.
type libavRuntime struct {
	mu       sync.Mutex
	nextID   uint64
	assets   map[string]*nativeAsset
	sessions map[string]map[string]any
}

type nativeAsset struct {
	id          string
	path        string
	format      *C.AVFormatContext
	videoCodec  *C.AVCodecContext
	videoStream int
}

func newRuntime() runtime {
	return &libavRuntime{assets: map[string]*nativeAsset{}, sessions: map[string]map[string]any{}}
}

func (r *libavRuntime) Call(method string, params map[string]any) (any, *rpcError) {
	r.mu.Lock()
	defer r.mu.Unlock()

	switch method {
	case "openAsset":
		path, err := stringParam(params, "path")
		if err != nil { return nil, err }
		asset, callErr := r.open(path)
		if callErr != nil { return nil, callErr }
		probe := r.probeFor(asset.path, asset.format)
		return map[string]any{"id": asset.id, "path": asset.path, "probe": probe}, nil
	case "probe":
		path, err := stringParam(params, "path")
		if err != nil { return nil, err }
		return r.probePath(path)
	case "decodeFrame":
		assetID, err := stringParam(params, "assetId")
		if err != nil { return nil, err }
		time, err := numberParam(params, "time")
		if err != nil { return nil, err }
		asset := r.assets[assetID]
		if asset == nil { return nil, notFound("asset", assetID) }
		return decodeRGBA(asset, time)
	case "createPlaybackSession":
		if _, ok := params["timeline"]; !ok { return nil, invalid("timeline is required") }
		id := r.identifier("session")
		session := map[string]any{"id": id, "timeline": params["timeline"], "state": "paused", "time": float64(0)}
		r.sessions[id] = session
		return session, nil
	case "seek", "play", "pause":
		id, err := stringParam(params, "sessionId")
		if err != nil { return nil, err }
		session := r.sessions[id]
		if session == nil { return nil, notFound("session", id) }
		if method == "seek" {
			time, timeErr := numberParam(params, "time")
			if timeErr != nil { return nil, timeErr }
			session["time"] = math.Max(0, time)
		}
		if method == "play" { session["state"] = "playing" }
		if method == "pause" { session["state"] = "paused" }
		return session, nil
	case "renderFrame":
		return nil, &rpcError{Code: "TIMELINE_COMPOSITOR_NOT_READY", Message: "Timeline compositing is not implemented in the initial decode sidecar."}
	case "encodeTimeline":
		return nil, &rpcError{Code: "TIMELINE_ENCODER_NOT_READY", Message: "Timeline encoding is not implemented in the initial decode sidecar."}
	case "dispose":
		id, err := stringParam(params, "targetId")
		if err != nil { return nil, err }
		if asset := r.assets[id]; asset != nil {
			asset.close()
			delete(r.assets, id)
		}
		delete(r.sessions, id)
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
	for _, asset := range r.assets { asset.close() }
	r.assets = map[string]*nativeAsset{}
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

func (r *libavRuntime) probePath(path string) (any, *rpcError) {
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))
	var format *C.AVFormatContext
	if code := C.avformat_open_input(&format, cPath, nil, nil); code < 0 { return nil, libavError("avformat_open_input", code) }
	defer C.avformat_close_input(&format)
	if code := C.avformat_find_stream_info(format, nil); code < 0 { return nil, libavError("avformat_find_stream_info", code) }
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
		if kind == "video" { entry["width"] = int(C.media_stream_width(stream)); entry["height"] = int(C.media_stream_height(stream)); video = entry }
		if kind == "audio" { entry["sampleRate"] = int(C.media_stream_sample_rate(stream)); audio = entry }
		streams = append(streams, entry)
	}
	metadata := map[string]any{"duration": float64(C.media_format_duration(format)) / float64(C.AV_TIME_BASE), "container": C.GoString(C.media_format_name(format)), "hasAudio": audio != nil}
	if video != nil { metadata["width"] = video["width"]; metadata["height"] = video["height"]; metadata["codec"] = video["codec"] }
	if audio != nil { metadata["sampleRate"] = audio["sampleRate"]; if _, ok := metadata["codec"]; !ok { metadata["codec"] = audio["codec"] } }
	return map[string]any{"path": path, "format": C.GoString(C.media_format_name(format)), "duration": metadata["duration"], "bitRate": int64(C.media_format_bitrate(format)), "streams": streams, "assetMetadata": metadata}
}

func decodeRGBA(asset *nativeAsset, time float64) (any, *rpcError) {
	stream := C.media_stream(asset.format, C.int(asset.videoStream))
	numerator := float64(C.media_stream_timebase_num(stream))
	denominator := float64(C.media_stream_timebase_den(stream))
	if numerator <= 0 || denominator <= 0 { return nil, &rpcError{Code: "INVALID_TIMEBASE", Message: "Selected video stream has an invalid timebase."} }
	target := C.int64_t(math.Round(math.Max(0, time) * denominator / numerator))
	if code := C.av_seek_frame(asset.format, C.int(asset.videoStream), target, C.AVSEEK_FLAG_BACKWARD); code < 0 { return nil, libavError("av_seek_frame", code) }
	C.avcodec_flush_buffers(asset.videoCodec)
	packet := C.av_packet_alloc(); frame := C.av_frame_alloc()
	if packet == nil || frame == nil { if packet != nil { C.av_packet_free(&packet) }; if frame != nil { C.av_frame_free(&frame) }; return nil, &rpcError{Code: "ALLOCATION_FAILED", Message: "Unable to allocate packet/frame for decode."} }
	defer C.av_packet_free(&packet); defer C.av_frame_free(&frame)
	for {
		code := C.av_read_frame(asset.format, packet)
		if code < 0 { break }
		if C.media_packet_stream_index(packet) != C.int(asset.videoStream) { C.av_packet_unref(packet); continue }
		if code = C.avcodec_send_packet(asset.videoCodec, packet); code < 0 { C.av_packet_unref(packet); return nil, libavError("avcodec_send_packet", code) }
		C.av_packet_unref(packet)
		for {
			code = C.avcodec_receive_frame(asset.videoCodec, frame)
			if code == C.media_error_again() || code == C.media_error_eof() { break }
			if code < 0 { return nil, libavError("avcodec_receive_frame", code) }
			if C.media_frame_pts(frame) < target { C.av_frame_unref(frame); continue }
			return rgbaFrame(frame, numerator, denominator)
		}
	}
	return nil, &rpcError{Code: "FRAME_NOT_FOUND", Message: "No decoded video frame exists at or after the requested time."}
}

func rgbaFrame(input *C.AVFrame, numerator, denominator float64) (any, *rpcError) {
	width, height := C.media_frame_width(input), C.media_frame_height(input)
	sws := C.sws_getContext(width, height, C.enum_AVPixelFormat(C.media_frame_format(input)), width, height, C.AV_PIX_FMT_RGBA, C.SWS_BILINEAR, nil, nil, nil)
	if sws == nil { return nil, &rpcError{Code: "SWS_CONTEXT_FAILED", Message: "sws_getContext returned nil."} }
	defer C.sws_freeContext(sws)
	output := C.av_frame_alloc(); if output == nil { return nil, &rpcError{Code: "ALLOCATION_FAILED", Message: "Unable to allocate converted frame."} }
	defer C.av_frame_free(&output)
	if code := C.media_allocate_rgba_frame(output, width, height); code < 0 { return nil, libavError("av_frame_get_buffer", code) }
	if C.media_scale_to_rgba(sws, input, output) <= 0 { return nil, &rpcError{Code: "SWS_SCALE_FAILED", Message: "sws_scale did not produce an RGBA frame."} }
	stride := C.media_frame_linesize0(output); byteLength := int(stride * height)
	bytes := C.GoBytes(unsafe.Pointer(C.media_frame_data0(output)), C.int(byteLength))
	pts := C.media_frame_pts(input)
	return map[string]any{
		"format": "rgba", "width": int(width), "height": int(height), "stride": int(stride),
		"planes": []any{map[string]any{"offset": 0, "byteLength": byteLength, "stride": int(stride)}},
		"pts": int64(pts), "timebase": map[string]any{"numerator": numerator, "denominator": denominator},
		"duration": 0, "colorSpace": "unknown", "opacity": 1, "hasAlpha": true,
		"data": map[string]any{"kind": "inline", "encoding": "base64", "data": base64.StdEncoding.EncodeToString(bytes), "byteLength": byteLength},
	}, nil
}

func (asset *nativeAsset) close() { if asset.videoCodec != nil { C.avcodec_free_context(&asset.videoCodec) }; if asset.format != nil { C.avformat_close_input(&asset.format) } }
func (r *libavRuntime) identifier(prefix string) string { r.nextID++; return fmt.Sprintf("%s-%d", prefix, r.nextID) }
func stringParam(params map[string]any, key string) (string, *rpcError) { value, ok := params[key].(string); if !ok || value == "" { return "", invalid(key+" is required") }; return value, nil }
func numberParam(params map[string]any, key string) (float64, *rpcError) { value, ok := params[key].(float64); if !ok || math.IsNaN(value) { return 0, invalid(key+" must be a number") }; return value, nil }
func invalid(message string) *rpcError { return &rpcError{Code: "INVALID_ARGUMENT", Message: message} }
func notFound(kind, id string) *rpcError { return &rpcError{Code: "NOT_FOUND", Message: kind + " not found: " + id} }
func libavError(operation string, code C.int) *rpcError { native := int(code); return &rpcError{Code: "LIBAV_ERROR", Message: operation + ": " + C.GoString(C.media_error_string(code)), NativeCode: &native} }
func streamKind(kind C.int) string { if kind == C.AVMEDIA_TYPE_VIDEO { return "video" }; if kind == C.AVMEDIA_TYPE_AUDIO { return "audio" }; if kind == C.AVMEDIA_TYPE_SUBTITLE { return "subtitle" }; if kind == C.AVMEDIA_TYPE_DATA { return "data" }; return "unknown" }
func timebase(stream *C.AVStream) map[string]any { return map[string]any{"numerator": int(C.media_stream_timebase_num(stream)), "denominator": int(C.media_stream_timebase_den(stream))} }
func seconds(duration C.int64_t, stream *C.AVStream) float64 { return float64(duration) * float64(C.media_stream_timebase_num(stream)) / float64(C.media_stream_timebase_den(stream)) }
