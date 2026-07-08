# 文件格式参考

更新日期：2026-07-07

本页是**Plainva仓库中每一个文件**在磁盘上的精确格式约定。它的写作目的是让一个工具——或者另一个程序、脚本或AI助手——可以直接读取并安全地编辑仓库文件，而不必经过Plainva的用户界面。如果你只使用这款应用本身，永远不需要用到这一页；[其他手册页面](README.md)涵盖了日常使用方法。

这里的一切都是纯粹的UTF-8文本。笔记是带有YAML Frontmatter的Markdown；数据库是YAML。没有任何东西是私有专用格式，也没有任何东西被隐藏。

## 黄金法则（请先读这里）

1. **笔记才是真相来源。`.base`只是一个视图。** 属性的*值*保存在每篇笔记各自的Frontmatter中——绝不在`.base`里。要修改一个值，请编辑笔记本身。
2. **笔记始终保持Obsidian原生格式。** 在笔记的Frontmatter中，只写入普通的标量和列表（字符串、数字、布尔值、ISO日期、YAML列表）。绝不要在笔记中写入嵌套对象，也不要写入"激活/已选中"这类标记。
3. **`.base`只使用Obsidian的四个顶层键**（`filters`、`formulas`、`properties`、`views`）。添加任何其他顶层键都会让Obsidian拒绝整个文件。所有Plainva专有的数据都放在嵌套的`plainva:`子键之下。
4. **保留你不理解的内容。** 未知的键必须原样经受住一次读取/写入的往返过程。不要"清理"你不认识的键。
5. **写入UTF-8无BOM，使用LF换行符。**

## 仓库概览

仓库就是一个普通文件夹。你会遇到的文件类型：

