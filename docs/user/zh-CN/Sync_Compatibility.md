# Plainva同步兼容性

更新日期：2026-07-08（OneDrive和Dropbox现已内置中心化应用ID——无需自备凭据）

Plainva通过可互换的同步适配器来同步仓库。本页展示今天你可以使用哪些服务——直接集成、通过WebDAV协议，或通过服务商自己的桌面同步客户端。

## 直接集成

| 服务商 | 状态 | 说明 |
|---|---|---|
| 本地文件夹 | 可用 | 无需任何设置；外部更改（例如由其他同步工具产生的）会被自动检测到。 |
| WebDAV / Nextcloud | 可用，已通过Nextcloud验证 | 服务器URL、用户名，以及（推荐）一个应用密码。 |
| Google Drive | 可用（自备凭据） | 需要你自己的Google Cloud项目，参见[Google Drive BYO指南](Google_Drive_BYO_Guide.md)。 |
| OneDrive | 可用 | 通过浏览器登录（PKCE，无需密钥）。Plainva已内置自己的应用注册——只需选择OneDrive并连接即可，无需任何设置。使用你自己的（免费）Entra应用注册仍然是可选项（参见[OneDrive与Dropbox（BYO）指南](OneDrive_and_Dropbox_BYO_Guide.md)）。 |
| Dropbox | 可用 | 通过浏览器登录（PKCE，无需密钥）。Plainva已内置自己的Dropbox应用——只需选择Dropbox并连接即可，无需任何设置。使用你自己的（免费）Dropbox应用仍然是可选项（参见[OneDrive与Dropbox（BYO）指南](OneDrive_and_Dropbox_BYO_Guide.md)）。 |
| S3兼容对象存储 | 可用（2026-07-04新增，原生验证尚待进行） | AWS S3、Cloudflare R2、Backblaze B2、MinIO、Wasabi、Hetzner等等——只需要一个endpoint、存储桶、区域和一对API密钥；无需浏览器登录。 |

## 可通过WebDAV使用的服务

WebDAV适配器支持标准WebDAV协议，因此以下服务理论上应该都可以正常使用。它们尚未逐一验证过——欢迎反馈。以下地址是典型的模式，请在服务商的官方文档中再次确认，并尽量使用应用密码而不是主密码。

| 服务 | 典型WebDAV地址 |
|---|---|
| Nextcloud（自建或托管） | `https://<server>/remote.php/dav/files/<user>/` |
| ownCloud | `https://<server>/remote.php/dav/files/<user>/` |
| Koofr | `https://app.koofr.net/dav/Koofr` |
| Strato HiDrive | `https://webdav.hidrive.strato.com` |
| MagentaCLOUD（德国电信） | `https://magentacloud.de/remote.php/dav/files/<user>/` |
| GMX Mediacenter | `https://webdav.mc.gmx.net` |
| WEB.DE online storage | `https://webdav.smartdrive.web.de` |
| Hetzner Storage Box | `https://<user>.your-storagebox.de` |
| Synology NAS | 启用WebDAV Server套件，然后使用`https://<nas>:5006` |
| QNAP NAS | 在系统中启用WebDAV；地址参见QNAP文档 |
| Seafile | 启用SeafDAV，然后使用`https://<server>/seafdav` |

## 通过服务商的桌面同步客户端（本地文件夹）

在原生集成到来之前，你可以使用任何桌面客户端能够保持本地文件夹同步的服务。此时Plainva会把该仓库当作一个本地文件夹处理，并自动检测外部更改。

**重要提示：** 请把仓库文件夹设置为"始终保留在此设备上" / "可离线使用"。仅在线的占位文件（按需下载、online-only、流式模式）可能会干扰索引和同步。

- **OneDrive**（资源管理器集成；请为仓库文件夹关闭按需下载）
- **Dropbox**（桌面客户端；请为仓库文件夹避免使用"仅在线"）
- **Google Drive桌面版**（为仓库文件夹使用"镜像"模式而不是"流式"模式）
- **iCloud Drive**（Windows版或macOS版iCloud；把该文件夹设置为"保留已下载的内容"）
- **Syncthing / Resilio Sync**（点对点方式，完全不涉及任何云服务商）

## 关于新集成的说明（2026-07-04）

OneDrive、Dropbox和S3兼容存储自2026-07-04起已直接集成（见上表）——比总体规划（§13.3）中原定的阶段安排更早。Plainva为OneDrive和Dropbox内置了自己的应用注册——因此你不需要自己的客户端ID或App Key；这些字段已经预先填好，你只需连接即可。自备应用ID仍然是可选项（例如出于企业限制的需要）；参见[OneDrive与Dropbox（BYO）指南](OneDrive_and_Dropbox_BYO_Guide.md)。桌面同步客户端方式（见上文）仍将作为一种替代选项保留。

## 刻意未规划

- **作为API集成的iCloud：** 苹果没有为iCloud Drive提供官方的第三方API。请改用本地iCloud文件夹（见上文）。
- **Proton Drive / Mega：** 没有官方API，或者只有难以集成的API（端到端加密、C++ SDK）。持续观察中。
- **观察清单**（按需评估）：pCloud、Box、Filen、SFTP。
