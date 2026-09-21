export interface VoiceConfig {
  workspaceId: string;
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
  | { type: "voice:save"; workspaceId: string; apiKey?: string }
  | { type: "voice:start" | "voice:stop" | "voice:test" }
  | { type: "voice:auto"; enabled: boolean }
  | { type: "voice:answer"; sessionId: string; transcriptId: string };
export const VOICE_MODEL = "qwen3-asr-flash-realtime";
export function voiceEndpoint(workspaceId: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/.test(workspaceId))
    throw new Error("请填写北京地域有效的 Workspace ID");
  return `wss://${workspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=${VOICE_MODEL}`;
}
export const VOICE_LABELS: Record<VoiceRuntime["status"], string> = {
  stopped: "未开启",
  connecting: "正在连接",
  listening: "正在识别系统声音",
  reconnecting: "连接中断，正在重连",
  error: "识别已停止",
};
