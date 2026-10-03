// Storage seam. JsonStore is the weekend version; a hosted store only has to implement Store.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type Reading = { problem: number; fix: number; score: number; at: string };

export type Idea = {
  id: string;
  owner: string;
  text: string;
  title: string;
  /** One plain sentence: what it is and who it is for. What matching reads. */
  gist: string;
  trunk: string;
  branch: string;
  problem: number;
  fix: number;
  score: number;
  verdict: string;
  move: string;
  private: boolean;
  /** Seeded demo data. Shown on the map, never matched or messaged. */
  sample?: boolean;
  vec?: number[];
  /** Earlier readings, oldest first, when new context moved the score. */
  was?: Reading[];
  created: string;
};

export type Pending =
  | { kind: "ask"; ideaId: string; question: string }
  | { kind: "intro"; introId: string };

export type User = {
  id: string;
  name?: string;
  /** Durable things they told us about themselves. Never asked for up front. */
  facts: string[];
  pending: Pending[];
  lastIdea?: string;
  /** The idea we last asked a question on, so we never ask twice in a row. */
  askedOn?: string;
  /** They have been told once that titles go on the map. */
  told?: boolean;
  muted?: boolean;
  joined: string;
};

export type Intro = {
  id: string;
  /** a asked first; b only hears about it once a says yes. */
  a: string;
  b: string;
  ideaA: string;
  ideaB: string;
  status: "offered" | "asked" | "connected" | "declined";
  created: string;
};

export interface Store {
  user(id: string): User;
  saveUser(u: User): void;
  addIdea(i: Idea): void;
  idea(id: string): Idea | undefined;
  saveIdea(i: Idea): void;
  ideasBy(owner: string): Idea[];
  /** Everything that can appear on the map: not private. */
  mapIdeas(): Idea[];
  tree(): { trunk: string; branches: string[] }[];
  addIntro(x: Intro): void;
  intro(id: string): Intro | undefined;
  saveIntro(x: Intro): void;
  introBetween(a: string, b: string): Intro | undefined;
  intros(): Intro[];
}

type Db = { users: Record<string, User>; ideas: Idea[]; intros: Intro[] };

const empty = (): Db => ({ users: {}, ideas: [], intros: [] });

export class JsonStore implements Store {
  private db: Db = empty();
  private stamp = 0;
  constructor(private path = resolve(process.cwd(), process.env.DB_PATH ?? "data/db.json")) {
    this.reload();
  }
  /** Pick up writes from another process (the terminal harness, the seeder). True when something changed. */
  reload() {
    if (!existsSync(this.path)) return false;
    const m = statSync(this.path).mtimeMs;
    if (m === this.stamp) return false;
    this.db = { ...empty(), ...JSON.parse(readFileSync(this.path, "utf8")) };
    this.stamp = m;
    return true;
  }
  // Write to a temp file and rename, so a crash mid-write can't leave half a database.
  private flush() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.db));
    renameSync(tmp, this.path);
    this.stamp = statSync(this.path).mtimeMs;
  }
  user(id: string): User {
    return this.db.users[id] ?? { id, facts: [], pending: [], joined: new Date().toISOString() };
  }
  saveUser(u: User) {
    this.db.users[u.id] = u;
    this.flush();
  }
  addIdea(i: Idea) {
    this.db.ideas.push(i);
    this.flush();
  }
  idea(id: string) {
    return this.db.ideas.find((i) => i.id === id);
  }
  saveIdea(i: Idea) {
    this.db.ideas = this.db.ideas.map((x) => (x.id === i.id ? i : x));
    this.flush();
  }
  ideasBy(owner: string) {
    return this.db.ideas.filter((i) => i.owner === owner);
  }
  mapIdeas() {
    return this.db.ideas.filter((i) => !i.private);
  }
  tree() {
    const t = new Map<string, Set<string>>();
    for (const i of this.mapIdeas()) t.set(i.trunk, (t.get(i.trunk) ?? new Set()).add(i.branch));
    return [...t].map(([trunk, b]) => ({ trunk, branches: [...b] }));
  }
  addIntro(x: Intro) {
    this.db.intros.push(x);
    this.flush();
  }
  intro(id: string) {
    return this.db.intros.find((x) => x.id === id);
  }
  saveIntro(x: Intro) {
    this.db.intros = this.db.intros.map((y) => (y.id === x.id ? x : y));
    this.flush();
  }
  introBetween(a: string, b: string) {
    return this.db.intros.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  }
  intros() {
    return this.db.intros;
  }
  /** Seeder only: drop ideas matching the test. With everything = true, forget people and intros too. */
  drop(test: (i: Idea) => boolean, everything = false) {
    this.db.ideas = this.db.ideas.filter((i) => !test(i));
    if (everything) Object.assign(this.db, { users: {}, intros: [] });
    this.flush();
  }
}

export const newId = () => Math.random().toString(36).slice(2, 10);
