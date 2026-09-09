import { createWorkspaceObjectId } from "../workspace/identity.js";
import { canonicalJson } from "../settingsSync/canonicalJson.js";

/** Kept in a durable operation so a retry writes the same immutable record. */
export interface CommentWriteIdentity {
  commentId: string;
  createdAt: string;
}

export function commentWriteIdentity(identity?: CommentWriteIdentity, now = new Date().toISOString()): CommentWriteIdentity {
  if (!identity) return { commentId: createWorkspaceObjectId(), createdAt: now };
  if (!/^[a-f0-9]{32}$/.test(identity.commentId) || !Number.isFinite(Date.parse(identity.createdAt))
    || new Date(identity.createdAt).toISOString() !== identity.createdAt) throw new Error("Invalid durable comment identity");
  return { ...identity };
}

export class CommentIdentityConflictError extends Error {
  constructor(readonly commentId: string) {
    super("A different comment already uses this operation identity");
    this.name = "CommentIdentityConflictError";
  }
}

/** Optional fields added by later versions have the same absent/null meaning. */
export function sameCommentContent(left: unknown, right: unknown): boolean {
  function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .filter(([, field]) => field !== null && field !== undefined).map(([key, field]) => [key, normalize(field)]));
    return value;
  }
  return canonicalJson(normalize(left)) === canonicalJson(normalize(right));
}
