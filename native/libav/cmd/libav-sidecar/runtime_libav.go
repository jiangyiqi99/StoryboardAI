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
#include <libavutil/opt.h>
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
static int media_stream_frame_rate_num(AVFormatContext *format, AVStream *stream) { return av_guess_frame_rate(format, stream, NULL).num; }
static int media_stream_frame_rate_den(AVFormatContext *format, AVStream *stream) { return av_guess_frame_rate(format, stream, NULL).den; }
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
    (const uint8_t **)input->extended_data,
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
static int media_output_open(AVFormatContext **output, const char *path) { return avformat_alloc_output_context2(output, NULL, NULL, path); }
static int media_output_needs_file(AVFormatContext *output) { return !(output->oformat->flags & AVFMT_NOFILE); }
static int media_output_open_file(AVFormatContext *output, const char *path) { return avio_open(&output->pb, path, AVIO_FLAG_WRITE); }
static int media_output_close_file(AVFormatContext *output) { return avio_closep(&output->pb); }
static AVStream* media_output_add_stream(AVFormatContext *output, const AVCodec *codec) { return avformat_new_stream(output, codec); }
static const AVCodec* media_find_video_encoder(int kind) {
  if (kind == 0) return avcodec_find_encoder(AV_CODEC_ID_H264);
  return avcodec_find_encoder(AV_CODEC_ID_HEVC);
}
static int media_encoder_pixel_format(void) { return AV_PIX_FMT_YUV420P; }
static const AVCodec* media_find_audio_encoder(void) { return avcodec_find_encoder(AV_CODEC_ID_AAC); }
static void media_codec_configure_video(AVCodecContext *codec, int width, int height, int pix_fmt, int bitrate, int fps_num, int fps_den) {
  codec->width = width; codec->height = height; codec->pix_fmt = pix_fmt; codec->bit_rate = bitrate;
  codec->time_base = (AVRational){fps_den, fps_num}; codec->framerate = (AVRational){fps_num, fps_den};
  codec->gop_size = (int)(2.0 * fps_num / fps_den + 0.5); codec->max_b_frames = 0;
}
static void media_codec_set_global_header(AVCodecContext *codec) { codec->flags |= AV_CODEC_FLAG_GLOBAL_HEADER; }
static int media_output_global_header(AVFormatContext *output) { return output->oformat->flags & AVFMT_GLOBALHEADER; }
static void media_frame_set_pts(AVFrame *frame, int64_t pts) { frame->pts = pts; }
static int media_allocate_video_frame(AVFrame *frame, int width, int height, int pix_fmt) { frame->format = pix_fmt; frame->width = width; frame->height = height; return av_frame_get_buffer(frame, 32); }
static int media_frame_writable(AVFrame *frame) { return av_frame_make_writable(frame); }
static int media_codec_configure_audio(AVCodecContext *codec, int sample_rate, int channels, int bitrate) {
  int supports_fltp = 0;
#if defined(__clang__)
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
#elif defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
#endif
  if (codec->codec->sample_fmts) {
    for (const enum AVSampleFormat *format = codec->codec->sample_fmts; *format != AV_SAMPLE_FMT_NONE; format++) {
      if (*format == AV_SAMPLE_FMT_FLTP) { supports_fltp = 1; break; }
    }
  }
#if defined(__clang__)
#pragma clang diagnostic pop
#elif defined(__GNUC__)
#pragma GCC diagnostic pop
#endif
  if (!supports_fltp) return AVERROR(EINVAL);
  codec->sample_fmt = AV_SAMPLE_FMT_FLTP; codec->sample_rate = sample_rate; codec->bit_rate = bitrate;
  codec->time_base = (AVRational){1, sample_rate};
#if LIBAVUTIL_VERSION_MAJOR >= 57
  av_channel_layout_default(&codec->ch_layout, channels);
#else
  codec->channel_layout = av_get_default_channel_layout(channels); codec->channels = channels;
#endif
  return 0;
}
static int media_codec_frame_size(AVCodecContext *codec) { return codec->frame_size; }
static int media_allocate_audio_encode_frame(AVFrame *frame, int samples, int sample_rate, int channels) {
  frame->format = AV_SAMPLE_FMT_FLTP; frame->sample_rate = sample_rate; frame->nb_samples = samples;
#if LIBAVUTIL_VERSION_MAJOR >= 57
  av_channel_layout_default(&frame->ch_layout, channels);
#else
  frame->channel_layout = av_get_default_channel_layout(channels); frame->channels = channels;
#endif
  return av_frame_get_buffer(frame, 0);
}
static void media_fill_audio_fltp(AVFrame *frame, const int16_t *samples, int frames, int channels) {
  for (int channel = 0; channel < channels; channel++) {
    float *output = (float *)frame->data[channel];
    for (int index = 0; index < frames; index++) output[index] = samples[index * channels + channel] / 32768.0f;
  }
}
static int media_scale_rgba_to_yuv(struct SwsContext *sws, const uint8_t *data, int stride, AVFrame *output, int height) {
  const uint8_t *input_data[4] = { data, NULL, NULL, NULL }; int input_lines[4] = { stride, 0, 0, 0 };
  return sws_scale(sws, input_data, input_lines, 0, height, output->data, output->linesize);
}
static int media_packet_rescale_and_write(AVFormatContext *output, AVCodecContext *codec, AVStream *stream, AVPacket *packet) {
  av_packet_rescale_ts(packet, codec->time_base, stream->time_base); packet->stream_index = stream->index; return av_interleaved_write_frame(output, packet);
}
*/
import "C"

