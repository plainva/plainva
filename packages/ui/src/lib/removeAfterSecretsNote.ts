/**
 * "Remove account" of a calendar account or a mailbox, in both shells: the
 * account goes only once its removal is written for the secrets sync (review
 * 2026-11-26, fourth round). The act is the one writer of the tombstone that
 * takes the password out of the shared document, so a removal whose note
 * could not be written — the code that writes it did not load, the store
 * refused — leaves the account where it is and rejects, and the dialog says
 * so; the account never goes while its password stays in the document for
 * good.
 *
 * `note` writes the removal and runs `take` in the same line as the secrets
 * rounds (`retireSecret`); when it has nothing to note (no password account)
 * it resolves without taking, and the account goes here.
 */
export async function removeAfterSecretsNote(note: (take: () => Promise<void>) => Promise<void>, take: () => Promise<void>): Promise<void> {
  let taken = false;
  await note(async () => {
    await take();
    taken = true;
  });
  if (!taken) await take();
}
