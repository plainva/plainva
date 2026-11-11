// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { accountInputProps, ChipField, connectFieldInputProps, GrowingField, resetSpellcheckForTests, setSpellcheckOn, TextArea, type ConnectField } from "@plainva/ui";

/**
 * Fields of account forms ask the keyboard for what they hold (Sammelplan § 3.43).
 *
 * The forms set the keyboard hints by hand, each a little differently, and the
 * phone's IMAP form gave its host fields only "no capitals" — no address
 * purpose, no URL keyboard, nothing folded, so a Japanese keyboard typed a
 * full-width host no server answers to. One rule now (`accountInputProps`),
 * which every mail, calendar and connect form of both shells uses, and the
 * multi-line and chip fields apply it as the single-line field always did.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetSpellcheckForTests();
});

describe("the rule", () => {
  it("names a keyboard for every kind and never capitalises or corrects", () => {
    expect(accountInputProps("email")).toMatchObject({ type: "email", purpose: "address", inputMode: "email" });
    expect(accountInputProps("recipients")).toMatchObject({ type: "text", purpose: "address", inputMode: "email" });
    expect(accountInputProps("address")).toMatchObject({ type: "text", purpose: "address", inputMode: "url" });
    expect(accountInputProps("port")).toMatchObject({ purpose: "number", inputMode: "numeric" });
    expect(accountInputProps("secret")).toMatchObject({ type: "password", purpose: "secret", autoComplete: "new-password" });
    for (const kind of ["email", "recipients", "address", "user", "port", "keyId", "secret"] as const) {
      expect(accountInputProps(kind), kind).toMatchObject({ autoCapitalize: "none", autoCorrect: "off" });
    }
  });

  it("is the one the connect step uses for each of its fields", () => {
    const inputs = ["text", "email", "address", "keyId", "secret", "port"] as const satisfies readonly ConnectField["input"][];
    for (const input of inputs) expect(connectFieldInputProps(input), input).toEqual(accountInputProps(input === "text" ? "user" : input));
  });
});

describe("the field primitives", () => {
  it("a multi-line field of addresses asks for no capitals and no correction, like the single-line one", () => {
    act(() => root.render(<><TextArea purpose="address" /><GrowingField purpose="address" value="" onChange={() => {}} /></>));
    expect(container.querySelectorAll("textarea").length, "the fields render a textarea").toBeGreaterThan(0);
    for (const area of Array.from(container.querySelectorAll("textarea"))) {
      expect(area.getAttribute("autocapitalize")).toBe("none");
      expect(area.getAttribute("autocorrect")).toBe("off");
    }
  });

  it("a chip field is an address field: no capitals, no spelling marks, the e-mail keyboard", () => {
    setSpellcheckOn(true);
    act(() => root.render(<ChipField values={[]} onChange={() => {}} parse={(raw) => [raw]} removeLabel={(v) => v} />));
    const input = container.querySelector("input")!;
    expect(input.getAttribute("autocapitalize")).toBe("none");
    expect(input.getAttribute("autocorrect")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.getAttribute("inputmode")).toBe("email");
  });
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
/** The `<TextInput … />` whose change handler sets `setter`. */
const inputOf = (source: string, setter: string) => {
  const at = source.indexOf(setter);
  expect(at, setter).toBeGreaterThan(0);
  const start = source.lastIndexOf("<TextInput", at);
  return source.slice(start, source.indexOf("/>", at));
};

describe("the account forms of both shells", () => {
  it("the connect step of both shells takes its keyboard from the rule", () => {
    for (const path of ["apps/desktop/src/components/settings/ConnectSignInStep.tsx", "apps/mobile/src/screens/CloudConnectScreen.tsx"]) {
      expect(read(path), path).toContain("{...connectFieldInputProps(field.input)}");
    }
  });

  it("the phone's IMAP form: hosts, ports, address and password, and the address and hosts are read as a machine reads them", () => {
    const form = read("apps/mobile/src/screens/mail/MailImapForm.tsx");
    expect(inputOf(form, "setServer((s) => ({ ...s, [key]: e.target.value }))")).toContain('accountInputProps("address")');
    expect(inputOf(form, "setServer((s) => ({ ...s, [key]: Number.isFinite(n)")).toContain('accountInputProps("port")');
    expect(inputOf(form, "setEmail(e.target.value)")).toContain('accountInputProps("email")');
    expect(inputOf(form, "setPass(e.target.value)")).toContain('accountInputProps("secret")');
    for (const value of ["host: foldMachineText(effective.host)", "smtpHost: foldMachineText(effective.smtpHost)", "user: address", "const address = foldMachineText(email)"]) {
      expect(form).toContain(value);
    }
  });

  it("the phone's calendar form, composer and mailbox page", () => {
    const pim = read("apps/mobile/src/screens/PimAccountsScreen.tsx");
    expect(inputOf(pim, "setUrl(e.target.value)")).toContain('accountInputProps("address")');
    expect(inputOf(pim, "setUser(e.target.value)")).toContain('accountInputProps("user")');
    const compose = read("apps/mobile/src/screens/MailComposeScreen.tsx");
    for (const setter of ["setTo(e.target.value)", "setCc(e.target.value)", "setBcc(e.target.value)"]) {
      expect(inputOf(compose, setter), setter).toContain('accountInputProps("recipients")');
    }
    expect(inputOf(read("apps/mobile/src/screens/MailAccountsScreen.tsx"), "setMsClientId(e.target.value)")).toContain('accountInputProps("keyId")');
  });
});
