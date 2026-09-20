const status = document.getElementById("status");
const hint = document.getElementById("hint");
const shortcutButton = document.getElementById("shortcut");

function show(ok, message) {
  status.className = ok ? "ok" : "bad";
  status.textContent = message;
}

function ask(type) {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ type }, resolve),
  );
}

function setHint(nodes) {
  hint.replaceChildren(...nodes);
}

/**
 * Chrome assigns a suggested_key only at install time and silently leaves the
 * shortcut blank if anything else already claims the combo — so an unbound
 * command looks identical to a broken extension. Say which it is.
 */
async function reportShortcut() {
  const commands = await chrome.commands.getAll();
  const send = commands.find((c) => c.name === "send-page");
  if (send && send.shortcut) {
    const kbd = document.createElement("kbd");
    kbd.textContent = send.shortcut;
    setHint([
      document.createTextNode("按 "),
      kbd,
      document.createTextNode(" 发送当前网页。"),
    ]);
    shortcutButton.hidden = true;
  } else {
    const bold = document.createElement("b");
    bold.textContent = "快捷键尚未绑定。";
    setHint([
      bold,
      document.createTextNode(" 默认组合可能被占用，请点击下方按钮设置。"),
    ]);
    shortcutButton.hidden = false;
  }
}

shortcutButton.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

reportShortcut();

async function refreshStatus() {
  const s = await ask("status");
  // A silent hotkey means a failed send leaves no trace on screen — this is
  // where you find out it happened.
  if (s?.lastError) {
    const ago = Math.round((Date.now() - s.lastError.at) / 1000);
    show(false, `上次发送失败（${ago} 秒前）：${s.lastError.error}`);
    return s;
  }
  show(
    !!s?.paired,
    s?.paired ? "已连接CoMind。" : "尚未连接，将尝试自动配对。",
  );
  return s;
}

// If the desktop app is already up, finish pairing the moment the popup opens.
refreshStatus().then(async (s) => {
  if (s?.paired || s?.lastError) return;
  show(true, "正在连接…");
  const r = await ask("pair");
  show(!!r?.ok, r?.ok ? "已连接CoMind。" : r?.error || "暂时无法连接。");
});

document.getElementById("pair").addEventListener("click", async () => {
  show(true, "正在重新配对…");
  const r = await ask("pair");
  show(!!r?.ok, r?.ok ? "已连接CoMind。" : r?.error || "配对失败。");
});

document.getElementById("send").addEventListener("click", async () => {
  show(true, "正在发送…");
  const r = await ask("send");
  show(
    !!r?.ok,
    r?.ok
      ? `已发送 ${r.chars} 个字符，请查看CoMind。`
      : r?.error || "发送失败。",
  );
});
