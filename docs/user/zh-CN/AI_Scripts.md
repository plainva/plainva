# 脚本（测试版）

更新日期：2026-10-08

脚本是一个小程序，用来完成模型不擅长、而程序每次都能做得一模一样的事：计数、排序、比较、求和。你用JavaScript来编写它。它在Plainva内部的一个封闭沙盒中运行：不能打开文件，不能访问网络，也不能等到以后再执行。它只会调用你为它勾选的工具：这些工具要么像AI的工具那样读取你的仓库，要么留下一条由你决定是否采纳的建议。脚本不会自行更改任何内容。

## 运行脚本

你的脚本位于AI标签页的**技能**下——在手机上位于**对话 → 技能**下——在**脚本**分组中。**运行**会打开脚本：填写它要求的内容，然后点击**运行**。运行期间，你会看到它调用的每个工具，**停止**可以结束它。运行结束后，对话框会显示**调用**、**结果**（可以复制）和**日志**，以及本次运行对各项限制的使用情况。

你在这里启动的运行只留在此设备上：其中没有任何内容会发送给模型，所以它也能读取你排除在云端之外的笔记。**试运行**只调用读取类工具，对会在应用中显示内容或留下建议的调用，则只做记录。

## 在对话中

在普通对话中，AI可以查找你已启用的脚本，并在合适时运行其中一个；此时步骤显示为**正在运行脚本“word-count”**。脚本只能读取这次对话允许读取的内容：你排除在云端之外的笔记仍然不会发往云端，脚本读取的每一条笔记也都计入本次运行读取过的内容。它返回的内容会作为数据交给模型，绝不会被当作指令。以技能启动的对话，以及通过MCP服务器连接的AI应用，都不会获得脚本。

## 提出修改建议

脚本还可以获得会提出建议的工具。显示为**正在为笔记提出修改建议**和**正在建议属性值**的工具会在笔记的页边留下建议；显示为**正在起草笔记**、**正在起草数据库条目**、**正在起草任务**和**正在起草日志条目**的工具会留下草稿。建议和草稿都以脚本的名称署名，在你采纳建议或创建草稿之前，仓库不会有任何改动——与AI的建议完全一样。运行结束后，对话框会把它们列在**建议和草稿**下；用**试运行**启动的运行不会留下任何建议或草稿。

脚本读过什么，决定了它可以写到哪里：以某条你排除在云端之外的笔记为依据的建议或草稿，只会被适用同一规则的位置接收。在对话中，只有这次对话本身可以提出建议时，AI才会获得会提出建议的脚本，而脚本在那里留下的内容署的是这次对话所用模型的名称。

## 编写脚本

**新脚本**会要求填写：

- **名称**——小写字母、数字和连字符；名称同时也是文件夹名。
- **描述**——脚本的用途；你和AI都据此辨认它。
- **工具**——勾选脚本可以调用的工具：读取内容的工具在**读取**下，留下建议或草稿的工具在**建议**下。对脚本来说，只有勾选的工具才存在。
- **输入**——脚本启动时要求提供的内容：一个名称、类型（文本、数字或“是或否”）以及是否必填。
- **限制**——计算秒数、工具调用次数和内存。
- **代码**——程序本身。

**创建并批准**会把脚本写入你仓库中的`.agent/scripts/<name>/`——一个`manifest.json`和一个`main.js`——并在此设备上批准它。**编辑**（在脚本的菜单中）会打开同一个表单；**保存并批准**会替换这些文件。

代码是一个函数的函数体。`input`按名称保存各项输入，`tools.<name>(…)`调用一个工具，需要用await等待它完成，`return`交回结果，`console.log(…)`向日志写入一行：

```js
const found = await tools.search_vault({ query: "#" + input.tag, limit: 25 });
const notes = [];
for (const hit of found.results) {
  const note = await tools.read_note({ path: hit.path });
  if (note.text.includes("#" + input.tag)) notes.push(hit.path);
}
return { tag: input.tag, count: notes.length, notes };
```

所用的语言是ES2020版的JavaScript。这里没有`fetch`，没有计时器，没有`import`，也不能访问文件，而脚本返回的内容必须是可以写成JSON的数据。工具如果拒绝——比如笔记不存在，或者对话无权读取这条笔记——会抛出一个错误，脚本可以捕获它。

## 工具返回的内容

表单中的**工具返回的内容**会打开本页。每个工具接收一个对象，并返回一个对象；`cursor`接收上一次调用的`next`，并接着取得同一份列表的后续内容。

