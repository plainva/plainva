import { describe, expect, it } from "vitest";
import {
  checkMcpElicitAnswer,
  mcpElicitCapabilities,
  mcpElicitDefaults,
  mcpElicitOutcome,
  mcpElicitReply,
  mcpOnDeviceHost,
  namesSecret,
  parseMcpNumber,
  readMcpElicitation,
  MCP_ELICIT_LIMITS,
  type McpElicitation,
} from "./elicitation.js";

const ZW = String.fromCharCode(0x200b);
const BIDI = String.fromCharCode(0x202e);

const form = (properties: Record<string, unknown>, extra: Record<string, unknown> = {}, message = "Which project?") => ({ mode: "form", message, requestedSchema: { type: "object", properties, ...extra } });
const asForm = (question: McpElicitation) => {
  if (question.kind !== "form") throw new Error(`not a form: ${JSON.stringify(question)}`);
  return question;
};

describe("a question as Plainva shows it", () => {
  it("reads every kind of field the protocol allows, with the server's words cleaned and cut", () => {
    const question = asForm(
      readMcpElicitation(
        form(
          {
            project: { type: "string", title: `Pro${ZW}ject`, oneOf: [{ const: "hk", title: "Hafenkante" }, { const: "ws", title: "Werkstatt" }], default: "hk" },
            closed: { type: "boolean", title: "Also closed issues", default: true },
            since: { type: "string", format: "date", title: "Since" },
            mail: { type: "string", format: "email" },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
            share: { type: "number", minimum: 0, maximum: 1 },
            labels: { type: "array", items: { anyOf: [{ const: "bug", title: "Bug" }, { const: "ux", title: "UX" }] }, minItems: 1, maxItems: 2, default: ["bug"] },
            tone: { type: "string", enum: ["calm", "bold"], enumNames: ["Calm", "Bold"] },
            note: { type: "string", description: `A ${BIDI}longer text\n\nthat wraps.`, minLength: 2, maxLength: 80 },
          },
          { required: ["project", "note", "ghost"] },
        ),
      ),
    );
    expect(question.message).toBe("Which project?");
    expect(question.fields.map((field) => [field.name, field.kind, field.required])).toEqual([
      ["project", "choice", true],
      ["closed", "boolean", false],
      ["since", "text", false],
      ["mail", "text", false],
      ["limit", "number", false],
      ["share", "number", false],
      ["labels", "choices", false],
      ["tone", "choice", false],
      ["note", "text", true],
    ]);
    const [project, , since, mail, limit, , labels, tone, note] = question.fields;
    expect(project).toMatchObject({ title: "Project", choices: [{ value: "hk", label: "Hafenkante" }, { value: "ws", label: "Werkstatt" }], default: "hk" });
    expect(since).toMatchObject({ format: "date", title: "Since" });
    // A field without a title is named by its key.
    expect(mail).toMatchObject({ format: "email", title: "mail" });
    expect(limit).toMatchObject({ integer: true, minimum: 1, maximum: 50, default: 10 });
    expect(labels).toMatchObject({ minItems: 1, maxItems: 2, default: ["bug"] });
    expect(tone).toMatchObject({ choices: [{ value: "calm", label: "Calm" }, { value: "bold", label: "Bold" }] });
    // Invisible characters out, white space folded: what a person reads is what is there.
    expect(note).toMatchObject({ description: "A longer text that wraps.", minLength: 2, maxLength: 80 });
    expect(mcpElicitDefaults(question)).toEqual({ project: "hk", closed: true, limit: 10, labels: ["bug"] });
  });

  it("asks to confirm where a form has no field", () => {
    expect(readMcpElicitation(form({}, {}, "Delete the three closed issues?"))).toEqual({ kind: "form", message: "Delete the three closed issues?", fields: [] });
    expect(readMcpElicitation({ message: "Go on?", requestedSchema: { type: "object" } })).toEqual({ kind: "form", message: "Go on?", fields: [] });
    const confirm = asForm(readMcpElicitation(form({})));
    expect(mcpElicitReply(confirm, { action: "accept", content: { extra: 1 } })).toEqual({ action: "accept", content: {} });
  });

  it("keeps only defaults that would pass as an answer", () => {
    const question = asForm(
      readMcpElicitation(
        form({
          since: { type: "string", format: "date", default: "2026-02-30" },
          at: { type: "string", format: "date-time", default: "2026-10-25" },
          when: { type: "string", format: "date-time", default: "2026-10-25T14:30:00Z" },
          limit: { type: "integer", minimum: 1, maximum: 5, default: 9 },
          ratio: { type: "integer", default: 2.5 },
        }),
      ),
    );
    expect(mcpElicitDefaults(question)).toEqual({ when: "2026-10-25T14:30:00.000Z" });
  });

  it("cuts what a server writes to what a card can hold — never inside a character", () => {
    const question = asForm(readMcpElicitation({ message: "m".repeat(5_000), requestedSchema: { type: "object", properties: { a: { type: "string", title: "t".repeat(500), description: "d".repeat(5_000) } } } }));
    expect(question.message).toHaveLength(MCP_ELICIT_LIMITS.message);
    expect(question.message.endsWith("…")).toBe(true);
    expect(question.fields[0]!.title).toHaveLength(MCP_ELICIT_LIMITS.title);
    expect(question.fields[0]!.description).toHaveLength(MCP_ELICIT_LIMITS.description);
    const emoji = String.fromCodePoint(0x1f600);
    const cut = asForm(readMcpElicitation({ message: emoji.repeat(2_000), requestedSchema: { type: "object" } })).message;
    expect(Array.from(cut)).toHaveLength(MCP_ELICIT_LIMITS.message);
    expect(cut.slice(0, -1).split(emoji).join("")).toBe("");
  });

  it("shows no form it cannot show as asked", () => {
    const shapes: unknown[] = [
      null,
      "text",
      { message: "x" },
      { mode: "audio", message: "x" },
      form({ address: { type: "object", properties: { street: { type: "string" } } } }),
      form({ when: { type: "string", format: "time" } }),
      form({ many: { type: "array", items: { type: "string" } } }),
      form({ mixed: { type: "string", enum: ["a", 2] } }),
      form({ odd: { type: "null" } }),
      form(Object.fromEntries(Array.from({ length: MCP_ELICIT_LIMITS.fields + 1 }, (_, i) => [`f${i}`, { type: "string" }]))),
      { mode: "form", message: "x", requestedSchema: { type: "array" } },
      { mode: "form", message: "x", requestedSchema: { type: "object", properties: "all" } },
      // Choices that could not be shown as asked: too many, a value twice, an empty value, a label that is nothing once cleaned.
      form({ pick: { type: "string", enum: Array.from({ length: MCP_ELICIT_LIMITS.choices + 1 }, (_, i) => `v${i}`) } }),
      form({ pick: { type: "string", enum: ["a", "a"] } }),
      form({ pick: { type: "string", enum: ["a", " "] } }),
      form({ pick: { type: "string", oneOf: [{ const: ZW, title: BIDI }] } }),
      // A name every object has already would not be the field's own in an answer.
      form({ constructor: { type: "string" } }),
      form({ toString: { type: "boolean" } }),
      { mode: "form", message: "x", requestedSchema: JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}') },
    ];
    for (const params of shapes) expect(readMcpElicitation(params).kind, JSON.stringify(params)).toBe("refused");
    expect(readMcpElicitation({ mode: "url", message: "Open it", url: "https://example.com/a" }, { modes: ["form"] })).toMatchObject({ kind: "refused", reason: "shape", message: "Open it" });
    expect(readMcpElicitation(form({ a: { type: "string" } }), { modes: ["url"] })).toMatchObject({ kind: "refused", reason: "shape" });
  });
});

