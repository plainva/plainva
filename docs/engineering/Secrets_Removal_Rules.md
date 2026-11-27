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
| The same, once per kind, after an update | an updated device's first round on a record an older version wrote (see "Across an update"), as the tombstone of an absence that version wrote | as that version's tombstone | that round |

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
| An address repaired (same row, another server; here or by the profile) | unchanged | the password under the new name, with what the slot knew under the old one (see "A repair changes the name"); nothing under the old one — a repair made on 0.9.0 before the update gets that version's tombstone under the old one (see "Across an update") |
| Two rows merged or folded | the kept row keeps its slot | nothing |
| The settings profile takes the account away (removed elsewhere) | row and slot go (calendar and mailbox alike); the profile import says so to the secrets sync (`noteSecretLeftWithProfile`) — it is never read from a missing row | taking-back tombstones for what this device wrote for the account itself or carried by a repair; nothing for a password it only took from the sync (its publisher takes it back) |
| The account arrives through the profile (new, or added again) | empty, or as it was | nothing; an open removal of that name on this device ends |
| Removed and added again here before a round (or another account of the same user repaired onto the name) | the new account's slot: empty, it stays empty, as on 0.9.0, and a newer password from elsewhere reaches it; with a password, it goes out above all known under the name — no removed account's password reaches any slot (seventh and eighth round, H2, S2, S3) | with a password of its own, nothing (the removal ends); with an empty slot, the removal tombstone, as on `main`: the act's, and the slot listed here holds nothing it could take |
| A list of a kind of account that may not be whole (`accountsReady`: the calendar runtime starting, or missing) | unchanged | nothing is decided from what it leaves out: a removal waits and no tombstone is written; no floor and no note of a slot goes; no repair is carried, and the note of the slot waits with it; an entry of the document for no account on the list is neither remembered nor reported as waiting; the first round after an update waits (see "Across an update") |

## A repair changes the name, not the history

The slot of a repaired account keeps under its new name what it knew under
the name it was last listed under (`slotNames`, kept in the device's local
record of the secrets sync). Three things go along, each by its own rule:

- **Received or typed** belongs to the slot: whether its password came in
  through the sync is what it was under the old name, whatever this device
  knows of the new one — unless the slot holds another password than the one
  the sync last left in it: that one was typed in the save that repaired it,
  and is typed here, as on `main`, which carried nothing (rule R, fifth and
  sixth review round; "R4edit", "Rtomb", "Rloss"). Received needs a proof
  (seventh and eighth round): a mark of what the sync itself put into the
  slot or sent from it, made with a key this device still has — the
  password it confirmed, sent or took in (`hash` of a settled record), the
  slot a tombstone of another device found (`slotMark`) — or the document.
  No record after a lost key is such a mark: the slot as it was when the
  loss was found (`sinceLoss`, `unconfirmed`) may hold what was typed since,
  and a conflict held (`held`) says the document had another password at
  that version ("HeldThenRepair"). For those, and for a mark of the lost key
  (a record not rebuilt, `baselineAfterLoss` leaves a name whose slot moved
  in the same gap; a tombstone whose mark of the slot is of the lost key),
  the export carries nothing for that slot, sends nothing for it and waits,
  and the import reads the document (`provenByDocument`): not typed only
  where another device's entry carries exactly the slot's password — under
  the old name at the record's revision ("RlossGap"), or under the new name
  (the cells "the slot's password"). A value this device sent itself proves
  nothing about having received it. Where there is no proof it does what
  `main` does by its rule, which carried nothing: typed here (named limit
  below). A tombstone remembered by a build before this rule, or while no
  listed slot held the name, has no mark either: typed here.
- **The floor**: every revision the slot knew under the old name (its entry,
  the revisions it saw there and did not take). A password typed after the
  repair, or a removal, goes out above it and above all the device knows of
  the new name (`floors`).
