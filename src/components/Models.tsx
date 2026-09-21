import { useState } from "react";
import { Plus, Check, Trash2, Wifi, KeyRound, Pencil } from "lucide-react";
import {
  PRESETS,
  type DesktopState,
  type ModelInput,
  type Provider,
  type Protocol,
  type Command,
  type CommandResult,
} from "../types";
export type Run = (command: Command) => Promise<CommandResult>;
const blank = (): ModelInput => ({
  id: "",
  name: PRESETS.deepseek.name,
  provider: "deepseek",
  protocol: "openai",
  baseUrl: PRESETS.deepseek.baseUrl,
  model: PRESETS.deepseek.model,
  apiKey: "",
});
export function Models({ state, run }: { state: DesktopState; run: Run }) {
  const [draft, setDraft] = useState<ModelInput | null>(
    state.models.length ? null : blank(),
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState("");
  const [result, setResult] = useState("");
  const update = (patch: Partial<ModelInput>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));
  async function save() {
    if (!draft) return;
    setSaving(true);
    const r = await run({ type: "model:save", config: draft });
    setSaving(false);
    if (r.ok) setDraft(null);
  }
  return (
    <div className="settings-section">
      <div className="section-heading">
        <div>
          <h2>AI 模型连接</h2>
          <p>选择你的服务商，所有请求由本机直接发送。</p>
        </div>
        <button className="primary" onClick={() => setDraft(blank())}>
          <Plus size={16} />
          添加模型
        </button>
      </div>
      <div className="model-grid">
        {state.models.map((model) => (
          <article
            className={`model-card ${model.id === state.activeModelId ? "selected" : ""}`}
            key={model.id}
          >
            <div className="row-between">
              <span className="provider-icon">{model.name.slice(0, 1)}</span>
              <span className="tag">
                {model.protocol === "openai" ? "OpenAI 兼容" : "Anthropic"}
              </span>
            </div>
            <h3>{model.name}</h3>
            <p className="mono wrap">{model.model}</p>
            <small>{model.hasKey ? "密钥已配置" : "尚未配置密钥"}</small>
            <div className="button-row">
              <button
                disabled={model.id === state.activeModelId}
                onClick={() => void run({ type: "model:select", id: model.id })}
              >
                <Check size={14} />
                {model.id === state.activeModelId ? "使用中" : "启用"}
              </button>
              <button
                aria-label={`编辑 ${model.name}`}
                onClick={() => setDraft({ ...model, apiKey: "" })}
              >
                <Pencil size={14} />
              </button>
              <button
                aria-label={`删除 ${model.name}`}
                onClick={() => {
                  if (confirm(`删除模型配置“${model.name}”？`))
                    void run({ type: "model:delete", id: model.id });
                }}
              >
                <Trash2 size={14} />
              </button>
              <button
                disabled={!!testing}
                onClick={async () => {
                  setTesting(model.id);
                  const r = await run({ type: "model:test", id: model.id });
                  setResult(r.text || r.error || "");
                  setTesting("");
                }}
              >
                <Wifi size={14} />
                {testing === model.id ? "测试中…" : "测试"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {!!result && (
        <div className="info-box" role="status">
          {result}
        </div>
      )}
      {draft && (
        <form
          className="card model-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="section-heading">
            <h3>
              <KeyRound size={18} />{" "}
              {draft.id ? "编辑模型连接" : "新建模型连接"}
            </h3>
            <button type="button" onClick={() => setDraft(null)}>
              取消
            </button>
          </div>
          <div className="form-grid">
            <label>
              服务商
              <select
                aria-label="服务商"
                value={draft.provider}
                onChange={(e) => {
                  const provider = e.target.value as Provider;
                  update({
                    provider,
                    name: PRESETS[provider].name,
                    baseUrl: PRESETS[provider].baseUrl,
                    protocol: "openai",
                    model: PRESETS[provider].model,
                  });
                }}
              >
                {Object.entries(PRESETS).map(([id, p]) => (
                  <option key={id} value={id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              配置名称
              <input
                aria-label="配置名称"
                required
                maxLength={100}
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <label>
              接口协议
              <select
                aria-label="接口协议"
                value={draft.protocol}
                onChange={(e) =>
                  update({ protocol: e.target.value as Protocol })
                }
              >
                <option value="openai">OpenAI Chat Completions</option>
                <option value="anthropic">Anthropic Messages</option>
              </select>
            </label>
            <label>
              模型 ID / 推理接入点
              <input
                aria-label="模型 ID / 推理接入点"
                required
                placeholder={
                  draft.provider === "doubao"
                    ? "模型 ID 或 ep-…"
                    : "填写账户可用的模型 ID"
                }
                value={draft.model}
                onChange={(e) => update({ model: e.target.value })}
              />
              {draft.provider === "deepseek" && (
                <small>
                  推荐
                  deepseek-flash，支持文本理解和截图识别。已预填模型与接口地址，只需填写
                  API Key。
                </small>
              )}
            </label>
            <label className="full">
              API Base URL
              <input
                aria-label="API Base URL"
                required
                type="url"
                placeholder="https://api.example.com/v1"
                value={draft.baseUrl}
                onChange={(e) => update({ baseUrl: e.target.value })}
              />
              <small>
                填写接口根地址，不要包含 /chat/completions 或 /messages。
              </small>
            </label>
            <label className="full">
              API Key
              <input
                aria-label="API Key"
                type="password"
                autoComplete="off"
                placeholder={draft.id ? "留空保留原密钥" : "输入你的 API Key"}
                value={draft.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
              />
              {draft.provider === "deepseek" && (
                <small>
                  使用 DeepSeek 开放平台创建的完整 API
                  Key，粘贴后点击「保存连接」。
                </small>
              )}
              <small>
                {state.runtime.encryptedStorage
                  ? "密钥使用操作系统加密保存，不会传回界面。"
                  : "系统加密不可用：密钥只保留到本次退出，重启后需重新输入。"}
              </small>
            </label>
          </div>
          <div className="button-row end">
            <button className="primary" disabled={saving}>
              {saving ? "保存中…" : "保存连接"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
