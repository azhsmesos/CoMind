import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { voiceEndpoint, voiceModel, VOICE_MODEL } from "../shared/voice";
export class AsrError extends Error {
  constructor(
    message: string,
    readonly fatal = false,
  ) {
    super(message);
  }
}
export function asrError(code: string | number): AsrError {
  const value = String(code).toLowerCase();
  if (/401|403|invalid_api_key|auth|accessdenied|permission/.test(value))
    return new AsrError(
      "百炼语音鉴权失败，请检查北京地域 Workspace ID、API Key 和模型权限",
      true,
    );
  if (/402|429|quota|balance|arrear|rate.limit|insufficient/.test(value))
    return new AsrError("百炼语音额度不足或请求受限，请检查余额与配额", true);
  if (/400|404|invalid|unsupported/.test(value))
    return new AsrError(
      "百炼语音配置不受支持，请检查 Workspace ID 和模型权限",
      true,
    );
  return new AsrError("语音服务连接中断");
}
export interface AsrCallbacks {
  event(event: Record<string, unknown>): void;
  disconnected(error: AsrError): void;
}
export class QwenAsr {
  private socket?: WebSocket;
  private stopPending?: () => void;
  private ready = false;
  private taskId?: string;
  constructor(
    private callbacks: AsrCallbacks,
    private endpoint = voiceEndpoint,
  ) {}
  connect(workspaceId: string, apiKey: string, model: string = VOICE_MODEL) {
    if (!apiKey)
      return Promise.reject(new AsrError("请先配置百炼语音 API Key", true));
    return new Promise<void>((resolve, reject) => {
      const selected = voiceModel(model);
      this.close();
      const taskId = selected.protocol === "inference" ? randomUUID() : undefined;
      this.taskId = taskId;
      let speakingItem: string | undefined;
      const finished = new Set<string>();
      const ws = new WebSocket(this.endpoint(workspaceId, selected.id), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(!taskId ? { "OpenAI-Beta": "realtime=v1" } : {}),
        },
        handshakeTimeout: 15000,
        maxPayload: 1024 * 1024,
      });
      this.socket = ws;
      let settled = false;
      let failed = false;
      const fail = (error: AsrError) => {
        if (failed || this.socket !== ws) return;
        failed = true;
        this.ready = false;
        clearTimeout(timeout);
        this.socket = undefined;
        ws.terminate();
        if (!settled) {
          settled = true;
          reject(error);
        } else this.callbacks.disconnected(error);
      };
      const timeout = setTimeout(
        () => fail(new AsrError("语音服务连接超时")),
        15000,
      );
      this.stopPending = () => {
        clearTimeout(timeout);
        if (!settled) {
          settled = true;
          reject(new AsrError("语音连接已取消", true));
        }
      };
      ws.on("open", () => {
        if (this.socket !== ws) return;
        if (taskId) {
          ws.send(JSON.stringify({
            header: { action: "run-task", task_id: taskId, streaming: "duplex" },
            payload: {
              task_group: "audio", task: "asr", function: "recognition",
              model: selected.id,
              parameters: {
                format: "pcm", sample_rate: 16000,
                semantic_punctuation_enabled: false,
                max_sentence_silence: 800, heartbeat: true,
              },
              input: {},
            },
          }));
          return;
        }
        ws.send(
          JSON.stringify({
            event_id: randomUUID(),
            type: "session.update",
            session: {
              input_audio_format: "pcm",
              sample_rate: 16000,
              input_audio_transcription: { language: "zh" },
              turn_detection: {
                type: "server_vad",
                threshold: 0.2,
                silence_duration_ms: 800,
              },
            },
          }),
        );
      });
      ws.on("message", (raw) => {
        if (this.socket !== ws) return;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(raw.toString());
        } catch {
          fail(new AsrError("语音服务返回格式错误"));
          return;
        }
        if (!event || typeof event !== "object") return;
        if (taskId) {
          const header = event.header as Record<string, unknown> | undefined;
          if (!header || header.task_id !== taskId) return;
          if (header.event === "task-started" && !settled) {
            clearTimeout(timeout);
            settled = true;
            this.ready = true;
            resolve();
          } else if (header.event === "task-failed") {
            // Never expose the service's error_message: it may echo credentials.
            fail(asrError(String(header.error_code || "unknown")));
          } else if (header.event === "task-finished") {
            fail(new AsrError("语音会话已结束，正在重新连接"));
          } else if (header.event === "result-generated" && this.ready) {
            const payload = event.payload as { output?: { sentence?: Record<string, unknown> } } | undefined;
            const sentence = payload?.output?.sentence;
            if (!sentence || sentence.heartbeat === true) return;
            // Fun-ASR can refine begin_time between partial and final results;
            // use its sentence_id. Paraformer identifies a sentence by begin_time.
            const id = Number.isInteger(sentence.sentence_id)
              ? `sentence:${sentence.sentence_id}`
              : Number.isInteger(sentence.begin_time) ? `time:${sentence.begin_time}` : undefined;
            if (!id || typeof sentence.text !== "string" || typeof sentence.sentence_end !== "boolean") {
              fail(new AsrError("语音服务返回的转写格式无效"));
              return;
            }
            const item_id = `${taskId}:${id}`;
            if (finished.has(item_id)) return;
            if (sentence.sentence_end) {
              finished.add(item_id);
              if (finished.size > 10000) finished.delete(finished.values().next().value!);
              if (speakingItem === item_id) speakingItem = undefined;
              this.callbacks.event({ type: "conversation.item.input_audio_transcription.completed", item_id, transcript: sentence.text });
            } else {
              if (speakingItem !== item_id) {
                speakingItem = item_id;
                this.callbacks.event({ type: "input_audio_buffer.speech_started", item_id });
              }
              this.callbacks.event({ type: "conversation.item.input_audio_transcription.text", item_id, text: sentence.text });
            }
          }
          return;
        }
        if (typeof event.type !== "string") return;
        if (
          event.type === "error" ||
          event.type === "conversation.item.input_audio_transcription.failed"
        ) {
          const error = event.error as { code?: string } | undefined;
          fail(asrError(error?.code || "unknown"));
        } else if (event.type === "session.updated" && !settled) {
          clearTimeout(timeout);
          settled = true;
          this.ready = true;
          resolve();
        } else if (event.type === "session.finished") {
          fail(new AsrError("语音会话已结束，正在重新连接"));
        } else if (this.ready) this.callbacks.event(event);
      });
      ws.on("unexpected-response", (_req, res) => {
        res.resume();
        fail(asrError(res.statusCode || 0));
      });
      ws.on("error", () =>
        fail(new AsrError("无法连接百炼语音服务，请检查网络")),
      );
      ws.on("close", () => fail(new AsrError("语音服务连接中断")));
    });
  }
  send(data: Uint8Array) {
    if (
      !this.ready ||
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN
    )
      return;
    if (this.socket.bufferedAmount > 64_000)
      throw new AsrError("网络过慢，音频发送中断");
    if (this.taskId) {
      this.socket.send(Buffer.from(data));
      return;
    }
    this.socket.send(
      JSON.stringify({
        event_id: randomUUID(),
        type: "input_audio_buffer.append",
        audio: Buffer.from(data).toString("base64"),
      }),
    );
  }
  close() {
    const ws = this.socket;
    const taskId = this.taskId;
    this.taskId = undefined;
    this.socket = undefined;
    this.ready = false;
    this.stopPending?.();
    this.stopPending = undefined;
    if (!ws) return;
    // Ignore late final transcripts after an explicit stop; bound socket cleanup.
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify(taskId
          ? { header: { action: "finish-task", task_id: taskId, streaming: "duplex" }, payload: { input: {} } }
          : { event_id: randomUUID(), type: "session.finish" }),
      );
      ws.close();
      const timer = setTimeout(() => ws.terminate(), 1000);
      timer.unref();
      ws.once("close", () => clearTimeout(timer));
    } else ws.terminate();
  }
}
