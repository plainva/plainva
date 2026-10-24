// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, useEffect, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * A window does not stop showing its vault over a changed draft without asking
 * (finding 2026-10-09).
 *
 * The provider of a vault is keyed by the vault, so switching to another one or
 * closing it tears down everything that stands on it — the floating composer
 * and the message in it included. Until now that happened without a word, in
 * the central window and in a full second one. What is pinned here is the app
 * layer's half: the question is put BEFORE anything changes, "cancel" leaves
 * the vault and everything remembered about it as it was, and a switch with
 * nothing to lose is neither asked about nor slowed down.
 *
 * The question itself is whatever a surface declared to its window
 * (windowCloseGuard.test.ts); the composer declaring it is
 * components/mail/composeLeaveGuard.test.tsx.
 */

const storeValues: Record<string, unknown> = {};
vi.mock("../services/settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async <T,>(k: string) => storeValues[k] as T | undefined,
    set: async (k: string, v: unknown) => {
      storeValues[k] = v;
    },
    save: async () => {},
  }),
}));

const picked = { value: null as string | null };
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => picked.value }));

/** What this window was asked to do with itself, in order. */
const os = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    unminimize: async () => {
      os.calls.push("unminimize");
    },
    show: async () => {
      os.calls.push("show");
    },
    setFocus: async () => {
      os.calls.push("setFocus");
    },
  }),
}));

let windowLabel: string | null = null;
vi.mock("../services/windowContext", async () => {
  const actual = await vi.importActual<typeof import("../services/windowContext")>("../services/windowContext");
  return {
    ...actual,
    currentWindowParams: () => ({ role: windowLabel ? "full" : "owner", vaultPath: null, content: null, label: windowLabel, preset: null }),
  };
});

// What the central window registers as "open this vault for a tab that is
// handed over". The hand-over itself is tabTransfer.test.ts.
const transfer = vi.hoisted(() => ({ opener: null as ((path: string) => Promise<void>) | null }));
vi.mock("../services/tabTransfer", () => ({
  registerMainTabOpener: (open: (path: string) => Promise<void>) => {
    transfer.opener = open;
    return () => {
      if (transfer.opener === open) transfer.opener = null;
    };
  },
}));

/** The runtime is not what is tested here; which vault draws the app is. */
vi.mock("./VaultContext", async () => {
  const actual = await vi.importActual<typeof import("./VaultContext")>("./VaultContext");
  return {
    ...actual,
    VaultProvider: ({ vaultPath, clientVaultPath, children }: { vaultPath?: string | null; clientVaultPath?: string | null; children?: ReactNode }) => (
      <div data-testid={`runtime:${vaultPath ?? clientVaultPath ?? "none"}`}>{children}</div>
    ),
  };
});

import i18n from "@plainva/ui/i18n";
import { toast, toastStore } from "@plainva/ui";
import { AppProvider, ClientAppProvider, useApp } from "./AppContext";
import { ClientVaultHost, VaultHost } from "./VaultHost";
import { acquireVault, resetVaultRuntimes } from "../services/vaultRuntimes";
import { holdWindowClose, resetWindowCloseGuardForTest } from "../services/windowCloseGuard";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let api: ReturnType<typeof useApp> | null = null;
/** How often the shell under the vault was built — a rebuilt shell is a lost composer. */
let shellMounts = 0;

const Probe: React.FC = () => {
  const app = useApp();
  useEffect(() => {
    api = app;
  });
  return null;
};

/** Stands where the shell and its composer stand: under the vault's provider. */
const Shell: React.FC = () => {
  useEffect(() => {
    shellMounts += 1;
  }, []);
  return <span data-testid="shell" />;
};

beforeEach(() => {
  for (const k of Object.keys(storeValues)) delete storeValues[k];
  windowLabel = null;
  picked.value = null;
  api = null;
  shellMounts = 0;
  os.calls.length = 0;
  transfer.opener = null;
  resetVaultRuntimes();
  resetWindowCloseGuardForTest();
  toast.clearAll();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetWindowCloseGuardForTest();
  toast.clearAll();
});

async function mount(el: ReactElement) {
  await act(async () => {
    root.render(el);
  });
}

/** Lets a question's answer and what follows it land. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

/** The vault whose provider draws the shell right now. */
const shownIn = () => container.querySelector('[data-testid="shell"]')?.parentElement?.getAttribute("data-testid")?.replace("runtime:", "") ?? null;

/** A changed draft, as a composer declares it to its window: a question the test answers. */
function changedDraft() {
  let answer!: (discard: boolean) => void;
  const asked = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
  const saved = holdWindowClose(asked);
  return { asked, answer: (discard: boolean) => answer(discard), saved };
}