- **The version** (revision, time, device) of the entry the slot holds goes
  along only from a settled password: not a tombstone, not a record of a
  lost key, not held, not waiting to be confirmed. It goes nowhere the new
  name holds a tombstone (the password goes out above that one) or a record
  with the slot's own password (that record keeps its version). Unchanged,
  the password then goes out under the new name with the version it had;
  changed since, it goes out above the floor. A password only received with
  no version to carry never goes out as a new value (seventh round, M1,
  "StaleAbove"): it waits for the document like a slot after a lost key
  (`sinceLoss` at revision 0, keeping every revision the new name had seen
  as `heldRev`). The import takes what the document holds under the new
  name; with nothing there it goes out below every entry (`unconfirmed`,
  revision 0, a moment before its time). Typed meanwhile, it goes out above
  every revision seen there. What is typed here goes out as a new value
  above the floor, after the import decided it ("M1loss").

A name with a removal open in the round (`retired`: "Remove account" here,
or the profile took the account away) begins anew under an account repaired
onto it (eighth round, S2, "H2onto"): the slot is the identity, not the
name. It inherits nothing there — no "received", no version, no password of
the document; its own password goes out above all this device knew under
either name. An empty slot new to a name — an account added again or
connected anew, an account repaired onto the name, and every slot on a
record a version without notes wrote — stays empty (`markNewEmptySlots`, S3):
the record of the name says the slot holds nothing, so the import does not
fill it from the document, and a newer password from elsewhere still reaches
it; under a name with a removal open, nothing received there is its. Only a
slot the sync knew under that name (its note), on a whole list, is filled
again when it was emptied outside the port — and only such a slot takes the
password of the version it knew after a lost key (round twelve), on a record
this version wrote; on one of a version without notes, as that version did.
A password typed here over one received keeps following a change made
elsewhere under the same name, as in every version since 0.8.7; a repair
carries it as typed (`typedOver`). Fixed cases: "a name
with a removal open begins anew" in
`apps/desktop/src/services/secretsRemovalCases.test.ts`, every device
against the port of `main`.

A carry waits for a whole list of its kind; it adds to what the device
learnt under the new name meanwhile and takes nothing away (seventh round,
S2, "LateCarry"). An import that writes the slot under its new name while
its carry waits makes the new name the slot's: the note follows the slot,
the floor of the old name still goes along (`noteCarriedFloor`), and
"received" stays as the import set it. Every other assignment of the carry
only adds: the floor is a maximum, the version goes nowhere the new name has
a tombstone or the slot's own password, and a version it carries keeps every
revision the new name had seen (`heldRev`).

| Old name (the record this device had) ↓ / new name → | nothing | the slot's password | another password | tombstone of another device | this device's removal (open or confirmed) |
|---|---|---|---|---|---|
| nothing (listed, nothing in any round) | typed; nothing else; a new value | typed; that record's version | typed; above all known | typed; above the tombstone | typed; above its tombstone, the removal ends |
| a password received | received; old version; floor | received; that record's version; floor | received; old version, the other one counts as seen; floor | received; above the tombstone and the floor | received; above its tombstone and the floor, the removal ends |
| a password typed here | typed; old version; floor | typed; that record's version; floor | typed; old version, the other one counts as seen; floor | typed; above the tombstone and the floor | typed; above its tombstone and the floor, the removal ends |
| a record of a lost key (or held, or waiting to be confirmed) | as it was; floor; received: waits for the document, typed: a new value above it | as it was; floor; received: waits for the document, typed: above all known | as it was; floor; received: waits for the document, typed: above all known | as it was; above the tombstone and the floor | as it was; above its tombstone and the floor |
| a tombstone of another device (the account was still here) | as it was; floor; received: waits for the document, typed: a new value above it | as it was; that record's version | as it was; floor; received: waits for the document, typed: above all known | as it was; above the tombstone and the floor | as it was; above its tombstone and the floor |
| this device's removal (the account came back) | typed; floor; a new value above it | typed; that record's version | typed; above all known | typed; above the tombstone and the floor | typed; above its tombstone and the floor |

