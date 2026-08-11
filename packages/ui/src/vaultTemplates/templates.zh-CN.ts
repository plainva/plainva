import type { VaultTemplateDefinition } from "./types";
import { buildPlainvaTour, type TourStrings } from "./plainvaTour";
import { buildPara, type ParaStrings } from "./paraTemplate";
import { buildAce, type AceStrings } from "./aceTemplate";
import { buildJd, type JdStrings } from "./jdTemplate";
import { buildJournal, type JournalStrings } from "./journalTemplate";
import { buildGtd, type GtdStrings } from "./gtdTemplate";
import { buildZettelkasten, type ZettelkastenStrings } from "./zettelkastenTemplate";
import { buildProject, PROJECT_STRINGS_ZH_CN } from "./projectTemplate";

/** Simplified Chinese template set — folder/file names follow the app language.
 *
 * PARA, GTD, Zettelkasten and Journal additionally ship pre-wired `.base`
 * databases (Gesamtplan DB-Vorlagen 2026-07-04); ACE and Johnny.Decimal stay
 * link-/folder-based on purpose. Database column KEYS are translated but kept
 * ASCII/pinyin (umlaut-/space-free); option VALUES, view names and `.base` file
 * names are fully localized. Relation columns and their reverse counterparts
 * are wired here so the databases show real data as soon as the vault is
 * indexed. */

// ---------------------------------------------------------------------------
// Plainva Tour — shared structure (plainvaTour.ts), Simplified Chinese strings.
// ---------------------------------------------------------------------------

const CHEAT_SHEET_ZH_CN = `下面的所有内容都是纯粹的Markdown。用工具栏在阅读和编辑模式之间切换——编辑器只在光标所在的位置显示格式标记。

> [!tip] 提示块
> 用\`> [!tip]\`开始一段引用。还有更多类型：note, warning, danger, example, question。

## 一个表格

| 快捷键 | 作用 |
| --- | --- |
| \`Mod+P\` | 命令面板 |
| \`Mod+O\` | 快速打开 |
| \`F1\` | 所有键盘快捷键 |

## 一个图表

\`\`\`mermaid
flowchart LR
  A[快速笔记] --> B[任务]
  B --> C[项目]
  C --> D[领域]
\`\`\`

## 一个公式

行内公式：$E = mc^2$

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

## 一张图片

![[附件/skizze.svg]]

## 任务和高亮

- [x] 已经完成的事情
- [ ] 一些==值得标记的事情== #tour

链接指向笔记：[[网站改版]]和[[工作]]。

脚注也可以用。[^1]

[^1]: 就像这一条。
`;

