import type { AudioSource } from "./audio-capture";
import { QwenAsr, type AsrCallbacks } from "./qwen-asr";
import type { MockInterview } from "./mock-interview";

export class MockVoice {
  private asr?: QwenAsr;
  private id?: string;
  private turnId?: string;
  private epoch = 0;
  private version = 0;
  private pending = new Set<string>();
  private seen = new Set<string>();
  private speaking = false;
  private speakingItem?: string;
  private partialItem?: string;
  private checking?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private sendTimer?: ReturnType<typeof setTimeout>;
  private settling = false;
  constructor(
    private mock: MockInterview,
    private audio: AudioSource,
    private factory = (cb: AsrCallbacks) => new QwenAsr(cb),
    private silenceMs = 2500,
    private countdownMs = 1500,
    private drainMs = 1000,
  ) {}
  get runtime() {
    return this.mock.runtime;
  }
  private changed() {
    this.mock.service.changed(false);
  }
  private turn() {
    return this.id
      ? this.mock.session(this.id).turns.find((t) => t.id === this.turnId)
      : undefined;
  }
  private current(epoch: number) {
    return (
      epoch === this.epoch &&
      !!this.id &&
      this.mock.session(this.id).status === "ongoing" &&
      this.turn()?.status === "waiting"
    );
  }
  continue() {
    this.version++;
    clearTimeout(this.timer);
    clearTimeout(this.sendTimer);
    this.checking?.abort();
    this.checking = undefined;
    this.runtime.countdown = undefined;
    this.changed();
  }
  async listen(id: string) {
    if (this.runtime.mic !== "off") throw new Error("麦克风已经开启");
    const s = this.mock.session(id),
      t = s.turns.find((t) => t.status === "waiting");
    if (s.status !== "ongoing" || !t || this.mock.runtime.busy)
      throw new Error("当前没有可回答的问题");
    if (
      ["connecting", "listening", "reconnecting"].includes(
        this.mock.service.runtime.voice.status,
      )
    )
      throw new Error("请先停止工作台的会议识别，再开始模拟面试");
    const config = this.mock.service.store.voiceConfig();
    if (!config.hasKey)
      throw new Error("请先在应用设置中配置百炼语音连接，也可使用文字作答");
    this.stop();
    this.id = id;
    this.turnId = t.id;
    const epoch = this.epoch;
    Object.assign(this.runtime, {
      mic: "connecting",
      error: undefined,
      sessionId: id,
    });
    this.changed();
    const asr = this.factory({
      event: (e) => {
        if (this.current(epoch)) this.event(e);
      },
      disconnected: (e) => {
        if (this.current(epoch))
          this.stop(e.message + "；草稿已保留，可重新开始回答或改用文字提交");
      },
    });
    this.asr = asr;
    try {
      await asr.connect(
        config.workspaceId,
        this.mock.service.store.voiceKey(),
        config.model,
      );
      if (!this.current(epoch)) {
        asr.close();
        return;
      }
      await this.audio.start(
        (frame, level) => {
          if (!this.current(epoch) || this.settling) return;
          try {
            asr.send(frame);
          } catch {
            this.stop("音频发送失败，草稿已保留，请重试");
            return;
          }
          this.runtime.level = level;
        },
        (error) => {
          if (this.current(epoch)) this.stop(error);
        },
      );
      if (!this.current(epoch)) {
        asr.close();
        return;
      }
      this.runtime.mic = "listening";
      this.changed();
    } catch (e) {
      if (this.current(epoch))
        this.stop(e instanceof Error ? e.message : "麦克风启动失败");
      throw e;
    }
  }
  private event(e: Record<string, unknown>) {
    const item = typeof e.item_id === "string" ? e.item_id : "";
    if (e.type === "input_audio_buffer.speech_started") {
      this.continue();
      this.speaking = true;
      this.speakingItem = item || undefined;
      if (item) this.pending.add(item);
    } else if (e.type === "input_audio_buffer.speech_stopped") {
      if (!this.speakingItem || this.speakingItem === item) {
        this.speaking = false;
        this.speakingItem = undefined;
      }
    } else if (e.type === "conversation.item.input_audio_transcription.text") {
      this.continue();
      if (item) this.pending.add(item);
      this.partialItem = item || undefined;
      this.runtime.partial = (
        String(e.text || "") + String(e.stash || "")
      ).slice(0, 20000);
    } else if (
      e.type === "conversation.item.input_audio_transcription.completed"
    ) {
      if (!item || this.seen.has(item) || typeof e.transcript !== "string")
        return;
      this.seen.add(item);
      this.pending.delete(item);
      if (!this.speakingItem || this.speakingItem === item) {
        this.speaking = false;
        this.speakingItem = undefined;
      }
      if (!this.partialItem || this.partialItem === item) {
        this.runtime.partial = "";
        this.partialItem = undefined;
      }
      const t = this.turn();
      if (t && e.transcript.trim()) {
        try {
          this.mock.draft(
            this.id!,
            t.id,
            [t.draft, e.transcript.trim()].filter(Boolean).join("\n"),
          );
        } catch {
          this.stop("回答文字超过长度限制，已有内容保留，请改用文字整理后提交");
          return;
        }
      }
      this.continue();
      if (!this.settling && t?.draft) this.schedule();
    }
    this.changed();
  }
  private schedule() {
    const epoch = this.epoch,
      version = this.version;
    this.timer = setTimeout(async () => {
      if (
        !this.current(epoch) ||
        this.speaking ||
        this.pending.size ||
        version !== this.version
      )
        return;
      const controller = new AbortController();
      this.checking = controller;
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const complete = await this.mock.completeAnswer(
          this.id!,
          this.turnId!,
          controller.signal,
        );
        if (
          !complete ||
          !this.current(epoch) ||
          version !== this.version ||
          controller.signal.aborted
        )
          return;
        this.runtime.countdown = Date.now() + this.countdownMs;
        this.changed();
        this.sendTimer = setTimeout(() => {
          if (!this.current(epoch) || version !== this.version) return;
          void this.submit(this.id!, this.turnId!).catch((e) => {
            this.runtime.error =
              e instanceof Error ? e.message : "提交失败，草稿已保留";
            this.changed();
          });
        }, this.countdownMs);
      } catch {
        if (this.current(epoch) && version === this.version) {
          this.runtime.error = "自动结束判断未完成，请点击「我答完了」提交";
          this.changed();
        }
      } finally {
        clearTimeout(timeout);
        if (this.checking === controller) this.checking = undefined;
      }
    }, this.silenceMs);
  }
  async submit(id: string, turnId: string, text?: string) {
    if (this.settling) throw new Error("正在等待最后一段转写，请稍候");
    const t = this.mock.session(id).turns.find((t) => t.id === turnId);
    if (!t || t.status !== "waiting") return;
    if (text !== undefined) this.mock.draft(id, turnId, text);
    if (this.id && (id !== this.id || turnId !== this.turnId))
      throw new Error("语音回答与题目不匹配");
    if (this.id) {
      if (this.runtime.mic === "connecting")
        throw new Error("麦克风正在连接，请稍候");
      this.continue();
      this.settling = true;
      this.runtime.mic = "settling";
      this.changed();
      this.audio.stop();
      const epoch = this.epoch,
        started = Date.now();
      // Flush the ASR server's VAD with silence instead of closing and losing final words.
      try {
        do {
          if (!this.current(epoch)) throw new Error("提交已取消，草稿已保留");
          if (Date.now() - started < this.drainMs)
            this.asr?.send(new Uint8Array(3200));
          await new Promise((r) => setTimeout(r, 100));
        } while (
          Date.now() - started < this.drainMs ||
          ((this.pending.size || this.speaking || this.runtime.partial) &&
            Date.now() - started < 5000)
        );
        if (!this.current(epoch)) throw new Error("提交已取消，草稿已保留");
        if (this.pending.size || this.speaking || this.runtime.partial) {
          const partial = this.runtime.partial;
          if (partial)
            this.mock.draft(
              id,
              turnId,
              [t.draft, partial].filter(Boolean).join("\n"),
            );
          throw new Error("最后一段转写超时，草稿已保留，请校正文字后重新提交");
        }
      } catch (e) {
        if (epoch === this.epoch)
          this.stop(e instanceof Error ? e.message : "提交失败");
        throw e;
      }
      this.stop();
    }
    await this.mock.submit(id, turnId);
    const s = this.mock.session(id);
    if (s.status === "completed") await this.mock.report(id);
  }
  stop(error?: string) {
    const t = this.turn();
    if (
      t &&
      this.id &&
      t.status === "waiting" &&
      this.runtime.partial.trim() &&
      !t.draft.endsWith(this.runtime.partial.trim())
    ) {
      try {
        this.mock.draft(
          this.id,
          t.id,
          [t.draft, this.runtime.partial.trim()].filter(Boolean).join("\n"),
        );
      } catch {
        /* Keep the already persisted draft if it is at its size limit. */
      }
    }
    this.continue();
    this.epoch++;
    this.asr?.close();
    this.asr = undefined;
    this.audio.stop();
    this.id = undefined;
    this.turnId = undefined;
    this.pending.clear();
    this.seen.clear();
    this.speaking = false;
    this.settling = false;
    this.speakingItem = undefined;
    this.partialItem = undefined;
    Object.assign(this.runtime, {
      mic: "off",
      partial: "",
      level: 0,
      countdown: undefined,
    });
    if (error) this.runtime.error = error;
    this.changed();
  }
}