/** The central window on vault /A, with /B known. */
async function central() {
  storeValues.lastVaultPath = "/A";
  storeValues.autoOpenLastVault = true;
  storeValues.recentVaults = ["/A", "/B"];
  await mount(
    <AppProvider>
      <Probe />
      <VaultHost><Shell /></VaultHost>
    </AppProvider>,
  );
  await settle();
  expect(shownIn()).toBe("/A");
  shellMounts = 0;
}

/** A full second window on vault /A. */
async function second() {
  windowLabel = "full-1";
  await mount(
    <ClientAppProvider vaultPath="/A">
      <Probe />
      <ClientVaultHost><Shell /></ClientVaultHost>
    </ClientAppProvider>,
  );
  await settle();
  expect(shownIn()).toBe("/A");
  shellMounts = 0;
}

describe("the central window, with nothing to lose", () => {
  it("switches without asking anyone", async () => {
    await central();
    let opened: boolean | null = null;
    await act(async () => {
      opened = await api!.openVault("/B");
    });
    expect(shownIn()).toBe("/B");
    expect(storeValues.lastVaultPath).toBe("/B");
    expect(opened, "and says so to whoever asked for it").toBe(true);
  });

  it("closes in the same tick as the click", async () => {
    await central();
    // Synchronous on purpose: the app layer stops looking before it awaits
    // anything, and the guard must not put a tick in front of that.
    act(() => {
      void api!.closeVault();
    });
    expect(shownIn()).toBe("none");
  });

  it("does not ask about a draft that went back to untouched", async () => {
    await central();
    const draft = changedDraft();
    draft.saved();
    await act(async () => {
      await api!.openVault("/B");
    });
    expect(draft.asked).not.toHaveBeenCalled();
    expect(shownIn()).toBe("/B");
  });
});

describe("the central window, over a changed draft", () => {
  it("asks before it switches; Cancel leaves the vault, the shell and the memory as they were", async () => {
    await central();
    const draft = changedDraft();
    let opened: boolean | null = null;
    act(() => {
      void api!.openVault("/B").then((result) => {
        opened = result;
      });
    });
    await settle();
    expect(draft.asked).toHaveBeenCalledTimes(1);
    expect(shownIn(), "nothing changes while the question stands").toBe("/A");
    expect(storeValues.lastVaultPath).toBe("/A");
    expect(opened, "and whoever asked is still waiting").toBeNull();

    draft.answer(false);
    await settle();
    // Not `undefined` as before: a caller that goes on as if the vault were
    // open (the import wizard closing itself, "Vault opened" in Security &
    // Sharing) has to be able to tell.
    expect(opened, "the caller hears that the vault was not opened").toBe(false);
    expect(shownIn()).toBe("/A");
    expect(shellMounts, "the shell — and the composer on it — was not rebuilt").toBe(0);
    // Not half a switch: what the next start reopens is still this vault.
    expect(storeValues.lastVaultPath).toBe("/A");
    expect(storeValues.recentVaults).toEqual(["/A", "/B"]);
    expect(api!.recentVaults).toEqual(["/A", "/B"]);
  });

  it("switches on Discard", async () => {
    await central();
    const draft = changedDraft();
    let opened: boolean | null = null;
    act(() => {
      void api!.openVault("/B").then((result) => {
        opened = result;
      });
    });
    await settle();
    draft.answer(true);
    await settle();
    expect(shownIn()).toBe("/B");
    expect(storeValues.lastVaultPath).toBe("/B");
    expect(opened).toBe(true);
  });

  it("asks before it closes the vault, and closes only on Discard", async () => {
    await central();
    const draft = changedDraft();
    act(() => {
      void api!.closeVault();
    });
    await settle();
    expect(draft.asked).toHaveBeenCalledTimes(1);
    expect(shownIn()).toBe("/A");

    draft.answer(false);
    await settle();
    expect(shownIn()).toBe("/A");
    expect(storeValues.lastVaultPath, "a cancelled close forgets nothing").toBe("/A");

    act(() => {
      void api!.closeVault();
    });
    await settle();
    expect(draft.asked).toHaveBeenCalledTimes(2);
    draft.answer(true);
    await settle();
    expect(shownIn()).toBe("none");
    expect(storeValues.lastVaultPath).toBe(null);
  });

  it("asks after the folder was picked, not for a picker that was cancelled", async () => {
    await central();
    const draft = changedDraft();
    await act(async () => {
      await api!.selectVault();
    });
    expect(draft.asked).not.toHaveBeenCalled();

    picked.value = "/C";
    act(() => {
      void api!.selectVault();
    });
    await settle();
    expect(draft.asked).toHaveBeenCalledTimes(1);
    draft.answer(false);
    await settle();
    expect(shownIn()).toBe("/A");
  });

  it("does not ask when the vault that is already shown is opened again", async () => {
    await central();
    const draft = changedDraft();
    await act(async () => {
      await api!.openVault("/A");
    });
    expect(draft.asked).not.toHaveBeenCalled();
    expect(shellMounts).toBe(0);
  });

  it("does not ask to discard a draft for a switch it then refuses", async () => {
    await central();
    // Another window shows /B; a vault inside it overlaps and is refused.
    await act(async () => acquireVault("/B", "full-1"));
    const draft = changedDraft();
    let opened: boolean | null = null;
    await act(async () => {
      opened = await api!.openVault("/B/inner");
    });
    expect(draft.asked).not.toHaveBeenCalled();
    expect(shownIn()).toBe("/A");
    expect(toastStore.get().some((item) => item.kind === "error")).toBe(true);
    expect(opened, "a refused vault is not an opened one").toBe(false);
  });
});

