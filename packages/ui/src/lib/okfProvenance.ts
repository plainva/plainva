import { humanActor, okfInstant, producerActor, type OkfActorStamp } from "@plainva/core";
import { getPlatformServices, hasPlatformServices } from "../platform/services";

/**
 * Provenance stamps for the OKF 0.2 trust families (plan OKF v0.2, P3b).
 *
 * Only the MACHINE write paths stamp. The importer, mail capture and the task
 * sync are the three places where Plainva produces a note the user did not
 * type, and they say so with `generated` (plus `sources` where the producer
 * actually knows one). The editor never touches `generated`, `verified` or
 * `sources` (E3): a person saving a note is not a process, and a stamp nobody
 * asked for would be exactly the kind of claim the trust families exist to
 * make checkable. Existing notes are never stamped after the fact.
 *
 * Actor formats follow the spec's conventions: `<producer>/<version>` for a
 * process (`plainva-import/0.6.7`) and `human:<id>` for a person.
 */
export type PlainvaProducer = "import" | "mail-capture" | "task-sync";

let cachedVersion: Promise<string> | null = null;

/**
 * The app version that goes into producer actors. Read once through the
 * registered PlatformServices; a shell that registers no `appVersion` — or
 * one whose lookup fails — yields "dev", so a stamp is never blocked on it.
 */
export function appVersionForStamps(): Promise<string> {
  if (!cachedVersion) {
    cachedVersion = (async () => {
      try {
        if (!hasPlatformServices()) return "dev";
        const version = await getPlatformServices().appVersion?.();
        const trimmed = version?.trim() ?? "";
        return trimmed || "dev";
      } catch {
        return "dev";
      }
    })();
  }
  return cachedVersion;
}

/** Test seam: forgets the cached version so a fresh registration is read. */
export function resetAppVersionForStamps(): void {
  cachedVersion = null;
}

/** `plainva-<component>/<version>` — one producer name per write path. */
export async function plainvaProducer(component: PlainvaProducer): Promise<string> {
  return producerActor(`plainva-${component}`, await appVersionForStamps());
}

/** ISO instant without milliseconds — the form the spec examples use. */
export function stampTime(now: Date = new Date()): string {
  return okfInstant(now);
}

/** `generated: { by, at }` for a note a process wrote just now. */
export function generatedStamp(by: string, now: Date = new Date()): OkfActorStamp {
  return { by, at: stampTime(now) };
}

/** One `verified` entry for a person who reviewed the note just now. */
export function verifiedStamp(name: string, now: Date = new Date()): OkfActorStamp {
  return { by: humanActor(name), at: stampTime(now) };
}

/**
 * Appends a review to a note's `verified` list without losing what is there:
 * an existing array is copied, a single hand-written stamp is wrapped, an
 * absent key starts the list. The list is the note's review history — a
 * second reviewer never overwrites the first.
 */
export function appendVerification(existing: unknown, name: string, now: Date = new Date()): OkfActorStamp[] {
  const list: unknown[] = Array.isArray(existing) ? [...existing] : existing == null ? [] : [existing];
  list.push(verifiedStamp(name, now));
  return list as OkfActorStamp[];
}
