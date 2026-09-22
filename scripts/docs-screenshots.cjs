// Documentation screenshots: real UI, temporary data, loopback-only model fixtures.
// Run after npm run build. Never reads the user's workspace or calls a cloud model.
const { _electron: electron } = require("playwright");
const { expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const { MOCK_DIMENSIONS } = require("../dist-electron/shared/mock");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "docs/images");
const resume =
  "演示候选人｜Java 后端工程师（虚构资料，仅用于文档）\n\n项目：订单查询优化\n背景：订单列表访问变慢，影响客服定位订单。\n个人行动：分析慢查询，调整索引，引入缓存，并补充一致性验证和回滚方案。\n技术栈：Java、Spring Boot、MySQL、Redis。\n业务结果和量化指标：待补充，以实际监控和业务统计为准。";
const jd =
  "Java 后端工程师\n负责订单服务的研发与稳定性治理。\n熟悉 Java、MySQL、Redis，能解释索引、缓存一致性和故障排查。\n能够独立交付项目，说明技术取舍，与业务和测试协作。";
const answer =
  "我负责订单查询优化。先分析慢查询，再调整索引并引入缓存，同时补充一致性验证和回滚方案。具体业务结果、延迟基线和统计口径待补充。";
const reference = [
  {
    heading: "背景与业务目标(S)",
    text: "订单列表访问变慢，影响客服定位订单，我参与订单查询优化，希望改善查询体验。",
  },
  {
    heading: "任务与难点(T)",
    text: "我需要定位查询瓶颈，并处理引入缓存后的数据一致性问题。具体业务约束待补充。",
  },
  {
    heading: "个人行动及技术取舍(A)",
    text: "我分析慢查询、调整索引，再引入缓存，并补充一致性验证和回滚方案。选择这些方案的对比依据待补充。",
  },
  {
    heading: "业务结果与技术指标(R)",
    text: "业务结果、延迟基线、优化后结果、时间范围和统计口径均待补充。我会根据真实监控与业务记录补齐，避免用估计值代替成果。",
  },
];
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comind-docs-"));
  fs.mkdirSync(output, { recursive: true });
  let app,
    question = 0;
  const server = http.createServer(async (req, res) => {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body);
      const system = payload.messages?.[0]?.content || "";
      let result;
      if (system.includes("你扮演面试官"))
        result = {
          question:
            ++question === 1
              ? "请介绍订单查询优化的背景、你承担的任务，以及最难处理的技术问题。"
              : "为什么选择缓存方案？请解释一致性策略与回滚边界。",
          category: "experience",
          followup: question === 2,
        };
      else if (system.includes("从 JD")) result = { role: "Java 后端工程师" };
      else if (system.includes("分析当前题"))
        result = {
          dimensions: MOCK_DIMENSIONS.map((d, i) => ({
            id: d.id,
            status: [3, 4].includes(i) ? "insufficient" : "scored",
            score: [85, 70, 55, null, null, 85][i],
            evidence: [3, 4].includes(i) ? "" : answer,
            reason: [
              "说明了索引和缓存方向，技术细节还可展开。",
              "补充方案对比与一致性策略。",
              "个人职责明确，但行动细节不足。",
              "没有提供可核对的业务结果。",
              "缺少基线、结果和统计口径。",
              "能够按背景、行动与结果组织回答。",
            ][i],
          })),
          improvement:
            "把技术选择展开为：发现的问题、备选方案、选择原因、验证方法。补充真实指标，明确个人贡献。",
          reference,
          metrics: [
            {
              name: "查询延迟",
              baseline: "待补充",
              result: "待补充",
              period: "待补充",
              scope: "待补充",
              evidence: "",
            },
          ],
          missing: [
            "延迟基线与结果",
            "统计时间与样本口径",
            "业务受益与个人职责边界",
          ],
        };
      else if (system.includes("总结整场"))
        result = {
          summary:
            "演示报告：回答结构清楚，能说出优化方向；技术取舍、个人行动细节和量化依据仍需补充。",
          strengths: ["回答围绕真实经历组织", "能指出一致性与回滚问题"],
          weaknesses: ["缺少方案对比", "成果指标尚未提供"],
          nextSteps: [
            "整理慢查询分析过程",
            "补齐监控与业务统计依据",
            "练习用 STAR 讲清个人贡献",
          ],
        };
      else if (system.includes("复盘助手"))
        result = {
          overallScore: 78,
          summary: "演示复盘：已经说明核心方案，下一步补充边界条件和验证依据。",
          strengths: ["结构清楚"],
          weaknesses: ["技术取舍需要展开"],
          qaAnalysis: [
            {
              question: "如何设计订单查询缓存？",
              actualResponse: answer,
              modelResponse: "先定位瓶颈，再明确缓存一致性边界。",
              improvement: "补充失效策略、回滚与监控。",
            },
          ],
        };
      else
        result = {
          kind: "answer",
          summary:
            "先用慢查询与执行计划定位瓶颈，再评估索引和缓存。缓存设计需明确键、过期策略、写后失效、一致性边界，以及缓存失效时数据库的承载能力。上线前验证回滚和监控，业务结果以真实统计为准。",
          problem: "",
          clarify: "",
          approach: "",
          code: "",
          walkthrough: "",
          time_complexity: "",
          space_complexity: "",
        };
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(result) } }],
        }),
      );
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const env = {
      ...process.env,
      NODE_ENV: "test",
      COMIND_E2E: "1",
      COMIND_TEST_DATA: dir,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.COMIND_SMOKE;
    app = await electron.launch({ args: [root], cwd: root, env });
    let page;
    for (let i = 0; i < 150; i++) {
      page = app.windows().find((p) => p.url().endsWith("/dist/index.html"));
      if (page) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(page, "主窗口未加载");
    page.setDefaultTimeout(15000);
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page
      .getByRole("heading", { name: "智能工作台", exact: true })
      .waitFor();
    const command = async (command) => {
      const result = await page.evaluate((c) => window.api.command(c), command);
      assert(result.ok, result.error);
      return result;
    };
    const state = await page.evaluate(() => window.api.getState());
    await command({
      type: "preferences:save",
      preferences: {
        ...state.preferences,
        shortcuts: Object.fromEntries(
          Object.keys(state.preferences.shortcuts).map((k) => [k, ""]),
        ),
      },
    });
    await command({
      type: "model:save",
      config: {
        id: "docs",
        name: "文档演示模型",
        provider: "custom",
        protocol: "openai",
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        model: "documentation-fixture",
        apiKey: "DEMO_ONLY_NOT_A_REAL_KEY",
      },
    });
    await command({
      type: "materials:save",
      materials: {
        resume,
        jd,
        answers: [],
        scripts: [
          {
            id: "demo-script",
            title: "项目介绍提纲（演示）",
            content: "背景 → 任务与难点 → 个人行动与取舍 → 结果与指标 → 复盘",
          },
        ],
      },
    });
    const nav = async (name) => {
      await page.getByRole("button", { name, exact: true }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
    };
    const shot = async (name, target = page) => {
      await page.evaluate(() => document.fonts.ready);
      await target.screenshot({
        path: path.join(output, name + ".png"),
        animations: "disabled",
        ...(target === page ? { fullPage: true } : {}),
      });
      console.log("Screenshot:", name);
    };
    await command({ type: "session:create", name: "订单系统学习 · 文档演示" });
    await page
      .getByLabel("输入题目", { exact: true })
      .fill("如何设计订单查询缓存？请说明技术取舍与验证方法。");
    await page
      .getByRole("button", { name: "添加题目并生成", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.api.getState())).sessions[0]
            ?.rounds[0]?.status,
      )
      .toBe("done");
    await shot("01-workspace");
    await command({ type: "overlay:toggle" });
    const overlay = app.windows().find((p) => p.url().includes("#overlay"));
    assert(overlay);
    await overlay
      .getByText("先用慢查询与执行计划定位瓶颈", { exact: false })
      .waitFor();
    await shot("09-overlay", overlay);
    await command({ type: "overlay:toggle" });
    // Restrict the demo share server to loopback; no live LAN link is published.
    await app.evaluate(() => {
      const require = process
        .getBuiltinModule("module")
        .createRequire(process.cwd() + "/package.json");
      const {
        MobileServer,
      } = require("./dist-electron/electron/mobile-server");
      const start = MobileServer.prototype.start;
      MobileServer.prototype.start = function (...args) {
        this.addresses = () => [{ name: "文档演示网络", address: "127.0.0.1" }];
        return start.apply(this, args);
      };
    });
    await command({ type: "mobile:start", address: "127.0.0.1" });
    const share = (await page.evaluate(() => window.api.getState())).runtime
      .mobile;
    await app.evaluate(async ({ BrowserWindow }, url) => {
      const w = new BrowserWindow({
        show: false,
        width: 390,
        height: 844,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          partition: "docs-phone",
        },
      });
      await w.loadURL(url);
    }, share.url);
    const phone = app
      .windows()
      .find((p) => p.url().startsWith(share.url.split("/#")[0]));
    assert(phone);
    await expect(phone.getByText("已连接 · 实时同步")).toBeVisible();
    await shot("10-mobile", phone);
    await phone.close();
    await command({ type: "mobile:stop" });
    await nav("我的资料库");
    await shot("02-materials");
    await nav("应用设置");
    await page.getByRole("button", { name: "添加模型", exact: true }).click();
    await shot("03-model-settings");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await shot(
      "04-voice-settings",
      page
        .locator("section")
        .filter({
          has: page.getByRole("heading", { name: "会议语音识别", exact: true }),
        }),
    );
    await nav("模拟面试");
    await page
      .getByRole("button", { name: "从资料库导入", exact: true })
      .click();
    await page.getByLabel("目标岗位", { exact: true }).fill("Java 后端工程师");
    await page.getByLabel("面试难度").selectOption("P7");
    await shot("05-mock-setup");
    await page
      .getByRole("button", { name: "开始模拟面试", exact: true })
      .click();
    await expect(page.locator(".mock-question")).toContainText("订单查询优化");
    await page.getByLabel("你的回答").fill(answer);
    await shot("06-mock-interview");
    await page.getByRole("button", { name: "我答完了", exact: true }).click();
    await expect(page.locator(".mock-question")).toContainText(
      "为什么选择缓存",
    );
    await page.getByRole("button", { name: "结束并复盘", exact: true }).click();
    await expect(
      page.getByText("报告已完成并保存到本机", { exact: true }),
    ).toBeVisible();
    await shot("07-mock-report", page.locator(".mock-report"));
    await nav("智能工作台");
    const active = (await page.evaluate(() => window.api.getState()))
      .sessions[0];
    await command({
      type: "round:speech",
      sessionId: active.id,
      roundId: active.rounds[0].id,
      text: answer,
    });
    await command({ type: "session:end", id: active.id });
    await command({ type: "session:evaluate", id: active.id });
    await nav("历史与复盘");
    await shot("08-history");
    console.log(
      "PASS: 10 documentation screenshots generated with isolated demo data.",
    );
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
