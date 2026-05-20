import fs from "node:fs/promises";
import path from "node:path";

type Persisted = { quarantined: Array<{ tag: string; at: string; reason: string }> };

// SPEC §5.5 step 4: a release that fails apply (any reason — bad migration,
// failed pre-flight, post-start health check timing out, signature
// verification refused, …) is quarantined so the next poll won't re-attempt
// it 15 minutes later. The list is persisted under /opt/frame/state so it
// survives frame-core restarts.
export class Quarantine {
  private set = new Map<string, { at: string; reason: string }>();

  constructor(private file: string) {}

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as Persisted;
      this.set = new Map(parsed.quarantined.map((q) => [q.tag, { at: q.at, reason: q.reason }]));
    } catch {
      // ENOENT or malformed — start empty.
    }
  }

  has(tag: string): boolean {
    return this.set.has(tag);
  }

  list(): Array<{ tag: string; at: string; reason: string }> {
    return Array.from(this.set.entries()).map(([tag, v]) => ({ tag, ...v }));
  }

  async add(tag: string, reason: string): Promise<void> {
    this.set.set(tag, { at: new Date().toISOString(), reason });
    await this.persist();
  }

  async clear(tag?: string): Promise<number> {
    if (tag) {
      const had = this.set.delete(tag);
      await this.persist();
      return had ? 1 : 0;
    }
    const n = this.set.size;
    this.set.clear();
    await this.persist();
    return n;
  }

  private async persist() {
    const payload: Persisted = {
      quarantined: Array.from(this.set.entries()).map(([tag, v]) => ({ tag, ...v })),
    };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2));
    await fs.rename(tmp, this.file);
  }
}
