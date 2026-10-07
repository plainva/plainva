# AI Assistant (Beta)

Last reviewed: 2026-10-07

Plainva can answer questions about your notes with an AI model of your choice. It reads your vault, cites the notes it used, opens notes and views for you and proposes changes — as suggestions on a note, as drafts of something new, or as a plan you confirm. It never changes a note itself. The assistant is **experimental** and switched off until you switch it on, separately on every device.

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

The note you have open goes along automatically; remove it from the context with its ✕ if you want to. **Pin a note…** adds further notes. The assistant can also look things up itself: it searches the vault, reads notes and their sections, databases, backlinks and linked notes, lists tasks, appointments and the notes opened or changed lately, and opens notes and views. It cannot change, create or delete anything itself; what it can propose instead is described under “Proposing changes” below.

The assistant can also show you things: open a note at a heading, show a note in the graph, turn the calendar to a day, open views, show and hide the sidebars. It uses the commands of the command palette for that — and of those only the ones that show something: whatever creates, changes, deletes, exports or opens a window is not its to trigger.

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

Skills are instructions for recurring work. Twelve come with Plainva — among them **Daily orientation**, **Weekly review** and **Project status** as chips in an empty conversation — and you can write or import your own. Start one with a click, or simply ask: the AI loads a matching skill by itself. Your own skills run only after you approved them on this device. Everything about them: [Skills](AI_Skills.md).

## Transcribing a voice note

At every voice note — in the editor, in reading mode, in the journal and on cards — **Transcribe** turns the recording into text. It goes as it is to the model of the profile **Audio**, through the same overview as a question; a recording is a kind of data of its own, so the overview asks the first time. The transcript comes back as a suggestion under the recording, authored **Plainva AI · ⟨model⟩** — accept or decline it under **Suggestions**.

**Audio** needs a provider with an audio route: OpenAI (for example `gpt-4o-transcribe` or `whisper-1`), Gemini, or a compatible server of your own — one on this computer keeps the recording on the device. Recordings up to 11 MB can be transcribed. A recording in a note your rules keep from the cloud goes to no cloud model, and encrypted workspaces do not offer it yet.

## Explaining an image

At every picture of the vault, **Explain image** asks the AI what it shows.

- **Desktop:** in the toolbar of an open image, and in the menu a right-click on a picture in a note opens — while editing and in reading mode.
- **Phone:** below an open image (at a picture in a note, **Open image** takes you there).

The picture goes, with the question, to the model new conversations start with — in a conversation of its own, where you can ask on: what a table says, what stands in the second column, what a diagram means. The overview shows the picture before it is sent; a picture is a kind of data of its own, so the overview asks the first time.

**What goes is not the file.** Plainva draws the picture, scales it down to at most 1,568 pixels on its longer side and saves it anew for sending. So it goes without what the file records about it: the place a photo was taken, the date, the camera. The overview shows exactly the picture that goes, with its size. That copy stays with the conversation on this device, so you can still see later what the provider got; delete the conversation and it is gone.

**Rules.** A picture in a folder your rules keep from the cloud goes to no cloud model. Neither does a picture that a note with the rule `cloud: deny` shows — wherever you press **Explain image**, also at the open image: before sending, Plainva looks up which notes embed the picture, and if it cannot find that out, the picture stays. A model on this device stays allowed. What is written in a picture is content, like a note's text, never an instruction: the conversation of **Explain image** can look things up in your vault, but it cannot use the internet and triggers nothing in the app.

**Which models read pictures.** Most cloud models do. The system's own model on the phone does not, and **Explain image** says so. Where a provider's list says that a model reads no images, the overview tells you before you send. If a provider turns the request down, choose another model below the conversation and ask again — the picture is still in it.

## On the internet

The assistant cannot use the internet until you allow it — three times over:

1. **For the vault.** In **Settings → AI & automation** (the Vault part), switch on **The AI may use the internet in this vault**. It is off for every vault until you decide, and it applies on this device only.
2. **For a conversation.** Before the first message of a new conversation, press the globe under the input field — **Let this conversation use the internet**. Whether a conversation may use the internet is decided when it starts; to change it, start a new conversation. A conversation that may use it says so in its first line. Starting the skill **Research** is the same choice: its conversation may use the internet — see [Skills](AI_Skills.md).
3. **For every request.** While your notes are in the conversation, every page the assistant wants to read and every search it wants to make asks first, with the whole address or the search words — that is everything that leaves your device for it. **Read page** or **Search** lets this one request through; **Don't read** or **Don't search** leaves it, and the assistant goes on without it.

