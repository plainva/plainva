# External agents (Beta)

Last reviewed: 2026-10-07

An external agent is an AI program of another maker — an agent you installed on your computer and signed in to yourself, with your own subscription or key. Plainva can start such an agent in the folder of a vault and show its session in the AI tab. This is part of the experimental AI features and works on the desktop only.

An external agent is not Plainva's assistant. The [AI Assistant](AI_Assistant.md) sends only what its overview showed you, and never what your privacy rules keep back. An agent reads and sends on its own. This page says what Plainva controls in such a session — and what it does not.

## What Plainva does not control

- **The program.** An agent is somebody else's program. It runs on this computer with your rights, in the vault's folder, and it is not fenced in: it can read and change whatever you can.
- **What it reads and sends.** It reads files itself — also notes you keep from the cloud — and sends what it chooses to its own service. Your privacy rules and the overview before sending do not reach it, and nothing asks you before it sends.
- **What it writes itself.** A change the agent makes itself is in the vault at once, without a suggestion. The session tells you when the agent reports such a change; a change it does not report, Plainva does not see.
- **Its sign-in.** The agent signs in by itself. Plainva never sees its credentials and keeps none.

Start an agent only in a vault whose content may reach the agent's service.

## What Plainva controls

- **Its own tools.** Where **Let AI apps on this computer read this vault** is switched on, Plainva's tools are offered to the agent — the same as for every app in [Connecting AI apps](Connect_AI_Apps.md): only the folders you grant, never a note kept from the cloud or from the internet, and reading only — unless you allow it there to propose changes.
- **What the agent asks Plainva to read.** A note kept from the cloud or from the internet and Plainva's own folders are not handed over. The agent is told so, and so are you.
- **What the agent asks Plainva to write.** Nothing is written. A change to a note becomes a round of suggestions under the agent's name, and a new note waits as a draft until you create it.
- **No terminal.** Plainva offers an agent no terminal of its own.

## Adding an agent

1. Install the agent yourself, the way its maker describes, and sign in to it in its own program.
2. Open **Settings → AI & automation** (the App part). Under **External agents**, **Found on this computer** marks the agents Plainva knows by name and finds installed; **Add** adds one. For any other program that speaks the Agent Client Protocol, choose **Add agent…** under **Another agent** and enter a **Name**, the **Program** and its **Arguments, one per line**.
3. Your system shows the whole command once more before it is remembered.

Plainva installs no agent and downloads none. It starts exactly the program you confirmed, directly and without a shell. The command is remembered on this device, never in the vault. **Remove** makes Plainva forget how to start an agent; the program itself and its sign-in stay as they are.

## Starting a session

Open the AI tab and choose **Agent**. Before anything starts, **Before you start ⟨agent⟩** lists what the agent does on its own and what Plainva controls, and says whether Plainva's tools will be offered. **Start session** starts the agent's program in the vault's folder. The first time you start an agent in a vault since Plainva was opened, your system asks once more, showing the folder and the whole command.

One session runs at a time, and it belongs to the vault it was started in: **End session** stops the agent's program, and so does closing the vault or Plainva. For as long as it runs, the first line of the session says who the agent is and that your privacy rules do not apply to it. No agent is started inside an encrypted workspace.

## Signing in

An agent that is not signed in says so, and the session shows **⟨agent⟩ wants a sign-in** with the ways the agent names. Depending on the agent, choosing one opens a terminal window with the agent's own program, or the agent takes you to its sign-in itself. Plainva waits and then starts the agent anew. Where no terminal can be opened, Plainva shows the command to run in a terminal of your own; afterwards choose **Try again**. Plainva sees nothing of the sign-in.

## In a session

Type what the agent should do. The note you have open is named to the agent — its name and where it lies, not its text — unless you remove it above the input; a note you keep from the cloud or from the internet is never named. The session shows what the agent says, its plan and each of its steps, with the files of the vault it names.

When the agent wants your leave for a step, **⟨agent⟩ asks** shows it. The words are the agent's own, and the choices are the ones the agent offers — **Allow**, **Always allow**, **Reject**, **Always reject**. Your answer goes to the agent only: what it does after a yes is its own doing, and an "always" is the agent's promise to keep, not Plainva's.

**Stop** ends the answer the agent is working on.

## What the agent writes

**Through Plainva.** A change the agent hands to Plainva is never written into the note. When the agent's answer is finished, every note it changed carries one round of suggestions, signed **⟨name⟩ (external agent)**: under **Suggestions** you accept or decline each change or the whole round, as with a round from a person. A property the agent's text changes stands in that round as a proposed value, like one Plainva's own assistant proposes. A note that does not exist yet waits as a draft — a card **Draft · Note** in the session, and the same card in the list **Open** of the AI tab, where it stays when the session has ended. **Create** writes it at exactly the place the agent named — marked `generated`, with the agent as its author — and **Discard** drops it. Web addresses the agent brought along are written so that nothing opens or loads them (`https[://]…`).

Plainva does not take everything: only Markdown notes; no AI rules, no trust fields and none of Plainva's own properties; no property value that is neither text, a number, yes or no, nor a list of those; nothing that is kept from the cloud or from the internet; no more than 150 changes to one note at a time; and no further new note while too many drafts are waiting. What it did not take, the session says, and the agent is told.

**By itself.** An agent can also write files on its own, like any program. When it reports such a change, the session says **The agent changed ⟨note⟩ itself: it is in the vault without a suggestion.** Which way an agent takes is not Plainva's to promise: it depends on the agent and on how it is set up. In the settings, each agent shows what was last seen on this computer — how many changes came through Plainva and how many it wrote itself.

## What Plainva keeps

- **On this device:** the command you confirmed, your name for the agent and what was last seen of its changes — in Plainva's own data, never in the vault.
- **Per vault:** **Last sessions in this vault** lists when a session ran, with which agent, and how many messages, changes through Plainva and changes of its own there were — never what was said.
- **Not the session itself:** what you and the agent said is gone once the session is closed. What the agent keeps on its side is the agent's own matter.

If the agent's program ends by itself, the session says so, and **Show its last lines** shows the end of what the program wrote.

## Limits

- Desktop only, and in the main window only. On the phone there is Plainva's own assistant.
- Not in an encrypted workspace.
- One session at a time, and no history: a session that ended cannot be opened again.
- An agent's own modes, models and commands cannot be chosen from Plainva, and pictures cannot be sent to it.
- So far this has been tried with a test agent of Plainva's own only. Which agents work here, and which of them hand their changes to Plainva, shows when you try them — feedback is welcome.
