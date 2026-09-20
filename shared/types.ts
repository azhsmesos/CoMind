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
export const PRESETS: Record<Provider, { name: string; baseUrl: string }> = {
  doubao: {
    name: "豆包 · 火山方舟",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  },
  deepseek: { name: "DeepSeek", baseUrl: "https://api.deepseek.com" },
  glm: { name: "GLM · 智谱", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
  custom: { name: "自定义服务", baseUrl: "" },
};
export interface InterviewScript {
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
export interface PageContext {
  title: string;
  url: string;
  text: string;
}
export interface Round {
  id: string;
  question: string;
  source: "manual" | "browser" | "screenshot";
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
    pair: string;
    screenshot: string;
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
    pair: "CommandOrControl+Shift+P",
    screenshot: "CommandOrControl+Shift+S",
  },
};
export interface DesktopState {
  models: ModelConfig[];
  activeModelId: string;
  materials: Materials;
  sessions: Session[];
  activeSessionId: string | null;
  preferences: Preferences;
  runtime: {
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
  | { type: "clipboard:write"; text: string }
  | { type: "model:save"; config: ModelInput }
  | { type: "model:select" | "model:delete" | "model:test"; id: string }
  | { type: "materials:save"; materials: Materials }
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
  screenshot: {
    frame(): Promise<string>;
    select(rect: CaptureRect): Promise<CommandResult>;
    cancel(): Promise<void>;
  };
  platform: string;
  getState(): Promise<DesktopState>;
  command(command: Command): Promise<CommandResult>;
  onState(callback: (state: DesktopState) => void): () => void;
}
// Coordinates are fractions of the captured display, independent of Retina scale.
export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