| 工具 | 你传入 | 你得到 |
|---|---|---|
| `search_vault` — **正在搜索仓库** | `query`；可选：`folder`、`limit`（最多25）、`cursor` | `results`：由`{ title, path, snippet }`组成的列表；`next` |
| `read_note` — **正在读取笔记** | `path`；可选：`section`、`maxChars`（200到20,000）、`cursor` | `path`、`text`、`next` |
| `get_outline` — **正在读取大纲** | `path` | `path`；`properties`：名称和值；`sections`：由`{ level, text, section }`组成的列表 |
| `query_base` — **正在读取数据库** | `base`，即`.base`文件的路径；可选：`view`、`limit`（最多50）、`cursor` | `base`、`view`、`views`；`rows`：由`{ title, path, properties }`组成的列表；`next` |
| `get_tasks` — **正在读取任务** | 可选：`range`（`today`、`upcoming`、`overdue`、`inbox`、`all`、`done`）、`limit`（最多50）、`cursor` | `tasks`：由`{ state, title, due, priority, path, note, source }`组成的列表；`next` |
| `get_backlinks` — **正在读取反向链接** | `path`；可选：`limit`（最多50）、`cursor` | `path`；`notes`：由`{ title, path, links, places }`组成的列表；`next` |
| `graph_neighborhood` — **正在追踪链接** | `path`；可选：`depth`（1或2）、`limit`（最多50） | `path`；`notes`：由`{ title, path, fromHere, toHere, via }`组成的列表 |
| `get_recent` — **正在查看最近的笔记** | 可选：`kind`（`opened`或`edited`）、`limit`（最多20） | `kind`；`notes`：由`{ title, path, at }`组成的列表 |
| `get_calendar` — **正在读取日程** | `from`和`to`，格式为`YYYY-MM-DD`；可选：`details`、`limit`（最多100） | `events`：由`{ day, start, end, allDay, title, cancelled, place, with, others, online, event }`组成的列表；`more` |
| `run_command` — **正在操作应用** | `id`，即应用的某个命令，例如`open-note`、`show-in-graph`或`open-calendar`；可选：`args`，其中可含`path`、`section`或`date` | `done`、`command` |
| `propose_edit` — **正在为笔记提出修改建议** | `path`；`edits`（由`{ find, replace }`组成的列表）或`append`；可选：`section`、`note` | `proposed`、`path`、`passages` |
| `set_property` — **正在建议属性值** | `path`、`key`、`value`；可选：`note` | `proposed`、`path`、`property` |
| `create_note` — **正在起草笔记** | `title`、`content`；可选：`folder` | `drafted`、`kind`、`title` |
| `create_entry` — **正在起草数据库条目** | `base`、`title`；可选：`properties`、`content` | `drafted`、`kind`、`title`、`base` |
| `create_task` — **正在起草任务** | `text` | `drafted`、`kind`、`title` |
| `add_journal_entry` — **正在起草日志条目** | `text`；可选：`task` | `drafted`、`kind` |

## 限制

脚本的限制写在它的清单里。表单可以设置其中三项：

| 限制 | 默认值 | 范围 |
|---|---|---|
| **计算秒数** | 5 | 1到30 |
| **工具调用次数** | 20 | 0到50 |
| **内存（MB）** | 32 | 8到128 |

只有脚本自己运算的时间才算数，工具所花的时间不计在内。超出某项限制的脚本会被终止，对话框会说明是哪一项限制，而被终止的脚本不会返回任何内容。一次调用的参数和脚本的结果，各自最大为64 KB。

## 未经你批准，什么都不会运行

新到达或已更改的脚本（通过同步到达，或由其他程序写入）在你**于此设备上**批准之前不会运行。它会显示在**技能**顶部的**等待你的批准**中。**检查并批准**会显示**它可以做什么**、**限制**、**输入**和完整的**代码**，并说明这段代码能否被读作JavaScript；无法被读作JavaScript的代码不会被批准。

点击**批准**后，此设备会为这些文件签名，不多也不少。用于签名的密钥在此设备上生成，并保存在它的钥匙串中。对任何一个文件的任何更改都会使批准失效，而在你的其他每台设备上，这个脚本都要等待各自的批准——批准无法从一台设备带到另一台设备。**撤回批准**（在脚本的菜单中）会收回批准，**查看代码**则会再次显示检查界面。

## 测试版的限制

脚本会提出建议并留下草稿；它从不重命名、移动或删除笔记，也不会起草邮件或日程。技能不能启动脚本，技能自带的`scripts/`文件夹也不会运行。邮件、互联网和外部服务器的工具，脚本都无法使用。
