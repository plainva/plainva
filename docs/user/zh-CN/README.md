# Plainva用户手册

更新日期：2026-07-06

本翻译由机器自动生成，欢迎指正。

Plainva是一款Markdown仓库编辑器：你的笔记就是电脑上某个文件夹（一个"仓库"）里普通的Markdown文件——没有数据库孤岛，也不强制使用云账户。本手册说明如何使用Plainva，以及各种文件格式是如何工作的。

## 目录

| 页面 | 内容概览 |
|---|---|
| [快速上手](Getting_Started.md) | 打开或新建仓库、界面介绍、编辑器模式、标签页与分屏 |
| [笔记与Markdown](Notes_and_Markdown.md) | Markdown文件如何工作：写作、格式化、属性（Frontmatter）、图标、链接、模板、图片 |
| [数据库（.base）](Databases_Base.md) | 把笔记当作数据库查看——视图、筛选、属性、关联、新建条目（类似Notion，但基于文件） |
| [OKF](OKF.md) | Open Knowledge Format：`type`、`okf_version`、index.md管理与可选的仓库转换 |
| [文件格式参考](File_Format_Reference.md) | 仓库中每个文件在磁盘上的精确格式——面向直接编辑笔记和`.base`文件的工具、脚本或AI |
| [自动化与脚本](Automation_and_Scripts.md) | 无需插件即可扩展Plainva：脚本、CLI工具和AI助手如何安全地读写仓库 |
| [Backups与版本历史](Backups_and_Versioning.md) | 自动文件版本、恢复（包括已删除的文件）以及仓库的每日ZIP备份 |
| [移动应用](Mobile_App.md) | Android 和 iOS 上的 Plainva：布局、编辑、数据库、同步与安全网 |
| [设置同步](Sync_Setup.md) | 各服务商的分步指南：WebDAV/Nextcloud、Google Drive、OneDrive、Dropbox、S3 |
| [同步兼容性](Sync_Compatibility.md) | 目前哪些服务可以使用——直接集成、通过WebDAV，或通过服务商自己的桌面客户端 |
| [Google Drive（BYO）](Google_Drive_BYO_Guide.md) | 使用自己的凭据配置Google Drive同步 |
| [OneDrive与Dropbox（BYO）](OneDrive_and_Dropbox_BYO_Guide.md) | 使用自己的App注册配置OneDrive和Dropbox同步 |
| [搜索](Search.md) | 全文搜索、快速切换、查找和替换、标签 |
| [关系图](Graph.md) | 上下文关系图、带有清理模式和时间回放的仓库地图，以及作为数据库视图的关系图 |
| [快捷键](Keyboard_Shortcuts.md) | 所有快捷键一览 |
| [常见问题与故障排查](FAQ.md) | 常见问题：Obsidian兼容性、冲突文件、备份等 |

## 核心原则

- **你的文件属于你。** 仓库就是一个普通的Markdown文件文件夹。你可以随时用任何其他程序打开、复制或备份它。
- **纯Markdown是标准格式。** 就连额外功能（属性、图标、数据库）也以开放、可读的文本格式存储。
- **兼容Obsidian。** 已有的Obsidian仓库不会被破坏或重新格式化；Obsidian可以打开Plainva创建的每一个文件。