"Received" means the slot follows a newer password from another device under
the new name; "typed", that it is not replaced from elsewhere. "Above all
known" is one revision above every revision the device knew under either
name. Every cell is a test, for a calendar account and a mailbox, in
`apps/desktop/src/services/secretsRepairCells.test.ts`, each checked by what
the device does: the first export after the repair, a newer password from
another device under the new name, and a password typed after the repair.
The row of the records after a lost key is a test for each of the three (a
lost key, held, waiting to be confirmed), the row of a typed password once
more with a newer password seen there and not taken; the chain of repairs
is a test of its own.

Every cell is also a test with a password typed in the save that repairs and
with nothing typed, each with the key of the marks kept and lost in the gap
(the export alone first, or a whole round). The measure is the rule: what is
typed stays on the device that typed it, and only what is provably received
follows the password typed last. Beside each cell the same steps run on the
port of `main` (89abe6ced carries the port of v0.9.0 unchanged,
`secretsV090.ts`), and a cell is red where the branch ends worse than
`main` — `main` keeps what was typed and the branch does not, or `main` lets
a received password follow and the branch keeps it — but for the decided
cells below. Measured so, per variant (108 cells each, the key kept, lost
with the export first, lost with a round): typed in the save that repairs,
`main` loses it in 90, the branch in none. Nothing typed, the branch follows
in 6 cells where `main` does not; `main` follows where the branch keeps the
password in 40 cells of a password typed here earlier, which `main`
overwrites, and in the decided cells: 6 with the key kept, 14 with it lost.

The decided cells (coordination, 27.11., kept by the eighth review round):
nothing typed, and the record under the old name proves nothing — a held
conflict with the key kept, in the cells whose new name holds a tombstone of
another device, another password, or this device's confirmed removal (3
cells for each kind, 6 in all); with the key lost in the gap, the same three
for a held conflict and, for a tombstone of another device, the cells whose
new name holds nothing, another password, a tombstone of another device or
the confirmed removal (7 for each kind and variant, 28 in all). 34 cells in
all. The slot counts as typed there; `main` follows, and in the same cells
with a password typed it loses that password in all but the cells whose new
name holds nothing — `main` does not tell the two apart. It follows because
it applies a tombstone of another device to a listed slot and empties it, or
reads "received" by name from the record of the account that had the new
name before. The cells whose new name carries the slot's very password, from
another device, are proven by the document and follow.

Nothing at all is carried from a name another account on the device had
already before this round (two rows, one name), from an alias, or without a
note of the slot. Two accounts of one user that move at once — A from a to c,
B from b to a — each carry their own: a is B's name now, but it was A's. What
each slot carries is read as the record stood before any of them moved. An
entry carried with its version is this device's to take back (`moved`) until
it takes a newer password under that name or one is typed there.

The floor holds over a chain of repairs (c to a to b: what the slot knew
under c is a floor under b), and it stays while a removal of its name is
still to be written: "Remove account" right after a repair writes its
tombstone above it. It goes once the device's record under the name is at
or above it, or the name is listed no more, with every list whole and no
removal pending.

An edit of an account — its address repaired — is no act of the settings
profile: the profile orders only "removed" and "revived" (`laterAccountAct`),
and the row of a removed account does not come back with an edit made
elsewhere.

A device coming from 0.9.0 (or from a build of 0.9.x before this rule) has no
note of its slots. It reads its record as before; its first round writes the
note for every account listed then. A repair made before that first round
carries nothing: the device behaves as those versions did for that one repair
— it loses nothing, its password goes out under the new name as a new value
(revision 1 there), and the old address gets the tombstone of an absence
those versions wrote (rule U3, "Across an update").

## Across an update

