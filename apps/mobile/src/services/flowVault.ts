import { serviceConnectionMessage, toast, toastStore } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { activeLeaveGuard, disarmLeaveGuard } from "./leaveGuard";
import { leaveThen } from "./leaveQuestion";
import { getActiveVaultEntry, getVaultEntry } from "./vaultRegistry";
import { switchVault } from "./vaultService";

/**
 * A vault switch the PROGRAM starts, not the person (finding 2026-10-12).
 *
 * A connection belongs to a vault, and its flow ends in that vault by itself:
 * a calendar or mail sign-in goes back to the vault it was begun in when the
 * browser returns, a file connection does when its folder is picked, a connect
 * run whose destination was never activated activates it — and every file
 * connection ends by opening the vault it has just made. `switchVault` drops
 * every stack and only the screen on top is rendered, so whatever else was on
 * screen at that moment — a message being written — went with the switch.
 * Nothing asked, and nothing could: the question cannot live in `switchVault`,
 * which every connect flow ends through with the guard of its own form still
 * armed.
 *
 * Such a flow comes HERE to get to its vault. With nothing of anyone else's at
 * stake the switch happens as it always did. While a surface holds unsaved
 * input that is not the flow's own, the flow does not take the vault: it stops
 * where it is, a notice says which vault the connection waits in, and its
 * button asks the surface's own question first (`leaveThen`). "Cancel" leaves
 * the message and the offer standing. The flow goes on as soon as its vault is
 * the one on screen, by the button or by any other way there. Once offered,
 * the vault is the person's to open: no flow of it takes it later by itself,
 * even when nothing is at stake by then — the person may have closed the
 * notice ("not now") or chosen another vault. That is this session's: an offer
 * lives in memory, and after a restart a flow that still has to get to its
 * vault goes there like any other.
 *
 * The notice is this module's to keep true: it stands exactly as long as a
 * flow waits behind it. A flow that ends some other way — cancelled, replaced
 * by a later one — takes it down (`releaseFlowVault`); a vault that is deleted
 * ends every flow that waited for it (`FlowVaultStep.gone`).
 */

/** What a flow leaves here when it has to stop short of its vault. */
export interface FlowVaultStep {
  /** The flow from where it stopped. Runs once its vault is the one on screen. */
  resume: () => void | Promise<void>;
  /**
   * Whether the flow still waits for the vault. Asked before anybody is asked
   * to give something up for it: a connection that is over must not cost a
   * message.
   */
  waits: () => boolean | Promise<boolean>;
  /**
   * The vault is gone — deleted while the flow waited for it, or before the
   * flow came back to it. The flow is over and lets go of what it keeps for
   * that vault; without this it only stops.
   */
  gone?: () => void | Promise<void>;
}

/**
 * The leave guard of the form a file connection is started from
 * (`AddVaultScreen`). Its input is what is being connected, so the end of that
 * connection is not asked about it.
 */
export const CONNECT_FORM_GUARD = "vault-connect";

interface Offer {
  /** The notice last raised for this vault; it may have been closed by hand since. */
  notice: number | null;
  steps: Map<string, FlowVaultStep>;
  /** Flows a notice has been raised for: the person has the choice, and the vault is theirs to open. */
  offered: Set<string>;
  /** Flows that only wait for an entry under way (`whileEntering`): never offered, and forgotten if it fails. */
  quiet: Set<string>;
}

/** The flows that wait, by the vault they wait for. */
const offers = new Map<string, Offer>();
/** Vaults a flow of their own is activating right now (`whileEntering`). */
const entering = new Map<string, number>();
/** The guard of the input the person gave up at a notice's button, by the vault it was given up for. */
const givenUp = new Map<string, string>();
let listening = false;

const report = (error: unknown) => toast.error(serviceConnectionMessage(error, i18n.t));
const standing = (offer: Offer) => offer.notice !== null && toastStore.get().some((item) => item.id === offer.notice);
/** `null`: the vault is gone. `undefined`: the registry could not be read, which decides nothing. */
const entryOf = (vaultId: string) => getVaultEntry(vaultId).catch(() => undefined);

/**
 * Whether a surface holds unsaved input that is not the flow's own. `own` is
 * the guard of the form the flow was started from, where it has one.
 */
export function foreignInputOnScreen(own?: string): boolean {
  const guard = activeLeaveGuard();
  return guard !== null && guard.id !== own;
}

/** Whether the person has been offered the vault for this flow, and the flow still waits there. */
export function waitsAtOffer(vaultId: string, flow: string): boolean {
  return offers.get(vaultId)?.offered.has(flow) ?? false;
}

function drop(vaultId: string, offer: Offer): void {
  if (offers.get(vaultId) === offer) offers.delete(vaultId);
  if (offer.notice !== null) toast.dismiss(offer.notice);
}

/** Takes one flow out of its vault's offer; the last one takes the offer with it. */
function forget(vaultId: string, offer: Offer, flow: string): void {
  offer.steps.delete(flow);
  offer.offered.delete(flow);
  offer.quiet.delete(flow);
  if (offer.steps.size === 0) drop(vaultId, offer);
}

