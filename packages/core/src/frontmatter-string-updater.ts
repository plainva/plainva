import { parseDocument, Document, YAMLMap } from "yaml";

/**
 * Updates the frontmatter YAML block in a markdown string, preserving
 * the exact byte-for-byte contents of the markdown body and attempting
 * to preserve YAML comments and formatting.
 * 
 * If frontmatter does not exist, it will be injected at the top.
 */
export function updateFrontmatterString(content: string, newProps: Record<string, any>): string {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
  const match = content.match(frontmatterRegex);

  let doc: Document;
  let bodyStart = 0;

  if (match) {
    const yamlString = match[1];
    doc = parseDocument(yamlString);
    bodyStart = match[0].length;
  } else {
    doc = new Document({});
  }

  // Ensure it's a map
  if (!doc.contents) {
    doc.contents = doc.createNode({});
  }

  if (doc.contents instanceof YAMLMap) {
    // 1. Delete keys that are not in newProps
    const existingKeys = doc.contents.items.map(item => (item.key as any)?.value);
    for (const key of existingKeys) {
      if (typeof key === "string" && !(key in newProps)) {
        doc.delete(key);
      }
    }

    // 2. Add or update keys from newProps
    for (const [key, value] of Object.entries(newProps)) {
      doc.set(key, value);
    }
  }

  let newYamlString = doc.toString().trim();
  
  let body = content.slice(bodyStart);
  if (!body) {
    body = "\n";
  }

  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  newYamlString = newYamlString.replace(/\r?\n/g, eol);
  
  // Make sure body starts cleanly if we injected at the top
  if (!match && !body.startsWith(eol)) {
     // If the body doesn't start with newline but we are inserting frontmatter, 
     // the original code just did `\n${body}`, let's keep it safe.
  }

  if (newYamlString === "{}" || newYamlString === "") {
    // If the frontmatter is completely empty after deletion
    return `---${eol}---${eol}${body}`;
  }

  return `---${eol}${newYamlString}${eol}---${eol}${body}`;
}