describe("no question for a secret", () => {
  it("names a secret by whole words — split where they are written together, in the app's languages", () => {
    for (const text of ["Password", "GitHub API key", "API-Schlüssel für GitHub", "your_api_key", "Mot de passe", "Contraseña", "Hasło", "Wachtwoord", "IBAN", "Card number", "Seed phrase", "パスワードを入力", "请输入密码", "GitHubのAPIキー", "userPassword", "cardNumber", "privateKey", "APIKey", "Ｐａｓｓｗｏｒｄ", "Contraseña"]) {
      expect(namesSecret([text], "around"), text).toBe(true);
    }
    // Words that may mean something else count only where they name what the user types.
    for (const text of ["accessToken", "githubToken", "authToken", "clientSecret", "secretKey", "otpCode", "cvv2", "PIN", "TAN"]) {
      expect(namesSecret([text], "typed"), text).toBe(true);
    }
    // Inside longer words, in the plural, in other scripts.
    for (const text of ["Einmalpasswort", "Kreditkartennummer", "Zugangstoken", "Paste your GitHub access token below.", "Enter your API token", "Your API keys", "Recovery codes", "验证码", "認証コードを入力"]) {
      expect(namesSecret([text], "around"), text).toBe(true);
    }
    // Where the question says what to type, the short words count — in doubt a form is refused.
    for (const text of ["Enter your PIN", "Enter the TAN from your banking app", "Enter your 2FA code", "Paste your li_at cookie", "Your GitHub token"]) {
      expect(namesSecret([text], "typed"), text).toBe(true);
    }
    for (const text of ["Pin the issue", "Token budget", "Secret Santa", "Tan"]) {
      expect(namesSecret([text], "around"), text).toBe(false);
    }
    for (const text of ["Pinned only", "Tanzania", "Tokens left", "Keyword", "Palabra clave", "Project", "Shipping address"]) {
      expect(namesSecret([text], "typed"), text).toBe(false);
    }
  });

  it("refuses a form that asks for a secret where the user types — by the field's name or title, or by any text around it in so many words", () => {
    expect(readMcpElicitation(form({ accessToken: { type: "string" } }), {})).toEqual({ kind: "refused", reason: "secret", message: "Which project?", field: "accessToken" });
    expect(readMcpElicitation(form({ value: { type: "string", title: "API-Schlüssel für GitHub" } }))).toMatchObject({ kind: "refused", reason: "secret", field: "API-Schlüssel für GitHub" });
    expect(readMcpElicitation(form({ code: { type: "integer", title: "PIN" } }))).toMatchObject({ kind: "refused", reason: "secret", field: "PIN" });
    // Around the field: the description, the question, a neighbour, a choice — then no field is named.
    expect(readMcpElicitation(form({ value: { type: "string", description: "The verification code from the app" } }))).toEqual({ kind: "refused", reason: "secret", message: "Which project?" });
    expect(readMcpElicitation({ message: "Paste your password below.", requestedSchema: { type: "object", properties: { value: { type: "string" } } } })).toEqual({ kind: "refused", reason: "secret", message: "Paste your password below." });
    expect(readMcpElicitation(form({ value: { type: "string" }, ok: { type: "boolean", description: "Paste your API key into the box above" } }))).toMatchObject({ kind: "refused", reason: "secret" });
    expect(readMcpElicitation(form({ value: { type: "string" }, kind: { type: "string", enum: ["card number", "name"] } }))).toMatchObject({ kind: "refused", reason: "secret" });
    // The short words, where the question or the field's own description says what to type.
    expect(readMcpElicitation({ message: "Enter your PIN", requestedSchema: { type: "object", properties: { value: { type: "string" } } } })).toEqual({ kind: "refused", reason: "secret", message: "Enter your PIN" });
    expect(readMcpElicitation(form({ value: { type: "string", description: "Your GitHub token" } }))).toEqual({ kind: "refused", reason: "secret", message: "Which project?" });
    expect(readMcpElicitation({ message: "We'll create a new API token — what should it be called?", requestedSchema: { type: "object", properties: { name: { type: "string" } } } }).kind).toBe("refused");
  });

  it("does not refuse what nobody types into, nor a word that may mean something else around a field", () => {
    expect(readMcpElicitation(form({ pin: { type: "boolean", title: "Pin the issue" } })).kind).toBe("form");
    expect(readMcpElicitation({ message: "Rotate the API key now?", requestedSchema: { type: "object", properties: { rotate: { type: "boolean" } } } }).kind).toBe("form");
    expect(readMcpElicitation(form({ kind: { type: "string", title: "Token kind", enum: ["read", "write"] } })).kind).toBe("form");
    // A neighbour's short word is no instruction to type: a yes or no about a pin next to a note field is shown.
    expect(readMcpElicitation(form({ note: { type: "string", title: "Note" }, pin: { type: "boolean", title: "Pin the issue" } })).kind).toBe("form");
  });
});