const TOUR_STRINGS_ZH_CN: TourStrings = {
  name: "Plainva导览",
  description: "一个带导览的仓库：便签板、每日笔记、领域、项目和任务——Plainva提供的每一种视图，都配有示例。",
  folders: {
    quickNotes: "快速笔记",
    journal: "日记",
    areas: "领域",
    projects: "项目",
    tasks: "任务",
    resources: "资源",
    archive: "归档",
    attachments: "附件",
    templates: "模板",
  },
  folderHints: {
    quickNotes: "还没有固定去处的一切——以便签板的形式展示。",
    journal: "一天一条笔记，展示在日历上。",
    areas: "持续进行的责任范围，以画廊形式展示。",
    projects: "有明确终点的事务，展示在看板和时间轴上。",
    tasks: "标准的任务数据库——看板和表格。",
    resources: "想要保留的资料。",
    archive: "已完成的工作；把笔记移到这里会让它从活跃视图中消失。",
    attachments: "图片和文件。",
    templates: "笔记模板，每个都关联着自己的数据库。",
  },
  welcome: {
    file: "欢迎.md",
    title: "欢迎使用 Plainva",
    intro: "这个仓库是一次导览。下面的每个文件夹都填满了示例，每个数据库展示不同的视图——打开它们，随意修改：这里没有什么是不能碰的。",
    outro: "你看到的一切都是这个文件夹里纯粹的Markdown。删掉不需要的，把其余的重新命名——这个仓库就是你的了。",
  },
  templates: {
    project: { file: "项目.md", body: "# {{title}}\n\n## 目标\n\n## 下一步行动\n\n- [ ] \n" },
    task: { file: "任务.md", body: "# {{title}}\n\n" },
    area: { file: "领域.md", body: "# {{title}}\n\n## 做得好是什么样子\n\n" },
    resource: { file: "资源.md", body: "# {{title}}\n\n## 为什么值得保留\n\n" },
    quickNote: { file: "快速笔记.md", body: "# {{title}}\n\n" },
    daily: {
      file: "日记.md",
      description: "新建每日笔记时使用的模板——{{date}}、{{time}} 和 {{daily±1}} 会在创建笔记时被替换。",
      body: "# {{title}}\n\n{{daily-1}} · {{date:dddd}} · {{daily+1}}\n\n## 任务\n\n- [ ] \n\n## 笔记\n\n{{cursor}}\n",
    },
    meeting: {
      file: "会议.md",
      description: "未分配给任何数据库——它会出现在“显示所有模板”里。在一个对话框中一次问三个问题。",
      body: "# {{title}}\n\n**种类：** {{select:种类|周会,一对一,工作坊,回顾}}\n**日期：** {{date_prompt:会议日期}}\n**出席：** {{prompt:出席|我}}\n\n## 议程\n\n{{cursor}}\n\n## 决定\n\n## 任务\n\n- [ ] \n",
    },
  },
  baseFiles: {
    areas: "领域.base",
    projects: "项目.base",
    tasks: "任务.base",
    resources: "资源.base",
    quickNotes: "快速笔记.base",
    journal: "日记.base",
    archive: "归档.base",
  },
  keys: {
    focus: "zhongdian", cover: "cover", projects: "xiangmu",
    status: "status", area: "lingyu", start: "kaishi", end: "jieshu", tasks: "renwu",
    done: "wancheng", project: "xiangmu", due: "due", priority: "youxianji",
    date: "riqi", mood: "xinqing", topics: "biaoqian",
    kind: "kind", url: "url", readStatus: "status",
    finished: "guidang",
  },
  options: {
    projectStatus: ["计划中", "进行中", "等待中", "已完成"],
    taskStatus: ["待处理", "进行中", "已完成"],
    priority: ["高", "中", "低"],
    mood: ["不错", "一般", "辛苦", "高效"],
    resourceKind: ["书籍", "文章", "视频", "工具", "参考"],
    resourceStatus: ["未读", "已读"],
  },
  views: {
    table: "表格", board: "看板", timeline: "时间轴", gallery: "画廊",
    list: "列表", tree: "树形", calendar: "日历", pinboard: "便签板",
  },
  subItems: { parent: "父项", children: "子项" },
  welcomeSections: { databases: "你的数据库", start: "从这里开始" },
  samples: {
    areas: [
      { title: "工作", body: "所有能拿到报酬的事情。这里的项目都有截止日期。", icon: "💼", color: "#2a7f7b", props: { zhongdian: "不加班也能交付", cover: "附件/cover.svg" } },
      { title: "家庭", body: "住的地方、各种文件、需要持续维持的事情。", icon: "🏠", color: "#8a6d3b", props: { zhongdian: "没有逾期的事", cover: "附件/cover.svg" } },
      { title: "健康", body: "睡眠、运动、饮食——这些枯燥的事情决定了其他的一切。", icon: "🌱", color: "#3d7f4a", props: { zhongdian: "每周三次" } },
      { title: "学习", body: "明年想在哪些方面做得更好。", icon: "📚", color: "#5a5a8a", props: { zhongdian: "每月一本书" } },
    ],
    projects: [
      { title: "网站改版", body: "新的首页和更清晰的结构。\n\n见[[工作]]。", props: { status: "进行中", lingyu: "[[工作]]", kaishi: "{{today-6}}", jieshu: "{{today+9}}" } },
      { title: "办公室搬迁", body: "更小的房间，同一张桌子。", props: { status: "计划中", lingyu: "[[工作]]", kaishi: "{{today+4}}", jieshu: "{{today+13}}" } },
      { title: "报税", body: "还在等两张发票。", props: { status: "等待中", lingyu: "[[家庭]]", kaishi: "{{today-3}}", jieshu: "{{today+6}}" } },
      { title: "马拉松计划", body: "十二周，每周跑三次。\n\n属于[[健康]]。", props: { status: "已完成", lingyu: "[[健康]]", kaishi: "{{today-12}}", jieshu: "{{today-2}}" } },
    ],
    tasks: [
      { title: "起草首页", body: "两个方案，再做决定。", props: { wancheng: false, status: "进行中", xiangmu: "[[网站改版]]", due: "{{today+1}}", youxianji: "高" } },
      { title: "收集反馈", body: "三个人，每人十五分钟。", props: { wancheng: false, status: "待处理", xiangmu: "[[网站改版]]", due: "{{today+5}}", youxianji: "中", parent: "[[起草首页]]" } },
      { title: "撰写文案", body: "用简短的句子。", props: { wancheng: false, status: "待处理", xiangmu: "[[网站改版]]", due: "{{today+7}}", youxianji: "中" } },
      { title: "整理旧页面", body: "", props: { wancheng: true, status: "已完成", xiangmu: "[[网站改版]]", due: "{{today-2}}", youxianji: "低" } },
      { title: "测量新房间", body: "桌子是160厘米。", props: { wancheng: false, status: "待处理", xiangmu: "[[办公室搬迁]]", due: "{{today+3}}", youxianji: "中" } },
      { title: "订购纸箱", body: "", props: { wancheng: false, status: "待处理", xiangmu: "[[办公室搬迁]]", due: "{{today+8}}", youxianji: "低" } },
      { title: "索取发票", body: "用邮件，简短一些。", props: { wancheng: false, status: "进行中", xiangmu: "[[报税]]", due: "{{today}}", youxianji: "高" } },
      { title: "预约理疗", body: "", props: { wancheng: true, status: "已完成", xiangmu: "[[马拉松计划]]", due: "{{today-4}}", youxianji: "中" } },
      { title: "规划下一个赛季", body: "更短的距离，更多的睡眠。", props: { wancheng: false, status: "待处理", due: "{{today+11}}", youxianji: "低" } },
    ],
    quickNotes: [
      { title: "先读我", body: "这块板上的卡片都是普通笔记。拖动它们、固定它们、给它们上色——或者干脆全部删掉。\n\n#tour", pinned: true, color: "#2a7f7b" },
      { title: "购物清单", body: "- [ ] 咖啡\n- [ ] 橄榄油\n- [x] 面包\n\n#家庭", color: "#8a6d3b" },
      { title: "读书会的点子", body: "每月一次，一本书，不用幻灯片。\n\n#想法" },
      { title: "语录", body: "> 一条你再也找不到的笔记，等于从未写过。\n\n#语录", color: "#5a5a8a" },
      { title: "草图", body: "下面这张图放在附件文件夹里。\n\n![[附件/skizze.svg]]\n\n#tour", pinned: true },
      { title: "键盘", body: "`Mod+P` 打开命令面板，`F1` 列出所有快捷键。\n\n#tour" },
    ],
    journal: [
      { title: "{{today}}", body: "开始了这次导览。看板比列表更容易理解。\n\n做了[[起草首页]]的工作。", props: { riqi: "{{today}}", xinqing: "高效", biaoqian: ["tour"] } },
      { title: "{{today-1}}", body: "平静的一天。整理了[[报税]]的资料。", props: { riqi: "{{today-1}}", xinqing: "一般", biaoqian: ["家庭"] } },
    ],
    resources: [
      { title: "Markdown速查表", body: CHEAT_SHEET_ZH_CN, props: { kind: "参考", status: "已读", cover: "附件/cover.svg" } },
      { title: "Plainva手册", body: "完整的指南在plainva.com/docs。", props: { kind: "参考", url: "https://plainva.com/docs", status: "未读" } },
      { title: "深度工作", body: "Cal Newport 著。关于时间安排的那一章最有用。", props: { kind: "书籍", status: "未读", lingyu: "[[学习]]" } },
      { title: "键盘快捷键", body: "在Plainva中按`F1`——列表可以搜索。", props: { kind: "参考", status: "已读", lingyu: "[[学习]]" } },
    ],
    archive: [
      { title: "旧网站", body: "被[[网站改版]]取代了。留着是为了里面的文案。", props: { guidang: "{{today-20}}" } },
    ],
  },
};

