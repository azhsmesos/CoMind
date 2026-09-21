import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Camera, Keyboard } from "lucide-react";
import type { DesktopState, Preferences } from "../types";
import type { Run } from "./Models";

const actions = [
  ["screenshot", "整屏截图并自动解答"],
  ["quit", "退出整个应用"],
  ["generate", "生成当前题目"],
  ["overlay", "显示 / 隐藏悬浮窗"],
  ["penetration", "切换鼠标穿透"],
  ["scrollUp", "悬浮窗向上翻页（穿透时可用）"],
  ["scrollDown", "悬浮窗向下翻页（穿透时可用）"],
  ["scrollLeft", "悬浮窗代码向左滚动（穿透时可用）"],
  ["scrollRight", "悬浮窗代码向右滚动（穿透时可用）"],
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
  const recordingInput = useRef<HTMLInputElement | null>(null);
  const recordingReady = useRef(false);
  const beforeRecording = useRef("");
  useEffect(() => {
    const blur = () => recordingInput.current?.blur();
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
        <details className="info-box">
          <summary>截图日志（最近 20 条）</summary>
          <ol>
            {state.runtime.screenshotLog.map((entry, index) => (
              <li
                key={index}
                className={entry.error ? "error-text" : undefined}
              >
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
              readOnly={key === "screenshot" || key === "quit"}
              value={
                key === "screenshot" || key === "quit"
                  ? displayKey(draft[key])
                  : draft[key]
              }
              maxLength={100}
              placeholder={
                key === "screenshot" || key === "quit"
                  ? recording
                    ? "请按下组合键…"
                    : "点击后按下组合键"
                  : "留空停用"
              }
              aria-describedby={
                key === "screenshot" || key === "quit"
                  ? "shortcut-key-hint"
                  : undefined
              }
              onFocus={
                key === "screenshot" || key === "quit"
                  ? async (event) => {
                      const input = event.currentTarget;
                      recordingInput.current = input;
                      beforeRecording.current = draft[key];
                      recordingReady.current = false;
                      setRecording(true);
                      setRecordHint("正在准备录入…");
                      const result = await run({
                        type: "shortcuts:record",
                        recording: true,
                      });
                      if (document.activeElement === input) {
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
                key === "screenshot" || key === "quit"
                  ? () => {
                      recordingReady.current = false;
                      setRecording(false);
                      setRecordHint("");
                      void run({ type: "shortcuts:record", recording: false });
                    }
                  : undefined
              }
              onKeyDown={
                key === "screenshot" || key === "quit"
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
                          [key]: beforeRecording.current,
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
                      setDraft((d) => ({ ...d, [key]: shortcut }));
                      setSaved(false);
                      setRecordHint(
                        clear
                          ? "已清空，保存后停用此快捷键。"
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
      <p className="muted" id="shortcut-key-hint" role="status">
        {recordHint ||
          "截图和退出快捷键：点击输入框后直接按键，支持组合键；Esc 取消，Backspace / Delete 清空。"}
      </p>
      <p className="muted">
        默认 Control+C 退出整个
        CoMind，包括主窗口、悬浮窗、托盘、会议识别及手机共享。 macOS 使用
        Control 键，不是
        ⌘。点击“退出整个应用”的输入框可录入其他组合键，清空并保存可停用。
      </p>
      <p className="muted">
        穿透后滚轮操作下方窗口。用悬浮窗翻页快捷键阅读长答案，左右滚动快捷键查看超宽代码；不会切换窗口焦点。快捷键可在上方修改，留空停用。
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
        <h3>截取当前屏幕 → 自动上传 → AI 解答</h3>
        <p>
          点击按钮或按快捷键，直接截取鼠标所在的整个屏幕并发送给当前模型，无需圈选或确认。
          截图过程中保持悬浮窗原位，不切换窗口；屏幕上可见的内容都会随截图提交。
        </p>
        <p>
          建议先打开题目页面，再按截图快捷键。多屏使用时先把鼠标移到目标屏幕；悬浮窗若遮住题目，请先移开。
          截图会随会话保存在本机，失败时可在工作台重试。macOS
          首次使用需允许屏幕录制权限。
        </p>
        <button
          className="primary"
          disabled={capturing}
          onClick={() => void run({ type: "screenshot:capture" })}
        >
          <Camera size={16} />
          {capturing ? state.runtime.jobs.screenshot : "截图并自动解答"}
        </button>
      </div>
    </section>
  );
}
