// Storage seam. JsonStore is the weekend version; a SupabaseStore only has to implement Store.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type Idea = {
  id: string;
  owner: string;
  text: string;
  title: string;
  branch: string;
  parent?: string;
  problemPain: number;
  solutionPain: number;
  verdict: string;
  nextAction: string;
  public: boolean;
  created: string;
};

export type Pending =
  | { kind: "public"; ideaId: string }
  | { kind: "intro"; introId: string };

export type User = { id: string; about?: string; pending: Pending[] };

export type Intro = {
  id: string;
  a: string;
  b: string;
  ideaA: string;
  ideaB: string;
  aYes?: boolean;
  bYes?: boolean;
  status: "asked" | "connected" | "declined";
};

export interface Store {
  user(id: string): User;
  saveUser(u: User): void;
  addIdea(i: Idea): void;
  idea(id: string): Idea | undefined;
  saveIdea(i: Idea): void;
  ideasBy(owner: string): Idea[];
  publicIdeas(): Idea[];
  branches(): string[];
  addIntro(x: Intro): void;
  intro(id: string): Intro | undefined;
  saveIntro(x: Intro): void;
  introBetween(a: string, b: string): Intro | undefined;
}

type Db = { users: Record<string, User>; ideas: Idea[]; intros: Intro[] };

export class JsonStore implements Store {
  private db: Db;
  constructor(private path = resolve(process.cwd(), "data/db.json")) {
    this.db = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : { users: {}, ideas: [], intros: [] };
  }
  // Re-read before each turn so the agent and the map server (separate processes) agree.
  reload() {
    if (existsSync(this.path)) this.db = JSON.parse(readFileSync(this.path, "utf8"));
  }
  private flush() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.db, null, 2));
  }
  user(id: string) {
    return this.db.users[id] ?? { id, pending: [] };
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
  publicIdeas() {
    return this.db.ideas.filter((i) => i.public);
  }
  branches() {
    return [...new Set(this.db.ideas.map((i) => i.branch))];
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
}

export const newId = () => Math.random().toString(36).slice(2, 10);
