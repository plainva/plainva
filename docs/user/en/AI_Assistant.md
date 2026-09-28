# AI Assistant (Beta)

Last reviewed: 2026-09-24

Plainva can answer questions about your notes with an AI model of your choice. It reads your vault, cites the notes it used and can open notes and views for you — it does not change anything. The assistant is **experimental** and switched off until you switch it on, separately on every device.

## Switching it on

Open **Settings → AI & automation** (the App part) and switch on **Use AI on this device**. Without the switch there is no AI button, no AI tab and no companion. Nothing is sent anywhere until you ask something.

## Choosing a provider

Plainva does not bring its own AI service: you use a provider you choose, with your own key. Every provider can be chosen; Plainva names their terms and retention so that you decide — it excludes none.

| Kind | Providers |
|---|---|
| Cloud providers | Anthropic, OpenAI, Google Gemini |
| Gateways and own servers | OpenRouter, any **OpenAI-compatible server** |
| On this computer (desktop) | Ollama, LM Studio |

1. In **AI & automation**, choose **Add provider** and pick one. Each entry carries a short note on its terms — for example that Google's free access may let people read your inputs.
2. Enter the key with **Enter key**. The key goes into this device's secure store; Plainva never shows it again — neither to the AI nor on screen.
3. **Test connection** loads the provider's own list of models. If it fails, the message says why (a rejected key, no connection, an unknown model).

An **OpenAI-compatible server** is added by its address. Plainva asks once more before it adds it, in a window of the operating system, and sends only to the address you confirmed. Plain `http` works only for a server on this device; everything else needs `https`.

If you have no key yet: a model on this computer (Ollama, LM Studio) costs nothing, and every provider's console issues keys.

## Models and profiles

Four profiles — **Fast**, **Balanced**, **Strong** and **Local** — are your assignment of models. Choose a provider and a model for each, from the provider's list or by typing the model id exactly as the provider names it. **Default for new conversations** decides which profile a new conversation starts with. Plainva names no model "the best".

## Asking

- **Desktop:** the AI button in the action bar, **Ctrl+J** (⌘J on macOS) or **Ask AI** in the command palette opens the companion — a small window over your work. **Open as tab** moves the same conversation into the AI tab, where your conversations are listed.
- **Phone:** **Ask AI** in a note's ⋮ menu opens the AI sheet over that note. The **AI** area (in the areas sheet, or in the navigation bar if you put it there) shows the conversation full screen; **Conversations** lists the earlier ones.

The note you have open goes along automatically; remove it from the context with its ✕ if you want to. **Pin a note…** adds further notes. The assistant can also look things up itself: it searches the vault, reads notes and their sections, lists tasks and opens notes and views. It cannot change, create or delete anything.

Every conversation starts with the line "Answers are written by an AI — ⟨model⟩ via ⟨provider⟩". Under each answer a line says what was sent where: how many notes, roughly how many tokens and — where the provider publishes prices — the approximate cost. **Stop** ends an answer at any time.

A link in an answer opens only after you confirmed its address, and images in answers are never loaded.

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
- The assistant reads; proposing changes as suggestions comes in a later version.
