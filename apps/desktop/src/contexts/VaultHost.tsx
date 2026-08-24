import React, { ReactNode } from "react";
import { useApp } from "./AppContext";
import { VaultProvider } from "./VaultContext";

/**
 * One vault runtime per open vault, all of them in the central window (stage D).
 *
 * A second window can show a different vault, but it must not RUN one: the
 * whole multi-window architecture rests on exactly one writer per vault, and a
 * client window that booted its own indexer, watcher and sync worker would put
 * two of them on the same files. So the central window holds every runtime and
 * an auxiliary window reads through it — including the vault it is the only
 * one looking at.
 *
 * Which means the provider tree is a list, not a single node: one keyed
 * `VaultProvider` per held vault. Keying by path is what makes a vault switch
 * cheap and a vault teardown honest — the provider for a vault nobody shows any
 * more simply unmounts, and its runtime stops in its own cleanup instead of
 * some caller having to remember to stop it.
 *
 * Only the vault THIS window shows renders the app below it. The others are
 * present but invisible: they exist so their sync worker keeps running for the
 * window that does show them.
 */
export const VaultHost: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { shownVault, heldVaults, isBooting } = useApp();

  // Nothing open: the splash still needs a vault context to read `isLoading`,
  // `recentVaults` and `openVault` from. A provider with no path builds no
  // runtime — it is the same empty state the app has always started in.
  if (!shownVault) {
    return (
      <>
        {heldVaults.map((path) => (
          <VaultProvider key={path} vaultPath={path} />
        ))}
        <VaultProvider vaultPath={null} appBooting={isBooting}>{children}</VaultProvider>
      </>
    );
  }

  return (
    <>
      {heldVaults
        .filter((path) => path !== shownVault)
        .map((path) => (
          <VaultProvider key={path} vaultPath={path} />
        ))}
      <VaultProvider key={shownVault} vaultPath={shownVault}>
        {children}
      </VaultProvider>
    </>
  );
};

/**
 * The same idea in a client window: one provider for the vault it shows.
 *
 * Keyed by path, for the same reason the owner's is — a switch unmounts the old
 * provider, which disposes its read connection in its own cleanup instead of a
 * caller having to remember to. Without the key React would reuse the provider
 * and the window would keep the previous vault's database open behind a tree
 * that already shows the new one.
 */
export const ClientVaultHost: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { shownVault } = useApp();
  return (
    <VaultProvider key={shownVault ?? "none"} mode="client" clientVaultPath={shownVault}>
      {children}
    </VaultProvider>
  );
};
