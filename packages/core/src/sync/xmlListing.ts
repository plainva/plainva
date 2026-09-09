import { XMLParser, XMLValidator } from "fast-xml-parser";

/** A successful listing must carry the expected document, not just valid XML. */
export function parseListingRoot(xml: string, rootName: string, arrayTags: readonly string[] = []): Record<string, any> {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new Error(`invalid XML (line ${valid.err.line}): ${valid.err.msg}`);
  const doc = new XMLParser({
    ignoreAttributes: true,
    ignoreDeclaration: true,
    removeNSPrefix: true,
    parseTagValue: false,
    isArray: (name) => arrayTags.includes(name),
  }).parse(xml);
  const names = Object.keys(doc ?? {}).filter((name) => !name.startsWith("?"));
  if (names.length !== 1 || names[0] !== rootName) throw new Error(`invalid listing: expected ${rootName}`);
  const root = doc[rootName];
  // A self-closing root is a genuine empty listing; an arbitrary text body is not.
  if (root === "") return {};
  if (!root || typeof root !== "object" || Array.isArray(root) || root["#text"]?.trim()) {
    throw new Error(`invalid listing: malformed ${rootName}`);
  }
  return root;
}

/** Shared validation for full DAV listings and incremental calendar reports. */
export function parseDavListing(xml: string, extraArrays: readonly string[] = []): Record<string, any> {
  const root = parseListingRoot(xml, "multistatus", ["response", "propstat", ...extraArrays]);
  if (!root.response && Object.keys(root).some((name) => name !== "sync-token" && name !== "responsedescription")) {
    throw new Error("invalid listing: multistatus contains no DAV responses");
  }
  for (const response of root.response ?? []) {
    if (!response || typeof response !== "object" || typeof response.href !== "string" || !response.href.trim()) {
      throw new Error("invalid listing: DAV response has no href");
    }
  }
  return root;
}
