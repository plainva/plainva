# Transitions of the runtime on screen (phone)

The phone has one vault runtime on screen at a time. Every transition that leaves or replaces it — a switch, a reload, an index rebuild, the renew after a step's sync gave up, the removal of a deleted vault — runs in one queue (`inScreenTransitions`, `apps/mobile/src/services/vaultService.ts`), and every one that leaves the runtime goes through one frame (`screenTransition`). This page is the rule that frame keeps: **every transition has exactly one way out of every wait**, and each way out is one cell below. There is no cell "stays `leaving`", and none "sync off, nobody holds it".

The desktop has the same rule in its own form: one runtime per window and load (`runtimeRef.load`), a step's ports in `apps/desktop/src/services/workspaceSteps.ts` (`step.reopen` opens anew only the step's own runtime, and only a load that this reopen opened is the step's), and `reopenAfterStep(path)` for a step's own reload.

## The state on screen

`screen.state` is one of `none`, `opening`, `open`, `leaving`. Only an `open` runtime is on screen for a step and for the sync (`runtimeOnScreen()`).

| From | To | Who |
|---|---|---|
| `none` | `opening` | `getMobileVault` begins a start |
| `opening` | `open` | that start answers, while it is still the start on screen and the state is still `opening` |
| `opening` | `none` | that start fails |
| `open`, `opening` | `leaving` | `turn.leave()`: the first thing a transition does at its turn, synchronously, before any wait |
| `leaving` | `open` | `turn.stay()`: only for the runtime that was `open` when the turn left it, not called off and not left |
| `leaving` | `none` | `turn.clear()`: the transition's end; the next start begins with the event `m-vault-switched` |

## The sync after a transition

- **runs**: the worker for the runtime on screen.
- **held by X**: something holds the vault's sync (`syncHolds.ts`); nothing starts until the last release. The status says **Sync paused** (`mobile.syncDisconnected`) while the vault is on screen. The holders are: a step on the runtime (`withRuntimeStep`), a step on the sign-ins (`withVaultSyncStopped`), a reload waiting behind someone's input (`deferredReload`, until its runtime is left), and the removal of a deleted vault.
- **after the boot**: the next runtime's start (`startSyncAfterBoot`), unless a hold stands.

A runtime that stays (`turn.stay()`) gets its sync back through the one start (`resumeOnScreen`), only once what the close took of it has drained. Where a hold stands, that start does nothing, and the holder's release starts it.

## Ways out of a wait

- **comes back**: the wait answered.
- **throws**: it failed. Examples: a save that failed, the registry that could not be read or written, the settings, setting the index database aside, a start that did not open.
- **called off**: the close's deadline ran out in the sync step. The runtime is called off and never stays on screen.
- **deadline**: the deadline ran out while saving. The saves finish in the background, the transition goes on, and nothing is called off.

## Switch (`switchTo`)

