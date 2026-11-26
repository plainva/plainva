# Secrets sync: what removes a password

The rules of `packages/ui/src/lib/secretsPort.ts` for every way an account or
its password leaves a device, in one place. They hold for both shells (both
run the shared port) and in fleets with devices on 0.9.0 and 0.8.7, whose
code is frozen in `packages/core/test/fixtures/secretsV090.ts` and
`secretsV087.ts`.

The five statements the rules exist for:

1. **No device loses a password that nobody removed** — not through a repaired
   address, a merge, a calendar runtime that is still starting, or a tombstone
   of an older device.
2. **An account removed on purpose stays removed everywhere**, and its
   password leaves the shared document.
3. **"Sign out on this device" stays signed out**: no password from another
   device signs the slot in again.
4. **A password held for an account goes out**: a device that holds a password
   for an account still on it publishes it.
5. **A password in the document reaches every device that has the account**
   and is not signed out there — with the one exception every version makes:
   a password typed on a device and never received there through the sync is
   not replaced from elsewhere.

## The one comparison

The shared document holds one entry per name (`canonicalSecretId`). Every
version of the app merges two entries the same way: the higher `entryRev`
wins, then the later `updatedAt`, then the higher `deviceId`. A writer always
writes one revision above the highest revision it knows of that name, so the
revision says what a writer had seen: an entry at a revision above another
was written with a version at least that recent in view.

**One decision of the port compares two times, and only one:** whether an
entry a device up to 0.8.7 wrote under the account's old name is newer than
the entry under its current name (`oldNameId`). The two names count their
revisions apart — a device on 0.8.7 never writes the current name, an updated
device never writes the old one — so only their times can order them; a
device on 0.8.7 whose clock runs behind loses a later change on updated
devices, one whose clock runs ahead covers an earlier one (named exceptions).
Every other decision is made by revisions: `updatedAt` only breaks a tie
between two entries of the same revision inside the merge; what a removal
beats is decided by revisions and by whether the remover has seen its own
tombstone in the document (below), and a value that wins a tie against a
removal tombstone is answered whatever its time.

A removal tombstone carries the moment the device registered "Remove
account". A value carries the moment the device registered the change: the
first round that finds the new password in the slot. The two differ for a
device that was offline when the password was typed; the only decision that
depends on it is which of two values of the same revision — typed on two
devices that never saw each other — the merge keeps.

## Kinds of entries

| Kind | Written by | Revision | Time |
|---|---|---|---|
| Value (a password) | the device whose slot holds it, at its next round | one above all it knows of the name, and above every revision its slot knew under a name it had before a repair (`floors`) | that round |
| Removal tombstone | "Remove account" on an updated device | one above all the device knew of the name when the account was removed (the revisions it saw and did not take, and the floor of a repair, included) | when the device registered the act |
| Taking-back tombstone | an updated device whose account was removed (on it, or elsewhere and brought by the profile), for an entry it wrote for that account itself (by its device id, above a tombstone too) or carried to a new name by a repair (`moved`) — under the account's name and under every earlier address of the same user that no account on it has any more; never for an entry it only received | one above its value | that round |
| Absence tombstone of an older device | 0.9.0 (current types) and 0.8.7 (old types), when an account is missing from their list | one above their record | that round |

An updated device cannot tell a removal tombstone of another device from an
absence tombstone of a device on 0.9.0: they have the same shape. It
therefore never infers anything from a tombstone's origin.

There is no "held" tombstone any more: a tombstone for an account still on a
device never keeps that device's password back (statement 4).

## What each act writes

