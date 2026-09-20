import { useEffect, useRef, useState, type PointerEvent } from "react";

export function ScreenshotPicker() {
  const [frame, setFrame] = useState("");
  const [error, setError] = useState("");
  const [rect, setRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const submitting = useRef(false);
  useEffect(() => {
    void window.api.screenshot
      .frame()
      .then(setFrame)
      .catch(() => setError("截图加载失败，请按 Esc 取消后重试"));
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") void window.api.screenshot.cancel();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  function region(e: PointerEvent) {
    const x = Math.max(0, Math.min(innerWidth, e.clientX));
    const y = Math.max(0, Math.min(innerHeight, e.clientY));
    const origin = start.current!;
    return {
      x: Math.min(x, origin.x),
      y: Math.min(y, origin.y),
      width: Math.abs(x - origin.x),
      height: Math.abs(y - origin.y),
    };
  }
  return (
    <div
      className="screenshot-picker"
      onContextMenu={(e) => {
        e.preventDefault();
        void window.api.screenshot.cancel();
      }}
      onPointerDown={(e) => {
        if (e.button !== 0 || !frame || submitting.current) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY };
        setRect(null);
        setError("");
      }}
      onPointerMove={(e) => {
        if (start.current) setRect(region(e));
      }}
      onPointerCancel={() => {
        start.current = null;
        setRect(null);
      }}
      onPointerUp={async (e) => {
        if (!start.current || submitting.current) return;
        const selected = region(e);
        start.current = null;
        if (selected.width < 8 || selected.height < 8) {
          setError("请拖动框选更大的区域");
          setRect(null);
          return;
        }
        setRect(selected);
        submitting.current = true;
        try {
          const result = await window.api.screenshot.select({
            x: selected.x / innerWidth,
            y: selected.y / innerHeight,
            width: selected.width / innerWidth,
            height: selected.height / innerHeight,
          });
          if (!result.ok) setError(result.error || "截图失败，请重新框选");
        } catch {
          setError("截图服务不可用，请按 Esc 取消");
        } finally {
          submitting.current = false;
        }
      }}
    >
      {frame && (
        <img
          className="screenshot-frame"
          src={frame}
          alt=""
          draggable={false}
        />
      )}
      <div className="screenshot-hint" role="status">
        <strong>CoMind · 框选截图</strong>
        <br />
        {error || "拖动框选题目 · 松开后自动发送给当前 AI · Esc / 右键取消"}
      </div>
      {rect && (
        <div
          className="screenshot-selection"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          }}
        />
      )}
    </div>
  );
}
