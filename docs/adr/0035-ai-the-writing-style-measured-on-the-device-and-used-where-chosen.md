# ADR 0035: The writing style is measured on the device from examples the user chooses, and used only where the user chooses it

Status: Accepted

Date: 2026-10-25

## Context

The plan's "style profile" (§ 18) asks for a description of how the user writes — from example texts the user chooses explicitly, computed locally, as visible features each of which the user can delete; never applied by itself to communication others read; no imitation of a person; and what comes of it stays recognisable as the AI's.

A draft of the AI sounds like the AI: long paragraphs, bold words, bullet lists, dashes, the same register for everyone. A user who writes short sentences, never uses bold and addresses people with "du" has to rewrite every draft. A model can be told how the user writes — but what tells it must not become a copy of the user's notes, must not go where the notes' rules forbid them to go, and must not turn the assistant into a ghost writer that passes its texts off as the user's.

## Decision

1. **Features, measured on this device, without a model.** From the notes the user picks as examples (at most eight, notes of the vault, never the hidden agent area), the device measures: sentence length, paragraph length, lists or running text, headings, address, bold, emojis, exclamation marks and dashes (`measureStyle`, core). Properties, code, quotes, tables and comments do not count; a long note is measured from its beginning. A feature stands only where the examples show it clearly enough — enough text, enough sentences, a clear majority — and below 100 words nothing is measured. Each feature is one of a few values with the numbers it rests on ("short, 9 words", "38 % of the lines").

2. **No word of a note.** The device keeps the paths of the examples and the features the user took out — in the app's data for the vault on this device, never in the vault, nothing synced. The features are measured again whenever they are shown or used, so they follow the examples. No vocabulary, no phrase, no sentence is kept or sent: nothing that would make one person's writing recognisable, only how a text is built.

3. **Address where a language shows it in its words.** German "du"/"Sie", Dutch "jij"/"u", French "tu"/"vous", Spanish "tú"/"usted", Italian "tu"/"Lei", Portuguese "tu"/"o senhor", Polish "ty"/"Pan", Chinese "你"/"您" — measured in the language most of the examples are written in, told apart by its frequent words. A formal word that is also an everyday one counts only where it is unambiguous: capitalised inside a sentence (German "Sie", Italian "Lei", Polish "Pan"), after its article (Portuguese "o senhor"); Brazilian "você" counts as neither. English and Japanese show no address in such words and get none.

4. **Visible, and each feature out on its own.** The memory's section **Writing style** in both shells lists the examples and every feature with its numbers; ✕ takes one out, **Bring back** brings them back. What goes into a conversation is exactly what the section shows, less what a rule keeps (6).

5. **Used only where the user chooses it, per conversation.** **My style** beside the globe under the composer gives the style to the next conversation the user begins — from the composer or a skill they start — and like the internet it is fixed from its first message: the system prompt carries it, and an open conversation keeps what it began with. Never a door, a regression run or a routine; a replay takes the original's choice, measured anew for its own reader. The style is not the memory and does not switch with it.

6. **The rules of an example hold for its features.** The features a conversation gets are measured from the examples its reader may have — through the same gate as a note, with the internet where the conversation has it. An example kept from a cloud gives a cloud nothing, and the send overview counts it under **Kept back**; a model on this device gets its features, and what is made of such a conversation — a note kept from an answer, a draft, a foreign server's call — inherits the example's rules as it would a note's.

7. **What the model is told is the app's own lines.** Each feature becomes one plain English line written from the numbers (`styleLine`) — no text of a note, so the lines stand outside the data fence like the app's rules. Around them the system prompt says where the style is used: in what the user keeps for themselves (a note, a draft of one, a journal entry, a rewrite); not on its own in an e-mail, an invitation, a comment or anything else another person reads — there only when the user asks; it describes how the user writes and is no person to imitate; and what the model writes stays its own, never presented as written by the user.

8. **Recognisable.** A conversation with the style says so in its first line (**With your writing style**), the send overview has a row **Writing style** (a new kind of data, so its first time to a cloud is a growing scope), the line under an answer counts the features, and a draft laid down in such a conversation says that it was drafted with the user's writing style — it remains the AI's draft, signed with its model as every draft.

## Consequences

- One more thing the user chooses before a conversation, and one more row in the send overview. A user who never picks examples sees neither the button nor the row.
- The measurement is heuristic. Sentences are split at stops with abbreviations, single letters and day numbers left alone; the language of an example is told from frequent words; Chinese and Japanese sentence length is counted in characters. A wrong reading shows as a feature with its numbers, and the user takes it out.
- The style is per device: another device has its own examples, and a note renamed after it was chosen shows as **no longer there** until it is picked again — as every choice in the app's data about a note.
- The phone gained the note picker it lacked: **Pin a note…** under the composer was desktop-only; the same sheet now serves pinning and choosing examples on the phone.

## Alternatives

- **Let a model describe the style.** A model reading the examples could name more ("dry humour", "starts with the conclusion"). Rejected: the examples would go to a model to be described, and what comes back is prose the user cannot check against numbers; the plan asks for features computed locally.
- **Keep a word list or typical phrases.** It would make drafts sound closer to the user — and keep, beside the vault and outside its rules, fragments of the user's text that identify them. Rejected.
- **Apply the style everywhere by default.** Rejected by the plan: a draft that sounds like the user should be one the user asked for, and a mail in the user's voice written by a model is exactly the impersonation the plan rules out.