/** The vault is on screen: whatever waited for it goes on, and its notice goes. */
function settle(vaultId: string): void {
  // The input given up for this vault at its notice goes with the switch —
  // the shell drops every stack on it. Its guard goes here, before anything
  // goes on: a flow that goes on into a connection of its own must not find
  // it still armed (`keepArmed` in leaveQuestion.ts) and offer a second time.
  const given = givenUp.get(vaultId);
  givenUp.delete(vaultId);
  if (given) disarmLeaveGuard(given);
  const offer = offers.get(vaultId);
  if (!offer) return;
  drop(vaultId, offer);
  // A microtask later, so every listener of the switch — the shell, which drops
  // its stacks and begins to boot the vault — has run before a flow goes on.
  for (const step of offer.steps.values()) void Promise.resolve().then(step.resume).catch(report);
}

/** The vault is gone: whatever waited for it is over, and so is its notice. */
function end(vaultId: string, offer: Offer): void {
  drop(vaultId, offer);
  for (const step of offer.steps.values()) void Promise.resolve().then(() => step.gone?.()).catch(report);
}

/** The vault list changed: an offer whose vault was deleted ends with it. */
async function sweep(): Promise<void> {
  for (const [vaultId, offer] of [...offers]) {
    if ((await entryOf(vaultId)) === null && offers.get(vaultId) === offer) end(vaultId, offer);
  }
}

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("m-vault-switched", (event) => {
    const id = (event as CustomEvent<{ id?: string }>).detail?.id;
    if (id) settle(id);
  });
  window.addEventListener("m-vaults-changed", () => void sweep());
}

async function raise(vaultId: string, offer: Offer): Promise<void> {
  const entry = await entryOf(vaultId);
  // Settled, or raised by a neighbour, while the registry was read.
  if (offers.get(vaultId) !== offer || standing(offer)) return;
  // A vault that is gone is nobody's way on: what waited for it is over.
  if (entry === null) {
    end(vaultId, offer);
    return;
  }
  // The vault list could not be read: no notice that might name the wrong
  // vault. The flows stay unoffered: one that comes by again raises the
  // notice — or takes the vault, if nothing is at stake by then —, and every
  // one of them goes on once the vault is opened another way.
  if (entry === undefined) return;
  offer.notice = toast.progress(i18n.t("mobile.flowVaultOffer", { name: entry.name || i18n.t("mobile.vaultLocal") }), {
    label: i18n.t("sidebar.switchVault"),
    run: () => void accept(vaultId, offer),
  });
  for (const flow of offer.steps.keys()) if (!offer.quiet.has(flow)) offer.offered.add(flow);
}

/** The notice's button: what still waits is asked for, then the surface on top. */
async function accept(vaultId: string, offer: Offer): Promise<void> {
  if ((await entryOf(vaultId)) === null) {
    if (offers.get(vaultId) === offer) end(vaultId, offer);
    return;
  }
  for (const [flow, step] of [...offer.steps]) {
    // A flow that cannot say whether it still waits is kept: one question too
    // many is better than a connection that is dropped without a word.
    const waits = await Promise.resolve().then(step.waits).catch(() => true);
    if (!waits) {
      offer.steps.delete(flow);
      offer.offered.delete(flow);
      offer.quiet.delete(flow);
    }
  }
  if (offers.get(vaultId) !== offer) return;
  if (offer.steps.size === 0) {
    drop(vaultId, offer);
    return;
  }
  // The input the question is about: "Discard" gives up this one, and no other.
  const atStake = activeLeaveGuard()?.id;
  leaveThen(
    () => {
      // While the question was up, the flows may have ended, or the vault may
      // have been opened or deleted another way: then nothing is switched,
      // and the input stays.
      if (offers.get(vaultId) !== offer || offer.steps.size === 0) return;
      // What is on screen goes with the switch, and so does its guard.
      if (atStake) givenUp.set(vaultId, atStake);
      // The switch announces itself (`m-vault-switched`), and that is what lets
      // the flows go on; a vault that was on screen already says nothing — and
      // took nothing off the screen —, hence the second call. A switch that
      // failed leaves the offer, and the input, where they were.
      void switchVault(vaultId).then(
        () => {
          givenUp.delete(vaultId);
          settle(vaultId);
        },
        (error: unknown) => {
          givenUp.delete(vaultId);
          report(error);
          void raise(vaultId, offer);
        },
      );
    },
    // "Cancel" keeps the message — and the way to the vault.
    () => void raise(vaultId, offer),
  );
}

/**
 * Brings a flow to the vault it belongs to. True: the vault is the one on
 * screen and the flow goes on. False: it is not, and the flow stops here — it
 * is called again (`resume`) once that has changed, or ended (`gone`) if the
 * vault is deleted.
 *
 * `flow` names the kind of flow. A flow that comes by again while it waits (a
 * run does, on every sign of life) replaces its step and raises nothing new —
 * a notice closed by hand means "not now". `own` is the guard of the flow's
 * own form (`foreignInputOnScreen`).
 */
