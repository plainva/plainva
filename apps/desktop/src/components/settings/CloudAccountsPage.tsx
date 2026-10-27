import { desktopPasswordChangePorts } from "../../services/accountPassword";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Check, ChevronRight, CircleAlert, Clock, LogOut, Plus, RotateCw, Trash2, Users } from "lucide-react";
import {
  AccountPasswordChangePanel,
  OAuthAccessEditor,
  accessProblemKey,
  cardOAuthServices,
  plainvaGoogleClient,
  SignInNothingGrantedError,
  SignInWrongAccountError,
  type AccessResolution,
  type StoredOAuthAccess,
  Banner,
  Button,
  IconButton,
  Switch,
  TextInput,
  EmptyState,
  SettingCard,
  SettingCardNote,
  SettingRow,
  ICON,
  cx,
  accountServices,
  looksLikeNextcloud,
  nextcloudEndpoints,
  suiteProvider,
  toast,
  type AccountRepairNeed,
  type CloudAccountRecord,
  type CloudServiceId,
  type GuidedAccountRepairPlan,
  type DeviceSignInState,
  accountAccessOf,
  accountPageModel,
  manualMergeCandidates,
  accountStateOf,
  isServiceOff,
  accountStateKey,
  removeAccountConfirm,
  accessLineText,
  isOwnClientRejected,
  standardAccessAvailable,
} from "@plainva/ui";
import { findCloudAccountByRef } from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { appConfirm } from "../../services/appDialogs";
import { credentialManager } from "../../services/CredentialManager";
import { accountSignInStateHere } from "../../services/deviceSignIn";
import { readFileSyncAccess, type FileSyncAccess } from "../../services/fileSyncAccess";
import { getPimCredentials } from "../../services/pim/pimCredentials";
import {
  CLOUD_ACCOUNTS_EVENT,
  backfillSyncIdentity,
  backfillCalendarIdentity,
  loadCloudAccounts,
  refreshCloudAccounts,
  saveCloudAccounts,
} from "../../services/cloudAccounts";
import {
  bindConnectResult,
  removeCloudAccount,
  rerunAccountAuth,
  setAccountServiceOff,
  signOutCloudAccountHere,
  canUnifyAccountLogin,
  passwordServicesOf,
  runConnectSequence,
  holdCredentialsAnnouncements,
  type ConnectRequest,
  type ServiceRunStatus,
} from "../../services/cloudAccountsActions";
import {
  guideDesktopAccountRepair,
  loadDesktopAccountRepairNeeds,
} from "../../services/accountRepair";
import { getSettingsStore } from "../../services/settingsStore";
import { Select } from "../Select";
import { AreaHead } from "./AppPages";
import { CloudAccountsWizard } from "./CloudAccountsWizard";
import { AccountCheckModal } from "./AccountCheckModal";
import { AccountServicePage } from "./AccountServicePage";
import { readAccountPageFacts, type AccountPageFacts } from "../../services/accountPageFacts";
import { AccessUnavailableError, deviceAccess, readDeviceAccess, saveDeviceAccess, signInCloudAccount } from "../../services/accountSignIn";
import { oauthErrorText } from "../../services/oauthLoopback";
import { listMailAccounts, replacementMailAddress } from "@plainva/ui/mail";
import { AccountMark, SERVICE_ICONS, ServiceChip, accountTitle, familyLabel, serviceLabel } from "./cloudAccountsShared";

/**
 * The "Cloud-Konten" vault area (mockup screens 1 + 4): the ONE place where
 * providers are connected and their services are chosen. Service behavior
 * stays in the per-service areas (sync / calendar / mail).
 */

type Mode = { kind: "list" } | { kind: "wizard" } | { kind: "detail"; id: string } | { kind: "service"; id: string; service: CloudServiceId };

