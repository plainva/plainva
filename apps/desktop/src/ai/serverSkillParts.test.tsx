// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useServerSkillText, type ServerSkillText, type ServerSkillTextView } from "@plainva/ui";

/**
 * The reading of a server skill's instructions in its review (plan KI-Harness
 * P9-4b), shared by both shells' dialogs: it belongs to the version the
 * review shows. A reading of another version of the same skill — finished or
 * under way — says that the skill changed; it never just vanishes, so nobody
 * approves a version whose instructions they did not see while believing
 * they did.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const ID = "mcp:tracker:0123456789ab:skill://code-review/SKILL.md";
const READ: ServerSkillText = { ok: true, text: "---\nname: code-review\ndescription: d\n---\n\nBody.\n", invisible: 0, files: [] };

type Session = NonNullable<Parameters<typeof useServerSkillText>[0]>;

function Probe(props: { session: Session; id: string | null; seen: Record<string, string> | null; onView: (view: ServerSkillTextView) => void }) {
  const view = useServerSkillText(props.session, props.id, props.seen);
  const { onView } = props;
  useEffect(() => onView(view));
  return null;
}

/** Renders the hook and hands back what it shows now, and a way to show it another version. */
function mount(session: Session, id: string | null, seen: Record<string, string> | null) {
  let current: ServerSkillTextView | null = null;
  const onView = (view: ServerSkillTextView) => {
    current = view;
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Probe session={session} id={id} seen={seen} onView={onView} />));
  return {
    view: () => current!,
    show: (nextId: string | null, nextSeen: Record<string, string> | null) => act(() => root!.render(<Probe session={session} id={nextId} seen={nextSeen} onView={onView} />)),
  };
}

describe("reading a server skill's instructions for its review (plan P9-4b)", () => {
  it("shows what was read for the version the review shows — and says the skill changed when the review shows another", async () => {
    const asked: Readonly<Record<string, string>>[] = [];
    const session: Session = {
      serverSkillText: async (_id, expected) => {
        asked.push(expected ?? {});
        return READ;
      },
    };
    const probe = mount(session, ID, { "SKILL.md": "a" });
    expect(probe.view().result).toBeNull();
    await act(async () => probe.view().read());
    expect(probe.view().result).toEqual(READ);
    expect(asked).toEqual([{ "SKILL.md": "a" }]);
    // The server changed the skill: the review shows another version, and what was read belongs to the old one.
    probe.show(ID, { "SKILL.md": "b" });
    expect(probe.view().result).toEqual({ ok: false, reason: "changed" });
    // Another skill altogether is no change of this one: nothing was read of it yet.
    probe.show("mcp:tracker:0123456789ab:skill://other/SKILL.md", { "SKILL.md": "a" });
    expect(probe.view().result).toBeNull();
  });

  it("says so too when the version changes while it is being read — and drops the answer that comes for the old one", async () => {
    let answer!: (text: ServerSkillText) => void;
    const session: Session = { serverSkillText: () => new Promise<ServerSkillText>((resolve) => (answer = resolve)) };
    const probe = mount(session, ID, { "SKILL.md": "a" });
    act(() => probe.view().read());
    expect(probe.view().reading).toBe(true);
    probe.show(ID, { "SKILL.md": "b" });
    expect(probe.view()).toMatchObject({ reading: false, result: { ok: false, reason: "changed" } });
    await act(async () => answer(READ));
    expect(probe.view().result).toEqual({ ok: false, reason: "changed" });
    // Reading again reads the version shown now.
    await act(async () => {
      probe.view().read();
      answer(READ);
    });
    expect(probe.view().result).toEqual(READ);
  });
});