import (
	"encoding/base64"
	"fmt"
	"math"
	"os"
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
	exportClipID   string
	exportAssetID  string
	exportFrame    *decodedRGBAFrame
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

type decodedRGBAFrame struct {
	bytes                  []byte
	width, height, stride  int
	pts                    int64
	numerator, denominator float64
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
		project, ok := params["project"].(map[string]any)
		if !ok {
			return nil, invalid("project is required")
		}
		outputPath, err := stringParam(params, "outputPath")
		if err != nil {
			return nil, err
		}
		settings, ok := params["settings"].(map[string]any)
		if !ok {
			return nil, invalid("settings is required")
		}
		return r.encodeTimeline(project, outputPath, settings)
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

// encodeTimeline is intentionally a CFR renderer: each output timestamp picks
// one decoded source frame. It never blends adjacent frames or synthesizes
// intermediate motion. libswscale uses SWS_BILINEAR for every size conversion.
func (r *libavRuntime) encodeTimeline(project map[string]any, outputPath string, settings map[string]any) (result any, callErr *rpcError) {
	widthValue, heightValue := numberOr(settings["width"], 0), numberOr(settings["height"], 0)
	fps, bitRateValue := numberOr(settings["fps"], 0), numberOr(settings["bitRate"], 0)
	if widthValue < 2 || heightValue < 2 || widthValue > 16384 || heightValue > 16384 || widthValue*heightValue > 134217728 || math.Trunc(widthValue) != widthValue || math.Trunc(heightValue) != heightValue || int(widthValue)%2 != 0 || int(heightValue)%2 != 0 || fps < 1 || fps > 240 || bitRateValue < 1 || bitRateValue > 2000000000 {
		return nil, invalid("width, height, fps, and bitRate must be valid positive values (dimensions must be even)")
	}
	width, height, bitRate := int(widthValue), int(heightValue), int(bitRateValue)
	codecKind, codecName := encoderKind(settings["codec"])
	if codecKind < 0 {
		return nil, invalid("unsupported video codec")
	}
	duration := timelineDuration(project)
	if duration <= 0 {
		return nil, &rpcError{Code: "NO_VIDEO_TO_ENCODE", Message: "The timeline has no video duration."}
	}

	cOutputPath := C.CString(outputPath)
	defer C.free(unsafe.Pointer(cOutputPath))
	outputFileOpened := false
	defer func() {
		if callErr != nil && outputFileOpened {
			_ = os.Remove(outputPath)
		}
	}()
	var output *C.AVFormatContext
	if code := C.media_output_open(&output, cOutputPath); code < 0 || output == nil {
		return nil, libavError("avformat_alloc_output_context2", code)
	}
	defer C.avformat_free_context(output)
	encoder := C.media_find_video_encoder(C.int(codecKind))
	if encoder == nil {
		return nil, &rpcError{Code: "ENCODER_NOT_FOUND", Message: "No libav encoder is available for " + codecName}
	}
	codec := C.avcodec_alloc_context3(encoder)
	if codec == nil {
		return nil, &rpcError{Code: "ALLOCATION_FAILED", Message: "Unable to allocate video encoder."}
	}
	defer C.avcodec_free_context(&codec)
	pixelFormat := C.media_encoder_pixel_format()
	fpsNumerator, fpsDenominator := frameRateRational(fps)
	C.media_codec_configure_video(codec, C.int(width), C.int(height), pixelFormat, C.int(bitRate), C.int(fpsNumerator), C.int(fpsDenominator))
	if C.media_output_global_header(output) != 0 {
		C.media_codec_set_global_header(codec)
	}
	if preset, ok := settings["preset"].(string); ok {
		cPreset := C.CString(map[string]string{"faster": "veryfast", "balanced": "medium", "better": "slow"}[preset])
		cKey := C.CString("preset")
		C.av_opt_set(codec.priv_data, cKey, cPreset, 0)
		C.free(unsafe.Pointer(cKey))
		C.free(unsafe.Pointer(cPreset))
	}
	if code := C.avcodec_open2(codec, encoder, nil); code < 0 {
		return nil, libavError("avcodec_open2(encoder)", code)
	}
	stream := C.media_output_add_stream(output, encoder)
	if stream == nil {
		return nil, &rpcError{Code: "ALLOCATION_FAILED", Message: "Unable to allocate output stream."}
	}
	if code := C.avcodec_parameters_from_context(stream.codecpar, codec); code < 0 {
		return nil, libavError("avcodec_parameters_from_context", code)
	}

	var audioCodec *C.AVCodecContext
	var audioStream *C.AVStream
	var audioFrame *C.AVFrame
	var audioPacket *C.AVPacket
	audioSampleRate := previewAudioSampleRate(project)
	audioChannels := 2
	if timelineHasAudio(project) {
		audioEncoder := C.media_find_audio_encoder()
		if audioEncoder == nil {
			return nil, &rpcError{Code: "AUDIO_ENCODER_NOT_FOUND", Message: "No AAC encoder is available in libav."}
		}
		audioCodec = C.avcodec_alloc_context3(audioEncoder)
		if audioCodec == nil {
			return nil, &rpcError{Code: "ALLOCATION_FAILED", Message: "Unable to allocate audio encoder."}
		}
		defer C.avcodec_free_context(&audioCodec)
		if code := C.media_codec_configure_audio(audioCodec, C.int(audioSampleRate), C.int(audioChannels), C.int(192000)); code < 0 {
			return nil, libavError("configure AAC encoder", code)
		}
		if C.media_output_global_header(output) != 0 {
			C.media_codec_set_global_header(audioCodec)
		}
		if code := C.avcodec_open2(audioCodec, audioEncoder, nil); code < 0 {
			return nil, libavError("avcodec_open2(audio encoder)", code)
		}
		audioStream = C.media_output_add_stream(output, audioEncoder)
		if audioStream == nil {
			return nil, &rpcError{Code: "ALLOCATION_FAILED", Message: "Unable to allocate output audio stream."}
		}
		if code := C.avcodec_parameters_from_context(audioStream.codecpar, audioCodec); code < 0 {
			return nil, libavError("avcodec_parameters_from_context(audio)", code)
		}
	}
	if C.media_output_needs_file(output) != 0 {
		if code := C.media_output_open_file(output, cOutputPath); code < 0 {
			return nil, libavError("avio_open", code)
		}
		outputFileOpened = true
		defer C.media_output_close_file(output)
	}
	if code := C.avformat_write_header(output, nil); code < 0 {
		return nil, libavError("avformat_write_header", code)
	}

	frame := C.av_frame_alloc()
	packet := C.av_packet_alloc()
	if frame == nil || packet == nil {
		if frame != nil {
			C.av_frame_free(&frame)
		}
		if packet != nil {
			C.av_packet_free(&packet)
		}
		return nil, &rpcError{Code: "ALLOCATION_FAILED", Message: "Unable to allocate output frame or packet."}
	}
	defer C.av_frame_free(&frame)
	defer C.av_packet_free(&packet)
	if code := C.media_allocate_video_frame(frame, C.int(width), C.int(height), pixelFormat); code < 0 {
		return nil, libavError("av_frame_get_buffer(output)", code)
	}
	sws := C.sws_getContext(C.int(width), C.int(height), C.AV_PIX_FMT_RGBA, C.int(width), C.int(height), C.enum_AVPixelFormat(pixelFormat), C.SWS_BILINEAR, nil, nil, nil)
	if sws == nil {
		return nil, &rpcError{Code: "SWS_CONTEXT_FAILED", Message: "Unable to create bilinear export scaler."}
	}
	defer C.sws_freeContext(sws)
	if audioCodec != nil {
		audioFrame = C.av_frame_alloc()
		audioPacket = C.av_packet_alloc()
		if audioFrame == nil || audioPacket == nil {
			if audioFrame != nil {
				C.av_frame_free(&audioFrame)
			}
			if audioPacket != nil {
				C.av_packet_free(&audioPacket)
			}
			return nil, &rpcError{Code: "ALLOCATION_FAILED", Message: "Unable to allocate output audio frame or packet."}
		}
		defer C.av_frame_free(&audioFrame)
		defer C.av_packet_free(&audioPacket)
		if code := C.media_allocate_audio_encode_frame(audioFrame, C.int(C.media_codec_frame_size(audioCodec)), C.int(audioSampleRate), C.int(audioChannels)); code < 0 {
			return nil, libavError("av_frame_get_buffer(output audio)", code)
		}
	}

	session := &nativePlaybackSession{timeline: project, paths: stringMap(project["assetPaths"]), assetIDs: map[string]string{}, audioAssets: map[string]*nativeAudioAsset{}, forceSeek: true, audioForceSeek: true}
	defer r.disposeSession(session)
	frameCount := int(math.Ceil(duration * fps))
	audioPTS := int64(0)
	for index := 0; index < frameCount; index++ {
		time := float64(index) / fps
		rgba, decodeErr := r.exportRGBA(session, time, width, height)
		if decodeErr != nil {
			return nil, decodeErr
		}
		if code := C.media_frame_writable(frame); code < 0 {
			return nil, libavError("av_frame_make_writable", code)
		}
		if len(rgba) == 0 {
			rgba = make([]byte, width*height*4)
		}
		if C.media_scale_rgba_to_yuv(sws, (*C.uint8_t)(unsafe.Pointer(&rgba[0])), C.int(width*4), frame, C.int(height)) <= 0 {
			return nil, &rpcError{Code: "SWS_SCALE_FAILED", Message: "Bilinear export scaling failed."}
		}
		C.media_frame_set_pts(frame, C.int64_t(index))
		if code := C.avcodec_send_frame(codec, frame); code < 0 {
			return nil, libavError("avcodec_send_frame", code)
		}
		if writeErr := writeEncodedPackets(output, codec, stream, packet); writeErr != nil {
			return nil, writeErr
		}
		if audioCodec != nil {
			targetAudioPTS := int64(math.Ceil(math.Min(duration, float64(index+1)/fps) * float64(audioSampleRate)))
			for audioPTS < targetAudioPTS {
				if audioErr := r.encodeAudioFrame(session, output, audioCodec, audioStream, audioFrame, audioPacket, audioPTS, audioSampleRate, audioChannels); audioErr != nil {
					return nil, audioErr
				}
				audioPTS += int64(C.media_codec_frame_size(audioCodec))
			}
		}
	}
	if code := C.avcodec_send_frame(codec, nil); code < 0 {
		return nil, libavError("avcodec_send_frame(flush)", code)
	}
	if writeErr := writeEncodedPackets(output, codec, stream, packet); writeErr != nil {
		return nil, writeErr
	}
	if audioCodec != nil {
		finalAudioPTS := int64(math.Ceil(duration * float64(audioSampleRate)))
		for audioPTS < finalAudioPTS {
			if audioErr := r.encodeAudioFrame(session, output, audioCodec, audioStream, audioFrame, audioPacket, audioPTS, audioSampleRate, audioChannels); audioErr != nil {
				return nil, audioErr
			}
			audioPTS += int64(C.media_codec_frame_size(audioCodec))
		}
		if code := C.avcodec_send_frame(audioCodec, nil); code < 0 {
			return nil, libavError("avcodec_send_frame(audio flush)", code)
		}
		if writeErr := writeEncodedPackets(output, audioCodec, audioStream, audioPacket); writeErr != nil {
			return nil, writeErr
		}
	}
	if code := C.av_write_trailer(output); code < 0 {
		return nil, libavError("av_write_trailer", code)
	}
	return map[string]any{"outputPath": outputPath, "duration": duration}, nil
}

func (r *libavRuntime) encodeAudioFrame(session *nativePlaybackSession, output *C.AVFormatContext, codec *C.AVCodecContext, stream *C.AVStream, frame *C.AVFrame, packet *C.AVPacket, pts int64, sampleRate, channels int) *rpcError {
	frameSize := int(C.media_codec_frame_size(codec))
	value, renderErr := r.renderAudio(session, float64(pts)/float64(sampleRate), float64(frameSize)/float64(sampleRate))
	if renderErr != nil {
		return renderErr
	}
	audio, ok := value.(map[string]any)
	if !ok {
		return &rpcError{Code: "AUDIO_FORMAT_ERROR", Message: "Mixer returned an invalid audio buffer."}
	}
	transport, ok := audio["data"].(map[string]any)
	if !ok {
		return &rpcError{Code: "AUDIO_FORMAT_ERROR", Message: "Mixer returned no audio transport."}
	}
	encoded, _ := transport["data"].(string)
	bytes, decodeErr := base64.StdEncoding.DecodeString(encoded)
	if decodeErr != nil || len(bytes) < frameSize*channels*2 {
		return &rpcError{Code: "AUDIO_FORMAT_ERROR", Message: "Mixer returned a truncated audio buffer."}
	}
	if code := C.media_frame_writable(frame); code < 0 {
		return libavError("av_frame_make_writable(audio)", code)
	}
	C.media_fill_audio_fltp(frame, (*C.int16_t)(unsafe.Pointer(&bytes[0])), C.int(frameSize), C.int(channels))
	C.media_frame_set_pts(frame, C.int64_t(pts))
	if code := C.avcodec_send_frame(codec, frame); code < 0 {
		return libavError("avcodec_send_frame(audio)", code)
	}
	return writeEncodedPackets(output, codec, stream, packet)
}

func (r *libavRuntime) exportRGBA(session *nativePlaybackSession, time float64, width, height int) ([]byte, *rpcError) {
	clip, err := activeVideoClip(session.timeline, time)
	if err != nil {
		if err.Code == "NO_VIDEO_AT_TIME" {
			return nil, nil
		}
		return nil, err
	}
	assetID, _ := clip["assetId"].(string)
	clipID, _ := clip["id"].(string)
	if red, green, blue, ok := solidColorForAsset(session.timeline, assetID); ok {
		return solidRGBA(width, height, red, green, blue), nil
	}
	asset, assetErr := r.assetForSession(session, assetID)
	if assetErr != nil {
		return nil, assetErr
	}
	sourceTime := sourceTimeForClip(clip, time)
	if timelineAssetKind(session.timeline, assetID) == "image" || timelineAssetKind(session.timeline, assetID) == "generated-image" {
		sourceTime = numberOr(clip["sourceIn"], 0)
	} else if frameDuration := assetFrameDuration(asset); frameDuration > 0 {
		sourceIn := numberOr(clip["sourceIn"], 0)
		sourceOut := numberOr(clip["sourceOut"], sourceIn)
		// Project metadata and the container's final decodable PTS can differ by
		// one or more frames (especially for generated or variable-frame-rate
		// media). Never ask the decoder for a frame beyond the real video stream.
		if mediaDuration := assetVideoDuration(asset); mediaDuration > sourceIn {
			if sourceOut <= sourceIn || mediaDuration < sourceOut {
				sourceOut = mediaDuration
			}
		}
		if sourceOut > sourceIn {
			sourceTime = math.Min(sourceTime, math.Max(sourceIn, sourceOut-frameDuration))
		}
	}
	if session.exportFrame != nil && session.exportClipID == clipID && session.exportAssetID == assetID {
		frameTime := float64(session.exportFrame.pts) * session.exportFrame.numerator / session.exportFrame.denominator
		if sourceTime <= frameTime+0.0000001 {
			return session.exportFrame.bytes, nil
		}
	}
	forceSeek := session.exportFrame == nil || session.exportClipID != clipID || session.exportAssetID != assetID
	frame, decodeErr := r.decodeRGBARaw(asset, sourceTime, forceSeek, width, height)
	if decodeErr != nil {
		// CFR export may request a timestamp between the final decoded frame and
		// the container duration. Holding the last frame is the correct visual
		// result for the remainder of the clip and avoids failing the whole export.
		if decodeErr.Code == "FRAME_NOT_FOUND" && session.exportFrame != nil && session.exportClipID == clipID && session.exportAssetID == assetID {
			return session.exportFrame.bytes, nil
		}
		return nil, decodeErr
	}
	if len(frame.bytes) < width*height*4 || frame.stride != width*4 {
		return nil, &rpcError{Code: "FRAME_FORMAT_ERROR", Message: "Decoded frame is shorter than its declared dimensions."}
	}
	session.exportClipID, session.exportAssetID, session.exportFrame = clipID, assetID, frame
	return frame.bytes, nil
}

func assetFrameDuration(asset *nativeAsset) float64 {
	stream := C.media_stream(asset.format, C.int(asset.videoStream))
	numerator := int(C.media_stream_frame_rate_num(asset.format, stream))
	denominator := int(C.media_stream_frame_rate_den(asset.format, stream))
	if numerator <= 0 || denominator <= 0 {
		return 0
	}
	return float64(denominator) / float64(numerator)
}

func assetVideoDuration(asset *nativeAsset) float64 {
	stream := C.media_stream(asset.format, C.int(asset.videoStream))
	if duration := seconds(C.media_stream_duration(stream), stream); duration > 0 {
		return duration
	}
	if duration := float64(C.media_format_duration(asset.format)) / float64(C.AV_TIME_BASE); duration > 0 {
		return duration
	}
	return 0
}

func timelineAsset(project map[string]any, assetID string) map[string]any {
	assets, ok := project["assets"].([]any)
	if !ok {
		return nil
	}
	for _, value := range assets {
		asset, ok := value.(map[string]any)
		if ok && asset["id"] == assetID {
			return asset
		}
	}
	return nil
}

func timelineAssetKind(project map[string]any, assetID string) string {
	kind, _ := timelineAsset(project, assetID)["kind"].(string)
	return kind
}

func solidColorForAsset(project map[string]any, assetID string) (byte, byte, byte, bool) {
	asset := timelineAsset(project, assetID)
	metadata, ok := asset["metadata"].(map[string]any)
	if !ok {
		return 0, 0, 0, false
	}
	probe, ok := metadata["probe"].(map[string]any)
	if !ok {
		return 0, 0, 0, false
	}
	editor, ok := probe["storyboardAiEditor"].(map[string]any)
	if !ok || editor["variant"] != "solid-color" {
		return 0, 0, 0, false
	}
	color, ok := editor["solidColor"].(map[string]any)
	if !ok {
		return 0, 0, 0, false
	}
	red, redOK := color["r"].(float64)
	green, greenOK := color["g"].(float64)
	blue, blueOK := color["b"].(float64)
	if !redOK || !greenOK || !blueOK {
		return 0, 0, 0, false
	}
	channel := func(value float64) byte { return byte(math.Round(math.Max(0, math.Min(255, value)))) }
	return channel(red), channel(green), channel(blue), true
}

func solidRGBA(width, height int, red, green, blue byte) []byte {
	frame := make([]byte, width*height*4)
	for offset := 0; offset < len(frame); offset += 4 {
		frame[offset], frame[offset+1], frame[offset+2], frame[offset+3] = red, green, blue, 255
	}
	return frame
}

func writeEncodedPackets(output *C.AVFormatContext, codec *C.AVCodecContext, stream *C.AVStream, packet *C.AVPacket) *rpcError {
	for {
		code := C.avcodec_receive_packet(codec, packet)
		if code == C.media_error_again() || code == C.media_error_eof() {
			return nil
		}
		if code < 0 {
			return libavError("avcodec_receive_packet", code)
		}
		writeCode := C.media_packet_rescale_and_write(output, codec, stream, packet)
		C.av_packet_unref(packet)
		if writeCode < 0 {
			return libavError("av_interleaved_write_frame", writeCode)
		}
	}
}

func encoderKind(value any) (int, string) {
	switch value {
	case "h264":
		return 0, "H.264"
	case "hevc":
		return 1, "HEVC"
	default:
		return -1, ""
	}
}

func timelineDuration(project map[string]any) float64 {
	if timeline, ok := project["timeline"].(map[string]any); ok {
		return math.Max(0, numberOr(timeline["duration"], 0))
	}
	return 0
}

func timelineHasAudio(project map[string]any) bool {
	timeline, ok := project["timeline"].(map[string]any)
	if !ok {
		return false
	}
	tracks, ok := timeline["tracks"].([]any)
	if !ok {
		return false
	}
	for _, trackValue := range tracks {
		track, ok := trackValue.(map[string]any)
		if !ok || track["kind"] != "audio" || boolOr(track["muted"], false) {
			continue
		}
		if clips, ok := track["clips"].([]any); ok && len(clips) > 0 {
			return true
		}
	}
	return false
}

func frameRateRational(fps float64) (int, int) {
	// Preserve broadcast rates entered as decimals (23.976/29.97/59.94) and
	// arbitrary user-entered fractional rates to milliframe precision.
	numerator := int(math.Round(fps * 1000))
	denominator := 1000
	divisor := greatestCommonDivisor(numerator, denominator)
	return numerator / divisor, denominator / divisor
}

func greatestCommonDivisor(left, right int) int {
	for right != 0 {
		left, right = right, left%right
	}
	if left < 1 {
		return 1
	}
	return left
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
	frame, err := r.decodeRGBARaw(asset, time, forceSeek, outputWidth, outputHeight)
	if err != nil {
		return nil, err
	}
	byteLength := len(frame.bytes)
	return map[string]any{
		"format": "rgba", "width": frame.width, "height": frame.height, "stride": frame.stride,
		"planes": []any{map[string]any{"offset": 0, "byteLength": byteLength, "stride": frame.stride}},
		"pts":    frame.pts, "timebase": map[string]any{"numerator": frame.numerator, "denominator": frame.denominator},
		"duration": 0, "colorSpace": "unknown", "opacity": 1, "hasAlpha": true,
		"data": map[string]any{
			"kind": "inline", "encoding": "base64", "data": base64.StdEncoding.EncodeToString(frame.bytes), "byteLength": byteLength,
		},
	}, nil
}

func (r *libavRuntime) decodeRGBARaw(asset *nativeAsset, time float64, forceSeek bool, outputWidth, outputHeight int) (*decodedRGBAFrame, *rpcError) {
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
	draining := false
	for {
		code := C.avcodec_receive_frame(asset.videoCodec, frame)
		if code == 0 {
			pts := C.media_frame_pts(frame)
			if pts < target {
				C.av_frame_unref(frame)
				continue
			}
			result, convertErr := r.rgbaFrameRaw(frame, numerator, denominator, outputWidth, outputHeight)
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
			if draining {
				break
			}
			if flushCode := C.avcodec_send_packet(asset.videoCodec, nil); flushCode < 0 {
				return nil, libavError("avcodec_send_packet(flush)", flushCode)
			}
			draining = true
			continue
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

func (r *libavRuntime) rgbaFrameRaw(input *C.AVFrame, numerator, denominator float64, outputWidth, outputHeight int) (*decodedRGBAFrame, *rpcError) {
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
	return &decodedRGBAFrame{
		bytes: bytes, width: int(scaledWidth), height: int(scaledHeight), stride: int(stride),
		pts: int64(pts), numerator: numerator, denominator: denominator,
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