export const CloudAccountsPage: React.FC<{
  selectedVault: string;
  initialProvider?: string;
  /** Open this account's detail page - or one service page of it - as soon as it is known (D2, V3). */
  focusAccount?: { ref: string; nonce: number; service?: CloudServiceId } | null;
  /** Opens another settings page of the vault (the Calendar, E-Mail or Sync page, E4). */
  onOpenArea?: (areaId: string) => void;
}> = ({
  selectedVault,
  initialProvider,
  focusAccount,
  onOpenArea,
}) => {
  const { t } = useTranslation();
  const { dbAdapter, pimRuntime, vaultPath, syncWorker } = useVault();
  const isActiveVault = selectedVault === vaultPath;
  const runtime = isActiveVault ? pimRuntime : null;
  /** Read when a sign-in reaches the calendar: a runtime captured earlier may be stopped. */
  const runtimeRef = useRef(runtime);
  useEffect(() => { runtimeRef.current = runtime; }, [runtime]);
  const [records, setRecords] = useState<CloudAccountRecord[]>([]);
  const [repairNeeds, setRepairNeeds] = useState<AccountRepairNeed[]>([]);
  // The splash "open an online vault" path deep-links here with the provider
  // the user already picked — land in the wizard on that tile, not on the list.
  const [mode, setMode] = useState<Mode>(initialProvider ? { kind: "wizard" } : { kind: "list" });
  const [reconStatus, setReconStatus] = useState<Partial<Record<CloudServiceId, ServiceRunStatus>>>({});
  // The wizard and an account's detail show what a sign-in did, service by
  // service; the vault reload that new sync credentials need waits until they
  // are left (it would put the settings back on this list).
  const showsResults = mode.kind !== "list";
  useEffect(() => (showsResults ? holdCredentialsAnnouncements() : undefined), [showsResults]);
  const [busy, setBusy] = useState(false);
  /** Which other card the user declares to be the same account (E3 fallback). */
  const [mergeSource, setMergeSource] = useState("");
  /** Accounts that still hold one refresh token per service (stage B offer). */
  const [unifiable, setUnifiable] = useState<Set<string>>(new Set());
  /** The card whose Gmail asks for an app password inline (E5). */
  const [gmailPasswordFor, setGmailPasswordFor] = useState<string | null>(null);
  const [gmailPassword, setGmailPassword] = useState("");
  /** The address the app-password mailbox signs in with: the refused mailbox's own (review finding 1). */
  const [gmailAddress, setGmailAddress] = useState("");
  useEffect(() => {
    const record = records.find((entry) => entry.id === gmailPasswordFor);
    if (!record) return;
    let alive = true;
    void listMailAccounts(selectedVault).catch(() => []).then((mailboxes) => { if (alive) setGmailAddress(replacementMailAddress(record, mailboxes)); });
    return () => { alive = false; };
  }, [gmailPasswordFor, records, selectedVault]);
  /** This device's access per family, shown on the account page (E3). */
  const [accessInfo, setAccessInfo] = useState<{ family: "google" | "microsoft"; stored: StoredOAuthAccess | null; resolved: AccessResolution } | null>(null);
  const [editAccess, setEditAccess] = useState(false);
  /** The card whose connection is being checked (plan E6). */
  const [checking, setChecking] = useState<string | null>(null);
  /** The last check of each account in this session, for section 4's line. */
  const [lastChecks, setLastChecks] = useState<Map<string, { time: string; ok: boolean }>>(new Map());
  /** The card whose password entry is open (section 3, and "Sign in" of a password account). */
  const [passwordOpen, setPasswordOpen] = useState<string | null>(null);
  /** Whether the open card has a service a consent can renew (an app-password-only Gmail card has none). */
  const [renewable, setRenewable] = useState(true);
  const backfilled = useRef(false);
  // A deep link that names an account lands on its DETAIL page — the only
  // place with the reconnect button (finding 2026-09-01, D2). Applied once per
  // request, and only once the records are loaded; an unknown reference simply
  // leaves the list on screen.
  const focusApplied = useRef(0);
  useEffect(() => {
    if (!focusAccount || focusApplied.current === focusAccount.nonce) return;
    const hit = findCloudAccountByRef(records, focusAccount.ref);
    if (!hit) return;
    focusApplied.current = focusAccount.nonce;
    setReconStatus({});
    const service = focusAccount.service;
    setMode(service && accountServices(hit).includes(service) ? { kind: "service", id: hit.id, service } : { kind: "detail", id: hit.id });
  }, [focusAccount, records]);

  const reload = useCallback(async () => {
    const store = await getSettingsStore();
    const [next, needs] = await Promise.all([
      isActiveVault ? refreshCloudAccounts(selectedVault, runtime) : loadCloudAccounts(selectedVault),
      loadDesktopAccountRepairNeeds(store, selectedVault),
    ]);
    setRecords(next);
    setRepairNeeds(needs);
  }, [selectedVault, isActiveVault, runtime]);

  useEffect(() => {
    void reload();
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { vaultPath?: string } | undefined;
      if (!detail?.vaultPath || detail.vaultPath === selectedVault) void reload();
    };
    window.addEventListener(CLOUD_ACCOUNTS_EVENT, onChanged);
    return () => window.removeEventListener(CLOUD_ACCOUNTS_EVENT, onChanged);
  }, [reload, selectedVault]);

  useEffect(() => {
    if (!isActiveVault || backfilled.current) return;
    backfilled.current = true;
    // Files first, then the calendar-only card. A Google account split across two
    // cards needs BOTH sides to carry an identity before the reconcile is allowed
    // to fold them. Sequential on purpose: each step persists, and the second
    // reads what the first wrote.
    void backfillSyncIdentity(selectedVault)
      .then((next) => {
        if (next) setRecords(next);
        return backfillCalendarIdentity(selectedVault);
      })
      .then((next) => {
        if (next) setRecords(next);
      });
  }, [isActiveVault, selectedVault]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(records.map(async (r) => ((await canUnifyAccountLogin(selectedVault, r)) ? r.id : null)))
      .then((ids) => {
        if (!cancelled) setUnifiable(new Set(ids.filter((x): x is string => !!x)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [records, selectedVault]);

  /**
   * P3: whether this device can actually OPEN the vault's file provider. The
   * card used to hang on the slot alone, so a broker-backed account whose
   * per-service slot is empty by design read as "connected" while nothing
   * synced (finding 2026-08-19). Shared rule, same one the loader uses.
   */
  const [fileAccess, setFileAccess] = useState<FileSyncAccess | null>(null);
  useEffect(() => {
    let cancelled = false;
    void readFileSyncAccess(selectedVault)
      .then((next) => {
        if (!cancelled) setFileAccess(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [records, selectedVault]);

  // The state of each card ON THIS DEVICE - one rule for list and page, and
  // the same as the phone's (plan "Verbinden", V0): a Google or Microsoft card
  // is its own sign-in. `undefined` entries stay out of the map: a files-only
  // account of another kind keeps its credential in the provider's own slot,
  // and the sync status answers that better than a chip.
  const [signInStates, setSignInStates] = useState<Map<string, DeviceSignInState>>(new Map());
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      records.map(async (r) => [r.id, await accountSignInStateHere(selectedVault, r, fileAccess?.blocked ? (fileAccess.signedOut ? "signedOut" : "blocked") : null)] as const),
    )
      .then((pairs) => {
        if (cancelled) return;
        setSignInStates(new Map(pairs.filter((p): p is readonly [string, DeviceSignInState] => !!p[1])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [records, selectedVault, fileAccess]);

  /**
   * "One sign-in for all services" is for a card still signed in per service.
   * A card without any sign-in on this device needs signing in - the same act,
   * under the plan's one word (plan "Verbinden", V0).
   */
  const unifyOffered = (id: string) => unifiable.has(id) && signInStates.get(id) !== "signin";

  const filesAccount = records.find((r) => r.services.files);
  const detail = mode.kind === "detail" || mode.kind === "service" ? records.find((r) => r.id === mode.id) : undefined;
  /** What the open account's page shows besides its state: who signs in where, one line per service. */
  const [facts, setFacts] = useState<{ id: string; facts: AccountPageFacts } | null>(null);
  useEffect(() => {
    if (!detail) return;
    let alive = true;
    void readAccountPageFacts(selectedVault, detail, runtime).then((next) => { if (alive) setFacts({ id: detail.id, facts: next }); }).catch(() => undefined);
    return () => { alive = false; };
  }, [detail, selectedVault, runtime]);
  const detailFamily = detail && (detail.family === "google" || detail.family === "microsoft") ? detail.family : null;
  useEffect(() => {
    if (!detailFamily) return;
    let alive = true;
    void (async () => {
      const stored = await readDeviceAccess(detailFamily, selectedVault);
      const resolved = await deviceAccess(detailFamily, selectedVault);
      if (alive) setAccessInfo({ family: detailFamily, stored, resolved });
    })();
    return () => { alive = false; };
  }, [detailFamily, selectedVault]);
  useEffect(() => {
    if (!detail) return;
    let alive = true;
    void (async () => {
      const mailKind = detail.services.mail ? (await listMailAccounts(selectedVault)).find((m) => m.id === detail.services.mail!.mailAccountId)?.kind : undefined;
      if (alive) setRenewable(detail.family !== "google" && detail.family !== "microsoft" ? true : cardOAuthServices(detail, mailKind).length > 0);
    })();
    return () => { alive = false; };
  }, [detail, selectedVault]);

  const signInText = (err: unknown): string => {
    if (err instanceof SignInWrongAccountError) return t("cloudAccounts.wrongAccount", { expected: err.expected, actual: err.actual });
    if (err instanceof SignInNothingGrantedError) return t("cloudAccounts.nothingGranted");
    if (err instanceof AccessUnavailableError) return t(accessProblemKey(err.problem));
    return oauthErrorText(err);
  };

  /** This desktop signs in with an own client and the build carries the standard one (plan "Verbinden", V0). */
  const standardAvailable = !!accessInfo && standardAccessAvailable(accessInfo.family, "desktop", accessInfo.stored, import.meta.env as unknown as Record<string, unknown>);

  /** "Use standard sign-in": this desktop's access becomes the standard one, then the card signs in with it. */
  const switchToStandard = async (record: CloudAccountRecord) => {
    const family = record.family === "google" || record.family === "microsoft" ? record.family : null;
    if (!family) return;
    await saveDeviceAccess(family, { source: "plainva" });
    setAccessInfo({ family, stored: { source: "plainva" }, resolved: await deviceAccess(family, selectedVault) });
    await signInCard(record, []);
  };

  /**
   * Google and Microsoft: adding a service and signing in again are the same
   * act - one consent for everything the card carries plus what is added
   * (plan E2). Each service then says its own result on the page.
   */
  const signInCard = async (record: CloudAccountRecord, add: CloudServiceId[], mailPassword?: { email: string; pass: string }) => {
    const family = record.family === "google" || record.family === "microsoft" ? record.family : null;
    if (!family) return;
    setReconStatus({});
    setBusy(true);
    try {
      const outcome = await signInCloudAccount(selectedVault, () => runtimeRef.current, { family, cardId: record.id, add, ...(mailPassword ? { mailPassword } : {}) });
      const next: Partial<Record<CloudServiceId, ServiceRunStatus>> = {};
      for (const row of outcome.rows) {
        next[row.service] = row.state === "active"
          ? { state: "ok" }
          : row.state === "notGranted"
            ? { state: "error", reason: "permissions", detail: t("cloudAccounts.notGranted") }
            : row.state === "needsPassword"
              ? { state: "error", detail: t("cloudAccounts.needsAppPassword") }
              : { state: "error", detail: row.detail };
      }
      setReconStatus(next);
      setGmailPasswordFor(null);
    } catch (err) {
      // A refused own client is not retried: the way on is the standard sign-in.
      if (isOwnClientRejected(err) && standardAvailable) toast.error(signInText(err), { label: t("accountAccess.useStandard"), run: () => void switchToStandard(record) });
      else toast.error(signInText(err));
    } finally {
      setBusy(false);
      void reload();
    }
  };

  /** Headless service enable from the detail toggles, where slots allow it. */
  const enableService = async (record: CloudAccountRecord, service: CloudServiceId) => {
    if (record.family === "google" || record.family === "microsoft") {
      // Gmail outside the consent asks for its app password right here, at the
      // same card - never "use the wizard", never a second account (E5).
      if (record.family === "google" && service === "mail") {
        const resolved = await deviceAccess("google", selectedVault);
        if (resolved.ok && !resolved.access.mail) {
          setGmailPasswordFor(record.id);
          return;
        }
      }
      await signInCard(record, [service]);
      return;
    }
    // Independent grants preserve the other services while this one is added.
    const req: ConnectRequest = {
      context: { vaultId: selectedVault, cloudAccountId: record.id, expectedIdentity: record.verifiedProviderIdentity },
      family: record.family,
      flavor: record.flavor,
      services: [service],
      consentServices: [service],
      byoClientId: record.byoClientId,
    };
    if (record.family === "webdav") {
      // Derive the missing endpoint from the stored files slot (same server).
      const creds = await credentialManager.getWebDavCredentials(selectedVault);
      if (!creds || !looksLikeNextcloud(creds.url)) {
        toast.info(t("cloudAccounts.useWizardHint"));
        return;
      }
      const endpoints = nextcloudEndpoints(creds.url, creds.user);
      if (!endpoints) {
        toast.info(t("cloudAccounts.useWizardHint"));
        return;
      }
      req.webdav = { filesUrl: endpoints.files, caldavUrl: endpoints.caldav, user: creds.user, pass: creds.pass };
    } else if (suiteProvider(record.family)) {
      // App-password suites: reuse the ONE credential from an already
      // connected service of this suite (files slot or CalDAV slot) against
      // the catalog endpoints — that is the suite promise. No reusable
      // credential = wizard.
      const sd = suiteProvider(record.family)!;
      let user = "";
      let pass = "";
      if (record.services.files) {
        const creds = await credentialManager.getWebDavCredentials(selectedVault);
        if (creds) {
          user = creds.user;
          pass = creds.pass;
        }
      }
      if (!pass && record.services.calendar) {
        const pc = await getPimCredentials(selectedVault, record.services.calendar.pimAccountId);
        if (pc?.kind === "caldav") {
          user = pc.user;
          pass = pc.pass;
        }
      }
      if (!pass) {
        toast.info(t("cloudAccounts.useWizardHint"));
        return;
      }
      req.webdav = { filesUrl: sd.endpoints.webdavUrl ?? "", caldavUrl: sd.endpoints.caldavUrl ?? "", user, pass };
      if (service === "mail") {
        req.imap = {
          email: user,
          host: sd.endpoints.imapHost ?? "",
          port: sd.endpoints.imapPort ?? 993,
          smtpHost: sd.endpoints.smtpHost,
          smtpPort: sd.endpoints.smtpPort,
          pass,
        };
      }
    } else if (record.family === "imap") {
      toast.info(t("cloudAccounts.useWizardHint"));
      return;
    }
    setBusy(true);
    try {
      const result = await runConnectSequence(selectedVault, runtime, req, () => undefined);
      const { records: next } = await bindConnectResult(selectedVault, runtime, req, result, record.id);
      setRecords(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (record: CloudAccountRecord, confirm = removeAccountConfirm(accountServices(record))) => {
    // What goes and what stays, said before it happens (E2).
    const ok = await appConfirm({
      title: t("cloudAccounts.removeConfirmTitle"),
      message: t("cloudAccounts.removeConfirmMsg", {
        account: record.label || familyLabel(record.family, record.flavor),
        goes: confirm.goes.map((key) => t(key)).join("; "),
        stays: confirm.stays.map((key) => t(key)).join("; "),
      }),
      confirmLabel: t("common.delete"),
      kind: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      setRecords(await removeCloudAccount(selectedVault, runtime, record));
      setMode({ kind: "list" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** "Sign out on this device" (plan "Verbinden", V0) - no confirmation (E2): signing in again undoes it. */
  const signOutHere = async (record: CloudAccountRecord) => {
    setBusy(true);
    try {
      setRecords(await signOutCloudAccountHere(selectedVault, runtime, record));
      setReconStatus({});
      toast.success(t("cloudAccounts.signedOutHere"));
    } catch (err) {
      toast.error(oauthErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  /** The head's one button: OAuth and Dropbox sign in through the provider, a password account opens its password entry. */
  const headSignIn = (record: CloudAccountRecord) => {
    const access = accountAccessOf(record.family);
    if (access.kind === "password" || access.kind === "keys") {
      setPasswordOpen(record.id);
      return;
    }
    void reconnect(record);
  };

  /** A service switch (E3): a carried service is switched off or on for the vault, a missing one is added. */
  const switchService = async (record: CloudAccountRecord, service: CloudServiceId, on: boolean) => {
    if (on && !accountServices(record).includes(service)) {
      await enableService(record, service);
      return;
    }
    setBusy(true);
    try {
      // The last settings push before the file sync stops, so the other devices learn of it (review finding 4).
      const worker = isActiveVault ? syncWorker : null;
      setRecords(await setAccountServiceOff(selectedVault, runtime, record, service, !on, worker?.pushSettingsNow ? async () => { await worker.pushSettingsNow?.(); } : undefined));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const reconnect = async (record: CloudAccountRecord) => {
    if (record.family === "google" || record.family === "microsoft") {
      await signInCard(record, []);
      return;
    }
    setReconStatus({});
    setBusy(true);
    try {
      await rerunAccountAuth(selectedVault, runtime, record, (service, st) => setReconStatus((prev) => ({ ...prev, [service]: st })));
      toast.success(t("pim.connected"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      void reload();
    }
  };

  const persistByoId = async (record: CloudAccountRecord, value: string) => {
    const next = records.map((r) => (r.id === record.id ? { ...r, byoClientId: value.trim() || undefined } : r));
    await saveCloudAccounts(selectedVault, next);
    setRecords(next);
  };

  const serviceNames = (services: readonly CloudServiceId[]) => services
    .map((service) => serviceLabel(service))
    .join(", ");

  const confirmRepair = async (
    plan: GuidedAccountRepairPlan,
    target: CloudAccountRecord,
  ): Promise<boolean> => {
    const sourceNames = plan.merges[0].sourceIds
      .map((id) => records.find((record) => record.id === id)?.label || id)
      .join(", ");
    return appConfirm({
      title: t("cloudAccounts.repairConfirmTitle"),
      message: t("cloudAccounts.repairConfirmMessage", {
        target: target.label || familyLabel(target.family, target.flavor),
        sources: sourceNames,
        services: serviceNames(plan.merges[0].affectedServices),
      }),
      confirmLabel: t("cloudAccounts.repairConfirmAction"),
      kind: "warning",
    });
  };

  /**
   * E3's fallback: two cards of ONE account that cannot be folded automatically
   * because neither carries a provider-verified identity.
   *
   * The automatic path groups by an identity the provider confirmed, and the
   * review list groups same-LABELLED cards — but a card whose identity could
   * never be fetched has no label either, so nothing offered it a way out. This
   * is that way out, and it is deliberately a statement by the user ("this is
   * the same account") rather than a guess from anything on screen.
   */
  const mergeManually = async (target: CloudAccountRecord, sourceId: string) => {
    if (!isActiveVault || !runtime || !dbAdapter || !sourceId) return;
    setBusy(true);
    try {
      const store = await getSettingsStore();
      const result = await guideDesktopAccountRepair(
        store,
        selectedVault,
        { accountIds: [sourceId, target.id], targetId: target.id },
        (plan) => confirmRepair(plan, target),
        runtime.cache,
        dbAdapter,
      );
      if (result.status === "repaired") {
        toast.success(t("cloudAccounts.repairDone"));
        setMergeSource("");
        setMode({ kind: "list" });
        await reload();
      }
    } catch {
      toast.error(t("cloudAccounts.repairFailed"));
    } finally {
      setBusy(false);
    }
  };

  const repairAmbiguous = async (need: AccountRepairNeed, target: CloudAccountRecord) => {
    if (!isActiveVault || !runtime || !dbAdapter) return;
    setBusy(true);
    try {
      const store = await getSettingsStore();
      const result = await guideDesktopAccountRepair(
        store,
        selectedVault,
        { accountIds: need.accountIds, targetId: target.id },
        (plan) => confirmRepair(plan, target),
        runtime.cache,
        dbAdapter,
      );
      if (result.status === "repaired") {
        toast.success(t("cloudAccounts.repairDone"));
        await reload();
      }
    } catch {
      toast.error(t("cloudAccounts.repairFailed"));
    } finally {
      setBusy(false);
    }
  };

  /* ---------- wizard ---------- */
  if (mode.kind === "wizard") {
    return (
      <div>
        <AreaHead areaId="cloudAccounts" />
        <CloudAccountsWizard
          initialFamily={initialProvider}
          vaultPath={selectedVault}
          runtime={runtime}
          records={records}
          onDone={(next) => {
            setRecords(next);
            setMode({ kind: "list" });
          }}
          onCancel={() => setMode({ kind: "list" })}
        />
      </div>
    );
  }

  /* ---------- one service of one account (level 3, plan "Verbinden" V3) ---------- */
  if (mode.kind === "service" && detail) {
    const row = accountPageModel({
      family: detail.family,
      services: accountServices(detail),
      off: detail.off,
      signIn: signInStates.get(detail.id),
      canSignIn: true,
      signedInHere: false,
    }).services.find((entry) => entry.service === mode.service);
    return (
      <div>
        <AreaHead areaId="cloudAccounts" />
        <AccountServicePage
          vaultPath={selectedVault}
          record={detail}
          service={mode.service}
          on={!!row?.on}
          busy={busy}
          isActiveVault={isActiveVault}
          runtime={runtime}
          onToggle={(on) => void switchService(detail, mode.service, on)}
          onBack={() => setMode({ kind: "detail", id: detail.id })}
          onOpenArea={(area) => onOpenArea?.(area)}
        />
      </div>
    );
  }

  /* ---------- account detail: five sections, always in this order (plan "Verbinden", V2) ---------- */
  if (detail) {
    const { name, identity } = accountTitle(detail);
    const detailState = signInStates.get(detail.id);
    const model = accountPageModel({
      family: detail.family,
      services: accountServices(detail),
      off: detail.off,
      signIn: detailState,
      canSignIn: renewable,
      signedInHere: detailState !== undefined && detailState !== "signin",
      summaries: facts?.id === detail.id ? facts.facts.summaries : undefined,
    });
    const accountFacts = facts?.id === detail.id ? facts.facts : null;
    const passwordServices = passwordServicesOf(detail);
    const lastCheck = lastChecks.get(detail.id);
    const confirm = removeAccountConfirm(accountServices(detail));
    return (
      <div>
        <AreaHead areaId="cloudAccounts" />
        {/* 1 - the head: one state, at most one button. */}
        <div className="pv-acct-head" data-testid="cloudacct-head">
          <IconButton label={t("cloudAccounts.back")} onClick={() => setMode({ kind: "list" })} data-testid="cloudacct-detail-back">
            <ArrowLeft size={ICON.ui} />
          </IconButton>
          <AccountMark family={detail.family} flavor={detail.flavor} />
          <div className="pv-acct-who">
            <div className="pv-acct-name">{name}</div>
            {identity && <div className="pv-acct-id">{identity}</div>}
          </div>
          {model.head.state && (
            <span className={cx("pv-acct-state", `pv-acct-state--${model.head.state}`)} data-testid="cloudacct-state" data-state={model.head.state}>
              {t(accountStateKey(model.head.state))}
            </span>
          )}
          {model.head.action && (
            <Button variant="primary" icon={<RotateCw size={ICON.meta} />} disabled={busy} onClick={() => headSignIn(detail)} data-testid="cloudacct-signin">
              {t(model.head.action.labelKey)}
            </Button>
          )}
        </div>
        {unifyOffered(detail.id) && <SettingCardNote>{t("cloudAccounts.legacySignIn")}</SettingCardNote>}
        {Object.values(reconStatus).some((status) => status.reason === "permissions") && (
          <Banner kind="warning" rounded>{t("cloudAccounts.loginGrantIncomplete")}</Banner>
        )}
        {Object.keys(reconStatus).length > 0 && (
          <SettingCard>
            {(Object.keys(reconStatus) as CloudServiceId[]).map((service) => {
              const st = reconStatus[service];
              const kind = st?.state === "ok" ? "ok" : st?.state === "error" ? "err" : "wait";
              const Icon = kind === "ok" ? Check : kind === "err" ? CircleAlert : Clock;
              return (
                <div key={service} className={`pv-svcstat pv-svcstat--${kind}`}>
                  <span className="pv-svcstat-icon">
                    <Icon size={ICON.ui} />
                  </span>
                  <div className="pv-svcstat-main">
                    <div className="pv-svcstat-label">{serviceLabel(service)}</div>
                    <div className="pv-svcstat-sub">
                      {st?.state === "ok" ? t("cloudAccounts.statusConnected") : (st?.detail ?? t("pim.connecting"))}
                    </div>
                  </div>
                </div>
              );
            })}
          </SettingCard>
        )}

        {/* 2 - the services: switch, one line of state, the way to this account's settings. */}
        <SettingCard label={t("cloudAccounts.servicesGroup")}>
          {model.services.map((row) => {
            const Icon = SERVICE_ICONS[row.service];
            const carried = row.target !== null;
            const takenElsewhere = row.service === "files" && !carried && !!filesAccount;
            const needsRuntime = row.service === "calendar" && !carried && !runtime;
            const disabled = busy || takenElsewhere || needsRuntime || !isActiveVault;
            return (
              <div key={row.service} className={cx("pv-svcline", !row.on && "is-off")} data-testid={`cloudacct-service-${row.service}`} data-on={row.on}>
                <span className="pv-svcline-icon">
                  <Icon size={ICON.ui} />
                </span>
                <div className="pv-svcline-main">
                  <div className="pv-svcline-title">{serviceLabel(row.service)}</div>
                  <div className="pv-svcline-desc">
                    {takenElsewhere
                      ? t("cloudAccounts.filesTakenDetail", { account: filesAccount!.label || familyLabel(filesAccount!.family, filesAccount!.flavor) })
                      : needsRuntime
                        ? t("pim.openVaultFirst")
                        : row.summary ?? t(row.stateKey)}
                  </div>
                </div>
                <div className="pv-svcline-ctrl">
                  <Switch
                    checked={row.on}
                    disabled={disabled}
                    label={serviceLabel(row.service)}
                    onChange={(checked) => void switchService(detail, row.service, checked)}
                  />
                  {row.target && (
                    <IconButton label={t("cloudAccounts.serviceSettings", { service: serviceLabel(row.service) })} onClick={() => setMode({ kind: "service", id: detail.id, service: row.service })} data-testid={`cloudacct-service-open-${row.service}`}>
                      <ChevronRight size={ICON.ui} />
                    </IconButton>
                  )}
                </div>
              </div>
            );
          })}
        </SettingCard>

        {gmailPasswordFor === detail.id && (
          <SettingCard label={t("cloudAccounts.gmailPasswordGroup")}>
            <SettingCardNote>{t("cloudAccounts.gmailPasswordHint", { account: gmailAddress || detail.label })}</SettingCardNote>
            <SettingRow label={t("cloudAccounts.appPassword")} wide>
              <TextInput type="password" value={gmailPassword} onChange={(e) => setGmailPassword(e.target.value)} data-testid="cloudacct-gmail-password" />
            </SettingRow>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
              <Button variant="ghost" onClick={() => setGmailPasswordFor(null)}>{t("common.cancel")}</Button>
              <Button
                variant="primary"
                disabled={busy || !gmailPassword || !gmailAddress}
                data-testid="cloudacct-gmail-password-save"
                onClick={() => void signInCard(detail, ["mail"], { email: gmailAddress, pass: gmailPassword }).then(() => setGmailPassword(""))}
              >
                {t("pim.connect")}
              </Button>
            </div>
          </SettingCard>
        )}

        {/* 3 - how this device signs in: the same place for every provider. */}
        <SettingCard label={t("cloudAccounts.accessGroup")}>
          {model.access.kind === "oauth" && detailFamily && accessInfo?.family === detailFamily && !editAccess && (
            <SettingRow
              label={t("accountAccess.lineLabel")}
              desc={accessLineText(accessInfo.resolved, (key, options) => t(key, options), accessProblemKey)}
            >
              <Button variant="secondary" size="sm" data-testid="cloudacct-access-change" onClick={() => setEditAccess(true)}>{t("accountAccess.change")}</Button>
            </SettingRow>
          )}
          {model.access.kind === "oauth" && detailFamily && accessInfo?.family === detailFamily && editAccess && (
            <OAuthAccessEditor
              family={detailFamily}
              platform="desktop"
              value={accessInfo.stored}
              plainvaAvailable={detailFamily === "microsoft" || !!plainvaGoogleClient(import.meta.env as unknown as Record<string, unknown>, "desktop")}
              onSave={async (next) => {
                await saveDeviceAccess(detailFamily, next);
                setAccessInfo({ family: detailFamily, stored: next, resolved: await deviceAccess(detailFamily, selectedVault) });
                setEditAccess(false);
              }}
              onCancel={() => setEditAccess(false)}
            />
          )}
          {model.access.kind === "appKey" && (
            <SettingRow label={t("settings.useOwnAppId")} desc={t("cloudAccounts.byoAccountHint")}>
              <TextInput
                defaultValue={detail.byoClientId ?? accountFacts?.appKey ?? ""}
                placeholder={t("settings.appKey")}
                onBlur={(e) => void persistByoId(detail, e.target.value)}
                style={{ width: 220 }}
                data-testid="cloudacct-byo-id"
              />
            </SettingRow>
          )}
          {(model.access.kind === "password" || model.access.kind === "keys") && (
            <>
              {accountFacts?.server && <SettingRow label={t("cloudAccounts.accessServer")} desc={accountFacts.server}>{null}</SettingRow>}
              {model.access.kind === "keys"
                ? accountFacts?.accessKeyId && <SettingRow label={t("cloudAccounts.accessKeyId")} desc={accountFacts.accessKeyId}>{null}</SettingRow>
                : accountFacts?.user && <SettingRow label={t("cloudAccounts.accessUser")} desc={accountFacts.user}>{null}</SettingRow>}
              <SettingRow
                label={t(model.access.kind === "keys" ? "cloudAccounts.accessSecretKey" : model.access.appPassword ? "cloudAccounts.appPassword" : "settings.password")}
                desc={detailState === "signin" ? t("deviceSignIn.needed") : "••••••••"}
              >
                <Button variant="secondary" size="sm" disabled={passwordServices.length === 0} data-testid="cloudacct-password-change" onClick={() => setPasswordOpen(passwordOpen === detail.id ? null : detail.id)}>
                  {t("accountAccess.change")}
                </Button>
              </SettingRow>
            </>
          )}
        </SettingCard>
        {passwordOpen === detail.id && passwordServices.length > 0 && <AccountPasswordChangePanel ports={desktopPasswordChangePorts(selectedVault, detail, runtime, (status) => { if (status.phase === "complete") void reload(); })} />}

        {/* 4 - check connection: one row per service, the action that helps. */}
        {model.check && (
          <SettingCard label={t("cloudAccounts.checkConnection")}>
            <SettingRow
              label={lastCheck ? t("cloudAccounts.checkLast", { time: lastCheck.time }) : t("cloudAccounts.checkConnection")}
              desc={lastCheck ? t(lastCheck.ok ? "cloudAccounts.checkAllOk" : "cloudAccounts.checkSomeFailed") : t("cloudAccounts.checkHint")}
            >
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => setChecking(detail.id)} data-testid="cloudacct-check-open">
                {t("cloudAccounts.checkConnection")}
              </Button>
            </SettingRow>
          </SettingCard>
        )}
        {checking === detail.id && (
          <AccountCheckModal
            vaultPath={selectedVault}
            record={detail}
            runtime={runtime}
            standardAvailable={standardAvailable}
            onUseStandard={() => void switchToStandard(detail)}
            onSignInAgain={() => headSignIn(detail)}
            onAppPassword={() => setGmailPasswordFor(detail.id)}
            onChecked={(rows) => setLastChecks((prev) => new Map(prev).set(detail.id, { time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), ok: rows.every((entry) => entry.state === "ok") }))}
            onClose={() => setChecking(null)}
          />
        )}

        {/* 5 - the end: sign out here, or remove from the vault. */}
        <SettingCard label={t("cloudAccounts.endGroup")}>
          <div className="pv-acct-ctlrow">
            {model.end.signOut && (
              <Button variant="secondary" icon={<LogOut size={ICON.meta} />} disabled={busy} onClick={() => void signOutHere(detail)} data-testid="cloudacct-signout" data-tip={t("cloudAccounts.signOutHereHint")}>
                {t("cloudAccounts.signOutHere")}
              </Button>
            )}
            <Button variant="danger-soft" icon={<Trash2 size={ICON.meta} />} disabled={busy} onClick={() => void remove(detail, confirm)} data-testid="cloudacct-remove">
              {t("cloudAccounts.removeAccountEllipsis")}
            </Button>
          </div>
          <SettingCardNote>{t("cloudAccounts.endHint")}</SettingCardNote>
        </SettingCard>

        {/* E3's fallback - only where there is a second card of the same provider to point at. */}
        {(() => {
          const others = manualMergeCandidates(records, detail);
          if (others.length === 0) return null;
          return (
            <SettingCard label={t("cloudAccounts.mergeManualGroup")}>
              <SettingCardNote>{t("cloudAccounts.mergeManualHint")}</SettingCardNote>
              <SettingRow label={t("cloudAccounts.mergeManualPick")}>
                <Select
                  value={mergeSource}
                  onChange={setMergeSource}
                  ariaLabel={t("cloudAccounts.mergeManualPick")}
                  data-testid="cloudacct-merge-source"
                  options={[
                    { value: "", label: t("cloudAccounts.mergeManualNone") },
                    ...others.map((r) => ({
                      value: r.id,
                      label: r.label || familyLabel(r.family, r.flavor),
                    })),
                  ]}
                />
                <Button
                  variant="secondary"
                  disabled={busy || !mergeSource || !isActiveVault || !runtime || !dbAdapter}
                  onClick={() => void mergeManually(detail, mergeSource)}
                  data-testid="cloudacct-merge-manual"
                >
                  {t("cloudAccounts.mergeManualAction")}
                </Button>
              </SettingRow>
            </SettingCard>
          );
        })()}
      </div>
    );
  }

  /* ---------- account list (mockup screen 1) ---------- */
  return (
    <div>
      <AreaHead areaId="cloudAccounts" />
      {!isActiveVault && <SettingCardNote className="pv-setrow--note">{t("pim.openVaultFirst")}</SettingCardNote>}
      {repairNeeds.length > 0 && (
        <SettingCard label={t("cloudAccounts.repairTitle")}>
          <SettingCardNote>{t("cloudAccounts.repairHint")}</SettingCardNote>
          {repairNeeds.flatMap((need, needIndex) =>
            need.accountIds.map((accountId) => {
              const record = records.find((candidate) => candidate.id === accountId);
              if (!record) return [];
              return (
                <SettingRow
                  key={`${needIndex}:${accountId}`}
                  label={record.label || familyLabel(record.family, record.flavor)}
                  desc={serviceNames(accountServices(record))}
                >
                  <Button
                    variant="secondary"
                    disabled={busy || !isActiveVault || !runtime || !dbAdapter}
                    onClick={() => void repairAmbiguous(need, record)}
                    data-testid="cloudacct-repair-target"
                  >
                    {t("cloudAccounts.repairKeep")}
                  </Button>
                </SettingRow>
              );
            }),
          )}
        </SettingCard>
      )}
      <SettingCard label={t("cloudAccounts.connectedGroup")}>
        {records.length === 0 && (
          <EmptyState title={t("cloudAccounts.noneYet")} icon={<Users size={ICON.empty} />}>
            {t("settings.pageDescCloudAccounts")}
          </EmptyState>
        )}
        {records.map((record) => {
          const { name, identity } = accountTitle(record);
          return (
            <button
              key={record.id}
              type="button"
              className="pv-acct"
              onClick={() => {
                setReconStatus({});
                setMode({ kind: "detail", id: record.id });
              }}
              data-testid="cloudacct-row"
            >
              <AccountMark family={record.family} flavor={record.flavor} />
              <div className="pv-acct-who">
                <div className="pv-acct-name">{name}</div>
                <div className="pv-acct-id">{identity ?? familyLabel(record.family, record.flavor)}</div>
              </div>
              <span className="pv-svcchip-row">
                {accountServices(record).map((s) => (
                  <ServiceChip key={s} service={s} off={isServiceOff(record, s)} />
                ))}
                {/* ONE state per account, read from its own sign-in (plan "Verbinden", V2) -
                    the same pill as in the head of its page. */}
                {(() => {
                  const state = accountStateOf(signInStates.get(record.id));
                  return state ? (
                    <span className={cx("pv-acct-state", `pv-acct-state--${state}`)} data-testid="cloudacct-row-state" data-state={state}>
                      {t(accountStateKey(state))}
                    </span>
                  ) : null;
                })()}
              </span>
              <span className="pv-acct-chevron">
                <ChevronRight size={ICON.ui} />
              </span>
            </button>
          );
        })}
        {/* An account still signed in once per service goes half-dark when one
            renewal fails (finding 2026-07-28): said once, the way out is "Sign in
            again" on its page. */}
        {[...unifiable].some(unifyOffered) && (
          <SettingCardNote>{t("cloudAccounts.legacySignIn")}</SettingCardNote>
        )}
        {filesAccount && (
          <SettingCardNote>
            {t("cloudAccounts.filesXorNote", { account: filesAccount.label || familyLabel(filesAccount.family, filesAccount.flavor) })}
          </SettingCardNote>
        )}
      </SettingCard>
      <div style={{ marginTop: "var(--space-3)" }}>
        <Button
          variant="primary"
          icon={<Plus size={ICON.meta} />}
          disabled={!isActiveVault}
          onClick={() => setMode({ kind: "wizard" })}
          data-testid="cloudacct-add"
        >
          {t("cloudAccounts.addAccount")}
        </Button>
      </div>
    </div>
  );
};