0.9.0, and the builds of `main` before these rules, told a removal by
comparing lists: an account in their record and missing from their list got
a tombstone at their next round, and a mailbox removed there left no note.
The app may update between the removal and that round (remove, quit, the
desktop updates on the next start). So nothing such a version would have
written in its next round stays unwritten: the first round of this version on
a record that version wrote does that comparison once for each kind of
account (`inferPendingRemovals`), and it writes exactly what that version
would have written and has no consequence on the device that version would
not have had: the tombstone of an absence (one revision above the record,
this device, this round), the record kept "received", no removal of this
device's (`removedIds`, it answers nothing), nothing taken back elsewhere. A
conclusion from lists is no act of the person: listed again, the account
follows a change made elsewhere as before.

The conclusion departs from that version only where the device can prove it
(rule U3, sixth review round): lists and records alone cannot tell an
address repaired from an account removed and another one of that user
connected at another server — on the desktop of 0.9.0 the way a mailbox's
servers change. A wrong "repaired" would leave a password in the document
nobody takes back; a wrong "removed" is exactly the tombstone of 0.9.0, and
the slot keeps its password. So a record of 0.9.0 gets no exception for a
repair: the decision of 25.11. holds for repairs this version sees itself,
and its one proof here is the note of a slot (`slotNames` as the round
began) that names the listed account's slot under the old name — written by
an import of this version on a whole list before the kind was compared. The
same credential under another spelling (folded) stays no removal, as on
0.9.0. Compared over random pending states (removed, repaired, connected
anew, one to three accounts of one user, typed anywhere), the document after
the first round of this version is the one 0.9.0 writes in its next round,
row for row — with one difference that is no conclusion from lists: a
calendar account removed on purpose on 0.9.0 whose record holds a revision
seen and not taken (`heldRev`) gets its removal tombstone one above that
revision (r3 where 0.9.0 writes r2). A tombstone either way; the higher one
wins for sure rather than by the time.

The record says which it is, never a clock: every export of this version
marks it (`notesRemovals`) once every kind was compared; a kind compared
while another waits for a whole list is noted (`comparedKinds`) and not
compared again. A record without the mark was last written by a version
without notes; a round of such a version drops the mark again (it does not
know it), and the next round here compares again, as that version did in
between. A device whose record is empty (new) has nothing to infer.

