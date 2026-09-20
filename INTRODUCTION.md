# CoMind 简介

CoMind 是一款开源 AI 桌面助手，将截图识别、网页采集、资料整理和模型问答集中在一个工作台中，适合日常办公、学习与面试练习。

## 主要功能

- **截图问答**：快捷键框选屏幕区域，自动将图片发送给当前启用的视觉模型，识别内容并生成回答。
- **独立悬浮窗**：置顶展示回答或提词稿，支持透明度、字号和鼠标穿透设置，也可放在另一块屏幕上。
- **网页采集**：通过 Chrome 扩展将网页文字发送到桌面端。
- **灵活接入模型**：支持 OpenAI 兼容接口和 Anthropic Messages，可配置豆包、DeepSeek、GLM 等服务。
- **资料与复盘**：管理简历、职位描述、固定问答和提词稿，保存会话、生成复盘并导出 Markdown。
- **自定义快捷键**：支持全局快捷键配置，截图快捷键可直接按键录入。

## 本地启动

建议使用 Node.js 22 或更高版本：

```bash
git clone https://github.com/azhsmesos/CoMind.git
cd CoMind
npm ci
npm run dev
```

启动后进入「应用设置 → AI 模型连接」，填写自己的 API Key、接口地址和模型 ID。截图识别需要支持图片输入的模型；macOS 首次截图需授予屏幕录制权限。

## 技术与数据

基于 Electron、React、TypeScript 和 Vite，提供 macOS 与 Windows 打包配置。资料和会话保存在本机，生成回答时相关内容会发送给用户配置的模型服务。悬浮窗内容保护不能保证在所有录屏或屏幕共享工具中隐藏。

项目基于 [Open Interview Assistant](https://github.com/harry-the-nerd/open-interview-assistant) 扩展，遵循 Apache-2.0，保留原项目版权与 NOTICE。完整使用说明见 [README](README.md)。
