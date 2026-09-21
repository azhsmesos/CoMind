export interface VoiceConfig {
  workspaceId: string;
  model: VoiceModel;
  hasKey: boolean;
  autoAnswer: boolean;
}
export interface Transcript {
  id: string;
  at: string;
  text: string;
  kind: "speech" | "gap";
  roundId?: string;
}
export interface TranscriptPage {
  items: Transcript[];
  before?: number;
  total: number;
}
export interface VoiceRuntime {
  status: "stopped" | "connecting" | "listening" | "reconnecting" | "error";
  sessionId?: string;
  partial: string;
  level: number;
  queued: number;
  autoAnswer: boolean;
  error?: string;
}
export type VoiceCommand =
  | { type: "voice:save"; workspaceId: string; apiKey?: string; model?: VoiceModel }
  | { type: "voice:start" | "voice:stop" | "voice:test" }
  | { type: "voice:auto"; enabled: boolean }
  | { type: "voice:answer"; sessionId: string; transcriptId: string };
export const VOICE_MODEL = "qwen3-asr-flash-realtime";
export const VOICE_MODELS = [
  { id: VOICE_MODEL, label: "千问 Qwen3 ASR Flash Realtime", protocol: "realtime" },
  { id: "fun-asr-realtime", label: "Fun-ASR Realtime", protocol: "inference" },
  { id: "paraformer-realtime-v2", label: "Paraformer Realtime v2", protocol: "inference" },
] as const;
export type VoiceModel = (typeof VOICE_MODELS)[number]["id"];
export function voiceModel(value: unknown = VOICE_MODEL) {
  const selected = VOICE_MODELS.find((item) => item.id === value);
  if (!selected) throw new Error("不支持的语音识别模型，请从列表中选择");
  return selected;
}
export function voiceEndpoint(workspaceId: string, model: string = VOICE_MODEL) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/.test(workspaceId))
    throw new Error("请填写北京地域有效的 Workspace ID");
  const selected = voiceModel(model);
  const base = `wss://${workspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1`;
  return selected.protocol === "realtime"
    ? `${base}/realtime?model=${selected.id}`
    : `${base}/inference`;
}
export const VOICE_LABELS: Record<VoiceRuntime["status"], string> = {
  stopped: "未开启",
  connecting: "正在连接",
  listening: "正在识别系统声音",
  reconnecting: "连接中断，正在重连",
  error: "识别已停止",
};
