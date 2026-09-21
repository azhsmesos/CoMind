import { VoiceStatus } from "./components/Voice";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  BookOpen,
  History as HistoryIcon,
  Settings as SettingsIcon,
  Sparkles,
  X,
  EyeOff,
  Grip,
  PanelTop,
  Power,
  ArrowUpRight,
  Keyboard,
} from "lucide-react";
import type {
  Command,
  CommandResult,
  DesktopState,
  OverlayScrollDirection,
} from "./types";
import { Workspace } from "./components/Workspace";
import { Materials } from "./components/Materials";
import { History } from "./components/History";
import { Settings } from "./components/Settings";
import { Shortcuts } from "./components/Shortcuts";
import { Answer } from "./components/Answer";
import type { Run } from "./components/Models";
const navigation = [
  {
    id: "workspace",
    label: "智能工作台",
    icon: LayoutDashboard,
    subtitle: "让信息更清晰，让工作更轻松",
  },
  {
    id: "materials",
    label: "我的资料库",
    icon: BookOpen,
    subtitle: "集中整理资料，随时获取所需",
  },
  {
    id: "history",
    label: "历史与复盘",
    icon: HistoryIcon,
    subtitle: "回顾每次会话，沉淀有用信息",
  },
  {
    id: "settings",
    label: "应用设置",
    icon: SettingsIcon,
    subtitle: "为你自己的工作方式而设置",
  },
  {
    id: "shortcuts",
    label: "快捷键",
    icon: Keyboard,
    subtitle: "截取当前屏幕，自动发送给 AI",
  },
] as const;
type Tab = (typeof navigation)[number]["id"];
function Overlay({ state, run }: { state: DesktopState; run: Run }) {
  const active =
    state.sessions.find((s) => s.id === state.activeSessionId) ||
    state.sessions[0];
  const latestRound = active?.rounds.at(-1);
  const round =
    latestRound?.source === "voice" && latestRound.status === "generating"
      ? [...(active?.rounds || [])]
          .reverse()
          .find((r) => r.answer && r.status === "done") || latestRound
      : latestRound;
  const model = state.models.find((m) => m.id === state.activeModelId);
  const [scriptId, setScriptId] = useState("");
  const [retryError, setRetryError] = useState("");
  const bodyRef = useRef<HTMLElement>(null);
  useEffect(
    () =>
      window.api.onOverlayScroll((direction: OverlayScrollDirection) => {
        const body = bodyRef.current;
        if (!body) return;
        if (direction === "up" || direction === "down")
          body.scrollBy({
            top:
              (direction === "down" ? 1 : -1) *
              Math.max(80, body.clientHeight * 0.75),
            behavior: "instant",
          });
        else if (direction === "left" || direction === "right")
          body.querySelectorAll("pre").forEach((code) => {
            code.scrollBy({
              left:
                (direction === "right" ? 1 : -1) *
                Math.max(80, code.clientWidth * 0.75),
              behavior: "instant",
            });
          });
      }),
    [],
  );
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0, behavior: "instant" });
    bodyRef.current
      ?.querySelectorAll("pre")
      .forEach((code) => code.scrollTo({ left: 0, behavior: "instant" }));
  }, [round?.id, round?.answer?.code, round?.answer?.summary, scriptId]);
  const scrollKey = (
    key: "scrollUp" | "scrollDown" | "scrollLeft" | "scrollRight",
  ) => {
    const shortcut = state.runtime.registeredShortcuts[key];
    if (!shortcut) return "未启用";
    return shortcut
      .replace(
        /CommandOrControl/g,
        window.api.platform === "darwin" ? "⌘" : "Ctrl",
      )
      .replace(/Alt/g, window.api.platform === "darwin" ? "⌥" : "Alt")
      .replace(/\bUp\b/g, "↑")
      .replace(/\bDown\b/g, "↓")
      .replace(/\bLeft\b/g, "←")
      .replace(/\bRight\b/g, "→");
  };
  useEffect(() => {
    setScriptId("");
  }, [round?.id]);
  useEffect(() => {
    setRetryError("");
  }, [round?.id, round?.status]);
  const script = state.materials.scripts.find((s) => s.id === scriptId);
  return (
    <div
      className="native-overlay"
      style={{
        backgroundColor: `rgba(18,24,40,${state.preferences.opacity})`,
        fontSize: state.preferences.fontSize,
      }}
    >
      <header className="overlay-toolbar">
        <span>
          <Grip size={16} />
          CoMind · 提词窗
        </span>
        <div className="button-row">
          <button
            title="切换鼠标穿透"
            onClick={() => void run({ type: "overlay:penetration" })}
          >
            <EyeOff size={15} />
          </button>
          <button
            title="隐藏悬浮窗"
            onClick={() => void run({ type: "overlay:toggle" })}
          >
            <X size={15} />
          </button>
        </div>
      </header>
      <div className="overlay-controls">
        <select
          aria-label="提词窗内容"
          value={scriptId}
          onChange={(e) => setScriptId(e.target.value)}
        >
          <option value="">当前题目回答</option>
          {state.materials.scripts.map((s) => (
            <option value={s.id} key={s.id}>
              {s.title || "未命名提词稿"}
            </option>
          ))}
        </select>
        <span>
          {state.runtime.clickThrough
            ? "穿透已开启 · 使用下方快捷键滚动"
            : "拖动顶部移动窗口"}
        </span>
        <div className="overlay-scroll-hint">
          <span>
            上翻 {scrollKey("scrollUp")} · 下翻 {scrollKey("scrollDown")}
          </span>
          <span>
            代码左移 {scrollKey("scrollLeft")} · 右移 {scrollKey("scrollRight")}
          </span>
          {(!state.runtime.registeredShortcuts.scrollUp ||
            !state.runtime.registeredShortcuts.scrollDown) && (
            <span>可在主窗口「快捷键」中启用或更换</span>
          )}
        </div>
      </div>
      <VoiceStatus voice={state.runtime.voice} run={run} />
      <main className="overlay-body" ref={bodyRef}>
        {script ? (
          <>
            <h2>{script.title}</h2>
            <p className="script-text">{script.content}</p>
          </>
        ) : (
          <>
            {latestRound?.status === "generating" && (
              <p role="status">正在生成…</p>
            )}
            {round?.error && (
              <div className="error-box" role="alert">
                <p>上次生成失败：{round.error}</p>
                <p>
                  {model?.hasKey
                    ? "当前模型已配置密钥，可重新生成本题。"
                    : "请先在主窗口配置并启用有可用密钥的模型。"}
                </p>
                {active?.status === "ongoing" && (
                  <button
                    disabled={round.status === "generating"}
                    onClick={async () => {
                      setRetryError("");
                      const result = await run({
                        type: "round:generate",
                        sessionId: active.id,
                        roundId: round.id,
                      });
                      if (!result.ok) setRetryError(result.error || "重试失败");
                    }}
                  >
                    重新生成
                  </button>
                )}
              </div>
            )}
            {retryError && <p role="alert">本次重试失败：{retryError}</p>}
            {round?.answer ? (
              <Answer answer={round.answer} compact />
            ) : (
              <div className="empty">
                <Sparkles size={32} />
                <h3>等待你的下一道题目</h3>
                <p>在工作台输入，或通过浏览器扩展发送。</p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
export default function App() {
  const [state, setState] = useState<DesktopState | null>(null);
  const [tab, setTab] = useState<Tab>("workspace");
  const [feedback, setFeedback] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const [fatal, setFatal] = useState("");
  const overlay = location.hash === "#overlay";
  useEffect(() => {
    document.documentElement.classList.toggle("overlay-mode", overlay);
    document.body.classList.toggle("overlay-mode", overlay);
    if (!window.api) {
      setFatal("请从桌面应用打开CoMind。开发环境请运行 npm run dev。");
      return;
    }
    let received = false;
    const unsubscribe = window.api.onState((s) => {
      received = true;
      setState(s);
    });
    void window.api
      .getState()
      .then((s) => {
        if (!received) setState(s);
      })
      .catch(() => setFatal("无法连接桌面服务，请重启应用。"));
    return unsubscribe;
  }, [overlay]);
  const run: Run = async (command: Command): Promise<CommandResult> => {
    try {
      const result = await window.api.command(command);
      if (
        !result.ok ||
        (result.text && command.type !== "materials:import-resume")
      )
        setFeedback({
          text: result.error || result.text || "",
          error: !result.ok,
        });
      else if (
        command.type === "preferences:save" ||
        command.type === "model:save" ||
        command.type === "model:select" ||
        command.type === "materials:import-resume"
      )
        setFeedback(null);
      return result;
    } catch {
      const error = "桌面服务请求失败，请重试";
      setFeedback({ text: error, error: true });
      return { ok: false, error };
    }
  };
  if (fatal)
    return (
      <div className="empty">
        <h1>CoMind</h1>
        <p>{fatal}</p>
      </div>
    );
  if (!state)
    return (
      <div className="empty">
        <Sparkles className="spin" />
        <p>正在打开CoMind…</p>
      </div>
    );
  if (overlay) return <Overlay state={state} run={run} />;
  const current = navigation.find((n) => n.id === tab)!;
  const model = state.models.find((m) => m.id === state.activeModelId);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={25} />
          </div>
          <div>
            <h1>CoMind</h1>
            <span>你的智能办公助手</span>
          </div>
        </div>
        <div className="nav-label">个人工作空间</div>
        <nav>
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              className={id === tab ? "active" : ""}
              key={id}
              onClick={() => setTab(id)}
            >
              <Icon size={19} />
              {label}
              {id === tab && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="model-status">
            <span className="eyebrow">当前模型</span>
            <strong>{model?.name || "连接你的 AI 模型"}</strong>
            <small>{model?.model || "豆包 / DeepSeek / GLM / 自定义"}</small>
            <button onClick={() => setTab("settings")}>
              管理模型连接
              <ArrowUpRight size={14} />
            </button>
          </div>
          <button
            className="quit-button"
            onClick={() => void run({ type: "app:quit" })}
          >
            <Power size={15} />
            退出应用
          </button>
          <div className="sidebar-footer">
            LOCAL WORKSPACE <span>v1.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <h2>{current.label}</h2>
            <p>{current.subtitle}</p>
          </div>
          <div className="button-row">
            <label className="topbar-opacity">
              悬浮窗不透明度
              <input
                aria-label="悬浮窗背景不透明度"
                type="range"
                min="25"
                max="100"
                step="1"
                value={Math.round(state.preferences.opacity * 100)}
                onChange={(e) =>
                  void run({
                    type: "preferences:save",
                    preferences: {
                      ...state.preferences,
                      opacity: Number(e.target.value) / 100,
                    },
                  })
                }
              />
              <output>{Math.round(state.preferences.opacity * 100)}%</output>
            </label>
            <span className="local-pill">
              <i />
              本地工作空间
            </span>
            <button
              title="控制悬浮窗"
              onClick={() => void run({ type: "overlay:toggle" })}
            >
              <PanelTop size={17} />
            </button>
            {state.runtime.clickThrough && (
              <button onClick={() => void run({ type: "overlay:penetration" })}>
                关闭鼠标穿透
              </button>
            )}
          </div>
        </header>
        <main className="main-content">
          {feedback && (
            <div
              className={
                feedback.error
                  ? "error-box dismissible"
                  : "info-box dismissible"
              }
              role={feedback.error ? "alert" : "status"}
            >
              {feedback.text}
              <button aria-label="关闭提示" onClick={() => setFeedback(null)}>
                <X size={14} />
              </button>
            </div>
          )}
          {state.runtime.notice && (
            <div className="notice">{state.runtime.notice}</div>
          )}
          {tab === "workspace" && (
            <Workspace
              state={state}
              run={run}
              openSettings={() => setTab("settings")}
            />
          )}
          {tab === "materials" && (
            <Materials initial={state.materials} run={run} />
          )}
          {tab === "history" && <History state={state} run={run} />}
          {tab === "settings" && <Settings state={state} run={run} />}
          {tab === "shortcuts" && <Shortcuts state={state} run={run} />}
        </main>
      </div>
    </div>
  );
}
