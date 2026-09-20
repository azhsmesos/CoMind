import type { InterviewScript } from "../types";
export function Answer({ answer }: { answer: InterviewScript }) {
  return (
    <div className="answer-content">
      <div className="summary-block">
        <span className="eyebrow">核心结论</span>
        <p>{answer.summary}</p>
      </div>
      {(
        [
          ["problem", "复述题目"],
          ["clarify", "先问清楚"],
          ["approach", "展开思路"],
          ["code", "代码 / 回答提纲"],
          ["walkthrough", "举个例子"],
        ] as const
      ).map(([key, label], i) => (
        <section key={key}>
          <h3>
            <span>{String(i + 1).padStart(2, "0")}</span>
            {label}
          </h3>
          {key === "code" ? (
            <pre>
              <code>{answer[key]}</code>
            </pre>
          ) : (
            <p>{answer[key]}</p>
          )}
        </section>
      ))}
      <div className="complexity">
        <div>
          <small>时间复杂度</small>
          <p>{answer.time_complexity}</p>
        </div>
        <div>
          <small>空间复杂度</small>
          <p>{answer.space_complexity}</p>
        </div>
      </div>
    </div>
  );
}
