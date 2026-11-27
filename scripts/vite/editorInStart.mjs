/**
 * The desktop's editor is part of its start, as the phone's is (maintainer's decision, 2026-11-27, package B1b): the
 * last open note is shown at the start, and it is editable no later than before. The editor's vendor chunk (`editor`,
 * CodeMirror and its Markdown grammars) used to reach the start by accident — Vite's preload helper stood in it, and
 * every `import()` of the start imported the chunk for those few bytes. A change to the build could drop that without
 * a word, and the first editable note would wait for one more request. This names the chunk in `index.html` as a
 * `modulepreload` when the build has not already, so it loads with the start whatever the chunks' graph says. The
 * bundle gate holds it (`mustStart` in `scripts/perf/bundle-baseline.json`), and that no module stands in two chunks.
 *
 * @param {string} chunkName the name of the editor's chunk in `manualChunks`
 */
export function editorInStart(chunkName) {
  return {
    name: "plainva-editor-in-start",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const chunk = Object.values(ctx.bundle ?? {}).find((file) => file.type === "chunk" && file.name === chunkName);
        if (!chunk) throw new Error(`editorInStart: the build has no chunk "${chunkName}"`);
        const href = `/${chunk.fileName}`;
        if (html.includes(`href="${href}"`)) return html;
        return html.replace("</head>", `  <link rel="modulepreload" crossorigin href="${href}">\n</head>`);
      },
    },
  };
}
