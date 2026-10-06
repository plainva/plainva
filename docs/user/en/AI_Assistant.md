# AI Assistant (Beta)

Last reviewed: 2026-10-06

Plainva can answer questions about your notes with an AI model of your choice. It reads your vault, cites the notes it used, opens notes and views for you and proposes changes to a passage you selected as suggestions — it never changes a note itself. The assistant is **experimental** and switched off until you switch it on, separately on every device.

## Switching it on

Open **Settings → AI & automation** (the App part) and switch on **Use AI on this device**. Without the switch there is no AI button, no AI tab and no companion. Nothing is sent anywhere until you ask something.

## Choosing a provider

Plainva does not bring its own AI service: you use a provider you choose, with your own key. Every provider can be chosen; Plainva names their terms and retention so that you decide — it excludes none.

| Kind | Providers |
|---|---|
| Cloud providers | Anthropic, OpenAI, Google Gemini |
| Gateways and own servers | OpenRouter, any **OpenAI-compatible server** |
| On this computer (desktop) | Ollama, LM Studio |
| On this phone | Apple (iPhone), Gemini Nano (Android) |

1. In **AI & automation**, choose **Add provider** and pick one. Each entry carries a short note on its terms — for example that Google's free access may let people read your inputs.
2. Enter the key with **Enter key**. The key goes into this device's secure store; Plainva never shows it again — neither to the AI nor on screen.
3. **Test connection** loads the provider's own list of models. If it fails, the message says why (a rejected key, no connection, an unknown model).

An **OpenAI-compatible server** is added by its address. Plainva asks once more before it adds it, in a window of the operating system, and sends only to the address you confirmed. Plain `http` works only for a server on this device; everything else needs `https`.

If you have no key yet: a model on this computer (Ollama, LM Studio) costs nothing, and every provider's console issues keys.

**The system's own model on the phone.** On an iPhone with Apple Intelligence (iPhone 15 Pro or later), **Add provider** offers **Apple** first, on some Android phones **Gemini Nano**. It needs no key and costs nothing, and nothing leaves the device — so no overview asks before sending. Its window is small, about 4,000 tokens for the notes, the question and the answer together: fewer notes go along, earlier turns are shortened, and it uses no tools. The row says whether it is ready and, if not, why — Apple Intelligence switched off, a device that cannot run it, a model the system is still preparing; on Android, **Load model** asks the system to download it. Apple's model does not speak every language (no Polish). If the profile **Local** names it, it also writes the gists on the phone.

## Models and profiles

Four profiles — **Fast**, **Balanced**, **Strong** and **Local** — are your assignment of models. Choose a provider and a model for each, from the provider's list or by typing the model id exactly as the provider names it. **Default for new conversations** decides which profile a new conversation starts with. Plainva names no model "the best".

A fifth slot, **Audio**, holds the model that transcribes voice notes; it is never the default for a conversation.

A sixth slot, **Embeddings**, holds the model search by meaning computes with when you choose **Own provider** under **Semantic search** — see [Search](Search.md).

## Asking

- **Desktop:** the AI button in the action bar, **Ctrl+J** (⌘J on macOS) or **Ask AI** in the command palette opens the companion — a small window over your work. **Open as tab** moves the same conversation into the AI tab, where your conversations are listed.
- **Phone:** **Ask AI** in a note's ⋮ menu opens the AI sheet over that note. The **AI** area (in the areas sheet, or in the navigation bar if you put it there) shows the conversation full screen; **Conversations** lists the earlier ones.
- **Beside the note:** on the desktop the same conversation is the last section of the right sidebar, **AI**. On a phone or tablet it is the **AI** tab of the note's context — next to **Properties** and **Backlinks** — which a tablet shows beside the note.

The note you have open goes along automatically; remove it from the context with its ✕ if you want to. **Pin a note…** adds further notes. The assistant can also look things up itself: it searches the vault, reads notes and their sections, databases, backlinks and linked notes, lists tasks, appointments and the notes opened or changed lately, and opens notes and views. It cannot change, create or delete anything.

Every conversation starts with the line "Answers are written by an AI — ⟨model⟩ via ⟨provider⟩". Under each answer a line says what was sent where: how many notes, roughly how many tokens and — where the provider publishes prices — the approximate cost. **Stop** ends an answer at any time.

