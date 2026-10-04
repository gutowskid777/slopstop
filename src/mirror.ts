// The hosted copy. The server answers from its own disk (fast, and the store stays synchronous); every change is
// copied to Firestore within a second, so the data outlives the machine. A new machine with an empty disk starts
// from Firestore. One writer only: whatever is on this server's disk wins.
// On when FIRESTORE_PROJECT is set. Talks to Firestore's REST API with the machine's own Google identity, so there
// is no key to keep (FIRESTORE_TOKEN overrides it, for a one-off run from a laptop).
import { empty, type Db, type Idea, type Intro, type JsonStore, type User } from "./store.js";

const KINDS = ["users", "ideas", "intros"] as const;
type Kind = (typeof KINDS)[number];
type Rows = Record<Kind, Map<string, string>> & { order: string };

/** Ideas and intros are lists: their order is what "mine", "deck 2" and the map's newest leaf read. Kept in one doc. */
const orderOf = (db: Readonly<Db>) => JSON.stringify({ ideas: db.ideas.map((i) => i.id), intros: db.intros.map((x) => x.id) });

const rowsOf = (db: Readonly<Db>): Rows => ({
  users: new Map(Object.values(db.users).map((u) => [u.id, JSON.stringify(u)])),
  ideas: new Map(db.ideas.map((i) => [i.id, JSON.stringify(i)])),
  intros: new Map(db.intros.map((x) => [x.id, JSON.stringify(x)])),
  order: orderOf(db),
});

const none = (): Rows => ({ users: new Map(), ideas: new Map(), intros: new Map(), order: "" });

/** Firestore doc ids can't hold "/". Handles are phone numbers and emails; anything odd is spelled out. */
const docId = (id: string) => id.replace(/[^A-Za-z0-9@._+-]/g, (c) => `~${c.charCodeAt(0).toString(16)}`);

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toLocaleTimeString("en-US", { hour12: false });

type Write = { update: { name: string; fields: Record<string, unknown> } } | { delete: string };

export class Mirror {
  private synced = none();
  private running?: Promise<void>;
  private again = false;
  private failing = 0;
  private token?: { value: string; until: number };
  /** For the health check. */
  status = { ok: false, lastSync: "", error: "" };

  constructor(
    private store: JsonStore,
    private project = process.env.FIRESTORE_PROJECT!,
  ) {}

  private get root() {
    return `projects/${this.project}/databases/(default)/documents`;
  }

