import type { PlanQuestion } from "@plainva/ui";

/**
 * The plans of outside programs that wait for the user (plan KI-Harness
 * §17.3 stage 2, ADR 0022). A rename, a move or a deletion a program at
 * Plainva's MCP server asks for is laid before the user in the main window;
 * the program is told that input is required and is handed a handle. Nothing
 * is carried out before it comes back with that handle AND the user said yes
 * here — to the plan that was shown, which is why the plan is kept as it was
 * shown and compared when the program returns.
 *
 * The list lives in the window's memory and nowhere else: a plan does not
 * survive the app, another vault, or ten minutes.
 */

/** A plan of an outside program. One of a note's own AI rules is never among them: no program sets those. */
export type McpPlanQuestion = Exclude<PlanQuestion, { plan: "rule" }>;

export interface McpPlan {
  handle: string;
  clientId: string;
  /** The name the user paired the program under. */
  client: string;
  tool: string;
  /** The call's arguments as the tool read them: the program has to come back with the same call. */
  args: string;
  question: McpPlanQuestion;
  /** What the user said in Plainva; null while they have not. */
  decision: "yes" | "no" | null;
  createdAt: number;
  /** The vault the plan was made in — the host of the open vault, by identity. */
  owner: object;
}

/** How long a plan waits: for the user's answer, and after a yes for the program to come back. */
export const MCP_PLAN_TTL_MS = 10 * 60_000;

export interface McpPlansDeps {
  now(): number;
  newHandle(): string;
}

const DEFAULT_DEPS: McpPlansDeps = {
  now: () => Date.now(),
  // What the native side takes as a request state: letters, digits and hyphens, 36 of them.
  newHandle: () => crypto.randomUUID(),
};

type Answer = "yes" | "no" | null;

export class McpPlans {
  private plans: McpPlan[] = [];
  private shown: McpPlan | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly waiters = new Map<string, Set<(answer: Answer) => void>>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: McpPlansDeps = DEFAULT_DEPS) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The plan the dialog shows: the oldest one the user has not answered. */
  current = (): McpPlan | null => this.shown;

  private changed(next: McpPlan[]): void {
    this.plans = next;
    const shown = next.find((plan) => plan.decision === null) ?? null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (next.length > 0) {
      const oldest = Math.min(...next.map((plan) => plan.createdAt));
      this.timer = setTimeout(() => this.sweep(), Math.max(0, oldest + MCP_PLAN_TTL_MS - this.deps.now()) + 1);
    }
    if (shown !== this.shown) {
      this.shown = shown;
      for (const listener of [...this.listeners]) listener();
    }
  }

  private release(handle: string, answer: Answer): void {
    const waiting = this.waiters.get(handle);
    this.waiters.delete(handle);
    for (const resolve of waiting ?? []) resolve(answer);
  }

  /** Drops what waited too long: an unanswered plan closes, and a yes nobody came back for is void. */
  private sweep(): void {
    const now = this.deps.now();
    const gone = this.plans.filter((plan) => now - plan.createdAt >= MCP_PLAN_TTL_MS);
    if (gone.length === 0) {
      this.changed(this.plans);
      return;
    }
    this.changed(this.plans.filter((plan) => !gone.includes(plan)));
    for (const plan of gone) this.release(plan.handle, null);
  }

  /**
   * Lays a plan before the user and returns its handle. A program has one
   * plan waiting at a time: a newer one of the same program takes the older
   * one's place, whose handle is then no handle any more.
   */
  open(plan: Omit<McpPlan, "handle" | "decision" | "createdAt">): string {
    this.sweep();
    const handle = this.deps.newHandle();
    const replaced = this.plans.filter((other) => other.clientId === plan.clientId);
    this.changed([...this.plans.filter((other) => other.clientId !== plan.clientId), { ...plan, handle, decision: null, createdAt: this.deps.now() }]);
    for (const other of replaced) this.release(other.handle, null);
    return handle;
  }

  /** The plan a program comes back for: its own, in the vault it was made in, and not older than a plan may get. */
  find(handle: string, clientId: string, owner: object): McpPlan | null {
    this.sweep();
    return this.plans.find((plan) => plan.handle === handle && plan.clientId === clientId && plan.owner === owner) ?? null;
  }

  /** The user's answer in Plainva. A plan that was answered stays answered. */
  decide(handle: string, decision: "yes" | "no"): void {
    const plan = this.plans.find((candidate) => candidate.handle === handle);
    if (!plan || plan.decision !== null) return;
    this.changed(this.plans.map((candidate) => (candidate === plan ? { ...plan, decision } : candidate)));
    this.release(handle, decision);
  }

  /** The user's answer, waited for at most `ms`; null where none came, or the plan is gone. */
  wait(handle: string, ms: number): Promise<Answer> {
    const plan = this.plans.find((candidate) => candidate.handle === handle);
    if (!plan) return Promise.resolve(null);
    if (plan.decision !== null) return Promise.resolve(plan.decision);
    return new Promise((resolve) => {
      const waiting = this.waiters.get(handle) ?? new Set();
      this.waiters.set(handle, waiting);
      const done = (answer: Answer) => {
        clearTimeout(timer);
        waiting.delete(done);
        resolve(answer);
      };
      const timer = setTimeout(() => done(null), ms);
      waiting.add(done);
    });
  }

  /** Takes a plan off the list: carried out, declined, or void. */
  drop(handle: string): void {
    if (!this.plans.some((plan) => plan.handle === handle)) return;
    this.changed(this.plans.filter((plan) => plan.handle !== handle));
    this.release(handle, null);
  }

  /** Another vault, or none: what waited was asked of a vault that is not open any more. */
  clear(): void {
    const gone = this.plans;
    if (gone.length === 0) return;
    this.changed([]);
    for (const plan of gone) this.release(plan.handle, null);
  }
}

/** The plans of this window. */
export const mcpPlans = new McpPlans();

/** Whether the plan computed now is the one the user was shown — in every part they read. */
export function samePlan(a: PlanQuestion, b: PlanQuestion): boolean {
  const flat = (question: PlanQuestion): string => {
    if (question.plan === "rename") {
      const files = [...question.files].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0)).map((file) => [file.path, file.links]);
      return JSON.stringify(["rename", question.path, question.title, question.target, question.links, files]);
    }
    if (question.plan === "move") return JSON.stringify(["move", question.path, question.folder, question.target, [...question.loosens].sort()]);
    if (question.plan === "delete") return JSON.stringify(["delete", question.path]);
    return JSON.stringify(["rule", question.path, question.rule, question.set]);
  };
  return flat(a) === flat(b);
}
