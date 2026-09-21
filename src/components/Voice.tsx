import { useEffect, useRef, useState } from "react";
import { Mic, Square, Play, Check, Radio } from "lucide-react";
import {
  VOICE_LABELS,
  VOICE_MODELS,
  type VoiceModel,
  voiceEndpoint,
  type DesktopState,
  type Session,
  type Transcript,
  type VoiceRuntime,
} from "../types";
import type { Run } from "./Models";

export function VoiceSettings({
  state,
  run,
}: {
  state: DesktopState;
  run: Run;
}) {
  const [workspace, setWorkspace] = useState(state.voiceConfig.workspaceId);
  const [model, setModel] = useState<VoiceModel>(state.voiceConfig.model);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setTestResult(null);
  }, [state.voiceConfig.model, state.voiceConfig.workspaceId, state.voiceConfig.hasKey]);
  useEffect(() => {
    if (testResult) resultRef.current?.scrollIntoView({ block: "nearest" });
  }, [testResult]);
  let endpoint = "填写 Workspace ID 后自动生成北京地域地址";
  try {
    endpoint = voiceEndpoint(workspace.trim(), model);
  } catch {
    /* Show the help text while incomplete. */
  }
  async function save() {
    setTestResult(null);
    setBusy(true);
    try {
      const result = await run({
        type: "voice:save",
        workspaceId: workspace,
        model,
        apiKey: key,
      });
      if (result.ok) {
        setKey("");
        setSaved(true);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card settings-section">
      <div className="section-heading">
        <div>
          <h2>
            <Mic size={20} /> 会议语音识别
          </h2>
          <p>阿里云百炼 · 北京 · {state.voiceConfig.model}</p>
        </div>
        <span className="tag">独立语音连接</span>
      </div>
      <p className="muted">
        语音上传至百炼转写，文字交给当前 AI 模型判断问题和生成回答。DeepSeek Key
        不能用于百炼。
      </p>
      <div className="form-grid">
        <label>
          语音识别模型
          <select
            aria-label="语音识别模型"
            value={model}
            disabled={busy}
            onChange={(e) => {
              setModel(e.target.value as VoiceModel);
              setSaved(false);
              setTestResult(null);
            }}
          >
            {VOICE_MODELS.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <label>
          百炼 Workspace ID
          <input
            value={workspace}
            disabled={busy}
            onChange={(e) => {
              setWorkspace(e.target.value);
              setSaved(false);
              setTestResult(null);
            }}
            placeholder="北京地域的 Workspace ID"
          />
        </label>
        <label>
          语音 API Key
          <input
            type="password"
            disabled={busy}
            autoComplete="off"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setSaved(false);
              setTestResult(null);
            }}
            placeholder={
              state.voiceConfig.hasKey
                ? "已保存，留空保留原密钥"
                : "填写百炼 API Key"
            }
          />
        </label>
      </div>
      <p className="muted voice-endpoint">{endpoint}</p>
      <p className="muted">
        会议转写与模拟面试共用此模型。修改后请保存并测试连接；保存会停止当前识别，
        再次开始后使用新模型。API Key 留空可保留原密钥，需确保账号已开通所选模型。
      </p>
      <p className="muted">
        {state.runtime.encryptedStorage
          ? "密钥使用系统加密保存，不会传回页面。"
          : "系统加密不可用，密钥仅本次运行有效。"}{" "}
        语音服务单独计费，不保存录音。
      </p>
      <div className="button-row">
        <button className="primary" disabled={busy} onClick={() => void save()}>
          {saved ? <Check size={16} /> : null}
          {saved ? "语音连接已保存" : "保存语音连接"}
        </button>
        <button
          disabled={
            busy ||
            !state.voiceConfig.hasKey ||
            !!key ||
            model !== state.voiceConfig.model ||
            workspace !== state.voiceConfig.workspaceId
          }
          onClick={async () => {
            setBusy(true);
            setTesting(true);
            setTestResult(null);
            try {
              const result = await run({ type: "voice:test" });
              setTestResult({
                ok: result.ok,
                text: result.ok
                  ? `连接测试成功：${state.voiceConfig.model}。现在可以开始语音识别。`
                  : `连接测试失败：${result.error || result.text || "请检查语音配置后重试"}`,
              });
            } catch {
              setTestResult({ ok: false, text: "连接测试失败：无法连接桌面服务，请重试。" });
            } finally {
              setBusy(false);
              setTesting(false);
            }
          }}
        >
          {testing ? "正在测试连接…" : "测试语音连接"}
        </button>
      </div>
      {testResult && (
        <div
          ref={resultRef}
          className={testResult.ok ? "info-box" : "error-box"}
          role={testResult.ok ? "status" : "alert"}
          aria-label="语音连接测试结果"
        >
          {testResult.text}
        </div>
      )}
    </section>
  );
}
export function VoiceStatus({ voice, run }: { voice: VoiceRuntime; run: Run }) {
  const running = ["connecting", "listening", "reconnecting"].includes(
    voice.status,
  );
  if (!running && !voice.error) return null;
  return (
    <div className="voice-status" role="status">
      <Radio size={14} />
      <span>
        {VOICE_LABELS[voice.status]}
        {voice.queued ? ` · 待回答 ${voice.queued}` : ""}
      </span>
      {running && (
        <button
          onClick={() => void run({ type: "voice:stop" })}
          title="停止会议识别"
        >
          <Square size={12} />
          停止识别
        </button>
      )}
      {voice.error && <small>{voice.error}</small>}
    </div>
  );
}
export function TranscriptList({
  session,
  run,
  live,
}: {
  session: Session;
  run: Run;
  live?: VoiceRuntime;
}) {
  const [items, setItems] = useState<Transcript[]>([]);
  const [before, setBefore] = useState<number>();
  const [cursor, setCursor] = useState<{ sessionId: string; before: number }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [answering, setAnswering] = useState("");
  const pageCursor =
    cursor?.sessionId === session.id ? cursor.before : undefined;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void window.api
      .transcripts(session.id, pageCursor)
      .then((page) => {
        if (!cancelled) {
          setItems(page.items);
          setBefore(page.before);
        }
      })
      .catch(() => {
        if (!cancelled) setError("转写记录加载失败，请稍后重试");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session.id, session.transcriptRevision, pageCursor]);
  return (
    <div className="transcript-area">
      <div className="button-row">
        {before !== undefined && (
          <button
            disabled={loading}
            onClick={() => setCursor({ sessionId: session.id, before })}
          >
            {loading ? "加载中…" : "更早转写"}
          </button>
        )}
        {pageCursor !== undefined && (
          <button disabled={loading} onClick={() => setCursor(undefined)}>
            回到最新转写
          </button>
        )}
      </div>
      {!items.length && (
        <p className="muted">
          {live ? "识别到的会议文字会显示在这里。" : "这场会话没有会议转写。"}
        </p>
      )}
      <ol className="transcript-list">
        {items.map((row) => (
          <li
            key={row.id}
            className={row.kind === "gap" ? "transcript-gap" : ""}
          >
            <time>{new Date(row.at).toLocaleTimeString()}</time>
            <p>{row.text}</p>
            {row.roundId && (
              <small>
                已关联问题：
                {session.rounds.find((r) => r.id === row.roundId)?.question ||
                  row.roundId}
              </small>
            )}
            {row.kind === "speech" && session.status === "ongoing" && (
              <button
                disabled={!!answering}
                onClick={async () => {
                  setAnswering(row.id);
                  try {
                    await run({
                      type: "voice:answer",
                      sessionId: session.id,
                      transcriptId: row.id,
                    });
                  } finally {
                    setAnswering("");
                  }
                }}
              >
                {answering === row.id ? "正在回答…" : "作为问题回答"}
              </button>
            )}
          </li>
        ))}
      </ol>
      {live?.partial && (
        <p className="transcript-partial" aria-live="polite">
          {live.partial}
          <small> · 正在转写</small>
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export function VoicePanel({ state, run }: { state: DesktopState; run: Run }) {
  const voice = state.runtime.voice;
  const session = state.sessions.find((s) => s.id === state.activeSessionId);
  const running = ["connecting", "listening", "reconnecting"].includes(
    voice.status,
  );
  return (
    <section className="card voice-panel">
      <div className="section-heading">
        <div>
          <h3>
            <Mic size={18} /> 会议识别
          </h3>
          <p>系统声音实时转文字，完整问题自动回答</p>
        </div>
        <button
          className={running ? "" : "primary"}
          disabled={
            window.api.platform !== "darwin" ||
            session?.status === "paused" ||
            (!running && !state.voiceConfig.hasKey)
          }
          onClick={() =>
            void run({ type: running ? "voice:stop" : "voice:start" })
          }
        >
          {running ? <Square size={14} /> : <Play size={14} />}
          {running ? "停止会议识别" : "开始会议识别"}
        </button>
      </div>
      <div className="voice-options">
        <label>
          <input
            type="checkbox"
            checked={voice.autoAnswer}
            onChange={(e) =>
              void run({ type: "voice:auto", enabled: e.target.checked })
            }
          />
          自动回答完整问题
        </label>
        <meter min={0} max={1} value={voice.level} aria-label="系统音量" />
        <span>{VOICE_LABELS[voice.status]}</span>
      </div>
      <p className="muted">
        {!state.voiceConfig.hasKey
          ? "请先在应用设置中配置百炼语音连接。"
          : "仅采集电脑播放的声音，不启用麦克风。"}
        系统声音会发送给百炼；转写文字和问答保存在本机，不保存录音。其他应用的声音也会被识别。
      </p>
      {voice.error && (
        <p className="error-text" role="alert">
          {voice.error}
        </p>
      )}
      {!!voice.queued && <p className="muted">待回答 {voice.queued} 个问题</p>}
      {session && <TranscriptList session={session} run={run} live={voice} />}
    </section>
  );
}