| Act on a device | Its own slot | What the device writes into the document |
|---|---|---|
| A password is typed (or changes) | holds the password | a value, at its next round |
| "Remove account" | row and slot go, in the same line as the secrets rounds (`retireSecret`), and only once the removal is written for the secrets sync (`removeAfterSecretsNote`): a removal whose note cannot be written — the code that writes it did not load, the store refused — does not happen, and the dialog says so | a removal tombstone under the current name, and under the old name a device up to 0.8.7 holds it by when this device knows that name for this account and no other account here can mean it; if it knows nothing of the name, nothing yet (the removal is noted, see below); and taking-back tombstones for what it published under an earlier address |
| "Sign out on this device", or removing the stored password in Settings › Stored access for a vault still in use | the slot keeps the sign-out mark | nothing |
| An address repaired (same row, another server; here or by the profile) | unchanged | the password under the new name, with what the slot knew under the old one (see "A repair changes the name"); nothing under the old one |
| Two rows merged or folded | the kept row keeps its slot | nothing |
| The settings profile takes the account away (removed elsewhere) | row and slot go (calendar and mailbox alike); the profile import says so to the secrets sync (`noteSecretLeftWithProfile`) — it is never read from a missing row | taking-back tombstones for what this device wrote for the account itself or carried by a repair; nothing for a password it only took from the sync (its publisher takes it back) |
| The account arrives through the profile (new, or added again) | empty, or as it was | nothing; an open removal of that name on this device ends |
| A calendar list that is not whole yet (runtime starting) | unchanged | nothing is decided from it: a removal waits, no tombstone is written |

## A repair changes the name, not the history

The slot of a repaired account keeps under its new name what it knew under
the name it was last listed under (`slotNames`, kept in the device's local
record of the secrets sync). Three things go along, each by its own rule:

- **Received or typed** belongs to the slot: whether its password came in
  through the sync is what it was under the old name, whatever this device
  knows of the new one.
- **The floor**: every revision the slot knew under the old name (its entry,
  the revisions it saw there and did not take). A password typed after the
  repair, or a removal, goes out above it and above all the device knows of
  the new name (`floors`).
- **The version** (revision, time, device) of the entry the slot holds goes
  along only from a settled password: not a record of a lost key, not held,
  not waiting to be confirmed. It goes nowhere the new name holds a tombstone
  (the password goes out above that one) or a record with the slot's own
  password (that record keeps its version). Unchanged, the password then goes
  out under the new name with the version it had, so it never beats a newer
  one there; changed since, it goes out above the floor.

| Old name (the record this device had) ↓ / new name → | nothing | the slot's password | another password | tombstone of another device | this device's removal (open or confirmed) |
|---|---|---|---|---|---|
| nothing (listed, nothing in any round) | typed; nothing else; a new value | typed; that record's version | typed; above all known | typed; above the tombstone | typed; above its tombstone, the removal ends |
| a password received | received; old version; floor | received; that record's version; floor | received; old version, the other one counts as seen; floor | received; above the tombstone and the floor | received; above its tombstone and the floor, the removal ends |
| a password typed here | typed; old version; floor | typed; that record's version; floor | typed; old version, the other one counts as seen; floor | typed; above the tombstone and the floor | typed; above its tombstone and the floor, the removal ends |
| a record of a lost key (or held, or waiting to be confirmed) | received or typed as it was; floor; a new value above it | as it was; floor; above all known | as it was; floor; above all known | as it was; above the tombstone and the floor | as it was; above its tombstone and the floor |
| a tombstone of another device (the account was still here) | as it was; floor; a new value above it | as it was; that record's version | as it was; above all known | as it was; above the tombstone and the floor | as it was; above its tombstone and the floor |
| this device's removal (the account came back) | typed; floor; a new value above it | typed; that record's version | typed; above all known | typed; above the tombstone and the floor | typed; above its tombstone and the floor |

"Received" means the slot follows a newer password from another device under
the new name; "typed", that it is not replaced from elsewhere. "Above all
known" is one revision above every revision the device knew under either
name. Every cell is a test, for a calendar account and a mailbox, in
`apps/desktop/src/services/secretsRepairCells.test.ts`, each checked by what
the device does: the first export after the repair, a newer password from
another device under the new name, and a password typed after the repair.

Nothing at all is carried from a name another account on the device still
has (two rows, one name), from an alias, or without a note of the slot. An
entry carried with its version is this device's to take back (`moved`) until
it takes a newer password under that name or one is typed there.