  private async auth() {
    if (process.env.FIRESTORE_TOKEN) return process.env.FIRESTORE_TOKEN;
    if (this.token && this.token.until > Date.now() + 60_000) return this.token.value;
    const res = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`no Google identity on this machine (${res.status})`);
    const t = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: t.access_token, until: Date.now() + t.expires_in * 1000 };
    return t.access_token;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`https://firestore.googleapis.com/v1/${path}`, {
      ...init,
      headers: { authorization: `Bearer ${await this.auth()}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`Firestore ${res.status}: ${body.error?.message ?? "no detail"}`.slice(0, 240));
    return body;
  }

  /** Everything in Firestore, as a database. */
  async load(): Promise<{ db: Db; rows: Rows }> {
    const rows = none();
    const db = empty();
    for (const kind of KINDS) {
      let page = "";
      do {
        const r = await this.call<{ documents?: { fields?: { json?: { stringValue?: string } } }[]; nextPageToken?: string }>(
          `${this.root}/${kind}?pageSize=300${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`,
        );
        for (const d of r.documents ?? []) {
          const json = d.fields?.json?.stringValue;
          if (!json) continue;
          const row = JSON.parse(json) as User & Idea & Intro;
          rows[kind].set(row.id, json);
          if (kind === "users") db.users[row.id] = row;
          else if (kind === "ideas") db.ideas.push(row);
          else db.intros.push(row);
        }
        page = r.nextPageToken ?? "";
      } while (page);
    }
    // Put the lists back in their saved order. Anything the order doc doesn't know goes last, oldest first.
    const meta = await this.call<{ fields?: { json?: { stringValue?: string } } }>(`${this.root}/meta/order`).catch(() => undefined);
    const order = JSON.parse(meta?.fields?.json?.stringValue ?? "{}") as { ideas?: string[]; intros?: string[] };
    const sort = <T extends { id: string; created: string }>(list: T[], ids: string[] = []) => {
      const at = new Map(ids.map((id, n) => [id, n]));
      return list.sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity) || a.created.localeCompare(b.created));
    };
    db.ideas = sort(db.ideas, order.ideas);
    db.intros = sort(db.intros, order.intros);
    rows.order = meta ? orderOf(db) : "";
    return { db, rows };
  }

  /** Before the server opens: a fresh machine restores from Firestore; a machine with data pushes what Firestore lacks. */
  async boot() {
    for (let n = 1; ; n++) {
      try {
        const remote = await this.load();
        this.synced = remote.rows;
        if (!this.store.exists()) {
          this.store.replace(remote.db);
          console.log(`${stamp()} restored from Firestore: ${remote.db.ideas.length} ideas, ${Object.keys(remote.db.users).length} people`);
        }
        break;
      } catch (err) {
        const why = String((err as Error)?.message ?? err).slice(0, 200);
        // With data on disk the server can start and catch Firestore up later. Without it, starting empty would be wrong.
        if (n >= 4 && this.store.exists()) {
          console.error(`${stamp()} Firestore unreachable (${why}); starting from the disk copy, it catches up later`);
          break;
        }
        console.error(`${stamp()} Firestore unreachable (${why}), retry ${n}`);
        await pause(Math.min(30_000, 2_000 * n));
      }
    }
    this.store.onChange = () => this.kick();
    this.kick();
    await this.settle();
    // A slow safety net: anything a failed sync left behind goes on the next pass.
    setInterval(() => this.kick(), 60_000).unref();
  }

  /** Something changed. Sync now, or right after the sync that is already running. */
  kick() {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.sync().finally(() => {
      this.running = undefined;
      if (this.again) {
        this.again = false;
        this.kick();
      }
    });
  }

  /** Wait for everything written so far to land. */
  async settle() {
    while (this.running) await this.running;
  }

  private async sync() {
    const now = rowsOf(this.store.dump());
    const writes: Write[] = [];
    const at = { timestampValue: new Date().toISOString() };
    for (const kind of KINDS) {
      for (const [id, json] of now[kind]) {
        if (this.synced[kind].get(id) !== json) writes.push({ update: { name: `${this.root}/${kind}/${docId(id)}`, fields: { json: { stringValue: json }, at } } });
      }
      for (const id of this.synced[kind].keys()) if (!now[kind].has(id)) writes.push({ delete: `${this.root}/${kind}/${docId(id)}` });
    }
    if (now.order !== this.synced.order) writes.push({ update: { name: `${this.root}/meta/order`, fields: { json: { stringValue: now.order }, at } } });
    if (!writes.length) return;
    try {
      // Firestore takes 500 writes per commit.
      for (let i = 0; i < writes.length; i += 400) {
        await this.call(`${this.root}:commit`, { method: "POST", body: JSON.stringify({ writes: writes.slice(i, i + 400) }) });
      }
      this.synced = now;
      if (this.failing) console.log(`${stamp()} Firestore caught up`);
      this.failing = 0;
      this.status = { ok: true, lastSync: new Date().toISOString(), error: "" };
    } catch (err) {
      const why = String((err as Error)?.message ?? err).slice(0, 200);
      if (!this.failing++) console.error(`${stamp()} Firestore sync failed (${why}); the disk copy is safe, retrying`);
      this.status = { ...this.status, ok: false, error: why };
      setTimeout(() => this.kick(), Math.min(60_000, 5_000 * this.failing)).unref();
    }
  }
}
