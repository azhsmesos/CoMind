import { useEffect, useState } from "react";
import {
  FolderOpen,
  RefreshCw,
  Monitor,
  ShieldCheck,
  Settings as SettingsIcon,
} from "lucide-react";
import type { DesktopState, Preferences } from "../types";
import { Models, type Run } from "./Models";
export function Settings({ state, run }: { state: DesktopState; run: Run }) {
  const [preferences, setPreferences] = useState<Preferences>(() =>
    structuredClone(state.preferences),
  );
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setPreferences((current) => ({
      ...current,
      opacity: state.preferences.opacity,
    }));
  }, [state.preferences.opacity]);
  function change(p: Partial<Preferences>) {
    setPreferences((d) => ({ ...d, ...p }));
    setSaved(false);
  }
  return (
    <>
      <Models state={state} run={run} />
      <section className="card settings-section">
        <div className="section-heading">
          <div>
            <h2>
              <Monitor size={20} /> 浏览器连接
            </h2>
            <p>
              {state.runtime.paired
                ? "扩展已完成配对"
                : "首次使用需要加载一次扩展"}{" "}
              · 本地服务{" "}
              {state.runtime.port
                ? `127.0.0.1:${state.runtime.port}`
                : "未启动"}
            </p>
          </div>
          <button onClick={() => void run({ type: "extension:pair" })}>
            <RefreshCw size={15} />
            重新配对
          </button>
        </div>
        <ol className="setup-steps">
          <li>点击下方按钮，打开应用附带的扩展目录。</li>
          <li>
            在 Chrome 地址栏输入 <code>chrome://extensions</code>
            ，打开“开发者模式”。
          </li>
          <li>选择“加载已解压的扩展程序”，选择刚打开的目录。</li>
          <li>
            打开题目网页，按{" "}
            <kbd>{window.api.platform === "darwin" ? "⌘" : "Ctrl"} Shift U</kbd>
            ，或点击扩展里的“发送当前页面”。
          </li>
        </ol>
        <button onClick={() => void run({ type: "extension:open" })}>
          <FolderOpen size={16} />
          打开扩展目录
        </button>
        <p className="muted">
          快捷键没反应？在 <code>chrome://extensions/shortcuts</code>{" "}
          检查绑定；打开扩展弹窗可查看发送错误。重新配对窗口有效期 60 秒。
        </p>
      </section>
      <section className="card settings-section">
        <div className="section-heading">
          <h2>
            <SettingsIcon size={20} /> 偏好设置
          </h2>
          <button
            className="primary"
            onClick={async () => {
              const r = await run({ type: "preferences:save", preferences });
              setSaved(r.ok);
            }}
          >
            {saved ? "已保存" : "保存偏好"}
          </button>
        </div>
        <div className="form-grid">
          <label>
            回答语言
            <select
              value={preferences.language}
              onChange={(e) =>
                change({ language: e.target.value as Preferences["language"] })
              }
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            回答详略
            <select
              value={preferences.detail}
              onChange={(e) =>
                change({ detail: e.target.value as Preferences["detail"] })
              }
            >
              <option value="concise">简洁</option>
              <option value="balanced">均衡</option>
              <option value="detailed">详细</option>
            </select>
          </label>
          <label>
            悬浮窗背景不透明度 · {Math.round(preferences.opacity * 100)}%
            <input
              type="range"
              min="25"
              max="100"
              value={preferences.opacity * 100}
              onChange={(e) => change({ opacity: +e.target.value / 100 })}
            />
          </label>
          <label>
            悬浮窗字号 · {preferences.fontSize}px
            <input
              type="range"
              min="12"
              max="26"
              value={preferences.fontSize}
              onChange={(e) => change({ fontSize: +e.target.value })}
            />
          </label>
        </div>
        <p className="muted">全局快捷键与截图操作请在侧边栏“快捷键”中设置。</p>
        {state.runtime.shortcutsErrors.map((e) => (
          <p className="error-text" key={e}>
            {e}
          </p>
        ))}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={preferences.contentProtection}
            onChange={(e) => change({ contentProtection: e.target.checked })}
          />
          <ShieldCheck size={16} />
          启用悬浮窗内容保护
        </label>
        <p className="muted">
          保护效果取决于系统和录屏方式；部分 macOS ScreenCaptureKit
          应用仍可捕获悬浮窗。
        </p>
      </section>
      <footer className="about">
        CoMind · 基于 Open Interview Assistant / DarkInterview · Apache-2.0
        <br />
        资料与会话保存在本机；生成时向你配置的模型服务发送题目和相关资料。
      </footer>
    </>
  );
}
