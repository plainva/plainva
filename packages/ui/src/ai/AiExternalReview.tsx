import { useState } from "react";
import { useTranslation } from "react-i18next";
import { capMcpText } from "@plainva/core";
import { LineCompare } from "../components/LineCompare";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { Checkbox } from "../components/ui/Checkbox";
import { TextInput } from "../components/ui/Field";
import { Segmented } from "../components/ui/Segmented";
import type { ExternalReviewModel, ExternalSignIn } from "./externalReview";
import { externalAuditLines, externalDriftLines, externalFacts, externalFailureText, externalSecrets, type ExternalFolders, type ExternalSecret } from "./externalTools";

/**
 * The review of one foreign server (plan KI-Harness P4.5), as both shells
 * show it inside their own container — a modal on the desktop, a sheet on
 * the phone: what is registered, what the server lists now, what differs
 * from the approved texts, and this vault's choices — which of its tools may
 * be called here, and which notes may go with a call.
 *
 * Everything a server wrote is shown as its words: cleaned, cut, never as
 * markup. Its instructions are for the reader of this review only; no model
 * is given them.
 */

/** One stored value of a server: whether there is one, and a field to replace or delete it. The value itself never comes back. */
function SecretRow({ secret, onSave }: { secret: ExternalSecret; onSave: (value: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const label = secret.name ?? t("ai.ext.review.token");
  const save = () => {
    void onSave(value).then(() => {
      setValue("");
      setOpen(false);
    });
  };
  return (
    <span className="pv-ext-secret">
      <span>
        {secret.name ? <code>{secret.name}</code> : label} · {t(secret.stored ? "ai.ext.review.stored" : "ai.ext.review.notStored")}
      </span>
      {open ? (
        <>
          <TextInput
            compact
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            placeholder={t("ai.ext.review.secretPlaceholder")}
            aria-label={label}
            onChange={(event) => setValue(event.target.value)}
            data-testid="ai-ext-secret-input"
          />
          <Button size="sm" variant="secondary" onClick={save} data-testid="ai-ext-secret-save">
            {t("common.save")}
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="ai-ext-secret-change">
          {t("ai.ext.review.change")}
        </Button>
      )}
    </span>
  );
}

/**
 * Signing in to a remote server: where it stands, and the one button that
 * starts it. The sign-in itself happens in the browser; what comes of it
 * stays on the native side — this row shows a host and a state, never a
 * credential.
 */
function SignInRow({ signIn }: { signIn: ExternalSignIn }) {
  const { t } = useTranslation();
  const { status, stage } = signIn;
  if (stage === "planning") {
    return (
      <p className="pv-ext-note" data-testid="ai-ext-signin-planning">
        {t("ai.ext.signIn.planning")}
      </p>
    );
  }
  if (stage === "waiting") {
    return (
      <span className="pv-ext-secret">
        <span data-testid="ai-ext-signin-waiting">{t("ai.ext.signIn.waiting", { host: signIn.host })}</span>
        <Button size="sm" variant="ghost" onClick={signIn.cancel} data-testid="ai-ext-signin-cancel">
          {t("common.cancel")}
        </Button>
      </span>
    );
  }
  if (stage === "client") {
    return (
      <>
        <span className="pv-ext-note">{t("ai.ext.signIn.clientHelp", { host: signIn.host })}</span>
        <span className="pv-ext-secret">
          <TextInput
            compact
            autoComplete="off"
            spellCheck={false}
            value={signIn.clientId}
            placeholder={t("ai.ext.signIn.client")}
            aria-label={t("ai.ext.signIn.client")}
            onChange={(event) => signIn.setClientId(event.target.value)}
            data-testid="ai-ext-signin-client"
          />
          <Button size="sm" variant="secondary" disabled={!signIn.clientId.trim()} onClick={signIn.proceed} data-testid="ai-ext-signin-continue">
            {t("ai.ext.signIn.continue")}
          </Button>
          <Button size="sm" variant="ghost" onClick={signIn.cancel}>
            {t("common.cancel")}
          </Button>
        </span>
      </>
    );
  }
  // That the server wants a sign-in is said where the look failed, above; this row says where things stand and offers the step.
  const standing = !status ? t("ai.ext.signIn.none") : t(status.signedIn ? "ai.ext.signIn.signedIn" : "ai.ext.signIn.ended", { host: signIn.statusHost });
  return (
    <>
      <span className="pv-ext-secret">
        <span data-testid="ai-ext-signin-status">{standing}</span>
        <Button size="sm" variant={signIn.wanted ? "secondary" : "ghost"} onClick={signIn.start} data-testid="ai-ext-signin">
          {t(status ? "ai.ext.signIn.again" : "ai.ext.signIn.start")}
        </Button>
        {status && (
          <Button size="sm" variant="ghost" onClick={() => void signIn.signOut()} data-testid="ai-ext-signout">
            {t("ai.ext.signIn.signOut")}
          </Button>
        )}
      </span>
      {signIn.problem && (
        <span className="pv-ext-note" role="alert" data-testid="ai-ext-signin-problem">
          {signIn.problem}
        </span>
      )}
      <span className="pv-ext-note">{t("ai.ext.signIn.note")}</span>
    </>
  );
}

export interface AiExternalReviewProps {
  review: ExternalReviewModel;
  /** The top-level folders of the open vault, for "chosen folders". */
  vaultFolders: readonly string[];
}

export function AiExternalReview({ review, vaultFolders }: AiExternalReviewProps) {
  const { t, i18n } = useTranslation();
  const { server, look, listing } = review;
  if (!server) return null;
  const seen =
    look.state === "ready" ? { name: look.inspection.hello.serverInfo?.name ?? "", version: look.inspection.hello.version } : server.seen ? { name: server.seen.name, version: server.seen.version } : null;
  const facts = externalFacts(t, server, seen);
  const drift = externalDriftLines(t, look.state === "ready" ? look.inspection.review : server.review);
  const instructions = listing ? capMcpText(listing.instructions, 4000).text : "";
  const secrets = externalSecrets(server);
  const calls = externalAuditLines(t, review.audit, server.id, i18n.language);
  const clipped = look.state === "ready" && (look.inspection.clipped.tools || look.inspection.clipped.prompts);
  return (
    <>
      {look.state === "loading" && (
        <p className="pv-ext-note" data-testid="ai-ext-loading">
          {t("ai.ext.review.loading")}
        </p>
      )}
      {look.state === "failed" && (
        <Banner
          kind="warning"
          rounded
          actions={
            <Button size="sm" variant="ghost" onClick={review.retry} data-testid="ai-ext-retry">
              {t("ai.ext.review.retry")}
            </Button>
          }
        >
          <span data-testid="ai-ext-failure">
            {externalFailureText(t, look.failure)}
            {listing ? ` ${t("ai.ext.review.failedKept")}` : ""}
          </span>
        </Banner>
      )}
      {drift.length > 0 && (
        <Banner kind="warning" rounded>
          <span data-testid="ai-ext-drift">
            {t("ai.ext.review.blocked")} {drift.join(" ")}
          </span>
        </Banner>
      )}
      {look.state === "ready" && look.inspection.tooLarge && (
        <Banner kind="error" rounded>
          {t("ai.ext.review.tooLarge")}
        </Banner>
      )}
      <dl className="pv-skill-facts" data-testid="ai-ext-facts">
        {facts.map((fact) => (
          <FactRow key={fact.label} label={fact.label} lines={fact.lines} code={fact.code} />
        ))}
        {secrets.length > 0 && (
          <>
            <dt>{t("ai.ext.review.values")}</dt>
            <dd>
              {secrets.map((secret) => (
                <SecretRow key={secret.name ?? ""} secret={secret} onSave={(value) => review.setSecret(secret.name, value)} />
              ))}
            </dd>
          </>
        )}
        {review.signIn.possible && (
          <>
            <dt>{t("ai.ext.signIn.title")}</dt>
            <dd>
              <SignInRow signIn={review.signIn} />
            </dd>
          </>
        )}
        {instructions && (
          <>
            <dt>{t("ai.ext.review.instructions")}</dt>
            <dd>
              <LineCompare lines={null} fallback={instructions} testId="ai-ext-instructions" />
              <span className="pv-ext-note">{t("ai.ext.review.instructionsNote")}</span>
            </dd>
          </>
        )}
      </dl>
      {listing && (
        <>
          <fieldset className="pv-ext-group" data-testid="ai-ext-tools">
            <legend>{t("ai.ext.review.tools")}</legend>
            <p className="pv-ext-note">{listing.tools.length ? t("ai.ext.review.toolsHint") : t("ai.ext.review.toolsNone")}</p>
            {review.rows.map((row) => (
              <Checkbox key={row.name} checked={row.granted && row.grantable} disabled={!row.grantable} onChange={(event) => review.toggleTool(row.name, event.target.checked)} data-testid="ai-ext-tool">
                {row.title === row.name ? row.name : `${row.title} (${row.name})`}
                {row.description && <span>{row.description}</span>}
                {row.notes.map((note) => (
                  <span key={note}>{note}</span>
                ))}
              </Checkbox>
            ))}
            {clipped && <p className="pv-ext-note">{t("ai.ext.review.clipped")}</p>}
          </fieldset>
          {listing.prompts.length > 0 && (
            <fieldset className="pv-ext-group">
              <legend>{t("ai.ext.review.prompts")}</legend>
              <p className="pv-ext-note">{t("ai.ext.review.promptsHint")}</p>
              <p className="pv-ext-note" data-testid="ai-ext-prompts">
                {listing.prompts
                  .slice(0, 24)
                  .map((prompt) => capMcpText(prompt.title, 60).text || prompt.name)
                  .join(" · ")}
              </p>
            </fieldset>
          )}
          <fieldset className="pv-ext-group">
            <legend>{t("ai.ext.review.vault")}</legend>
            <Checkbox checked={review.enabled} onChange={(event) => review.setEnabled(event.target.checked)} data-testid="ai-ext-use">
              {t("ai.ext.use", { server: server.label })}
            </Checkbox>
            <p className="pv-ext-note">{t("ai.ext.review.folders")}</p>
            <Segmented<ExternalFolders>
              ariaLabel={t("ai.ext.review.folders")}
              value={review.folders}
              onChange={review.setFolders}
              options={[
                { value: "none", label: t("ai.ext.review.foldersNone"), testId: "ai-ext-folders-none" },
                { value: "some", label: t("ai.ext.review.foldersSome"), testId: "ai-ext-folders-some" },
                { value: "all", label: t("ai.ext.review.foldersAll"), testId: "ai-ext-folders-all" },
              ]}
            />
            {review.folders === "some" &&
              (vaultFolders.length ? (
                vaultFolders.map((folder) => (
                  <Checkbox key={folder} checked={review.grant.folders.includes(folder)} onChange={(event) => review.toggleFolder(folder, event.target.checked)} data-testid="ai-ext-folder">
                    {folder}
                  </Checkbox>
                ))
              ) : (
                <p className="pv-ext-note">{t("ai.ext.review.foldersEmpty")}</p>
              ))}
            <p className="pv-ext-note">{t("ai.ext.review.foldersHint")}</p>
          </fieldset>
        </>
      )}
      {server.registered.kind === "program" && (
        <fieldset className="pv-ext-group">
          <legend>{t("ai.ext.review.log")}</legend>
          {review.log === null ? (
            <Button size="sm" variant="ghost" onClick={review.showLog} data-testid="ai-ext-log-show">
              {t("common.show")}
            </Button>
          ) : review.log ? (
            <LineCompare lines={null} fallback={review.log} testId="ai-ext-log" />
          ) : (
            <p className="pv-ext-note">{t("ai.ext.review.logEmpty")}</p>
          )}
        </fieldset>
      )}
      <fieldset className="pv-ext-group">
        <legend>{t("ai.ext.review.calls")}</legend>
        {calls.length ? (
          <ul className="pv-mcp-audit" data-testid="ai-ext-calls">
            {calls.map((call) => (
              <li key={call.key}>{call.text}</li>
            ))}
          </ul>
        ) : (
          <p className="pv-ext-note">{t("ai.ext.review.callsNone")}</p>
        )}
      </fieldset>
      {review.needsApproval && review.canApprove && <p className="pv-ext-note">{t("ai.ext.review.approveHint")}</p>}
    </>
  );
}

function FactRow({ label, lines, code }: { label: string; lines: string[]; code?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {lines.map((line) => (
          <span key={line}>{code ? <code>{line}</code> : line}</span>
        ))}
      </dd>
    </>
  );
}
