import type { InterviewScript } from "../types";
export function isAlgorithmAnswer(answer: InterviewScript) {
  return (
    answer.kind === "algorithm" ||
    (!answer.kind && /^(O|Θ|Ω)\s*\(/.test(answer.time_complexity.trim()))
  );
}
export function Answer({
  answer,
  compact = false,
}: {
  answer: InterviewScript;
  compact?: boolean;
}) {
  const algorithm = isAlgorithmAnswer(answer);
  if (compact)
    return (
      <div className="answer-content compact-answer">
        {algorithm ? (
          <>
            <section>
              <h3>思路</h3>
              <p>{answer.approach || answer.summary}</p>
            </section>
            <section>
              <h3>{answer.kind === "algorithm" ? "Java 实现" : "代码实现"}</h3>
              <pre>
                <code>{answer.code}</code>
              </pre>
            </section>
          </>
        ) : (
          <section>
            <p>{answer.summary}</p>
          </section>
        )}
      </div>
    );
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
      )
        .filter(([key]) => answer[key].trim())
        .map(([key, label], i) => (
          <section key={key}>
            <h3>
              <span>{String(i + 1).padStart(2, "0")}</span>
              {key === "code" && answer.kind === "algorithm"
                ? "Java 实现"
                : label}
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
      {algorithm && (
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
      )}
    </div>
  );
}