const PARA_STRINGS_ZH_CN: ParaStrings = {
  name: "PARA",
  description: "项目、领域、资源、归档——按可执行程度分类（Tiago Forte）。",
  folders: {
    projects: "项目",
    tasks: "任务",
    areas: "领域",
    resources: "资源",
    archive: "归档",
    templates: "模板",
  },
  folderHints: {
    projects: "有明确目标和截止日期的事务（项目.base）。",
    tasks: "单个的下一步行动——每条都指向自己所属的项目（任务.base）。",
    areas: "需要长期维护、没有截止日期的责任范围。",
    resources: "供查阅的主题、资料和参考内容。",
    archive: "来自其他文件夹的已完成或不再活跃的内容。",
  },
  welcome: {
    file: "欢迎.md",
    description: "这个仓库的起点和快速指南。",
    title: "欢迎",
    intro: "这个仓库按照PARA方法（Tiago Forte）组织：内容按可执行程度分类，而不是按主题分类。",
    outro:
      "打开项目.base、任务.base和领域.base数据库，即可按状态查看项目，把任务分配给项目，并把项目关联到各自的领域——已完成的内容会移到归档，链接和index.md概览由Plainva自动维护。",
  },
  welcomeSections: { databases: "你的数据库", start: "从这里开始" },
  baseFiles: { projects: "项目.base", tasks: "任务.base", areas: "领域.base" },
  keys: { status: "status", area: "lingyu", due: "due", tasks: "renwu", project: "xiangmu", projects: "xiangmu" },
  options: {
    projectStatus: ["计划中", "进行中", "等待中", "已完成"],
    taskStatus: ["待处理", "进行中", "已完成"],
  },
  views: { table: "表格", byStatus: "按状态" },
  templates: {
    project: { file: "项目.md", body: "# {{title}}\n\n## 目标\n\n## 下一步行动\n\n- [ ] \n" },
    task: { file: "任务.md", body: "# {{title}}\n\n## 笔记\n\n- [ ] \n" },
  },
  samples: {
    areas: [
      {
        title: "团队",
        body: "领域是没有截止日期、需要长期维护的责任范围。项目通过领域属性与它关联——领域.base的表格会把它们反映回来。",
      },
      { title: "财务", body: "记账、合同、保险。即使当前没有进行中的项目，它也会持续存在。" },
      { title: "健康", body: "一切需要长期关注、而非有明确终点的事情。" },
    ],
    projects: [
      {
        title: "2026年度报税",
        body: "项目有明确的目标和可预见的结束时间。这个项目已经计划好，但还没有开始——所以它位于看板的第一列。",
        props: { status: "计划中", lingyu: "[[财务]]", due: "{{today+45}}" },
      },
      {
        title: "搬到新办公室",
        body: "进行中的示例：下面的任务通过其项目属性指向这里，项目.base会把它们反映在任务列中。\n\n- [ ] 记录项目目标\n- [ ] 确定下一步行动",
        props: { status: "进行中", lingyu: "[[团队]]", due: "{{today+21}}" },
      },
      {
        title: "背部康复计划",
        body: "等待某件你无法控制的事情——这里是等一个预约。这正是第三列的用途。",
        props: { status: "等待中", lingyu: "[[健康]]", due: "{{today+10}}" },
      },
      {
        title: "网站改版",
        body: "已完成。完成的项目会一直显示，直到你把它移到归档——数据库会跟随文件变化。",
        props: { status: "已完成", lingyu: "[[团队]]", due: "{{today-5}}" },
      },
    ],
    tasks: [
      {
        title: "咨询搬家公司报价",
        body: "任务是单个的、具体的下一步行动。",
        props: { status: "待处理", xiangmu: "[[搬到新办公室]]", due: "{{today+3}}" },
      },
      {
        title: "确认旧办公室的退租通知期",
        body: "已经开始但还没完成——看板中间那一列。",
        props: { status: "进行中", xiangmu: "[[搬到新办公室]]", due: "{{today+1}}" },
      },
      {
        title: "与团队确定平面图",
        body: "把卡片拖到看板的另一列：Plainva会把新的状态写入这条笔记。",
        props: { status: "进行中", xiangmu: "[[搬到新办公室]]", due: "{{today+7}}" },
      },
      {
        title: "整理发票",
        body: "属于一个还没开始的项目——这是允许的，而且往往很有用。",
        props: { status: "待处理", xiangmu: "[[2026年度报税]]", due: "{{today+14}}" },
      },
      {
        title: "预约理疗",
        body: "已完成。任务仍然是一条笔记；只是它的状态变了。",
        props: { status: "已完成", xiangmu: "[[背部康复计划]]", due: "{{today-2}}" },
      },
      {
        title: "重定向旧域名",
        body: "已完成项目的最后一步。",
        props: { status: "已完成", xiangmu: "[[网站改版]]", due: "{{today-6}}" },
      },
    ],
    resources: [
      {
        title: "办公室搬迁清单",
        body: "资源是供查阅的材料——没有目标，没有截止日期。它们特意不放进任何数据库：不是所有东西都需要行和列。\n\n- [ ] 在银行和保险公司变更地址\n- [ ] 测量网络和打印机的布线",
      },
      {
        title: "PARA与普通文件夹的区别",
        body: "PARA按可执行程度分类：项目会结束，领域会持续，资源是参考资料，归档是其余的一切。一旦笔记的角色发生变化，就把它移到相应的文件夹。",
      },
    ],
    archive: [
      {
        title: "2025年展会",
        body: "这就是归档的样子：一条普通的笔记，只是放在了另一个文件夹里。什么都没有丢失——它只是不再出现在活跃的数据库中。",
      },
    ],
  },
};

