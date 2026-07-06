# OpenCut Reference Notes

本文件只记录后续可借鉴或可移植的 OpenCut 思路，不用于 fork 或照搬完整架构。

## Sources

- [OpenCut main repository](https://github.com/opencut-app/opencut)
- [OpenCut classic repository](https://github.com/opencut-app/opencut-classic)
- [OpenCut classic apps/web/src](https://github.com/opencut-app/opencut-classic/tree/main/apps/web/src)
- [OpenCut classic timeline directory](https://github.com/opencut-app/opencut-classic/tree/main/apps/web/src/timeline)

## Useful Ideas To Revisit

- Timeline 目录按 controllers、components、hooks、placement、snapping、scale、tracks、types 分层，说明复杂 timeline 应避免塞进单一 React component。
- Media 目录中独立 thumbnail、processing、types，适合参考素材导入、探测和缩略图缓存边界。
- Preview、project、rendering 分开，说明预览、项目状态、渲染管线应保持独立。
- Classic README 提到“videos stay on your device”，与本项目本地 `.aivproj` 思路一致。
- Classic README 也提到 preview/export 正在重构到 binary rendering。本项目从第一天就把 Preview Engine、Frame Engine、Render Engine 拆开，方便未来替换为 native binary。

## What Not To Copy

- 不采用 OpenCut classic 的数据库和 Docker/Redis 开发中心作为本项目核心。
- 不把 web SaaS 数据模型搬到本地桌面项目。
- 不照搬完整目录和文件命名，只借鉴 timeline/media/project/preview/rendering 的模块边界。
- 不把 AI 视频生成当作外部附加功能；本项目的 AI Orchestrator 是一等公民。

## Candidate Future Ports

- Timeline snapping、scale、ruler、track capability 的设计思想。
- Thumbnail cache 与 media metadata 的组织方式。
- Render pipeline 的任务队列和进度上报形态。
- Editor API / plugin-first 的长期扩展方向，但需要围绕本地项目文件和非破坏性 Timeline 重做。
