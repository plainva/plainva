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

**No decision of the port compares two times.** `updatedAt` only breaks a tie
between two entries of the same revision inside the merge. What a removal
beats is decided by revisions and by whether the remover has seen its own
tombstone in the document (below); a value that wins a tie against a removal
tombstone is answered whatever its time.

A removal tombstone carries the moment the device registered "Remove
account". A value carries the moment the device registered the change: the
first round that finds the new password in the slot. The two differ for a
device that was offline when the password was typed; the only decision that
depends on it is which of two values of the same revision — typed on two
devices that never saw each other — the merge keeps.

## Kinds of entries

| Kind | Written by | Revision | Time |
|---|---|---|---|
| Value (a password) | the device whose slot holds it, at its next round | one above all it knows of the name | that round |
| Removal tombstone | "Remove account" on an updated device | one above all the device knew of the name when the account was removed | when the device registered the act |
| Taking-back tombstone | an updated device whose account was removed (on it, or elsewhere and brought by the profile), for a password it published for that account itself, put above a tombstone (`over`), or carried to a new name by a repair (`moved`) — under the account's name and under every earlier address of the same user that no account on it has any more | one above its value | that round |
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
| "Remove account" | row and slot go, in the same line as the secrets rounds (`retireSecret`) | a removal tombstone under the current name, and under the old name a device up to 0.8.7 holds it by when this device knows that name for this account and no other account here can mean it; if it knows nothing of the name, nothing yet (the removal is noted, see below); and taking-back tombstones for what it published under an earlier address |
| "Sign out on this device", or removing the stored password in Settings › Stored access for a vault still in use | the slot keeps the sign-out mark | nothing |
| An address repaired (same row, another server; here or by the profile) | unchanged | the password under the new name, with what the slot knew under the old one (see "A repair changes the name"); nothing under the old one |
| Two rows merged or folded | the kept row keeps its slot | nothing |
| The settings profile takes the account away (removed elsewhere) | row and slot go (calendar and mailbox alike); the profile import says so to the secrets sync (`noteSecretLeftWithProfile`) — it is never read from a missing row | taking-back tombstones for what this device published for the account itself or put above a tombstone; nothing for a password it only took from the sync (its publisher takes it back) |
| The account arrives through the profile (new, or added again) | empty, or as it was | nothing; an open removal of that name on this device ends |
| A calendar list that is not whole yet (runtime starting) | unchanged | nothing is decided from it: a removal waits, no tombstone is written |

## A repair changes the name, not the history

The slot of a repaired account carries over to its new name what it knew
under the name it was last listed under (`slotNames`, kept in the device's
local record of the secrets sync): whether its password came in through the
sync or was typed here, the version (revision, time, device) of the entry it
holds, and the highest revision it saw there and did not take (`heldRev`).

- A password unchanged since goes out under the new name with the version
  it had: it never beats a newer password there.
- A password changed since goes out above every revision the device knew
  under either name.
- A password received through the sync still follows a change made
  elsewhere; one typed here and never received is still not replaced.

So after a repair the same holds as before it. Nothing is carried from a name
another account on the device still has, from an alias or a record made with
a lost key, or into a tombstone; from a tombstone of another device under the
old name (0.9.0 writes one for the address it repaired away from) only
whether the password came in through the sync — never a version, so nothing
older goes out — and from this device's own removal nothing. A record that
already holds the slot's password under the new name keeps its own version.
An entry carried this way is this device's to take back (`moved`) until it
takes a newer password under that name or one is typed there.

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
| A tombstone | **never applied**: the slot stays; the tombstone is remembered, and this device's password goes out above it (`over`) | remembered, and published again as it came |

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
| the account is in this device's list again | the removal ends |

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
`apps/desktop/src/services/secretsRemovalSearch.test.ts`.

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
  old name.
- A device whose profile never brings the removal keeps account and password,
  and publishes the password (statement 4 over statement 2).
- A password a device published, or put above a tombstone (`over`), stays
  in the document when that device leaves the fleet before the removal
  reaches it: the vault forgotten there, the device never used again.

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

