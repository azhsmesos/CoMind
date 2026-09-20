import { randomUUID } from "node:crypto";
import type {
  Command,
  DesktopState,
  Materials,
  PageContext,
  Preferences,
  Round,
  Session,
} from "../shared/types";
import { Store } from "./store";
import {
  callModel,
  evaluateSession,
  generateAnswer,
  optimizeMaterial,
  validateImage,
  type RequestModel,
} from "./llm";
export class Service {
  runtime: DesktopState["runtime"];
  private requests = new Map<string, AbortController>();
  constructor(
    readonly store: Store,
    private notify: () => void,
    private generate = generateAnswer,
  ) {
    this.runtime = {
      port: 0,
      paired: store.data.extensionPaired,
      overlayVisible: false,
      clickThrough: false,
      encryptedStorage: store.encryptedStorage,
      shortcutsErrors: [],
      registeredShortcuts: {},
      jobs: {},
      notice: store.warning,
    };
  }
  state() {
    return this.store.snapshot(this.runtime);
  }
  changed(persist = true) {
    if (persist) this.store.save();
    this.notify();
  }
  notice(text: string) {
    this.runtime.notice = text;
    this.changed(false);
  }
  model(id = this.store.data.activeModelId): RequestModel {
    const config = this.store.models().find((m) => m.id === id);
    if (!config) throw new Error("请先在模型设置中添加并选择一个模型");
    const apiKey = this.store.key(id);
    if (!apiKey) throw new Error("当前模型没有可用密钥，请前往模型设置");
    return { ...config, apiKey };
  }
  session(id: string) {
    const s = this.store.data.sessions.find((s) => s.id === id);
    if (!s) throw new Error("会话不存在");
    return s;
  }
  round(sessionId: string, roundId: string) {
    const s = this.session(sessionId);
    const r = s.rounds.find((r) => r.id === roundId);
    if (!r) throw new Error("回合不存在");
    return { s, r };
  }
  create(name?: string): Session {
    if (this.store.data.activeSessionId) throw new Error("请先结束当前会话");
    const s: Session = {
      id: randomUUID(),
      name:
        name?.trim().slice(0, 100) ||
        `CoMind 会话 · ${new Date().toLocaleString("zh-CN")}`,
      createdAt: new Date().toISOString(),
      status: "ongoing",
      rounds: [],
      pending: [],
    };
    this.store.data.sessions.unshift(s);
    this.store.data.activeSessionId = s.id;
    this.changed();
    return s;
  }
  cancel(key: string) {
    this.requests.get(key)?.abort();
    this.requests.delete(key);
    delete this.runtime.jobs[key];
  }
  cancelRound(sessionId: string, roundId: string) {
    this.cancel(`answer:${sessionId}:${roundId}`);
    const { r } = this.round(sessionId, roundId);
    if (r.status === "generating") {
      r.status = r.answer ? "done" : "idle";
      r.error = "已取消生成";
    }
    this.changed();
  }
  cancelSession(id: string) {
    for (const key of this.requests.keys())
      if (key.includes(":" + id)) this.cancel(key);
    for (const r of this.session(id).rounds)
      if (r.status === "generating") {
        r.status = r.answer ? "done" : "idle";
        r.error = "会话已暂停或结束，生成已取消";
      }
  }
  dispose() {
    for (const c of this.requests.values()) c.abort();
    this.requests.clear();
  }
  async job<T>(
    key: string,
    label: string,
    task: (signal: AbortSignal) => Promise<T>,
    apply?: (result: T) => void,
  ): Promise<T | undefined> {
    this.cancel(key);
    const controller = new AbortController();
    this.requests.set(key, controller);
    this.runtime.jobs[key] = label;
    this.changed(false);
    try {
      const result = await task(controller.signal);
      if (controller.signal.aborted || this.requests.get(key) !== controller)
        return;
      apply?.(result);
      this.changed();
      return result;
    } catch (e) {
      if (controller.signal.aborted || this.requests.get(key) !== controller)
        return;
      throw e;
    } finally {
      if (this.requests.get(key) === controller) {
        this.requests.delete(key);
        delete this.runtime.jobs[key];
        this.changed(false);
      }
    }
  }
  async answer(sessionId: string, roundId: string) {
    const { s, r } = this.round(sessionId, roundId);
    if (s.status !== "ongoing") throw new Error("请先继续会话再生成答案");
    const config = this.model();
    // A new question supersedes any other running answer in this session.
    for (const other of s.rounds)
      if (other.id !== r.id && other.status === "generating")
        this.cancelRound(s.id, other.id);
    const requestKey = `answer:${s.id}:${r.id}`;
    r.status = "generating";
    delete r.error;
    this.changed();
    try {
      await this.job(
        requestKey,
        "正在生成回答",
        (signal) =>
          this.generate(
            config,
            r.question,
            r.userSpeech,
            structuredClone(this.store.data.materials),
            structuredClone(this.store.data.preferences),
            signal,
            r.image,
          ),
        (answer) => {
          r.answer = answer;
          if (r.source === "screenshot" && answer.problem.trim())
            r.question = answer.problem;
          r.status = "done";
          delete s.evaluation;
        },
      );
    } catch (e) {
      r.status = "error";
      r.error = message(e);
      this.changed();
      throw e;
    }
  }
  async add(
    text: string,
    source: Round["source"] = "manual",
    url?: string,
    image?: string,
  ) {
    if (image) validateImage(image);
    const question = validText(text, 25000);
    const s = this.store.data.activeSessionId
      ? this.session(this.store.data.activeSessionId)
      : this.create();
    if (s.status !== "ongoing") throw new Error("请先继续会话");
    const r: Round = {
      id: randomUUID(),
      question,
      source,
      ...(image ? { image } : {}),
      url,
      userSpeech: "",
      createdAt: new Date().toISOString(),
      status: "idle",
    };
    s.rounds.push(r);
    delete s.evaluation;
    this.changed();
    try {
      await this.answer(s.id, r.id);
    } catch (e) {
      if (r.status !== "error") {
        r.status = "error";
        r.error = message(e);
        this.changed();
      }
      throw e;
    }
  }
  async capture(page: PageContext) {
    this.runtime.lastCapture = new Date().toISOString();
    this.runtime.lastPage = page.title || page.url;
    const s = this.store.data.activeSessionId
      ? this.session(this.store.data.activeSessionId)
      : null;
    if (s?.status === "paused") {
      if (s.pending.length >= 20)
        throw new Error("待处理题目已达 20 条，请继续会话后再采集");
      s.pending.push(page);
      this.changed();
      return;
    }
    await this.add(page.text, "browser", page.url);
  }
  async resume(id: string) {
    const s = this.session(id);
    if (s.status !== "paused") throw new Error("只有暂停的会话可以继续");
    s.status = "ongoing";
    this.changed();
    while (s.pending.length && s.status === "ongoing") {
      const page = s.pending.shift()!;
      this.changed();
      try {
        await this.add(page.text, "browser", page.url);
      } catch (e) {
        this.notice(message(e));
      }
    }
  }
  async execute(c: Command): Promise<string | undefined> {
    switch (c.type) {
      case "model:save":
        this.store.saveModel(c.config);
        break;
      case "model:select":
        if (!this.store.models().some((m) => m.id === c.id))
          throw new Error("模型配置不存在");
        this.store.data.activeModelId = c.id;
        break;
      case "model:delete":
        this.store.deleteModel(c.id);
        break;
      case "model:test": {
        const config = this.model(c.id);
        const started = Date.now();
        const result = await this.job(
          `test:${c.id}`,
          "正在测试连接",
          (signal) =>
            callModel(
              config,
              "Reply with CONNECTED.",
              "Connection test",
              signal,
            ),
        );
        return result ? `连接成功 · ${Date.now() - started} ms` : "测试已取消";
      }
      case "materials:save":
        validateMaterials(c.materials);
        this.store.data.materials = structuredClone(c.materials);
        break;
      case "materials:optimize": {
        if (!["resume", "jd"].includes(c.field))
          throw new Error("无效资料类型");
        const config = this.model();
        const text = validText(c.text, 50000);
        return this.job(`material:${c.field}`, "正在优化资料", (signal) =>
          optimizeMaterial(config, c.field, text, signal),
        );
      }
      case "session:create":
        this.create(c.name);
        return;
      case "session:pause": {
        const s = this.session(c.id);
        if (s.status !== "ongoing") throw new Error("会话未进行");
        s.status = "paused";
        this.cancelSession(c.id);
        break;
      }
      case "session:resume":
        await this.resume(c.id);
        return;
      case "session:end": {
        const s = this.session(c.id);
        this.cancelSession(c.id);
        s.status = "completed";
        for (const p of s.pending)
          s.rounds.push({
            id: randomUUID(),
            question: p.text,
            source: "browser",
            url: p.url,
            userSpeech: "",
            createdAt: new Date().toISOString(),
            status: "idle",
          });
        s.pending = [];
        if (this.store.data.activeSessionId === c.id)
          this.store.data.activeSessionId = null;
        break;
      }
      case "session:delete":
        this.session(c.id).status = "completed";
        this.session(c.id).pending = [];
        this.cancelSession(c.id);
        this.store.data.sessions = this.store.data.sessions.filter(
          (s) => s.id !== c.id,
        );
        if (this.store.data.activeSessionId === c.id)
          this.store.data.activeSessionId = null;
        break;
      case "session:evaluate": {
        const s = this.session(c.id);
        if (s.status !== "completed") throw new Error("请先结束会话");
        if (!s.rounds.length) throw new Error("会话没有题目");
        const config = this.model();
        await this.job(
          `evaluation:${s.id}`,
          "正在复盘",
          (signal) =>
            evaluateSession(
              config,
              structuredClone(s.rounds),
              this.store.data.preferences.language,
              signal,
            ),
          (result) => {
            s.evaluation = result;
          },
        );
        return;
      }
      case "question:add":
        await this.add(c.text);
        return;
      case "round:generate":
        await this.answer(c.sessionId, c.roundId);
        return;
      case "round:cancel":
        this.cancelRound(c.sessionId, c.roundId);
        return;
      case "round:speech": {
        const { s, r } = this.round(c.sessionId, c.roundId);
        if (typeof c.text !== "string" || c.text.length > 25000)
          throw new Error("作答文本过长");
        this.cancel(`evaluation:${s.id}`);
        r.userSpeech = c.text;
        delete s.evaluation;
        break;
      }
      case "preferences:save":
        validatePreferences(c.preferences);
        this.store.data.preferences = structuredClone(c.preferences);
        for (const key of Object.keys(
          this.store.data.preferences.shortcuts,
        ) as (keyof Preferences["shortcuts"])[])
          this.store.data.preferences.shortcuts[key] = normalizeShortcut(
            this.store.data.preferences.shortcuts[key],
          );
        break;
      default:
        throw new Error("不支持的操作");
    }
    this.changed();
  }
}
function validText(text: string, max: number) {
  if (typeof text !== "string" || !text.trim()) throw new Error("请输入内容");
  if (text.length > max) throw new Error(`内容超过 ${max} 字符，请缩短后重试`);
  return text.trim();
}
function validateMaterials(m: Materials) {
  if (
    !m ||
    typeof m.resume !== "string" ||
    typeof m.jd !== "string" ||
    m.resume.length > 50000 ||
    m.jd.length > 50000
  )
    throw new Error("资料格式错误或超出 50000 字符");
  for (const items of [m.answers, m.scripts])
    if (
      !Array.isArray(items) ||
      items.length > 100 ||
      items.some(
        (i) =>
          !i ||
          typeof i.id !== "string" ||
          typeof i.title !== "string" ||
          typeof i.content !== "string" ||
          i.content.length > 25000 ||
          i.title.length > 500,
      )
    )
      throw new Error("资料条目格式错误或过长");
}
export function validatePreferences(p: Preferences) {
  if (
    !p ||
    !["zh", "en"].includes(p.language) ||
    !["concise", "balanced", "detailed"].includes(p.detail) ||
    typeof p.contentProtection !== "boolean" ||
    !Number.isFinite(p.opacity) ||
    p.opacity < 0.25 ||
    p.opacity > 1 ||
    !Number.isFinite(p.fontSize) ||
    p.fontSize < 12 ||
    p.fontSize > 26
  )
    throw new Error("设置参数无效");
  if (
    !p.shortcuts ||
    !["generate", "overlay", "penetration", "pair", "screenshot"].every(
      (k) =>
        typeof p.shortcuts[k as keyof typeof p.shortcuts] === "string" &&
        p.shortcuts[k as keyof typeof p.shortcuts].length < 100,
    )
  )
    throw new Error("快捷键设置无效");
  const assigned = Object.values(p.shortcuts)
    .map(normalizeShortcut)
    .filter(Boolean)
    .map((s) => s.toLowerCase());
  if (new Set(assigned).size !== assigned.length)
    throw new Error("多个操作不能使用相同快捷键");
}
export function normalizeShortcut(value: string): string {
  const key = value.trim().replace(/\s*\+\s*/g, "+");
  if (/(^|\+)fn(?=\+|$)/i.test(key)) {
    if (!/^Fn\+F([1-9]|1\d|2[0-4])$/i.test(key))
      throw new Error("Fn 仅用于输入 Fn+F1 至 Fn+F24；实际注册为对应功能键");
    return key.slice(3).toUpperCase();
  }
  return key;
}
export function message(e: unknown) {
  return e instanceof Error ? e.message : "操作失败，请重试";
}
export function sessionMarkdown(s: Session) {
  const lines = [`# ${s.name}`, "", `时间：${s.createdAt}`, ""];
  for (const [index, r] of s.rounds.entries()) {
    lines.push(
      `## ${index + 1}. ${r.question}`,
      "",
      "### 我的回答",
      r.userSpeech || "未记录",
      "",
    );
    if (r.answer)
      for (const [key, label] of Object.entries({
        summary: "摘要",
        problem: "题意",
        clarify: "澄清问题",
        approach: "解题思路",
        code: "代码 / 回答提纲",
        walkthrough: "示例",
        time_complexity: "时间复杂度",
        space_complexity: "空间复杂度",
      }))
        lines.push(
          `### ${label}`,
          "",
          r.answer[key as keyof typeof r.answer],
          "",
        );
  }
  if (s.evaluation) {
    const e = s.evaluation;
    lines.push(
      "## 复盘",
      "",
      e.overallScore === null
        ? "参考答案分析（未记录实际作答）"
        : `评分：${e.overallScore}`,
      e.summary,
      "",
      "### 优势",
      ...e.strengths.map((v) => "- " + v),
      "### 改进点",
      ...e.weaknesses.map((v) => "- " + v),
    );
    for (const r of e.qaAnalysis)
      lines.push(
        "",
        `### ${r.question}`,
        "实际作答：" + r.actualResponse,
        "参考回答：" + r.modelResponse,
        "改进建议：" + r.improvement,
      );
  }
  return lines.join("\n");
}
