// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { holdComposeDraft, resetComposeHostForTest, useComposeHost } from "./composeHost";

/**
 * The host's half of "one composer per window" (finding 2026-10-09).
 *
 * What a person sees of it is walked through with the real composer in
 * components/mail/composeSecondRequest.test.tsx. Pinned here is the part that
 * has no surface of its own: who may answer for a draft, and who may close a
 * composer, once one has taken another's place or the host itself was built
 * again — whatever the composer that left had under way still finishes, and
 * comes back to a way out that is no longer its to use.
 *
 * The composer below does towards its host what the real one does, and nothing
 * else: it shows what it was given when it opened, and it keeps the way out it
 * was handed.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Seed {
  subject: string;
}

/** Every composer that was ever opened, in order, with the way out it holds. */
const opened: Array<{ subject: string; close: () => void; gone: boolean }> = [];
/** The request function of every shell that was ever mounted, in order. */
const shells: Array<(seed: Seed) => void> = [];

function Composer({ seed, onClose }: { seed: Seed; onClose: () => void }) {
  // Reads what it is given once, like the real one.
  const [subject] = useState(seed.subject);
  const self = useRef({ subject, close: onClose, gone: false });
  useEffect(() => {
    const me = self.current;
    opened.push(me);
    return () => {
      me.gone = true;
    };
  }, []);
  // The way out is the one it was handed last, as a property is.
  useEffect(() => {
    self.current.close = onClose;
  }, [onClose]);
  return <div data-testid="composer">{subject}</div>;
}

function Shell() {
  const [draft, compose, key, close] = useComposeHost<Seed>();
  useEffect(() => {
    shells.push(compose);
    const onCompose = (e: Event) => compose((e as CustomEvent<Seed>).detail);
    window.addEventListener("test-compose", onCompose);
    return () => window.removeEventListener("test-compose", onCompose);
  }, [compose]);
  return draft ? <Composer key={key} seed={draft} onClose={close} /> : null;
}

let host: HTMLDivElement;
let root: Root;

function mountShell() {
  root = createRoot(host);
  act(() => root.render(<Shell />));
}

beforeEach(() => {
  opened.length = 0;
  shells.length = 0;
  resetComposeHostForTest();
  host = document.createElement("div");
  document.body.appendChild(host);
  mountShell();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const showing = () => host.querySelector('[data-testid="composer"]')?.textContent ?? null;
const live = () => opened.filter((c) => !c.gone).map((c) => c.subject);

/** Lets an answered question land. */
const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

/** A compose request, as the shell's listener receives it. */
async function ask(subject: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent("test-compose", { detail: { subject } }));
  });
  await settle();
}

/** A question whose answer the test gives, and a count of how often it was put. */
function scripted() {
  let answer!: (mayGo: boolean) => void;
  const q = {
    asked: 0,
    question: () => {
      q.asked += 1;
      return new Promise<boolean>((resolve) => (answer = resolve));
    },
    answer: async (mayGo: boolean) => {
      act(() => answer(mayGo));
      await settle();
    },
  };
  return q;
}

describe("a compose request", () => {
  it("opens the composer with the draft", async () => {
    expect(showing()).toBeNull();
    await ask("A");
    expect(showing()).toBe("A");
  });

  it("puts a NEW composer in the place of one that holds nothing", async () => {
    await ask("A");
    await ask("B");
    expect(showing()).toBe("B");
    // Not the first composer handed other properties: that one reads them once.
    expect(opened.map((c) => c.subject)).toEqual(["A", "B"]);
    expect(live()).toEqual(["B"]);
  });

  it("puts the held question first, and leaves the composer alone when the answer is no", async () => {
    await ask("A");
    const draft = scripted();
    holdComposeDraft(draft.question);

    await ask("B");
    expect(draft.asked).toBe(1);
    expect(showing(), "nothing changes while the question stands").toBe("A");

    await draft.answer(false);
    expect(showing()).toBe("A");
    expect(live(), "the same composer, not a fresh one showing the same draft").toEqual(["A"]);
    expect(opened).toHaveLength(1);
  });

  it("opens the new draft when the answer is yes", async () => {
    await ask("A");
    const draft = scripted();
    holdComposeDraft(draft.question);

    await ask("B");
    await draft.answer(true);
    expect(showing()).toBe("B");
    expect(live()).toEqual(["B"]);
  });

  it("shows the latest of several requests that waited for one answer", async () => {
    await ask("A");
    // One question at a time is the composer's rule: asked again while its
    // question stands, it hands out the one that is already open.
    const draft = scripted();
    let open: Promise<boolean> | null = null;
    holdComposeDraft(() => (open ??= draft.question()));

    await ask("B");
    await ask("C");
    expect(showing()).toBe("A");

    await draft.answer(true);
    expect(showing()).toBe("C");
    expect(live()).toEqual(["C"]);
  });
});

