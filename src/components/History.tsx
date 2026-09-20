import { useState } from "react";
import {
  Download,
  Trash2,
  Sparkles,
  History as HistoryIcon,
} from "lucide-react";
import type { DesktopState } from "../types";
import type { Run } from "./Models";
import { Answer } from "./Answer";
import { Speech } from "./Workspace";
export function History({ state, run }: { state: DesktopState; run: Run }) {
  const sessions = state.sessions.filter((s) => s.status === "completed");
  const [selected, setSelected] = useState("");
  const session = sessions.find((s) => s.id === selected) || sessions[0];
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>练习有记录，进步有方向</h2>
          <p>回看你的实际作答，找到下一次可以做得更好的地方。</p>
        </div>
        <span className="tag">{sessions.length} 场已完成</span>
      </div>
      {!session ? (
        <div className="empty card">
          <HistoryIcon size={40} />
          <h3>还没有完成的练习</h3>
          <p>在工作台结束会话后，记录会自动保存在这里。</p>
        </div>
      ) : (
        <div className="history-grid">
          <aside className="card history-list">
            {sessions.map((s) => (
              <button
                key={s.id}
                className={s.id === session.id ? "active" : ""}
                onClick={() => setSelected(s.id)}
              >
                <strong>{s.name}</strong>
                <small>
                  {new Date(s.createdAt).toLocaleString()} · {s.rounds.length}{" "}
                  题
                </small>
              </button>
            ))}
          </aside>
          <div>
            <section className="card">
              <div className="section-heading">
                <h3>{session.name}</h3>
                <div className="button-row">
                  <button
                    aria-label="导出会话"
                    onClick={() =>
                      void run({ type: "session:export", id: session.id })
                    }
                  >
                    <Download size={15} />
                  </button>
                  <button
                    aria-label="删除会话"
                    onClick={() => {
                      if (confirm("删除这场练习及全部回合？"))
                        void run({ type: "session:delete", id: session.id });
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <button
                className="primary"
                disabled={
                  !!state.runtime.jobs[`evaluation:${session.id}`] ||
                  !session.rounds.length
                }
                onClick={() =>
                  void run({ type: "session:evaluate", id: session.id })
                }
              >
                <Sparkles size={16} />
                {state.runtime.jobs[`evaluation:${session.id}`]
                  ? "正在分析…"
                  : session.evaluation
                    ? "重新复盘"
                    : "生成 AI 复盘"}
              </button>
              {!session.rounds.some((r) => r.userSpeech.trim()) && (
                <p className="muted">
                  尚未记录实际作答，复盘将分析参考答案，不评价个人表现。
                </p>
              )}
              {session.evaluation && (
                <div className="evaluation">
                  <div className="score">
                    {session.evaluation.overallScore === null ? (
                      "参考分析"
                    ) : (
                      <>
                        {session.evaluation.overallScore}
                        <small>/ 100</small>
                      </>
                    )}
                  </div>
                  <p>{session.evaluation.summary}</p>
                  <div className="two-columns">
                    <div>
                      <h4>优势与亮点</h4>
                      <ul>
                        {session.evaluation.strengths.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4>下一步改进</h4>
                      <ul>
                        {session.evaluation.weaknesses.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  {session.evaluation.qaAnalysis.map((q, i) => (
                    <details key={i}>
                      <summary>{q.question}</summary>
                      <p>
                        <b>实际回答：</b>
                        {q.actualResponse || "未记录"}
                      </p>
                      <p>
                        <b>参考回答：</b>
                        {q.modelResponse}
                      </p>
                      <p>
                        <b>改进建议：</b>
                        {q.improvement}
                      </p>
                    </details>
                  ))}
                </div>
              )}
            </section>
            {session.rounds.map((r, i) => (
              <details className="card round-detail" key={r.id}>
                <summary>
                  {i + 1}. {r.question}
                </summary>
                <Speech key={r.id} round={r} sessionId={session.id} run={run} />
                {r.image && (
                  <div className="screenshot-preview">
                    <img src={r.image} alt="该回合的题目截图" />
                  </div>
                )}
                {r.answer ? (
                  <Answer answer={r.answer} />
                ) : (
                  <p className="muted">该回合未生成参考答案。</p>
                )}
              </details>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
