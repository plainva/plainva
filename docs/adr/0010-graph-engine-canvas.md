# ADR 0010: Custom Canvas 2D Engine for the Graph Views

Status: Accepted (2026-07-05, Graph master plan E6 — internal planning document, maintainer workspace)

## Context

Plainva gets three graph views (context graph in the sidebar, vault map as a tab, `.base` view type "graph"). The choice was between graph libraries as the UI host (sigma.js, Cytoscape.js, react-force-graph) or a custom, narrow Canvas 2D engine with headless d3 helpers.

## Decision

Custom Canvas 2D engine (`apps/desktop/src/components/graph/graphEngine.ts`) following the `editorSession` pattern: ONE scene object per view outside of React, host callbacks via a deps ref updated on every render. Layout runs headless via `d3-force` (with a seeded random source, ticked synchronously, then frozen), `d3-hierarchy` (circle packing for the folder bubbles), and `d3-quadtree` (hit testing). Colors come exclusively from the theme tokens (`services/themeTokens.ts`, a getComputedStyle bridge with MutationObserver invalidation); emphasis runs via `globalAlpha` — no color literals in component code (designLint).

## Rationale

1. **@uiw lesson (editor stability, 2026-07-05):** A third-party wrapper as the render host couples re-render behavior to library internals and produced an entire class of bugs in the editor. The graph engine does not repeat that mistake.
2. **Custom visuals:** Emoji document icons, folder bubbles with counters, chip palette colors, heat halos, and LCARS theming are only reachable in sigma.js/Cytoscape through fragile custom renderers.
3. **Stillness paradigm:** The plan's guardrail "nothing wobbles at rest" requires a layout computed once and then frozen — libraries are built around continuously running simulations.
4. **Determinism:** A seeded LCG as `randomSource` plus synchronous ticks make the layout byte-stable (tests, cross-device recognizability, pins only as an override).

## Rejected Alternatives

- **sigma.js** (WebGL): strong at 50k+ nodes, but custom node renderers in WebGL are costly to build; our semantic zoom keeps the visible node count small by construction, so Canvas 2D is enough.
- **Cytoscape.js**: a rich layout ecosystem, but its own styling system (stylesheets) collides with the token contract; bundle weight.
- **react-force-graph**: a React wrapper — exactly the @uiw pattern we are avoiding.

## Fallback

Should Canvas 2D on WebView2/WebKitGTK not hold up for large vaults (the bar: smooth pan/zoom with a few thousand visible nodes), swapping the renderer behind the `GraphScene` API for sigma.js/WebGL is possible without touching the views — the scene (`SceneNode`/`SceneEdge` in `graphTypes.ts`) is renderer-agnostic.

## Consequences

- New dependencies: `d3-force`, `d3-hierarchy`, `d3-quadtree` (+ @types) — pure algorithms, no UI wrapper.
- `services/themeTokens.ts` is the canonical CSS-variables-in-JS pattern (none existed before).
- Keyboard navigation (arrow keys via an angle heuristic, Enter, the context-menu key) and reduced-motion support are engine responsibilities, not view responsibilities.
