import fs from "node:fs";
import path from "node:path";
import type { Transcript, TranscriptPage } from "../shared/voice";

// Append-only text records, with a lazy byte-offset index. Audio never reaches disk.
export class Transcripts {
  private indexes = new Map<
    string,
    Map<string, { offset: number; bytes: number }>
  >();
  constructor(private directory: string) {}
  private file(sessionId: string) {
    if (!/^[\w-]{1,100}$/.test(sessionId)) throw new Error("无效会话");
    return path.join(this.directory, sessionId + ".jsonl");
  }
  private index(sessionId: string) {
    let index = this.indexes.get(sessionId);
    if (index) return index;
    index = new Map();
    const file = this.file(sessionId);
    if (fs.existsSync(file)) {
      const data = fs.readFileSync(file);
      let offset = 0;
      for (
        let end = data.indexOf(10, offset);
        end >= 0;
        end = data.indexOf(10, offset)
      ) {
        try {
          const record = JSON.parse(data.subarray(offset, end).toString());
          if (typeof record.id === "string" && typeof record.text === "string")
            index.set(record.id, { offset, bytes: end - offset });
        } catch {
          /* Ignore an interrupted record; keep later valid records. */
        }
        offset = end + 1;
      }
      // Recover a torn final append before any future writes.
      if (offset < data.length) fs.truncateSync(file, offset);
    }
    this.indexes.set(sessionId, index);
    return index;
  }
  append(sessionId: string, record: Transcript) {
    const index = this.index(sessionId);
    const file = this.file(sessionId);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const offset = fs.existsSync(file) ? fs.statSync(file).size : 0;
    const data = Buffer.from(JSON.stringify(record));
    fs.appendFileSync(file, Buffer.concat([data, Buffer.from("\n")]), {
      mode: 0o600,
    });
    index.set(record.id, { offset, bytes: data.length });
  }
  get(sessionId: string, id: string): Transcript | undefined {
    const entry = this.index(sessionId).get(id);
    if (!entry) return;
    const fd = fs.openSync(this.file(sessionId), "r");
    try {
      const data = Buffer.alloc(entry.bytes);
      fs.readSync(fd, data, 0, entry.bytes, entry.offset);
      return JSON.parse(data.toString());
    } finally {
      fs.closeSync(fd);
    }
  }
  page(sessionId: string, before?: number, limit = 50): TranscriptPage {
    const ids = [...this.index(sessionId).keys()];
    const end =
      before === undefined
        ? ids.length
        : Math.max(0, Math.min(ids.length, before));
    const start = Math.max(0, end - limit);
    return {
      items: ids.slice(start, end).map((id) => this.get(sessionId, id)!),
      before: start || undefined,
      total: ids.length,
    };
  }
  markdown(sessionId: string) {
    return [...this.index(sessionId).keys()]
      .map((id) => {
        const row = this.get(sessionId, id)!;
        return `- ${row.at}${row.kind === "gap" ? " [转写缺口]" : ""} ${row.text}${row.roundId ? `（关联问题：${row.roundId}）` : ""}`;
      })
      .join("\n");
  }
  delete(sessionId: string) {
    fs.rmSync(this.file(sessionId), { force: true });
    this.indexes.delete(sessionId);
  }
}
