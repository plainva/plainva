import type { ISyncTarget } from "./ISyncTarget.js";

interface Entry { bytes: Uint8Array; etag: string }
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 128;
const strongEtag = (value: string | undefined) => !!value && value.length <= 512 && /^"[\x21\x23-\x7e\x80-￿]*"$/.test(value);

/**
 * `If-None-Match` compares WEAKLY (RFC 9110 13.1.2): two validators match when
 * their opaque tags are identical after dropping a `W/` prefix (8.8.3.2). A
 * server may therefore answer our strong `"abc"` with `304` and `W/"abc"`, and
 * nginx does exactly that once compression is on.
 */
const weakMatch = (a: string, b: string) => a.replace(/^W\//, "") === b.replace(/^W\//, "");

/** Content-free shortening for a diagnostic line: validators are opaque, but need not be long. */
const clip = (value: string | undefined) => value === undefined ? "(none)" : value.length > 24 ? `${value.slice(0, 24)}…` : value;

export interface SidebandReadOptions {
  /**
   * One content-free line whenever the cache stops trusting a target's 304s
   * (#113). The shells route it into the sync diagnostics log; it never
   * carries a path's contents, only the two validators, shortened.
   */
  onDiagnostic?: (line: string) => void;
}

/** A single GET/304, never an extra stat request just to avoid a small GET. */
export class SidebandReadCache {
  private entries = new Map<string, Entry>();
  private target: ISyncTarget | null = null;
  /**
   * Set once a target answered a conditional GET with a validator that does not
   * belong to what we sent (#113). Until the app restarts, this target is read
   * unconditionally: asking again would cost two requests every cycle for a
   * server whose 304s we cannot bind to our copy.
   */
  private conditionalDisabled = false;
  readonly transfers = { requests: 0, bytes: 0, notModified: 0 };

  begin(target: ISyncTarget, options: SidebandReadOptions = {}) {
    if (this.target !== target) { this.entries.clear(); this.target = target; this.conditionalDisabled = false; }
    const pending = new Map<string, Entry | null>();
    const plain = async (path: string): Promise<Uint8Array | null> => {
      const bytes = await target.download(path);
      this.transfers.bytes += bytes?.length ?? 0;
      return bytes;
    };
    return {
      read: async (path: string, accept: (bytes: Uint8Array | null) => boolean = () => true): Promise<Uint8Array | null> => {
        this.transfers.requests++;
        if (!target.downloadConditional) return plain(path);
        const cached = this.conditionalDisabled ? undefined : this.entries.get(path);
        const response = await target.downloadConditional(path, cached?.etag);
        if (response.notModified) {
          // A 304 to a request that carried no validator is a broken adapter —
          // there is nothing it could be "not modified" against. The real
          // adapters cannot produce it (they only report 304 when they sent one).
          if (!cached) throw new Error("Sideband returned an unbound validator");
          // A 304 without an ETag header comes back carrying the one we sent.
          if (weakMatch(response.etag, cached.etag)) {
            this.transfers.notModified++;
            return new Uint8Array(cached.bytes);
          }
          // Any other validator is a cache MISS, never an error (#113): the
          // server said "not modified" about something we cannot tie to our
          // copy - a compression filter appending `-gzip`, a proxy rewriting
          // tags. Forget the entry, read once more without a validator in this
          // same call, and stop asking this target conditionally.
          this.entries.delete(path);
          this.conditionalDisabled = true;
          options.onDiagnostic?.(`Comment sync: 304 validator mismatch (sent ${clip(cached.etag)}, got ${clip(response.etag)}); conditional reads off for this target until restart`);
          this.transfers.requests++;
          const fresh = await target.downloadConditional(path, undefined);
          if (fresh.notModified) throw new Error("Sideband returned an unbound validator");
          this.transfers.bytes += fresh.bytes?.length ?? 0;
          pending.set(path, null);
          return fresh.bytes;
        }
        this.transfers.bytes += response.bytes?.length ?? 0;
        pending.set(path, !this.conditionalDisabled && response.bytes && strongEtag(response.etag) && accept(response.bytes) ? { bytes: new Uint8Array(response.bytes), etag: response.etag! } : null);
        return response.bytes;
      },
      /** Call only after validation AND durable local processing succeeded. */
      commit: () => {
        for (const [path, entry] of pending) {
          this.entries.delete(path);
          if (entry && entry.bytes.length <= MAX_BYTES) this.entries.set(path, entry);
        }
        if (this.conditionalDisabled) this.entries.clear();
        let bytes = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes.length, 0);
        while (this.entries.size > MAX_ENTRIES || bytes > MAX_BYTES) {
          const oldest = this.entries.entries().next().value;
          if (!oldest) break;
          bytes -= oldest[1].bytes.length;
          this.entries.delete(oldest[0]);
        }
      },
    };
  }
}
