import { useRef, useState } from "react";
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Save,
  Sparkles,
  BookOpen,
  Upload,
} from "lucide-react";
import { prepareResume } from "../resume-upload";
import type { Materials as MaterialState, MaterialItem } from "../types";
import type { Run } from "./Models";
export function Materials({
  initial,
  run,
}: {
  initial: MaterialState;
  run: Run;
}) {
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const [tab, setTab] = useState<"background" | "answers" | "scripts">(
    "background",
  );
  const [busy, setBusy] = useState("");
  const [saved, setSaved] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadError, setUploadError] = useState("");
  async function importResume(file: File) {
    setBusy("import");
    setUploadError("");
    setUploadStatus("正在读取简历…");
    try {
      const upload = await prepareResume(file, setUploadStatus);
      setUploadStatus("AI 正在解析简历…");
      const result = await run({ type: "materials:import-resume", upload });
      if (!result.ok) throw new Error(result.error || "简历解析失败");
      if (!result.text) throw new Error("简历解析已取消，请重试");
      change({ resume: result.text });
      setUploadStatus("解析完成，请检查内容后点击「保存资料」。");
    } catch (error) {
      setUploadStatus("");
      setUploadError(
        error instanceof Error ? error.message : "简历解析失败，请重试",
      );
    } finally {
      setBusy("");
    }
  }
  function change(patch: Partial<MaterialState>) {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  }
  function itemChange(index: number, patch: Partial<MaterialItem>) {
    if (tab === "background") return;
    change({
      [tab]: draft[tab].map((v, i) => (i === index ? { ...v, ...patch } : v)),
    });
  }
  function move(index: number, by: number) {
    if (tab === "background") return;
    const next = [...draft[tab]];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    change({ [tab]: next });
  }
  async function save() {
    setBusy("save");
    const r = await run({ type: "materials:save", materials: draft });
    if (r.ok) {
      setSaved(true);
      setUploadStatus("");
    }
    setBusy("");
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>让回答更了解你</h2>
          <p>整理真实经历与目标岗位，生成时会自动参考已保存的资料。</p>
        </div>
        <button
          className="primary"
          disabled={!!busy}
          onClick={() => void save()}
        >
          <Save size={16} />
          {saved ? "已保存" : "保存资料"}
        </button>
      </div>
      <div className="tabs">
        {(
          [
            ["background", "简历与岗位"],
            ["answers", "固定问答"],
            ["scripts", "提词稿"],
          ] as const
        ).map(([key, label]) => (
          <button
            className={key === tab ? "active" : ""}
            key={key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "background" ? (
        <div className="two-columns">
          {(
            [
              ["resume", "个人简历", "粘贴你的项目、职责、成果与技能。"],
              ["jd", "目标岗位 JD", "粘贴岗位描述、任职要求与关注方向。"],
            ] as const
          ).map(([key, title, placeholder]) => (
            <section className="card" key={key}>
              <div className="section-heading">
                <h3>{title}</h3>
                <div className="button-row">
                  {key === "resume" && (
                    <>
                      <input
                        ref={uploadInput}
                        type="file"
                        hidden
                        aria-label="上传简历文件"
                        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) void importResume(file);
                        }}
                      />
                      <button
                        disabled={!!busy}
                        onClick={() => uploadInput.current?.click()}
                      >
                        <Upload size={14} />
                        {busy === "import" ? "解析中…" : "上传并解析"}
                      </button>
                    </>
                  )}
                  <button
                    disabled={!!busy || !draft[key].trim()}
                    onClick={async () => {
                      setBusy(key);
                      const r = await run({
                        type: "materials:optimize",
                        field: key,
                        text: draft[key],
                      });
                      if (r.ok && r.text) change({ [key]: r.text });
                      setBusy("");
                    }}
                  >
                    <Sparkles size={14} />
                    {busy === key ? "整理中…" : "AI 整理"}
                  </button>
                </div>
              </div>
              {key === "resume" && (
                <>
                  <p className="muted resume-upload-hint">
                    支持 PDF（含扫描版）、Word、图片；最大 20 MB，PDF 最多 10
                    页。内容会发送给当前模型解析。
                  </p>
                  {uploadStatus && (
                    <p role="status" className="info-box">
                      {uploadStatus}
                    </p>
                  )}
                  {uploadError && (
                    <p role="alert" className="error-box">
                      {uploadError}
                    </p>
                  )}
                </>
              )}
              <textarea
                aria-label={title}
                rows={18}
                maxLength={50000}
                disabled={key === "resume" && busy === "import"}
                value={draft[key]}
                onChange={(e) => change({ [key]: e.target.value })}
                placeholder={placeholder}
              />
              <small>整理结果可编辑，点击“保存资料”后用于生成。</small>
            </section>
          ))}
        </div>
      ) : (
        <div className="material-list">
          <div className="section-heading">
            <p>
              {tab === "answers"
                ? "记录常见问题和真实作答，生成时自动参考。"
                : "保存自己的演讲提纲，可发送到独立悬浮窗阅读。"}
            </p>
            <button
              onClick={() =>
                change({
                  [tab]: [
                    ...draft[tab],
                    { id: crypto.randomUUID(), title: "", content: "" },
                  ],
                })
              }
            >
              <Plus size={16} />
              新增
            </button>
          </div>
          {!draft[tab].length && (
            <div className="empty card">
              <BookOpen />
              <h3>从你的第一个条目开始</h3>
              <p>这里不会预填虚构的个人经历。</p>
            </div>
          )}
          {draft[tab].map((item, index) => (
            <article className="card" key={item.id}>
              <div className="section-heading">
                <input
                  aria-label={tab === "answers" ? "问题" : "提词稿标题"}
                  placeholder={
                    tab === "answers"
                      ? "问题，例如：介绍一次技术难点"
                      : "提词稿标题"
                  }
                  value={item.title}
                  maxLength={500}
                  onChange={(e) => itemChange(index, { title: e.target.value })}
                />
                <div className="button-row">
                  <button
                    aria-label="上移"
                    disabled={!index}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    aria-label="下移"
                    disabled={index === draft[tab].length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={15} />
                  </button>
                  <button
                    aria-label="删除条目"
                    onClick={() =>
                      change({
                        [tab]: draft[tab].filter((v) => v.id !== item.id),
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <textarea
                aria-label="条目内容"
                rows={5}
                maxLength={25000}
                value={item.content}
                onChange={(e) => itemChange(index, { content: e.target.value })}
                placeholder="写下内容…"
              />
            </article>
          ))}
        </div>
      )}
    </>
  );
}