A link in an answer opens only after you confirmed its address, and images in answers are never loaded.

## What goes along

With every question Plainva puts together what may matter — on this device, before anything is sent:

- **Where you are:** the date and time, the note or database you have open and your selection in it, your open tabs, tasks due in the coming week, the next appointments and today's daily note.
- **Notes that may matter:** found through your words, the links of the open note and what you opened or changed lately. Your privacy rules decide first; only the notes they allow are ranked at all. A few go as sections — not as whole notes —, others only with their title and a card — the first sentence of their section and every sentence with numbers, dates, tasks, negations or links, word for word — or just their name; the assistant reads more of them when it needs to.

A note this conversation already carries and that has not changed since is named, not sent again. Place stamps from your journal and mood values are never sent on their own.

## Before anything is sent

The first request of a session shows an overview: where it goes (provider and model), which notes and which part of each, what else goes along (your selection, appointments, tasks), what was kept back and roughly how many tokens. **Send** sends it; **Cancel** sends nothing and gives your words back to the input; the − next to a note leaves it out. Within what you approved, the next requests go without asking. The overview comes back whenever the scope grows: another model or provider, a new kind of data, notes from another folder, new tools, or a much larger request. A model on this device never asks.

If you want to see the overview before every request, switch on **Ask before every request** — in the overview itself or in **Settings → AI & automation** under **Sending**.

The line under each answer opens the overview of what went with it. If an answer cites none of the notes that were sent, a notice above that line says so; check the answer against the notes. Where notes went along, the line also names the coverage: **coverage high** when nearly every statement of the answer names a note, **coverage partial** or **coverage low** when fewer do.

## View context

The eye below the input, **View context**, shows what the next request would carry — before it goes, for the model chosen now. For every note: why it was chosen (open now, pinned, matches your words, close in meaning, linked, due soon …), which part goes and roughly how many tokens. For each note you can

- leave it out of the next request (**Take back** brings it back),
- pin it to the conversation,
- keep it on this device for good: that writes the rule `cloud: deny` into the note (see below).

Notes your rules keep back are listed as well, so that you know what is missing; they are never scored and never sent. **Send with this context** sends what you typed. In a wide AI tab the view stays open as a column beside the conversation.

Above the notes, **Sent** says how much of these notes goes along — for example ~870 of 3,460 tokens — and **Saved** how much less that is than sending every proposed note whole; the first time, it also says how many tokens that would have been. **Show as a trail in the graph** opens the graph with the open note and the sources ringed and the links between them.

When the text that would go to a cloud looks like it holds a password or key, an account or card number, an ID or tax number, or health details, a line under the note says **Possibly sensitive** and what it saw — in **View context** and in the overview before sending. **Keep on this device** writes the rule `cloud: deny` into the note. For numbers and secrets, **Redact in this conversation** replaces them with a placeholder such as `⟦withheld account⟧` in every message of this conversation, also where the model reads the note itself, until you choose **Send unredacted**; the overview counts them under **Kept back**. Tasks and appointments have the same choice in the line **Tasks, appointments and the open note's details**. The first time in a session that something of such a kind would go unredacted, the overview asks before sending. The check runs on this device and is a hint, not a filter: it can miss things, and it never stops a request. A selected passage goes as it is; with a model on this device no hint appears.

## Gists