An edit of an account — its address repaired — is no act of the settings
profile: the profile orders only "removed" and "revived" (`laterAccountAct`),
and the row of a removed account does not come back with an edit made
elsewhere.

A device coming from 0.9.0 (or from a build of 0.9.x before this rule) has no
note of its slots. It reads its record as before; its first round writes the
note for every account listed then. A repair made before that first round
carries nothing: the device behaves as those versions did for that one repair
— it loses nothing, and its password goes out under the new name as a new
value (revision 1 there).

## What arrives

| What the document brings | Account on this device | Account not on this device |
|---|---|---|
| A value the device cannot place (no account here for it) | — | not reported as waiting when this device knew the name, removed an account of that user, or has a record of the same user and service under another address; otherwise reported as waiting for its account |
| A newer value | written into the slot, unless the slot holds a password typed on this device and never received through the sync (it stays, as in every version since 0.8.7; a password typed here later goes out above the newer entry) or the slot is signed out here | remembered only when this device knew the name (not reported as waiting); written into the slot when the account arrives |
| The value this device knows, while its slot is empty | written into the slot again when the slot was emptied outside the secrets sync (its keychain entry deleted; Settings › Stored access of a vault no longer listed, opened again) and is not signed out | — |
| A tombstone | **never applied**: the slot stays; the tombstone is remembered, and this device's password goes out above it, as its own entry | remembered, and published again as it came |

An account leaves a device only through an act on that device or through the
settings profile; a tombstone alone never empties a slot.

Devices on 0.9.0 and 0.8.7 publish a tombstone they already know unchanged —
same revision, time and device — and keep no record of a value for an
account they do not have. A value an updated device puts above their absence
tombstone therefore ends the exchange: they never write above it again.

## An open removal (on the device that removed the account)

`T` is the removal tombstone this device wrote, `D` the document's entry under
the same name at an import.

| `D` | Decision |
|---|---|
| a tombstone at or above `T` | the removal is **confirmed** |
| a value at the revision of `T` (it won the tie) | its writer had not seen `T`: **answered**, `T` goes out one revision above it |
| a value above `T`, before the removal was confirmed | it was written while `T` was not in the document: **answered** |
| a value above `T`, after the removal was confirmed | its writer had `T` in view (the account was added again, or kept on purpose): the removal **yields** |
| an account of that name is in this device's list again (the account added again, or another account of the same user on the same server, which is the same sign-in) | the removal ends; a removal not yet written is not written |

A removal of a name this device knew nothing of answers the first value it
finds under that name, at whichever import finds it, for as long as the
account is not on this device again; it forces no read and costs nothing
while the document has none. While its own tombstone is not confirmed, the
port reads the document every round (`awaitsDocument`); afterwards it never
forces a read.

## The outcomes of a settings cycle

The settings cycle of both shells runs the profile step before the secrets
step (`apps/desktop/src/settingsSyncStepOrder.test.ts`). Its outcomes:

| Outcome | Profile | Secrets |
|---|---|---|
| everything goes through | pushed and read in | run |
| the secrets step fails (caught; the cycle goes on) | pushed and read in | not run |
| the profile is read in, its upload fails (the error ends the cycle) | read in, not pushed | not run |
| the profile step fails at the start (the error ends the cycle) | — | not run |
| an act lands after this cycle's profile step | read in; the act's change goes out with the next cycle | run |

A failing profile step never lets the secrets step run. A device that has
received a removal through the profile therefore never publishes that
account's password afterwards.

## Named exceptions

Each stands with its steps as a fixed case in
`apps/desktop/src/services/secretsRemovalSearch.test.ts` or
`apps/desktop/src/services/secretsRemovalCases.test.ts`.

- Devices on 0.9.0 and 0.8.7 follow their own rules. One that holds the
  account as its only one, with a password typed there, publishes it again
  above a removal tombstone before its profile takes the account; its list is
  then empty, and an empty list writes no tombstone in those versions (their
  guard against a list still loading). The password stays in the document.
