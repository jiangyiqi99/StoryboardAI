# Storyboard AI Editor

AI-native 本地非线性视频剪辑软件架构骨架。当前阶段只搭建 Electron + React + TypeScript + Vite 项目结构、核心模块占位、类型定义、IPC 调用流程和项目文件说明，不实现真实 UI 细节、真实模型调用、复杂 FFmpeg 命令、完整剪辑算法或云端服务。

## 设计目标

- 桌面端优先：跨平台 Electron App，而不是传统 SaaS 管理后台。
- 本地项目优先：以 `.aivproj/` 文件夹和 `project.json` 作为项目状态中心。
- Timeline 优先：Track、Clip、Asset、Selection、Edit History 是核心模型。
- 媒体处理本地化：Preview、Frame、Render 三个引擎分离，第一阶段使用占位/mock 与 FFmpeg/FFprobe 调用槽位。
- Native Media Runtime：新增 Go/libav Sidecar 契约，作为下一阶段 native 解码、预览与导出的并行通道；尚未替换既有 Preview 或 FFmpeg 路径。
- AI-native：分镜生成视频和选区替换是一级工作流，不是附加插件。
- 非破坏性编辑：Timeline clip 只引用素材，不改写原始视频文件。

OpenCut 只作为公开设计参考：当前 OpenCut 主仓库描述其目标为 web/desktop/mobile 视频编辑器，classic 仓库保留了 timeline、media、preview、project、rendering 等模块边界。本项目不会 fork 或照搬 OpenCut，而是围绕本地 `.aivproj` 和 AI 生成工作流重新组织。参考记录见 [references/opencut-notes.md](references/opencut-notes.md)。

## 开发与打包

```bash
npm run dev
npm run build
./build --macarm64
./build --macx64
./build --win64
./build --linux
```

`npm run build` 只生成 Electron/Vite 运行产物到 `out/`。`./build` 会先构建本机架构的 libav sidecar，再通过 electron-builder 生成安装包，输出到 `release/`。它不支持交叉编译：请在对应操作系统和 CPU 架构上运行相应命令。

跨平台发布建议在对应系统或 CI runner 上分别打包：macOS 用 macOS runner，Windows 用 Windows runner，Linux 用 Linux runner。macOS 公证和 Windows 代码签名需要额外配置证书；未配置时只能生成开发/本地测试用安装包。应用图标可后续补充到 electron-builder 支持的 `build/icon.icns`、`build/icon.ico`、`build/icon.png`。

## 目录结构

```text
.
├── electron.vite.config.ts
├── index.html
├── src
│   ├── main
│   │   ├── main.ts
│   │   ├── ai-router
│   │   ├── ipc
│   │   │   ├── aiHandlers.ts
│   │   │   ├── mediaHandlers.ts
│   │   │   ├── projectHandlers.ts
│   │   │   └── registerIpcHandlers.ts
│   │   ├── model-proxy
│   │   ├── providers
│   │   └── services
│   │       └── appServices.ts
│   ├── preload
│   │   └── index.ts
│   ├── renderer
│   │   ├── app
│   │   ├── components
│   │   │   ├── export
│   │   │   ├── inspector
│   │   │   ├── media-bin
│   │   │   ├── preview
│   │   │   ├── replace-selection
│   │   │   ├── storyboard
│   │   │   └── timeline
│   │   └── ipc
│   ├── shared
│   │   ├── ipc
│   │   ├── ai-routing
│   │   └── types
│   ├── project-system
│   ├── media-engine
│   │   ├── ffmpeg
│   │   ├── frame
│   │   ├── preview
│   │   └── render
│   ├── ai-orchestrator
│   │   ├── providers
│   │   └── workflows
│   ├── editing
│   │   └── commands
│   └── model-proxy
├── samples
│   └── empty-project.aivproj
└── references
    └── opencut-notes.md
```

## 核心层

### 1. Renderer UI

位置：`src/renderer`

Renderer 只负责桌面编辑器界面和用户动作入口：

- `timeline`：Track、Clip、Playhead、Selection 的 UI 占位。
- `preview`：预览画面承载区域，第一阶段可接 HTMLVideoElement/mock preview engine。
- `media-bin`：素材列表和 Asset 注册入口。
- `inspector`：当前选中 clip/range/asset 的属性面板。
- `storyboard`：分镜脚本和 segments 管理入口。
- `replace-selection`：Timeline range 替换入口。
- `export`：渲染导出入口。