| Wait | Way out | State after | Sync after | The person reads |
|---|---|---|---|---|
| turn (same vault opening) | comes back | `opening`, unchanged | after the boot | nothing |
| `turn.leave` (a retired start's 2 s) | comes back, target already open | `open`, the same runtime | runs (nothing was taken) | nothing |
| registry read | throws | `open` again | runs again (nothing was taken) | the switch's failure |
| saves | throws | `open` again | runs again once the taken sync drained, or held by X | the save's failure |
| saves | deadline | goes on | — | the close's notice |
| sync drain | called off | goes on to the next vault | — | the close's notice |
| registry write, settings | throws, runtime whole, the way back holds | `open` again, the vault active again | runs again, or held by X | the switch's failure |
| registry write, settings | throws, and the way back fails too (the registry or the settings name the other vault) | `none` → `opening` (what the registry names; `turn.abandon`) | after the boot | the switch's failure |
| registry write, settings | throws after a call-off | `none` → `opening` (the same vault anew, once the old runtime ended) | after the boot | the switch's failure |
| any, nothing was open (start retired) | throws | `none` → `opening` | after the boot | the switch's failure |
| leaving the vault | comes back | `none` → `opening` (the new vault) | after the boot | nothing |

## Reload (`reloadActiveMobileVault`) and index rebuild

The reload is for what its caller had: `runtime` (a step's own), `vaultId`, or the start on screen at the call (`of`). It checks this at its turn and does nothing where that is gone: then it answers `false`, and nothing is left.

| Wait | Way out | State after | Sync after | The person reads |
|---|---|---|---|---|
| turn | not for the runtime on screen | unchanged | unchanged | nothing (a step's work is done; the vault opens in its new state whenever it opens) |
| turn | someone's input elsewhere | `open`, unchanged | runs if it ran, held by the waiting reload | the reload's notice |
| `turn.leave`, registry read | throws | `open` again | runs again, or held by X | the caller's failure |
| saves | throws | `open` again | runs again once the taken sync drained, or held by X | the save's failure |
| saves | deadline | goes on | — | the close's notice |
| sync drain | called off | goes on, the vault opens anew | after the boot | the close's notice |
| after the drain | someone's input elsewhere | `open` again | held by the waiting reload | the reload's notice |
| leaving the vault | comes back | `none` | — | — |
| wait for the old runtime's end, set aside (rebuild) | comes back or throws | `none` → `opening` (the event is sent in any case) | after the boot | a failure: the rebuild's |

## Renew after a step's sync gave up (`renewAfterSyncGaveUp`)

| Wait | Way out | State after | Sync after | The person reads |
|---|---|---|---|---|
| turn | the step's runtime not on screen | unchanged | unchanged | the step: "did not run" |
| leaving the vault (does not wait) | comes back | `none` → `opening` (the same vault anew, once the old runtime ended) | held by the step | the close's notice |
| the new start | fails, or retired by a switch | whatever the next transition left | as that one left it | the step: "did not run" |
| the new start | opens | `open` | held by the step until its release | the step goes on |

## Delete (`deleteVault`)

| Wait | Way out | State after | Sync after | The person reads |
|---|---|---|---|---|
| saves of this vault, a start still opening | come back, or deadline | unchanged | unchanged | the close's notice |
| switch to the local vault | as in the switch's table | as there | as there | as there |
| the look at the active vault | throws (the registry cannot be read) | the screen decides: a vault on screen or opening is switched away from | as in the switch's table | — |
| the vault's runtimes end | comes back | unchanged | — | — |
| a hold on the vault | released | unchanged | — | — |
| removal (in a turn of the queue) | the vault on screen again (a switch back to it) | unchanged | unchanged | the delete's failure; nothing is removed |
| removal (in a turn of the queue) | each part comes back or is listed | unchanged | held by the removal; the vault is gone | the parts that could not be removed |

The removal waits for every hold on the vault's sync outside the queue (a step's renew waits in the queue), then runs in a turn of its own, holding the sync itself. A hold taken again meanwhile sends it back to the wait. A vault opened again meanwhile (a switch back to it) is not removed: the delete fails.

## A step on the runtime (`withRuntimeStep`)

- It holds the vault's sync from its press to its end.
- Its own reload (`reload`) is for the runtime it went on with, and only that one.
- A reload that waits behind someone's input takes the hold over, so the step's release starts nothing on the runtime it changed.
- A failure of its work is judged once the transitions under way have run. Where its runtime is `open` again, the failure is the work's own. Where it is not, the step did not finish (`closing.stepInterrupted`).
- Its work succeeding after its vault was left is a success. Nothing is reloaded for it: the work landed before the runtime closed (a write after the close fails), and the vault opens in its new state the next time.

## A decommission that stopped midway

Nothing lifts an encryption or ends a workspace unless the person asks for it at that moment. A vault's open reads the workspace's status as it is and finishes nothing.

That a decommission (or a lift) passed its gate and has not finished is a fact only the decommission writes: `workspace_leaving_mobile_<vault>`, set as the gate opens (before the status goes) with what was asked for, removed at its end and by every status written afterwards (a setup, a join, a recovery). It is only shown, never acted on, and read only where the status is gone (`mobileDecommissionUnfinished`). What is left on the device without it decides nothing.

| Fact | Status | Device key | State | Example | Row in the Security area | Sync | The button |
|---|---|---|---|---|---|---|---|
| any | yes | any | any | a workspace; Q1 (the gate failed: whole) | none (the workspace's own rows) | as the workspace has it | the workspace's own (decommission, lift) |
| no | no | any | any | P1 (a setup stopped between the key and the status), P2 (a key a reinstall kept), a plain vault | none, as on `main` | as on `main` (the folder's gate decides) | none |
| yes | no | yes or no | yes or no | stopped after the gate, also after the state was cleared and before the departure was noted | `decommissionUnfinished`, or `liftUnfinished` for a lift | held, saying the same, never plain text | "Decommission workspace": asks for the vault's name, goes on from what is left, notes the departure, removes the fact |
| yes, older than a new status | yes | yes | yes | Q2 (set up again afterwards) | none: the new status removed the fact | as the workspace has it | the workspace's own |

Pressing the button again finishes a lift as a decommission. Whether this device was the workspace's only one is asked of the runtime the vault has open; without one nobody can tell, and the folder stays the other devices' (`left`, R8). The text of a lift says so.

The desktop reaches the same result its own way: it clears its gate (the keychain entry) last. A run interrupted before that leaves the vault a workspace with its own button, and pressing again goes on.

## Saves

- A pending save belongs to a vault: the phone's saver keys it by the vault.
- It holds up only that vault's close. Every close flushes the saves of its own vault, never all of them.
- A save for a runtime that was called off ends at once (`isSaveFailureFinal`, `CalledOffError`), and its text stays in the draft journal. Desktop and phone share the rule. The desktop's saves of left notes end with the vault's epoch (`leftNoteSaves.ts`).

## Named limits

- A step body that never ends holds the vault's sync while it runs. The status says the sync is paused.
- `getMobileVault()` during `leaving` answers the runtime being closed. Its callers are listed in the B2 report.
- An index rebuild makes a switch wait in the queue, bounded by the requests' deadlines.
- A sign-in step that fails after writing its secret (the broker, the password's slot) leaves what it wrote. The release starts the sync on every way out.
