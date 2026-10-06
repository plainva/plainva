import { canonicalJson } from "../../settingsSync/canonicalJson.js";
import { payload, type TrustedPayload } from "../trust.js";
import { capMcpText } from "./listing.js";

/**
 * What a foreign tool returned, as the conversation may see it (plan §17.2:
 * "tool results pass the tier 3 wrap"). A result is the other place a server
 * speaks to the model ("puppet attack"): text that reads like a system
 * message, a link that asks to be opened, an image with writing in it.
 *
 * So a result becomes ONE text of bounded length, tier 3, with the server and
 * the tool as its origin; the prompt renders it inside an untrusted-data
 * block like any note. Text and embedded text resources are kept; links are
 * kept as inert lines; images, audio and anything unknown are counted and left
 * out (reading text in images is a separate, later decision).
 */

export const MCP_RESULT_LIMIT = 20_000;

export interface McpResultView {
  payload: TrustedPayload<string>;
  /** The server marked the result as an error. */
  isError: boolean;
  truncated: boolean;
  /** Content blocks left out, by kind. */
  dropped: { images: number; audio: number; other: number };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function mcpResultView(serverId: string, toolName: string, result: unknown): McpResultView {
  const record = isRecord(result) ? result : {};
  const dropped = { images: 0, audio: 0, other: 0 };
  const parts: string[] = [];
  for (const block of Array.isArray(record.content) ? record.content : []) {
    if (!isRecord(block)) {
      dropped.other++;
    } else if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "resource" && isRecord(block.resource) && typeof block.resource.text === "string") {
      parts.push(block.resource.text);
    } else if (block.type === "resource_link" && typeof block.uri === "string") {
      parts.push(`resource: ${block.uri}`);
    } else if (block.type === "image") {
      dropped.images++;
    } else if (block.type === "audio") {
      dropped.audio++;
    } else {
      dropped.other++;
    }
  }
  if (parts.length === 0 && record.structuredContent !== undefined) {
    try {
      parts.push(canonicalJson(record.structuredContent));
    } catch {
      dropped.other++;
    }
  }
  const capped = capMcpText(parts.join("\n\n"), MCP_RESULT_LIMIT);
  return {
    payload: payload(capped.text, { kind: "tool", tool: toolName, server: serverId }),
    isError: record.isError === true,
    truncated: capped.truncated,
    dropped,
  };
}