Renderer 不直接读写任意文件，不直接调用 FFmpeg，不直接持有第三方模型 API key。所有本地权限通过 `window.aiv` 走 preload 暴露的 typed IPC API。

### 2. Electron Main Process

位置：`src/main`

Main Process 负责：

- 注册 IPC：`project:create/open/save`、`media:probe/extractFrame/renderTimeline`、`ai:generateStoryboard/replaceRange/getJobStatus`。
- 安全文件访问：后续通过 file picker、路径白名单、`.aivproj` 根目录校验扩展。
- 调用 Local Project System。
- 调用 Local Media Engine。
- 调用 AI Orchestrator。

调用方向：

```text
Renderer UI
  -> preload window.aiv
  -> Electron IPC
  -> Main Process handlers
  -> Project System / Media Engine / AI Orchestrator
  -> project.json + local media outputs
```

### 3. Local Project System

位置：`src/project-system`

`.aivproj/` 是项目边界，结构如下：

```text
MyFilm.aivproj/
├── project.json
├── assets/
├── frames/
├── cache/
├── proxies/
├── thumbnails/
├── renders/
└── ai/
```

`project.json` 保存：

- 项目元信息：`id`、`name`、`schemaVersion`、创建/更新时间。
- 项目设置：分辨率、fps、音频采样率、色彩空间、预览质量。
- 素材引用：`assets[]`，保存项目相对路径和探测 metadata。
- Timeline：`tracks[]`、`clips[]`、playhead、selection。
- 分镜：`storyboardSegments[]`。
- AI 任务：`aiGenerationJobs[]`。
- 渲染缓存：`renderCache[]`。
- 编辑历史：`editHistory.past/future`。

本层包含路径管理、Asset 注册、Cache 管理和项目文件读写。项目文件按当前 schema 严格读取，发布版不保留旧 schema 迁移路径。

### 4. Local Media Engine

位置：`src/media-engine`

媒体引擎拆成三个明确角色：

- Preview Engine：`seek`、`play`、`pause`、`scrub`、低分辨率预览。第一阶段是 mock/HTMLVideoElement 方向，未来可替换为 mpv/libmpv、Go video-processor binary、C++/libav 或 MLT。
- Frame Engine：`probe`、`seek`、`extractFrame`、`extractFirstLastFrames`、`thumbnail`、`proxy`。第一阶段预留 Node `child_process` 调用 FFmpeg/FFprobe。
- Render Engine：`trim`、`normalize`、`concat`、`renderSelection`、`renderTimeline`、`renderReplacementRange`、`exportTimeline`。第一阶段只保留接口和调用槽位。

Preview 不等于 Render：预览可以用代理、低分辨率或近似播放；最终导出走 Render Engine，按 Timeline 数据和项目设置生成稳定输出。

### Native Media Runtime（实验性）

位置：`src/main/native-media`、`src/shared/types/native-media.ts`、`native/libav`。

现有 `media:*` IPC、`MockPreviewEngine`、`FfmpegFrameEngine` 和
`FfmpegRenderEngine` 没有改动。新通道以 `window.aiv.nativeMedia` 暴露
`openAsset`、`probe`、`decodeFrame`、播放 session 控制、`renderFrame` 和
`encodeTimeline`。Main Process 懒启动 Go Sidecar，控制消息用 stdio JSON-RPC；
大帧/音频的接口定义为 shared-memory lease，避免把视频帧经 JSON 复制；当前
native decoder 先使用相同契约的 inline 数据来验证 libav 解码，尚未启用
platform shared-memory allocator。

帧约定支持 `rgba`、`bgra`、`yuv420p`，包含 width/height/stride、各 plane、
PTS/timebase、duration、色彩空间、alpha/opacity。音频约定支持 `f32le`、
`s16le`，包含采样率、声道数、sample frames、PTS/timebase 和同一 transport。

构建 native binary 需要 Go 和系统 libav 开发库：

```bash
npm run native:libav
```

详见 [native/libav/README.md](native/libav/README.md)。在二进制尚未构建时调用
`nativeMedia` 会报明确的运行时不可用错误，应用原有媒体能力不受影响。

### 5. AI Orchestrator

位置：`src/ai-orchestrator`

AI Orchestrator 负责两个核心工作流，但不直接依赖具体第三方模型。它只通过 `ApiRouter.generateVideo()`、`ApiRouter.getJobStatus()` 和 `ApiRouter.cancelJob()` 进入 AI API Routing Layer。

分镜脚本生成视频：

