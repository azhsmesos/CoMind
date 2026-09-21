import { MobileShare } from "./MobileShare";
import { VoicePanel } from "./Voice";
import { useEffect, useState } from "react";
import {
  Play,
  Pause,
  Square,
  Sparkles,
  Copy,
  ExternalLink,
  Monitor,
  ArrowUpRight,
  PenLine,
  MessageSquare,
  CircleCheck,
  LoaderCircle,
  Camera,
} from "lucide-react";
import type { DesktopState, Round, Session } from "../types";
import type { Run } from "./Models";
import { Answer } from "./Answer";
export function Speech({
  round,
  sessionId,
  run,
}: {
  round: Round;
  sessionId: string;
  run: Run;
}) {
  const [text, setText] = useState(round.userSpeech);
  const [saved, setSaved] = useState(true);
  return (
    <div className="speech-editor">
      <label>
        我的实际作答 <small>用于真实复盘，可在练习后补充</small>
        <textarea
          value={text}
          maxLength={25000}
          rows={3}
          placeholder="记录你自己的回答，AI 参考答案不会自动计为实际作答。"
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
        />
      </label>
      <button
        disabled={saved}
        onClick={async () => {
          const r = await run({
            type: "round:speech",
            sessionId,
            roundId: round.id,
            text,
          });
          if (r.ok) setSaved(true);
        }}
      >
        {saved ? "已保存" : "保存作答"}
      </button>
    </div>
  );
}
export function Workspace({
  state,
  run,
  openSettings,
}: {
  state: DesktopState;
  run: Run;
  openSettings: () => void;
}) {
  const session = state.sessions.find((s) => s.id === state.activeSessionId);
  const [question, setQuestion] = useState("");
  const [selected, setSelected] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setSelected(session?.rounds.at(-1)?.id || "");
  }, [session?.id, session?.rounds.length]);
  const round =
    session?.rounds.find((r) => r.id === selected) || session?.rounds.at(-1);
  const model = state.models.find((m) => m.id === state.activeModelId);
  async function submit() {
    const text = question.trim();
    if (!text) return;
    setQuestion("");
    await run({ type: "question:add", text });
  }
  return (
    <>
      <div className="workspace-intro">
        <div>
          <span className="eyebrow">YOUR WORK, WITH COMIND</span>
          <h2>让每一份信息，都成为工作的助力。</h2>
          <p>与 CoMind 一起理解图片、整理资料，获得清晰、有依据的回答。</p>
        </div>
        <button
          className="outline"
          onClick={() => void run({ type: "overlay:toggle" })}
        >
          <ExternalLink size={16} />
          {state.runtime.overlayVisible ? "隐藏悬浮窗" : "打开悬浮窗"}
        </button>
      </div>
      <div className="status-strip">
        <span className={model?.hasKey ? "status good" : "status"}>
          <i />
          {model?.hasKey ? model.name : "模型待配置"}
          <button className="text-button" onClick={openSettings}>
            设置
            <ArrowUpRight size={12} />
          </button>
        </span>
        <span className={state.runtime.paired ? "status good" : "status"}>
          <Monitor size={14} />
          {state.runtime.paired ? "浏览器已配对" : "浏览器待连接"}
        </span>
        <span className="last-capture">
          {state.runtime.lastCapture
            ? `最近采集 ${new Date(state.runtime.lastCapture).toLocaleTimeString()} · ${state.runtime.lastPage || ""}`
            : "支持网页采集与手动输入"}
        </span>
      </div>
      <MobileShare state={state} run={run} />
      <VoicePanel state={state} run={run} />
      {!session ? (
        <section className="card start-session">
          <div className="start-icon">
            <MessageSquare size={28} />
          </div>
          <h2>与 CoMind 开启新的会话</h2>
          <p>你的资料、参考答案和实际作答，会在同一场会话中整理归档。</p>
          <button
            className="primary"
            onClick={() => void run({ type: "session:create" })}
          >
            <Play size={16} />
            开始会话
          </button>
          <small>也可以直接输入题目，或通过浏览器扩展发送。</small>
        </section>
      ) : (
        <div className="session-bar">
          <div>
            <span
              className={`status ${session.status === "ongoing" ? "good" : ""}`}
            >
              <i />
              {session.status === "ongoing" ? "会话进行中" : "已暂停"}
            </span>
            <strong>{session.name}</strong>
            <small>
              {session.rounds.length} 个回合
              {session.pending.length
                ? ` · ${session.pending.length} 道待处理题目`
                : ""}
            </small>
          </div>
          <div className="button-row">
            <button
              onClick={() =>
                void run({
                  type:
                    session.status === "paused"
                      ? "session:resume"
                      : "session:pause",
                  id: session.id,
                })
              }
            >
              {session.status === "paused" ? (
                <Play size={14} />
              ) : (
                <Pause size={14} />
              )}{" "}
              {session.status === "paused" ? "继续" : "暂停"}
            </button>
            <button
              onClick={() => void run({ type: "session:end", id: session.id })}
            >
              <Square size={13} />
              结束并保存
            </button>
          </div>
        </div>
      )}
      <div className="workspace-grid">
        <section className="card question-pane">
          <div className="section-heading">
            <h3>
              <PenLine size={18} />
              题目与作答
            </h3>
            <span className="tag">{session?.rounds.length || 0} 回合</span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <textarea
              aria-label="输入题目"
              maxLength={25000}
              rows={5}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="粘贴一道题目，或写下你想练习的问题…"
            />
            <button
              className="primary wide"
              disabled={!question.trim() || session?.status === "paused"}
            >
              <Sparkles size={16} />
              添加题目并生成
            </button>
          </form>
          <button
            className="wide screenshot-button"
            disabled={
              !!state.runtime.jobs.screenshot || session?.status === "paused"
            }
            onClick={() => void run({ type: "screenshot:capture" })}
          >
            <Camera size={16} />
            {state.runtime.jobs.screenshot || "截图并自动解答"}
          </button>
          {round?.image && (
            <details className="screenshot-preview">
              <summary>查看题目截图</summary>
              <img src={round.image} alt="当前题目的整屏截图" />
            </details>
          )}
          {session?.status === "paused" && (
            <p className="info-box">采集的题目会暂存，继续会话后依次处理。</p>
          )}
          <div className="round-list">
            {session?.rounds.map((r, i) => (
              <button
                key={r.id}
                className={round?.id === r.id ? "round active" : "round"}
                onClick={() => setSelected(r.id)}
              >
                <span className="round-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong>{r.question}</strong>
                  <small>
                    {r.source === "browser"
                      ? "网页采集"
                      : r.source === "screenshot"
                        ? "截图采集"
                        : r.source === "voice"
                          ? "会议语音"
                          : "手动输入"}{" "}
                    ·{" "}
                    {r.status === "done"
                      ? "已生成"
                      : r.status === "generating"
                        ? "生成中"
                        : r.status === "error"
                          ? "生成失败"
                          : "待生成"}
                  </small>
                </div>
                {r.status === "done" && <CircleCheck size={15} />}
              </button>
            ))}
          </div>
          {round && session && (
            <Speech
              key={round.id}
              round={round}
              sessionId={session.id}
              run={run}
            />
          )}
        </section>
        <section className="card response-pane">
          <div className="section-heading">
            <h3>
              <Sparkles size={18} />
              AI 参考回答
            </h3>
            {round && session && (
              <div className="button-row">
                {round.answer && (
                  <button
                    aria-label="复制回答"
                    onClick={async () => {
                      try {
                        const result = await run({
                          type: "clipboard:write",
                          text: Object.entries(round.answer!)
                            .filter(([key]) => key !== "kind")
                            .map(([, value]) => value)
                            .filter(Boolean)
                            .join("\n\n"),
                        });
                        if (!result.ok) return;
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1800);
                      } catch {
                        alert("复制失败，请手动选择文字复制");
                      }
                    }}
                  >
                    <Copy size={14} />
                    {copied ? "已复制" : "复制"}
                  </button>
                )}
                <button
                  disabled={session.status !== "ongoing"}
                  onClick={() =>
                    void run({
                      type:
                        round.status === "generating"
                          ? "round:cancel"
                          : "round:generate",
                      sessionId: session.id,
                      roundId: round.id,
                    })
                  }
                >
                  {round.status === "generating" ? "取消生成" : "重新生成"}
                </button>
              </div>
            )}
          </div>
          {round?.status === "generating" && (
            <div className="generating" role="status">
              <LoaderCircle className="spin" size={18} />
              正在结合题目与资料组织回答…
            </div>
          )}
          {round?.error && (
            <div className="error-box" role="alert">
              上次生成失败：{round.error}
              {model?.hasKey && (
                <p>当前模型已配置密钥，点击「重新生成」可重试本题。</p>
              )}
            </div>
          )}
          {round?.answer ? (
            <Answer answer={round.answer} />
          ) : (
            <div className="empty answer-empty">
              <div className="empty-orbit">
                <Sparkles size={32} />
              </div>
              <h3>
                {round?.status === "generating"
                  ? "好的回答，始于清晰的思路"
                  : "把问题交给CoMind"}
              </h3>
              <p>
                这里将呈现核心结论、解题路径、
                <br />
                可表达的回答，以及具体示例。
              </p>
              <div className="answer-stages">
                <span>理解题目</span>
                <span>梳理思路</span>
                <span>形成表达</span>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
