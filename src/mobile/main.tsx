import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { MobileEvent, MobilePage, MobileRound } from "../../shared/mobile";
import { Answer, isAlgorithmAnswer } from "../components/Answer";
import "./mobile.css";

const fragment = location.hash.slice(1);
if (fragment) {
  sessionStorage.setItem("comind-mobile-token", fragment);
  history.replaceState(null, "", location.pathname);
}
const token = sessionStorage.getItem("comind-mobile-token") || "";
const sourceLabels = {
  voice: "会议提问",
  screenshot: "截图提问",
  manual: "手动提问",
  browser: "网页提问",
};
const statusLabels = {
  ongoing: "进行中",
  paused: "已暂停",
  completed: "已结束",
};
function Reader() {
  const [page, setPage] = useState<MobilePage>({
    session: null,
    rounds: [],
    before: null,
    revision: 0,
  });
  const current = useRef(page);
  current.current = page;
  const [connection, setConnection] = useState(
    token ? "正在连接电脑…" : "请扫描电脑上的二维码或打开完整共享链接",
  );
  const [connected, setConnected] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copyHint, setCopyHint] = useState("");
  const follow = useRef(true);
  const prependHeight = useRef<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const revisionRef = useRef(0);
  const fatalRef = useRef(false);
  useEffect(() => {
    const onScroll = () => {
      follow.current =
        document.documentElement.scrollHeight - innerHeight - scrollY < 100;
      if (follow.current) setFresh(false);
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => {
    if (prependHeight.current !== null) {
      scrollBy(
        0,
        document.documentElement.scrollHeight - prependHeight.current,
      );
      prependHeight.current = null;
    } else if (follow.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [page]);
  useEffect(() => {
    if (!token) return;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let disposed = false;
    let fatal = false;
    const connect = () => {
      if (disposed || fatal) return;
      clearTimeout(retry);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/events`,
      );
      socket = ws;
      setConnected(false);
      setConnection("正在连接电脑…");
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));
      ws.onmessage = (event) => {
        if (disposed || ws !== socket) return;
        const msg = JSON.parse(event.data) as MobileEvent;
        if (msg.type === "closed") {
          fatal = true;
          fatalRef.current = true;
          sessionStorage.removeItem("comind-mobile-token");
          setConnected(false);
          setConnection(msg.reason);
          setFresh(false);
          return;
        }
        attempts = 0;
        setConnected(true);
        setConnection("已连接 · 实时同步");
        if (msg.type === "snapshot") {
          const switching = current.current.session?.id !== msg.session?.id;
          if (switching) {
            follow.current = true;
            setFresh(false);
          } else if (!follow.current && msg.revision !== revisionRef.current)
            setFresh(true);
          revisionRef.current = msg.revision;
          current.current = msg;
          setPage(msg);
        } else {
          if (
            msg.session.id !== current.current.session?.id ||
            msg.revision <= revisionRef.current
          )
            return;
          revisionRef.current = msg.revision;
          if (!follow.current && msg.rounds.length) setFresh(true);
          setPage((previous) => {
            const map = new Map(previous.rounds.map((r) => [r.id, r]));
            for (const id of msg.removed) map.delete(id);
            for (const r of msg.rounds) map.set(r.id, r);
            const next = {
              ...previous,
              session: msg.session,
              revision: msg.revision,
              rounds: [...map.values()].sort((a, b) =>
                a.createdAt.localeCompare(b.createdAt),
              ),
            };
            current.current = next;
            return next;
          });
        }
      };
      ws.onclose = (event) => {
        if (disposed || ws !== socket) return;
        setConnected(false);
        if (event.code === 4001 || event.code === 4003) {
          fatal = true;
          fatalRef.current = true;
          sessionStorage.removeItem("comind-mobile-token");
          setConnection(event.reason || "访问已失效，请重新扫码");
        }
        if (fatal) return;
        setConnection("连接中断，正在重连；已有答案仍可阅读");
        const delay = [1000, 2000, 4000][attempts++] || 10000;
        retry = setTimeout(connect, delay);
      };
      ws.onerror = () => {
        /* onclose handles reconnect without logging credentials. */
      };
    };
    const foreground = () => {
      if (document.visibilityState === "visible") connect();
    };
    connect();
    document.addEventListener("visibilitychange", foreground);
    addEventListener("online", connect);
    return () => {
      disposed = true;
      clearTimeout(retry);
      socket?.close();
      document.removeEventListener("visibilitychange", foreground);
      removeEventListener("online", connect);
    };
  }, []);
  async function earlier() {
    if (!page.session || page.before === null || loading) return;
    setLoading(true);
    const sessionId = page.session.id;
    const requestedRevision = page.revision;
    try {
      const response = await fetch(
        `/api/rounds?session=${encodeURIComponent(sessionId)}&before=${page.before}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? "访问已失效，请重新扫码"
            : "无法加载，请等待重连后重试",
        );
      const older = (await response.json()) as MobilePage;
      if (current.current.session?.id !== sessionId || fatalRef.current) return;
      // Do not overwrite fresher socket updates with a delayed HTTP response.
      if (
        older.revision !== requestedRevision ||
        current.current.revision !== requestedRevision
      )
        return;
      prependHeight.current = document.documentElement.scrollHeight;
      setPage((previous) => {
        if (previous.session?.id !== sessionId) return previous;
        const map = new Map(older.rounds.map((r) => [r.id, r]));
        for (const r of previous.rounds) map.set(r.id, r);
        return {
          ...previous,
          before: older.before,
          rounds: [...map.values()].sort((a, b) =>
            a.createdAt.localeCompare(b.createdAt),
          ),
        };
      });
    } catch (error) {
      setCopyHint(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }
  async function copy(round: MobileRound, codeOnly = false) {
    const a = round.answer;
    const text = codeOnly
      ? a?.code || ""
      : a && isAlgorithmAnswer(a)
        ? `${a.approach || a.summary}\n\n${a.code}`
        : a?.summary || "";
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(text);
      setCopyHint("已复制");
    } catch {
      const card = list.current?.querySelector(
        `[data-round="${CSS.escape(round.id)}"]`,
      );
      const target = card?.querySelector(codeOnly ? "pre" : ".answer-content");
      if (target) {
        const range = document.createRange();
        range.selectNodeContents(target);
        const selection = getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setCopyHint("已选中内容，请长按并选择复制");
    }
  }
  return (
    <>
      <header className="reader-header">
        <div>
          <span className="brand">
            CoMind <small>手机查看</small>
          </span>
          <h1>{page.session?.name || "等待电脑开启会话"}</h1>
        </div>
        <span className={connected ? "connection online" : "connection"}>
          {connection}
        </span>
        {page.session && (
          <small>{statusLabels[page.session.status]} · 只读</small>
        )}
      </header>
      <main ref={list}>
        {page.before !== null && (
          <button
            className="earlier"
            disabled={loading || !connected}
            onClick={() => void earlier()}
          >
            {loading ? "加载中…" : "查看更早问答"}
          </button>
        )}
        {!page.rounds.length && (
          <div className="empty">
            {token
              ? "电脑生成答案后会自动显示在这里。"
              : "在电脑工作台打开「手机查看」，开启共享后扫码。"}
            <p>
              手机和电脑需连接同一可互访网络。无法连接时，请检查防火墙、访客
              Wi-Fi 隔离或 VPN，并使用 Safari / Chrome 打开。
            </p>
          </div>
        )}
        {page.rounds.map((round) => (
          <article
            key={round.id}
            data-round={round.id}
            className="reader-round"
          >
            <div className="round-meta">
              <span>{sourceLabels[round.source]}</span>
              <time>{new Date(round.createdAt).toLocaleTimeString()}</time>
            </div>
            <h2>{round.question}</h2>
            {round.status === "generating" && (
              <p className="generating" role="status">
                正在回答…
              </p>
            )}
            {round.answer && (
              <>
                <Answer answer={round.answer} compact />
                <div className="copy-actions">
                  <button onClick={() => void copy(round)}>复制答案</button>
                  {isAlgorithmAnswer(round.answer) && round.answer.code && (
                    <button onClick={() => void copy(round, true)}>
                      复制代码
                    </button>
                  )}
                </div>
              </>
            )}
            {round.status === "error" && <p role="alert">{round.error}</p>}
            {round.status === "idle" && !round.answer && (
              <p className="muted">等待电脑生成答案</p>
            )}
          </article>
        ))}
        <div ref={bottom} className="reader-bottom" />
      </main>
      {copyHint && (
        <div
          className="copy-hint"
          role="status"
          onClick={() => setCopyHint("")}
        >
          {copyHint}
          <button aria-label="关闭提示">×</button>
        </div>
      )}
      {fresh && (
        <button
          className="new-answer"
          onClick={() => {
            follow.current = true;
            setFresh(false);
            bottom.current?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          有新答案 ↓
        </button>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Reader />);
