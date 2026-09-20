import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_PREFERENCES,
  type DesktopState,
  type ModelConfig,
  type ModelInput,
  type Materials,
  type Preferences,
  type Session,
} from "../shared/types";
export interface Cipher {
  available(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
}
interface SavedModel extends Omit<ModelConfig, "hasKey"> {
  credentialId: string;
}
interface SavedData {
  version: 1;
  models: SavedModel[];
  credentials: Record<string, string>;
  activeModelId: string;
  materials: Materials;
  sessions: Session[];
  activeSessionId: string | null;
  preferences: Preferences;
  extensionToken: string;
  extensionPaired: boolean;
}
export class Store {
  data: SavedData;
  private memoryKeys = new Map<string, string>();
  warning?: string;
  constructor(
    private file: string,
    private cipher: Cipher,
  ) {
    this.data = {
      version: 1,
      models: [],
      credentials: {},
      activeModelId: "",
      materials: { resume: "", jd: "", answers: [], scripts: [] },
      sessions: [],
      activeSessionId: null,
      preferences: structuredClone(DEFAULT_PREFERENCES),
      extensionToken: randomUUID() + randomUUID(),
      extensionPaired: false,
    };
    const defaults = structuredClone(this.data);
    if (fs.existsSync(file)) {
      try {
        const saved = JSON.parse(fs.readFileSync(file, "utf8"));
        if (
          saved.version !== 1 ||
          !Array.isArray(saved.sessions) ||
          !Array.isArray(saved.models) ||
          !saved.materials ||
          !saved.credentials ||
          !saved.preferences
        )
          throw new Error("不支持的数据版本");
        if (
          saved.sessions.some(
            (s: any) =>
              !s ||
              typeof s.id !== "string" ||
              !Array.isArray(s.rounds) ||
              !Array.isArray(s.pending),
          ) ||
          saved.models.some(
            (m: any) =>
              !m ||
              typeof m.id !== "string" ||
              typeof m.credentialId !== "string",
          ) ||
          typeof saved.materials.resume !== "string" ||
          typeof saved.materials.jd !== "string" ||
          !Array.isArray(saved.materials.answers) ||
          !Array.isArray(saved.materials.scripts)
        )
          throw new Error("数据结构无效");
        this.data = {
          ...this.data,
          ...saved,
          preferences: {
            ...DEFAULT_PREFERENCES,
            ...saved.preferences,
            shortcuts: {
              ...DEFAULT_PREFERENCES.shortcuts,
              ...saved.preferences.shortcuts,
            },
          },
        };
        for (const s of this.data.sessions)
          for (const r of s.rounds)
            if (r.status === "generating") {
              r.status = "error";
              r.error = "上次生成被中断，请重试";
            }
      } catch {
        this.data = defaults;
        const backup = file + ".unreadable-" + Date.now();
        fs.copyFileSync(file, backup);
        this.warning =
          "原数据文件无法读取，已保留备份：" + path.basename(backup);
      }
    }
  }
  get encryptedStorage() {
    return this.cipher.available();
  }
  key(id: string) {
    const model = this.data.models.find((m) => m.id === id);
    if (!model) return "";
    const memory = this.memoryKeys.get(model.credentialId);
    if (memory) return memory;
    const encrypted = this.data.credentials[model.credentialId];
    try {
      return encrypted && this.cipher.available()
        ? this.cipher.decrypt(encrypted)
        : "";
    } catch {
      return "";
    }
  }
  models(): ModelConfig[] {
    return this.data.models.map(({ credentialId: _, ...m }) => ({
      ...m,
      hasKey: !!this.key(m.id),
    }));
  }
  saveModel(input: ModelInput) {
    const id = input.id || randomUUID();
    const old = this.data.models.find((m) => m.id === id);
    const model: SavedModel = {
      id,
      name: input.name.trim(),
      provider: input.provider,
      protocol: input.protocol,
      baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
      model: input.model.trim(),
      credentialId: old?.credentialId || randomUUID(),
    };
    const url = new URL(model.baseUrl);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("请输入有效的 API Base URL（不含密钥、查询参数或片段）");
    if (
      !model.name ||
      !model.model ||
      !["openai", "anthropic"].includes(model.protocol) ||
      !["doubao", "deepseek", "glm", "custom"].includes(model.provider)
    )
      throw new Error("请完整填写服务名称、协议及模型 ID");
    if (input.apiKey?.trim()) {
      const key = input.apiKey.trim();
      if (this.cipher.available())
        this.data.credentials[model.credentialId] = this.cipher.encrypt(key);
      else delete this.data.credentials[model.credentialId];
      this.memoryKeys.set(model.credentialId, key);
    }
    this.data.models = [...this.data.models.filter((m) => m.id !== id), model];
    if (!this.data.activeModelId) this.data.activeModelId = id;
    this.save();
  }
  deleteModel(id: string) {
    const model = this.data.models.find((m) => m.id === id);
    if (model) {
      delete this.data.credentials[model.credentialId];
      this.memoryKeys.delete(model.credentialId);
    }
    this.data.models = this.data.models.filter((m) => m.id !== id);
    if (this.data.activeModelId === id)
      this.data.activeModelId = this.data.models[0]?.id || "";
    this.save();
  }
  snapshot(runtime: DesktopState["runtime"]): DesktopState {
    const d = this.data;
    return structuredClone({
      models: this.models(),
      activeModelId: d.activeModelId,
      materials: d.materials,
      sessions: d.sessions,
      activeSessionId: d.activeSessionId,
      preferences: d.preferences,
      runtime,
    });
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
