import ts from "typescript";

/**
 * How a value is used at each place a source file mentions it.
 *
 * For the guards of both shells that list who may reach the storage BELOW a
 * vault's adapter chain (`rawVaultAdapter.test.ts`, finding 2026-10-09). A
 * text search finds the mentions; what decides whether one of them is a write
 * past the chain is what is done with the value there — a method called on
 * it, a function it is handed to, a name it is kept under. That is read from
 * the syntax tree, so a call spread over several lines says the same as one
 * on a single line:
 *
 *   calls writeTextFile            · a method called on the value
 *   reads sandboxRoot              · a property read from it
 *   handed to listTemplates        · an argument of a call
 *   handed to scaffold as adapter  · a property of an object that is one
 *   handed to <Dialog> as raw      · a JSX attribute
 *   kept as raw                    · a variable, or a plain assignment
 *   taken from useVault()          · a name destructured from a value
 *   taken from a parameter         · …or from a parameter
 *   builds CapacitorVaultAdapter   · a `new` of a class named as a mention
 *   asked whether it is there      · a condition
 *   listed as a dependency         · the dependency array of a hook
 *
 * `a ?? b`, `a || b`, `c && a` and `c ? a : b` count as the value they stand
 * for, once: all four are ways to write "this one, or that one".
 *
 * A name the value is kept under stands for the value from there on — a
 * variable it is kept as, a name destructured from its owner. What is done
 * with the name is listed like what is done with the value itself, so a write
 * through the name shows as a write. (Only the keeping used to be listed, and
 * a write through the name went unseen: the phone's key file is written that
 * way.) A pattern that takes the value itself apart (`const { writeTextFile }
 * = vault.adapter`) is listed as kept and not followed.
 */
export type Mention = (node: ts.Node, source: ts.SourceFile) => boolean;

export interface ValueUse {
  use: string;
  /** 1-based line of the mention. */
  line: number;
}

/** A property read by one of these names: `vault.adapter`, `state.backupAdapter`. */
export const propertyNamed = (...names: string[]): Mention => (node) =>
  (ts.isPropertyAccessExpression(node) && names.includes(node.name.text)) ||
  (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && names.includes(node.argumentExpression.text));

/**
 * One of these names destructured from a value: `const { backupAdapter } =
 * useVault()` — or from a parameter whose type is named by `owner`
 * (`({ adapter }: MobileVault) => …`), or that carries no type at all
 * (`.then(({ adapter }) => …)`): what such a callback is handed cannot be read
 * from the syntax, so the name counts until a type says otherwise. A parameter
 * of any other type that happens to carry the name is only a name: what it is
 * handed shows where it is handed over.
 */
export const destructuredAs = (owner: RegExp, ...names: string[]): Mention => (node, source) => {
  if (!ts.isBindingElement(node) || !names.includes((node.propertyName ?? node.name).getText(source))) return false;
  const from = node.parent.parent;
  return ts.isVariableDeclaration(from) || (ts.isParameter(from) && (!from.type || owner.test(from.type.getText(source))));
};

