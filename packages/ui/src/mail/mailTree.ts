import type { MarkupReader } from "@plainva/core";

/**
 * How the mail code reads and writes the platform's tree: each of the few
 * things asked of a node is asked through the prototype, never as a property
 * of the node.
 *
 * A node of a parsed document answers to names the MARKUP chose (finding
 * 2026-10-12). `<form><input name="childNodes">` makes `form.childNodes` that
 * input, `name="nodeName"` and `name="getAttribute"` do the same for those, and
 * `<img name="body">` is what `document.body` answers where the engine follows
 * the standard. The tree read here has been through the sanitizer, which takes
 * such names out; the accessors from the prototypes are the second lock, and
 * the way the sanitizer reads its own tree.
 */
export interface TreeAccess {
  nodeType(node: Node): number;
  nodeName(node: Node): string;
  childNodes(node: Node): ArrayLike<Node>;
  parentNode(node: Node): Node | null;
  text(node: Node): string;
  attribute(element: Node, name: string): string | null;
  setAttribute(element: Node, name: string, value: string): void;
  removeAttribute(element: Node, name: string): void;
  innerHTML(element: Node): string;
}

/** `undefined` until asked for; `null` where the platform has no DOM to read with. */
let access: TreeAccess | null | undefined;

export function treeAccess(): TreeAccess | null {
  if (access !== undefined) return access;
  access = null;
  if (typeof Document !== "function" || typeof Node !== "function" || typeof Element !== "function" || typeof CharacterData !== "function") return access;
  const getter = (prototype: object, name: string): ((this: unknown) => unknown) | undefined => {
    for (let at: object | null = prototype; at; at = Object.getPrototypeOf(at)) {
      const descriptor = Object.getOwnPropertyDescriptor(at, name);
      if (descriptor) return descriptor.get;
    }
    return undefined;
  };
  const nodeType = getter(Node.prototype, "nodeType");
  const nodeName = getter(Node.prototype, "nodeName");
  const childNodes = getter(Node.prototype, "childNodes");
  const parentNode = getter(Node.prototype, "parentNode");
  const data = getter(CharacterData.prototype, "data");
  const innerHTML = getter(Element.prototype, "innerHTML");
  const { getAttribute, setAttribute, removeAttribute } = Element.prototype;
  if (!nodeType || !nodeName || !childNodes || !parentNode || !data || !innerHTML) return access;
  access = {
    nodeType: (node) => Number(nodeType.call(node)),
    nodeName: (node) => String(nodeName.call(node)),
    childNodes: (node) => childNodes.call(node) as ArrayLike<Node>,
    parentNode: (node) => (parentNode.call(node) as Node | null) ?? null,
    text: (node) => String(data.call(node)),
    attribute: (element, name) => getAttribute.call(element as Element, name),
    setAttribute: (element, name, value) => setAttribute.call(element as Element, name, value),
    removeAttribute: (element, name) => removeAttribute.call(element as Element, name),
    innerHTML: (element) => String(innerHTML.call(element)),
  };
  return access;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** The walk's reader over the platform's tree (`visibleDocumentOf`); `heldBack` names the images whose picture was held back. */
export function domReader(read: TreeAccess, heldBack: WeakSet<Node>): MarkupReader<Node> {
  return {
    kind: (node) => {
      const type = read.nodeType(node);
      if (type === TEXT_NODE) return "#text";
      return type === ELEMENT_NODE ? read.nodeName(node).toLowerCase() : "";
    },
    children: (node) => read.childNodes(node),
    text: (node) => read.text(node),
    // A picture held back has no address in the view the assistant reads.
    attribute: (node, name) => (name === "src" && heldBack.has(node) ? null : read.attribute(node, name)),
    heldBack: (node) => heldBack.has(node),
  };
}