```text
script
  -> split into StoryboardSegment[]
  -> first segment: ApiRouter.generateVideo(text-to-video)
  -> extract previous tail frame
  -> following segments: ApiRouter.generateVideo(first-frame-to-video)
  -> register generated Asset
  -> insert non-destructive Clips into Timeline
  -> save project.json
```

选区替换：

```text
TimelineRange selection
  -> duration = range.end - range.start
  -> FrameEngine extracts first/last frames
  -> ApiRouter.generateVideo(replace-range)
  -> RenderEngine.normalize generated output
  -> register generated Asset
  -> create REPLACE_RANGE command
  -> split original clips into before / replacement / after
  -> save project.json
```

替换结果永远是新增 generated asset，再更新 Timeline 引用，不改写原 asset 文件。

### 6. AI API Routing Layer

位置：

- `src/shared/ai-routing`：跨进程、可迁移到云端的统一类型契约。
- `src/main/ai-router`：Electron Main Process 中的路由器实现骨架。
- `src/main/providers`：第三方模型 Provider Adapter 占位。
- `src/main/model-proxy`：未来 Thin Model Proxy 客户端占位。

三层边界：

- App 内部只调用统一接口：`ApiRouter.generateVideo()`、`ApiRouter.getJobStatus()`、`ApiRouter.cancelJob()`。
- `ApiRouter` 根据统一参数、route rules、provider、model、capabilities 和 mode 选择 Provider Adapter。
- `ProviderAdapter` 才处理第三方 API 的字段映射、认证方式、轮询方式、取消方式和返回格式转换。

统一请求类型是 `GenerateVideoRequest`，核心字段包括：

```ts
interface GenerateVideoRequest {
  providerId?: string;
  modelId?: string;
  mode:
    | "text-to-video"
    | "image-to-video"
    | "first-frame-to-video"
    | "first-last-frame-to-video"
    | "video-to-video"
    | "replace-range";
  prompt: string;
  negativePrompt?: string;
  durationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  aspectRatio?: string;
  seed?: number;
  stylePreset?: string;
  cameraMotion?: string;
  referenceImages?: ReferenceImageInput[];
  firstFrameAssetId?: string;
  lastFrameAssetId?: string;
  inputVideoAssetId?: string;
  maskAssetId?: string;
}
```

统一响应类型是 `GenerateVideoResponse`，保存 `jobId`、`providerId`、`providerJobId`、`modelId`、`mode`、`status`、`outputUri`、`error` 和命中的 `route`。

路由选择流程：

```text
GenerateVideoRequest
  -> GenerateVideoRequestValidator
  -> AssetReferenceResolver
  -> ProviderRouteMatcher
  -> ProviderAdapter.mapRequest
  -> ProviderAdapter.submitGeneration
  -> ProviderAdapter.mapResponse
  -> GenerateVideoResponse
```

Capabilities 匹配机制：

- mode 必须在 `ProviderCapabilities.supportedModes` 内。
- 指定 `modelId` 时，model 的 `supportedModes` 也必须匹配。
- `durationSec` 必须落在 provider/model 支持范围内。
- `aspectRatio`、`fps`、`width`、`height` 按 provider route rule 和 capabilities 双重过滤。
- `negativePrompt`、`seed`、`referenceImages`、`firstFrameAssetId`、`lastFrameAssetId`、`inputVideoAssetId`、`maskAssetId` 会检查 provider 是否声明支持。
- 显式 `providerId` 优先；否则按 `ProviderRouteRule.priority` 选择；最后使用 capabilities fallback。

参数映射骨架：

- `durationSec` 可以映射为 Runway 的 `duration`、Kling 的 `duration_sec`、Luma 的 `generation.duration_seconds`、Pika 的 `seconds`。
- `width` / `height` / `aspectRatio` 可以映射为 provider 的 `resolution`、`ratio` 或 `aspect_ratio`。
- `firstFrameAssetId` / `lastFrameAssetId` 先由 `AssetReferenceResolver` 解析为可上传文件、项目内临时 URI 或 Thin Model Proxy 可访问 URL，再交给 adapter 放进 `keyframes`、`image` 或 `references` 字段。
- `inputVideoAssetId` / `maskAssetId` 用于 video-to-video 和 replace-range 的视频、遮罩输入映射。

错误处理策略：