const GTD_STRINGS_ZH_CN: GtdStrings = {
  name: "GTD",
  description: "Getting Things Done——收件箱、任务、项目、参考资料和将来清单。",
  folders: {
    inbox: "收件箱",
    tasks: "任务",
    projects: "项目",
    reference: "参考资料",
    someday: "将来清单",
    templates: "模板",
  },
  folderHints: {
    inbox: "所有新事项的收集点——请定期清空。",
    tasks: "单个的下一步行动——按状态和情境组织（任务.base）。",
    projects: "所有需要不止一个步骤的事务（项目.base）。",
    reference: "无需采取行动的查阅材料。",
    someday: "留待以后考虑的想法和项目。",
  },
  welcome: {
    file: "欢迎.md",
    title: "欢迎",
    description: "这个仓库的起点和快速指南。",
    intro: "这个仓库遵循Getting Things Done（David Allen）：一切先进入收件箱，再从那里分流成具体的任务和项目。",
    outro:
      "在任务.base里，你通过每条任务的项目属性把它归入某个项目；项目.base随后会在任务列自动显示每个项目下所包含的内容。每周回顾能让这套系统保持可靠。",
  },
  welcomeSections: { databases: "你的数据库", start: "从这里开始" },
  baseFiles: { tasks: "任务.base", projects: "项目.base" },
  keys: { status: "status", context: "context", project: "xiangmu", due: "due", tasks: "renwu" },
  options: {
    taskStatus: ["收件箱", "下一步", "等待中", "将来", "已完成"],
    context: ["@家里", "@办公", "@外出", "@电话"],
    projectStatus: ["进行中", "等待中", "将来", "已完成"],
  },
  views: { table: "表格", byStatus: "按状态", byContext: "按情境" },
  templates: {
    task: { file: "任务.md", body: "# {{title}}\n\n## 笔记\n\n- [ ] \n" },
    project: { file: "项目.md", body: "# {{title}}\n\n## 预期成果\n\n## 下一步行动\n\n- [ ] \n" },
  },
  review: {
    title: "每周回顾",
    description: "GTD每周回顾的检查清单。",
    body: "- [ ] 清空收件箱\n- [ ] 浏览项目清单并确认下一步行动\n- [ ] 快速浏览将来清单\n- [ ] 查看未来两周的日历",
  },
  samples: {
    projects: [
      {
        title: "厨房翻新",
        body: "预期成果：完成时会是什么样子？在GTD里，只要一件事需要不止一个步骤，它就是项目——哪怕它感觉不像「项目」。",
        props: { status: "进行中" },
      },
      {
        title: "汽车年检",
        body: "等待别人处理——这里是等修理厂回电。因此这个项目在看板中排在第二列。",
        props: { status: "等待中" },
      },
      {
        title: "学西班牙语",
        body: "将来，也许吧。把它放进系统里，就不用一直记在脑子里——但它现在还不需要你的注意力。",
        props: { status: "将来" },
      },
      {
        title: "整理税务文件",
        body: "已完成。完成的项目会一直显示，直到你把它清理掉——数据库跟随文件变化。",
        props: { status: "已完成" },
      },
    ],
    tasks: [
      {
        title: "收集想法",
        body: "刚落入收件箱，还没有处理。在下一次回顾时，这条任务会被赋予情境和项目。",
        props: { status: "收件箱" },
      },
      {
        title: "测量厨房尺寸",
        body: "任务是单个的、具体的下一步行动。通过项目属性，它归属于厨房翻新。",
        props: { status: "下一步", context: "@家里", xiangmu: "[[厨房翻新]]", due: "{{today+2}}" },
      },
      {
        title: "查看木工的报价",
        body: "把卡片拖到看板的另一列：Plainva会把新的状态写入这条笔记。",
        props: { status: "下一步", context: "@办公", xiangmu: "[[厨房翻新]]", due: "{{today+5}}" },
      },
      {
        title: "回电修理厂",
        body: "等待别人处理。@电话这个情境收集了所有你一拿起电话就能一次处理完的事情。",
        props: { status: "等待中", context: "@电话", xiangmu: "[[汽车年检]]" },
      },
      {
        title: "打听附近的语言班",
        body: "属于一个将来项目，跟着它一起等待。这也是一种决定——只是决定现在不做。",
        props: { status: "将来", context: "@外出", xiangmu: "[[学西班牙语]]" },
      },
      {
        title: "扫描去年的发票",
        body: "已完成。任务仍然是一条笔记；只是它的状态变了。",
        props: { status: "已完成", context: "@家里", xiangmu: "[[整理税务文件]]", due: "{{today-4}}" },
      },
    ],
    reference: [
      {
        title: "GTD的两个问题",
        body: "参考资料是不需要采取行动的材料——它刻意不放进任何数据库。\n\n处理收件箱时，你要回答两个问题：这件事可以行动吗？如果可以——那具体的下一步行动是什么？其余的一切，要么是参考资料，要么进将来清单，要么就是垃圾。",
      },
    ],
    someday: [
      {
        title: "去年夏天的相册",
        body: "将来不等于永远不，只是现在还不是时候。每周回顾时你会浏览这份清单——哪一条两次吸引了你的注意，它就会变成一个项目。",
      },
    ],
  },
};

