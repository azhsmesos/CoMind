const { _electron: electron } = require("playwright");
const { expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { once } = require("node:events");
const { MOCK_DIMENSIONS } = require("../dist-electron/shared/mock");
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comind-mock-e2e-"));
  let questions = 0,
    app;
  const api = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    const system = payload.messages[0].content;
    const user = payload.messages[1].content;
    let output;
    if (system.includes("你扮演面试官")) {
      output = {
        question: "请介绍你负责的订单优化项目 " + ++questions,
        category: "experience",
        followup: false,
      };
    }
    if (system.includes("从 JD")) output = { role: "后端工程师" };
    if (system.includes("解析后的完整简历"))
      output = { text: "张测试：我负责订单优化项目" };
    if (system.includes("判断口述")) output = { complete: true };
    if (system.includes("分析当前题")) {
      const answer = JSON.parse(user).actualResponse;
      output = {
        dimensions: MOCK_DIMENSIONS.map((d, i) => ({
          id: d.id,
          status: i < 3 ? "scored" : "insufficient",
          score: i < 3 ? [85, 70, 50][i] : null,
          evidence: i < 3 ? answer : "",
          reason: "请补充个人行动的细节",
        })),
        improvement: "补充技术取舍与指标口径",
        reference: [
          "背景与业务目标(S)",
          "任务与难点(T)",
          "个人行动及技术取舍(A)",
          "业务结果与技术指标(R)",
        ].map((heading) => ({
          heading,
          text: "我负责订单优化项目，具体业务结果待补充。",
        })),
        metrics: [
          {
            name: "延迟",
            baseline: "待补充",
            result: "待补充",
            period: "待补充",
            scope: "待补充",
            evidence: "",
          },
        ],
        missing: ["补充延迟基线与统计口径"],
      };
    }
    if (system.includes("总结整场"))
      output = {
        summary: "已完成训练，需补充量化依据",
        strengths: ["清晰"],
        weaknesses: ["缺少证据"],
        nextSteps: ["补充真实指标"],
      };
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(output) } }],
      }),
    );
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const env = {
    ...process.env,
    NODE_ENV: "test",
    COMIND_E2E: "1",
    COMIND_TEST_DATA: dir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    app = await electron.launch({ args: ["."], env });
    let desktop;
    for (let i = 0; i < 100; i++) {
      desktop = app.windows().find((p) => p.url().endsWith("/dist/index.html"));
      if (desktop) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(desktop);
    desktop.setDefaultTimeout(15000);
    await app.evaluate(({ BrowserWindow }) => {
      globalThis.fixtureWindowEvents = [];
      const main = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith("/dist/index.html"),
      );
      for (const e of ["hide", "show", "close"])
        main.on(e, () => globalThis.fixtureWindowEvents.push(e));
      for (const e of ["did-start-loading", "render-process-gone"])
        main.webContents.on(e, () => globalThis.fixtureWindowEvents.push(e));
    });
    const errors = [];
    desktop.on("pageerror", (e) => errors.push(e.message));
    await desktop.evaluate(async (baseUrl) => {
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
      await window.api.command({
        type: "model:save",
        config: {
          id: "mock",
          name: "测试模型",
          provider: "custom",
          protocol: "openai",
          baseUrl,
          model: "fake",
          apiKey: "FIXTURE_KEY",
        },
      });
      await window.api.command({
        type: "materials:save",
        materials: {
          resume: "我负责订单优化项目",
          jd: "后端工程师",
          answers: [],
          scripts: [],
        },
      });
    }, "http://127.0.0.1:" + api.address().port);
    await desktop
      .getByRole("button", { name: "模拟面试", exact: true })
      .click();
    await desktop
      .getByRole("button", { name: "从资料库导入", exact: true })
      .click();
    await expect(desktop.getByLabel("模拟面试简历")).toHaveValue(
      "我负责订单优化项目",
    );
    await desktop
      .locator('input[type="file"]')
      .setInputFiles("tests/fixtures/resume.doc");
    await expect(desktop.getByLabel("模拟面试简历")).toHaveValue(
      "张测试：我负责订单优化项目",
    );
    await desktop
      .getByRole("button", { name: "根据 JD 识别岗位", exact: true })
      .click();
    await expect(desktop.getByLabel("目标岗位", { exact: true })).toHaveValue(
      "后端工程师",
    );
    await desktop.getByLabel("面试难度").selectOption("P7");
    await desktop
      .getByRole("button", { name: "开始模拟面试", exact: true })
      .click();
    await expect(desktop.locator(".mock-question")).toContainText("订单优化");
    await expect(desktop.getByText("参考答案 · 可直接口述")).toHaveCount(0);
    await desktop
      .getByLabel("你的回答")
      .fill("我负责订单优化项目，并解释了缓存的一致性取舍。");
    await desktop
      .getByRole("button", { name: "我答完了", exact: true })
      .click();
    await expect(desktop.locator(".mock-question")).toContainText("项目 2");
    await desktop
      .getByRole("button", { name: "暂停面试", exact: true })
      .click();
    await expect(
      desktop.getByRole("button", { name: "继续面试", exact: true }),
    ).toBeVisible();
    await desktop
      .getByRole("button", { name: "继续面试", exact: true })
      .click();
    await desktop
      .getByRole("button", { name: "跳过本题", exact: true })
      .click();
    await expect(desktop.locator(".mock-question")).toContainText("项目 3");
    await desktop
      .getByRole("button", { name: "结束并复盘", exact: true })
      .click();
    await expect(
      desktop.getByText("报告已完成并保存到本机", { exact: true }),
    ).toBeVisible();
    for (const color of ["good", "fair", "poor", "missing"])
      await expect(
        desktop.locator(".mock-dimension." + color).first(),
      ).toBeVisible();
    await expect(
      desktop.getByText("背景与业务目标(S)", { exact: true }),
    ).toBeVisible();
    assert.equal(
      (await desktop.evaluate(() => window.api.getState())).sessions.length,
      0,
    );
    const overlay = app.windows().find((p) => p.url().includes("#overlay"));
    assert(overlay);
    assert.equal(
      (await overlay.evaluate(() => window.api.getState())).mockInterviews
        .length,
      0,
    );
    await desktop
      .getByRole("button", { name: "复制本题答案", exact: true })
      .click();
    const clipboard = await app.evaluate(({ clipboard }) =>
      clipboard.readText(),
    );
    assert(clipboard.includes("背景与业务目标"));
    await app.evaluate(
      ({ dialog }, destination) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: destination,
        });
      },
      path.join(dir, "report.md"),
    );
    await desktop
      .getByRole("button", { name: "导出 Markdown", exact: true })
      .click();
    await expect
      .poll(() => fs.existsSync(path.join(dir, "report.md")))
      .toBe(true);
    assert(
      fs.readFileSync(path.join(dir, "report.md"), "utf8").includes("未作答"),
    );
    await desktop.screenshot({
      path: "/tmp/comind-mock-report.png",
      fullPage: true,
    });

    // Use isolated ASR + microphone adapters for deterministic renderer-to-main integration.
    await app.evaluate(() => {
      const require = process
        .getBuiltinModule("module")
        .createRequire(process.cwd() + "/package.json");
      const {
        AudioCapture,
      } = require("./dist-electron/electron/audio-capture");
      const { QwenAsr } = require("./dist-electron/electron/qwen-asr");
      const original = AudioCapture.prototype.start;
      AudioCapture.prototype.start = async function (...args) {
        if (this.source !== "microphone") return original.apply(this, args);
        globalThis.mockMicStarts = (globalThis.mockMicStarts || 0) + 1;
      };
      QwenAsr.prototype.connect = async function () {
        globalThis.mockAsr = this;
      };
      QwenAsr.prototype.send = function () {};
      QwenAsr.prototype.close = function () {};
    });
    await desktop.evaluate(() =>
      window.api.command({
        type: "voice:save",
        workspaceId: "fixture",
        apiKey: "FAKE_ASR",
      }),
    );
    await desktop
      .getByRole("button", { name: "新建模拟面试", exact: true })
      .click();
    await desktop.getByLabel("作答方式").selectOption("voice");
    // Intercept only synthesis in this test; real system voice availability is reported separately.
    const localVoices = await desktop.evaluate(() =>
      speechSynthesis
        .getVoices()
        .filter((v) => /^zh/i.test(v.lang) && v.localService)
        .map((v) => v.name),
    );
    console.log("Local Chinese voices:", JSON.stringify(localVoices));
    await desktop.evaluate(() => {
      const synth = window.speechSynthesis;
      Object.defineProperty(synth, "getVoices", {
        configurable: true,
        value: () => [
          {
            name: "测试中文",
            voiceURI: "test",
            lang: "zh-CN",
            localService: true,
          },
        ],
      });
      // Fake speak does not need native voice assignment: separately bypass the property setter.
      window.SpeechSynthesisUtterance = class {
        constructor(text) {
          this.text = text;
        }
      };
      synth.speak = (utterance) => {
        window.testUtterance = utterance;
      };
      synth.cancel = () => {};
      synth.dispatchEvent(new Event("voiceschanged"));
    });
    await desktop
      .getByRole("button", { name: "开始模拟面试", exact: true })
      .click();
    await expect(
      desktop.getByText("面试官正在提问…", { exact: true }),
    ).toBeVisible();
    assert.equal(await app.evaluate(() => globalThis.mockMicStarts || 0), 0);
    await desktop
      .getByRole("button", { name: "开始回答", exact: true })
      .click();
    await expect(
      desktop.getByText("正在听你回答", { exact: true }),
    ).toBeVisible();
    await app.evaluate(() =>
      globalThis.mockAsr.callbacks.event({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "voice",
        transcript: "我负责订单服务并做了缓存优化",
      }),
    );
    await expect(desktop.getByLabel("你的回答")).toHaveValue(
      "我负责订单服务并做了缓存优化",
    );
    try {
      await expect(
        desktop.getByRole("button", { name: "继续回答", exact: true }),
      ).toBeVisible({ timeout: 15000 });
    } catch (error) {
      console.log(
        "window events",
        await app.evaluate(() => globalThis.fixtureWindowEvents),
      );
      console.log(
        "runtime",
        await desktop.evaluate(
          async () => (await window.api.getState()).runtime.mock,
        ),
      );
      throw error;
    }
    await desktop
      .getByRole("button", { name: "继续回答", exact: true })
      .click();
    await expect(
      desktop.getByRole("button", { name: "继续回答", exact: true }),
    ).toHaveCount(0);
    await desktop
      .getByRole("button", { name: "我答完了", exact: true })
      .click();
    await expect(
      desktop.getByText("面试官正在提问…", { exact: true }),
    ).toBeVisible();
    await desktop
      .getByRole("button", { name: "暂停面试", exact: true })
      .click();
    assert.equal(
      (await desktop.evaluate(() => window.api.getState())).runtime.mock.mic,
      "off",
    );
    await desktop.screenshot({
      path: "/tmp/comind-mock-interview.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await app.close();
    app = undefined;
    app = await electron.launch({ args: ["."], env });
    let restored;
    for (let i = 0; i < 100; i++) {
      restored = app
        .windows()
        .find((p) => p.url().endsWith("/dist/index.html"));
      if (restored) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await expect
      .poll(
        async () =>
          (await restored.evaluate(() => window.api.getState())).mockInterviews
            .length,
      )
      .toBe(2);
    const state = await restored.evaluate(() => window.api.getState());
    assert.equal(state.mockInterviews[0].status, "paused");
    assert.equal(state.mockInterviews[1].report.status, "complete");
    assert.equal(state.runtime.mock.mic, "off");
    console.log(
      "PASS mock E2E: preparation, role, difficulty, Q&A, pause, skip, report colors, STAR, copy/export, privacy, voice turn taking, countdown, restart",
    );
  } finally {
    if (app) await app.close();
    api.closeAllConnections();
    await new Promise((r) => api.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
