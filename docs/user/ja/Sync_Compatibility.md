# Plainva 同期の互換性

最終更新: 2026-07-04（OneDrive、Dropbox、S3の統合後に更新）

Plainvaは、交換可能な同期アダプターを通じて保管庫を同期します。このページでは、今日利用できるサービスを示します——直接統合されているもの、WebDAVプロトコル経由のもの、またはプロバイダー自身のデスクトップ同期クライアント経由のものです。

## 直接統合されているもの

| プロバイダー | 状態 | 備考 |
|---|---|---|
| ローカルフォルダー | 利用可能 | 設定不要です。外部からの変更（例: 他の同期ツールによるもの）は自動的に検出されます。 |
| WebDAV / Nextcloud | 利用可能、Nextcloudで検証済み | サーバーURL、ユーザー名、（推奨）アプリパスワードです。 |
| Google Drive | 利用可能（BYO認証情報） | 自前のGoogle Cloudプロジェクトが必要です。[Google Drive BYOガイド](Google_Drive_BYO_Guide.md)を参照してください。 |
| OneDrive | 利用可能（2026-07-04に新規追加、ネイティブ検証は保留中） | ブラウザー経由のログイン（PKCE、シークレット不要）。Plainvaが独自のアプリ登録を提供するまでは、自前の（無料の）Entraアプリ登録が必要です: タイプ「モバイルおよびデスクトップアプリケーション」、リダイレクトURI`http://localhost`。 |
| Dropbox | 利用可能（2026-07-04に新規追加、ネイティブ検証は保留中） | ブラウザー経由のログイン（PKCE、シークレット不要）。Plainvaが独自のアプリを提供するまでは、自前の（無料の）Dropboxアプリが必要です: Full-Dropboxアクセス、リダイレクトURIは正確に`http://127.0.0.1:41953`。 |
| S3互換オブジェクトストレージ | 利用可能（2026-07-04に新規追加、ネイティブ検証は保留中） | AWS S3、Cloudflare R2、Backblaze B2、MinIO、Wasabi、Hetznerなど——エンドポイント、バケット、リージョン、APIキーペアだけで済みます。ブラウザーログインは不要です。 |

## WebDAV経由で利用できるサービス

WebDAVアダプターは標準的なWebDAVを話すため、以下のようなサービスも動作するはずです。まだ個別に検証されていません——フィードバックを歓迎します。アドレスは典型的なパターンです。念のためプロバイダーのドキュメントで確認し、可能な限りメインのパスワードの代わりにアプリパスワードを使用してください。

| サービス | 典型的なWebDAVアドレス |
|---|---|
| Nextcloud（自前ホストまたはプロバイダー利用） | `https://<server>/remote.php/dav/files/<user>/` |
| ownCloud | `https://<server>/remote.php/dav/files/<user>/` |
| Koofr | `https://app.koofr.net/dav/Koofr` |
| Strato HiDrive | `https://webdav.hidrive.strato.com` |
| MagentaCLOUD（Telekom） | `https://magentacloud.de/remote.php/dav/files/<user>/` |
| GMX Mediacenter | `https://webdav.mc.gmx.net` |
| WEB.DEオンラインストレージ | `https://webdav.smartdrive.web.de` |
| Hetzner Storage Box | `https://<user>.your-storagebox.de` |
| Synology NAS | WebDAV Serverパッケージを有効化してから`https://<nas>:5006` |
| QNAP NAS | システムでWebDAVを有効化。アドレスはQNAPのドキュメント参照 |
| Seafile | SeafDAVを有効化してから`https://<server>/seafdav` |

## プロバイダーのデスクトップ同期クライアント経由（ローカルフォルダー）

ネイティブ統合が実現するまでは、ローカルフォルダーを同期状態に保つデスクトップクライアントを持つあらゆるサービスを利用できます。Plainvaは保管庫をローカルフォルダーとして扱い、外部からの変更を自動的に検出します。

**重要:** 保管庫フォルダーを「常にこのデバイスに保持する」/「オフラインで利用可能」に設定してください。オンライン専用のプレースホルダーファイル（Files On-Demand、online-only、ストリーミングモード）は、インデックス作成や同期を妨げる可能性があります。

- **OneDrive**（エクスプローラー統合。保管庫フォルダーではFiles On-Demandを無効化）
- **Dropbox**（デスクトップクライアント。保管庫フォルダーでは「online-only」を避ける）
- **Google Drive for Desktop**（保管庫フォルダーは「ストリーム」ではなく「ミラー」モード）
- **iCloud Drive**（Windows版またはmacOS版のiCloud。フォルダーを「ダウンロード済みを保持」に設定）
- **Syncthing / Resilio Sync**（P2P方式で、クラウドプロバイダーは一切不要）

## 新しい統合に関する注記（2026-07-04）

OneDrive、Dropbox、S3互換ストレージは、2026-07-04より直接統合されています（上記の表を参照）——マスタープランの段階計画（§13.3）よりも前倒しでの実現です。PlainvaがOneDriveとDropboxの中央アプリ登録を提供するようになると、自前のクライアントIDやアプリキーを用意する手順は不要になります。フィールドは事前に入力されるようになります。デスクトップ同期クライアント経由の方法（上記参照）は、代替手段として引き続き利用できます。

## 意図的に計画していないもの

- **iCloudのAPI統合:** AppleはiCloud Driveに対して公式なサードパーティAPIを提供していません。代わりにローカルのiCloudフォルダーを使用してください（上記参照）。
- **Proton Drive / Mega:** 公式なAPI、または統合が困難なAPIしかありません（E2E暗号化、C++ SDK）。引き続き注視します。
- **ウォッチリスト**（要望に応じて）: pCloud、Box、Filen、SFTP。
