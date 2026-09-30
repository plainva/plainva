import type { ISyncTarget, PullResult, PushResult, RemoteProbe, SyncOperation } from "./ISyncTarget.js";
import { hasSpellingVariants } from "./pathIdentity.js";
import { PathSpellings, type SpellingListingCache, type SpellingSource } from "./pathSpellings.js";

const WRAPPED = Symbol.for("plainva.pathSpellings.target");

interface SpellingState {
  spellings: PathSpellings;
  /** Folder listings asked for during this pass, cleared by every pull. */
  listings: SpellingListingCache;
  source: SpellingSource;
}

const states = new WeakMap<object, { proxy: ISyncTarget; state: SpellingState }>();

/**
 * The remote side of path identity (ADR 0016): the sync names every file by
 * its NFC identity, the provider keeps whatever bytes it was given. This proxy
 * translates between the two for every file operation, for every provider:
 *
 *  - a pull's paths become identities (and every stored spelling that differs
 *    is remembered). Two spellings of one name side by side on the remote are
 *    twins: the NFC one keeps the identity, the other its own bytes — the
 *    worker then reports it instead of syncing it;
 *  - before PUT, MKCOL, MOVE and DELETE (and every read) the identity is
 *    turned back into the spelling the remote already holds, segment by
 *    segment — so a note written into "Neutralität" lands in the folder the
 *    server holds, whether that is stored composed or decomposed, instead of a
 *    second, identical-looking one (issue #112). A new name is created in NFC.
 *    What the cycle's listing established is used first; a target that can
 *    list one folder (`listVaultFolder`, WebDAV) is asked where it did not.
 *
 * Nothing is renamed on the remote. Everything else — properties such as
 * `allowRootCreation`, the pickers' `listFolders`/`createFolder`, which count
 * from the account root — passes through untouched.
 *
 * One proxy per target object: the engine and the worker share the spellings.
 */
export function withPathSpellings(target: ISyncTarget): ISyncTarget {
  if ((target as unknown as Record<symbol, unknown>)[WRAPPED]) return target;
  const existing = states.get(target);
  if (existing) return existing.proxy;

  const state: SpellingState = {
    spellings: new PathSpellings(),
    listings: new Map(),
    source: {
      listNames: async (raw) => {
        if (typeof target.listVaultFolder !== "function") return undefined;
        return target.listVaultFolder(raw);
      },
    },
  };
  const { spellings } = state;
  const resolve = (identity: string) => spellings.resolve(identity, state.source, state.listings);

  const identities = (res: PullResult, full: boolean): PullResult => {
    if (full) spellings.clear();
    const raws = [...res.etagMap.keys(), ...(res.folders ?? []), ...(res.deleted ?? [])];
    if (!raws.some(hasSpellingVariants)) return res;
    let idOf: (raw: string) => string;
    if (full) {
      const ids = spellings.observe([...res.etagMap.keys(), ...(res.folders ?? [])]);
      idOf = (raw) => ids.get(raw) ?? spellings.identityOfStored(raw);
    } else {
      idOf = (raw) => {
        const id = spellings.identityOfStored(raw);
        spellings.remember(id, raw);
        return id;
      };
    }
    const rekey = <V>(map: Map<string, V> | undefined): Map<string, V> | undefined =>
      map && new Map([...map].map(([raw, value]) => [idOf(raw), value] as [string, V]));
    const deleted = res.deleted?.map((raw) => {
      const id = spellings.identityOfStored(raw);
      spellings.forget(id);
      return id;
    });
    return {
      ...res,
      etagMap: rekey(res.etagMap)!,
      ...(res.folders ? { folders: res.folders.map(idOf) } : {}),
      ...(deleted ? { deleted } : {}),
      ...(res.mtimeMap ? { mtimeMap: rekey(res.mtimeMap)! } : {}),
      ...(res.idMap ? { idMap: rekey(res.idMap)! } : {}),
    };
  };

  const wrapped: Partial<Record<keyof ISyncTarget, unknown>> = {
    async pull(cursor?: string): Promise<PullResult> {
      // A full listing is a call without a cursor, and stays one.
      const res = cursor === undefined ? await target.pull() : await target.pull(cursor);
      state.listings = new Map();
      return identities(res, cursor === undefined);
    },
    async push(op: SyncOperation): Promise<PushResult | void> {
      const from = await resolve(op.file_path);
      const to = op.new_path ? await resolve(op.new_path) : op.new_path;
      const stored = from === op.file_path && to === op.new_path ? op : { ...op, file_path: from, ...(to !== undefined ? { new_path: to } : {}) };
      const result = await target.push(stored);
      // What the remote holds now: the next operation in this pass (another
      // note in the same new folder) finds its spelling without asking.
      state.listings = new Map();
      if (op.operation === "delete") spellings.forget(op.file_path);
      else if (op.operation === "rename" && op.new_path && to !== undefined) {
        spellings.forget(op.file_path);
        spellings.remember(op.new_path, to);
      } else if (op.operation === "write" || op.operation === "mkdir") {
        spellings.remember(op.file_path, from);
      }
      return result;
    },
    async download(filePath: string) {
      return target.download(spellings.resolveKnown(filePath));
    },
    async downloadConditional(filePath: string, etag?: string) {
      return target.downloadConditional!(spellings.resolveKnown(filePath), etag);
    },
    async remoteEtag(filePath: string) {
      return target.remoteEtag!(spellings.resolveKnown(filePath));
    },
    async stat(filePath: string) {
      return target.stat!(spellings.resolveKnown(filePath));
    },
    async probeExists(probe: RemoteProbe) {
      // Asked because the listing did not carry the path: look for the other
      // spelling before answering "absent".
      return target.probeExists!({ ...probe, path: await resolve(probe.path) });
    },
    async createVaultFolder(path: string) {
      const stored = await resolve(path);
      await target.createVaultFolder!(stored);
      state.listings = new Map();
      spellings.remember(path, stored);
    },
  };

  const proxy = new Proxy(target, {
    get(inner, prop, receiver) {
      if (prop === WRAPPED) return true;
      if (typeof prop === "string" && prop in wrapped) {
        const own = (inner as unknown as Record<string, unknown>)[prop];
        if (typeof own !== "function") return own;
        return wrapped[prop as keyof ISyncTarget];
      }
      const value = Reflect.get(inner, prop, receiver === proxy ? inner : receiver);
      return typeof value === "function" ? value.bind(inner) : value;
    },
    set(inner, prop, value) {
      return Reflect.set(inner, prop, value);
    },
    has(inner, prop) {
      return prop === WRAPPED || Reflect.has(inner, prop);
    },
  }) as ISyncTarget;
  states.set(target, { proxy, state });
  return proxy;
}
