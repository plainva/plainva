# OneDrive & Dropboxの設定（自前のアプリ登録）

最終更新: 2026-07-11

**通常、このページは必要ありません:** PlainvaはOneDriveとDropboxの独自のアプリIDをあらかじめ用意しています——プロバイダーを選び、**接続**をクリックしてサインインするだけです。このガイドは、**任意**で自分の（無料の）アプリ登録を使いたい場合（例: 社内の制限がある場合など）のためのものです。同期の設定で**独自のアプリ ID を使用**からID入力欄を表示し、公開値を1つだけ入力します。

- **OneDrive** → **クライアントID**（形式: `00000000-0000-0000-0000-000000000000`）
- **Dropbox** → **アプリキー**（短い文字列）

どちらの登録も無料で、クレジットカードや有料サブスクリプションは不要です。秘密のパスワード（クライアントシークレット）は**不要**です——上記の値は公開情報であり、安全に保存できます。

このページは、[同期の設定](Sync_Setup.md)にある簡易版の詳細な補足です。

> Plainvaがあらかじめ用意しているIDはすでに入力済みです——以下のパートA/Bは、**自分自身の**登録を行う場合にのみ必要です。

---

## パートA — OneDrive（Microsoft Entra）

**前提条件:** Microsoftアカウント（同期したいOneDriveと同じアカウント）。初回サインイン時にMicrosoftが自動的に無料のディレクトリを作成します——Azureサブスクリプションは不要です。

### 1. ポータルを開く

1. **[entra.microsoft.com](https://entra.microsoft.com)**を開きます（`portal.azure.com`でも動作します）。
2. Microsoftアカウントでサインインします。

### 2. 新しいアプリ登録を作成する

1. メニューの**Identity → Applications → App registrations**、続いて**+ New registration**。
2. **Name:** 自由に選択できます。例: `Plainva`（表示名のみ）。
3. **Supported account types:** **「Accounts in any organizational directory … and personal Microsoft accounts」**を選択します。このオプションのみがPlainvaのサインインエンドポイントに一致します。「this directory only」を選ぶと個人用OneDriveアカウントが失敗します。
4. **Redirect URI** — ここで同時に設定します。
   - Platform: **「Public client/native (mobile & desktop)」**。
   - Value: `http://localhost`（このとおり——ポートなし、末尾のスラッシュなし）。

   > ⚠️ 「Web」や「SPA」は選ばないでください。「Web」はクライアントシークレットを要求し、サインインが失敗します。
5. **Register**。

### 3. クライアントIDをコピーする

アプリの**Overview**で**「Application (client) ID」**をコピーします——これがPlainvaに入力する値です。（「Directory (tenant) ID」は不要です。）

### 4. パブリッククライアントフローを許可する

1. メニューの**Authentication**。
2. 一番下にある**「Allow public client flows」**を**Yes**に設定します。
3. **Save**。

### 5. アクセス許可を設定する

1. メニューの**API permissions → + Add a permission → Microsoft Graph → Delegated permissions**。
2. 両方にチェックを入れます。
   - `Files.ReadWrite`
   - `offline_access`（長期有効なサインイントークンを提供します——**これがないと**Plainvaは接続を拒否します）
3. **Add**。個人アカウントでは管理者の同意は不要です。サインイン時に自分自身で同意します。

### Plainvaに入力する

1. **設定 → 保管庫 → 同期**。
2. **同期プロバイダー**を**OneDrive**に設定します。
3. コピーしたApplication IDを**クライアントID**フィールドに貼り付けます。任意で**OneDriveフォルダー（名前）**を設定します（デフォルト`Plainva`）。
4. **Microsoftに接続** → ブラウザーでサインインし、アクセスを確認します。その後ブラウザーはウィンドウを閉じてよいことを知らせます。

---

## パートB — Dropbox

**前提条件:** Dropboxアカウント。

### 1. アプリコンソールを開く

1. **[dropbox.com/developers/apps](https://www.dropbox.com/developers/apps)**を開き、サインインします。
2. **Create app**をクリックします。

### 2. アプリタイプを選択する

1. **Choose an API:** **Scoped access**。
2. **Type of access:** **Full Dropbox** ——「App folder」ではありません。

   > ⚠️ **Full Dropbox**が必須です。「App folder」は孤立したサブフォルダーしか参照できず、Dropbox内の他の場所にある既存の保管庫を見つけられません。
3. **Name:** 世界的に一意な名前。例: `Plainva-Sync-<あなたの名前>`（技術的な用途のみで、他人には見えません）。
4. **Create app**。

### 3. リダイレクトURIを登録する

タブ**Settings → OAuth 2 → Redirect URIs**: **正確に**`http://127.0.0.1:41953`を入力し、**Add**をクリックします。

> ⚠️ 一文字も違わずに一致させる必要があります: `127.0.0.1`（`localhost`ではありません）、ポート`41953`、末尾のスラッシュなし。Plainvaはこの正確なポートをバインドします。少しでも異なるとサインインが中断されます。

### 4. アクセス許可を設定する

タブ**Permissions** —— 以下にチェックを入れ、一番下の**Submit**をクリックします。

- `files.metadata.read`
- `files.content.read`
- `files.content.write`

> ⚠️ 後でアクセス許可を変更した場合は、Plainvaで**再接続**する必要があります。そうしないと古い権限が引き続き適用されます。

### 5. アプリキーをコピーする

タブ**Settings**: **App key**の値をコピーします——これがPlainvaに入力する値です。（「App secret」は不要です。）

> あなたのアプリは「Development」ステータスのままです。個人利用にはそれで十分です。「Apply for production」は、多くの他のユーザーが同じApp keyを使用する場合にのみ必要です。

### Plainvaに入力する

1. **設定 → 保管庫 → 同期**。
2. **同期プロバイダー**を**Dropbox**に設定します。
3. コピーしたApp keyを**アプリキー**フィールドに貼り付けます。任意で**Dropboxフォルダー（パス）**を設定します（デフォルト`/Plainva`）。
4. **Dropboxに接続** → ブラウザーでサインインし、アクセスを確認します。

---

## うまくいかない場合

| 症状 | 原因 | 対処法 |
|---|---|---|
| OneDrive: 「Microsoft returned no refresh_token」 | `offline_access`が不足している | 手順A5: `offline_access`を追加し、**再接続** |
| OneDrive: ログインがシークレットを要求する／失敗する | プラットフォームが「Mobile and desktop」ではなく「Web」になっている | 手順A2: プラットフォームを**Public client/native**に、リダイレクトを`http://localhost`に |
| OneDrive: 個人アカウントが拒否される | アカウントタイプが間違っている | 手順A2: 「… and personal Microsoft accounts」を選択 |
| Dropbox: サインインが止まる／「redirect_uri mismatch」 | リダイレクトが正確でない | 手順B3: 正確に`http://127.0.0.1:41953` |
| Dropbox: 「Port 41953 is in use」 | 別のプログラムがポートをブロックしている | ブロックしているアプリケーションを終了し、再試行 |
| Dropbox: 保管庫が見つからない／権限が不足している | 「Full Dropbox」ではなく「App folder」になっている、またはアクセス許可が**Submit**されていない | 手順B2 / B4を確認し、**再接続** |

## 関連ページ

- [同期の設定](Sync_Setup.md) —— 簡易版とその他のプロバイダー
- [同期の互換性](Sync_Compatibility.md) —— どのサービスがどのように機能するか
- [FAQ・トラブルシューティング](FAQ.md)
