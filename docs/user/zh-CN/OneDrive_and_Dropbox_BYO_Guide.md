# 设置OneDrive与Dropbox（自备App注册）

更新日期：2026-07-06

**通常你不需要这个页面：** Plainva自带了OneDrive和Dropbox的应用ID——你只需选择服务商，点击**连接**并登录即可。本指南仅适用于**可选**情形：如果你想使用自己的（免费）App注册（例如遇到公司限制时）。在同步设置中，你可以通过**使用你自己的应用 ID**展开ID字段，然后填入唯一一个公开值：

- **OneDrive** → 一个**客户端ID**（格式为`00000000-0000-0000-0000-000000000000`）
- **Dropbox** → 一个**App Key**（一段较短的字符串）

两种注册都是免费的，不需要信用卡，也不需要付费订阅。你**不**需要一个保密密码（Client Secret）——上述数值都是公开的，可以放心保存。

本页是[设置同步](Sync_Setup.md)中简短版本的详细补充说明。

> Plainva自带的ID已经预先填好——只有当你想使用**自己的**注册时，才需要下面的第A/B部分。

---

## 第A部分 — OneDrive（Microsoft Entra）

**前提条件：** 一个Microsoft账户（即你想要同步其OneDrive的那个账户）。首次登录时，Microsoft会自动为你创建一个免费目录——不需要Azure订阅。

### 1. 打开门户

1. 前往**[entra.microsoft.com](https://entra.microsoft.com)**（`portal.azure.com`同样可用）。
2. 使用你的Microsoft账户登录。

### 2. 创建新的App注册

1. 菜单**身份 → 应用程序 → 应用注册**，然后**+新注册**。
2. **名称：** 可自由选择，例如`Plainva`（仅作显示用）。
3. **支持的账户类型：** 选择**"任何组织目录中的账户……以及个人Microsoft账户"**。只有这个选项能匹配Plainva的登录端点；"仅此目录"会导致个人OneDrive账户无法使用。
4. **重定向URI**——就在这一步一并设置：
   - 平台：**"公共客户端/本机（移动和桌面）"**。
   - 值：`http://localhost`（必须完全一致——不带端口，末尾不带斜杠）。

   > ⚠️ 不要选择"Web"或"SPA"。"Web"需要Client Secret，登录将会失败。
5. **注册**。

### 3. 复制客户端ID

在应用的**概述**页面，复制**"应用程序（客户端）ID"**——这就是你要填入Plainva的值。（你不需要"目录（租户）ID"。）

### 4. 允许公共客户端流程

1. 菜单**身份验证**。
2. 在最下方，把**"允许公共客户端流程"**设为**是**。
3. **保存**。

### 5. 设置权限

1. 菜单**API权限 → +添加权限 → Microsoft Graph → 委派的权限**。
2. 勾选以下两项：
   - `Files.ReadWrite`
   - `offline_access`（提供长期有效的登录令牌——**没有它**Plainva会拒绝连接）
3. **添加**。个人账户不需要管理员同意；你会在登录时自行同意。

### 在Plainva中填入

1. **设置 → 仓库设置 → 云同步**。
2. 把**同步服务商**设为**OneDrive**。
3. 把复制的应用程序ID粘贴到**客户端ID**字段；可选择设置**OneDrive文件夹（名称）**（默认为`Plainva`）。
4. **连接Microsoft** → 在浏览器中登录并确认访问权限。之后浏览器会提示你可以关闭该窗口。

---

## 第B部分 — Dropbox

**前提条件：** 一个Dropbox账户。

### 1. 打开App控制台

1. 前往**[dropbox.com/developers/apps](https://www.dropbox.com/developers/apps)**并登录。
2. 点击**Create app**。

### 2. 选择App类型

1. **Choose an API：** **Scoped access**。
2. **Type of access：** **Full Dropbox**——不是"App folder"。

   > ⚠️ **Full Dropbox**是必需的："App folder"只能看到一个隔离的子文件夹，找不到你Dropbox其他位置已有的仓库。
3. **Name：** 一个全局唯一的名称，例如`Plainva-Sync-<你的名字>`（纯技术用途，其他人看不到）。
4. **Create app**。

### 3. 注册重定向URI

标签页**Settings → OAuth 2 → Redirect URIs**：**精确**填入`http://127.0.0.1:41953`并点击**Add**。

> ⚠️ 必须逐字符一致：`127.0.0.1`（不是`localhost`）、端口`41953`、末尾不带斜杠。Plainva会绑定这个精确的端口；任何偏差都会导致登录中止。

### 4. 设置权限

标签页**Permissions**——勾选以下各项，并点击底部的**Submit**：

- `files.metadata.read`
- `files.content.read`
- `files.content.write`

> ⚠️ 如果你之后更改了权限，必须在Plainva中**重新连接**，否则旧的权限仍然有效。

### 5. 复制App key

标签页**Settings**：复制**App key**的值——这就是你要填入Plainva的值。（你不需要"App secret"。）

> 你的App会保持在"Development"状态。这对私人使用已经足够；只有当许多其他用户要使用同一个App key时，才需要"Apply for production"。

### 在Plainva中填入

1. **设置 → 仓库设置 → 云同步**。
2. 把**同步服务商**设为**Dropbox**。
3. 把复制的App key粘贴到**App Key**字段；可选择设置**Dropbox文件夹（路径）**（默认为`/Plainva`）。
4. **连接Dropbox** → 在浏览器中登录并确认访问权限。

---

## 如果出现问题

| 症状 | 原因 | 解决方法 |
|---|---|---|
| OneDrive："Microsoft returned no refresh_token" | 缺少`offline_access` | 第A5步：添加`offline_access`，然后**重新连接** |
| OneDrive：登录要求提供Secret／失败 | 平台选成了"Web"而不是"移动和桌面" | 第A2步：平台选**公共客户端/本机**，重定向填`http://localhost` |
| OneDrive：个人账户被拒绝 | 账户类型选错 | 第A2步：选择"……以及个人Microsoft账户" |
| Dropbox：登录卡住／"redirect_uri mismatch" | 重定向地址不精确 | 第B3步：必须精确为`http://127.0.0.1:41953` |
| Dropbox："Port 41953 is in use" | 另一个程序占用了该端口 | 关闭占用端口的应用，再试一次 |
| Dropbox：找不到仓库／权限缺失 | 选成了"App folder"而不是"Full Dropbox"，或权限没有点击**Submit** | 检查第B2／B4步，然后**重新连接** |

## 另请参阅

- [设置同步](Sync_Setup.md) — 简要版本以及其他服务商
- [同步兼容性](Sync_Compatibility.md) — 哪些服务可以使用、如何使用
- [常见问题与故障排查](FAQ.md)
