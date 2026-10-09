# Memory (Beta)

Last reviewed: 2026-10-09

The memory holds what the AI should know about you and your work without being told again: what you do, how you like your answers, who your clients are. It is two files in your vault. Nothing gets into it without your yes, and you can read, change and delete every entry.

## Two places

**Always included** goes into every new conversation. Keep it short: it has room for 2,000 characters, and a bar shows how full it is. An entry that no longer fits is marked **No room left — not included** — it is saved, but not sent along. Entries are included in the order they stand in, so what matters most belongs at the top; you change the order in the file.

**On demand** is not sent along. When a question may depend on something you told the AI earlier, it looks there, and the conversation shows **Looking in the memory**. This is the place for what matters only sometimes: one client's terms, a decision and its reason.

## Opening the memory

On the desktop, choose **Memory** in the AI tab, next to **Skills**. On the phone it is **Conversations → Memory**. **Settings → AI & automation** (the Vault part) leads there as well: **Open memory** under **Skills and memory**.

## Adding an entry yourself

**New entry** asks for three things: the text — one thing per entry, a single line of at most 500 characters —, the place (**Always included** or **On demand**), and whether it is for **Only models on this device**. Tick that for anything no cloud model should be told.

The ⋯ button of an entry — on the phone, a tap on the entry — offers **Edit**, moving it to the other place (**Always include** or **Only on demand**) and **Delete**.

## Letting the AI remember something

Say it in a conversation: "Remember that I bill per day, not per hour." The AI drafts an entry; it never writes one itself. Under its answer a card **Draft · Memory entry** shows the whole text. Choose the place, then **Remember** — or **Discard**. A draft you have not decided on waits under **Open**, and the memory says how many are waiting.

"Forget that …" works the same way: the card reads **Draft · Remove from the memory**, and **Remove** takes the entry out. When you tell the AI that something has changed, the card shows under **Replaces** which entry the new wording takes the place of.

A finished conversation can suggest entries too: **Learn from this conversation** reads it once more and leaves drafts, each with its evidence. How that works, and what such a review may suggest at all, is described in [Skills](AI_Skills.md).

## A rule is not a memory

"Always answer in German" is nothing to know — it is something to do. A rule like that does not go into the memory: it becomes a line of the **Instructions of the vault** (`AGENTS.md`), which every model gets as an instruction. Add one with **Add a rule** under **Rules for the AI**, or ask the AI; its card then reads **Draft · Rule for the AI**, with the button **Add as a rule**.

Like all instructions, the file has to be approved on each device before it counts there (see [Skills](AI_Skills.md)). A rule you add on a device where the file was already approved counts there at once; your other devices ask you first.

## Privacy

- An entry can carry a rule of its own: **Not to cloud models**, **Not in conversations with the internet**. A model on this device gets every entry.
- An entry the AI drafted in a conversation that read notes under a privacy rule gets the same rules — the card says **The entry gets the privacy rules of the notes this conversation rested on.** What came from a note that has to stay on this device does not reach a cloud by way of the memory.
- Your [privacy rules](AI_Assistant.md) hold for the two files as well: a folder rule for `.agent/` keeps the whole memory from the cloud.
- The send overview has a row **Memory** — how many entries go along — and counts the entries your rules keep back under **Kept back**. It never names an entry.
- To the AI an entry is information, not an instruction: a sentence in the memory gives it no rights.
- A conversation keeps the memory it was started with. An entry you delete goes to no new conversation; conversations that have already begun keep what they were given.

## Switching it off

**Use the memory on this device** is on until you switch it off. Off, a conversation on this device gets nothing from the memory and adds nothing to it. The files stay as they are, and every device decides for itself.

## The two files

`.agent/active_memory.md` (always included) and `.agent/MEMORY.md` (on demand) are plain Markdown. Every entry is a list item, and headings group entries. What Plainva knows about an entry stands in a comment behind it:

```markdown
## Clients

- Harbour Studio pays within 14 days.
- I bill per day, not per hour. <!-- plainva: added=2026-10-09; by=assistant; source=Offer for Harbour Studio; deny=cloud -->
```

`added` and `by` say when the entry was added and whether you wrote it or accepted a draft, `source` names the conversation a draft came from, and `deny` holds its rules (`cloud`, `web`). You can edit the files in any editor. In Plainva, **Open file** opens either of them.

Plainva does not guess. An entry whose comment is damaged is marked **Rules unreadable — goes to no model** until you repair the comment or add the entry again. Text that is hidden in a comment or in invisible characters is never sent; the entry then shows how many hidden parts were left out. A file holds at most 2,000 entries and 256 KB.
