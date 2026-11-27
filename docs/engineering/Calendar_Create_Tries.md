# Creating a calendar event or task: tries

Issue 119. How a create reaches a CalDAV server, and what a later try of the same create does. The code is `createObject` / `putNewObject` / `settleLaterTry` in `packages/core/src/pim/CalDavPimTarget.ts`; the uid and the versions a create's tries sent are kept by `createTryFor` / `formCreateTries` in `packages/ui/src/pim/createUids.ts`. Tests: `packages/core/test/pim-create-readback.test.ts` ("later try - …"), `apps/desktop/src/services/pim/laterTryTaskSync.test.ts` (two syncs after a later try), `apps/desktop/src/services/pim/laterTryVersions.test.ts` (the memory of versions).

## The rule

A later try writes over what stands at its address only where that is provably the create's own: what this try sends, or one of the versions its earlier tries sent. Anything else - changed elsewhere since, not readable yet, changed between the read and the write - is left as it stands, and the create is made anew under a uid of its own, exactly as before this change (a duplicate, never a loss). The rule is about everything the app does afterwards on its own, not only the call at the adapter: every caller anchors to, and every follower works on, the uid the adapter answers with. That object is the person's draft and nothing else, so a sync that takes the provider's state for the note's (the task sync's adoption) can never write the person's note over a change made elsewhere.

## One try

- Every create names its uid (`createAs`, a UUID made once per create of the person). The address is `<uid>.ics` in the calendar.
- Every send of a new object carries `If-None-Match: *`: nothing that stands at the address is written over blindly.
- One send per call for the object at this address. An object the server accepted (2xx) is held from then on, shown or not: it is never sent again in the same call, and never reported as refused. Where a read at the address still answers 404 after the read-back's patience, the calendar is asked for the UID only to find an address of the server's own (a hit that carries the UID and lies in the calendar).
- A `412` on a first try is an object that is not this create's: an error, as before this change.

## A later try

A later try ("Try again" on a form, on the lost-event message, or a create keyed by `createTryFor` that failed before) carries every version its earlier tries sent or set out to send (`createSent`): a try that failed may still have landed, so what stands can be any of them. Its first send is the same `If-None-Match: *` PUT.

| At the provider | Sent | Result (uid) | At the provider afterwards |
|---|---|---|---|
| nothing (no earlier try landed) | PUT `If-None-Match: *` → 2xx | the create's uid | this try's draft |
| this try's draft | PUT → 412, GET | the create's uid | unchanged |
| one of the earlier versions | PUT → 412, GET, PUT `If-Match: <read etag>` | the create's uid | this try's draft |
| one of the earlier versions, the read names no etag | PUT → 412, GET, PUT without a precondition (as an ordinary change, `readModifyPutObject`) | the create's uid | this try's draft |
| changed elsewhere since (any line but the server's stamps) | PUT → 412, GET, PUT `If-None-Match: *` at a new uid | a new uid | the changed object, untouched, and this try's draft |
| changed elsewhere, the read names no etag | as above: never written without the comparison | a new uid | as above |
| not readable yet (404 after patience) | PUT → 412, GET … 404, PUT at a new uid | a new uid | the earlier object, untouched, and this try's draft |
| an earlier version, changed between the GET and the write | PUT → 412, GET, PUT `If-Match` → 412, PUT at a new uid | a new uid | the other writer's version, and this try's draft |
| the read fails (network, 5xx, sign-in) | PUT → 412, GET fails | an error, as a failed send | unchanged |

Nothing is said in any row: every result is a create that landed, and the next sync agrees with it.

"Provably the create's own" is compared by content, strictly: the only lines left out are the stamps a server sets on every store (`DTSTAMP`, `CREATED`, `LAST-MODIFIED`), and `SEQUENCE:0` counts as no `SEQUENCE`. Every other line counts with its parameters and values - titles, times, rules, removed and moved occurrences, attendees with their answers, roles and names, status and completion, alarms with their content, and `X-` extras (another Plainva device keeps its blockers in `X-PLAINVA-BLOCKS`). The calendar's own envelope (`PRODID`, `VERSION`, `VTIMEZONE`) is not part of an event. Anything that cannot be read counts as changed. A server that rewrites what it stores therefore makes its own object look changed: the later try then creates anew - the price is a duplicate, as before this change.

## Each caller, through the next two syncs

| Caller | Key of its tries | Anchored to | Next sync and the one after | The person reads |
|---|---|---|---|---|
| A saved event form (both shells) | one form; the draft never changes between its tries | the overlay row under the answered uid | the cache lists that uid; the overlay ends; nothing is written | saved |
| "Try again" on the lost-event message | the lost draft | as the form | as the form | saved |
| A task sent to a list (`createProviderTask`) | vault, account, list, note, title; the due date may change between tries | the note, to the answered uid | adoption takes that task's state as the base; it is the note's draft, so no push and no pull follow (`laterTryTaskSync.test.ts`). Where the earlier task was changed elsewhere, it stays at the provider and is pulled as a task of its own, as before this change | created |
| A time block (`createTaskTimeBlock`) | vault, calendar, whole draft | the note's `plainva.blocks`, to the answered uid | the block follows the event of that uid; the event changed elsewhere is not followed | created |
| An appointment from a note (`createEntryEvent`) | vault, calendar, note, whole draft | the note's entry anchor, to the answered uid | as the time block | created |
| A blocker (`runCalendarBlocks`) | calendar, whole draft | the source's block list, to the answered uid | `blockFollow` moves the blocker of that uid | created |
| The copy a move makes | source event, destination, whole draft | the overlay, to the answered uid; then the source is deleted | as the form | moved |

Where a key holds the whole draft, a changed draft is a new create with a new uid: the "earlier version" rows occur only for the task sent to a list.

The memory of a create (`createTryFor`) lives for a day and only in the running app; a note-bound create belongs to its vault (the vault's adapter is part of the key), so the same note path and title in another vault is another create.

Google and Microsoft name their own ids and ignore `createAs`/`createSent`: a later try after a lost answer may leave a second event there, as before this change.