describe("whose question it is", () => {
  it("is nobody's once the draft was replaced: the next request is not asked about a composer that is gone", async () => {
    await ask("A");
    const draft = scripted();
    // Held and never released: the composer that held it is replaced first.
    holdComposeDraft(draft.question);
    await ask("B");
    await draft.answer(true);

    await ask("C");
    expect(draft.asked, "the discarded draft is not asked about twice").toBe(1);
    expect(showing()).toBe("C");
  });

  it("is let go by its own release only", async () => {
    await ask("A");
    const first = scripted();
    const releaseFirst = holdComposeDraft(first.question);
    const second = scripted();
    holdComposeDraft(second.question);
    // The first declaration ends after the second was made.
    releaseFirst();

    await ask("B");
    expect(second.asked, "what was declared second still stands").toBe(1);
    expect(first.asked).toBe(0);
    expect(showing()).toBe("A");
  });

  it("is dropped with the composer: after a close, the next request opens without a question", async () => {
    await ask("A");
    const draft = scripted();
    holdComposeDraft(draft.question);
    // Sent, filed or discarded: the composer takes its own way out.
    act(() => opened[0].close());
    expect(showing()).toBeNull();

    await ask("B");
    expect(draft.asked).toBe(0);
    expect(showing()).toBe("B");
  });
});

describe("whose way out it is", () => {
  it("closes the composer it was handed to", async () => {
    await ask("A");
    act(() => opened[0].close());
    expect(showing()).toBeNull();
  });

  it("closes nothing once that composer was replaced", async () => {
    await ask("A");
    await ask("B");
    // A's own question is answered only now, and A leaves the way it was told to.
    act(() => opened[0].close());
    expect(showing(), "B is not A's to close").toBe("B");
  });

  it("closes nothing once that composer was closed and another opened", async () => {
    await ask("A");
    act(() => opened[0].close());
    await ask("B");
    act(() => opened[0].close());
    expect(showing()).toBe("B");
  });
});

describe("a host that was built again", () => {
  /*
   * The slot belongs to the window, the host to what the window shows — and it
   * is built again when the window shows another vault. What comes back to the
   * old host after an `await` (a draft filed late, a note read for "send by
   * mail") must not answer for the composer the new one shows.
   */
  async function rebuilt() {
    await ask("A");
    act(() => root.unmount());
    mountShell();
    await ask("B");
    const draft = scripted();
    holdComposeDraft(draft.question);
    return draft;
  }

  it("does not let the old host's composer close for the new one, nor let go of its draft", async () => {
    const draft = await rebuilt();
    act(() => opened[0].close());
    expect(showing()).toBe("B");

    await ask("C");
    expect(draft.asked, "B's draft is still held").toBe(1);
  });

  it("does not take a request that reaches the old host", async () => {
    const draft = await rebuilt();
    act(() => shells[0]({ subject: "late" }));
    await settle();
    expect(draft.asked, "the new host's composer is not asked on the old one's behalf").toBe(0);
    expect(showing()).toBe("B");

    await ask("C");
    expect(draft.asked, "and its draft is still held").toBe(1);
  });
});
