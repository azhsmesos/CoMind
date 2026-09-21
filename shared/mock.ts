import type { ModelConfig } from "./types";

export const MOCK_LEVELS = {
  campus: "阿里校招",
  P6: "P6",
  P7: "P7",
  P8: "P8",
} as const;
export const MOCK_RUBRICS = {
  campus: "基础知识、学习能力、实践过程；允许校园经历，不要求商业规模。",
  P6: "独立交付、技术深度、问题定位、工程质量和可验证的个人贡献。",
  P7: "系统设计、复杂问题拆解、技术取舍、项目推动和业务收益。",
  P8: "复杂系统与长期演进、技术规划、跨团队影响、组织协作和业务战略。",
};
export const MOCK_DIMENSIONS = [
  { id: "technical", label: "技术正确性", weight: 25 },
  { id: "reasoning", label: "分析与取舍", weight: 20 },
  { id: "ownership", label: "个人行动与贡献", weight: 15 },
  { id: "business", label: "业务结果", weight: 15 },
  { id: "metrics", label: "技术指标", weight: 15 },
  { id: "expression", label: "表达结构", weight: 10 },
] as const;
export type MockLevel = keyof typeof MOCK_LEVELS;
export interface MockSetup {
  resume: string;
  jd: string;
  role: string;
  level: MockLevel;
  minutes: 15 | 30 | 45;
  mode: "text" | "voice";
}
export interface MockDimension {
  id: (typeof MOCK_DIMENSIONS)[number]["id"];
  status: "scored" | "insufficient" | "na";
  score: number | null;
  evidence: string;
  reason: string;
}
export interface MockAnalysis {
  dimensions: MockDimension[];
  score: number | null;
  improvement: string;
  reference: { heading: string; text: string }[];
  metrics: {
    name: string;
    baseline: string;
    result: string;
    period: string;
    scope: string;
    evidence: string;
  }[];
  missing: string[];
}
export interface MockInterviewTurn {
  id: string;
  parentId?: string;
  question: string;
  category: "experience" | "technical";
  status: "waiting" | "answered" | "skipped";
  draft: string;
  answer: string;
  createdAt: string;
  analysis?: MockAnalysis;
  analysisError?: string;
}
export interface MockInterviewReport {
  status: "partial" | "complete";
  overallScore: number | null;
  answered: number;
  total: number;
  summary?: string;
  strengths?: string[];
  weaknesses?: string[];
  nextSteps?: string[];
  error?: string;
}
export interface MockInterviewSession {
  id: string;
  createdAt: string;
  setup: MockSetup;
  model: ModelConfig;
  status: "draft" | "ongoing" | "paused" | "completed";
  elapsedMs: number;
  runningSince?: number;
  turns: MockInterviewTurn[];
  report?: MockInterviewReport;
}
export interface MockRuntime {
  busy?: string;
  sessionId?: string;
  error?: string;
  mic: "off" | "connecting" | "listening" | "settling";
  partial: string;
  level: number;
  countdown?: number;
}
export type MockCommand =
  | { type: "mock:create"; setup: MockSetup }
  | { type: "mock:role"; jd: string }
  | { type: "mock:draft"; id: string; turnId: string; text: string }
  | { type: "mock:submit"; id: string; turnId: string; text?: string }
  | { type: "mock:report"; id: string; turnId?: string }
  | {
      type:
        | "mock:start"
        | "mock:next"
        | "mock:skip"
        | "mock:pause"
        | "mock:resume"
        | "mock:end"
        | "mock:export"
        | "mock:listen"
        | "mock:mic-stop"
        | "mock:continue";
      id: string;
    };

export function mockBand(score: number | null) {
  return score === null
    ? "missing"
    : score >= 80
      ? "good"
      : score >= 60
        ? "fair"
        : "poor";
}
export const MOCK_BAND_LABELS = {
  missing: "待补充",
  good: "充分",
  fair: "待加强",
  poor: "明显不足",
};
export function mockElapsed(s: MockInterviewSession, now = Date.now()) {
  return s.elapsedMs + (s.runningSince ? Math.max(0, now - s.runningSince) : 0);
}
export function dimensionScore(dimensions: MockDimension[]) {
  const scored = dimensions.filter(
    (d) => d.status === "scored" && d.score !== null,
  );
  const weight = (id: MockDimension["id"]) =>
    MOCK_DIMENSIONS.find((d) => d.id === id)!.weight;
  const sum = scored.reduce((n, d) => n + weight(d.id), 0);
  return sum
    ? Math.round(scored.reduce((n, d) => n + d.score! * weight(d.id), 0) / sum)
    : null;
}