const ZK_STRINGS_ZH_CN: ZettelkastenStrings = {
  name: "Zettelkasten",
  description: "一条笔记一个想法，紧密互联——闪念笔记、文献笔记与永久笔记（Luhmann）。",
  folders: {
    fleeting: "闪念笔记",
    literature: "文献笔记",
    permanent: "永久笔记",
    templates: "模板",
  },
  folderHints: {
    fleeting: "快速记下的原始想法——短暂存在，之后再处理。",
    literature: "用自己的话总结所读内容，并注明出处。",
    permanent: "完整表述、可长期保留的想法——一条笔记一个，且互相紧密链接。",
  },
  welcome: {
    file: "欢迎.md",
    title: "欢迎",
    description: "这个仓库的起点和快速指南。",
    intro:
      "这个仓库遵循Zettelkasten卡片盒方法（Niklas Luhmann）：一条笔记一个想法——联系通过链接产生，而不是通过文件夹层级。",
    outro:
      "用文献.base按阅读状态管理你的资料来源；永久笔记.base通过其来源属性，把永久笔记与它们所依据的文献关联起来。",
  },
  welcomeSections: { databases: "你的数据库", start: "从这里开始" },
  baseFiles: { literature: "文献.base", slips: "永久笔记.base" },
  keys: { author: "author", year: "year", kind: "kind", status: "status", url: "url", slips: "biji", source: "source" },
  options: {
    kind: ["书籍", "文章", "视频", "播客", "网站"],
    status: ["待读", "已读", "已处理"],
  },
  views: { table: "表格", byStatus: "按状态" },
  templates: {
    literature: { file: "文献笔记.md", body: "# {{title}}\n\n## 总结\n\n## 来源\n" },
    slip: { file: "笔记.md", body: "# {{title}}\n\n一个想法，用完整的句子写成。\n\n## 相关笔记\n\n- \n" },
  },
  samples: {
    permanent: [
      {
        title: "一个想法一张笔记",
        body: "一条永久笔记只包含一个想法，用完整的句子、自己的话写成。只有这样，以后才能在不同的语境中重新使用它，而不必回去查阅原文。\n\n延伸阅读：[[用链接代替归类]]和[[写作就是思考]]。",
        props: { source: ["[[Luhmann - 与卡片盒交流]]"] },
      },
      {
        title: "用链接代替归类",
        body: "文件夹迫使每条笔记只能待在一个抽屉里。链接则可以让它出现在任意多个语境中——这正是卡片盒能随时间增值、而不会变得混乱的原因。\n\n对照：[[一个想法一张笔记]]。实际结果：[[入口笔记]]。",
        props: { source: ["[[Luhmann - 与卡片盒交流]]"] },
      },
      {
        title: "写作就是思考",
        body: "如果你能用自己的话把一个想法写出来，说明你已经理解了它；如果不能，说明还没有。把一条文献笔记改写成一张卡片，因此不是抄写，而是真正的思考工作。\n\n另见[[一个想法一张笔记]]。",
        props: { source: ["[[Ahrens - 卡片笔记写作法]]"] },
      },
      {
        title: "入口笔记",
        body: "卡片盒需要入口。一张入口笔记收集你正在推进的各条线索的链接——它不是取代目录，而是一张会不断变化的笔记本身。\n\n线索：[[用链接代替归类]]·[[写作就是思考]]。",
      },
    ],
    literature: [
      {
        title: "Luhmann - 与卡片盒交流",
        body: "用自己的话总结你读到的内容，并记录出处。永久笔记通过来源属性指回这里——笔记列会显示是哪些。",
        props: { author: "Niklas Luhmann", year: 1981, kind: "文章", status: "已处理" },
      },
      {
        title: "Ahrens - 卡片笔记写作法",
        body: "已经读过，但还没有转化成卡片。这正是状态字段的用途：下次查看时，它会告诉你工作停在了哪里。",
        props: { author: "Sönke Ahrens", year: 2017, kind: "书籍", status: "已读" },
      },
      {
        title: "笔记方法播客",
        body: "还没有读——或者说，还没有听。在看板中，这条资料会停留在第一列，直到你动手处理它。",
        props: { kind: "播客", status: "待读" },
      },
    ],
    fleeting: [
      {
        title: "散步时的随手笔记",
        body: "闪念笔记是原始材料：随手写下、不完整、转瞬即逝。经过处理后，它要么变成一张卡片——要么什么都不是，这也没关系。\n\n- 想法：引用比文件夹更有价值\n- 待查：Luhmann那句引言是否准确？",
      },
    ],
  },
};