| 文件 | 是什么 | 能否作为文本编辑 |
|---|---|---|
| `*.md` | 一篇笔记：YAML Frontmatter + Markdown正文 | 能 |
| `*.base` | 笔记之上的数据库视图（YAML） | 能 |
| `index.md` | 一个文件夹受管理的目录（保留名称） | 能，但需谨慎——参见[index.md](#indexmd文件夹目录) |
| `log.md` | 保留名称，目前未使用 | 不要碰 |
| 图片、PDF等 | 附件 | 不能（二进制） |
| `.plainva/` | Plainva的内部文件夹（备份、状态） | **不能——永远不要碰** |

保留名称`index.md`和`log.md`永远不是普通笔记；不要在这些名称下创建普通内容。

---

## 笔记（`.md`）

笔记是一个Markdown文件。文件最顶端有一个可选的YAML Frontmatter块（位于两行`---`之间），其中保存着属性；随后是Markdown正文。

```markdown
---
type: Note
okf_version: "0.1"
tags: [project, active]
status: In progress
due: 2026-07-20
plainva:
  icon: "🚀"
  header_color: "#2f6f6f"
---
# My Project

A **bold** thought that links to [[Another Note]].

- [ ] First task
```

### OKF Frontmatter字段

Plainva遵循OKF（Open Knowledge Format），这是一种最小化的约定。两个顶层字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `type` | 字符串 | 这是什么类型的文档（`Note`、`Daily Note`、`Project`……）。这是OKF实际要求的唯一字段。 |
| `okf_version` | 字符串 | 该文件所依据的约定版本，例如`"0.1"`。请加上引号，让YAML把它保留为字符串。 |

一个**没有**`type`的文件依然可以正常打开；它只是"不符合OKF约定"而已。单独缺少`okf_version`并不算违反约定。当你创建一篇新笔记时，添加`type`（以及`okf_version`）是良好的实践。完整的原理说明见[OKF](OKF.md)。

### 属性值的序列化

每个Frontmatter键就是一个属性。请用其类型对应的原生YAML形式来写值：

| 属性类型 | YAML形式 | 示例 |
|---|---|---|
| 文本 | 标量字符串 | `title: Hello` |
| 数字 | 数字 | `priority: 3` |
| 复选框 | 布尔值 | `done: true` |
| 日期 | ISO日期字符串 | `due: 2026-07-20` |
| 日期和时间 | ISO日期时间字符串 | `at: 2026-07-20T14:30:00` |
| 列表 | 字符串的YAML列表 | `authors: [Ada, Alan]` |
| 标签 | 字符串的YAML列表 | `tags: [project, active]` |
| 单选 / 状态 | 单个标量字符串 | `status: Done` |
| 多选 | 字符串的YAML列表 | `labels: [urgent, later]` |
| URL / 邮箱 / 电话 | 标量字符串 | `site: https://example.org` |
| 关联（单个） | Wiki链接**字符串** | `project: "[[Project Alpha]]"` |
| 关联（多个） | Wiki链接字符串的YAML列表 | `related: ["[[A]]", "[[B]]"]` |

单选/状态属性的"激活"值就是这个普通标量本身。*允许选项的集合*及其颜色**不**保存在笔记中——它们保存在管理它的`.base`里（参见[选项与颜色](#选项与颜色)）。这样笔记就能保持100%的Obsidian原生格式。

> 请为Wiki链接的值加上引号（`"[[X]]"`）。不加引号的`[[X]]`在YAML中是一个流序列（flow sequence），不会按你的本意解析。

### 笔记中的`plainva:`命名空间

纯展示用的附加内容被统一归入一个单独的`plainva:`键之下，好让其他编辑器可以忽略它们：

| 键 | 值 | 含义 |
|---|---|---|
| `icon` | emoji字符，或`lucide:<kebab命名>` | 文档图标（Notion风格） |
| `icon_color` | 十六进制颜色（`#rgb` / `#rrggbb` / `#rrggbbaa`） | `lucide:`图标的着色（emoji会忽略它） |
| `header_color` | 十六进制颜色 | 全宽页眉色带 |

这三者都是可选的。如果一个都不写，就完全省略`plainva:`这个键。无效的值在读取时会被忽略，绝不会被当作错误。

### 链接

- **Wiki链接：** `[[笔记名称]]`——在整个仓库范围内按笔记名称解析。带标题锚点：`[[笔记#章节]]`。带显示文本：`[[笔记|显示的文字]]`。
- **Markdown链接：** `[文字](相对/路径.md)`同样可用。
- **反向链接**是自动生成的，也包括来自Frontmatter中Wiki链接的反向链接（这正是关联会以反向链接形式出现的原因）。

---

## 数据库（`.base`）

`.base`文件是YAML格式。它存储的是笔记之上的一个*视图*——哪些笔记（来源）、如何展示它们（视图）、如何筛选和排序，以及列的模式（schema）。它**不存储任何笔记的值**。该格式与Obsidian的Bases插件兼容。

### 硬性规则——违反其中任何一条，Obsidian就会拒绝整个文件

- **只允许这些顶层键：** `filters`、`formulas`、`properties`、`views`。永远不要添加其他顶层键。（历史上，一个顶层的`columns:`键曾破坏过每一个文件——不要重新引入这种模式。）
- **每个视图都需要一个非空字符串的`name`。**
- **一个`filters`对象在每一层只能携带`and` / `or` / `not`中的恰好一个**——不能两个并列。

Plainva本身会在下次保存时自动修复违反后两条规则的旧文件，但直接写入文件的工具必须一开始就把它们写对。

### 属性标识符：何时使用`note.`前缀

这是最常见的绊脚石，因此明确说明：

| 位置 | 形式 | 示例 |
|---|---|---|
| `properties:`映射的键 | 带前缀 | `note.status`、`file.name` |
| 视图的`order:`列表 | 带前缀 | `[file.name, note.status]` |
| 视图的`sort[].property` | 带前缀 | `note.due` |
| **筛选**表达式内部 | **裸键（不带前缀）** | `status == "Done"` |
| `plainva`子键内部（`groupBy`、`dateField`、`endField`、`subItemsProperty`） | **裸键（不带前缀）** | `groupBy: status` |

经验法则：*面向Obsidian*的结构性字段使用`note.<key>`（内置字段如`file.name`、`file.folder`、`file.mtime`则使用`file.<x>`）；而**筛选公式**内部或**`plainva`区块**内部的一切，都使用裸的Frontmatter键。

### 顶层键

- **`filters`**——哪些笔记属于这个数据库。在Plainva中，这里只保存**来源**（文件夹/标签）；属性筛选条件则按视图分别保存在`views[i].filters`下。参见[筛选](#筛选)。
- **`properties`**——列的模式（schema），按属性ID索引。原生的Obsidian子键（如`displayName`，即列标题标签）是允许的并会被保留；所有Plainva的丰富功能都位于`properties[id].plainva`之下。
- **`views`**——一个有序的视图列表。每个视图都需要`name`和`type`。
- **`formulas`**——一个Obsidian特性。Plainva不会创建它们，但会原样保留。

### `plainva:`子键映射表

所有Plainva专有的内容都被划入了命名空间。共有三个位置：

**`properties[<note.key>].plainva`**——每一列：

| 键 | 值 | 含义 |
|---|---|---|
| `input` | 下方输入类型之一 | 该列的字段类型 |
| `options` | 选项对象的列表 | 单选/状态/多选的精选值 |
| `relationBase` | 相对于仓库的`.base`路径 | 关联的目标数据库（参见[关联](#关联双向的契约)） |
| `relationLimit` | `one` | 基数：单个链接。省略即为不限。 |
| `reverseOf` | `{ base, property }` | 标记一个**计算得出的反向关联**列（没有`input`） |

**`views[i].plainva`**——每一个视图：

| 键 | 值 | 含义 |
|---|---|---|
| `render` | `board` / `calendar` / `timeline` | 仅Plainva支持的视图类型（见下文） |
| `groupBy` | 裸属性键 | 看板的分组列 |
| `dateField` | 裸属性键 | 日历/时间轴的起始日期 |
| `endField` | 裸属性键 | 时间轴的结束日期 |
| `coverImage` | 裸属性键 | 画廊的封面图属性 |
| `subItemsProperty` | 裸属性键 | 用于子项嵌套的自关联父级列 |
| `widths` | id到像素的映射 | 列宽 |
| `dateFormat` | 字符串 | 每视图的日期格式（`default`是隐含的——可省略） |

除了`plainva`区块之外，一个视图还可以携带一个原生的**`views[i].filters`**对象——即**按视图设置的属性筛选条件**（采用与文件级别`filters`相同的单根`and`/`or`/`not`语法）。Plainva会把属性筛选规则保存在这里，每个视图各存一份，因此每个视图可以独立筛选；文件级别的`filters`此时就只保留来源。Obsidian会原生地按视图应用`views[i].filters`。

**`views[0].plainva`**——文件级别的键，**仅允许出现在第一个视图上**：

| 键 | 值 | 含义 |
|---|---|---|
| `fileIconColor` | 十六进制颜色 | 数据库图标的着色（文件树/标签页/页眉） |
| `newItemFolder` | 相对于仓库的文件夹 | "新建"按钮存放新条目的位置 |
| `newItemTemplate` | 相对于仓库的`.md`路径 | 新条目的默认模板 |
| `contextFilters` | 裸属性键的列表 | 自我引用（"当前笔记"）筛选（见下文） |

`contextFilters`是Plainva中与Notion"此页面"筛选相对应的功能。每一项都是一个属性键；当该数据库被嵌入到某篇笔记中时，会通过这个属性把它的行限定到那篇宿主笔记（这一步是通过链接索引解析的——拥有该关联的属性或普通链接属性会匹配指向宿主笔记的行，计算得出的反向列则匹配宿主笔记所指向的内容）。它特意**不会**写入原生的`filters`，因此Obsidian会忽略它并显示全部行；在Plainva中单独打开时（没有宿主笔记），它同样会被丢弃，也会显示全部行。多个条目之间按AND逻辑组合（须同时满足）。

### 输入类型

`plainva.input`是以下之一：

```
text  number  checkbox  date  datetime
select  status  multiselect
list  tags  url  email  phone
relation
```

一个计算得出的**反向**列**没有**`input`——它仅通过`reverseOf`来标识。

### 选项与颜色

单选/状态/多选列可以携带一个精选的选项列表。每个选项：

```yaml
options:
  - value: Open          # 必填
    color: amber         # 可选的调色板名称（见下文）
    group: Active        # 可选；仅STATUS类型使用——把选项排列为阶段
  - value: Done
    color: green
    group: Closed
```

`color`是一个**调色板名称**，不是CSS颜色。有效名称：`gray`、`teal`、`blue`、`green`、`amber`、`coral`、`purple`、`pink`。未知的颜色会回退到由值本身派生出的颜色。

### 视图类型

`views[i].type`在磁盘上是一个原生的Obsidian类型。仅Plainva支持的渲染方式会被写成`type: table`加上一个`plainva.render`提示，这样Obsidian就会把它们降级显示为一个普通表格：

| 你想要的 | 磁盘上的`type` | `plainva.render` |
|---|---|---|
| 表格 | `table` | — |
| 列表 | `list` | — |
| 画廊 | `cards` | — |
| 看板 | `table` | `board` |
| 日历 | `table` | `calendar` |
| 时间轴 | `table` | `timeline` |

### 筛选

`filters`选择哪些笔记属于这个数据库，并对其加以限定。

**来源条件**决定成员资格：

- 文件夹：`file.folder == "Path/To/Folder"`（相对于仓库；根文件夹是`""`）。
- 标签：`file.hasTag("project")`（不带前导的`#`）。

多个来源就是多个条目而已。完全没有`filters` = 仓库中的每篇笔记。

**属性条件存放在哪里：** 在文件级别，`filters`适用于所有视图。而Plainva会把属性筛选规则按**视图**分别保存在`views[i].filters`中（结构同样是单根的），文件级别只保留来源，这样每个视图就可以独立筛选。这两种写法对Obsidian来说都是合法的；一个工具可以写入其中任意一种。一个在文件级别带有属性条件的旧文件仍然可以正常使用——Plainva会在下一次保存时把这些条件分发到每个视图中。

**属性条件**使用裸属性名和以下运算符：

| 运算符 | 表达式 |
|---|---|
| 等于 | `status == "Done"` |
| 不等于 | `status != "Done"` |
| 包含 | `contains(labels, "urgent")` |
| 不包含 | `!contains(labels, "urgent")` |
| 大于 / 小于 | `priority > "2"`、`priority < "5"` |
| 至少 / 至多 | `priority >= "2"`、`priority <= "5"` |
| 为空 | `status == ""` |
| 不为空 | `status != ""` |

**结构（单根！）：** `and` / `or` / `not`三者之一，其条目是条件字符串——或者一层嵌套的`{and:[...]}` / `{or:[...]}`分组对象（Notion风格的分组）。以下示例组合了一个来源、一个条件和一个OR分组：

```yaml
filters:
  and:
    - 'file.folder == "Projects"'
    - 'status != "Done"'
    - or:
        - 'priority == "1"'
        - 'priority == "2"'
```

### 一个完整的、带注释的`.base`示例

```yaml
filters:
  and:
    - 'file.folder == "Projects"'          # 来源：Projects文件夹中的笔记
properties:
  note.status:                             # 列ID带有note.前缀
    displayName: Status                    # 可选的Obsidian列标签
    plainva:
      input: status
      options:
        - value: Open
          color: amber
          group: Active
        - value: Done
          color: green
          group: Closed
views:
  - type: table                            # 第一个视图：还携带文件级别的键
    name: All projects                     # 每个视图都需要一个名称
    order: [file.name, note.status]        # order使用带note.前缀的id
    plainva:
      fileIconColor: "#2f6f6f"
      newItemFolder: Projects
  - type: table                            # 看板就是原生表格 + 渲染提示
    name: Board
    plainva:
      render: board
      groupBy: status                      # groupBy使用裸键
```

---

## 关联（双向的契约）

关联把笔记彼此链接起来。这是手动编写时最容易出错的部分，因为它横跨**三个**地方。请让这三处保持一致。

1. **值保存在来源笔记的Frontmatter中**，以Wiki链接（或其列表）的形式：

   ```markdown
   ---
   type: Task
   project: "[[Project Alpha]]"
   ---
   ```

2. **来源`.base`声明关联列**（`relationBase` = 目标数据库；`relationLimit: one`表示单个链接）：

   ```yaml
   properties:
     note.project:
       plainva:
         input: relation
         relationBase: Projects.base
         relationLimit: one
   ```

3. **目标`.base`可以用一个计算列展示反向关联。** 它的值**不**保存在任何地方——它们是从来源笔记的链接中派生出来的：

   ```yaml
   properties:
     note.tasks:
       plainva:
         reverseOf:
           base: Tasks.base       # 来源的.base（相对于仓库的路径）
           property: project      # 裸的来源属性键
   ```

### 完整示例：任务 ↔ 项目

**`Tasks.base`**

```yaml
filters:
  and:
    - 'file.folder == "Tasks"'
properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Open
          color: amber
        - value: Done
          color: green
  note.project:
    plainva:
      input: relation
      relationBase: Projects.base
      relationLimit: one
views:
  - type: table
    name: All tasks
    order: [file.name, note.status, note.project]
```

**`Projects.base`**

```yaml
filters:
  and:
    - 'file.folder == "Projects"'
properties:
  note.tasks:
    plainva:
      reverseOf:
        base: Tasks.base
        property: project
views:
  - type: table
    name: All projects
    order: [file.name, note.tasks]
```

**`Tasks/Write proposal.md`**

```markdown
---
type: Task
okf_version: "0.1"
status: Open
project: "[[Project Alpha]]"
---
# Write proposal
```

**`Projects/Project Alpha.md`**

```markdown
---
type: Project
okf_version: "0.1"
---
# Project Alpha
```

结果：在`Projects.base`中，**Project Alpha**的计算列`tasks`会列出"Write proposal"，因为那篇任务的`project`字段链接回了它。请注意，`Project Alpha.md`**没有**`tasks:`这个键——反向的一侧是计算出来的，从不存储。

### 关联的禁忌事项

- **不要把反向值写入笔记。** `reverseOf`列是计算得出的。在`Project Alpha.md`中写入一个`tasks:`键是错误的，也无法在往返读写中保留下来。
- **确保链接目标能够解析。** `"[[Project Alpha]]"`必须与一个已存在的笔记名称匹配，否则该链接会显示为断开状态。
- **保持路径相对于仓库**，使用正斜杠，且不带前导的`./`（`Projects.base`、`DB/Projects.base`）。
- **`reverseOf.property`是裸的来源键**（`project`），而不是`note.project`。

### 自关联与子项

对于目标是同一个数据库的关联，让`relationBase`指向这同一个`.base`。要在表格视图中把子项嵌套在父项之下，请把`views[i].plainva.subItemsProperty`设置为裸的父级关联键。循环引用会被正确处理；关闭子项后，行会保持平铺，值仍会保留。

---

## `index.md`（文件夹目录）

`index.md`是一个文件夹目录的保留名称。

- **只有根`index.md`可以携带Frontmatter**，而且只能是`okf_version`（它标记该仓库为OKF激活状态）。非根目录下的`index.md`必须**不带Frontmatter**——那里的Frontmatter是一种保留名称违规。
- 一个由Plainva**管理**的`index.md`会以标记`<!-- plainva:index generated -->`结尾（一个HTML注释，在阅读模式下不可见）。它的存在意味着Plainva会自动让该文件保持最新。如果你手动编辑这样一个文件，要么保留该标记（并维持生成时的结构），要么有意地移除它，从而永久接管这个文件。
- 生成的列表是形如`* [标题](相对/url) - 描述`的链接区块。

如果你打算手动生成一个文件夹概览，安全的做法是**不要**添加该标记——这样Plainva就永远不会覆盖它。

---

### 关系图视图（`plainva.render: "graph"`）

关系图视图的存储方式与其他每一个非原生视图相同：`type: table`加上渲染提示。它的选项存放在**同一个**`views[i].plainva`命名空间下：

```yaml
views:
  - type: table
    name: Net
    plainva:
      render: graph
      graphEdges: [projekt]        # relation property keys drawn as edges
      graphColorBy: status         # select/status property -> node color
      graphSizeBy: prio            # number property -> node size
      graphShowExternal: true      # include relation targets outside the view
      graphShowIncoming: true      # 来自其他数据库、指向这些条目的关联（例如某个项目的任务）
```

所有关系图选项键都是可选的；未设置时应完全省略。Obsidian会把同一个文件渲染为一张普通表格，并且不能报错。

一个**看板**视图（`plainva.render: "board"`）还可以额外携带`views[i].plainva.boardColumnOrder`——一份分组列键的列表（`__UNGROUPED__`标记无值的列），用于记住手动设定的列顺序。单选/状态看板则改为对属性的`options`重新排序。未设置时省略该键。

## 不要碰的内容与安全性

- **`.plainva/`**保存着备份和内部状态。永远不要从中读取程序逻辑，也不要向其中写入内容。
- **未知的键是神圣不可侵犯的。** 当你重写一个`.base`或一篇笔记时，把每一个你不打算更改的键原样带过去。Plainva自身通过内部的原始副本来保留未知的`.base`键；第三方的写入程序也应该这样做（解析→只更改你想更改的内容→序列化）。
- **值在笔记中改变，而不是在`.base`中。** 要设置一个单元格的值，请编辑笔记的Frontmatter。`.base`只决定展示哪些笔记和哪些列。
- **不要在`.base`中添加**`filters` / `formulas` / `properties` / `views`之外的顶层键。
- **编码：** 处处使用UTF-8无BOM，LF换行符。

## 另请参阅

- [笔记与Markdown](Notes_and_Markdown.md)——从"在应用中手动书写"这个角度看待同样的内容
- [数据库（.base）](Databases_Base.md)——面向日常使用讲解的数据库
- [OKF](OKF.md)——`type`、`okf_version`、index.md与仓库转换
