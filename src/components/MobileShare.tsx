import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Smartphone } from "lucide-react";
import type { DesktopState } from "../types";
import type { Run } from "./Models";
export function MobileShare({ state, run }: { state: DesktopState; run: Run }) {
  const share = state.runtime.mobile;
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setQr("");
    if (share.url)
      void QRCode.toDataURL(share.url, {
        width: 240,
        margin: 2,
        errorCorrectionLevel: "M",
      })
        .then((url) => {
          if (!cancelled) setQr(url);
        })
        .catch(() => {
          if (!cancelled) setError("二维码生成失败，请复制网址");
        });
    return () => {
      cancelled = true;
    };
  }, [share.url]);
  useEffect(() => {
    if (!share.addresses.some((a) => a.address === address))
      setAddress(share.address || share.addresses[0]?.address || "");
  }, [share.addresses, share.address, address]);
  async function action(
    type: "mobile:start" | "mobile:stop" | "mobile:reset" | "mobile:refresh",
  ) {
    setBusy(true);
    setError("");
    try {
      const result = await run(
        type === "mobile:start" ? { type, address } : { type },
      );
      if (!result.ok) setError(result.error || "操作失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card mobile-share">
      <div className="mobile-share-heading">
        <div>
          <h3>
            <Smartphone size={20} /> 手机查看
          </h3>
          <p>
            {share.enabled
              ? `共享已开启 · ${share.clients} 个页面连接`
              : "扫码在手机上实时查看当前会话的问答"}
          </p>
        </div>
        <button
          onClick={() => {
            setOpen(!open);
            if (!open) void action("mobile:refresh");
          }}
        >
          {open ? "收起" : "手机查看"}
        </button>
      </div>
      {open && (
        <div className="mobile-share-body">
          <div className="mobile-share-settings">
            <label>
              局域网地址
              <select
                value={address}
                disabled={busy || share.enabled}
                onChange={(e) => setAddress(e.target.value)}
              >
                {!share.addresses.length && (
                  <option value="">未发现可用网络</option>
                )}
                {share.addresses.map((a) => (
                  <option key={a.address} value={a.address}>
                    {a.name} · {a.address}
                  </option>
                ))}
              </select>
            </label>
            <div className="button-row">
              {share.enabled ? (
                <>
                  <button
                    disabled={busy}
                    onClick={() => void action("mobile:stop")}
                  >
                    关闭共享
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void action("mobile:reset")}
                  >
                    重置访问链接
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="primary"
                    disabled={busy || !address}
                    onClick={() => void action("mobile:start")}
                  >
                    开启共享
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void action("mobile:refresh")}
                  >
                    刷新地址
                  </button>
                </>
              )}
            </div>
            <p>
              电脑和手机连接同一可互访网络，在 Safari 或 Chrome
              打开。手机只能阅读当前会话，不需要填写 API Key。
            </p>
            <p>
              仅在可信局域网使用；链接具有访问权限，传输未加密。无法连接时检查防火墙、访客
              Wi-Fi 隔离和 VPN。切换网络地址前请关闭共享。
            </p>
          </div>
          {share.url && (
            <div className="mobile-share-qr">
              {qr && (
                <img src={qr} width="240" height="240" alt="手机查看二维码" />
              )}
              <code>{share.url}</code>
              <button
                onClick={() =>
                  void run({ type: "clipboard:write", text: share.url! })
                }
              >
                复制完整网址
              </button>
            </div>
          )}
        </div>
      )}
      {(error || share.error) && (
        <p role="alert" className="error-text">
          {error || share.error}
        </p>
      )}
    </section>
  );
}