/**
 * A tab handed back to the central window opens its vault through the same
 * function. The window it comes from keeps the tab, under a notice, until this
 * one confirms — a question here would hold both for as long as nobody looks.
 */
describe("a tab that is handed over to the central window", () => {
  it("opens its vault when nothing is held", async () => {
    await central();
    expect(transfer.opener, "the central window offers to open a vault for a tab").not.toBeNull();
    await act(async () => {
      await transfer.opener!("/B");
    });
    expect(shownIn()).toBe("/B");
  });

  it("is refused at once over a changed draft: no question, no waiting, and this window says why", async () => {
    await central();
    const draft = changedDraft();
    let refused: unknown = null;
    await act(async () => {
      await transfer.opener!("/B").catch((e: unknown) => {
        refused = e;
      });
    });
    expect(refused, "the hand-over fails, so its source keeps the tab").toBeInstanceOf(Error);
    expect(draft.asked, "nobody is asked behind another window").not.toHaveBeenCalled();
    expect(shownIn()).toBe("/A");
    expect(shellMounts).toBe(0);

    const said = i18n.t("window.transferBlockedByDraft");
    expect(said, "the notice has a text").not.toBe("window.transferBlockedByDraft");
    expect(toastStore.get().map((item) => item.message)).toContain(said);
    await settle();
    // Forward from wherever it is: the usual state of the central window while
    // someone works in a second one is minimised, and focus alone does not
    // bring that back.
    expect(os.calls, "the window comes forward with the notice").toEqual(["unminimize", "show", "setFocus"]);
  });

  it("is not refused for the vault this window already shows", async () => {
    await central();
    changedDraft();
    await act(async () => {
      await transfer.opener!("/A");
    });
    expect(shownIn()).toBe("/A");
    expect(toastStore.get()).toEqual([]);
  });

  it("fails at once for a vault this window does not open, instead of waiting for it", async () => {
    await central();
    // Another window shows /B; a vault inside it overlaps and is refused. The
    // hand-over used to hear nothing of that and waited half a minute for a
    // vault that was never coming.
    await act(async () => acquireVault("/B", "full-1"));
    let refused: unknown = null;
    await act(async () => {
      await transfer.opener!("/B/inner").catch((e: unknown) => {
        refused = e;
      });
    });
    expect(refused).toBeInstanceOf(Error);
    expect(shownIn()).toBe("/A");
    expect(toastStore.get().some((item) => item.kind === "error"), "the reason is the overlap notice").toBe(true);
  });
});

describe("a full second window", () => {
  it("switches and closes without asking when nothing is held", async () => {
    await second();
    act(() => {
      void api!.openVault("/B");
    });
    // The same tick here too: this window only changes what it shows.
    expect(shownIn()).toBe("/B");
    act(() => {
      void api!.closeVault();
    });
    expect(api!.shownVault).toBeNull();
  });

  it("asks before it switches or closes over a changed draft; Cancel keeps both", async () => {
    await second();
    const draft = changedDraft();

    let opened: boolean | null = null;
    act(() => {
      void api!.openVault("/B").then((result) => {
        opened = result;
      });
    });
    await settle();
    expect(draft.asked).toHaveBeenCalledTimes(1);
    expect(shownIn()).toBe("/A");
    draft.answer(false);
    await settle();
    expect(shownIn()).toBe("/A");
    expect(shellMounts).toBe(0);
    expect(opened, "this window, too, says that it stayed where it was").toBe(false);

    act(() => {
      void api!.closeVault();
    });
    await settle();
    expect(draft.asked).toHaveBeenCalledTimes(2);
    draft.answer(false);
    await settle();
    expect(shownIn()).toBe("/A");

    picked.value = "/C";
    act(() => {
      void api!.selectVault();
    });
    await settle();
    expect(draft.asked).toHaveBeenCalledTimes(3);
    draft.answer(true);
    await settle();
    expect(shownIn(), "Discard lets the window go to the vault that was picked").toBe("/C");
  });

  it("does not ask when it is told to show the vault it already shows", async () => {
    await second();
    const draft = changedDraft();
    await act(async () => {
      await api!.openVault("/A");
    });
    expect(draft.asked).not.toHaveBeenCalled();
    expect(shellMounts).toBe(0);
  });
});
