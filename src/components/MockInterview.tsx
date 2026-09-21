import { useEffect, useRef, useState } from "react";
import { Mic, Play, Square, Upload, GraduationCap } from "lucide-react";
import {
  MOCK_LEVELS,
  MOCK_RUBRICS,
  MOCK_DIMENSIONS,
  MOCK_BAND_LABELS,
  mockBand,
  mockElapsed,
  type DesktopState,
  type MockSetup,
  type MockInterviewSession,
  type MockInterviewTurn,
} from "../types";
import type { Run } from "./Models";
import { prepareResume } from "../resume-upload";

function referenceText(t: MockInterviewTurn) {
  return (
    t.analysis?.reference.map((p) => p.heading + "\n" + p.text).join("\n\n") ||
    ""
  );
}
function Report({
  session: s,
  run,
  busy,
}: {
  session: MockInterviewSession;
  run: Run;
  busy: boolean;
}) {
  const r = s.report;
  return (
    <div className="mock-report">
      <section className="card">
        <div className="mock-heading">
          <div>
            <h3>面试复盘</h3>
            <p>
              {r?.status === "complete"
                ? "报告已完成并保存到本机"
                : "报告尚未全部完成，已完成内容会自动保存"}
            </p>
          </div>
          <div className="button-row">
            <button
              disabled={busy}
              onClick={() => void run({ type: "mock:report", id: s.id })}
            >
              生成／重试报告
            </button>
            <button onClick={() => void run({ type: "mock:export", id: s.id })}>
              导出 Markdown
            </button>
          </div>
        </div>
        <div className="mock-scoreline">
          <strong className={"mock-score " + mockBand(r?.overallScore ?? null)}>
            {r?.overallScore ?? "—"}
            <small> / 100</small>
          </strong>
          <span>
            已答主问题 {r?.answered ?? 0} / {r?.total ?? 0}
            <br />
            追问归入对应主问题，未作答不虚构评分
          </span>
        </div>
        <p>{r?.summary || "正在等待完整分析。"}</p>
        {r?.error && (
          <p role="alert" className="error-text">
            {r.error}
          </p>
        )}
        <div className="mock-summary-grid">
          {[
            ["优势", r?.strengths],
            ["短板", r?.weaknesses],
            ["下次训练", r?.nextSteps],
          ].map(([label, items]) => (
            <div key={label as string}>
              <h4>{label as string}</h4>
              <ul>
                {(items as string[] | undefined)?.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="muted">
          绿色：充分（80–100） · 黄色：待加强（60–79） ·
          红色：明显不足（低于60） · 灰色：待补充／不适用。仅作训练参考。
        </p>
      </section>
      {s.turns.map((t, i) => (
        <section className="card mock-review" key={t.id}>
          <h3>
            {i + 1}. {t.parentId && <small>追问 · </small>}
            {t.question}
          </h3>
          <h4>你的原回答</h4>
          <p className="mock-prose">
            {t.status === "skipped" ? "未作答" : t.answer}
          </p>
          {t.status === "skipped" && t.draft && (
            <details>
              <summary>保留的未提交草稿（未计入评分）</summary>
              <p className="mock-prose">{t.draft}</p>
            </details>
          )}
          {t.status === "answered" && !t.analysis && (
            <p className="error-text">{t.analysisError || "等待分析"}</p>
          )}
          {t.status === "answered" && (
            <button
              disabled={busy}
              onClick={() =>
                void run({ type: "mock:report", id: s.id, turnId: t.id })
              }
            >
              重新分析本题
            </button>
          )}
          {t.analysis && (
            <>
              <div className="mock-dimensions">
                {t.analysis.dimensions.map((d) => (
                  <div
                    key={d.id}
                    className={"mock-dimension " + mockBand(d.score)}
                  >
                    <strong>
                      {MOCK_DIMENSIONS.find((x) => x.id === d.id)?.label}
                    </strong>
                    <span>
                      {d.status === "na"
                        ? "不适用"
                        : MOCK_BAND_LABELS[mockBand(d.score)]}
                      {d.score !== null && " · " + d.score}
                    </span>
                    <p>{d.reason}</p>
                    {d.evidence && <blockquote>“{d.evidence}”</blockquote>}
                  </div>
                ))}
              </div>
              <h4>问题与改进</h4>
              <p className="mock-prose">{t.analysis.improvement}</p>
              <div className="mock-heading">
                <h4>参考答案 · 可直接口述</h4>
                <button
                  onClick={() =>
                    void run({
                      type: "clipboard:write",
                      text: referenceText(t),
                    })
                  }
                >
                  复制本题答案
                </button>
              </div>
              {t.analysis.reference.map((p, j) => (
                <div key={j}>
                  <h4>{p.heading}</h4>
                  <p className="mock-prose">{p.text}</p>
                </div>
              ))}
              {!!t.analysis.metrics.length && (
                <div className="mock-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {[
                          "指标",
                          "基线",
                          "结果",
                          "时间范围",
                          "统计口径",
                          "原文依据",
                        ].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {t.analysis.metrics.map((m, j) => (
                        <tr key={j}>
                          {[
                            m.name,
                            m.baseline,
                            m.result,
                            m.period,
                            m.scope,
                            m.evidence || "待补充",
                          ].map((v, k) => (
                            <td key={k}>{v}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!!t.analysis.missing.length && (
                <div className="mock-missing">
                  <h4>需要你补充的事实</h4>
                  <ul>
                    {t.analysis.missing.map((v, j) => (
                      <li key={j}>{v}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      ))}
    </div>
  );
}
export function MockInterview({
  state,
  run,
}: {
  state: DesktopState;
  run: Run;
}) {
  const sessions = state.mockInterviews;
  const [selected, setSelected] = useState(
    () =>
      sessions.find((s) => ["ongoing", "paused", "draft"].includes(s.status))
        ?.id || "",
  );
  const [setup, setSetup] = useState<MockSetup>({
    resume: "",
    jd: "",
    role: "",
    level: "P6",
    minutes: 30,
    mode: "text",
  });
  const [working, setWorking] = useState(false);
  const [hint, setHint] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [now, setNow] = useState(Date.now());
  const file = useRef<HTMLInputElement>(null);
  const speakEpoch = useRef(0);
  const live = useRef({ selected, status: "" });
  const s = sessions.find((s) => s.id === selected);
  const t = s?.turns.find((t) => t.status === "waiting");
  const runtime = state.runtime.mock;
  const busy = !!runtime.busy || working;
  const activeMic = runtime.sessionId === selected && runtime.mic !== "off";
  live.current = { selected, status: s?.status || "" };
  const latest = useRef({ s, t, run });
  latest.current = { s, t, run };
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    const update = () =>
      setVoices(
        (window.speechSynthesis?.getVoices() || []).filter(
          (v) => /^zh/i.test(v.lang) && v.localService,
        ),
      );
    update();
    window.speechSynthesis?.addEventListener("voiceschanged", update);
    return () => {
      clearInterval(timer);
      window.speechSynthesis?.removeEventListener("voiceschanged", update);
    };
  }, []);
  useEffect(
    () => () => {
      speakEpoch.current++;
      window.speechSynthesis?.cancel();
      if (live.current.status === "ongoing")
        void latest.current.run({
          type: "mock:pause",
          id: live.current.selected,
        });
    },
    [],
  );
  function stopSpeaking() {
    speakEpoch.current++;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }
  async function speak(value: string, listenAfter = false) {
    stopSpeaking();
    const epoch = speakEpoch.current;
    const voice = voices.find((v) => v.voiceURI === voiceURI) || voices[0];
    if (!voice || !window.speechSynthesis) {
      setHint(
        "未发现系统本地中文音色，可在系统设置安装中文声音；当前可继续文字作答。",
      );
      return;
    }
    if (selected) await run({ type: "mock:mic-stop", id: selected });
    if (epoch !== speakEpoch.current) return;
    const utterance = new SpeechSynthesisUtterance(value);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    setSpeaking(true);
    utterance.onend = () => {
      if (epoch !== speakEpoch.current) return;
      setSpeaking(false);
      const current = latest.current;
      if (
        listenAfter &&
        current.s?.status === "ongoing" &&
        current.t?.id === t?.id
      )
        void current.run({ type: "mock:listen", id: current.s.id });
    };
    utterance.onerror = () => {
      if (epoch !== speakEpoch.current) return;
      setSpeaking(false);
      setHint("朗读失败，可点击开始回答，或使用文字作答。");
    };
    window.speechSynthesis.speak(utterance);
  }
  useEffect(() => {
    if (s?.status === "ongoing" && s.setup.mode === "voice" && t)
      void speak(t.question, true);
    return () => {
      speakEpoch.current++;
      window.speechSynthesis?.cancel();
      setSpeaking(false);
    };
    // Read each new/current question once, never replay on transcript updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.id, s?.status, t?.id]);
  async function upload(uploaded?: File) {
    if (!uploaded) return;
    setWorking(true);
    setHint("");
    try {
      const upload = await prepareResume(uploaded, setHint);
      const result = await run({ type: "materials:import-resume", upload });
      if (result.ok && result.text) {
        setSetup((p) => ({ ...p, resume: result.text! }));
        setHint("简历已解析，请核对内容。");
      }
    } catch (e) {
      setHint(e instanceof Error ? e.message : "简历解析失败");
    } finally {
      setWorking(false);
      if (file.current) file.current.value = "";
    }
  }
  async function detectRole() {
    if (!setup.jd.trim()) return;
    const jd = setup.jd;
    setWorking(true);
    try {
      const result = await run({ type: "mock:role", jd: setup.jd });
      if (result.ok && result.text)
        setSetup((p) => (p.jd === jd ? { ...p, role: result.text! } : p));
    } finally {
      setWorking(false);
    }
  }
  async function start() {
    setWorking(true);
    setHint("");
    try {
      const result = await run({ type: "mock:create", setup });
      if (result.ok && result.text) {
        setSelected(result.text);
        await run({ type: "mock:start", id: result.text });
      }
    } finally {
      setWorking(false);
    }
  }
  async function action(
    type: "mock:pause" | "mock:resume" | "mock:end" | "mock:skip",
  ) {
    if (!s) return;
    stopSpeaking();
    await run({ type, id: s.id });
  }
  return (
    <div className="mock-page">
      <div className="mock-heading">
        <div>
          <span className="eyebrow">AI INTERVIEW PRACTICE</span>
          <h3>
            <GraduationCap size={23} /> 把每次回答，变成下一次的底气
          </h3>
          <p className="muted">
            基于你的简历与目标岗位，逐题提问、深入追问，面试结束后统一复盘。
          </p>
        </div>
        <button
          disabled={!!s && ["ongoing", "paused"].includes(s.status)}
          onClick={() => {
            stopSpeaking();
            setSelected("");
          }}
        >
          新建模拟面试
        </button>
      </div>
      <label>
        面试记录
        <select
          aria-label="面试记录"
          value={selected}
          disabled={activeMic || speaking || busy || s?.status === "ongoing"}
          onChange={(e) => {
            stopSpeaking();
            setSelected(e.target.value);
          }}
        >
          <option value="">准备新面试</option>
          {sessions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.setup.role} · {MOCK_LEVELS[v.setup.level]} ·{" "}
              {new Date(v.createdAt).toLocaleString()} ·{" "}
              {v.status === "completed"
                ? "已结束"
                : v.status === "paused"
                  ? "已暂停"
                  : v.status === "draft"
                    ? "待开始"
                    : "进行中"}
            </option>
          ))}
        </select>
      </label>
      {hint && (
        <p role="status" className="info-box">
          {hint}
        </p>
      )}
      {runtime.error && (
        <p role="alert" className="error-box">
          {runtime.error}
        </p>
      )}
      {runtime.busy && (
        <p role="status" className="info-box">
          {runtime.busy}…
        </p>
      )}
      {!s ? (
        <section className="card mock-setup">
          <div className="mock-heading">
            <h3>准备面试资料</h3>
            <button
              disabled={busy}
              onClick={() =>
                setSetup((p) => ({
                  ...p,
                  resume: state.materials.resume,
                  jd: state.materials.jd,
                }))
              }
            >
              从资料库导入
            </button>
          </div>
          <div className="mock-form-grid">
            <label>
              个人简历
              <textarea
                aria-label="模拟面试简历"
                value={setup.resume}
                maxLength={50000}
                rows={10}
                onChange={(e) => setSetup({ ...setup, resume: e.target.value })}
                placeholder="上传简历，或粘贴经历、职责和成果"
              />
            </label>
            <label>
              目标岗位 JD
              <textarea
                aria-label="目标岗位 JD"
                value={setup.jd}
                maxLength={50000}
                rows={10}
                onChange={(e) => setSetup({ ...setup, jd: e.target.value })}
                onBlur={() => {
                  if (!setup.role) void detectRole();
                }}
                placeholder="粘贴岗位职责与任职要求"
              />
            </label>
          </div>
          <input
            ref={file}
            type="file"
            hidden
            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
          <button disabled={busy} onClick={() => file.current?.click()}>
            <Upload size={16} /> 上传简历
          </button>
          <small className="muted">
            {" "}
            PDF／Word／图片，不超过20MB，PDF最多10页
          </small>
          <div className="mock-form-grid">
            <label>
              目标岗位
              <input
                aria-label="目标岗位"
                maxLength={100}
                value={setup.role}
                onChange={(e) => setSetup({ ...setup, role: e.target.value })}
              />
            </label>
            <button
              disabled={busy || !setup.jd.trim()}
              onClick={() => void detectRole()}
            >
              根据 JD 识别岗位
            </button>
            <label>
              面试难度
              <select
                aria-label="面试难度"
                value={setup.level}
                onChange={(e) =>
                  setSetup({
                    ...setup,
                    level: e.target.value as MockSetup["level"],
                  })
                }
              >
                {Object.entries(MOCK_LEVELS).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              面试时长
              <select
                aria-label="面试时长"
                value={setup.minutes}
                onChange={(e) =>
                  setSetup({
                    ...setup,
                    minutes: Number(e.target.value) as MockSetup["minutes"],
                  })
                }
              >
                {[15, 30, 45].map((v) => (
                  <option key={v} value={v}>
                    {v} 分钟
                  </option>
                ))}
              </select>
            </label>
            <label>
              作答方式
              <select
                aria-label="作答方式"
                value={setup.mode}
                onChange={(e) =>
                  setSetup({
                    ...setup,
                    mode: e.target.value as MockSetup["mode"],
                  })
                }
              >
                <option value="text">文字作答</option>
                <option value="voice">语音面试</option>
              </select>
            </label>
          </div>
          <p>{MOCK_RUBRICS[setup.level]}</p>
          <p className="muted">
            CoMind
            训练档位，不代表阿里官方考核标准。资料和回答会发送至所选模型；语音转写使用已配置的百炼服务，不保存原始录音。
          </p>
          <button
            className="primary"
            disabled={
              busy ||
              !setup.resume.trim() ||
              !setup.jd.trim() ||
              !setup.role.trim()
            }
            onClick={() => void start()}
          >
            <Play size={16} /> 开始模拟面试
          </button>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="mock-heading">
              <div>
                <h3>
                  {s.setup.role} · {MOCK_LEVELS[s.setup.level]}
                </h3>
                <p>
                  {s.model.name} · {s.setup.minutes} 分钟 · 已进行{" "}
                  {Math.floor(mockElapsed(s, now) / 60000)} 分{" "}
                  {Math.floor(mockElapsed(s, now) / 1000) % 60} 秒
                </p>
              </div>
              {s.status !== "completed" && (
                <div className="button-row">
                  {s.status === "ongoing" ? (
                    <button onClick={() => void action("mock:pause")}>
                      暂停面试
                    </button>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() => void action("mock:resume")}
                    >
                      {s.status === "draft" ? "开始面试" : "继续面试"}
                    </button>
                  )}
                  <button
                    disabled={runtime.mic === "settling"}
                    onClick={() => void action("mock:end")}
                  >
                    结束并复盘
                  </button>
                </div>
              )}
            </div>
            {s.status === "ongoing" &&
              mockElapsed(s, now) >= s.setup.minutes * 60000 && (
                <p className="notice">
                  计划时间已到，完成当前回答后将自动收尾；也可提前结束。
                </p>
              )}
            {s.status === "paused" && (
              <p className="notice">
                面试已暂停，麦克风已停止。点击继续面试恢复。
              </p>
            )}
            <details>
              <summary>本场资料快照</summary>
              <h4>简历</h4>
              <p className="mock-prose">{s.setup.resume}</p>
              <h4>JD</h4>
              <p className="mock-prose">{s.setup.jd}</p>
            </details>
          </section>
          {s.status !== "completed" && (
            <section className="card">
              <h3>
                {t
                  ? t.parentId
                    ? "面试官追问"
                    : "面试官提问"
                  : "准备下一道题"}
              </h3>
              <p className="mock-question">
                {t?.question || "问题生成失败时，可以重试；已有回答已保存。"}
              </p>
              {!t && s.status === "ongoing" && (
                <button
                  disabled={busy}
                  onClick={() => void run({ type: "mock:next", id: s.id })}
                >
                  生成下一题
                </button>
              )}
              {t && (
                <>
                  <label>
                    你的回答
                    <textarea
                      aria-label="你的回答"
                      rows={8}
                      value={t.draft}
                      maxLength={20000}
                      disabled={busy || runtime.mic === "settling"}
                      placeholder="说出或写下你的真实思路、个人行动与成果。"
                      onChange={(e) =>
                        void run({
                          type: "mock:draft",
                          id: s.id,
                          turnId: t.id,
                          text: e.target.value,
                        })
                      }
                    />
                  </label>
                  {runtime.partial && activeMic && (
                    <p className="mock-partial" aria-live="polite">
                      正在转写：{runtime.partial}
                    </p>
                  )}
                  {runtime.countdown && activeMic && (
                    <div role="status" className="notice">
                      回答已完整，
                      {Math.max(0, Math.ceil((runtime.countdown - now) / 1000))}{" "}
                      秒后提交。
                      <button
                        onClick={() =>
                          void run({ type: "mock:continue", id: s.id })
                        }
                      >
                        继续回答
                      </button>
                    </div>
                  )}
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        s.status !== "ongoing" ||
                        runtime.mic === "connecting" ||
                        runtime.mic === "settling" ||
                        (!t.draft.trim() && !activeMic)
                      }
                      onClick={() => {
                        stopSpeaking();
                        void run({
                          type: "mock:submit",
                          id: s.id,
                          turnId: t.id,
                        });
                      }}
                    >
                      我答完了
                    </button>
                    <button
                      disabled={
                        busy ||
                        s.status !== "ongoing" ||
                        runtime.mic === "settling"
                      }
                      onClick={() => void action("mock:skip")}
                    >
                      跳过本题
                    </button>
                  </div>
                  <p className="muted">
                    面试进行中不展示答案或评分；结束后统一复盘。提前结束会保留尚未提交的草稿，但不计入评分。
                  </p>
                </>
              )}
            </section>
          )}
          {s.status === "completed" && (
            <Report session={s} run={run} busy={busy} />
          )}
          {s.status !== "completed" &&
            !!s.turns.filter((v) => v.status !== "waiting").length && (
              <details className="card">
                <summary>已完成问答（结束后展示评分）</summary>
                {s.turns
                  .filter((v) => v.status !== "waiting")
                  .map((v) => (
                    <div key={v.id}>
                      <h4>{v.question}</h4>
                      <p className="mock-prose">
                        {v.status === "skipped" ? "未作答" : v.answer}
                      </p>
                    </div>
                  ))}
              </details>
            )}
        </>
      )}
      {(!s || s.status !== "completed") && (
        <section className="card mock-voice-controls">
          <h3>
            <Mic size={18} /> 语音面试
          </h3>
          <div className="button-row">
            <select
              aria-label="系统中文音色"
              value={voiceURI}
              onChange={(e) => setVoiceURI(e.target.value)}
            >
              <option value="">系统默认中文音色</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                </option>
              ))}
            </select>
            <button
              disabled={activeMic || busy}
              onClick={() =>
                void speak(
                  "你好，我是 CoMind 面试官。让我们从你的项目经历开始。",
                )
              }
            >
              试听
            </button>
            <button disabled={!speaking} onClick={stopSpeaking}>
              <Square size={14} /> 停止朗读
            </button>
            {s && t && (
              <>
                <button
                  disabled={busy || s.status !== "ongoing"}
                  onClick={() => void speak(t.question)}
                >
                  重播问题
                </button>
                <button
                  disabled={
                    busy ||
                    s.status !== "ongoing" ||
                    activeMic ||
                    !state.voiceConfig.hasKey
                  }
                  onClick={() => {
                    stopSpeaking();
                    void run({ type: "mock:listen", id: s.id });
                  }}
                >
                  <Mic size={15} /> 开始回答
                </button>
                <button
                  disabled={!activeMic || runtime.mic === "settling"}
                  onClick={() => void run({ type: "mock:mic-stop", id: s.id })}
                >
                  停止麦克风
                </button>
              </>
            )}
          </div>
          <p role="status">
            {speaking
              ? "面试官正在提问…"
              : activeMic
                ? {
                    connecting: "正在连接麦克风…",
                    listening: "正在听你回答",
                    settling: "正在等待最后一段转写…",
                    off: "",
                  }[runtime.mic]
                : "麦克风未开启"}
          </p>
          {!voices.length && (
            <p className="muted">未发现本地中文音色，文字功能仍可使用。</p>
          )}
          {!state.voiceConfig.hasKey && (
            <p className="muted">
              请在「应用设置」配置百炼语音连接以启用语音识别；文字面试无需语音配置。
            </p>
          )}
        </section>
      )}
    </div>
  );
}
