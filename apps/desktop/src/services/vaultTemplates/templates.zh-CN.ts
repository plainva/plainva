import { DEFAULT_DAILY_NOTE_TYPE } from "../../contexts/VaultContext";
import { welcomeBody, type VaultTemplateDefinition } from "./types";
import { defineBase } from "./baseBuilders";

/** Simplified Chinese template set — folder/file names follow the app language.
 *
 * PARA, GTD, Zettelkasten and Journal additionally ship pre-wired `.base`
 * databases (Gesamtplan DB-Vorlagen 2026-07-04); ACE and Johnny.Decimal stay
 * link-/folder-based on purpose. Database column KEYS are translated but kept
 * ASCII/pinyin (umlaut-/space-free); option VALUES, view names and `.base` file
 * names are fully localized. Relation columns and their reverse counterparts
 * are wired here so the databases show real data as soon as the vault is
 * indexed. */
export function templates(): VaultTemplateDefinition[] {
  return [
    {
      id: "para",
      name: "PARA",
      description: "项目、领域、资源、归档——按可执行程度分类（Tiago Forte）。",
      folders: ["项目", "任务", "领域", "资源", "归档", "模板"],
      bases: [
        defineBase({
          path: "项目.base",
          sourceFolder: "项目",
          columns: [
            { key: "status", input: "status", options: ["计划中", "进行中", "等待中", "已完成"] },
            { key: "lingyu", input: "relation", relationBase: "领域.base", relationLimit: "one" },
            { key: "due", input: "date" },
            { key: "renwu", reverseOf: { base: "任务.base", property: "xiangmu" } },
          ],
          views: [
            { name: "表格", type: "table" },
            { name: "按状态", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "模板/项目.md",
        }),
        defineBase({
          path: "任务.base",
          sourceFolder: "任务",
          columns: [
            { key: "status", input: "status", options: ["待处理", "进行中", "已完成"] },
            { key: "xiangmu", input: "relation", relationBase: "项目.base", relationLimit: "one" },
            { key: "due", input: "date" },
          ],
          views: [
            { name: "表格", type: "table" },
            { name: "按状态", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "模板/任务.md",
        }),
        defineBase({
          path: "领域.base",
          sourceFolder: "领域",
          columns: [{ key: "xiangmu", reverseOf: { base: "项目.base", property: "lingyu" } }],
          views: [{ name: "表格", type: "table" }],
        }),
      ],
      notes: [
        {
          path: "欢迎.md",
          description: "这个仓库的起点和快速指南。",
          body: welcomeBody(
            "欢迎",
            "这个仓库按照PARA方法（Tiago Forte）组织：内容按可执行程度分类，而不是按主题分类。",
            [
              { name: "项目", description: "有明确目标和截止日期的事务（项目.base）。" },
              { name: "任务", description: "单个的下一步行动——每条都指向自己所属的项目（任务.base）。" },
              { name: "领域", description: "需要长期维护、没有截止日期的责任范围。" },
              { name: "资源", description: "供查阅的主题、资料和参考内容。" },
              { name: "归档", description: "来自其他文件夹的已完成或不再活跃的内容。" },
            ],
            "打开项目.base、任务.base和领域.base数据库，即可按状态查看项目，把任务分配给项目，并把项目关联到各自的领域——已完成的内容会移到归档，链接和index.md概览由Plainva自动维护。"
          ),
        },
        {
          path: "项目/项目示例.md",
          description: "一个项目笔记的示例。",
          properties: { status: "进行中", lingyu: "[[领域示例]]" },
          body: "# 项目示例\n\n项目有明确的目标和可预见的结束时间。在这里记录目的、下一步行动和成果。\n\n- [ ] 记录项目目标\n- [ ] 确定下一步行动\n",
        },
        {
          path: "任务/任务示例.md",
          description: "一个与项目关联的任务示例。",
          properties: { status: "待处理", xiangmu: "[[项目示例]]" },
          body: "# 任务示例\n\n任务是单个的、具体的下一步行动。它通过项目属性归属于项目示例。\n",
        },
        {
          path: "领域/领域示例.md",
          description: "一个责任范围的示例。",
          body: "# 领域示例\n\n领域是没有截止日期、需要长期维护的责任范围——例如「健康」或「财务」。项目通过其领域属性与它关联。\n",
        },
        {
          path: "模板/项目.md",
          properties: { status: "计划中" },
          body: "# {{title}}\n\n## 目标\n\n## 下一步行动\n\n- [ ] \n",
        },
        {
          path: "模板/任务.md",
          properties: { status: "待处理" },
          body: "# {{title}}\n\n## 笔记\n\n- [ ] \n",
        },
      ],
      settings: { templateFolder: "模板" },
    },
    {
      id: "zettelkasten",
      name: "Zettelkasten",
      description: "一条笔记一个想法，紧密互联——闪念笔记、文献笔记与永久笔记（Luhmann）。",
      folders: ["闪念笔记", "文献笔记", "永久笔记", "模板"],
      bases: [
        defineBase({
          path: "文献.base",
          sourceFolder: "文献笔记",
          columns: [
            { key: "author", input: "text" },
            { key: "year", input: "number" },
            { key: "kind", input: "select", options: ["书籍", "文章", "视频", "播客", "网站"] },
            { key: "status", input: "status", options: ["待读", "已读", "已处理"] },
            { key: "url", input: "url" },
            { key: "biji", reverseOf: { base: "永久笔记.base", property: "source" } },
          ],
          views: [
            { name: "表格", type: "table" },
            { name: "按状态", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "模板/文献笔记.md",
        }),
        defineBase({
          path: "永久笔记.base",
          sourceFolder: "永久笔记",
          columns: [{ key: "source", input: "relation", relationBase: "文献.base" }],
          views: [{ name: "表格", type: "table" }],
        }),
      ],
      notes: [
        {
          path: "欢迎.md",
          description: "这个仓库的起点和快速指南。",
          body: welcomeBody(
            "欢迎",
            "这个仓库遵循Zettelkasten卡片盒方法（Niklas Luhmann）：一条笔记一个想法——联系通过链接产生，而不是通过文件夹层级。",
            [
              { name: "闪念笔记", description: "快速记下的原始想法——短暂存在，之后再处理。" },
              { name: "文献笔记", description: "用自己的话总结所读内容，并注明出处。" },
              { name: "永久笔记", description: "完整表述、可长期保留的想法——一条笔记一个，且互相紧密链接。" },
            ],
            "用文献.base按阅读状态管理你的资料来源；永久笔记.base通过其来源属性，把永久笔记与它们所依据的文献关联起来。"
          ),
        },
        {
          path: "永久笔记/笔记示例.md",
          description: "一个永久笔记的示例。",
          properties: { source: ["[[文献笔记示例]]"] },
          body: "# 笔记示例\n\n一条永久笔记只包含一个想法，用完整的句子、自己的话写成。\n\n直接在正文中链接相关笔记——想法之网就是这样成长起来的。\n",
        },
        {
          path: "文献笔记/文献笔记示例.md",
          description: "一个文献笔记的示例。",
          properties: { author: "Niklas Luhmann", year: 1992, kind: "书籍", status: "已读" },
          body: "# 文献笔记示例\n\n用自己的话总结你所读的内容，并记录出处。永久笔记通过其来源属性指向这条文献笔记。\n",
        },
        {
          path: "模板/文献笔记.md",
          properties: { status: "待读" },
          body: "# {{title}}\n\n## 总结\n\n## 来源\n",
        },
      ],
      settings: { templateFolder: "模板" },
    },
    {
      id: "ace",
      name: "ACE (Linking Your Thinking)",
      description: "地图集、日历与事务——以MOC为中心的知识管理法，出自Nick Milo。",
      folders: ["地图集", "日历", "事务"],
      notes: [
        {
          path: "欢迎.md",
          description: "这个仓库的起点和快速指南。",
          body: welcomeBody(
            "欢迎",
            "这个仓库使用「Linking Your Thinking」的ACE结构（Nick Milo）：知识通过Maps of Content（MOC，内容地图）互相连接，而不是靠层层嵌套的文件夹。",
            [
              { name: "地图集", description: "你知识的地图——MOC和概览笔记。" },
              { name: "日历", description: "与时间相关的内容——日记、日志、回顾。" },
              { name: "事务", description: "你正在积极推进的一切事情。" },
            ],
            "从地图集里的Home笔记开始，从那里把链接延伸到你的知识网络中。"
          ),
        },
        {
          path: "地图集/Home.md",
          description: "你最顶层的Map of Content。",
          body: "# Home\n\nHome笔记是你的入口：在这里链接你最重要的Map of Content和当前的事务。\n",
        },
      ],
    },
    {
      id: "jd",
      name: "Johnny.Decimal",
      description: "编号区域与类别（10-19 / 11 / 11.01），让一切都有据可查。",
      folders: [
        "00-09 系统",
        "00-09 系统/00 索引",
        "10-19 个人",
        "10-19 个人/11 财务",
        "10-19 个人/12 健康",
        "20-29 工作",
        "20-29 工作/21 项目",
        "20-29 工作/22 会议",
      ],
      notes: [
        {
          path: "欢迎.md",
          description: "这个仓库的起点和快速指南。",
          body: welcomeBody(
            "欢迎",
            "这个仓库按照Johnny.Decimal方法组织：最多十个区域（10-19、20-29……），每个区域下最多十个类别（11、12……）——每条笔记会得到一个像11.01这样的编号。",
            [
              { name: "00-09 系统", description: "系统本身的管理——索引和约定。" },
              { name: "10-19 个人", description: "个人主题的示例区域。" },
              { name: "20-29 工作", description: "工作主题的示例区域。" },
            ],
            "把区域和类别重命名为你自己的主题——刻意受限的层级深度（区域→类别→编号）正是这个方法的核心。"
          ),
        },
        {
          path: "00-09 系统/00 索引/00.00 索引.md",
          description: "Johnny.Decimal索引：所有编号汇总在一处。",
          body: "# 00.00 索引\n\n在这里维护所有区域、类别和编号的清单。想查找编号的人应该先看这里。\n\n## 10-19 个人\n\n- 11 财务\n- 12 健康\n\n## 20-29 工作\n\n- 21 项目\n- 22 会议\n",
        },
      ],
    },
    {
      id: "gtd",
      name: "GTD",
      description: "Getting Things Done——收件箱、任务、项目、参考资料和将来清单。",
      folders: ["收件箱", "任务", "项目", "参考资料", "将来清单", "模板"],
      bases: [
        defineBase({
          path: "任务.base",
          sourceFolder: "任务",
          columns: [
            { key: "status", input: "status", options: ["收件箱", "下一步", "等待中", "将来", "已完成"] },
            { key: "context", input: "select", options: ["@家里", "@办公", "@外出", "@电话"] },
            { key: "xiangmu", input: "relation", relationBase: "项目.base", relationLimit: "one" },
            { key: "due", input: "date" },
          ],
          views: [
            { name: "表格", type: "table" },
            { name: "按状态", type: "board", groupBy: "status" },
            { name: "按情境", type: "board", groupBy: "context" },
          ],
          newItemTemplate: "模板/任务.md",
        }),
        defineBase({
          path: "项目.base",
          sourceFolder: "项目",
          columns: [
            { key: "status", input: "status", options: ["进行中", "等待中", "将来", "已完成"] },
            { key: "renwu", reverseOf: { base: "任务.base", property: "xiangmu" } },
          ],
          views: [
            { name: "表格", type: "table" },
            { name: "按状态", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "模板/项目.md",
        }),
      ],
      notes: [
        {
          path: "欢迎.md",
          description: "这个仓库的起点和快速指南。",
          body: welcomeBody(
            "欢迎",
            "这个仓库遵循Getting Things Done（David Allen）：一切先进入收件箱，再从那里分流成具体的任务和项目。",
            [
              { name: "收件箱", description: "所有新事项的收集点——请定期清空。" },
              { name: "任务", description: "单个的下一步行动——按状态和情境组织（任务.base）。" },
              { name: "项目", description: "所有需要不止一个步骤的事务（项目.base）。" },
              { name: "参考资料", description: "无需采取行动的查阅材料。" },
              { name: "将来清单", description: "留待以后考虑的想法和项目。" },
            ],
            "在任务.base里，你通过每条任务的项目属性把它归入某个项目；项目.base随后会在任务列自动显示每个项目下所包含的内容。每周回顾能让这套系统保持可靠。"
          ),
        },
        {
          path: "每周回顾.md",
          description: "GTD每周回顾的检查清单。",
          body: "# 每周回顾\n\n- [ ] 清空收件箱\n- [ ] 浏览项目清单并确认下一步行动\n- [ ] 快速浏览将来清单\n- [ ] 查看未来两周的日历\n",
        },
        {
          path: "项目/项目示例.md",
          description: "一个GTD项目笔记的示例。",
          properties: { status: "进行中" },
          body: "# 项目示例\n\n预期成果：完成时是什么样子？\n\n下一步行动：\n\n- [ ] 记录具体的下一步行动\n",
        },
        {
          path: "任务/任务示例.md",
          description: "一个与项目关联的任务示例。",
          properties: { status: "下一步", context: "@办公", xiangmu: "[[项目示例]]" },
          body: "# 任务示例\n\n任务是单个的、具体的下一步行动。它通过项目属性归属于项目示例。\n",
        },
        {
          path: "任务/收集想法.md",
          description: "一个刚进收件箱的事项示例。",
          properties: { status: "收件箱" },
          body: "# 收集想法\n\n刚落入收件箱，还没有处理。在下一次回顾时，这条任务会被赋予情境和项目。\n",
        },
        {
          path: "模板/任务.md",
          properties: { status: "收件箱" },
          body: "# {{title}}\n\n## 笔记\n\n- [ ] \n",
        },
        {
          path: "模板/项目.md",
          properties: { status: "进行中" },
          body: "# {{title}}\n\n## 预期成果\n\n## 下一步行动\n\n- [ ] \n",
        },
      ],
      settings: { templateFolder: "模板" },
    },
    {
      id: "journal",
      name: "Journal",
      description: "配有现成模板和日记数据库的每日笔记——一切都已即时预先设置好。",
      folders: ["日记", "模板"],
      bases: [
        defineBase({
          path: "日记.base",
          sourceFolder: "日记",
          columns: [
            { key: "date", input: "date" },
            { key: "mood", input: "select", options: ["不错", "一般", "糟糕", "高效", "疲惫"] },
            { key: "keywords", input: "tags" },
          ],
          views: [
            { name: "表格", type: "table", sort: [{ property: "date", direction: "DESC" }] },
            { name: "日历", type: "calendar", dateField: "date" },
          ],
        }),
      ],
      notes: [
        {
          path: "欢迎.md",
          description: "这个仓库的起点和快速指南。",
          body: welcomeBody(
            "欢迎",
            "这个仓库专为每日写作而设计：日记保存在日记文件夹中，并根据模板文件夹里的模板创建。",
            [
              { name: "日记", description: "你的日记，一天一篇。" },
              { name: "模板", description: "新笔记使用的模板——日记模板已经配置好。" },
            ],
            "打开右侧边栏的日历，点击某一天即可创建你的第一篇日记。日记.base会把你的条目显示为表格并呈现在日历上——带有日期、心情和关键词。"
          ),
        },
        {
          path: "模板/日记模板.md",
          description: "新日记的模板——{{date}}、{{time}}和{{title}}会被替换。",
          type: DEFAULT_DAILY_NOTE_TYPE,
          properties: { date: "{{date}}" },
          body: "# {{title}}\n\n## 笔记\n\n## 任务\n\n- [ ] \n",
        },
      ],
      settings: { dailyNotesFolder: "日记", templateFolder: "模板", dailyNoteTemplate: "日记模板.md" },
    },
  ];
}
