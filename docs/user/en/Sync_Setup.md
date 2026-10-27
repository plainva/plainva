# Sync Setup

Last updated: 2026-10-26

Plainva optionally syncs each vault with a storage of your choice — straight from the app, with no Plainva-run service in between: your data travels exclusively between your computer and your own account/server. This page walks through the setup per provider.

Which services work in general (also via WebDAV or the provider's desktop client) is covered in [Sync Compatibility](Sync_Compatibility.md).

## Compare preserved revisions

When a text conflict cannot be merged automatically, one local working copy stays open per original. Further edits are saved to that same copy, including after reopening the note or restarting the app. The banner explains: **You are editing your conflict copy. It will sync after you merge it.**

In the comparison, **Compare preserved revisions** shows the saved starting version when available. If the working copy changes outside this editing session, that other version is also preserved and can be compared there. Adopting, keeping both and discarding check the current files again; reload a comparison that is out of date. Resolve the conflict before moving or deleting the affected file or its folder. Older conflict copies remain listed separately.

While a conflict is open, the rest of the app goes on working with the note. A change made outside the editor — a database cell, a ticked task, a journal entry, a link that follows a renamed note — is written into the note and into your conflict copy alike, so it is there whichever version you keep. Where your copy no longer has the place the change belongs to (a task you reworded there, for example), the copy stays as you left it and the comparison shows the difference. If another device changes the same place in the note itself before your device has uploaded it, the note's own text is not lost: it is kept as a further conflict copy beside the note.

The diagnostics export also includes recent conflict events: storage type, writer, hash comparison and differences in line endings, BOM or final newline. These conflict records contain no note content or file names. The export is always in English, whatever the app language, so you can paste it into an issue on GitHub as it is.

## Basics

- Setup lives under **Settings → your vault → Cloud accounts**: **Connect account…** opens the assistant — pick the **provider** first, then tick the **services** (for file sync: **Files**), then sign in. The tile overview lists providers by real-world reach; **Search providers…** also finds the email providers that ship as presets. Exactly **one** account per vault carries the **Files** service. The **Sync** area then shows the connected account and keeps what applies to the whole vault (encryption, settings sync, queue, diagnostics); **This account's cloud folder and interval** leads to the account's **Files** page with the **Cloud folder**, the **Sync Interval (seconds)**, the sync state and **Pause sync**. As soon as the **Files** service is connected, the assistant asks once for the **cloud folder** — for every provider, with **New folder** right in the picker; **Browse** stays as the way back. With WebDAV the folder is part of the server address, so there is no picker there.
- For the **Files** service, besides **Microsoft** (OneDrive), **Google** (Drive), **Dropbox**, **Nextcloud**, **Object storage (S3)** and generic **WebDAV / CalDAV**, the tiles also include **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru**, **Koofr** and **pCloud**: there, your email address plus an **app password** is enough — the server addresses are already filled in (WebDAV-based; changeable via **Advanced: set endpoints individually**).
- **Open an existing online vault from the start screen**: **Open Vault** → **Online vault** walks you through the same three steps for every provider — **1. Connect** (sign in or enter credentials), **2. Choose the folder in the cloud** (a fresh folder can also be created there via **New folder**), **3. Choose or create the local folder**. Alternatively you can set up sync for an already-open vault any time under Settings. With Google Drive and OneDrive, step 1 signs you in with **Sign-in on this device** — the same as in **Cloud accounts** — and the vault gets its account there right away.
- **Create a new vault in the cloud**: **New Vault** → **With an online service** — first pick the starter structure (empty or a template like PARA), then connect and choose the target folder in the cloud or create it via **New folder**, finally the local folder. The structure is created in the local folder and uploaded automatically by the first sync.
- Local saves are uploaded immediately; Plainva checks for remote changes at the configured **Sync Interval (seconds)**.
- Offline changes are queued and transferred on the next contact; the status bar shows **Online**/**Offline** and the sync indicator shows the state (**Sync now** on click). During a long or first-time sync the status bar shows the progress as a count (e.g. **Sync 123/540**), so you can see it working through the vault.
- If both sides change the same file, Plainva merges them automatically (3-way merge). If that is not possible, your version is safely preserved as a `.CONFLICT` file — nothing is ever lost (see [FAQ](FAQ.md)).
- **Resolving conflicts**: a banner in the affected note (and **Resolve conflict…** in the `.CONFLICT` file's right-click menu in the tree) opens the comparison dialog — the file's current state on the left, your preserved version on the right, editable with per-block take-over. **Save right side & resolve** writes the result into the file and cleans up the conflict copy; **Keep the other side** discards your copy (a version snapshot remains). The sync error dialog also lists existing conflict copies and takes you to the same comparison with one click.
- **Mass-deletion protection**: if an unusually large share of the synced files is about to be deleted in the cloud at once (for example because the local vault folder was emptied or moved), Plainva holds the deletions and asks first: **Delete in the cloud** executes them, **Don't delete (restore)** discards them and restores the files from the cloud on the next sync. Deletions you confirmed in Plainva yourself are not held — for large deletions (more than 10 files or more than 20% of the vault) Plainva instead asks a second time before deleting.
- **A file deleted in the cloud that has changes here**: if another device deleted a file in the cloud while this device still had changes to it that were not uploaded yet, Plainva does not delete it. It keeps the file, uploads it again as a new file and tells you once which file it was. If you do want it gone, delete it again here. This applies on desktop and mobile.
- Attachments (images etc.) are synced too.
- **Empty folders** sync as well: a folder created in Plainva appears in the cloud right away, and empty cloud folders appear on your other devices with the next full listing at the latest.
- Credentials and tokens are stored in the operating system's keychain (status: **Settings → App → About & diagnostics → OS keychain**), never in files inside the vault.
- **Stored access** (**Settings → Vault → Synchronisation**) shows what Plainva has placed in the keychain — including entries from vaults you stopped opening long ago. Each row names the service and the vault; **Remove** asks first. Plainva never deletes anything here on its own.
- Keychain entries carry **readable names** — `plainva · <vault> · <service> · <account id> · #<fingerprint>` instead of a base64 string. Plainva renames existing entries once, the first time a vault is opened; if a rename cannot be completed safely the old entry stays where it is and Plainva tries again on the next open.
- **Pause sync** (on the account's **Files** page) stops the vault's sync on this device; no files are deleted anywhere by doing so, and switched off again it goes on where it stopped.
- **`http://` is allowed, `https://` is the recommendation.** A server you run on your own network usually speaks plain `http` — that works, on the phone too. Across the internet you should not: WebDAV sends your password with **every** request, in the clear over `http`. If you enter an unencrypted address outside your own network, Plainva says so in the form — it does not stop you.

## WebDAV / Nextcloud

The simplest route for self-hosted servers and most cloud storages:

1. In **Cloud accounts** → **Connect account…** pick the **Nextcloud** tile (or **WebDAV / CalDAV**).
2. Enter the **Server address**, **Username** and **Password or App Token** — use an app password instead of your main password whenever possible (in Nextcloud: Settings → Security → App passwords).
3. **Connect** validates the credentials; afterwards pick the **Cloud folder** via **Choose folder…**. A **new folder** can be created here too — as everywhere Plainva picks a cloud folder, on the phone under **Change cloud folder** as well.

**Nextcloud** special: ONE form covers files **and** calendar — Plainva derives the WebDAV and CalDAV endpoints from the server address itself (the derived addresses are shown in the assistant; **Advanced: set endpoints individually** allows separate URLs). Tick both services and a single pass connects both.

Typical server addresses (Nextcloud, Koofr, MagentaCLOUD, Storage Box and many more) are listed in [Sync Compatibility](Sync_Compatibility.md).

**The address points at the vault folder itself.** Everything below it belongs to the vault, so an address one level too high pulls the neighbouring folders in as well. With WebDAV the folder is part of the server address — to move the vault later, connect the account again.

Password changes are checked with every affected password-protected service first. If saving is interrupted, confirmed changes are retained. Open the account again and choose **Continue saving**. The protected operation remains available after a restart. If the account binding or credentials have changed, choose **Verify password again** to check the current password for the services now assigned to the account. Missing credentials are not skipped. A fresh calendar sign-in is also used when a previously closed vault is next opened.

A new calendar connection remains bound to the vault where you started it. If you close or switch that vault during verification, start the connection there again. If existing credentials cannot be read, account merging stops and preserves the existing accounts.

## Google Drive

Google Drive signs in with **Sign-in on this device**. By default that is the **Standard sign-in**: when your build includes it, you enter nothing. If it does not, Plainva says so and asks for your **Own client ID** — a client from a free Google Cloud project of your own, owned by you alone ("Bring Your Own"). The step-by-step guide: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Short version: in **Cloud accounts** → **Connect account…** pick the **Google** tile, tick the **Files** service, then **Sign in with Google…** — the sign-in opens in your browser. With your own client ID you enter it first under **Other sign-in** in the wizard: on the desktop the **Client ID** and **Client Secret** of a client of type "Desktop app", on the phone only the **Client ID** of a client of type "iOS". Once connected, pick the **Cloud folder** via **Choose folder…** straight from your Drive (subfolders included, default "Plainva"). Note: while your own Google project sits in **testing** mode, the sign-in expires after **7 days** — for good, because Google lets the refresh token expire too in that mode, so Plainva cannot renew it in the background. Sync then tells you the sign-in has expired, and **Sign in again** in the account details restores it — one round trip for **all** services of that account. **In production** removes the fixed expiry of testing mode. It does not guarantee a permanent sign-in: Google can still expire or revoke access. Publishing and verification requirements depend on the use and requested permissions. [Google: refresh token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).

If you tick **Files** and **Calendar & tasks** together while connecting, Google asks for your consent only **once** — requesting exactly the permissions of the services you picked. Adding another service later asks once more, for everything the account carries plus the new service.

## OneDrive

Plainva ships its own sign-in for Microsoft (the **Standard sign-in**) — you **need no ID of your own**:

1. In **Cloud accounts** → **Connect account…** pick the **Microsoft** tile and tick the **Files** service (OneDrive) — on request together with **Calendar & tasks** and **Email** (one Microsoft account can carry all three services).
2. **Sign in with Microsoft…** and confirm the sign-in in the browser. Done — Plainva creates the folder (default "Plainva") and syncs its entire content, including externally added files.
3. Optional: once connected, pick the **Cloud folder** via **Choose folder…** straight from your OneDrive (subfolders included).

Optional: under **Sign-in on this device** → **Change** → **Own client ID** you can instead enter the application (client) ID of an app registration of your own (e.g. for corporate restrictions) — for this device only. Detailed guide: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

**One sign-in for every service.** For **Microsoft** and **Google**, connecting an account, switching on another service at it and **Sign in again** are the same step: the provider asks for your consent **once**, for everything the account carries plus what you add, and Plainva keeps a single sign-in for the whole account. Afterwards each service shows its own result — active, or **Not allowed – left unticked at sign-in. Sign in again and tick the service.** if you took its tick off on the provider's consent screen; signing in again and ticking it fixes that. A service that fails does not hold up the others. If you connect an account the vault already has, Plainva adds the services to that account instead of creating a second one, and says so. The sign-in step of the wizard shows only what this provider needs for the chosen services: for Google and Microsoft one button, **Sign in with Google…** or **Sign in with Microsoft…**, with the standard sign-in; your own client ID — and for Google, only when **Email** is chosen, **Email with app password** — sit folded under **Other sign-in**. For an email mailbox the servers sit behind **Advanced: set endpoints individually** once the address names a known provider; for Dropbox the own app key is under **Other sign-in**. **Sign in again** with a different account than the one shown is refused, and nothing changes.

The wizard carries the provider you picked **through every step**: steps 2 and 3 open the matching form right away (the Google calendar form instead of a provider chooser, Gmail instead of a generic IMAP form) and never ask again who you wanted to connect. What one step collected is already there in the next — for Nextcloud, Plainva derives the CalDAV address from the server address of step 1, and a suite password is typed once instead of three times. Those details live in memory for the length of the run only; they are stored nowhere and are gone once the run ends — including when you end it with **Leave wizard**.

Accounts that still keep one sign-in per service from an earlier version say so on their page. **Sign in again** covers every service of the account — on the desktop as well as in the [mobile app](Mobile_App.md): one round trip, and afterwards every service shares the same sign-in. That is more than convenience: separate sign-ins could drift apart, leaving one service running while another one of the same account had quietly expired.

**Gmail at the Google account.** When the sign-in on this device allows mail, Gmail is part of the same consent and the mailbox is bound to the Google account. When it does not — the **Standard sign-in** without Google's approval for mail — switching on **Email** at the Google account asks for an **App password** right there, under **Gmail with an app password**: at the same account, never as a second one. Signing in to Google again keeps such an app password. Outlook keeps stored sign-ins and running connections separate for each vault, even when the same account profile exists in several vaults. This applies on desktop and mobile.

Files, calendar and Outlook mail each need their own permissions. Working file sync therefore does not mean that the calendar or mailbox is also authorized. Plainva checks the permissions for each service; if a permission is missing, sign in again and grant the required access. Equivalent Google permission names are recognized.

**Sign-in on this device.** Which sign-in a device uses for Google or Microsoft is set per device, not for the whole account — other devices keep their setting. You see and change it on the account page (desktop: **Settings → your vault → Cloud accounts** → the account → **Sign-in on this device** → **Change**; phone: the account in **Cloud accounts** → the row **Sign-in on this device**) and in the wizard under **Other sign-in**. The **Standard sign-in** is the default whenever your build includes it; then you enter nothing. **Own client ID** takes, for Google on the desktop, the **Client ID** and **Client Secret** of a client of type "Desktop app"; on the phone (Android and iPhone) the **Client ID** of a client of type "iOS" with the bundle ID `com.plainva.app`, without a secret; for Microsoft the application (client) ID of your app registration. If your build has no standard sign-in for Google, Plainva says so and asks for your own client ID. Signing in again uses this device's setting. The row names what this device signs in with: **Standard sign-in** or **Own client ID** with the last six characters of the client ID, such as “(…a1b2c3)”.

**Check connection.** Every account page offers **Check connection** — a dialog on the desktop, a sheet on the phone. Each service reads something small and shows **Works**, **Not signed in**, **Sign-in expired – sign in again**, **Not allowed – sign in again and tick the service** or the error in words. Every row that does not work carries its action: **Sign in**, **Sign in again** (for an account with a password it opens the password) or **Grant permission**. When Google refuses Gmail — the permission was not granted, the app is not verified, or the project reached its user limit — the email row also offers **Connect with app password**: Gmail then goes over IMAP with an app password, at the same account, and the refused mailbox gives way to it. If the provider rejects this device's own client ID because it was deleted or is not approved, the row says so and offers **Use standard sign-in** when your build includes the standard sign-in. The result is noted in the diagnostics.

**Sign-in needed, signing out, removing.** A Google or Microsoft account shows, in the list and on its page, the state of its one sign-in on this device. **Sign-in needed** means this device is not signed in for the account; **Sign in** stands beside it. If it says **sign-in expired**, the sign-in no longer works; **Sign in again** stands beside it. **Sign out on this device** deletes this device's sign-in — for a password account the password stored here — the account, its services and settings stay, other devices stay signed in, and nothing is revoked at the provider; afterwards the account shows **Sign-in needed**, and **Sign in** asks for the password again. **Remove account…** takes the account with all its services out of the vault, on every device, after asking — the question says what goes (the services of this account, the sign-ins on every device, its calendar cache) and what stays (every note, filed mails and event notes too; nothing is deleted at the provider). The vault and its notes stay. If the account that carries the vault's files is signed out on this device, the vault does not sync here, and its sync status says so: **Sign-in needed**, with **Sign in**, which leads to the account. Removed and connected again to the same folder, the vault carries on where it stopped and sends what waited; connected to another folder, it starts from its files and sends nothing that was meant for the old one.

**The account page.** Every account — Google, Microsoft, Dropbox, iCloud, Nextcloud/WebDAV, S3, an email mailbox or **On this device** — has the same page in the same order, on the desktop and on the phone: (1) the **head** with the account's one state, **Connected**, **Sign-in needed** or **Expired**, and only when it needs one its button **Sign in** or **Sign in again**; (2) the **services** **Files**, **Calendar & tasks** and **Email**, each with a switch, one line of state and an arrow to this account's page of the service; (3) **Access on this device** — the sign-in for Google and Microsoft, the app key for Dropbox, server, user and password for a password account, the keys for S3, the system permission for **On this device**; (4) **Check connection**; (5) the end with **Sign out on this device** and **Remove account…**. What a provider cannot do is missing, never moved elsewhere. A switch turned off stops the service for the vault on every device; the connection, the calendar cache and filed mails stay, and switched on again it goes on where it stopped.

**A service's page of an account.** The arrow beside a service opens what belongs to this account: for **Files** the **Cloud folder**, the **Sync Interval (seconds)**, the sync state and **Pause sync** (this device only); for **Calendar & tasks** the account's calendars and task lists with their switches, a calendar's own colour (it paints only this vault; the provider keeps its own) and the **Default calendar for events**; for **Email** the folders, the senders and the signature. Each page leads to the settings every account shares: **Sync**, **Calendar** and **Email** under your vault keep what applies to all accounts — reminders, the meetings folder, rules, out-of-office, the filing folder. While files are off for the vault, no device syncs notes; the settings keep travelling, so switching files on again — and calendars or mailboxes switched meanwhile — reach every device. A device with **Pause sync** or signed out stands completely still.

## Dropbox

Plainva ships its own Dropbox app — **no own app needed**:

1. In **Cloud accounts** → **Connect account…** pick the **Dropbox** tile (it carries only the **Files** service).
2. **Sign in with Dropbox…** and confirm in the browser. Done (default folder `/Plainva`).
3. Optional: once connected, pick the **Cloud folder** via **Choose folder…** straight from your Dropbox (subfolders included).

Optional: via **Use your own app ID** you can instead supply a self-registered app key. Detailed guide: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## S3-compatible storage

For AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner and others — key-based, no browser sign-in at all. In **Cloud accounts** → **Connect account…** pick the **Object storage (S3)** tile and fill in the fields:

| Field | Meaning |
|---|---|
| **Endpoint** | Base URL of the S3 API, e.g. `https://s3.eu-central-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com` or `http://127.0.0.1:9000` for local MinIO |
| **Bucket** | Bucket name |
| **Region** | SigV4 region; `us-east-1` works for most non-AWS stores, Cloudflare R2 uses `auto` |
| **Access Key ID** / **Secret Access Key** | An API key pair from the provider |
| **Key Prefix (optional)** | Subfolder inside the bucket for the vault; empty = bucket root |
| **Path-style URLs** | Recommended (MinIO, R2 and most compatibles); disable only for virtual-hosted AWS buckets |

You can pick the **Key Prefix** (the cloud folder) via **Choose folder…** straight from the bucket once connected.

After **Connect**, sync starts right away.

## See also

- [Sync Compatibility](Sync_Compatibility.md) — which services work and how, including the desktop-client route
- [FAQ & Troubleshooting](FAQ.md) — conflict files, offline behavior

## Sync encryption (passphrase)

> **Replaced in P3:** The controls described below are no longer used for vault content. Use [Security & Sharing](Security_and_Sharing.md) for the current encrypted-workspace setup. The passphrase controls that remain on this page protect only the optional settings/secrets sideband.

Plainva can encrypt what leaves your device for the sync server, while your local vault always stays plain Markdown that Obsidian can read.

Open **Settings → Synchronisation → Sync passphrase & encryption**:

1. **Set a passphrase.** This creates an encryption key for the vault and shows a one-time **recovery code** — store it safely; it is the only way back in if you forget the passphrase. From then on the vault's synced **settings** travel encrypted.
2. **Encrypt vault content** (optional). The **Encrypt** button re-uploads every note to the sync server as ciphertext. Your local files stay plain Markdown, so a local vault is never at risk — try it on a throwaway vault first. When the upload has finished, use **Finish migration** to accept only ciphertext from then on.
3. **On another device**, open the same synced vault. Plainva detects that the vault is encrypted and prompts for the passphrase (or the recovery code). After you unlock, the notes are decrypted and appear locally.

The unlocked key is cached on each device. Turn on **Require passphrase at every start** to re-enter it after each restart instead, and use **Lock** to remove the cached key from this device.

**Accounts on all your devices** is three steps. **1 · Settings and accounts**: puts vault settings *and your accounts* (calendars, mailboxes, calendar selection) into a small file in the vault — as long as no passphrase is set up this needs **none**; once there is one, every device has to enter it before settings travel from there. This step is **on by default** — settings and accounts are not secrets; you can switch it off per vault at any time. **2 · Sync passphrase** (optional): only needed if sign-ins should travel too; it additionally encrypts the settings from step 1. **3 · Carry sign-ins**: additionally carries static IMAP and CalDAV passwords, encrypted, and can only be switched on once step 1 runs and the passphrase is unlocked — a password can only travel to an account the device already knows. Not carried: device-specific paths and OAuth sign-ins (Microsoft, Google); their tokens are device-bound, so the account appears on the new device and needs **Sign in** there once.

On the **phone** you find the same chain on the vault page — the same three steps and the same lock. Accounts arriving from another device are created there; you no longer enter them by hand. **Take over from another device now** fetches them at once instead of waiting for the next round.

If Plainva warns that an **older version is still publishing retired account data**, update Plainva on every device that uses this vault. The current device ignores old Google client credentials and keeps its own working sign-in. Do not confirm removal of the old remote data until every participating device has been updated. Plainva offers the button for that in the notice under **Settings → Vault → Synchronisation → Diagnostics**: **Remove retired entries** — the question it asks is exactly that confirmation.

Where that **sign-in** happens depends on the service: a mailbox shows a **Sign in** button on its own row in the **Email** area, a calendar or files account does so in **Cloud accounts**. A Microsoft mailbox always leads to **Cloud accounts**, because its sign-in runs in the browser.

When you set the encryption up **fresh**, step 3 is on from the start — otherwise every further device would sit there without sign-ins for good. For a vault you already use, nothing changes quietly: Plainva asks once and remembers your answer.

If one account shows up as **two cards**, Plainva could not fetch the identity from the provider — and it must not guess. Open either card under **Cloud accounts** and use **Merge** to say it is the same account; Plainva shows what will be carried over before it does anything.

If **Calendar** lists two rows for the same calendar, Plainva reports it and does **not** fold them on its own: folding costs the calendar selection and the link to mirrored tasks. Check which row carries your selection and remove the other one.

An account you remove stays removed: the deletion travels through the settings sync to your other devices instead of coming back from there on the next round.

## What travels, and what stays here

If **Review duplicate accounts** appears under **Cloud accounts**, Plainva deliberately does not guess from the name. Choose **Keep this account** on the correct card. The confirmation names the target, sources and affected services, and creates a backup on this device first. **Cancel** changes nothing. Merging removes only orphaned local accounts, caches and credentials — nothing is deleted at the provider.

<!-- plainva:profile-areas accounts content calendar mail backup sync layout -->

| Travels with the vault | Stays on this device |
| --- | --- |
| Accounts — calendars, mailboxes, cloud accounts, bookmarks | Absolute paths — vault location, backup destination |
| Folders and templates — daily notes, template, inbox and attachments folders, task database | Sign-in tokens for Microsoft and Google |
| Calendar settings — meetings folder, default calendar | Which mailbox and folder you last had open |
| Mail settings — capture folder, remote images | This device's starting arrangement for new vaults |
| Backup rules — snapshot interval, retention, archives | Static passwords — unless step 3 is on |
| Sync interval |  |
| Bar arrangement (desktop) |  |

The phone carries slightly less: the arrangement of the four **desktop** bars stays on the computer — its own navigation bar does travel, and so does the meeting folder. Its own chain on the vault page shows what it carries, and below it both devices state what the sync actually did last — naming the settings that travelled, and on a receive the ones that changed. The message "Settings adopted from another device" appears at most once per session and only when something really changed — after that it stands in these lines. New in this revision, the phone also adopts the daily-note file format, the OKF type of new notes and your bookmarks — before, a vault with a different date format got a second daily note for the same day as soon as the phone touched it.

Diagnostics now separate **last checked** (local profile fields), **last downloaded**, **last applied** and **last actually sent**. “Sent” changes only after a successful cloud write; unchanged rounds therefore update the check and download, but not the sent time. Secret results appear separately as counts for imported, unchanged, rejected, stale, failed or waiting for an account. They contain only stable reason codes — no account id, password, token or raw error. A legacy-client notice means Plainva should be updated on every participating device; this device ignores the retired Google client data.

**Deletions travel.** A deletion you confirmed stays in a journal (`.plainva/sync/deletions.json`) for 90 days and is mirrored on every other device without a question — after a restart too, and even when many files are missing there at once. When many files are missing in the cloud without the journal explaining them, Plainva pauses the mirroring and asks: **apply the deletions** or **keep them locally** (then it uploads the files again as new). The same goes for task lists: a deletion carried out at the provider also removes the task note on the other device, as long as it is unchanged there. Before it asks — and before it removes a single file here — Plainva checks with the cloud directly: it asks for a sample of the missing files one by one. If even one of them is there, the cloud's list was incomplete: nothing is deleted, nobody is asked, and the sync status shows **The cloud answered incompletely — nothing was deleted** with **Check again**. A journal entry is written only after a file was found gone and removed here, and an entry whose file turns up in the cloud again is taken back; **Check deletion log** under **About & diagnostics** does that on request. If the cloud folder of a vault that has synced before cannot be found, Plainva no longer creates an empty replacement but reports it — you then choose the existing folder.

## Errors and automatic retries

The sync error dialog preserves the exact failed attempt even when an automatic retry has already changed the live status. It shows when a retry is running or has recovered successfully. Reconnecting is recommended only for authentication errors; network, timeout, and provider failures retain their concrete cause and are retried automatically. The settings sync waits out temporary failures too: a timeout first appears as a quiet note with a counter and only turns into a red message after the third failure in a row — an expired sign-in, by contrast, straight away.

## Names that differ only in spelling

Google Drive matches names case-insensitively when it searches, and Windows and macOS store `Note.md` and `note.md` in the same file. The same character can also be stored two ways: `ü` as one character, or as `u` with a trailing diaeresis. For that **spelling** Plainva now means the same file and keeps syncing normally, as long as there is only one match.

When two names differ in **capitalization**, however, they are two files. Plainva then changes and deletes nothing and shows the card **Two spellings, one file** with both names — on mobile on the vault page, on the desktop in the sync settings. Every other file keeps syncing. Rename one of the two notes and the card disappears by itself.

The new sign-in does not cover every service. Your existing sign-ins were kept. Sign in again and allow every listed service. The account binding changed. Open the current account settings and sign in again.

## Google Drive: incomplete downloads

When Google Drive temporarily limits requests, Plainva retries the download with a delay. A failed download is not treated as a missing file or a completed change. Existing local content and the confirmed sync state are kept; the next cycle retries the outstanding change. Other files that downloaded successfully remain available. Missing permissions or other permanent refusals appear as errors with the file path and cause. This applies on desktop and mobile.

## Interrupted file transfers

Timeouts also cover receiving file contents from WebDAV, Dropbox, OneDrive, S3 and Google Drive. When a streamed response stops delivering data, Plainva ends that attempt and retries reads a limited number of times with a new request. Progress keeps a streamed download active even when the whole file takes longer than the base timeout. Native mobile requests also have their own time limits. An incomplete download never replaces the existing local file or confirms its sync progress. Large uploads retain their size-based time budget; an unclear upload result is left to the normal sync recovery rather than blindly sent again.

<!-- accounts-tasks-2026-09-11 -->
## Extend existing accounts

Add files, calendar or email directly to the account that should carry them. For Google and Microsoft that is one consent for everything the account carries plus the new service.

Open **Cloud accounts**, choose the existing account and switch the missing service on (on the phone: **Add**). Existing services remain connected, and a service that fails does not stop the others. Gmail joins the Google sign-in when the sign-in on this device allows mail; otherwise Plainva asks for an app password at the same account. Cancelling the assistant does not disconnect completed services. A mobile file transfer keeps the source vault; it considers an existing matching destination vault or prepares a separate container. Colliding files are reviewed individually and both contents are kept. Encrypted destinations are opened through the existing pairing flow.

When adding files on mobile, Plainva shows the source, destination and collisions before transfer. Existing contents and services are preserved; an interrupted transfer can be retried.

<!-- http-platform-trust-2026-09-14 -->
## Certificates for self-hosted servers

Android also trusts certificate authorities you install in the system settings. This applies to all Plainva connections that use Android’s platform configuration, not just one WebDAV server. Desktop HTTP connections include system certificate authorities alongside public roots; iOS uses its system trust settings. Certificate validity and the server hostname are still checked. An expired, not-yet-valid or wrong-host certificate must be corrected on the server or in the configured address. Plainva never offers an option to accept every certificate. If the operating system does not identify the exact trust failure, Plainva reports that verification failed without guessing its cause. Native mobile HTTP failures appear in the diagnostic export as a method and error code, without credentials, certificate subjects or private server paths.

<!-- workspace-retry-2026-09-14 -->
## Automatic retries and missing sync history

The connection is temporarily unavailable. Plainva will try again automatically; pending changes stay on this device.

Sign in to the sync account again. Pending changes stay on this device until access is restored.

Plainva cannot verify the encrypted workspace. Synchronization is paused; local data and pending changes are preserved. Open Security & Sharing, restore a verified copy if available, then check again.

On a device that still holds the complete verified history, choose Sync now. Plainva can restore missing signed operations from that copy. Then check again on Plainva. If no valid copy exists, keep or export the local data; verification is never reset to bypass the gap.

Unencrypted remark files from other devices remain on the server. Only their originating device can finish the conversion. Plainva does not delete another device's files.

<!-- account-grants-destination-2026-09-14 -->
A sign-in is adopted only after verifying identity, the permissions actually granted, and secure storage. Adding a service signs the account in once for all its services; if none of them is allowed, the working sign-ins stay as they were. Another device needs its own sign-in.

In Sync settings, the Google Drive picker shows the current destination and a preview of the selected folder. Open folders with the same name and compare their files and modification dates. “Use this destination” stores the unique folder ID. If that folder later becomes unavailable, Plainva reports the error and creates no replacement. Other folders are not moved or deleted.
