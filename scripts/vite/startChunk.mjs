/**
 * One chunk for what the start loads (performance plan L5). With the parts that load on demand split off, Rolldown
 * cut the modules the start needs into one chunk per set of importers — 262 files on the desktop, 368 on the phone,
 * each a request before the first picture. Every module the shell's entry reaches through static imports is loaded at
 * the start anyway; this puts those of the app and the packages into one chunk, `start`. The vendor groups of the
 * shells stay as they are (a `manualChunks` rule before this one wins), and nothing is duplicated: a module stands in
 * exactly one chunk, which the bundle gate holds.
 */
/**
 * @param {RegExp} entry the shell's entry module (`apps/<shell>/src/main.tsx`)
 * @returns {{ plugin: object; chunkOf(id: string): string | undefined }} the plugin reads the module graph once it is
 *   complete (`buildEnd`, before the chunks are made); `chunkOf` is the shell's `manualChunks` fallback.
 */
export function startChunk(entry) {
  let closure = new Set();
  const plugin = {
    name: "plainva-start-chunk",
    apply: "build",
    buildEnd() {
      closure = new Set();
      const queue = [...this.getModuleIds()].filter((id) => entry.test(id.split("\\").join("/")));
      while (queue.length > 0) {
        const at = queue.pop();
        if (closure.has(at)) continue;
        closure.add(at);
        for (const next of this.getModuleInfo(at)?.importedIds ?? []) if (!closure.has(next)) queue.push(next);
      }
    },
  };
  // The entry module stays in its own chunk: the entry file is small and only starts the rest (its budget, L0).
  return { plugin, chunkOf: (id) => (closure.has(id) && !entry.test(id.split("\\").join("/")) ? "start" : undefined) };
}
