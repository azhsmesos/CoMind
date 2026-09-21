// Real local speech synthesis + microphone smoke. No cloud keys or audio files.
const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comind-mock-native-"));
  const env = {
    ...process.env,
    NODE_ENV: "test",
    COMIND_E2E: "1",
    COMIND_TEST_DATA: dir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ args: ["."], env });
    let page;
    for (let i = 0; i < 100; i++) {
      page = app.windows().find((p) => p.url().endsWith("/dist/index.html"));
      if (page) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!page) throw new Error("Desktop unavailable");
    await page.evaluate(async () => {
      const s = await window.api.getState();
      await window.api.command({
        type: "preferences:save",
        preferences: {
          ...s.preferences,
          shortcuts: Object.fromEntries(
            Object.keys(s.preferences.shortcuts).map((k) => [k, ""]),
          ),
        },
      });
    });
    const result = await page.evaluate(async () => {
      for (let i = 0; i < 30 && !speechSynthesis.getVoices().length; i++)
        await new Promise((r) => setTimeout(r, 100));
      const voice = speechSynthesis
        .getVoices()
        .find((v) => v.localService && /^zh/i.test(v.lang));
      if (!voice) return { tts: "no-local-chinese-voice" };
      return new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(
          "你好，我是 CoMind 面试官。",
        );
        utterance.voice = voice;
        utterance.lang = voice.lang;
        const timer = setTimeout(() => {
          speechSynthesis.cancel();
          resolve({ tts: "timeout" });
        }, 20000);
        utterance.onend = () => {
          clearTimeout(timer);
          resolve({ tts: "completed", voice: voice.name });
        };
        utterance.onerror = (e) => {
          clearTimeout(timer);
          resolve({ tts: "error", error: e.error });
        };
        speechSynthesis.speak(utterance);
      });
    });
    const microphone = await app.evaluate(async ({ systemPreferences }) => {
      const permission = systemPreferences.getMediaAccessStatus("microphone");
      if (permission !== "granted")
        return { permission, capture: "not-tested" };
      const require = process
        .getBuiltinModule("module")
        .createRequire(process.cwd() + "/package.json");
      const {
        AudioCapture,
      } = require("./dist-electron/electron/audio-capture");
      const capture = new AudioCapture("microphone");
      let frames = 0,
        invalid = 0;
      try {
        await capture.start(
          (data) => {
            frames++;
            if (data.byteLength !== 3200) invalid++;
          },
          () => {},
        );
        await new Promise((r) => setTimeout(r, 500));
        return {
          permission,
          capture: frames > 0 && !invalid ? "passed" : "failed",
          frames,
          invalid,
        };
      } catch (e) {
        return { permission, capture: "failed", error: e.message };
      } finally {
        capture.dispose();
      }
    });
    console.log(
      JSON.stringify(
        { ...result, microphone, asr: "not-tested-no-cloud-credentials-used" },
        null,
        2,
      ),
    );
    if (result.tts !== "completed" || microphone.capture === "failed")
      process.exitCode = 1;
  } finally {
    if (app) await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