**What a request is.** Reading a page is one request from this device to the site, like opening the page in a browser — without cookies, without a login and with nothing from your notes; as with any visit, the site sees your internet address. Only public pages over `https` are read; addresses in your home or company network are refused. A search goes to the provider of your model — Anthropic, OpenAI, Google Gemini or OpenRouter — which searches with exactly the words you were shown; providers may charge for searches separately. A model on this device can read pages but cannot search, and the system's own model on the phone cannot use the internet at all.

**Where an address comes from.** The question says whether you named the address, whether a note or a result named it — or whether the model put it together itself. An address the model composed could carry something from your notes in it: read it before you let it through.

**Sites that need no asking.** With **Always for ⟨site⟩** in a question, or under **Sites that need no asking** in the vault's settings, pages of a site are read without asking — as long as you, a note or a result named the address. An address the model composed always asks.

**What the assistant reads.** Never the page itself. A second request to the same model, one that has no tools, reads the page and writes a short report: a summary, statements with the passage they rest on, and links that really are on the page. A page that tries to give the assistant instructions therefore reaches it as a report about a page — never as a page it works on. Under the answer, **Read on the web** lists the pages that were read, and the line under it opens everything that was asked for.

**Notes that stay out.** A note or folder with **Web access: never** (see Privacy rules below) does not exist for a conversation that may use the internet: not in its context, not for its tools, and links to it are withheld.

A link in an answer whose address the model composed itself is marked, and the question before it opens says so. If no answer comes back at all — no connection, the provider does not respond — the conversation lists the notes that match your question best instead.

## Mail and appointments

**Appointments.** The assistant lists appointments from your connected calendars — day, time and title, on request also the place and who takes part — and reads a single appointment in detail: the organiser, the attendees with their answers, and your own. It never gets the link of an online meeting; that stays in the calendar.

**Mail.** Where mail accounts are connected in this vault, the assistant can search and read messages. Mail is not one of the tools a conversation starts with: the assistant looks for it only when your question needs it, and at the first access Plainva asks — **Read your mail?** **Allow** holds for this provider until you close Plainva; another model or another provider asks again. **Don't allow** leaves the access out, and the assistant carries on without it. A model on this device does not ask, because nothing leaves the device for it.

**What the assistant reads of it.** Of a search it sees the date, the sender and the subject of the messages — never their text. It never reads the text of a message or the description of an appointment itself: other people wrote them, and whoever writes a mail or an invitation can write it for exactly this reader. A second reader without any tools reads them and writes a short report — a summary, statements with the passage they rest on, and links that are really in there. If a model on this device is set up as **Local** under **Models and profiles**, it is that reader, and the text itself does not leave the device; only the report goes to the provider. Otherwise the conversation's provider reads it, in a request of its own without tools. The question tells you beforehand who reads.

**What does not change.** The assistant only reads: a message it read stays unread, nothing is moved, answered or deleted, and it does not open attachments — it only names them. Below the answer you see how many messages were read, and the line below it says who read the text.

## External tools (MCP)

The assistant can use tools of servers you connect yourself, over the Model Context Protocol (MCP) — a ticket system, a wiki, a database of your team. It is the other direction of [Connecting AI apps](Connect_AI_Apps.md): there, other apps read your vault through Plainva; here, Plainva's assistant asks other servers. Nothing of a server is used before you have looked at what it offers, and every call is shown to you before it goes out.

**Adding a server.** In **Settings → AI & automation** (the Vault part), under **External tools (MCP)**, choose **Add a server…**. Give it a name of your own and its address (`https://…`), and an access token if the server asks for one — it goes into this device's secure store and is never shown again. On the desktop a server can also be a **Program on this computer**: the file to start, its arguments and the values for its environment. Plainva starts it directly, without a shell, and in a sandbox where your computer has one Plainva can use. Your system shows the address or the whole command once more before it is remembered. On the phone a server is always an address.

**Signing in.** Some servers want a sign-in instead of a token. Its review then says **The server asks for a sign-in.** Choose **Sign in…**: Plainva asks the server where its sign-in lives, opens that page in your browser and waits until you are back. What it receives stays in this device's secure store and goes only to this server; neither you nor the AI ever sees it. It is renewed without you for as long as the server allows, and when it has ended, the review asks you to sign in again. Where the sign-in service does not let apps register themselves, Plainva asks for the **Client ID** the operator of the server gave you. **Sign out** forgets the sign-in; a sign-in and a stored access token replace each other.

