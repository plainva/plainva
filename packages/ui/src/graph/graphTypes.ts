/**
 * Rendering-agnostic scene model shared by all graph views (context graph,
 * vault map, base graph view). The views translate GraphService data into
 * SceneNode/SceneEdge; the canvas engine only knows this vocabulary.
 */

export type SceneNodeShape = "note" | "folder" | "attachment";

export type SceneEdgeStyle = "link" | "embed" | "property" | "structure" | "suggestion";

export interface SceneNode {
  id: string;
  label: string;
  shape: SceneNodeShape;
  /** Base radius in world units (scaled by the view transform). */
  size: number;
  /** Emoji document icon, drawn inside the node when zoomed in. */
  icon?: string;
  /** Index into the theme chip palette (0..7); null = neutral. */
  colorToken?: number | null;
  /** Explicit color override (e.g. a note's own icon tint), wins over colorToken. */
  color?: string;
  x: number;
  y: number;
  pinned?: boolean;
  /** 0..1 recency heat for the heatmap overlay; null = no heat data. */
  heat?: number | null;
  /** Search/filter miss: rendered at low alpha, still hit-testable. */
  dimmed?: boolean;
  /** Replay overlay: not drawn and not hit-testable, layout keeps its slot. */
  hidden?: boolean;
  /** Cleanup overlay accent ring. */
  flag?: "orphan" | "broken" | null;
  /** Folder bubbles: number badge (note count). */
  badge?: number;
  /**
   * Unfolded folder rendered as a translucent container circle that encloses
   * its children (vault map recursive packing). Containers paint behind the
   * edges, only their RIM is hit-testable, and dragging one moves its content.
   */
  container?: boolean;
  /** Id of the enclosing container node, if any (drag-group membership). */
  parent?: string;
}

export interface SceneEdge {
  id: string;
  source: string;
  target: string;
  style: SceneEdgeStyle;
  /** Property name for style "property"; shown at close zoom / on hover. */
  label?: string;
  /** Bundle width, 1..n parallel links. */
  width: number;
  dimmed?: boolean;
  hidden?: boolean;
}

export interface SceneTransform {
  x: number;
  y: number;
  k: number;
}

export interface NodePointerEvent {
  ctrl: boolean;
  shift: boolean;
  middle: boolean;
  clientX: number;
  clientY: number;
}
