# Creating a calendar event or task: tries

Issue 119. How a create reaches a CalDAV server, and what a later try of the same create does. The code is `putNewObject` / `settleLaterTry` in `packages/core/src/pim/CalDavPimTarget.ts`; the uid and what a try sent are kept by `createTryFor` / `formCreateTries` in `packages/ui/src/pim/createUids.ts`. Tests: `packages/core/test/pim-create-readback.test.ts` ("a later try …").

## One try

- Every create names its uid (`createAs`, a UUID made once per create of the person). The address is `<uid>.ics` in the calendar.
- Every send carries `If-None-Match: *`: nothing that stands at the address is written over blindly.
- One send per call. An object the server accepted (2xx) is held from then on, shown or not: it is never sent again in the same call, and never reported as refused. Where a read at the address still answers 404 after the read-back's patience, the calendar is asked for the UID only to find an address of the server's own (a hit that carries the UID and lies in the calendar).
- A `412` on a first try is an object that is not this create's: an error, as before this change.

## A later try

A later try ("Try again" on a form, on the lost-event message, or a create keyed by `createTryFor` that failed before) carries what the try before it sent (`createBefore`). Its first send is the same `If-None-Match: *` PUT.

| At the provider | Draft since the earlier try | Sent | The person reads | At the provider afterwards |
|---|---|---|---|---|
| nothing (the earlier try never landed) | unchanged | one PUT `If-None-Match: *` → 2xx | saved | this try's event |
| nothing | changed | one PUT `If-None-Match: *` → 2xx | saved | this try's event (the new draft) |
| what the earlier try sent | unchanged | PUT → 412, GET | saved | the earlier try's event, untouched (it is the same) |
| what the earlier try sent | changed | PUT → 412, GET, PUT `If-Match: <read etag>` | saved | the new draft |
| changed elsewhere since | unchanged | PUT → 412, GET | saved | the changed event, untouched |
| changed elsewhere since | changed | PUT → 412, GET | tasks: "The task already stands differently at your provider. Your change was not taken over there." | the changed event, untouched (`notApplied`) |
| not readable yet (404 after patience) | unchanged | PUT → 412, GET … 404 | saved | the earlier try's object, untouched |
| not readable yet | changed | PUT → 412, GET … 404 | as "changed elsewhere" (`notApplied`) | the earlier try's object, untouched |
| what the earlier try sent, changed between the GET and the write | changed | PUT → 412, GET, PUT `If-Match` → 412 | as "changed elsewhere" (`notApplied`) | the other writer's version |

"What the earlier try sent" is compared by content, not by bytes: a server rewrites what it stores (stamps, ids, its own `X-` extras), so those are left out; titles, times, rules, removed occurrences (`EXDATE`), attendees and their answers, status and completion, alarms are compared. Anything that cannot be read counts as changed.

Where the draft cannot change between tries (a saved form: the same draft every time; a time block, an appointment from a note, a blocker, a move's copy: keyed by their whole draft), the "changed" rows do not occur. A task sent to a list is keyed by note and title, so a due date changed between tries reaches the "changed" rows.

Google and Microsoft name their own ids and ignore `createAs`/`createBefore`: a later try after a lost answer may leave a second event there, as before this change.
