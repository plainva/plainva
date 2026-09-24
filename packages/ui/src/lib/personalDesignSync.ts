import { sameStoredValue } from "@plainva/core";
import type { ISettingsStore } from "../platform/settings";
import { parseCustomThemeDesign, type CustomThemeDesign } from "./customThemeDesign";
import { mergeCustomThemeProfiles, parseCustomThemeProfile, reviseCustomThemeProfile, type CustomThemeProfile } from "./customThemeProfile";

export const PERSONAL_DESIGN_EVENT = "plainva-personal-design-changed";
const SOURCE_KEY = "personalDesignSource";
const DEVICE_KEY = "personalDesignDevice";
const stateKey = (scope: string) => `personalDesign_${encodeURIComponent(scope)}`;
export const personalDesignScope = (vault: string, member: string | null = null) => JSON.stringify([vault, member]);
interface DesignState { profile: CustomThemeProfile | null; pending: boolean }
interface DesignSource { scope: string; label: string }
export interface PersonalDesignStatus {
  enabled: boolean;
  sourceLabel: string | null;
  profile: CustomThemeProfile | null;
}
// Settings editing is owned by the primary desktop window; all asynchronous
// imports and local edits in that window (or the mobile shell) share this queue.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  queue = result.catch(() => {});
  return result;
}
function signal() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PERSONAL_DESIGN_EVENT));
}

function requireProfile(raw: unknown): CustomThemeProfile | null {
  if (raw === undefined || raw === null) return null;
  const profile = parseCustomThemeProfile(raw);
  if (!profile) throw new Error("custom_theme_profile_invalid");
  return profile;
}

/** Called before profile LWW, including on a device's first participation. */
export function mergePersonalDesignValues(versions: readonly Record<string, unknown>[]): Record<string, unknown> {
  let profile: CustomThemeProfile | null = null;
  for (const values of versions) profile = mergeCustomThemeProfiles(profile, requireProfile(values.personalDesign));
  return profile ? { personalDesign: profile } : {};
}

/** Finish a pending appearance mirror at app start, even while file sync is off. */
export async function recoverPersonalDesign(store: ISettingsStore, readLocal: () => Promise<CustomThemeDesign>, writeLocal: (design: CustomThemeDesign) => Promise<void>): Promise<void> {
  const source = await store.get<DesignSource>(SOURCE_KEY);
  if (source?.scope && typeof source.label === "string") await new PersonalDesignSync(store, source.scope, source.label, readLocal, writeLocal).read();
}

/** One explicitly selected vault/member supplies this device's personal design.
 * Other profiles are retained for convergence but cannot change its appearance.
 * A pending mirror survives termination between the register and theme writes.
 */
export class PersonalDesignSync {
  constructor(
    private readonly store: ISettingsStore,
    readonly scope: string,
    private readonly label: string,
    private readonly readLocal: () => Promise<CustomThemeDesign>,
    private readonly writeLocal: (design: CustomThemeDesign) => Promise<void>,
  ) {}

  private async state(): Promise<DesignState> {
    const raw = await this.store.get<DesignState>(stateKey(this.scope));
    return { profile: requireProfile(raw?.profile), pending: raw?.pending === true };
  }
  private source() { return this.store.get<DesignSource>(SOURCE_KEY); }
  private async status(): Promise<PersonalDesignStatus> {
    const source = await this.source();
    return { enabled: source?.scope === this.scope, sourceLabel: source?.label ?? null, profile: (await this.state()).profile };
  }
  private async persist(state: DesignState): Promise<void> {
    await this.store.set(stateKey(this.scope), state);
    await this.store.save();
  }
  private async recover(): Promise<void> {
    const state = await this.state();
    if (!state.pending || (await this.source())?.scope !== this.scope || state.profile?.variants.length !== 1) return;
    await this.writeLocal(state.profile.variants[0].design);
    await this.persist({ ...state, pending: false });
    signal();
  }
  private async device(): Promise<string> {
    const existing = await this.store.get<string>(DEVICE_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    await this.store.set(DEVICE_KEY, id);
    await this.store.save();
    return id;
  }
  read(): Promise<PersonalDesignStatus> { return exclusive(async () => { await this.recover(); return this.status(); }); }
  export(): Promise<CustomThemeProfile | null> { return exclusive(async () => { await this.recover(); return (await this.state()).profile; }); }

  setEnabled(enabled: boolean): Promise<PersonalDesignStatus> {
    return exclusive(async () => {
      if (enabled) {
        const state = await this.state();
        const profile = state.profile ?? reviseCustomThemeProfile(null, await this.device(), await this.readLocal());
        await this.persist({ profile, pending: true });
        await this.store.set(SOURCE_KEY, { scope: this.scope, label: this.label } satisfies DesignSource);
      } else if ((await this.source())?.scope === this.scope) {
        await this.store.delete(SOURCE_KEY);
      }
      await this.store.save();
      await this.recover();
      signal();
      return this.status();
    });
  }

  save(design: CustomThemeDesign, baseline: CustomThemeProfile | null): Promise<PersonalDesignStatus> {
    return exclusive(async () => {
      const valid = parseCustomThemeDesign(design);
      if (!valid) throw new Error("custom_theme_invalid");
      if ((await this.source())?.scope !== this.scope) {
        await this.writeLocal(valid);
      } else {
        const latest = (await this.state()).profile;
        const device = await this.device();
        // Serial local writes know their own previous revisions. An unseen
        // OTHER device's head stays concurrent with a stale editor's change.
        const own = latest?.variants.filter(v => v.device === device) ?? [];
        const observed = mergeCustomThemeProfiles(baseline, own.length ? { version: 1, variants: own } : null);
        const revision = reviseCustomThemeProfile(observed, device, valid);
        const profile = mergeCustomThemeProfiles(latest, revision);
        await this.persist({ profile, pending: true });
        await this.writeLocal(valid);
        await this.persist({ profile, pending: false });
      }
      signal();
      return this.status();
    });
  }

  receive(raw: unknown): Promise<void> {
    return exclusive(async () => {
      const incoming = requireProfile(raw);
      if (incoming) {
        const state = await this.state(), profile = mergeCustomThemeProfiles(state.profile, incoming);
        if (!sameStoredValue(profile, state.profile)) await this.persist({ profile, pending: true });
      }
      await this.recover();
      signal();
    });
  }
}
