// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SecurityWizardScreen } from "./screens/SecurityWizardScreen";
import { activeLeaveGuard, resetLeaveGuard } from "./services/leaveGuard";
import { currentMobileDialog, dismissMobileDialog } from "./services/mobileDialogs";
import { createNavActions } from "./services/navActions";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A wizard that FINISHED leaves without being asked whether to cancel
 * (finding 2026-10-09, the composer's fault in a second place).
 *
 * The leave guard is armed for as long as a prepared key exists, and Back asks
 * — that is the point of the screen being a destination (S37). But the
 * passphrase flow clears its draft and leaves in the same breath, before the
 * guard has heard that the draft is gone. Through `pop` the shell therefore
 * asked "discard your input?" about a key that had just been activated, and
 * "cancel" stranded the user on the progress step.
 *
 * The services are replaced; the screen, the guard and the shell's two exits
 * are real, because the question lives between those three.
 */

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(async () => ({ draftId: "draft-1", recoveryCode: "ABCD-ABCD-ABCD-ABCD" })),
  activate: vi.fn(async () => undefined),
}));

vi.mock("./services/mobileSettingsSync", () => ({
  KeyfileAlreadyExistsError: class extends Error {},
  KeyfileProbeFailedError: class extends Error {},
  prepareMobileEncryption: mocks.prepare,
  activatePreparedMobileEncryption: mocks.activate,
  discardPreparedMobileEncryption: vi.fn(),
}));
vi.mock("./services/mobileWorkspaceSecurity", () => ({
  activatePreparedMobileWorkspace: vi.fn(),
  discardPreparedMobileWorkspace: vi.fn(),
  prepareMobileWorkspace: vi.fn(),
}));
vi.mock("./services/syncService", () => ({
  getMobileWorkspaceObjectStore: vi.fn(),
  remoteSidebandFileExists: vi.fn(async () => false),
  stopSyncAndDrain: vi.fn(async () => undefined),
}));
vi.mock("./services/recoveryFile", () => ({ saveRecoveryFile: vi.fn(async () => undefined) }));
vi.mock("./services/vaultService", () => ({ reloadActiveMobileVault: vi.fn(async () => undefined) }));

let container: HTMLDivElement;
let root: Root;
let left: number;
let nav: ReturnType<typeof createNavActions>;

beforeEach(() => {
  mocks.prepare.mockClear();
  mocks.activate.mockClear();
  resetLeaveGuard();
  left = 0;
  nav = createNavActions(() => void (left += 1), () => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  const open = currentMobileDialog();
  if (open) dismissMobileDialog(open);
  act(() => root.unmount());
  container.remove();
});

const q = (testId: string) => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
async function type(testId: string, value: string) {
  const el = q(testId) as HTMLInputElement | null;
  expect(el, `${testId} is on screen`).not.toBeNull();
  await act(async () => {
    setInputValue.call(el, value);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function tap(testId: string) {
  const el = q(testId) as HTMLButtonElement | null;
  expect(el, `${testId} is on screen`).not.toBeNull();
  expect(el!.disabled, `${testId} can be tapped`).toBe(false);
  await act(async () => el!.click());
  await act(async () => {});
}

/** The passphrase flow up to the prepared key: the guard is armed from here on. */
async function prepareKey(onDone: () => void) {
  await act(async () => {
    root.render(<SecurityWizardScreen flow="encryption" vault={{ vaultId: "local" } as never} onBack={nav.pop} onDone={onDone} />);
  });
  await type("encryption-passphrase", "correct horse battery");
  await type("encryption-passphrase-confirm", "correct horse battery");
  await tap("wizard-prepare");
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  // Every group of the fixture's code reads the same, so whichever two the
  // wizard asks for, the answer is known.
  await type("wizard-verify-0", "ABCD");
  await type("wizard-verify-1", "ABCD");
}

describe("the security wizard's own exit", () => {
  it("asks while a prepared key exists — Back would destroy it", async () => {
    await prepareKey(nav.done);
    expect(activeLeaveGuard()?.id).toBe("security-wizard");
    await act(async () => nav.pop());
    expect(currentMobileDialog()?.kind).toBe("confirm");
    expect(left).toBe(0);
  });

  it("does not ask once the key is activated", async () => {
    await prepareKey(nav.done);
    await tap("wizard-activate");
    expect(mocks.activate).toHaveBeenCalledWith(expect.anything(), "draft-1");
    expect(currentMobileDialog(), "the shell asked whether to cancel a setup that had just succeeded").toBeNull();
    expect(left).toBe(1);
  });
});
