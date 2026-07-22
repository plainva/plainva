export type WorkspaceProtocolErrorCode =
  | "bounds"
  | "canonical"
  | "conflict"
  | "crypto"
  | "format"
  | "integrity"
  | "unsupported";

/** A deliberately value-free protocol error safe to surface in diagnostics. */
export class WorkspaceProtocolError extends Error {
  constructor(
    public readonly code: WorkspaceProtocolErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "WorkspaceProtocolError";
  }
}

export class ImmutableObjectConflictError extends WorkspaceProtocolError {
  constructor() {
    super("conflict", "immutable workspace object already exists with different bytes");
    this.name = "ImmutableObjectConflictError";
  }
}

export function protocolAssert(
  condition: unknown,
  code: WorkspaceProtocolErrorCode,
  message: string
): asserts condition {
  if (!condition) throw new WorkspaceProtocolError(code, message);
}
