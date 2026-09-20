const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
async function mainPage(app) {
  for (let i = 0; i < 300; i++) {
    const page = (await app.windows()).find((p) =>
      p.url().endsWith("/dist/index.html"),
    );
    if (page) {
      page.setDefaultTimeout(15000);
      return page;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("主窗口未加载");
}
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comind-e2e-"));
  fs.mkdirSync("test-results", { recursive: true });
  const requests = [];
  const answer = {
    summary: "使用哈希表记录已访问元素，单次遍历找到目标组合。",
    problem: "给定数组与目标值，返回两个数的下标。",
    clarify: "是否保证恰好存在一个解？",
    approach: "先考虑双重循环，再用哈希表将查找降为常数时间。",
    code: "def two_sum(nums, target):\n    seen = {}\n    for i, value in enumerate(nums):\n        if target - value in seen:\n            return [seen[target - value], i]\n        seen[value] = i",
    walkthrough: "例如 [2, 7, 11, 15]，目标为 9，遍历到 7 时找到 2。",
    time_complexity: "O(n)",
    space_complexity: "O(n)",
  };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (b) => (body += b));
    req.on("end", () => {
      const data = JSON.parse(body);
      requests.push(data);
      let text = "CONNECTED";
      const system = data.messages?.[0]?.content || data.system || "";
      if (system.includes("你是CoMind面试练习助手"))
        text = JSON.stringify(answer);
      else if (system.includes("复盘助手"))
        text = JSON.stringify({
          overallScore: 82,
          summary: "基于已记录的回答，思路清晰，可以补充边界条件。",
          strengths: ["能够解释哈希表"],
          weaknesses: ["可补充复杂度证明"],
          qaAnalysis: [
            {
              question: "两数之和",
              actualResponse: "使用哈希表",
              modelResponse: answer.approach,
              improvement: "补充时间和空间复杂度",
            },
          ],
        });
      else if (system.includes("整理用户"))
        text = JSON.stringify({ text: "整理后的测试简历（仅测试数据）" });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: text } }] }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const env = {
    ...process.env,
    NODE_ENV: "test",
    COMIND_E2E: "1",
    COMIND_TEST_DATA: dir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.COMIND_SMOKE;
  let app;
  try {
    app = await electron.launch({ args: ["."], env });
    let page = await mainPage(app);
    await page
      .getByRole("heading", { name: "智能工作台", exact: true })
      .waitFor();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.screenshot({ path: "test-results/workspace-empty.png" });
    await page.getByRole("button", { name: "应用设置", exact: true }).click();
    await page.getByLabel("服务商", { exact: true }).selectOption("custom");
    await page.getByLabel("配置名称", { exact: true }).fill("本地测试模型");
    await page
      .getByLabel("模型 ID / 推理接入点", { exact: true })
      .fill("fixture-model");
    await page
      .getByLabel("API Base URL", { exact: true })
      .fill(`http://127.0.0.1:${server.address().port}/v1`);
    await page
      .getByLabel("API Key", { exact: true })
      .fill("synthetic-test-key");
    await page.getByRole("button", { name: "保存连接", exact: true }).click();
    await page.getByRole("button", { name: "测试", exact: true }).click();
    await page
      .getByText(/连接成功/)
      .first()
      .waitFor();
    const snapshot = await page.evaluate(() => window.api.getState());
    assert.ok(!JSON.stringify(snapshot).includes("synthetic-test-key"));
    await page.screenshot({ path: "test-results/settings.png" });
    await page.getByRole("button", { name: "我的资料库", exact: true }).click();
    await page
      .getByRole("textbox", { name: "个人简历", exact: true })
      .fill("我完成过一个用于练习的项目。");
    await page
      .getByRole("textbox", { name: "目标岗位 JD", exact: true })
      .fill("需要掌握数据结构和算法。");
    await page.getByRole("button", { name: "保存资料", exact: true }).click();
    await page.getByRole("button", { name: "提词稿", exact: true }).click();
    await page.getByRole("button", { name: "新增", exact: true }).click();
    await page
      .getByRole("textbox", { name: "提词稿标题", exact: true })
      .fill("测试提词稿");
    await page
      .getByRole("textbox", { name: "条目内容", exact: true })
      .fill("这是独立悬浮窗的提词稿测试。");
    await page.getByRole("button", { name: "保存资料", exact: true }).click();
    await page.getByRole("button", { name: "智能工作台", exact: true }).click();
    await page
      .getByRole("textbox", { name: "输入题目", exact: true })
      .fill("如何求解两数之和？");
    await page
      .getByRole("button", { name: "添加题目并生成", exact: true })
      .click();
    await page.getByText(answer.summary, { exact: true }).waitFor();
    await page.getByRole("button", { name: "复制回答", exact: true }).click();
    await page.getByText("已复制", { exact: true }).waitFor();
    await page
      .getByPlaceholder("记录你自己的回答，AI 参考答案不会自动计为实际作答。")
      .fill("我会使用哈希表，在一次遍历中查找补数。");
    await page.getByRole("button", { name: "保存作答", exact: true }).click();
    await page.screenshot({ path: "test-results/workspace-answer.png" });
    await page.getByRole("button", { name: "打开悬浮窗", exact: true }).click();
    const overlay = (await app.windows()).find((p) =>
      p.url().includes("#overlay"),
    );
    assert.ok(overlay);
    await overlay.getByText(answer.summary, { exact: true }).waitFor();
    await overlay
      .getByLabel("提词窗内容")
      .selectOption({ label: "测试提词稿" });
    await overlay
      .getByText("这是独立悬浮窗的提词稿测试。", { exact: true })
      .waitFor();
    await overlay.screenshot({ path: "test-results/overlay.png" });
    await overlay.getByTitle("切换鼠标穿透").click();
    await page
      .getByRole("button", { name: "关闭鼠标穿透", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "关闭鼠标穿透", exact: true })
      .click();
    await page.waitForFunction(
      async () => !(await window.api.getState()).runtime.clickThrough,
    );
    const native = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => ({
        title: w.getTitle(),
        top: w.isAlwaysOnTop(),
        frame: w.webContents.getURL(),
      })),
    );
    assert.ok(native.some((w) => w.frame.includes("#overlay") && w.top));
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    const live = await page.evaluate(() => window.api.getState());
    const origin = "chrome-extension://" + "b".repeat(32);
    const pair = await fetch(`http://127.0.0.1:${live.runtime.port}/pair`, {
      method: "POST",
      headers: { Origin: origin },
    });
    const { token } = await pair.json();
    assert.ok(token);
    const delivered = await fetch(
      `http://127.0.0.1:${live.runtime.port}/dom?t=${token}`,
      {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "测试网页",
          url: "https://example.com/test",
          text: "解释哈希冲突的处理方式。",
        }),
      },
    );
    assert.equal(delivered.status, 200);
    await page.getByText(/1 道待处理题目/).waitFor();
    await page.getByRole("button", { name: "继续", exact: true }).click();
    await page.getByRole("button", { name: /02.*解释哈希冲突/ }).waitFor();
    await page.getByText("网页采集 · 已生成", { exact: true }).waitFor();
    await page.getByRole("button", { name: "结束并保存", exact: true }).click();
    await page.getByRole("button", { name: "历史与复盘", exact: true }).click();
    await page
      .getByRole("button", { name: "生成 AI 复盘", exact: true })
      .click();
    await page
      .getByText("基于已记录的回答，思路清晰，可以补充边界条件。", {
        exact: true,
      })
      .waitFor();
    await page.screenshot({ path: "test-results/history.png" });
    assert.equal(errors.length, 0, errors.join("\n"));
    assert.ok(
      requests.some((r) =>
        JSON.stringify(r).includes("我完成过一个用于练习的项目"),
      ),
    );
    await app.close();
    app = null;
    app = await electron.launch({ args: ["."], env });
    page = await mainPage(app);
    await page
      .getByRole("heading", { name: "智能工作台", exact: true })
      .waitFor();
    const restored = await page.evaluate(() => window.api.getState());
    assert.equal(restored.sessions.length, 1);
    assert.equal(restored.sessions[0].rounds.length, 2);
    assert.ok(restored.sessions[0].evaluation);
    assert.equal(restored.materials.resume, "我完成过一个用于练习的项目。");
    console.log(
      "E2E PASS: model configuration, API connection, materials, answer, overlay, click-through, extension pairing/capture, paused queue, evaluation and restart persistence",
    );
  } catch (e) {
    console.error("E2E failure:", e);
    if (app) {
      for (const [i, p] of (await app.windows()).entries()) {
        console.error("WINDOW", p.url(), await p.locator("body").innerText());
        await p
          .screenshot({ path: `test-results/failure-${i}.png`, timeout: 3000 })
          .catch(() => {});
      }
    }
    throw e;
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