describe("a page to open", () => {
  it("is shown whole, with its host apart, and marks a host in punycode or a bare address", () => {
    expect(readMcpElicitation({ mode: "url", message: "Connect GitHub.", url: "https://Tracker.Example.com/connect/github?state=7f3a#x", elicitationId: "e1" })).toEqual({
      kind: "url",
      message: "Connect GitHub.",
      url: "https://tracker.example.com/connect/github?state=7f3a#x",
      prefix: "https://",
      host: "tracker.example.com",
      rest: "/connect/github?state=7f3a#x",
      punycode: false,
      ip: false,
    });
    expect(readMcpElicitation({ mode: "url", message: "", url: "https://xn--pple-43d.com/login" })).toMatchObject({ host: "xn--pple-43d.com", punycode: true });
    expect(readMcpElicitation({ mode: "url", message: "", url: `https://${String.fromCharCode(0x430)}pple.com/login` })).toMatchObject({ punycode: true });
    expect(readMcpElicitation({ mode: "url", message: "", url: "https://203.0.113.7/pay" })).toMatchObject({ kind: "url", ip: true });
    expect(readMcpElicitation({ mode: "url", message: "", url: "https://[2001:db8::1]/pay" })).toMatchObject({ kind: "url", ip: true, host: "[2001:db8::1]" });
    // What the address parser makes of a backslash, an @ in the path, spaces around it — whole and canonical.
    expect(readMcpElicitation({ mode: "url", message: "", url: "  https://tracker.example.com\\a\\b/@x y  " })).toMatchObject({ kind: "url", host: "tracker.example.com", url: "https://tracker.example.com/a/b/@x%20y" });
  });

  it("opens a page on this device only for a server on this device — and there http as well", () => {
    for (const url of ["http://127.0.0.1:7777/done", "https://localhost/done", "http://app.localhost/done", "http://[::1]:8080/done"]) {
      expect(readMcpElicitation({ mode: "url", message: "", url }, { local: true }).kind, url).toBe("url");
      expect(readMcpElicitation({ mode: "url", message: "", url }).kind, url).toBe("refused");
    }
    expect(readMcpElicitation({ mode: "url", message: "", url: "https://localhost.evil.example/done" })).toMatchObject({ kind: "url", host: "localhost.evil.example" });
    expect(mcpOnDeviceHost("LOCALHOST")).toBe(true);
    expect(mcpOnDeviceHost("localhost.evil.example")).toBe(false);
    for (const host of ["localhost.", "localhost.localdomain", "[::ffff:7f00:1]", "[::ffff:0:0]", "0.0.0.0", "[::]", "127.1.2.3"]) expect(mcpOnDeviceHost(host), host).toBe(true);
    for (const url of ["https://localhost./x", "https://0.0.0.0/x", "https://[::ffff:127.0.0.1]/x", "https://[::]/x"]) expect(readMcpElicitation({ mode: "url", message: "", url }).kind, url).toBe("refused");
  });

  it("opens only https elsewhere, and no address that carries a sign-in of its own", () => {
    for (const url of ["http://tracker.example.com/connect", "javascript:alert(1)", "file:///etc/passwd", "https://user:pw@tracker.example.com/", "https://admin@tracker.example.com/", "", "not an address", `https://example.com/${"a".repeat(MCP_ELICIT_LIMITS.url)}`]) {
      expect(readMcpElicitation({ mode: "url", message: "Open", url }, { local: true }), url).toEqual({ kind: "refused", reason: "address", message: "Open" });
    }
  });
});

