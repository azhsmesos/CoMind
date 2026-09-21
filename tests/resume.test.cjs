const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseResume } = require("../dist-electron/electron/resume");
const {
  generateAnswer,
  parseAnswer,
} = require("../dist-electron/electron/llm");
const { DEFAULT_PREFERENCES } = require("../dist-electron/shared/types");
const { docxFixture } = require("./resume-fixtures.cjs");
const fs = require("node:fs");
const path = require("node:path");
const config = {
  protocol: "openai",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-flash",
  apiKey: "synthetic",
};
const image = "data:image/jpeg;base64,aGVsbG8=";
const signal = () => new AbortController().signal;

test("Word resume extraction preserves Unicode and tables before AI parsing", async (t) => {
  let request;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    request = JSON.parse(options.body);
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              text: "张测试\nJava 工程师\n订单系统，延迟降低 20%。",
            }),
          },
        },
      ],
    });
  });
  let result;
  for (const data of [
    docxFixture(),
    fs.readFileSync(path.join(__dirname, "fixtures/resume.doc")),
  ]) {
    result = await parseResume(config, { kind: "word", data }, signal());
    assert.match(
      JSON.parse(request.messages[1].content).documentText,
      /张测试/,
    );
  }
  const source = JSON.parse(request.messages[1].content).documentText;
  assert.match(source, /张测试/);
  assert.match(source, /2020-2024/);
  assert.match(source, /延迟降低 20%/);
  assert.match(result, /Java 工程师/);
  assert.match(request.messages[0].content, /不美化或编造经历/);
});
test("all PDF pages are sent in order with both model protocols", async (t) => {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    seen.push(JSON.parse(options.body));
    return Response.json(
      options.headers["x-api-key"]
        ? { content: [{ type: "text", text: '{"text":"完整简历"}' }] }
        : { choices: [{ message: { content: '{"text":"完整简历"}' } }] },
    );
  });
  const images = [image, "data:image/png;base64,d29ybGQ="];
  for (const protocol of ["openai", "anthropic"])
    assert.equal(
      await parseResume(
        { ...config, protocol },
        { kind: "images", images },
        signal(),
      ),
      "完整简历",
    );
  assert.deepEqual(
    seen[0].messages[1].content.slice(1).map((b) => b.image_url.url),
    images,
  );
  assert.deepEqual(
    seen[1].messages[0].content.slice(0, 2).map((b) => b.source.data),
    ["aGVsbG8=", "d29ybGQ="],
  );
});
test("invalid resume inputs are rejected before any model request", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("unexpected request");
  });
  for (const upload of [
    null,
    { kind: "word", data: "/etc/passwd" },
    { kind: "word", data: Buffer.from("broken") },
    { kind: "images", images: [] },
    { kind: "images", images: Array(11).fill(image) },
    { kind: "images", images: ["https://example.com/image.jpg"] },
  ])
    await assert.rejects(parseResume(config, upload, signal()));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    parseResume(config, { kind: "images", images: [image] }, controller.signal),
    /取消/,
  );
  assert.equal(fetch.mock.callCount(), 0);
});
test("AI resume output must be nonempty text within the editable limit", async (t) => {
  let response;
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      choices: [{ message: { content: JSON.stringify(response) } }],
    }),
  );
  for (const invalid of [
    { text: "" },
    { text: 123 },
    { text: "a".repeat(50001) },
  ]) {
    response = invalid;
    await assert.rejects(
      parseResume(config, { kind: "images", images: [image] }, signal()),
    );
  }
});
test("answer contract requests concise Java implementation and preserves legacy history", async (t) => {
  const answer = {
    kind: "algorithm",
    summary: "哈希表一次遍历",
    problem: "两数之和",
    clarify: "",
    approach: "记录已遍历值的下标。查找目标与当前值的差即可。",
    code: "class Solution {}",
    walkthrough: "",
    time_complexity: "O(n)",
    space_complexity: "O(n)",
  };
  let request;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    request = JSON.parse(options.body);
    return Response.json({
      choices: [{ message: { content: JSON.stringify(answer) } }],
    });
  });
  assert.deepEqual(
    await generateAnswer(
      config,
      "两数之和",
      "",
      { resume: "真实简历", jd: "", answers: [], scripts: [] },
      DEFAULT_PREFERENCES,
      signal(),
    ),
    answer,
  );
  assert.match(request.messages[0].content, /完整 Java 实现/);
  assert.match(request.messages[0].content, /2～3 句话/);
  assert.match(request.messages[0].content, /完整的具体答案/);
  assert.equal(
    JSON.parse(request.messages[1].content).materials.resume,
    "真实简历",
  );
  const { kind, ...legacy } = answer;
  assert.deepEqual(parseAnswer(JSON.stringify(legacy)), legacy);
});