**Reviewing it.** A server that was just added offers nothing yet. Its review shows what is registered and what the server lists: its own description, its tools with their descriptions — the server's own words — and its prompts. **Approve** allows exactly these texts, on this device. Before a server is used, Plainva loads what it lists again and compares it with what you approved; if anything differs, the server is blocked until you look again, and the review says what changed.

**What a vault allows.** Each vault decides for itself: whether it uses the server (**Use ⟨server⟩ in this vault**), which of its tools the assistant may call — none is ticked, and only tools that say they only read can be —, and under **Notes that may go with a call** whether **None**, **Chosen folders** or **The whole vault**.

**In a conversation.** The tools of your servers are not among the tools a conversation starts with: the assistant looks for them only when your question needs them, and the overview before sending names the servers they belong to. Every single call asks first — **Call ⟨server⟩?** — with the tool and exactly what would be sent. **Call** lets this one call through, **Don't call** leaves it, and there is no "always". A call does not go out at all if the conversation has read a note that lies outside what the vault allows this server, or one you keep from the cloud. What comes back is treated as a stranger's text: the assistant reads it and takes no instructions from it.

**Prompts.** A server can offer prompts — ready-made requests. They stand under an empty conversation, and only you start them. The first time, Plainva shows what a prompt expands to before it is sent as your message; from then on exactly that text goes without asking, and another text blocks the server.

**What Plainva keeps.** The address or the command is remembered on this device, the stored values in its secure store; your approval lies in Plainva's own data, never in the vault — so whoever can write the vault cannot approve a server. Under **Recent calls in this vault** the review lists when a tool was called, which one and how it ended — never what was said. **Remove server** deletes the server from this device, for every vault.

A conversation a skill started, an action on a selection and a reply in a comment thread do not reach external tools, and neither does the system's own model on the phone.

## External agents

On the desktop, Plainva can also start an AI agent of another maker in the vault's folder — a program you installed and signed in to yourself. Such an agent is not the assistant: it reads and sends on its own, and your privacy rules and the overview before sending do not reach it. What Plainva controls in its session and what it does not: [External agents](External_Agents.md).

## Proposing changes

The assistant can propose more than an answer — and nothing it proposes is in your vault until you say so. There are three forms, and each waits where you decide about it.

- **A suggestion on a note.** Ask for a change to a note that is there, and the assistant lays it on the note as suggestions: in the margin, signed “Plainva AI · ⟨model⟩”, each change to accept or decline on its own — like a person's suggestions, see [Comments & Suggestions](Comments_and_Suggestions.md). Under the answer a line names the note; press it to open the note. A value for one of the note's properties is proposed the same way: the card shows the property with what it says now struck through and what it would say, and marks a property the note does not have yet as new. If the property says something else by the time you decide, the card tells you that the suggestion no longer fits. Who made a note and who vouches for it is nothing the assistant can propose (see [OKF](OKF.md)), and neither are the properties Plainva keeps for itself.
- **A draft.** A new note, a task or a journal entry is left as a draft: a card under the answer says what it would become and where it would go. **Create** makes it — the note in the folder the card names (the **Inbox folder**, unless the assistant named another), the task read from its words as if you had typed them into the capture field, the entry in the journal of the day on the card. **Show** unfolds a note's text first; **Discard** throws the draft away. A note made from a draft says who wrote it (`generated`, see [OKF](OKF.md)) and names the notes the conversation rested on. Where your new tasks also go to a task list of your provider, a task's card carries the capture field's switch, **Also create in “…”**: it is on, and the task is created there as well unless you switch it off.
- **A plan.** Renaming, moving or deleting a note cannot be reviewed piece by piece, so the assistant asks: a question above the input field shows what would happen — the new name and how many links in how many notes follow it, or the target folder, with a warning if the note would leave a privacy rule of its folder behind. After your yes, Plainva does it the way it does when you do it yourself; the assistant only learns whether it happened. For a deletion the question merely opens Plainva's own delete dialog: nothing is gone before you confirm there. One of a note's own privacy rules is asked about in the same way and is never laid down as a suggestion: the question names the rule and whether it would be written into the note or taken out — with a warning where taking it out lets the note go to cloud models or into conversations with the internet again. After your yes Plainva writes it; the rule holds from then on and does not take back what a conversation has already sent.