- 参数错误返回 `VALIDATION_ERROR`。
- 无可用 provider 返回 `NO_ROUTE`。
- provider 或 Thin Model Proxy 异常返回 `PROVIDER_ERROR` 或 `PROVIDER_UNAVAILABLE`。
- 取消失败返回 `CANCEL_FAILED`。
- Router 返回统一 `GenerateVideoResponse`，不把 provider 原始错误直接泄漏给 Renderer；原始响应用 `rawProviderResponse` 作为调试占位。

当前预留 provider：

- `MockProviderAdapter`
- `RunwayProviderAdapter`
- `KlingProviderAdapter`
- `LumaProviderAdapter`
- `PikaProviderAdapter`

它们都不会调用真实第三方 API，只展示字段映射和 job lifecycle 的占位。

## Timeline 数据模型

核心类型在 `src/shared/types`：

- `Project`
- `ProjectSettings`
- `Asset`
- `AssetMetadata`
- `Timeline`
- `Track`
- `Clip`
- `TimelineRange`
- `StoryboardSegment`
- `AiGenerationJob`
- `ProviderCapabilities`
- `VideoModelProvider`
- `PreviewEngine`
- `FrameEngine`
- `RenderEngine`
- `MediaEngineFacade`
- `EditCommand`

Clip 的非破坏性字段：

```ts
interface Clip {
  assetId: string;
  sourceIn: number;
  sourceOut: number;
  timelineStart: number;
  timelineEnd: number;
}
```

这意味着一个素材可以被多个 clip 以不同 source range 使用；split、trim、replace 都只是改 Timeline 状态。

## Command Pattern

位置：`src/editing/commands`

已预留命令：

- `ADD_CLIP`
- `REMOVE_CLIP`
- `SPLIT_CLIP`
- `TRIM_CLIP`
- `MOVE_CLIP`
- `REPLACE_RANGE`

后续 undo/redo 将围绕 `editHistory.past/future` 实现。AI 选区替换也通过 `REPLACE_RANGE` 进入同一编辑历史系统。

## 接入新模型

接入新 provider 的步骤：

1. 在 `src/main/providers` 新增一个 `ProviderAdapter`。
2. 声明 `ProviderCapabilities`，包括 modes、models、duration、aspectRatio、fps、reference frame、mask、polling、cancel 支持情况。
3. 实现 `mapRequest()`，把统一 `GenerateVideoRequest` 转成该 provider 的字段。
4. 实现 `submitGeneration()`、`getJobStatus()`、`cancelJob()` 的调用骨架，真实密钥优先走 `src/main/model-proxy` 或未来云端 Thin Model Proxy。
5. 在 `createDefaultProviderAdapters()` 注册 adapter。
6. 在 `DEFAULT_PROVIDER_ROUTE_RULES` 增加路由规则和优先级。

Thin Model Proxy 只保护第三方 API key、提交任务、查询状态、取消任务。它不保存 Timeline、不保存项目、不做用户业务数据库。项目真相仍在本地 `.aivproj/project.json`。

## 媒体内核替换路径

当前 Frame/Render Engine 只预留 Node `child_process` + FFmpeg/FFprobe 的命令式接口。后续替换方式：

- mpv/libmpv：替换 Preview Engine，获得更可靠的 seek、播放、scrubbing。
- Go video-processor binary：Frame/Render Engine 通过稳定 CLI 或 RPC 调用本地二进制。
- C++/libav：把 probe、抽帧、标准化、渲染管线下沉到 native addon 或独立进程。
- MLT：用成熟 NLE graph/timeline/render pipeline 替换 Render Engine。

只要保持 `MediaEngineFacade`、`FrameEngine`、`RenderEngine` 接口不变，Renderer 和 AI Orchestrator 不需要知道底层实现。

## 开发命令

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

当前仓库是架构骨架，很多方法会显式抛出 `not implemented`。这是刻意设计，用来标出后续实现边界。

## 当前本地编辑器功能

第一版 Renderer 已有基础剪辑交互：

- 视频、音频、图片导入：媒体库的“导入”按钮或文件拖入媒体库。
- 素材入时间线：从 Media Bin 拖素材到 Timeline，会创建本地 timeline clip。
- 时间线拖拽：拖动已有 clip 可改变 `timelineStart`。
- 选中联动：点击媒体库素材或时间线 clip，会同步 Inspector 和 Preview。
- 视频预览播放：导入的视频使用 `HTMLVideoElement` 预览播放，当前作为 Preview Engine 的第一阶段实现。

这些功能仍然只运行在前端本地状态里，尚未写入 `.aivproj/project.json`，也没有接入 FFmpeg 抽帧、代理文件、真实渲染或撤销/重做命令栈。