const ACE_STRINGS_ZH_CN: AceStrings = {
  name: "ACE (Linking Your Thinking)",
  description: "地图集、日历与事务——以MOC为中心的知识管理法，出自Nick Milo。",
  folders: { atlas: "地图集", calendar: "日历", efforts: "事务" },
  folderHints: {
    atlas: "你知识的地图——MOC和概览笔记。",
    calendar: "与时间相关的内容——日记、日志、回顾。",
    efforts: "你正在积极推进的一切事情。",
  },
  welcome: {
    file: "欢迎.md",
    title: "欢迎",
    description: "这个仓库的起点和快速指南。",
    intro:
      "这个仓库使用「Linking Your Thinking」的ACE结构（Nick Milo）：知识通过Maps of Content（MOC，内容地图）互相连接，而不是靠层层嵌套的文件夹。下面的例子都链接自Home笔记——依次点开后，再看看图谱视图。",
    outro:
      "从地图集里的Home笔记开始，从那里把链接延伸到你的知识网络中。MOC本身也只是一条笔记：它可以生长、拆分，也可以再次消失。",
  },
  welcomeSections: { start: "从这里开始" },
  home: {
    title: "Home",
    description: "你最顶层的Map of Content。",
    lead: "Home笔记是你的入口：在这里链接你最重要的Map of Content和当前的事务。没有哪个文件夹能做到这一点——一个文件夹只能把一条笔记归到一个地方。",
    mapsHeading: "地图",
    effortsHeading: "当前事务",
  },
  maps: [
    {
      title: "写作 MOC",
      body: "Map of Content把属于某个主题的内容收集起来，用你自己的话加以整理。它不能取代目录——它是你在某个时间点对一个主题的看法。",
      leads: "从这里继续：",
    },
    {
      title: "花园 MOC",
      body: "MOC也可以指向地图集之外：这张地图通向一件正在进行的事务。正是这种交叉链接才是关键所在。",
      leads: "从这里继续：",
    },
  ],
  samples: {
    atlas: [
      {
        title: "为什么用地图而不是文件夹",
        body: "文件夹回答的是「它放在哪里？」。地图回答的是「什么内容属于一起，为什么？」——而且同一条笔记可以出现在多张地图上。\n\n回到地图：[[写作 MOC]]。",
      },
    ],
    efforts: [
      {
        title: "搭建花园苗床",
        body: "事务（Effort）是你正在做、并且有可预见结束时间的事情。它刻意不放在地图集里：地图集是给长期存在的内容用的。\n\n- [ ] 确定尺寸\n- [ ] 采购木材\n\n属于[[花园 MOC]]。",
      },
    ],
    calendar: [
      {
        title: "{{today}}",
        body: "与时间相关的内容属于日历文件夹：日记、回顾，一切与某个日期相关、而不是与某个主题相关的内容。\n\n今天看过：[[为什么用地图而不是文件夹]]。",
      },
    ],
  },
};

