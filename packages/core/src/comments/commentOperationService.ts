import { CommentOperationRunner, prepareCommentOperation, type CommentOperation, type CommentOperationDeps, type CommentOperationMarker } from "./commentOperations.js";
import type { CommentPostInput } from "./store.js";

export interface CommentOperationInput {
  notePath: string;
  kind: CommentOperation["kind"];
  text?: CommentOperation["text"];
  markers: Array<CommentPostInput & Pick<CommentOperationMarker, "reviewedDecisionIds">>;
}
/** The same API is implemented by the vault owner and its window client. */
export interface CommentOperationService {
  prepare(input: CommentOperationInput): Promise<CommentOperation>;
  run(operation: CommentOperation): Promise<CommentOperation>;
  pending(path?: string): Promise<CommentOperation[]>;
  read(operationId: string): Promise<CommentOperation | null>;
}
export interface CommentOperationServiceDeps extends CommentOperationDeps {
  /** Name prompt and stable target binding, before any journal or note write. */
  prepareMarkers?(input: CommentOperationInput): Promise<CommentOperationInput["markers"]>;
  /** Resolve renames by workspace object ID or the bundle's move history. */
  resolvePath(operation: CommentOperation): Promise<string>;
}

/** Shell-neutral recovery API; the shell still owns its physical write lane. */
export function createCommentOperationService(deps: CommentOperationServiceDeps): CommentOperationService {
  return {
    async prepare(input) {
      const captured = structuredClone(input);
      const authorKey = await deps.authorKey();
      const markers = deps.prepareMarkers ? await deps.prepareMarkers(captured) : captured.markers;
      if (await deps.authorKey() !== authorKey) throw new Error("The comment writer changed while preparing the operation");
      return prepareCommentOperation({ ...captured, markers, contextKey: deps.contextKey, authorKey, now: deps.now?.() });
    },
    async run(operation) {
      const captured = structuredClone(operation);
      let physicalPath = captured.notePath;
      // Resolve inside the runner, after its prepared journal is durable.
      // Recheck after acquiring the actual note's lane, so a rename while
      // waiting never makes a write target a newly reused old pathname.
      const runner = new CommentOperationRunner({ ...deps,
        withNoteLock: async (_path, work) => {
          physicalPath = await deps.resolvePath(captured);
          await deps.withNoteLock(physicalPath, async () => {
            if (await deps.resolvePath(captured) !== physicalPath) throw new Error("The comment target moved while waiting for its write lane");
            await work();
          });
        },
        readText: () => deps.readText(physicalPath),
        writeText: (_path, text) => deps.writeText(physicalPath, text),
      });
      return runner.run(captured);
    },
    async pending(path) {
      const operations = await new CommentOperationRunner(deps).pending();
      if (path === undefined) return operations;
      const matching: CommentOperation[] = [];
      for (const operation of operations) {
        if (await deps.resolvePath(operation) === path) matching.push(operation);
      }
      return matching;
    },
    async read(operationId) {
      const operation = await deps.journal.read(operationId);
      if (operation && operation.contextKey !== deps.contextKey) throw new Error("The comment operation belongs to another vault");
      return operation;
    },
  };
}
