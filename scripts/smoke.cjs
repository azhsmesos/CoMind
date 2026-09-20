const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const arch = process.env.SMOKE_ARCH || process.arch;
const executable =
  process.env.COMIND_EXECUTABLE ||
  (process.platform === "darwin"
    ? path.resolve(
        `release/mac${arch === "arm64" ? "-arm64" : ""}/CoMind.app/Contents/MacOS/CoMind`,
      )
    : path.resolve("release/win-unpacked/CoMind.exe"));
if (!fs.existsSync(executable))
  throw new Error("打包程序不存在：" + executable);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comind-smoke-"));
const env = { ...process.env, COMIND_SMOKE: "1", COMIND_TEST_DATA: dir };
delete env.ELECTRON_RUN_AS_NODE;
if (process.platform === "darwin") env.PATH = "/usr/bin:/bin";
const child = spawn(executable, [], { env, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (b) => {
  output += b;
  process.stdout.write(b);
});
child.stderr.on("data", (b) => process.stderr.write(b));
const timeout = setTimeout(() => {
  child.kill();
  process.exitCode = 1;
}, 45000);
child.on("error", (e) => {
  console.error(e);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  clearTimeout(timeout);
  fs.rmSync(dir, { recursive: true, force: true });
  const match = output.match(/COMIND_SMOKE_RESULT=(.+)/);
  process.exitCode = code === 0 && match && JSON.parse(match[1]).ok ? 0 : 1;
});
