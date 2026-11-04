# 数据库参考（.base）

更新日期：2026-11-03

本页列出`.base`文件可以包含的全部内容，以及Plainva对每一部分的处理方式：每个顶层键、每种筛选写法、每种视图类型及其选项、汇总、排序、限制，Plainva不认识的键会怎样，以及Plainva与Obsidian Bases行为不同的地方。它描述的是Plainva的代码目前读取、计算和写入的内容，而不是Obsidian的文档。

日常使用请先阅读[数据库（.base）](Databases_Base.md)。工具直接写入仓库文件时必须遵守的规则，以及完整的关联示例，见[文件格式参考](File_Format_Reference.md)。

## 概览

| 文件中的部分 | Plainva的处理 |
|---|---|
| `filters` | 读取并应用[筛选](#筛选)下所列的数据来源（文件夹、标签）和条件 |
| `views` | 读取全部八种视图类型，以及它们的顺序、排序、筛选和汇总 |
| `properties` | 读取列的结构、显示名称和Plainva的`plainva`块 |
| `summaries`（视图内） | 计算十四种内置汇总 |
| `formulas` | 保留在文件中，不计算 |
| `summaries`（顶层） | 保留自定义汇总公式，不计算 |
| `this` | 暂不支持 |
| 其他键 | 保留在文件中（见[Plainva不认识的键](#plainva不认识的键)） |

## 顶层键

`.base`文件是YAML，带有以下顶层键。它们全部可选；没有`views`的文件会打开为一个表格。

| 键 | 内容 | 在Plainva中 |
|---|---|---|
| `filters` | 哪些笔记属于该数据库（数据来源） | 读取并应用 |
| `properties` | 每列一个条目，以属性ID为键 | 读取；Plainva的附加内容存放在其`plainva`块中 |
| `views` | 视图列表 | 读取；每个视图都需要`name` |
| `formulas` | Obsidian公式，`name: expression` | 原样保留，不计算 |
| `summaries` | Obsidian自定义汇总公式 | 原样保留，不计算 |

Plainva从不写入其他顶层键：Obsidian会拒绝打开带有它不认识的键的`.base`。很旧的Plainva版本写入的顶层`columns:`键仍会被读取，并在下次保存文件时移入`properties`。

## 属性（`properties`）

### 属性ID

属性ID给一列命名。共有三种：

| ID | 含义 | 示例 |
|---|---|---|
| `note.<key>` | 笔记Frontmatter中的一个键 | `note.status` |
| `file.<field>` | 关于文件的一项信息（见[文件字段](#文件字段file)） | `file.mtime` |
| `formula.<name>` | `formulas`中的一个Obsidian公式 | `formula.price_per_unit` |

`properties`的键、视图的`order`以及`sort[].property`都使用这些ID。在筛选表达式内部和`plainva`块内部，Frontmatter的键直接写作裸键（`status`）；筛选表达式同样认得`note.status`。

当笔记中键的大小写与列不同时（`Due`对应列`due`），Plainva仍会在该列中显示这个值，并按笔记自己的写法把更改写回去。

### 显示名称

`properties.<id>.displayName`是Obsidian的列标签。Plainva把它显示为列标题并保留它。没有它时，Frontmatter的键会以首字母大写显示（仅在屏幕上）；文件字段有各自的名称，例如**名称**、**修改时间**、**大小**、**路径**、**待办清单**和**来自文件名的日期**。

### 列的`plainva`块

Plainva为一列添加的所有内容都存放在`properties.<id>.plainva`之下。Obsidian会忽略它。

| 键 | 值 | 含义 |
|---|---|---|
| `input` | 字段类型（见下方列表） | 该列的字段类型 |
| `ratingMax` | 数字，1到10 | 评分有多少个标记（默认为5） |
| `ratingGlyph` | 一个字符 | 评分绘制的标记（默认为圆点） |
| `options` | 选项列表 | 单选、状态和多选的固定值 |
| `relationBase` | 相对于仓库的`.base`路径 | 关联所指向的数据库 |
| `relationLimit` | `one` | 关联只保存恰好一个链接；缺省表示不限制 |
| `reverseOf` | `{ base, property }` | 计算得出的反向关联列 |
| `rollup` | `{ through, of, fn, where }` | 计算得出的汇总列（见[关联汇总](#关联汇总)） |
| `previousKeys` | 最多8个旧名称的列表 | 让评论在列被重命名后仍能找到它 |

### 字段类型（`input`）

`text`、`number`、`rating`、`checkbox`、`date`、`datetime`、`select`、`status`、`multiselect`、`list`、`tags`、`url`、`email`、`phone`、`relation`。

另外还会读取两种较旧的写法：`multi-select`按`multiselect`读取，`link`按`relation`读取。没有`input`的列——或者`input`的值不在此列表中的列——其类型由笔记中的值决定：`true`/`false`是复选框，数字是数字，`[[links]]`的列表是关联，`2026-07-03`是日期，网址是URL，依此类推。反向关联列和汇总列没有`input`。

### 选项与颜色

一个选项是`{ value, label, color, group }`；只有`value`是必需的。`color`是调色板名称之一：`gray`、`teal`、`blue`、`green`、`amber`、`coral`、`purple`、`pink`——不认识的名称会退回到由该值推算出的颜色。`group`只用于**状态**：分组相同的选项构成一个阶段。单纯的字符串会被读作以该字符串为值的选项。

### 关联汇总

汇总列会根据本数据库中某个链接列所指向的笔记计算出一个值。这个值不存储在任何文件中。

- `through`——本数据库的一个关联列或反向关联列。
- `of`——被链接笔记的一个属性；`count`不需要它。
- `fn`——`count`、`countWhere`、`percentWhere`、`sum`、`average`、`median`、`min`、`max`、`earliest`、`latest`、`checked`、`unchecked`、`empty`、`filled`、`unique`之一。
- `where`——`{ op, value }`，`countWhere`和`percentWhere`必需；`op`是`==`、`!=`、`contains`、`notContains`、`>`、`<`、`>=`、`<=`之一，`value`为空表示“为空”。

缺少必需部分、或者所指函数不在此列表中的汇总会被忽略：该列保持为空，数据库仍然可以打开。通过另一个计算列得到的汇总同样保持为空。

## 文件字段（`file.*`）

这些值来自文件，而不是来自它的Frontmatter。数据库的每一行都带有以下内容：

| 字段 | 值 |
|---|---|
| `file.name` | 笔记的`title`属性（如果有），否则是不含`.md`的文件名 |
| `file.path` | 相对于仓库的路径 |
| `file.mtime` | 最后修改时间，以毫秒计 |
| `file.ctime` | 创建时间，以毫秒计，前提是文件系统会报告它 |
| `file.size` | 大小，以字节计 |
| `file.tags` | 笔记的所有标签（Frontmatter和正文中的），每个都带`#`；在筛选、便签板或显示该列、按该列排序的视图需要时才会填充 |
| `file.tasks` | 待办进度，格式为`done/total`；用于看板，以及显示该列的视图 |
| `file.day` | 日记的文件名所代表的那一天，按仓库的文件夹和格式推算；只读，只有日历或时间轴的日期字段可以使用它 |
| `file.revision` | 内部的变更标记；请勿依赖它 |

`file.folder`可以用作数据来源（见[数据来源](#数据来源)），但不是列。`file.basename`、`file.ext`、`file.links`、`file.backlinks`、`file.embeds`、`file.properties`和`file.file`不提供：使用其中任何一个的列保持为空，筛选会把它们读作空值。

## 筛选

### 筛选条件存放在哪里

顶层的`filters`保存**数据来源**——哪些笔记属于该数据库。每个视图还可以带有自己的`filters`，其中的条件只缩小该视图的范围；Plainva把条件写在那里。两个层级会同时生效。文件在顶层保留的条件依然有效；Plainva下一次保存时会把它们移入各个视图。

### 数据来源

| 来源 | 表达式 |
|---|---|
| 文件夹 | `file.folder == "Projects/Active"`——该文件夹及其所有子文件夹；`""`和`"/"`都是整个仓库 |
| 标签 | `file.hasTag("project")`——笔记带有恰好这个标签；开头的`#`会被忽略 |

多个来源可以像其他条件一样用`and`或`or`组合。没有来源的数据库包含仓库中的每一篇笔记。附件、保留的`index.md`和`log.md`，以及名称以点开头的文件或文件夹，永远不会成为行。

### 条件

条件是一个字符串。值放在双引号中；`\"`和`\\`分别转义引号和反斜杠。属性可以写作裸键，也可以带`note.`。

| 条件 | 表达式 |
|---|---|
| 是 | `status == "Done"` |
| 不是 | `status != "Done"` |
| 包含 | `contains(labels, "urgent")`或`labels.contains("urgent")` |
| 不包含 | `!contains(labels, "urgent")`或`!labels.contains("urgent")` |
| 大于、小于 | `effort > "3"`、`effort < "8"` |
| 至少、至多 | `due >= "2026-07-01"`、`due <= "2026-07-31"` |
| 为空 | `status == ""`或`status.isEmpty()` |
| 不为空 | `status != ""`或`!status.isEmpty()` |
| 带有标签 | `file.tags.contains("#work")`，用`!`取反 |
| 顶部色条、图标 | `note.plainva.header_color == "#2a7f7b"`、`note.plainva.icon == "lucide:pin"` |

### 值如何比较

- **是**和**不是**按文本比较。对于列表（标签、多选、关联），**是**表示“列表中有这一项”，**不是**表示“没有这一项”。没有该属性的笔记永远不匹配**是**，并且总是匹配**不是**。
- **包含**在值内部查找文本，对列表则在每个条目内部查找。列表上的`labels.contains("x")`要求有一个恰好是`x`的条目；对于`file.tags`，两种写法都要求完整的标签，因此`#work`不会匹配`#workshop`或`#work/child`。
- **大于**、**小于**、**至少**、**至多**在两边都是数字时按数字比较，否则按文本比较——这会让ISO日期（`2026-07-03`）排在正确的顺序上。没有值的笔记永远不匹配它们。
- **为空**会匹配缺失的属性、空值和空列表。
- 复选框按`"true"`或`"false"`比较。

### `and`、`or`、`not`

一个`filters`对象在每一层恰好带有`and`、`or`和`not`之一；它的条目是条件字符串或更深一层的筛选对象。

| 键 | 匹配的情形 |
|---|---|
| `and` | 每个条目都匹配 |
| `or` | 至少一个条目匹配 |
| `not` | 没有任何条目匹配 |

Plainva可以计算任意深度。筛选面板在**全部**或**任一**之下编辑一层分组（**添加组**）；更深的结构会显示为 **复杂筛选（不可编辑）**，保留在文件中并且会生效——其中Plainva无法读取的条件会在它下方标明为未生效。同一层上并排带有`and`和`or`的旧文件，会被读作“`and`全部满足，且`or`中满足一个”，并在下次保存时以有效的形式写出。

### Plainva无法读取的内容

只有以上两张表中的写法能被识别。其他任何内容——`file.inFolder(…)`、`file.hasLink(…)`、`file.hasProperty(…)`、不带引号的数字（`price > 2`）、同一个字符串中的`&&`和`||`、算术运算、`now()`之类的日期函数，或者`this`——都会保留在文件中，并在筛选面板中按原样显示，同时附有提示 **未生效：Plainva 无法读取此条件，因此它不会筛选任何内容。** 这样一来，视图显示的笔记会比Obsidian中同一个筛选显示的更多。

## 公式

Plainva不计算Obsidian公式。`formulas`原样保留在文件中，视图`order`里的`formula.<name>`列显示时没有值。**导出表格** → **公式 (.base)** 会把一部分汇总写成公式，以便Obsidian可以计算它们（见[数据库](Databases_Base.md)）。

## 视图

### 每个视图的键

| 键 | 值 | 在Plainva中 |
|---|---|---|
| `type` | `table`、`list`、`cards` | 视图类型；见下一张表 |
| `name` | 文本 | 必需；没有名称的视图，Plainva会在保存时为它取一个 |
| `order` | 属性ID的列表 | 可见的列，按此顺序 |
| `sort` | `{ property, direction }`的列表 | 排序规则，`ASC`或`DESC` |
| `filters` | 筛选对象 | 该视图自己的条件 |
| `summaries` | 属性ID → 汇总名称的映射 | 每列的页脚 |
| `plainva` | 映射 | Plainva的视图选项，见下文 |

### 八种视图类型

Obsidian认识`table`、`list`和`cards`。Plainva的其他视图类型存储为`type: table`加上`plainva.render`，因此Obsidian会把它们显示为表格。

| 视图类型 | 磁盘上的`type` | `plainva.render` |
|---|---|---|
| **表格**（`table`） | `table` | — |
| **列表**（`list`） | `list` | — |
| **画廊**（`gallery`） | `cards` | — |
| **看板**（`board`） | `table` | `board` |
| **日历**（`calendar`） | `table` | `calendar` |
| **时间轴**（`timeline`） | `table` | `timeline` |
| **关系图**（`graph`） | `table` | `graph` |
| **便签板**（`pinboard`） | `table` | `pinboard` |

只有在**允许对.base文件使用Plainva扩展功能**开启时，看板、日历、时间轴、关系图和便签板才会作为**视图类型**提供。Plainva不认识的`type`会显示为表格，并按原样保留在文件中，直到你选择其他**视图类型**。

### 视图选项（`views[i].plainva`）

在`plainva`块内部，属性写作裸键（`status`），而不是`note.status`。

| 键 | 视图类型 | 值 |
|---|---|---|
| `render` | 看板、日历、时间轴、关系图、便签板 | 视图类型，见上文 |
| `groupBy` | 看板 | 构成各列的属性；没有它时，使用该视图中Obsidian自己的`groupBy`的属性 |
| `boardLaneBy` | 看板 | 用于**泳道依据**的第二个属性 |
| `boardWipLimits` | 看板 | 列的值 → 最多卡片数的映射（**WIP限制**），大于0的整数 |
| `boardColorMode` | 看板 | `column`为整列着色；缺省 = 只有表头标签着色 |
| `boardColumnOrder` | 看板 | 手动指定的列顺序；`__UNGROUPED__`是没有值的那一列 |
| `colorBy` | 看板、时间轴 | 卡片和横条采用该属性的选项颜色（**颜色依据**） |
| `dateField` | 日历、时间轴 | 开始日期（**日期字段**、**开始日期**）；一个日期属性或`file.day` |
| `endField` | 日历、时间轴 | **结束日期** |
| `coverImage` | 画廊 | 保存**封面图**的属性 |
| `subItemsProperty` | 表格 | 用于**子项**的父级关联 |
| `widths` | 表格 | 列 → 宽度（像素）的映射 |
| `dateFormat` | 全部 | `long`、`iso`或`relative`；缺省 = 默认的短格式 |
| `graphEdges` | 关系图 | 作为边绘制的关联属性 |
| `graphColorBy` | 关系图 | 为节点着色的单选或状态属性 |
| `graphSizeBy` | 关系图 | 决定节点大小的数字属性 |
| `graphShowExternal` | 关系图 | `true`会同时显示视图之外的链接目标 |
| `graphShowIncoming` | 关系图 | `true`会同时显示来自其他数据库的传入链接 |
| `pinboardOrder` | 便签板 | 未固定卡片的路径，按手动顺序 |
| `pinboardPinned` | 便签板 | 已固定卡片的路径，按顺序 |
| `pinboardFilterBy` | 便签板 | **标签来源**：一个多选属性；缺省 = 标签 |

### 全文件选项（仅第一个视图）

这些键属于整个数据库。Plainva只把它们写入第一个视图的`plainva`块，并读取每个键的第一个有效值。

| 键 | 值 |
|---|---|
| `fileIconColor` | 数据库图标的十六进制颜色（**数据库图标颜色**） |
| `newItemFolder` | **条目**保存新条目的文件夹 |
| `newItemTemplate` | 新条目使用的模板 |
| `contextFilters` | 把嵌入的数据库限定在它所嵌入的笔记范围内的属性（**当前笔记**） |
| `taskList` | 新任务同时创建于其中的账户和清单（`"<account id> <list id>"`） |

## 汇总

`views[i].summaries`把一列映射到以下名称之一；页脚会针对视图显示的行计算它。

| 名称 | 在Plainva中 | 结果 |
|---|---|---|
| `Average` | **平均值** | 数字的平均值 |
| `Min` | **最小值** | 最小的数字 |
| `Max` | **最大值** | 最大的数字 |
| `Sum` | **求和** | 数字的总和 |
| `Range` | **极差** | 最大数减最小数；对日期则是以天计的跨度 |
| `Median` | **中位数** | 数字的中间值 |
| `Stddev` | **标准差** | 所有数字的标准差（总体） |
| `Earliest` | **最早** | 最早的日期 |
| `Latest` | **最晚** | 最晚的日期 |
| `Checked` | **已勾选** | 值为`true`或`yes`的行 |
| `Unchecked` | **未勾选** | 所有其他行 |
| `Empty` | **没有值** | 没有值的行 |
| `Filled` | **有值** | 有值的行 |
| `Unique` | **不同值** | 不同值的数量；列表条目逐个计数 |

数字四舍五入到两位小数，并且也会读取以逗号作小数点的写法。没有可用值的列显示的是空页脚，而不是0。其他任何名称都是顶层`summaries`中的自定义公式：Plainva会保留它，在菜单中显示为 **自定义：…**，但不计算任何值。

## 排序与分组

- **排序**——`sort`是一个规则列表；第一条规则先起决定作用，下一条只在各行相等时才起作用。数字按数字排序，其他一切按文本排序（ISO日期顺序正确）。在两个方向上，没有值的行都排在最后。没有规则时，最近更改的笔记排在最前面。Plainva也会把`field`读作`property`，并且`asc`/`desc`不分大小写。
- **分组**——看板按`plainva.groupBy`分组，泳道按`plainva.boardLaneBy`。如果视图带的是Obsidian自己的`groupBy`，看板就按该属性分组，更改分组时也会写入其中（其`direction`保持不变）。Plainva不会据此对表格分组。

## 嵌入数据库与`this`

笔记中的`![[Projects.base]]`会在笔记内部显示该数据库，阅读视图和编辑器中都是如此。`#`之后的部分（视图名称，例如`![[Projects.base#Board]]`）会被忽略：嵌入显示的是该数据库上次使用的视图。笔记中的 ` ```base ` 代码块显示为代码，而不是数据库。

**`this`暂不支持。** 使用`this`的筛选或公式会保留在文件中，但Plainva不会计算它。有两个办法涵盖了最常见的情形，即“显示属于这篇笔记的条目”：`contextFilters`（筛选面板中的**当前笔记**）会通过一个关联属性把嵌入的数据库限定在它所嵌入的笔记范围内；而与宿主笔记所在数据库相关联的嵌入数据库，会自动提供**将此数据库筛选到当前笔记**。两者都只在Plainva内部起作用；Obsidian会显示所有行。

## 限制

- 视图的Obsidian`limit`会保留，但不会应用：视图显示它的所有行。
- 筛选面板编辑一层筛选分组；更深的分组会生效，但在那里只能删除。
- 筛选值必须放在双引号中（见[Plainva无法读取的内容](#plainva无法读取的内容)）。
- 文件夹来源始终包含子文件夹。
- `ratingMax`绘制在1到10之间，`previousKeys`最多保留8个名称，**WIP限制**只接受大于0的整数，`relationLimit`只认`one`。
- 汇总列不能基于另一个计算列进行计算。

## Plainva不认识的键

Plainva读取一个`.base`，只更改你在应用中更改的内容，然后把整个文件重新写出——格式为YAML，换行符为LF，不带BOM，因此手写文件中的注释和排版不会保留。对于它不认识的内容：

- **保留：** 任何其他顶层键、`formulas`、顶层`summaries`、`displayName`以及`properties`条目中的所有其他键、列或视图`plainva`块中的未知键、Plainva无法读取的汇总、Plainva不使用的视图键（`limit`、`image`……）、它不认识的视图类型，以及它无法读取的筛选条件。Plainva能理解但你没有更改的值会保留文件中的写法（`status`或`note.status`、以纯文本写出的选项）。
- **重写：** 只有Plainva自己的旧形式——顶层`columns:`映射会移入`properties`，同一层上并排的`and`和`or`会改为有效形式，非常旧的版本以`type: board`保存的视图会变为带`plainva.render`的`type: table`。
- **位置：** 视图保留的键属于该视图。在Plainva中删除或移动视图时，这些键会随之一起移动，**创建副本**会把它们复制到新视图。

## 与Obsidian Bases的差异

| 主题 | Obsidian | Plainva |
|---|---|---|
| 公式、自定义汇总 | 计算 | 保留，不计算 |
| `this` | 支持 | 暂不支持 |
| 筛选表达式 | 完整的表达式语言 | [条件](#条件)中的写法 |
| `file.folder == "X"` | 仅直接位于`X`中的笔记 | `X`及其所有子文件夹 |
| `file.hasTag("x")` | 同时包含`#x/child` | 恰好是`#x` |
| `file.name` | 文件名 | 笔记有`title`属性时用它 |
| 视图`limit`、`groupBy` | 应用 | `limit`保留，不应用；`groupBy`对看板分组，不对表格分组 |
| 视图类型 | `table`、`list`、`cards`和插件类型 | 八种类型；未知的显示为表格并保留在文件中 |
| `![[db.base#View]]` | 打开该视图 | 上次使用的视图 |
| ` ```base ` 代码块 | 数据库 | 代码块 |
| Plainva的`plainva`块 | 忽略 | 看板、日历、时间轴、关系图、便签板、关联、汇总、字段类型 |

## 另请参阅

- [数据库（.base）](Databases_Base.md)——数据库的日常使用
- [文件格式参考](File_Format_Reference.md)——面向工具的磁盘规则、双向关联、`index.md`
- [笔记与Markdown](Notes_and_Markdown.md)——笔记中的属性