/** Whether an identifier stands for the variable of its name — not for a declaration of one, and not for the name of a property. */
const refersToVariable = (node: ts.Identifier): boolean => {
  const p = node.parent;
  if (ts.isPropertyAccessExpression(p)) return p.expression === node;
  if (ts.isPropertyAssignment(p)) return p.initializer === node;
  // `const kept = name` uses the variable; `const name = …` declares one.
  if (ts.isVariableDeclaration(p)) return p.initializer === node;
  return !(ts.isBindingElement(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isJsxAttribute(p) || ts.isParameter(p));
};

/** A plain reference to a variable of one of these names. */
export const variableNamed = (...names: string[]): Mention => (node) => ts.isIdentifier(node) && names.includes(node.text) && refersToVariable(node);

/** `new` of one of these classes. */
export const built = (...classes: string[]): Mention => (node, source) => ts.isNewExpression(node) && classes.includes(node.expression.getText(source));

export const anyOf = (...mentions: Mention[]): Mention => (node, source) => mentions.some((mention) => mention(node, source));

export function valueUses(file: string, text: string, mentions: Mention): ValueUse[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const calleeOf = (call: ts.CallExpression | ts.NewExpression) => (ts.isNewExpression(call) ? `new ${call.expression.getText(source)}` : call.expression.getText(source));
  const isCall = (node: ts.Node): node is ts.CallExpression | ts.NewExpression => ts.isCallExpression(node) || ts.isNewExpression(node);
  const unwrapped = (node: ts.Node): ts.Node => {
    let inner = node;
    while (ts.isParenthesizedExpression(inner) || ts.isNonNullExpression(inner) || ts.isAsExpression(inner)) inner = inner.expression;
    return inner;
  };

  /** `a ?? b`, `a || b`: this one, or that one. */
  const isEither = (node: ts.Node): node is ts.BinaryExpression =>
    ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken);
  /** The whole value a mention stands for: through brackets, and through `a ?? b`, `a || b`, `c && a` and `c ? a : b`. */
  const wholeValue = (node: ts.Node): ts.Node => {
    let value = node;
    for (;;) {
      const p = value.parent;
      if (ts.isParenthesizedExpression(p) || ts.isNonNullExpression(p) || ts.isAsExpression(p)) value = p;
      else if (isEither(p)) value = p;
      else if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && p.right === value) value = p;
      else if (ts.isConditionalExpression(p) && p.condition !== value) value = p;
      else return value;
    }
  };
  const isAssignedTo = (p: ts.Node, value: ts.Node): p is ts.BinaryExpression =>
    ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right === value;

  const describe = (node: ts.Node): string => {
    if (ts.isNewExpression(node)) return `builds ${node.expression.getText(source)}`;
    if (ts.isBindingElement(node)) {
      const declaration = node.parent.parent;
      if (ts.isParameter(declaration)) return "taken from a parameter";
      const from = ts.isVariableDeclaration(declaration) && declaration.initializer ? declaration.initializer.getText(source).replace(/\s+/g, " ") : "a value";
      return `taken from ${from}`;
    }
    const value = wholeValue(node);
    const p = value.parent;
    if (ts.isPropertyAccessExpression(p) && p.expression === value) {
      const called = ts.isCallExpression(p.parent) && p.parent.expression === p;
      return `${called ? "calls" : "reads"} ${p.name.text}`;
    }
    if (isCall(p) && p.arguments?.some((argument) => argument === value)) return `handed to ${calleeOf(p)}`;
    if ((ts.isPropertyAssignment(p) && p.initializer === value) || ts.isShorthandPropertyAssignment(p)) {
      const object = p.parent, owner = object.parent;
      const name = p.name.getText(source);
      return isCall(owner) && owner.arguments?.some((argument) => argument === object) ? `handed to ${calleeOf(owner)} as ${name}` : `put into an object as ${name}`;
    }
    if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) {
      const element = p.parent.parent.parent;
      return `handed to <${element.tagName.getText(source)}> as ${p.parent.name.getText(source)}`;
    }
    if (ts.isVariableDeclaration(p) && p.initializer === value) return `kept as ${p.name.getText(source)}`;
    if (isAssignedTo(p, value)) return `kept as ${p.left.getText(source)}`;
    if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) return "asked whether it is there";
    // What is left of `&&` here is its left side: `adapter && adapter.exists(p)`.
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return "asked whether it is there";
    if (ts.isIfStatement(p) || (ts.isConditionalExpression(p) && p.condition === value)) return "asked whether it is there";
    if (ts.isArrayLiteralExpression(p) && ts.isCallExpression(p.parent) && /^use[A-Z]/.test(p.parent.expression.getText(source))) return "listed as a dependency";
    if (ts.isReturnStatement(p) || ts.isArrowFunction(p)) return "returned";
    return `used in ${ts.SyntaxKind[p.kind]}`;
  };

  /** The right side of `a ?? b` or `a || b` where `a` is a mention too: counted with `a`. */
  const countedWithLeft = (node: ts.Node) => {
    const p = node.parent;
    return isEither(p) && p.right === node && mentions(unwrapped(p.left), source);
  };

  // ── A name the value is kept under ─────────────────────────────────────────

  interface Kept { name: string; scope: ts.Node; from: number }
  const bindsName = (binding: ts.BindingName, name: string): boolean =>
    ts.isIdentifier(binding) ? binding.text === name : binding.elements.some((element) => !ts.isOmittedExpression(element) && bindsName(element.name, name));
  /** Where a `const`/`let` of this declaration is known: the block around it. */
  const blockOf = (node: ts.Node): ts.Node => {
    let scope = node.parent;
    while (!(ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope) || ts.isCaseClause(scope) || ts.isDefaultClause(scope)
      || ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope) || ts.isFunctionLike(scope))) scope = scope.parent;
    return scope;
  };
  const functionOf = (node: ts.Node): ts.Node => {
    let scope = node.parent;
    while (!(ts.isSourceFile(scope) || ts.isFunctionLike(scope))) scope = scope.parent;
    return scope;
  };
  /** The name a mention puts the value under, and the stretch of the file in which that name means it. */
  const keptAs = (node: ts.Node): Kept | null => {
    if (ts.isNewExpression(node)) return null;
    if (ts.isBindingElement(node)) {
      if (!ts.isIdentifier(node.name)) return null;
      const declaration = node.parent.parent;
      return { name: node.name.text, scope: ts.isParameter(declaration) ? declaration.parent : blockOf(declaration), from: node.end };
    }
    const value = wholeValue(node);
    const p = value.parent;
    if (ts.isVariableDeclaration(p) && p.initializer === value && ts.isIdentifier(p.name)) return { name: p.name.text, scope: blockOf(p), from: p.end };
    if (isAssignedTo(p, value) && ts.isIdentifier(p.left)) return { name: p.left.text, scope: functionOf(p), from: p.end };
    return null;
  };
  /** A part of the stretch that has a variable of the same name of its own: the name means something else in there. */
  const hasItsOwn = (node: ts.Node, name: string): boolean => {
    if (ts.isFunctionLike(node)) return node.parameters.some((parameter) => bindsName(parameter.name, name));
    if (ts.isCatchClause(node)) return !!node.variableDeclaration && bindsName(node.variableDeclaration.name, name);
    if (ts.isBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      return node.statements.some((statement) => ts.isVariableStatement(statement) && statement.declarationList.declarations.some((d) => bindsName(d.name, name)));
    }
    return false;
  };

  const uses: ValueUse[] = [];
  const seen = new Set<ts.Node>();
  const record = (node: ts.Node): void => {
    if (seen.has(node)) return;
    seen.add(node);
    uses.push({ use: describe(node), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    const kept = keptAs(node);
    if (kept) follow(kept);
  };
  /** Every use of a kept name is a use of the value. */
  function follow(kept: Kept): void {
    (function visit(node: ts.Node) {
      if (node !== kept.scope && hasItsOwn(node, kept.name)) return;
      // What `mentions` finds by itself is recorded by the walk over the file.
      if (ts.isIdentifier(node) && node.text === kept.name && node.getStart(source) >= kept.from && refersToVariable(node) && !mentions(node, source) && !countedWithLeft(node)) record(node);
      ts.forEachChild(node, visit);
    })(kept.scope);
  }

  (function visit(node: ts.Node) {
    if (mentions(node, source) && !countedWithLeft(node)) record(node);
    ts.forEachChild(node, visit);
  })(source);
  return uses;
}

/** What a vault adapter is asked without changing anything. */
const ADAPTER_READS = new Set(["readTextFile", "readBinaryFile", "exists", "getFileInfo", "listDir", "listDirReport", "listDirForBackup", "realPath", "sandboxRoot", "accessState", "refreshAccess"]);

/** A use of a vault adapter that changes nothing: a read, the question whether it is there, a hook's dependency. */
export const adapterRead = (use: string): boolean =>
  use === "asked whether it is there" || use === "listed as a dependency" || ADAPTER_READS.has(use.replace(/^(calls|reads) /, ""));

/** A method called on a vault adapter that changes a file. */
export const ADAPTER_WRITE = /^calls (writeTextFile|updateTextFile|writeEditorText|writeBinaryFile|deleteItem|renameItem|createDir|setFileTimes)$/;

/** The uses of a file that a guard's list has to name: counted by what they are, with the lines they stand on. */
export function countUses(uses: readonly ValueUse[], free: (use: string) => boolean): Map<string, number[]> {
  const counted = new Map<string, number[]>();
  for (const { use, line } of uses) if (!free(use)) counted.set(use, [...(counted.get(use) ?? []), line]);
  return counted;
}