With **Gists with the local model** (in **Settings → AI & automation**, off until you switch it on), a model on your computer writes short summaries of the longer sections of your notes, of whole notes, of the top-level folders and of the vault. It runs only when the profile **Local** names a server on this computer (Ollama, LM Studio; on the phone, the system's own model) — never a cloud in the background — and only while Plainva is idle; on the phone only while it is open. Every gist is checked: a section's gist must keep every number, date, amount, link, tag and negation word for word, otherwise the section's own sentences go instead. A gist is bound to the exact text it stands for; after you change the section it is not used until it has been written again. Folder and vault gists are written only from notes your rules let go to a cloud. In **View context**, a source sent as a gist says so, and **Original** sends its own sentences with the next message.

## With a selection

Select text in a note, and the AI works on just that passage.

- **Desktop:** while you edit, **AI** in the selection toolbar offers **As a suggestion** — **Rewrite**, **Shorten**, **Translate…**, **Tasks from it** — and **In the companion** — **Explain** and **Ask about the selection…** (**Ctrl+J**, ⌘J on macOS).
- **Phone:** **AI** in the bar above a selection — when reading as when editing — opens the AI sheet.
- **In every conversation:** as long as text is selected in the open note, the row **With the selection** above the input offers the same actions.

A suggestion action sends the selected passage alone — not the rest of the note, no pinned notes, no tools — and asks with the same overview as a question. The answer comes back into the note as a round of suggestions, like one from a person: under **Suggestions** you accept or decline each change or the whole round, and nothing in the note changes before you do. The round's author line reads **Plainva AI · ⟨model⟩**, so it stays visible which passage an AI wrote. **Tasks from it** adds the tasks below the passage instead of replacing it. Each action keeps its conversation in the history.

A passage from a note your rules keep from the cloud — or one with links to such notes or with place stamps — goes to no cloud model. In an encrypted workspace the suggestion actions are not available yet: its suggestions cannot name the AI as their author yet.

## In a comment thread

Address the assistant in a comment and it answers in the thread. Type an **@** in the comment field and pick **AI** — the entry with the AI mark — or type the name yourself: **@AI**, **@KI** and **@IA** all reach it, whatever language the app speaks. Once your comment is sent, the thread shows the row **is writing a reply…** under **AI**; **Stop** ends it. The answer appears as a reply in the same thread, authored **Plainva AI · ⟨model⟩**. Unlike a suggestion it does not wait to be accepted — it is a remark beside the note, never text in it — and on the device that asked you delete it like one of your own.

The thread goes to the model the way a question does: its comments, the passage it hangs on and the note itself, through the same overview. A comment thread is a kind of data of its own, so the overview asks the first time. Where your rules keep the note from the cloud, its comments do not go there either, and links in them to such notes are withheld. Only a comment you send on this device calls the assistant; one that arrives through sync never does, whatever it says. Web addresses the AI brings along itself — in a reply, a suggestion or a transcript — are written so that nothing opens or loads them (`https[://]…`); addresses your own text already contained stay as they are. In an encrypted workspace the assistant cannot be addressed yet: its comments cannot name the AI as their author yet.

## Skills

Skills are instructions for recurring work. Ten come with Plainva — among them **Daily orientation**, **Weekly review** and **Project status** as chips in an empty conversation — and you can write or import your own. Start one with a click, or simply ask: the AI loads a matching skill by itself. Your own skills run only after you approved them on this device. Everything about them: [Skills](AI_Skills.md).

## Transcribing a voice note

At every voice note — in the editor, in reading mode, in the journal and on cards — **Transcribe** turns the recording into text. It goes as it is to the model of the profile **Audio**, through the same overview as a question; a recording is a kind of data of its own, so the overview asks the first time. The transcript comes back as a suggestion under the recording, authored **Plainva AI · ⟨model⟩** — accept or decline it under **Suggestions**.

**Audio** needs a provider with an audio route: OpenAI (for example `gpt-4o-transcribe` or `whisper-1`), Gemini, or a compatible server of your own — one on this computer keeps the recording on the device. Recordings up to 11 MB can be transcribed. A recording in a note your rules keep from the cloud goes to no cloud model, and encrypted workspaces do not offer it yet.

## Privacy rules

Some notes should never reach a cloud provider. A rule can sit in a note's frontmatter:

```yaml
plainva:
  ai:
    cloud: deny
```

or, for a whole folder, in **Settings → AI & automation** (the Vault part), which writes the rules to `.agent/policy.yml`. A note kept from the cloud contributes nothing — neither text nor title — and links to it in other notes are withheld. Models on this device stay allowed. Encrypted workspaces keep the cloud off unless you allow it there. The exact format is in the [File Format Reference](File_Format_Reference.md).

## History and usage

Conversations stay on this device, per vault — never in the vault and never synced. **Keep conversations** decides how long; you can delete single conversations in the list or all of a vault at once. **Usage this month** sums up the tokens per provider and model.

## Limits of the beta

- On the desktop the AI runs in the main window only.
- On the phone an answer comes only while the app is open.
- The assistant changes no note itself: it proposes changes to a selected passage and transcripts of voice notes, as suggestions you accept or decline; in a comment thread it writes a reply beside the note, never text in it.

Feedback on the beta goes to the project's discussions on GitHub: **Feedback on the AI (Beta)** in the settings starts one.
