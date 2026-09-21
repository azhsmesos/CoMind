import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import type { Session, InterviewScript } from "../shared/types";
import type {
  MobileAddress,
  MobileRuntime,
  MobilePage,
  MobileRound,
  MobileSession,
} from "../shared/mobile";

export function localAddresses(): MobileAddress[] {
  return Object.entries(os.networkInterfaces())
    .filter(
      ([name]) =>
        !/^(lo|utun|tun|tap|veth|docker|bridge|awdl|llw|tailscale)/i.test(name),
    )
    .flatMap(([name, addresses]) =>
      (addresses || [])
        .filter(
          (a) =>
            a.family === "IPv4" &&
            !a.internal &&
            /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(
              a.address,
            ),
        )
        .map((a) => ({ name, address: a.address })),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
// Explicit field selection: never ship the desktop snapshot, screenshots or credentials.
export function publicRound(r: Session["rounds"][number]): MobileRound {
  let answer: InterviewScript | undefined;
  if (r.answer) {
    const a = r.answer;
    answer = {
      kind: a.kind,
      summary: a.summary,
      problem: a.problem,
      clarify: a.clarify,
      approach: a.approach,
      code: a.code,
      walkthrough: a.walkthrough,
      time_complexity: a.time_complexity,
      space_complexity: a.space_complexity,
    };
  }
  return {
    id: r.id,
    question: r.question,
    createdAt: r.createdAt,
    source: r.source,
    status: r.status,
    answer,
    error: r.status === "error" ? "生成失败，请在电脑端查看或重试" : undefined,
  };
}
export class MobileServer {
  state: MobileRuntime = { enabled: false, addresses: [], clients: 0 };
  private server?: http.Server;
  private sockets?: WebSocketServer;
  private authenticated = new Set<WebSocket>();
  private token = "";
  private origin = "";
  private epoch = 0;
  private revision = 0;
  private previousSession = "";
  private sharedSessionId?: string;
  private previous = new Map<string, string>();
  private publishTimer?: ReturnType<typeof setTimeout>;
  private networkTimer?: ReturnType<typeof setInterval>;
  constructor(
    private getData: () => {
      sessions: Session[];
      activeSessionId: string | null;
    },
    private assets: string,
    private changed: () => void,
    private addresses = localAddresses,
  ) {}
  refresh() {
    this.state.addresses = this.addresses();
    this.changed();
  }
  private active() {
    const data = this.getData();
    if (data.activeSessionId) this.sharedSessionId = data.activeSessionId;
    return data.sessions.find((s) => s.id === this.sharedSessionId);
  }
  private session(s?: Session): MobileSession | null {
    return s ? { id: s.id, name: s.name, status: s.status } : null;
  }
  private page(before?: number): MobilePage {
    const s = this.active();
    const end = Math.min(
      before ?? s?.rounds.length ?? 0,
      s?.rounds.length ?? 0,
    );
    const start = Math.max(0, end - 50);
    return {
      session: this.session(s),
      rounds: (s?.rounds.slice(start, end) || []).map(publicRound),
      before: start || null,
      revision: this.revision,
    };
  }
  async start(address?: string) {
    this.stop();
    const epoch = this.epoch;
    const available = this.addresses();
    address ||= available[0]?.address;
    if (!available.some((a) => a.address === address))
      throw new Error("没有可用的局域网地址，请连接 Wi-Fi 或有线网络后刷新");
    if (!fs.existsSync(path.join(this.assets, "index.html")))
      throw new Error(
        "手机页面尚未构建，请重新运行 npm run dev 或 npm run build",
      );
    const server = http.createServer((req, res) => this.route(req, res));
    server.requestTimeout = 10000;
    server.headersTimeout = 10000;
    this.server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, address, () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
      if (epoch !== this.epoch) {
        server.close();
        return;
      }
      server.on("error", () => this.stop("手机共享服务异常，请重新开启"));
      const bound = server.address();
      if (!bound || typeof bound === "string")
        throw new Error("无法启动手机共享");
      this.origin = `http://${address}:${bound.port}`;
      this.token = randomBytes(32).toString("base64url");
      this.state = {
        enabled: true,
        addresses: available,
        address,
        clients: 0,
        url: `${this.origin}/#${this.token}`,
      };
      const sockets = new WebSocketServer({
        noServer: true,
        maxPayload: 2048,
        perMessageDeflate: false,
      });
      this.sockets = sockets;
      server.on("upgrade", (req, socket, head) => {
        if (
          epoch !== this.epoch ||
          !this.state.enabled ||
          req.url !== "/events" ||
          req.headers.host !== new URL(this.origin).host ||
          req.headers.origin !== this.origin ||
          sockets.clients.size >= 5
        ) {
          socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          return;
        }
        sockets.handleUpgrade(req, socket, head, (ws) => this.connect(ws));
      });
      this.publishNow();
      this.networkTimer = setInterval(() => {
        if (!this.addresses().some((a) => a.address === address))
          this.stop("网络地址已变化，请重新开启共享并扫码");
      }, 5000);
      this.changed();
    } catch {
      if (epoch === this.epoch)
        this.stop("无法监听局域网地址，请检查网络后重试");
      throw new Error("无法启动手机共享，请检查局域网地址是否仍可用");
    }
  }
  reset() {
    if (!this.state.enabled) return;
    this.token = randomBytes(32).toString("base64url");
    this.state.url = `${this.origin}/#${this.token}`;
    this.disconnect("访问链接已重置，请重新扫码");
    this.changed();
  }
  private valid(token?: string) {
    if (!token || !this.token || token.length !== this.token.length)
      return false;
    const a = Buffer.from(token),
      b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  private connect(ws: WebSocket) {
    let live = true;
    const deadline = setTimeout(() => ws.close(4001, "请重新扫码"), 5000);
    const heartbeat = setInterval(() => {
      if (!live) {
        ws.terminate();
        return;
      }
      live = false;
      ws.ping();
    }, 15000);
    ws.on("pong", () => {
      live = true;
    });
    ws.on("error", () => ws.terminate());
    ws.on("close", () => {
      clearTimeout(deadline);
      clearInterval(heartbeat);
      if (this.authenticated.delete(ws)) {
        this.state.clients = this.authenticated.size;
        this.changed();
      }
    });
    ws.on("message", (raw) => {
      if (this.authenticated.has(ws)) {
        ws.close(4003, "只读连接");
        return;
      }
      try {
        const msg = JSON.parse(raw.toString());
        if (
          msg.type !== "auth" ||
          typeof msg.token !== "string" ||
          !this.valid(msg.token)
        )
          throw new Error();
        clearTimeout(deadline);
        this.publishNow();
        this.authenticated.add(ws);
        this.send(ws, { type: "snapshot", ...this.page() });
        this.state.clients = this.authenticated.size;
        this.changed();
      } catch {
        ws.close(4001, "请重新扫码");
      }
    });
  }
  private send(ws: WebSocket, data: unknown) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 2_000_000) {
      ws.close(4008, "请重新连接");
      return;
    }
    ws.send(JSON.stringify(data));
  }
  publish() {
    if (!this.state.enabled || this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined;
      this.publishNow();
    }, 60);
  }
  private publishNow() {
    if (!this.state.enabled) return;
    const s = this.active();
    const session = this.session(s);
    const signature = JSON.stringify(session);
    const rounds = (s?.rounds || []).map(publicRound);
    const next = new Map(rounds.map((r) => [r.id, JSON.stringify(r)]));
    const changed = rounds.filter(
      (r) => this.previous.get(r.id) !== next.get(r.id),
    );
    const removed = [...this.previous.keys()].filter((id) => !next.has(id));
    if (
      signature === this.previousSession &&
      !changed.length &&
      !removed.length
    )
      return;
    const previousId = this.previousSession
      ? JSON.parse(this.previousSession)?.id
      : null;
    this.revision++;
    this.previousSession = signature;
    this.previous = next;
    const event =
      previousId !== session?.id || !session
        ? { type: "snapshot", ...this.page() }
        : {
            type: "update",
            session,
            rounds: changed,
            removed,
            revision: this.revision,
          };
    for (const ws of this.authenticated) this.send(ws, event);
  }
  private route(req: http.IncomingMessage, res: http.ServerResponse) {
    const end = (status: number, data: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws:; frame-ancestors 'none'; base-uri 'none'",
    );
    if (!this.state.enabled || req.headers.host !== new URL(this.origin).host) {
      end(403, { error: "共享未开启" });
      return;
    }
    if (req.method !== "GET") {
      end(405, { error: "只读接口" });
      return;
    }
    if (req.headers.origin && req.headers.origin !== this.origin) {
      end(403, { error: "来源无效" });
      return;
    }
    const url = new URL(req.url || "/", this.origin);
    if (url.pathname === "/api/rounds") {
      if (
        !this.valid(
          req.headers.authorization?.startsWith("Bearer ")
            ? req.headers.authorization.slice(7)
            : undefined,
        )
      ) {
        end(401, { error: "访问已失效，请重新扫码" });
        return;
      }
      const s = this.active();
      if (url.searchParams.get("session") !== (s?.id || "")) {
        end(409, { error: "会话已切换" });
        return;
      }
      const value = url.searchParams.get("before");
      const before = value === null ? undefined : Number(value);
      if (
        before !== undefined &&
        (!Number.isSafeInteger(before) ||
          before < 0 ||
          before > (s?.rounds.length || 0))
      ) {
        end(400, { error: "分页参数无效" });
        return;
      }
      this.publishNow();
      end(200, this.page(before));
      return;
    }
    // Serve only the isolated mobile build, never desktop resources or arbitrary paths.
    const file =
      url.pathname === "/" || url.pathname === "/index.html"
        ? "index.html"
        : /^\/assets\/[\w.-]+\.(js|css)$/.test(url.pathname)
          ? url.pathname.slice(1)
          : null;
    if (!file) {
      end(404, { error: "未找到" });
      return;
    }
    try {
      const data = fs.readFileSync(path.join(this.assets, file));
      res.writeHead(200, {
        "Content-Type": file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html; charset=utf-8",
      });
      res.end(data);
    } catch {
      end(404, { error: "未找到" });
    }
  }
  private disconnect(reason: string) {
    for (const ws of this.sockets?.clients || []) {
      if (this.authenticated.has(ws)) this.send(ws, { type: "closed", reason });
      ws.close(4001, reason);
      const timer = setTimeout(() => ws.terminate(), 250);
      timer.unref();
    }
    this.authenticated.clear();
    this.state.clients = 0;
  }
  stop(error?: string) {
    this.epoch++;
    clearTimeout(this.publishTimer);
    this.publishTimer = undefined;
    clearInterval(this.networkTimer);
    this.disconnect(error || "电脑已关闭共享，请重新扫码");
    this.sockets?.close();
    this.sockets = undefined;
    this.server?.close();
    this.server?.closeAllConnections();
    this.server = undefined;
    this.token = "";
    this.previous.clear();
    this.previousSession = "";
    this.sharedSessionId = undefined;
    this.state = {
      enabled: false,
      clients: 0,
      addresses: this.addresses(),
      error,
    };
    this.changed();
  }
}