| Pending at the update | 0.9.0 / `main` before, in its next round | This version, in its first round with a whole list of the kind |
|---|---|---|
| A mailbox removed on purpose, the only one of its user | an absence tombstone | the same tombstone |
| A mailbox removed on purpose while another mailbox of that user stays, at another server | an absence tombstone | the same tombstone: the other mailbox has a record of its own, so it is no repair ("U1") |
| A calendar account removed on purpose | a removal tombstone (its note, `retireSecret`) | the same note: a removal tombstone |
| An account the profile took away (removed elsewhere), mailbox or calendar | an absence tombstone | the same tombstone; the remover's own one is there as well |
| An account signed out (listed, no password) | none (listed) | none |
| The server of an account changed (same user), mailbox or calendar | an absence tombstone under the old address | the same tombstone (rule U3); the slot keeps its password under the new address ("R4upd counterpart") |
| A mailbox removed and another one of that user connected at another server (the desktop of 0.9.0 changes a mailbox's servers so) | an absence tombstone under the old address | the same tombstone ("S1b") |
| A repair this version saw itself: the slot noted under the old name by an import on a whole list, before the kind was compared | — | none: the note proves the repair |
| An address repaired on this device while the list of its kind is listed but not called whole | an absence tombstone under the old address | the same tombstone once the list is whole ("U2flaky") |
| The user of an account changed | an absence tombstone under the old name | the same tombstone ("U2"): another user is another name, not a repair |
| Two rows folded into one | none (the same credential still listed) | none |
| A list of a kind not whole (`accountsReady`), for one round or many — empty, or listed in full but not called whole | none (their guard) | that kind waits; the other kinds are compared, once ("U3", "U3c") |
| A calendar list read empty while the host calls it whole (an index rebuilt, a runtime starting during the read) | absence tombstones for every calendar account, every round | none where the host can tell (`pimAccountListWhole`, the read between two questions, "U4b order"); where it cannot, the same tombstones once, and the device still follows a change made elsewhere ("U4b") |
| Every list empty though accounts were known | none (their guard) | waits |
| A build of `main` before these rules, an account removed there | an absence tombstone | the same |
| Two devices updated at once | their tombstones | the same, settled |
| Back to 0.9.0, a mailbox removed there before any round, forward again | an absence tombstone | none: the record still carries this version's mark (named limit) |

Fixed cases: "R4upd", "U1"–"U5", "U3c", "U4b", "S1b", "U2flaky" and the
comparison over random pending states in
`apps/desktop/src/services/secretsRemovalCases.test.ts`; the search
(`secretsRemovalSearch.test.ts`) has the steps "connects anew" and
"updates".

### Where the list of accounts decides

Every use of what `candidates()` returns, export and import alike
(`packages/ui/src/lib/secretsPort.ts`). The port asks `accountsReady` before
and after it reads the list (`readCandidates`); a kind is whole only when
both answers say so. Both shells answer with `pimAccountListWhole`, the
answer of the account cards: no runtime, or an index rebuilt at the start
whose accounts are not back yet, is not whole; on the phone, a list read
through a runtime that went during the read is not whole either.

| Place | What "not listed" decides | Under the rule |
|---|---|---|
| `baselineAfterLoss` | the mark of no password after a lost key | waits for a whole list ("L1") |
| `carryRepairedKnowledge` | what a repair carries, and from which name | carries nothing on a list not whole |
| `noteSlotNames`, note of a slot | the name a slot is listed under | not updated on a list not whole |
| `noteSlotNames`, pruning notes and floors | a slot or name gone | only after a round with every list whole; a floor stays while a removal under it is due |
| `inferPendingRemovals` | the comparison after an update | per kind, once its list is whole |
| the loop over `retired` (`tombstone`, `restore`) | a removal written | waits |
| `importBundle`, an entry no listed account matches | remembered, or reported as an account unknown here | neither on a list not whole; the import is not settled |
| `importBundle`, a listed account of a kind not whole whose slot is noted under another name | its carry waits | the import is not settled ("FlakyRepair", rule L3) |
| `oldNameId` (in `carryOldKnowledge` and `importBundle`) | an old name meant by one account only, no twin listed | no old name on a list not whole: nothing carried from it |
| `importBundle`, an entry of 0.8.7 or one whose old name the document holds (`foldMatches`, the twin rule) | which of two accounts that differ only in case an old name means | waits on a list not whole; the import is not settled |
| `oldFree` in `tombstone()` | an old name no other account here goes by | runs only inside the loop over `retired`, which waits for a whole list |
| `openRemovedIds`, `reopenOldNames`, the tombstones published again | only what is listed | decides from "listed", never from "missing" |
| `settledKey` | the mark of a settled import | taken from the list as read; whatever waits for a whole list (an entry, a carry, an old name) leaves the import open |

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

- A repair after a lost key, nothing typed, and nothing to prove the
  password received: the document no longer carries the value under the
  old name (a device on 0.9.0 or `main` that repaired first wrote its
  tombstone of an absence there), carries it at another revision than the
  record knew, or only as this device's own; the record under the old name
  is a held conflict, or a tombstone of another device whose mark of the
  slot is of the lost key; and the document under the new name does not
  carry the slot's password from another device. The password counts as
  typed here, as on `main` by its rule. It goes out as this device's own
  value above all it knew there once the import decided — so a newer one
  typed on 0.9.0 or `main` at the repair, at a lower revision, yields to it,
  and the devices that only received hold the older password, as on `main`
  ("M1loss") — and it does not follow a newer one from elsewhere until the
  person types it again. The decided cells (34) are listed under "A repair
  changes the name" ("RlossGap", "Rloss", the cells "key lost" and "held").
- A device that goes back to 0.9.0, removes a mailbox there before 0.9.0
  ran a round, and comes forward again: its record still carries the mark of
  this version (0.9.0 never wrote it), so nothing tells that removal from a
  list. Telling it would need a comparison of lists in every round — the
  very thing these rules ended. The mailbox's password stays in the
  document; typed on that device, for good. The updater never goes back; a
  device goes back only by hand (an older installer on the desktop, an older
  build in TestFlight). With one round on 0.9.0 in between, that round drops
  the mark and the next one here writes the tombstone ("U5").

## Checks that decide nothing on their own

Seven checks in `packages/ui/src/lib/secretsPort.ts` no test can tell from
their absence; each is a second guard of a rule another place already holds,
kept so the rule does not hang on the order of the code.

- **The kind of the record a repair carries from** (`carryRepairedKnowledge`,
  `known.binding.secretType`). A slot is a calendar slot (`pimSecretKey`) or a
  mailbox slot (`mailSecretKey`) in both shells, and each kind has one
  shareable type: the name a slot was noted under is of its own type.
- **An open removal at the start of an export** (`waiting`). The export asks
  again at its end; in between only an account listed again
  (`openRemovedIds`) closes a removal, and a removal closed so needs no
  reading of the document.
- **A slot signed out here among the slots emptied outside the port** (the
  refill in `importBundle`). Not refilled there, it reaches the signed-out
  branch below, which takes nothing either; only the reason in the result
  differs.
- **The kind of an account listed elsewhere that keeps a record of 0.9.0**
  (`inferPendingRemovals`, `secretType`). The match of the bindings compares
  the service first (`bindingMatchesExceptFamily`), and each service has one
  shareable type: a calendar account of the same user never matches a
  mailbox.
- **An old name read for an account** (`alias`, in `inferPendingRemovals`).
  Such a record is only ever written under an old type, which the check of
  the type before it already leaves out.
- **A record of none** (`inferPendingRemovals`, `prior`). An empty record
  has nothing to compare; the mark is only set sooner.
- **A carry that waits for the document asks for an import**
  (`exportBundle`, `forDocument`). The export carries nothing for that slot
  and publishes nothing for it, so the merged document holds an entry the
  export lacks — the old name's, the one proof — and the round imports
  (`SecretsSyncStep`: an import whenever the merged entries differ from the
  export's); with no entry under the old name there is nothing to prove.

One choice no test can tell either: **an absence tombstone never goes above
a revision seen and held** (`heldRev`, H1 of the fifth review round); it goes
out at the record's revision plus one, as 0.9.0 wrote it (that "plus one",
its device and the closing of the old name are tested). A held revision is
only written by an import of this version for an account on the list
(`signedOutHere`, a password typed here, a slot as it was at a lost key). A
record carrying one reaches the inference only when its account left the
list without a note while its kind waited — an address repaired on a list
listed but not whole — or after a return to 0.9.0; in both, 0.9.0 writes the
same revision in the same state.

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

- **A password typed on a device that lagged yields to a higher revision it
  never saw (review 2026-11-26, fourth round, M3; open decision).** A value
  goes out one revision above all its device knew; a device that missed P2
  and P3 and types NEW writes it at revision 2, and P3 at revision 3 wins
  everywhere, on the device that typed NEW too. Every version since 0.8.7
  decides so under one name ("R4editCtl"). Typed in the save that repairs the
  address, NEW is typed here and stays on that device, as on 0.9.0 (rule R,
  "R4edit"); the other devices keep P3. Two ways the case without a repair
  could go, for a decision: (b) a value typed here goes out above every
  revision the document holds, so the lagging device's NEW beats a P3 it
  never saw, everywhere; (c) a slot that goes out changed is typed here from
  then on, so the device that typed NEW keeps it and the others keep P3, as
  in the case with a repair. Fixed cases in
  `apps/desktop/src/services/secretsRemovalCases.test.ts`.
- **Two accounts with one name on a device (on `main` as well).** Two rows of
  one mailbox under different ids — connected twice, or a user changed on
  another device onto an address this device already has — are two
  candidates with one name: every version writes both under that name, the
  record follows whichever went last, and the device sends every round until
  the person folds them (the account repair shows each such group,
  `mailboxDuplicates.ts`).

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