export async function enterFlowVault(vaultId: string, flow: string, step: FlowVaultStep, own?: string): Promise<boolean> {
  if ((await getActiveVaultEntry()).id === vaultId) return true;
  listen();
  // A vault that is gone is nobody's way on: the flow is over, and so is
  // whatever waited for the vault with it. Switching would not even fail
  // cleanly — `switchVault` stops the sync of the vault on screen before it
  // finds out.
  if ((await entryOf(vaultId)) === null) {
    const waiting = offers.get(vaultId);
    if (waiting) {
      // This flow ends below, with the step it has brought now.
      waiting.steps.delete(flow);
      end(vaultId, waiting);
    }
    await Promise.resolve().then(() => step.gone?.()).catch(report);
    return false;
  }
  // The vault's own flow is on its way there (`whileEntering`): it arrives
  // without a second switch, and nobody has to be offered anything.
  const onItsWay = entering.has(vaultId);
  const offered = waitsAtOffer(vaultId, flow);
  // The person has been offered this vault and has not opened it: the way
  // there is theirs, for every flow of it — one that turns up only now raises
  // the notice again rather than taking the vault.
  const theirs = (offers.get(vaultId)?.offered.size ?? 0) > 0;
  if (!onItsWay && !theirs && !foreignInputOnScreen(own)) {
    // A step this flow left here without a notice (the vault list could not be
    // read) is the one going on now, not a second time on the switch.
    const waiting = offers.get(vaultId);
    if (waiting) forget(vaultId, waiting, flow);
    await switchVault(vaultId);
    return true;
  }
  const offer = offers.get(vaultId) ?? { notice: null, steps: new Map<string, FlowVaultStep>(), offered: new Set<string>(), quiet: new Set<string>() };
  offers.set(vaultId, offer);
  offer.steps.set(flow, step);
  if (onItsWay) {
    if (!offered) offer.quiet.add(flow);
    return false;
  }
  offer.quiet.delete(flow);
  if (!offered) {
    // A notice that stands for another flow of this vault offers it for this one too.
    if (standing(offer)) offer.offered.add(flow);
    else await raise(vaultId, offer);
  }
  return false;
}

/**
 * The end of a file connection: the vault it has just made becomes the one on
 * screen, and `after` — what needs that vault to be the active one — runs.
 *
 * Ordinarily the connect form is still on top, and its typed credentials are
 * what was just connected: nobody is asked. But a connection can outlive its
 * form — a consent that returns late opens its folder picker over whatever is
 * on screen by then. With someone else's unsaved input there the new vault is
 * offered instead of taken, like every other way to a flow's vault. What
 * `after` does is lost if the app ends before the vault is opened; what can be
 * written into the new vault without opening it is written before, by the
 * caller.
 */
export async function enterMadeVault(vaultId: string, after: () => void | Promise<void> = () => {}): Promise<void> {
  if (await enterFlowVault(vaultId, "new-vault", { resume: after, waits: () => true }, CONNECT_FORM_GUARD)) await after();
}

/**
 * A flow that ended some other way — given up, replaced by a later one, run
 * out — takes its offer with it, in every vault but `keep`.
 */
export function releaseFlowVault(flow: string, keep?: string): void {
  for (const [vaultId, offer] of [...offers]) {
    if (vaultId === keep || !offer.steps.has(flow)) continue;
    forget(vaultId, offer, flow);
  }
}

/**
 * Marks the stretch in which a flow activates the vault it has just made —
 * from the committed result to the switch.
 *
 * In that stretch the vault is already the run's destination and not yet the
 * one on screen, which is exactly what an interrupted activation looks like.
 * Whoever comes by meanwhile (`enterFlowVault`) is told to wait instead of
 * switching a second time, or of offering a switch that is about to happen —
 * with the form of this very flow, and its guard, still on screen.
 */
export async function whileEntering<T>(vaultId: string, run: () => Promise<T>): Promise<T> {
  entering.set(vaultId, (entering.get(vaultId) ?? 0) + 1);
  try {
    return await run();
  } finally {
    const left = (entering.get(vaultId) ?? 1) - 1;
    if (left > 0) entering.set(vaultId, left);
    else {
      entering.delete(vaultId);
      // Whoever waited for this entry was let go by the switch. If the switch
      // did not come, those who only waited for it are forgotten rather than
      // kept without a notice — each comes by again on its own next occasion.
      // Whoever had been offered the vault before keeps the offer.
      const offer = offers.get(vaultId);
      if (offer) {
        for (const flow of offer.quiet) offer.steps.delete(flow);
        offer.quiet.clear();
        if (offer.steps.size === 0) drop(vaultId, offer);
      }
    }
  }
}

/** Test seam — the app never forgets a waiting flow. */
export function resetFlowVaultForTest(): void {
  for (const [vaultId, offer] of [...offers]) drop(vaultId, offer);
  entering.clear();
  givenUp.clear();
}
