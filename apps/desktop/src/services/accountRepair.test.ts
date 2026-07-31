import { describe, expect, it } from "vitest";
import {
  accountRepairBindingKey,
  cloudRegistryToLogical,
  emptyAccountMap,
  executeAccountRepair,
  mergeCloudRegistryMapped,
  planAccountRepair,
  recoverAccountRepair,
  type AccountRepairJournal,
  type AccountRepairPorts,
  type CloudAccountRecord,
  type ProfileAccountMap,
} from "@plainva/ui";

const verified = { issuer: "google", subject: "provider-user-1" };

const card = (over: Partial<CloudAccountRecord>): CloudAccountRecord => ({
  id: "card-a",
  family: "google",
  label: "person@example.invalid",
  verifiedProviderIdentity: verified,
  services: {},
  ...over,
});

function repairPorts(initial: {
  accounts: CloudAccountRecord[];
  map?: ProfileAccountMap;
  usable?: string[];
  failMapWrite?: boolean;
}) {
  let mapWriteFailed = false;
  const state = {
    accounts: structuredClone(initial.accounts),
    map: structuredClone(initial.map ?? emptyAccountMap()),
    journal: null as AccountRepairJournal | null,
    needs: [] as Awaited<ReturnType<typeof planAccountRepair>>["needsReview"],
    writes: [] as string[],
  };
  const ports: AccountRepairPorts = {
    listAccounts: async () => structuredClone(state.accounts),
    replaceAccounts: async (accounts) => {
      state.writes.push("accounts");
      state.accounts = structuredClone(accounts);
    },
    loadAccountMap: async () => structuredClone(state.map),
    saveAccountMap: async (map) => {
      state.writes.push("map");
      if (initial.failMapWrite && !mapWriteFailed) {
        mapWriteFailed = true;
        throw new Error("injected map write failure");
      }
      state.map = structuredClone(map);
    },
    usableBindings: async () => initial.usable ?? [],
    loadJournal: async () => structuredClone(state.journal),
    saveJournal: async (journal) => {
      state.writes.push("journal");
      state.journal = structuredClone(journal);
    },
    clearJournal: async () => {
      state.writes.push("clear-journal");
      state.journal = null;
    },
    saveNeedsReview: async (needs) => {
      state.writes.push("needs");
      state.needs = structuredClone(needs);
    },
    now: () => "2026-07-31T12:00:00.000Z",
  };
  return { state, ports };
}

describe("verified account-card repair", () => {
  it("T11 merges an exact provider identity and retains the card with a usable local auth slot", () => {
    const accounts = [
      card({
        id: "card-a",
        label: "Old label",
        services: { files: { provider: "drive" } },
      }),
      card({
        id: "card-z",
        label: "Current label",
        services: {
          calendar: { pimAccountId: "pim-working" },
          mail: { mailAccountId: "mail-working" },
        },
      }),
    ];
    const map: ProfileAccountMap = {
      ...emptyAccountMap(),
      cloudLocalToLogical: {
        "card-a": "logical-old",
        "card-z": "logical-current",
      },
    };

    const plan = planAccountRepair(accounts, map, [
      accountRepairBindingKey("account", "card-z"),
      accountRepairBindingKey("pim", "pim-working"),
    ]);

    expect(plan.merges).toEqual([
      {
        targetId: "card-z",
        sourceIds: ["card-a"],
        affectedServices: ["calendar", "files", "mail"],
      },
    ]);
    expect(plan.accounts).toEqual([
      card({
        id: "card-z",
        label: "Current label",
        services: {
          files: { provider: "drive" },
          calendar: { pimAccountId: "pim-working" },
          mail: { mailAccountId: "mail-working" },
        },
      }),
    ]);
    expect(plan.accountMap.cloudLocalToLogical).toEqual({
      "card-z": "logical-current",
    });
    expect(plan.accountMap.cloudLogicalAliases).toEqual({
      "logical-old": "logical-current",
    });
  });

  it("T12 leaves same-labelled unverified cards unchanged and returns structured review needs", () => {
    const accounts = [
      card({ id: "one", verifiedProviderIdentity: undefined, services: { calendar: { pimAccountId: "p1" } } }),
      card({ id: "two", verifiedProviderIdentity: undefined, services: { mail: { mailAccountId: "m1" } } }),
    ];

    const plan = planAccountRepair(accounts, emptyAccountMap(), []);

    expect(plan.merges).toEqual([]);
    expect(plan.accounts).toEqual(accounts);
    expect(plan.needsReview).toEqual([
      {
        reason: "unverified-identity",
        family: "google",
        accountIds: ["one", "two"],
        affectedServices: ["calendar", "mail"],
      },
    ]);
  });

  it("keeps the retired logical id as an alias so an old publisher cannot recreate the card", () => {
    const map: ProfileAccountMap = {
      ...emptyAccountMap(),
      cloudLocalToLogical: {
        "card-a": "logical-old",
        "card-z": "logical-current",
      },
    };
    const plan = planAccountRepair([
      card({ id: "card-a" }),
      card({ id: "card-z" }),
    ], map, [accountRepairBindingKey("account", "card-z")]);

    const importedOldCard = card({ id: "logical-old", label: "Legacy label" });
    const merged = mergeCloudRegistryMapped(plan.accounts, [importedOldCard], plan.accountMap);

    expect(merged.records).toHaveLength(1);
    expect(merged.logicalToLocal.get("logical-old")).toBe("card-z");
    expect(cloudRegistryToLogical(merged.records, plan.accountMap)[0].id).toBe("logical-current");
  });

  it("writes a durable snapshot journal before the first mutation", async () => {
    const { state, ports } = repairPorts({
      accounts: [
        card({ id: "one", services: { files: { provider: "drive" } } }),
        card({ id: "two", services: { calendar: { pimAccountId: "p2" } } }),
      ],
    });

    const result = await executeAccountRepair(ports);

    expect(result.merges).toHaveLength(1);
    expect(state.writes.slice(0, 3)).toEqual(["journal", "accounts", "map"]);
    expect(state.journal).toBeNull();
    expect(state.accounts).toHaveLength(1);
  });

  it("rolls every registry write back when a later write fails", async () => {
    const original = [
      card({ id: "one", services: { files: { provider: "drive" } } }),
      card({ id: "two", services: { calendar: { pimAccountId: "p2" } } }),
    ];
    const { state, ports } = repairPorts({ accounts: original, failMapWrite: true });

    await expect(executeAccountRepair(ports)).rejects.toThrow("injected map write failure");

    expect(state.accounts).toEqual(original);
    expect(state.map).toEqual(emptyAccountMap());
    expect(state.journal).toBeNull();
  });

  it("restores an interrupted repair from its persisted snapshot", async () => {
    const original = [
      card({ id: "one", services: { files: { provider: "drive" } } }),
      card({ id: "two", services: { calendar: { pimAccountId: "p2" } } }),
    ];
    const { state, ports } = repairPorts({ accounts: [original[0]] });
    state.journal = {
      version: 1,
      startedAt: "2026-07-31T11:00:00.000Z",
      snapshot: {
        accounts: original,
        accountMap: emptyAccountMap(),
        needsReview: [],
      },
      merges: [{ targetId: "one", sourceIds: ["two"], affectedServices: ["calendar", "files"] }],
    };

    await expect(recoverAccountRepair(ports)).resolves.toBe(true);

    expect(state.accounts).toEqual(original);
    expect(state.map).toEqual(emptyAccountMap());
    expect(state.journal).toBeNull();
  });
});
