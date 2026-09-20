# CoMind 桌面版验收记录

当前品牌已统一为 CoMind。以下为 2026-09-20 的历史验收快照，产物文件名和校验值保留当时记录，不代表改名后的安装包已重新构建。

日期：2026-09-20。当前验收重点为 macOS；按用户最新要求，Windows 启动验证暂不纳入本次验收。

## 已完成

- 工作台、资料库、历史复盘和设置已整合至 Electron 主程序。
- 豆包、DeepSeek、GLM 服务商预设，OpenAI Chat Completions 与 Anthropic Messages 自定义协议。
- 实际模型调用、结构化响应校验、错误展示、取消和过期响应隔离；无演示答案兜底。
- API Key 的 safeStorage 加密、原子持久化、损坏数据备份、会话重启恢复。
- 独立原生悬浮窗、置顶、拖动、字号/透明度、鼠标穿透、托盘和可配置快捷键。
- 浏览器扩展配对、按钮和快捷键发送、暂停采集队列、端口发现及明确错误。
- Mac 双架构 DMG、Windows x64 NSIS 构建脚本以及原生平台 CI 工作流。

## 验证结果

| 检查 | 结果 |
|---|---|
| TypeScript 类型检查 | 通过 |
| 核心、协议及扩展测试 | 18 项通过 |
| Electron 端到端流程 | 通过：配置、测试连接、资料、回答、复制、悬浮窗、穿透恢复、网页采集、暂停队列、复盘、重启持久化 |
| Apple Silicon 打包应用 | 原生启动通过 |
| Intel 打包应用 | 在 Apple Silicon 上通过 Rosetta 启动；非 Intel 实机结果 |
| 两种 Mac DMG 镜像完整性 | hdiutil 校验通过 |
| Apple Silicon 最终 DMG 内应用 | 只读挂载后直接启动通过；子进程 PATH 仅含 /usr/bin:/bin，不依赖开发服务器和外部 Node.js |
| 安装包内容检查 | 包含 LICENSE、NOTICE；不包含 .env、用户数据、参考项目、测试代码或已删除的旧明文密钥模块 |
| Windows 安装包 | 已生成，未进行 Windows 原生运行验证；本轮不再继续验证 |

## 验证边界

模型协议及完整流程使用本机模拟服务器、合成题目和测试凭据。没有使用个人 API Key 调用豆包、DeepSeek、GLM 或 Claude，因此不宣称已通过这些服务商的真实联网验证。

安装包未进行开发者证书签名或公证，首次打开可能需要系统手动放行。内容保护不保证所有录屏方式不可见。语音、截图、手机同步不属于本版范围。

## Mac 产物

- `release/Xiaomian-AI-1.0.0-mac-arm64.dmg`，约 116 MB。
- `release/Xiaomian-AI-1.0.0-mac-x64.dmg`，约 118 MB。

SHA-256：

```text
2912839fb35d9e7f274c1c5de24815cd7e7e0a62c19cc16dfeec3797c8c091c5  Xiaomian-AI-1.0.0-mac-arm64.dmg
3cd4e51d74eb9d5a85f9b76d26d4e1c6b7ee7544ee026b25a1c0a0249a26ef27  Xiaomian-AI-1.0.0-mac-x64.dmg
```

完整安装与配置步骤见根目录 README.md。再次打包执行 `npm run dist:mac`。
