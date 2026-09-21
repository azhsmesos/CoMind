import type { InterviewScript, Round, Session } from "./types";

export interface MobileAddress {
  name: string;
  address: string;
}
export interface MobileRuntime {
  enabled: boolean;
  addresses: MobileAddress[];
  address?: string;
  url?: string;
  clients: number;
  error?: string;
}
export type MobileCommand =
  | { type: "mobile:start"; address?: string }
  | { type: "mobile:stop" | "mobile:reset" | "mobile:refresh" };
export interface MobileRound {
  id: string;
  question: string;
  createdAt: string;
  source: Round["source"];
  status: Round["status"];
  answer?: InterviewScript;
  error?: string;
}
export interface MobileSession {
  id: string;
  name: string;
  status: Session["status"];
}
export interface MobilePage {
  session: MobileSession | null;
  rounds: MobileRound[];
  before: number | null;
  revision: number;
}
export type MobileEvent =
  | ({ type: "snapshot" } & MobilePage)
  | {
      type: "update";
      session: MobileSession;
      rounds: MobileRound[];
      removed: string[];
      revision: number;
    }
  | { type: "closed"; reason: string };
