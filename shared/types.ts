import type { MobileRuntime, MobileCommand } from "./mobile";
export * from "./mobile";
import type {
  VoiceConfig,
  VoiceRuntime,
  VoiceCommand,
  TranscriptPage,
} from "./voice";
export * from "./voice";
export type Provider = "doubao" | "deepseek" | "glm" | "custom";
export type Protocol = "openai" | "anthropic";
export interface ModelConfig {
  id: string;
  name: string;
  provider: Provider;
  protocol: Protocol;
  baseUrl: string;
  model: string;
  hasKey: boolean;
}
export type ModelInput = Omit<ModelConfig, "hasKey"> & { apiKey?: string };
export const PRESETS: Record<
  Provider,
  { name: string; baseUrl: string; model: string }
> = {
  doubao: {
    name: "豆包 · 火山方舟",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "",
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
  },
  glm: {
    name: "GLM · 智谱",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "",
  },
  custom: { name: "自定义服务", baseUrl: "", model: "" },
};
export interface InterviewScript {
  kind?: "answer" | "algorithm";
  summary: string;
  problem: string;
  clarify: string;
  approach: string;
  code: string;
  walkthrough: string;
  time_complexity: string;
  space_complexity: string;
}
export interface MaterialItem {
  id: string;
  title: string;
  content: string;
}
export interface Materials {
  resume: string;
  jd: string;
  answers: MaterialItem[];
  scripts: MaterialItem[];
}
export const MAX_RESUME_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_RESUME_PAGES = 10;
export const MAX_RESUME_IMAGE_CHARS = 20 * 1024 * 1024;
export type ResumeUpload =
  { kind: "word"; data: Uint8Array } | { kind: "images"; images: string[] };
export interface PageContext {
  title: string;
  url: string;
  text: string;
}
export interface Round {
  id: string;
  question: string;
  source: "manual" | "browser" | "screenshot" | "voice";
  image?: string;
  url?: string;
  userSpeech: string;
  createdAt: string;
  status: "idle" | "generating" | "done" | "error";
  answer?: InterviewScript;
  error?: string;
}
export interface Evaluation {
  overallScore: number | null;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  qaAnalysis: {
    question: string;
    actualResponse: string;
    modelResponse: string;
    improvement: string;
  }[];
}
export interface Session {
  transcriptRevision?: number;
  id: string;
  name: string;
  createdAt: string;
  status: "ongoing" | "paused" | "completed";
  rounds: Round[];
  pending: PageContext[];
  evaluation?: Evaluation;
}
export interface Preferences {
  language: "zh" | "en";
  detail: "concise" | "balanced" | "detailed";
  opacity: number;
  fontSize: number;
  contentProtection: boolean;
  shortcuts: {
    generate: string;
    overlay: string;
    penetration: string;
    scrollUp: string;
    scrollDown: string;
    scrollLeft: string;
    scrollRight: string;
    pair: string;
    screenshot: string;
    quit: string;
  };
}
export const DEFAULT_PREFERENCES: Preferences = {
  language: "zh",
  detail: "balanced",
  opacity: 0.92,
  fontSize: 16,
  contentProtection: true,
  shortcuts: {
    generate: "CommandOrControl+Shift+Return",
    overlay: "CommandOrControl+Shift+B",
    penetration: "CommandOrControl+Shift+M",
    scrollUp: "CommandOrControl+Alt+Up",
    scrollDown: "CommandOrControl+Alt+Down",
    scrollLeft: "CommandOrControl+Alt+Left",
    scrollRight: "CommandOrControl+Alt+Right",
    pair: "CommandOrControl+Shift+P",
    screenshot: "CommandOrControl+Shift+S",
    quit: "Control+C",
  },
};
export interface DesktopState {
  voiceConfig: VoiceConfig;
  models: ModelConfig[];
  activeModelId: string;
  materials: Materials;
  sessions: Session[];
  activeSessionId: string | null;
  preferences: Preferences;
  runtime: {
    mobile: MobileRuntime;
    voice: VoiceRuntime;
    port: number;
    paired: boolean;
    lastCapture?: string;
    lastPage?: string;
    pairingUntil?: number;
    overlayVisible: boolean;
    clickThrough: boolean;
    encryptedStorage: boolean;
    shortcutsErrors: string[];
    registeredShortcuts: Partial<Preferences["shortcuts"]>;
    shortcutsRecording?: boolean;
    lastScreenshotShortcut?: string;
    screenshotLog?: { at: string; message: string; error: boolean }[];
    screenshotLogPath?: string;
    jobs: Record<string, string>;
    notice?: string;
  };
}
export type Command =
  | MobileCommand
  | VoiceCommand
  | { type: "clipboard:write"; text: string }
  | { type: "model:save"; config: ModelInput }
  | { type: "model:select" | "model:delete" | "model:test"; id: string }
  | { type: "materials:save"; materials: Materials }
  | { type: "materials:import-resume"; upload: ResumeUpload }
  | { type: "materials:optimize"; field: "resume" | "jd"; text: string }
  | { type: "session:create"; name?: string }
  | {
      type:
        | "session:pause"
        | "session:resume"
        | "session:end"
        | "session:delete"
        | "session:evaluate"
        | "session:export";
      id: string;
    }
  | { type: "question:add"; text: string }
  | {
      type: "round:generate" | "round:cancel";
      sessionId: string;
      roundId: string;
    }
  | { type: "round:speech"; sessionId: string; roundId: string; text: string }
  | { type: "preferences:save"; preferences: Preferences }
  | { type: "shortcuts:record"; recording: boolean }
  | {
      type:
        | "overlay:toggle"
        | "overlay:penetration"
        | "extension:pair"
        | "extension:open"
        | "screenshot:capture"
        | "app:quit";
    };
export interface CommandResult {
  ok: boolean;
  error?: string;
  text?: string;
}
export interface DesktopApi {
  transcripts(sessionId: string, before?: number): Promise<TranscriptPage>;
  onOverlayScroll(
    callback: (direction: OverlayScrollDirection) => void,
  ): () => void;
  platform: string;
  getState(): Promise<DesktopState>;
  command(command: Command): Promise<CommandResult>;
  onState(callback: (state: DesktopState) => void): () => void;
}
export type OverlayScrollDirection = "up" | "down" | "left" | "right";