const JD_STRINGS_ZH_CN: JdStrings = {
  name: "Johnny.Decimal",
  description: "编号区域与类别（10-19 / 11 / 11.01），让一切都有据可查。",
  folders: {
    system: "00-09 系统",
    systemIndex: "00 索引",
    personal: "10-19 个人",
    finance: "11 财务",
    health: "12 健康",
    work: "20-29 工作",
    projects: "21 项目",
    meetings: "22 会议",
  },
  folderHints: {
    system: "系统本身的管理——索引和约定。",
    personal: "个人主题的示例区域。",
    work: "工作主题的示例区域。",
  },
  welcome: {
    file: "欢迎.md",
    title: "欢迎",
    description: "这个仓库的起点和快速指南。",
    intro:
      "这个仓库按照Johnny.Decimal方法组织：最多十个区域（10-19、20-29……），每个区域下最多十个类别（11、12……）——每条笔记会得到一个像11.01这样的编号。下面的例子展示了它的样子。",
    outro:
      "把区域和类别重命名为你自己的主题——刻意受限的层级深度（区域→类别→编号）正是这个方法的核心。编号一旦分配就不会重复使用，即使对应的笔记已经不存在。",
  },
  welcomeSections: { start: "从这里开始" },
  index: {
    id: "00.00",
    title: "索引",
    description: "Johnny.Decimal索引：所有编号汇总在一处。",
    lead: "在这里维护所有区域、类别和编号的清单。想查找编号的人应该先看这里——不在索引里的编号，就等于不存在。",
  },
  samples: [
    {
      id: "11.01",
      title: "家庭预算",
      body: "类别11下的第一条笔记编号为01，下一条为02，依此类推。即使重命名这条笔记，编号也保持不变。",
    },
    {
      id: "21.01",
      title: "网站改版",
      body: "一整个项目同样只会得到一个编号。所有与它相关的内容都指向这个编号，而不是消失在专属的子文件夹里。",
    },
    {
      id: "22.01",
      title: "网站启动会",
      body: "会议记录单独作为一个类别，这样就不会占用项目的编号。这一条属于[[21.01 网站改版]]。",
    },
  ],
};