- A device on 0.9.0 applies a removal tombstone to an account added again on
  it meanwhile — its mark of an import is not cleared by typing — and loses
  that password.
- Devices on 0.9.0 and 0.8.7 know "received through the sync" by name. After
  a repair there (on the device, or brought by the profile) a password it had
  received counts as typed there: it does not follow a change made elsewhere
  until a newer one comes under the new name that it takes, and two such
  devices can each keep their own (statement 5 by their rule).
- Two devices on 0.9.0 lose a password to each other's absence tombstones
  after a repair; an updated device in the fleet publishes it again
  (statement 4), which gives it back to them.
- A device on 0.9.0 or 0.8.7 that removed an account itself while another
  device removed it and added it again (the profile's "revived" outranks this
  device's removal) gets the account back without its password: its record
  matches the document, so it reads nothing in. The user sees the account
  asking for its password and types it again.
- The old place of a removed account stays where the remover did not know the
  old name. An account that later gets that name — another account of the
  same user repaired onto that server — reads the password a device on 0.8.7
  left there, and publishes it under the current name.
- A device whose profile never brings the removal keeps account and password,
  and publishes the password (statement 4 over statement 2).
- A password a device published (above a tombstone too, or carried by a
  repair) stays in the document when that device leaves the fleet before the
  removal reaches it: the vault forgotten there, the device never used again.
- An entry a device up to 0.8.7 writes under the old name and the entry under
  the current name are ordered by their times (the one comparison of two
  times, above). A device on 0.8.7 whose clock runs behind loses a change it
  makes later than one made on an updated device: updated devices that
  received their password keep the earlier one. One whose clock runs ahead
  covers a later change made on an updated device for the devices on 0.8.7
  and the updated ones that received their password.
- A mailbox removed and added again in turn on two updated devices, with a
  device on 0.9.0 in the fleet: the device on 0.9.0 keeps the slot of a
  mailbox the profile took away, gets the row back with the account added
  again, and publishes its old password above the tombstone at the revision
  the new password went out with; the later time wins that tie. The device
  that typed the new password keeps it; the others, the device on 0.9.0 and
  the document hold the old one. The user sees the mailbox fail to sign in
  on those devices and types the password there again. Calendar accounts,
  and fleets without a device on 0.9.0, end on the new password.

## Limits outside these rules

- **A note to the secrets sync that the store refuses, when the profile
  takes a mailbox away.** The profile import removes the row first and then
  tells the secrets sync (`noteSecretLeftWithProfile`); should that write
  fail, no later application tries again, since the row is gone. What this
  device itself put into the document for the mailbox (its own entry, or one
  carried by a repair) stays there. The calendar takes the same way.
- **A removal older than 180 days.** The settings profile forgets a
  "removed" after 180 days (`REMOVED_ACCOUNT_TTL_DAYS`). A device that was
  offline longer still has the account, brings its row back to the profile,
  and publishes its password above the confirmed tombstone; the remover
  yields. Account and password are back on every device.
- **An end of the app between writing a slot and writing the record.** An
  import writes the slot first and the record after it. Should the app end in
  between, the slot holds a password received through the sync with no record
  of it; the next export publishes it as a change made here, and from then on
  it counts as typed here: it no longer follows a change made elsewhere.

## Findings outside these rules

- **A change made on 0.8.7, taken by an updated device (round eight).** Steps:
  a device on 0.8.7 (D1) has the password m1 it typed; an updated device (D0)
  and one on 0.9.0 (D2) received it. D0 types m2, D1 types m3 (neither has
  seen the other), D0 runs a round (m2 goes out), D0 types m4. Afterwards
  every device holds m3, the change made on 0.8.7, which D0 took under the
  old name; under the current name the document keeps m4, the password typed
  last on D0, at a higher revision, and no device holds it. The user who
  typed m4 on D0 finds m3 there again; a device that joins later, or one on
  0.9.0 that takes the current name, gets m4. Statement 5 counts the value
  under the old name for updated devices; the case stands as a fixed case
  with today's outcome in `apps/desktop/src/services/secretsRemovalSearch.test.ts`.

