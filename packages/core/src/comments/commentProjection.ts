import type { WorkspaceCommentRecord } from "../workspace/state.js";
import { legacySuggestionDecision, resolveSuggestionDecisions, type SuggestionDecisionFact } from "./commentDecisions.js";

/**
 * Project immutable records into visible cards. Both stores and the outbox
 * use the same decisions; input records are never changed or re-signed.
 */
export function projectCommentRecords(
  records: readonly WorkspaceCommentRecord[],
  retractionIdentity: "member" | "device" = "member",
): WorkspaceCommentRecord[] {
  const byId = new Map(records.map((record) => [record.commentId, record]));
  const resolutions = new Map<string, WorkspaceCommentRecord[]>();
  const children = new Map<string, string[]>();
  const retracted = new Set(records.filter((record) => record.retractedAt).map((record) => record.commentId));
  for (const record of records) {
    if (record.parentCommentId && byId.get(record.parentCommentId)?.targetObjectId === record.targetObjectId) {
      const list = children.get(record.parentCommentId) ?? [];
      list.push(record.commentId); children.set(record.parentCommentId, list);
    }
    if (record.resolvedCommentId) {
      const target = byId.get(record.resolvedCommentId);
      if (target?.targetObjectId !== record.targetObjectId) continue;
      const list = resolutions.get(record.resolvedCommentId) ?? [];
      list.push(record); resolutions.set(record.resolvedCommentId, list);
    }
    if (record.retractsCommentId) {
      const target = byId.get(record.retractsCommentId);
      if (!target || target.targetObjectId !== record.targetObjectId) continue;
      const sameAuthor = retractionIdentity === "device" ? target.authorDeviceId === record.authorDeviceId
        : target.authorMemberId === record.authorMemberId;
      if (sameAuthor) retracted.add(target.commentId);
    }
  }
  // A removed thread must not leave its replies visible as orphaned roots.
  const pending = [...retracted];
  while (pending.length) for (const child of children.get(pending.pop()!) ?? []) {
    if (!retracted.has(child)) { retracted.add(child); pending.push(child); }
  }

  return records.filter((record) => !record.resolvedCommentId && !record.retractsCommentId && !retracted.has(record.commentId))
    .map((record): WorkspaceCommentRecord => {
      const markers = resolutions.get(record.commentId) ?? [];
      const closeTimes = [record.resolvedAt, ...markers.map((marker) => marker.createdAt)].filter((at): at is string => !!at).sort();
      const resolvedAt = closeTimes[closeTimes.length - 1] ?? null;
      if (!record.suggestion) return { ...record, resolvedAt };
      const facts: SuggestionDecisionFact[] = markers.filter((marker) => marker.suggestionOutcome)
        .map((marker) => ({ id: marker.commentId, outcome: marker.suggestionOutcome!, createdAt: marker.createdAt,
          by: marker.authorMemberId, ...(marker.decisionProof ? { proof: marker.decisionProof } : {}) }));
      const previous = record.suggestion;
      const addLegacy = (outcome: "applied" | "declined", at: string | null, by: string | null) => {
        if (!at || facts.some((fact) => fact.outcome === outcome && fact.createdAt === at && (!by || by === fact.by))) return;
        facts.push(legacySuggestionDecision(record.commentId, outcome, at, by ?? ""));
      };
      addLegacy("applied", previous.appliedAt, previous.appliedBy);
      addLegacy("declined", previous.declinedAt, null);
      if (facts.length === 0) return { ...record, resolvedAt };
      const decision = resolveSuggestionDecisions(facts);
      // Old databases retain IDs even where an outcome needs verified recovery.
      // A deliberate review can name these observed facts before recovery;
      // a marker with a genuinely unknown ID still remains independent.
      decision.knownIds = [...new Set([...decision.knownIds, ...markers.map((marker) => marker.commentId)])].sort();
      const chosen = [...decision.decisions].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
      return { ...record, suggestionDecision: decision,
        resolvedAt: decision.status === "conflict" ? null : chosen?.createdAt ?? resolvedAt,
        suggestion: { replacement: previous.replacement,
          appliedAt: decision.status === "applied" ? chosen.createdAt : null,
          appliedBy: decision.status === "applied" ? chosen.by || null : null,
          declinedAt: decision.status === "declined" ? chosen.createdAt : null,
        },
      };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.commentId.localeCompare(b.commentId));
}
