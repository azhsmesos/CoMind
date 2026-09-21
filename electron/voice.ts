import { randomUUID } from "node:crypto";
import type { Transcript } from "../shared/voice";
import type { AudioSource } from "./audio-capture";
import { AsrError, QwenAsr, type AsrCallbacks } from "./qwen-asr";
import { detectQuestion, questionKey } from "./voice-questions";
import { Service, message } from "./service";

type Candidate = { text: string; records: Transcript[] };
export class Voice {
  private epoch = 0;
  private asr?: QwenAsr;
  private testing?: QwenAsr;
  private sessionId?: string;
  private modelId = "";
  private seen = new Set<string>();
  private context: Transcript[] = [];
  private pending: Transcript[] = [];
  private carry: Transcript[] = [];
  private queue: Candidate[] = [];
  private dedup = new Map<string, number>();
  private deciding?: AbortController;
  private activeRound?: string;
  private pumping = false;
  private speaking = false;
  private speakingItem?: string;
  private speechVersion = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private retry?: ReturnType<typeof setTimeout>;
  private pumpTimer?: ReturnType<typeof setInterval>;
  private attempts = 0;
  private connection = 0;
  private lastMeter = 0;
  constructor(
    private service: Service,
    private audio: AudioSource,
    private makeAsr = (callbacks: AsrCallbacks) => new QwenAsr(callbacks),
    private detect = detectQuestion,
    private showAnswer = () => {},
    private debounceMs = 800,
    private retryDelays = [1000, 2000, 4000],
  ) {}
  get runtime() {
    return this.service.runtime.voice;
  }
  private update() {
    this.service.changed(false);
  }
  private valid(epoch: number) {
    const s = this.service.store.data.sessions.find(
      (s) => s.id === this.sessionId,
    );
    return (
      epoch === this.epoch &&
      !!this.sessionId &&
      s?.status === "ongoing" &&
      this.service.store.data.activeSessionId === this.sessionId &&
      this.service.store.data.activeModelId === this.modelId
    );
  }
  async test() {
    const config = this.service.store.voiceConfig();
    if (!config.hasKey) throw new Error("请先保存百炼语音连接");
    if (this.testing) throw new Error("正在测试语音连接");
    const asr = this.makeAsr({ event: () => {}, disconnected: () => {} });
    this.testing = asr;
    try {
      await asr.connect(config.workspaceId, this.service.store.voiceKey(), config.model);
      return "百炼语音连接成功";
    } finally {
      asr.close();
      if (this.testing === asr) this.testing = undefined;
    }
  }
  async start() {
    if (this.sessionId) throw new Error("会议识别已启动");
    this.service.model();
    const config = this.service.store.voiceConfig();
    if (!config.hasKey || !config.workspaceId)
      throw new Error("请先在应用设置中配置百炼语音连接");
    const session = this.service.store.data.activeSessionId
      ? this.service.session(this.service.store.data.activeSessionId)
      : this.service.create();
    if (session.status !== "ongoing") throw new Error("请先继续会话");
    const epoch = ++this.epoch;
    this.sessionId = session.id;
    this.modelId = this.service.store.data.activeModelId;
    this.seen.clear();
    this.context = [];
    this.pending = [];
    this.carry = [];
    this.dedup.clear();
    this.attempts = 0;
    Object.assign(this.runtime, {
      status: "connecting",
      sessionId: session.id,
      partial: "",
      level: 0,
      error: undefined,
      queued: 0,
      autoAnswer: config.autoAnswer,
    });
    this.update();
    this.pumpTimer = setInterval(() => {
      if (this.valid(epoch)) void this.pump(epoch);
      else if (epoch === this.epoch && this.sessionId) this.stop();
    }, 200);
    try {
      await this.connect(epoch);
      if (!this.valid(epoch)) return;
      await this.audio.start(
        (data, level) => {
          if (!this.valid(epoch)) return;
          try {
            this.asr?.send(data);
          } catch (e) {
            this.disconnected(
              epoch,
              e instanceof AsrError ? e : new AsrError("音频发送中断"),
            );
          }
          if (Date.now() - this.lastMeter > 150) {
            this.lastMeter = Date.now();
            this.runtime.level = level;
            this.update();
          }
        },
        (error) => {
          if (this.valid(epoch)) this.stop(error);
        },
      );
      if (this.valid(epoch) && this.runtime.status === "connecting") {
        this.runtime.status = "listening";
        this.update();
      }
    } catch (e) {
      if (this.valid(epoch)) {
        this.stop(message(e));
        throw e;
      }
    }
  }
  private async connect(epoch: number) {
    const connection = ++this.connection;
    const current = () => this.valid(epoch) && connection === this.connection;
    const asr = this.makeAsr({
      event: (event) => {
        if (current()) {
          try {
            this.event(event);
          } catch {
            this.stop("转写记录保存失败，请检查本地磁盘");
          }
        }
      },
      disconnected: (error) => {
        if (current()) this.disconnected(epoch, error);
      },
    });
    this.asr = asr;
    await asr.connect(
      this.service.store.voiceConfig().workspaceId,
      this.service.store.voiceKey(),
      this.service.store.voiceConfig().model,
    );
    if (!current()) asr.close();
  }
  private append(text: string, kind: Transcript["kind"] = "speech") {
    const record: Transcript = {
      id: randomUUID(),
      at: new Date().toISOString(),
      text,
      kind,
    };
    this.service.store.transcripts.append(this.sessionId!, record);
    const session = this.service.session(this.sessionId!);
    session.transcriptRevision = (session.transcriptRevision || 0) + 1;
    this.service.changed();
    return record;
  }
  private disconnected(epoch: number, error: AsrError) {
    if (!this.valid(epoch)) return;
    this.connection++;
    this.asr?.close();
    this.asr = undefined;
    clearTimeout(this.retry);
    clearTimeout(this.timer);
    this.deciding?.abort();
    this.deciding = undefined;
    this.pending = [];
    this.carry = [];
    this.speaking = false;
    this.speakingItem = undefined;
    this.runtime.partial = "";
    if (error.fatal || this.attempts >= this.retryDelays.length) {
      this.stop(error.message);
      return;
    }
    this.append("连接中断，重连期间的语音未转写", "gap");
    this.runtime.status = "reconnecting";
    this.runtime.error = error.message;
    this.update();
    const delay = this.retryDelays[this.attempts++];
    this.retry = setTimeout(() => {
      if (!this.valid(epoch)) return;
      void this.connect(epoch)
        .then(() => {
          if (!this.valid(epoch)) return;
          this.runtime.status = "listening";
          this.runtime.error = undefined;
          this.update();
        })
        .catch((e) =>
          this.disconnected(
            epoch,
            e instanceof AsrError ? e : new AsrError("重连失败"),
          ),
        );
    }, delay);
  }
  private event(event: Record<string, unknown>) {
    const type = event.type;
    if (type === "input_audio_buffer.speech_started") {
      this.speaking = true;
      this.speakingItem =
        typeof event.item_id === "string" ? event.item_id : undefined;
      this.speechVersion++;
      clearTimeout(this.timer);
    } else if (type === "input_audio_buffer.speech_stopped") {
      if (!this.speakingItem || this.speakingItem === event.item_id) {
        this.speaking = false;
        this.speakingItem = undefined;
      }
      this.schedule();
    } else if (type === "conversation.item.input_audio_transcription.text") {
      const text =
        (typeof event.text === "string" ? event.text : "") +
        (typeof event.stash === "string" ? event.stash : "");
      this.runtime.partial = text.slice(0, 12000);
      this.speechVersion++;
      clearTimeout(this.timer);
      this.update();
    } else if (
      type === "conversation.item.input_audio_transcription.completed"
    ) {
      if (
        typeof event.item_id !== "string" ||
        this.seen.has(event.item_id) ||
        typeof event.transcript !== "string"
      )
        return;
      this.seen.add(event.item_id);
      if (this.seen.size > 10000)
        this.seen.delete(this.seen.values().next().value!);
      if (!this.speakingItem || this.speakingItem === event.item_id) {
        this.runtime.partial = "";
        this.speaking = false;
        this.speakingItem = undefined;
      }
      this.speechVersion++;
      const text = event.transcript.trim().slice(0, 12000);
      if (!text) {
        this.update();
        return;
      }
      const record = this.append(text);
      this.context.push(record);
      this.context = this.context
        .filter((r) => Date.now() - Date.parse(r.at) < 120000)
        .slice(-100);
      if (this.runtime.autoAnswer) {
        this.pending.push(record);
        this.schedule();
      }
      this.update();
    }
  }
  private schedule() {
    clearTimeout(this.timer);
    if (!this.runtime.autoAnswer || this.speaking || !this.pending.length)
      return;
    const epoch = this.epoch;
    this.timer = setTimeout(() => void this.classify(epoch), this.debounceMs);
  }
  private async classify(epoch: number) {
    if (
      !this.valid(epoch) ||
      !this.runtime.autoAnswer ||
      this.speaking ||
      !this.pending.length ||
      this.deciding
    )
      return;
    const rows = [
      ...this.carry.filter((r) => Date.now() - Date.parse(r.at) < 120000),
      ...this.pending,
    ];
    this.carry = [];
    this.pending = [];
    const controller = new AbortController();
    this.deciding = controller;
    const version = this.speechVersion;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const ids = new Set(rows.map((r) => r.id));
      const context = this.context
        .filter((r) => !ids.has(r.id) && Date.now() - Date.parse(r.at) < 120000)
        .map((r) => r.text)
        .join("\n")
        .slice(-6000);
      const result = await this.detect(
        this.service.model(),
        context,
        rows
          .map((r) => r.text)
          .join("\n")
          .slice(-6000),
        controller.signal,
      );
      if (
        !this.valid(epoch) ||
        controller.signal.aborted ||
        !this.runtime.autoAnswer
      )
        return;
      if (version !== this.speechVersion || this.speaking) {
        this.carry = rows;
        return;
      }
      if (result.kind === "incomplete") this.carry = rows;
      if (result.kind === "question") {
        const key = questionKey(result.question);
        const now = Date.now();
        for (const [k, time] of this.dedup)
          if (now - time > 60000) this.dedup.delete(k);
        if (!this.dedup.has(key)) {
          this.dedup.set(key, now);
          if (this.queue.length >= 10) {
            const waiting = this.queue;
            this.auto(false);
            this.queue = waiting;
            this.runtime.error =
              "待回答问题已达 10 条，自动回答已暂停；转写仍在继续，可从记录手动回答";
          } else this.queue.push({ text: result.question, records: rows });
        }
      }
    } catch {
      if (
        this.valid(epoch) &&
        this.runtime.autoAnswer &&
        this.deciding === controller
      )
        this.runtime.error = "问题判断失败，可从转写记录手动回答";
    } finally {
      clearTimeout(timeout);
      if (this.deciding === controller) {
        this.deciding = undefined;
        this.schedule();
      }
      if (this.valid(epoch)) {
        this.runtime.queued = this.queue.length;
        this.update();
        void this.pump(epoch);
      }
    }
  }
  private async pump(epoch: number) {
    if (
      !this.valid(epoch) ||
      this.pumping ||
      !this.runtime.autoAnswer ||
      !this.queue.length
    )
      return;
    const session = this.service.session(this.sessionId!);
    if (
      session.rounds.some((r) => r.status === "generating") ||
      this.service.runtime.jobs.screenshot
    )
      return;
    this.pumping = true;
    const item = this.queue.shift()!;
    this.runtime.queued = this.queue.length;
    this.update();
    try {
      await this.service.add(
        item.text,
        "voice",
        undefined,
        undefined,
        (round) => {
          this.activeRound = round.id;
          for (const record of item.records)
            this.service.store.transcripts.append(session.id, {
              ...record,
              roundId: round.id,
            });
          session.transcriptRevision = (session.transcriptRevision || 0) + 1;
        },
      );
      if (
        this.valid(epoch) &&
        session.rounds.find((r) => r.id === this.activeRound)?.status === "done"
      )
        this.showAnswer();
    } catch {
      if (this.valid(epoch))
        this.runtime.error = "语音问题回答失败，可在工作台重试";
    } finally {
      if (epoch === this.epoch) {
        this.pumping = false;
        this.activeRound = undefined;
        this.update();
      }
    }
  }
  auto(enabled: boolean) {
    if (typeof enabled !== "boolean") throw new Error("自动回答设置无效");
    this.runtime.autoAnswer = enabled;
    if (enabled) this.runtime.error = undefined;
    if (this.service.store.data.voice)
      this.service.store.data.voice.autoAnswer = enabled;
    if (!enabled) {
      clearTimeout(this.timer);
      this.deciding?.abort();
      this.deciding = undefined;
      this.pending = [];
      this.carry = [];
      this.queue = [];
      this.runtime.queued = 0;
      if (this.sessionId && this.activeRound)
        this.service.cancelRound(this.sessionId, this.activeRound);
    }
    this.service.changed();
  }
  async answer(sessionId: string, transcriptId: string) {
    if (this.service.store.data.activeSessionId !== sessionId)
      throw new Error("请在进行中的当前会话选择转写回答");
    const record = this.service.store.transcripts.get(sessionId, transcriptId);
    if (!record || record.kind !== "speech") throw new Error("转写记录不存在");
    await this.service.add(
      record.text,
      "voice",
      undefined,
      undefined,
      (round) => {
        this.service.store.transcripts.append(sessionId, {
          ...record,
          roundId: round.id,
        });
        const session = this.service.session(sessionId);
        session.transcriptRevision = (session.transcriptRevision || 0) + 1;
      },
    );
    this.showAnswer();
  }
  stop(error?: string) {
    this.testing?.close();
    this.testing = undefined;
    const sessionId = this.sessionId;
    const roundId = this.activeRound;
    this.epoch++;
    this.connection++;
    this.sessionId = undefined;
    clearTimeout(this.timer);
    clearTimeout(this.retry);
    clearInterval(this.pumpTimer);
    this.deciding?.abort();
    this.deciding = undefined;
    this.asr?.close();
    this.asr = undefined;
    this.audio.stop();
    this.pending = [];
    this.carry = [];
    this.queue = [];
    this.context = [];
    this.pumping = false;
    this.activeRound = undefined;
    this.speaking = false;
    if (
      sessionId &&
      roundId &&
      this.service.store.data.sessions.some((s) => s.id === sessionId)
    )
      this.service.cancelRound(sessionId, roundId);
    Object.assign(this.runtime, {
      status: error ? "error" : "stopped",
      partial: "",
      level: 0,
      queued: 0,
      error,
    });
    this.update();
  }
  dispose() {
    this.stop();
    this.testing?.close();
  }
}