describe("an answer, checked before it goes", () => {
  const question = asForm(
    readMcpElicitation(
      form(
        {
          project: { type: "string", enum: ["hk", "ws"] },
          closed: { type: "boolean" },
          agree: { type: "boolean" },
          since: { type: "string", format: "date" },
          at: { type: "string", format: "date-time" },
          mail: { type: "string", format: "email" },
          site: { type: "string", format: "uri" },
          limit: { type: "integer", minimum: 1, maximum: 50 },
          share: { type: "number" },
          labels: { type: "array", items: { enum: ["bug", "ux", "docs"] }, maxItems: 2 },
          note: { type: "string", minLength: 3 },
        },
        { required: ["project", "agree"] },
      ),
    ),
  );

  it("sends what was asked, as its type, and leaves out what is empty and not required", () => {
    expect(checkMcpElicitAnswer(question, { project: "ws", limit: "12", share: "0.5", labels: ["ux", "ux"], mail: " a@b.example ", since: "2026-10-25", stray: "never sent" })).toEqual({
      ok: true,
      content: { project: "ws", agree: false, limit: 12, share: 0.5, labels: ["ux"], mail: "a@b.example", since: "2026-10-25" },
    });
  });

  it("names every field that is not right yet, and what is wrong with it", () => {
    expect(checkMcpElicitAnswer(question, { project: "other", limit: "2.5", labels: ["bug", "ux", "docs"], since: "25.10.2026", mail: "nobody", site: "not a url", note: "ab", at: "soon" })).toEqual({
      ok: false,
      problems: { project: "format", limit: "format", labels: "count", since: "format", mail: "format", site: "format", note: "short", at: "format" },
    });
    expect(checkMcpElicitAnswer(question, { limit: "99" })).toEqual({ ok: false, problems: { project: "required", limit: "range" } });
    // A day that does not exist is no day, whatever an engine would make of it.
    expect(checkMcpElicitAnswer(question, { project: "hk", since: "2026-02-30" })).toEqual({ ok: false, problems: { since: "format" } });
    // Every year has its days, the first ones too; a moment may be written in small letters.
    expect(checkMcpElicitAnswer(question, { project: "hk", since: "0001-01-01", at: "2026-10-25t14:30:00z" })).toMatchObject({ ok: true, content: { since: "0001-01-01", at: "2026-10-25T14:30:00.000Z" } });
  });

  it("reads a number as the user's language writes it, and guesses nothing", () => {
    expect([parseMcpNumber("12"), parseMcpNumber("-3.5"), parseMcpNumber("1,5"), parseMcpNumber("2e3")]).toEqual([12, -3.5, 1.5, 2000]);
    // A separator with three digits behind it could as well separate thousands — unless it is the language's own.
    expect(parseMcpNumber("1,000")).toBeNaN();
    expect(parseMcpNumber("1,000", ",")).toBe(1);
    expect(parseMcpNumber("1.000", ",")).toBeNaN();
    for (const text of ["0x10", "0b11", "1_000", "1 000", "1.2.3", "", ".", "1.", "Infinity"]) expect(parseMcpNumber(text), text).toBeNaN();
    // What cannot be a group of thousands is a decimal, whatever the separator; full-width digits are digits.
    expect([parseMcpNumber(".5"), parseMcpNumber(",5"), parseMcpNumber("0,125"), parseMcpNumber("1234,567"), parseMcpNumber("１２")]).toEqual([0.5, 0.5, 0.125, 1234.567, 12]);
    expect(checkMcpElicitAnswer(question, { project: "hk", limit: "1,000" })).toEqual({ ok: false, problems: { limit: "format" } });
    expect(checkMcpElicitAnswer(question, { project: "hk", share: "0,25" }, { decimal: "," })).toMatchObject({ ok: true, content: { share: 0.25 } });
  });

  it("reads only the answer's own values: a field named like nothing an object has", () => {
    const optional = asForm(readMcpElicitation(form({ topic: { type: "string" } })));
    expect(checkMcpElicitAnswer(optional, Object.create({ topic: "inherited" }) as Record<string, unknown>)).toEqual({ ok: true, content: {} });
  });

  it("lets a required choice of several stay empty where it may", () => {
    const pick = asForm(readMcpElicitation(form({ tags: { type: "array", items: { enum: ["a", "b"] }, minItems: 0 } }, { required: ["tags"] })));
    expect(checkMcpElicitAnswer(pick, {})).toEqual({ ok: true, content: { tags: [] } });
  });

  it("sends a moment with its zone spelled out", () => {
    const answer = checkMcpElicitAnswer(question, { project: "hk", at: "2026-10-25T14:30" });
    expect(answer.ok && answer.content.at).toBe(new Date(2026, 9, 25, 14, 30).toISOString());
    expect(checkMcpElicitAnswer(question, { project: "hk", at: "2026-10-25T25:00" })).toEqual({ ok: false, problems: { at: "format" } });
  });

  it("is checked once more on its way out: a form answer that does not pass is a no, a page carries nothing, a refusal is a no", () => {
    expect(mcpElicitReply(question, { action: "accept", content: { project: "hk", extra: 1 } })).toEqual({ action: "accept", content: { project: "hk", agree: false } });
    expect(mcpElicitReply(question, { action: "accept", content: { project: "nope" } })).toEqual({ action: "decline" });
    expect(mcpElicitReply(question, { action: "cancel" })).toEqual({ action: "cancel" });
    const page = readMcpElicitation({ mode: "url", message: "", url: "https://example.com/" });
    expect(mcpElicitReply(page, { action: "accept", content: { secret: "x" } })).toEqual({ action: "accept" });
    const refused = readMcpElicitation(form({ password: { type: "string" } }));
    expect(mcpElicitReply(refused, { action: "accept", content: { password: "hunter2" } })).toEqual({ action: "decline" });
    expect(mcpElicitOutcome(refused, { action: "accept" })).toBe("refused");
    expect(mcpElicitOutcome(question, { action: "decline" })).toBe("declined");
  });
});

describe("what a request offers", () => {
  it("names the kinds the client shows, in the protocol's order", () => {
    expect(mcpElicitCapabilities(["url", "form"])).toEqual({ elicitation: { form: {}, url: {} } });
    expect(mcpElicitCapabilities(["form"])).toEqual({ elicitation: { form: {} } });
  });
});
