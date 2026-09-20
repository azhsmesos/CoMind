# CoMind 桌面版

**CoMind** 是基于 **Open Interview Assistant** 扩展的智能办公助手。提供侧栏导航、资料库、回答区和复盘界面，接入真实模型、Chrome 网页采集与 Electron 原生悬浮窗。

快速了解项目：[项目简介](INTRODUCTION.md)。源码仓库：[azhsmesos/CoMind](https://github.com/azhsmesos/CoMind)。

## 安装与首次使用

重新构建后，在 `release/` 中选择对应的 CoMind 安装包（旧版本安装包不会随源码改名）：

- Mac Apple Silicon（M 系列）：`CoMind-1.0.0-mac-arm64.dmg`
- Mac Intel：`CoMind-1.0.0-mac-x64.dmg`
- Windows x64：`CoMind-1.0.0-win-x64.exe`

Mac 打开 DMG 后，将“CoMind”拖入 Applications；Windows 运行安装程序。无需安装 Node.js，不需要 `.env`。这些包供个人或小范围使用，未进行开发者证书签名、公证，系统可能要求手动确认打开。不要把一个平台的包用于另一个平台。

1. 打开应用，进入 **应用设置 → AI 模型连接**。
2. 选择豆包、DeepSeek、GLM 或自定义服务，填写 API Key、账户可用的模型 ID。
3. 保存连接，点击 **测试**。多份配置可通过 **启用** 切换。
4. 在工作台输入题目，点击 **添加题目并生成**。没有会话时会自动创建。
5. 点击 **打开悬浮窗**，将回答或已保存的提词稿放到独立置顶窗口。
6. 可以记录自己的实际作答，结束会话后在 **历史与复盘** 生成真实分析或导出 Markdown。

第一次使用资料库时内容为空。简历、JD、固定问答在保存后用于回答生成；AI 整理结果可先修改再保存。没有记录实际作答的会话只做参考答案分析，不生成个人表现评分。

## 模型配置

| 服务 | 默认 API Base URL | 模型字段 |
|---|---|---|
| 豆包 / 火山方舟 | `https://ark.cn-beijing.volces.com/api/v3` | 已开通的模型 ID 或 `ep-…` 推理接入点 |
| DeepSeek | `https://api.deepseek.com` | 账户可用的模型 ID |
| GLM / 智谱 | `https://open.bigmodel.cn/api/paas/v4` | 账户可用的模型 ID |
| 自定义 | 用户填写 | 用户填写 |

支持 **OpenAI Chat Completions** 与 **Anthropic Messages**，因此可以继续使用 Claude。Anthropic 的官方 Base URL 可填写 `https://api.anthropic.com`。Base URL 不包含 `/chat/completions` 或 `/messages`；应用自动拼接协议端点。不同套餐（例如 Coding Plan）可能需要不同地址，请填写对应服务商给出的接口根地址。

模型 ID 不强制绑定某一代模型，也不自动切换服务商。回答生成、资料优化、复盘均使用当前启用的配置。服务需要能够返回正文文本和 JSON；应用不会将 `reasoning_content` 作为答案。模型网络错误、鉴权失败、额度限制、超时和格式错误都会显示，**不会返回虚构的兜底答案**。

## Chrome 网页采集

1. 在应用设置中点击 **打开扩展目录**。
2. Chrome 地址栏输入 `chrome://extensions`，开启开发者模式。
3. 选择 **加载已解压的扩展程序**，选择刚打开的 `browser-extension` 文件夹。
4. 打开普通题目网页，等待题目加载，按 Mac `⌘ Shift U` / Windows `Ctrl Shift U`，或点击扩展弹窗的 **发送当前页面**。

扩展名为“CoMind 网页助手”。首次自动配对；恢复配对时先在应用设置中点击 **重新配对**，再在扩展中配对，窗口有效期为 60 秒。扩展目录固定在用户数据目录，升级应用不需要重新选择路径。

如果快捷键没有反应，检查 `chrome://extensions/shortcuts` 是否绑定成功。扩展弹窗会显示具体错误。浏览器内部页面、纯图片题目及无法读取的跨域 iframe 内容可使用框选截图识题。

暂停会话时，网页采集暂存（最多 20 道），继续后依次生成。结束暂停会话会将待处理题目保存为未生成的回合。

## 桌面行为

### 快捷键与框选截图

侧边栏 **快捷键** 可设置全局快捷键，也可点击“框选截图并解答”。默认截图快捷键为 **Mac ⌘+Shift+S / Windows Ctrl+Shift+S**。页面显示实际注册状态和最近触发时间；注册失败不会显示保存成功，解除占用后再次保存同一快捷键会重试。已有自定义快捷键会保留。

也可设置 `F1`；Mac 部分键盘需要按 **Fn+F1**。输入 `Fn+F1` 时应用保存为 `F1`，是否需要 Fn 由系统键盘设置决定。若它打开了其他工具的截图界面，请更换组合键，或先解除其他工具的占用。CoMind 的截图界面有 **“CoMind · 框选截图”** 标识；其他工具产生的截图不会自动上传到本应用。

截图快捷键支持按键录入：点击输入框，直接按组合键或功能键，自动识别后点击“保存快捷键”。Esc 取消本次录入，Backspace / Delete 清空后保存可停用。录入期间暂停本应用全局快捷键，离开输入框后恢复；系统或其他应用独占的按键仍可能无法录入。

触发后在鼠标所在的屏幕拖动框选，松开鼠标即保存截图，并使用当前启用的模型识别和生成回答。**Esc 或右键取消**。未配置模型也能框选，图片保存在会话中，配置支持图片输入的模型后可重试；支持 OpenAI 兼容及 Anthropic 图片消息。模型拒绝图片、上传失败等会显示错误，可切换视觉模型后重试。会话暂停时需先继续会话。多屏使用时先将鼠标移到目标屏幕。

快捷键页面的“截图日志”显示最近 20 条进度与错误，包括触发、屏幕权限、屏幕读取、框选窗口、选区和识别结果。日志同时写入终端及页面所示的本地 `screenshot.log`，超过约 1 MB 时轮换，保留一份旧日志；不记录截图内容或模型密钥。“最近收到截图快捷键”仅表示按键已触发，不代表框选或识别已完成。

macOS 首次使用需授予屏幕录制权限；开发模式可能需要允许 Electron 或启动它的终端，授权后重启应用。截图期间临时隐藏主窗口和提词窗，结束或取消后恢复。截图压缩为 JPEG，长边最大 2560 像素。

关闭主窗口后进入托盘；通过托盘打开工作台或退出。悬浮窗默认可鼠标操作，可拖动标题栏、调整窗口尺寸。开启穿透后，通过快捷键、托盘或主窗口恢复。

| 功能 | 默认快捷键 |
|---|---|
| 框选截图并自动解答 | `Cmd/Ctrl Shift S` |
| 生成最新题目 | `Cmd/Ctrl Shift Enter` |
| 显示或隐藏悬浮窗 | `Cmd/Ctrl Shift B` |
| 切换鼠标穿透 | `Cmd/Ctrl Shift M` |
| 开放重新配对窗口 | `Cmd/Ctrl Shift P` |

侧边栏“快捷键”支持修改这些快捷键，并显示占用或格式冲突；浏览器快捷键在 Chrome 中设置。留空可停用应用快捷键。

内容保护仅用于悬浮窗，并不能保证所有录屏/共享方式都不可见。部分 macOS ScreenCaptureKit 捕获不受保护。首版不包含录音、语音转写、手机同步。

## 数据与隐私

品牌升级后会继续使用已存在的旧版桌面数据目录，保留资料、会话和浏览器扩展路径；应用标识保持稳定。

- 使用 Electron 用户数据目录下的 `desktop-state.json` 持久化资料、会话、模型配置和扩展 Token，采用版本号与原子替换写入。
- API Key 由 `safeStorage` 使用系统加密能力加密；不回传界面、不存入 localStorage、不打进安装包。系统加密不可用时只在本次运行的内存中保留。
- 题目和资料在生成时发送给你配置的模型服务，未使用额外的中转服务。
- 会话和资料本身未加密，依赖本机账户和磁盘保护；删除会话会从应用持久化状态移除。
- 不自动导入旧网页 localStorage 中的示例、历史或密钥。
- 不自动上传日志、遥测或更新。

## 本地开发

建议 Node.js 22 或更高版本：

```bash
npm ci
npm run dev
```

`npm run dev` 同时启动 Vite 与 Electron，前端端口为 5180。首次运行可能下载 Electron 二进制，下载完成后才会出现桌面窗口。桌面主进程修改后需重新启动开发命令。

```bash
npm run typecheck
npm test
npm run test:e2e
npm run test:screenshot
npm run dist:mac
npm run dist:win
npm run test:packaged
```

- 单元/协议测试使用本机 HTTP 测试服务器与合成凭据，不使用个人 API Key。
- 端到端测试使用真实 Electron 窗口及隔离的临时数据目录；截图输出到 `test-results/`。
- 截图专项测试使用合成屏幕图片和本机模拟模型，验证框选裁剪、取消、自动上传、错误提示和重启保存；不读取真实屏幕或调用付费模型。真实屏幕权限和具体视觉模型仍需实机验证。
- 打包到 `release/`，包含运行时，无需开发服务器。
- `test:packaged` 直接启动当前架构的打包应用；可用 `COMIND_EXECUTABLE` 指定可执行文件、`SMOKE_ARCH` 指定 Mac 架构。
- `.github/workflows/desktop.yml` 在 macOS ARM、macOS Intel 和 Windows x64 原生 runner 上构建并运行测试，只上传构建产物，不自动公开发布。
- Windows 包可以在 Mac 上交叉构建，但 **Windows 运行通过必须以 Windows runner 或实机结果为准**。

## 代码结构与授权

`src/` 为主界面及悬浮窗，`shared/` 定义 IPC 类型，`electron/` 为主进程、模型适配、会话与存储，`extension/` 为 Chrome 扩展。原始 UI 参考目录已移除，开发和构建统一从项目根目录执行。

基于 [Open Interview Assistant](https://github.com/harry-the-nerd/open-interview-assistant)，原项目由 DarkInterview 提供。沿用 Apache-2.0，原始版权、LICENSE 与 NOTICE 均予以保留。
