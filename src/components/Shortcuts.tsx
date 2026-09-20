import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Camera, Keyboard } from "lucide-react";
import type { DesktopState, Preferences } from "../types";
import type { Run } from "./Models";

const actions = [
  ["screenshot", "框选截图并自动解答"],
  ["generate", "生成当前题目"],
  ["overlay", "显示 / 隐藏悬浮窗"],
  ["penetration", "切换鼠标穿透"],
  ["pair", "开放扩展配对"],
] as const;

function pressedShortcut(event: KeyboardEvent<HTMLInputElement>) {
  const names: Record<string, string> = {
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Enter: "Return",
    " ": "Space",
    Escape: "Escape",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Insert: "Insert",
  };
  const key = /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3)
    : /^Digit[0-9]$/.test(event.code)
      ? event.code.slice(5)
      : /^F([1-9]|1\d|2[0-4])$/.test(event.key)
        ? event.key
        : names[event.key];
  if (!key) return null;
  const mac = window.api.platform === "darwin";
  return [
    event.metaKey && (mac ? "CommandOrControl" : "Super"),
    event.ctrlKey && (mac ? "Control" : "CommandOrControl"),
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    key,
  ]
    .filter(Boolean)
    .join("+");
}

export function Shortcuts({ state, run }: { state: DesktopState; run: Run }) {
  const [draft, setDraft] = useState<Preferences["shortcuts"]>(() => ({
    ...state.preferences.shortcuts,
  }));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordHint, setRecordHint] = useState("");
  const screenshotInput = useRef<HTMLInputElement>(null);
  const recordingReady = useRef(false);
  const beforeRecording = useRef("");
  useEffect(() => {
    const blur = () => screenshotInput.current?.blur();
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("blur", blur);
      void window.api
        .command({ type: "shortcuts:record", recording: false })
        .catch(() => {});
    };
  }, []);
  const current = JSON.stringify(state.preferences.shortcuts);
  useEffect(() => {
    setDraft(JSON.parse(current));
  }, [current]);
  const capturing = !!state.runtime.jobs.screenshot;
  const screenshotKey = state.preferences.shortcuts.screenshot;
  const registered =
    !!screenshotKey &&
    state.runtime.registeredShortcuts?.screenshot === screenshotKey;
  const displayKey = (key: string) =>
    key.replace(
      /CommandOrControl/g,
      window.api.platform === "darwin" ? "⌘" : "Ctrl",
    );
  return (
    <section className="card settings-section">
      <div className="section-heading">
        <div>
          <h2>
            <Keyboard size={20} /> 快捷键
          </h2>
          <p>应用在后台运行时也可使用。留空并保存可停用对应快捷键。</p>
        </div>
        <button
          className="primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            const result = await run({
              type: "preferences:save",
              preferences: { ...state.preferences, shortcuts: draft },
            });
            setSaved(result.ok);
            setSaving(false);
          }}
        >
          {saving ? "保存中…" : saved ? "已保存" : "保存快捷键"}
        </button>
      </div>
      <div className={registered ? "info-box" : "notice"} role="status">
        {state.runtime.shortcutsRecording ? (
          "正在录入按键，已暂停CoMind 的全局快捷键。"
        ) : (
          <>
            当前截图快捷键：
            {screenshotKey ? displayKey(screenshotKey) : "已停用"}
            {screenshotKey &&
              (registered
                ? " · 已注册到CoMind"
                : " · 尚未注册成功，请更换快捷键并保存")}
          </>
        )}
        {state.runtime.lastScreenshotShortcut && (
          <p>
            CoMind 最近收到截图快捷键：
            {new Date(
              state.runtime.lastScreenshotShortcut,
            ).toLocaleTimeString()}
          </p>
        )}
      </div>
      {!!state.runtime.screenshotLog?.length && (
        <details className="info-box" open>
          <summary>截图日志（最近 20 条）</summary>
          <ol>
            {state.runtime.screenshotLog.map((entry, index) => (
              <li key={index} className={entry.error ? "error-text" : undefined}>
                {new Date(entry.at).toLocaleTimeString()} · {entry.message}
              </li>
            ))}
          </ol>
          {state.runtime.screenshotLogPath && (
            <p>本地日志：{state.runtime.screenshotLogPath}</p>
          )}
        </details>
      )}
      <div className="form-grid">
        {actions.map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              ref={key === "screenshot" ? screenshotInput : undefined}
              readOnly={key === "screenshot"}
              value={key === "screenshot" ? displayKey(draft[key]) : draft[key]}
              maxLength={100}
              placeholder={
                key === "screenshot"
                  ? recording
                    ? "请按下组合键…"
                    : "点击后按下组合键"
                  : "留空停用"
              }
              aria-describedby={
                key === "screenshot" ? "screenshot-key-hint" : undefined
              }
              onFocus={
                key === "screenshot"
                  ? async () => {
                      beforeRecording.current = draft.screenshot;
                      recordingReady.current = false;
                      setRecording(true);
                      setRecordHint("正在准备录入…");
                      const result = await run({
                        type: "shortcuts:record",
                        recording: true,
                      });
                      if (document.activeElement === screenshotInput.current) {
                        recordingReady.current = result.ok;
                        setRecordHint(
                          result.ok
                            ? "请按下快捷键；Esc 取消，Backspace / Delete 清空。"
                            : "无法开始录入，请重启应用后重试。",
                        );
                      }
                    }
                  : undefined
              }
              onBlur={
                key === "screenshot"
                  ? () => {
                      recordingReady.current = false;
                      setRecording(false);
                      setRecordHint("");
                      void run({ type: "shortcuts:record", recording: false });
                    }
                  : undefined
              }
              onKeyDown={
                key === "screenshot"
                  ? (e) => {
                      if (
                        e.key === "Tab" &&
                        !e.metaKey &&
                        !e.ctrlKey &&
                        !e.altKey
                      )
                        return;
                      e.preventDefault();
                      e.stopPropagation();
                      if (
                        e.nativeEvent.isComposing ||
                        e.repeat ||
                        !recordingReady.current
                      )
                        return;
                      const modified =
                        e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;
                      if (e.key === "Escape" && !modified) {
                        setDraft((d) => ({
                          ...d,
                          screenshot: beforeRecording.current,
                        }));
                        e.currentTarget.blur();
                        return;
                      }
                      const clear =
                        !modified && ["Backspace", "Delete"].includes(e.key);
                      const shortcut = clear ? "" : pressedShortcut(e);
                      if (shortcut === null) {
                        setRecordHint(
                          "请按功能键、字母、数字或导航键，可组合 ⌘ / Ctrl / Alt / Shift。",
                        );
                        return;
                      }
                      setDraft((d) => ({ ...d, screenshot: shortcut }));
                      setSaved(false);
                      setRecordHint(
                        clear
                          ? "已清空，保存后停用截图快捷键。"
                          : "已识别 " +
                              displayKey(shortcut) +
                              "，点击“保存快捷键”生效。",
                      );
                    }
                  : undefined
              }
              onChange={(e) => {
                setDraft((d) => ({ ...d, [key]: e.target.value }));
                setSaved(false);
              }}
            />
          </label>
        ))}
      </div>
      <p className="muted" id="screenshot-key-hint" role="status">
        {recordHint ||
          "截图快捷键：点击输入框后直接按键，支持组合键；Esc 取消，Backspace / Delete 清空。"}
      </p>
      <p className="muted">
        默认使用{" "}
        {window.api.platform === "darwin" ? "⌘+Shift+S" : "Ctrl+Shift+S"}。若 F1
        / Fn+F1 打开其他截图工具，请更换组合键，或先在那个工具中解除占用。填写
        Fn+F1 仍只注册为 F1，是否需要 Fn 由系统键盘设置决定。
      </p>
      {state.runtime.shortcutsErrors.map((error) => (
        <p className="error-text" role="alert" key={error}>
          {error}
        </p>
      ))}
      <div className="screenshot-guide">
        <h3>框选截图 → 自动上传 → AI 解答</h3>
        <p>
          在鼠标所在的屏幕拖动框选，松开鼠标后将所选区域发送给当前启用的模型。Esc
          或右键取消。截图会随会话保存在本机，失败时可在工作台重试。
        </p>
        <p>
          进入后应看到“CoMind · 框选截图”提示；其他工具的截图不会自动进入CoMind。可先点击下面的按钮确认上传流程。
        </p>
        <p>
          可以先框选截图；未配置模型时，截图会保存到会话，配置支持图片输入的模型后可重试识别。macOS
          首次使用需允许屏幕录制权限；会话暂停时请先继续会话。
        </p>
        <button
          className="primary"
          disabled={capturing}
          onClick={() => void run({ type: "screenshot:capture" })}
        >
          <Camera size={16} />
          {capturing ? state.runtime.jobs.screenshot : "框选截图并解答"}
        </button>
      </div>
    </section>
  );
}