Everything that waits is in one list: **Open**, a segment of the AI tab on the desktop and of **Conversations** on the phone. It names the notes that carry suggestions of an AI and the drafts of this device, each with who left it. Drafts are kept on the device they were made on, like conversations; suggestions belong to the note's comments and reach your other devices with them.

Three limits hold whatever the assistant is asked. A web address it brings into a suggestion or a draft is written so that nothing opens or loads it (`https[://]…`); an address you typed yourself stays as it is. A conversation that has read a note kept from the cloud or from the internet lays a suggestion, a task or a journal entry only where the same rule holds — a drafted note takes the rule along instead. And in an encrypted workspace nothing is proposed, drafted or planned.

A skill has these abilities only when it names them, and its review says so — see [Skills](AI_Skills.md).

## Keeping an answer as a note

Under every finished answer, **Keep as a note** turns the answer into a note of your vault. You press it and Plainva writes the note — the assistant itself still changes nothing.

- **Where it goes.** Into the vault's **Inbox folder** (**Settings → Content & structure**), under a name taken from your question — in a conversation a skill started, from the skill and the note that was open, or the day. A note that is already there is never touched: the new one gets the next free name. Plainva opens it right away.
- **Who wrote it.** The first line says it in words — an answer by Plainva AI, with the model, the time and your question. The note's properties say the same for other tools: `generated`, with the model and the time. Nothing marks the note as checked; that stays yours to do — see [OKF](OKF.md).
- **What it rests on.** Below the answer, **Sources** lists what the run really used. Plainva writes this list from its own record, not the model: the pages that were read and when, the searches and through which provider, and your notes that went along or were read. The properties carry the same list as `sources`.
- **Addresses.** Every web address the model wrote into its answer is written so that nothing opens or loads it (`https[://]…`), and an image from the web is never an image in the note. Only the pages under **Sources** are real links: addresses the run read with your leave. Links to your own notes stay links.
- **Rules.** A kept answer inherits the privacy rules of what it rests on. If a note that went along with the conversation, or one the assistant read, is kept from the cloud or from the internet, the new note carries the same rule — written into the note itself where its folder would allow more. So an answer that a model on this device made from a private note does not reach a cloud as a note either.

In a shared workspace its members can read a note — and so can the readers of a publication that covers the folder. There Plainva asks every time, with the note's name and the folder: **Keep as a note** writes it, **Don't keep** leaves it.

## Privacy rules

Some notes should never reach a cloud provider. A rule can sit in a note's frontmatter:

```yaml
plainva:
  ai:
    cloud: deny
```

or, for a whole folder, in **Settings → AI & automation** (the Vault part), which writes the rules to `.agent/policy.yml`. A note kept from the cloud contributes nothing — neither text nor title — and links to it in other notes are withheld. Models on this device stay allowed. Encrypted workspaces keep the cloud off unless you allow it there. The exact format is in the [File Format Reference](File_Format_Reference.md).

A picture belongs to the notes that show it: one that a note kept from the cloud embeds goes to no cloud model either (see Explaining an image above).

A second rule, `web: deny` — **Web access: never** in the settings — keeps a note or a folder out of every conversation that may use the internet.

On an iPhone or iPad, the same two rules decide which note titles Siri and Shortcuts may find, once you have switched that on: a note kept from the cloud or from web access is never named to them. See “Siri and Shortcuts” in [The mobile app](Mobile_App.md).

## History and usage

Conversations stay on this device, per vault — never in the vault and never synced. **Keep conversations** decides how long; you can delete single conversations in the list or all of a vault at once. **Usage this month** sums up the tokens per provider and model.

## Limits of the beta

- On the desktop the AI runs in the main window only.
- On the phone an answer comes only while the app is open.
- The assistant changes no note itself: a change to a note and the transcript of a voice note are suggestions you accept or decline, something new is a draft until you press **Create**, and a rename, a move or a deletion waits for your yes; in a comment thread it writes a reply beside the note, never text in it. An answer becomes a note only when you press **Keep as a note**; Plainva writes it then, not the assistant.

Feedback on the beta goes to the project's discussions on GitHub: **Feedback on the AI (Beta)** in the settings starts one.