const JOURNAL_STRINGS_ZH_CN: JournalStrings = {
  name: "Journal",
  description: "配有现成模板和日记数据库的每日笔记——一切都已即时预先设置好。",
  folders: { journal: "日记", templates: "模板" },
  folderHints: {
    journal: "你的日记，一天一篇。",
    templates: "新笔记使用的模板——日记模板已经配置好。",
  },
  welcome: {
    file: "欢迎.md",
    title: "欢迎",
    description: "这个仓库的起点和快速指南。",
    intro:
      "这个仓库专为每日写作而设计：日记保存在日记文件夹中，并根据模板文件夹里的模板创建。已经有两天的示例内容——今天和昨天。",
    outro:
      "打开右侧边栏的日历，点击某一天即可创建下一篇日记。日记.base会把你的条目显示为表格并呈现在日历上——带有日期、心情和标签。",
  },
  welcomeSections: { databases: "你的数据库", start: "从这里开始" },
  baseFile: "日记.base",
  keys: { date: "riqi", mood: "xinqing", tags: "biaoqian" },
  moods: ["不错", "一般", "糟糕", "高效", "疲惫"],
  views: { table: "表格", calendar: "日历" },
  template: {
    file: "日记模板.md",
    description: "新日记的模板——{{date}}、{{time}}和{{title}}会被替换。",
    body: "# {{title}}\n\n## 笔记\n\n## 任务\n\n- [ ] \n",
  },
  samples: [
    {
      offset: 0,
      mood: "高效",
      tags: ["工作", "写作"],
      body: "这就是一篇日记条目的样子。心情和标签保存在frontmatter里——因此日记.base能据此排序和筛选，而不需要你重复维护。\n\n## 笔记\n\n- 右侧边栏的日历可以带你跳到任意一天。\n\n## 任务\n\n- [x] 写下第一篇日记\n- [ ] 明天再回来",
    },
    {
      offset: -1,
      mood: "疲惫",
      tags: ["日常"],
      body: "简短的一条也是一篇日记。随着时间推移，真正有意思的不是某一天，而是它们连成的一串——按日期排序的表格视图正是为此而设。\n\n## 笔记\n\n- 没做太多事，但提早收工了。",
    },
  ],
};

export function templates(): VaultTemplateDefinition[] {
  return [
    buildPlainvaTour(TOUR_STRINGS_ZH_CN),
    buildPara(PARA_STRINGS_ZH_CN),
    buildZettelkasten(ZK_STRINGS_ZH_CN),
    buildAce(ACE_STRINGS_ZH_CN),
    buildJd(JD_STRINGS_ZH_CN),
    buildGtd(GTD_STRINGS_ZH_CN),
    buildJournal(JOURNAL_STRINGS_ZH_CN),
    buildProject(PROJECT_STRINGS_ZH_CN),
  ];
}
