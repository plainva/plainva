# 配置Google Drive同步（自备凭据）

更新日期：2026-07-28

要在Plainva中把本地仓库与你的Google Drive同步，你可以使用自己的Google API凭据。由于Plainva尚未通过Google的中心化CASA验证，这种**自备凭据（BYO）**方式为同步你的私人文件提供了一种安全的途径。

你实际上是在Google那边为自己搭建了一个只属于你自己、也只有你能访问的小型"开发者项目"。

## 分步指南

### 1. 在Google Cloud Console中创建一个项目
1. 前往[Google Cloud Console](https://console.cloud.google.com/)。
2. 使用你的Google账户登录。
3. 在左上角（Google Cloud标志旁边），打开项目下拉菜单，选择**新建项目**。
4. 输入一个名称（例如"Plainva Sync"），然后点击**创建**。

### 2. 启用Google Drive API
1. 在顶部的下拉菜单中选择你刚创建的项目。
2. 在顶部搜索栏中搜索**Google Drive API**，并在"Marketplace"下选择该条目。
3. 点击**启用**。

### 3. 配置OAuth同意屏幕
为了让Plainva使用你的凭据，需要设置一个同意屏幕（"OAuth Consent Screen"）。由于只有你自己使用这个应用，它可以一直保持在"测试"模式。

1. 在左侧菜单的**APIs & Services**下，打开**OAuth consent screen**。
2. 在"User Type"下选择**External**（外部，除非你使用Google Workspace），然后点击**创建**。
3. **应用信息：**
   - 应用名称：例如"Plainva"
   - 用户支持电子邮件：你自己的邮箱
   - 开发者联系信息：你自己的邮箱
   - 点击**保存并继续**。
4. **权限范围（Scopes）：**
   - 点击**添加或移除范围**。
   - 搜索`.../auth/drive`（Google Drive API，完全访问权限）并勾选。
   - *背景说明：需要完全访问权限，这样Plainva才能同步你通过Google Drive网页界面直接放入同步文件夹的文件。*
   - 点击更新，然后**保存并继续**。
5. **测试用户：**
   - 点击**添加用户**。
   - 准确输入你之后将在Plainva中用于同步的那个Google邮箱地址。
   - 点击**保存并继续**，然后返回控制台首页。

*重要提示：你**不需要**发布这个应用——保持在"测试中"状态，它就能完全正常工作。但请注意：在这种模式下，Google 会让登录在**7天**后过期，而且是永久性的——因为该模式下刷新令牌也会一并失效，Plainva 在后台便无法为你续期。Plainva 会用明确的文字告诉你（"登录已过期"），在账户详情中点击**重新登录**，就能一次性恢复该账户的所有服务。*

**已发布**状态会取消测试模式的固定有效期，但不保证永久登录：Google仍可能使访问权限过期或撤销访问权限。发布和验证要求取决于用途及所请求的权限。[Google：刷新令牌过期](https://developers.google.com/identity/protocols/oauth2#expiration)。

### 4. 创建凭据（客户端ID和密钥）
1. 在左侧菜单中打开**凭据**。
2. 点击顶部的**创建凭据**，选择**OAuth客户端ID**。
3. "应用类型"选择**桌面应用**（或"其他UI"）。
4. 名称：例如"Plainva Desktop Client"。
5. 点击**创建**。
6. 弹出窗口会显示你的**客户端ID**和**客户端密钥**。

### 5. 在Plainva中填入
1. 打开Plainva，进入相应仓库的设置（该仓库的齿轮图标）。
2. 打开**同步**分区。
3. 选择**Google Drive**作为服务商。
4. 把复制好的**客户端ID**和**客户端密钥**粘贴到对应的字段中。
5. 点击**连接Google**。
6. 会打开一个Google浏览器窗口。使用你在"测试用户"中添加的账户登录。
7. Google可能会提示该应用未经验证。点击**高级**，然后点击**继续前往Plainva（不安全）**。
8. 确认所请求的权限。

现在，你的仓库已经通过你自己的凭据安全地与Google Drive同步了。

<!-- accounts-tasks-2026-09-11 -->
## Google OAuth — Desktop / Android / iOS

以上桌面客户端步骤适用于桌面应用。移动端需要与设备匹配的注册：**iOS** 客户端使用 bundle ID `com.plainva.app`；**Android** 客户端使用包名 `com.plainva.app` 和已安装版本的 SHA-1 签名证书。移动客户端通常不需要客户端密钥。Plainva 的浏览器返回地址为 `com.plainva.app:/oauth2redirect`。Google 默认禁止新的 Android 客户端使用此返回方式。Google 文档说明的例外是在 Android 客户端的高级设置中明确启用自定义 URI；如果你的客户端没有此选项，就无法使用当前的浏览器流程。桌面客户端 ID 不能替代它。日历还需要启用 **Google Calendar API** 和 **Google Tasks API**。缺少权限时必须重新授权，仅有可用的 Drive 登录并不足够。

[Google: OAuth 2.0](https://developers.google.com/identity/protocols/oauth2/native-app) · [Google: Android Custom URI](https://developers.googleblog.com/improving-user-safety-in-oauth-flows-through-new-oauth-custom-uri-scheme-restrictions/)

直接为相应账户添加文件、日历或邮箱。Plainva 会检查所选登录并请求缺少的权限。

Google 注册配置与此设备的返回路径不匹配。请在 Google 指南中检查客户端类型和移动端设置。
