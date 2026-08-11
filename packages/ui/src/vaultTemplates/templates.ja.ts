import type { VaultTemplateDefinition } from "./types";
import { buildPlainvaTour, type TourStrings } from "./plainvaTour";
import { buildPara, type ParaStrings } from "./paraTemplate";
import { buildGtd, type GtdStrings } from "./gtdTemplate";
import { buildZettelkasten, type ZettelkastenStrings } from "./zettelkastenTemplate";
import { buildProject, PROJECT_STRINGS_JA } from "./projectTemplate";
import { buildAce, type AceStrings } from "./aceTemplate";
import { buildJd, type JdStrings } from "./jdTemplate";
import { buildJournal, type JournalStrings } from "./journalTemplate";

/** Japanese template set — folder/file names follow the app language.
 *
 * PARA, GTD, Zettelkasten and Journal additionally ship pre-wired `.base`
 * databases (Gesamtplan DB-Vorlagen 2026-07-04); ACE and Johnny.Decimal stay
 * link-/folder-based on purpose. Database column KEYS are kept ASCII/romaji;
 * option VALUES, view names and `.base` file names are fully localized.
 * Relation columns and their reverse counterparts are wired here so the
 * databases show real data as soon as the vault is indexed. */

const CHEAT_SHEET_JA = `以下はすべて普通のMarkdownです。ツールバーで閲覧モードと編集モードを切り替えられます——エディタは、カーソルがある場所でだけ書式記号を表示します。

> [!tip] コールアウト
> 引用は \`> [!tip]\` で始めます。他にも種類があります: note, warning, danger, example, question。

## テーブル

| ショートカット | 機能 |
| --- | --- |
| \`Mod+P\` | コマンドパレット |
| \`Mod+O\` | クイックスイッチャー |
| \`F1\` | すべてのキーボードショートカット |

## ダイアグラム

\`\`\`mermaid
flowchart LR
  A[クイックメモ] --> B[タスク]
  B --> C[プロジェクト]
  C --> D[エリア]
\`\`\`

## 数式

インライン: $E = mc^2$

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

## 画像

![[添付ファイル/skizze.svg]]

## タスクとハイライト

- [x] 完了したこと
- [ ] ==マークしておきたいこと== #tour

リンクはノートを指します: [[ウェブサイトのリニューアル]] と [[仕事]]。

脚注も使えます。[^1]

[^1]: こんなふうに。
`;

const TOUR_STRINGS_JA: TourStrings = {
  name: "Plainva ツアー",
  description: "ガイド付きの保管庫: ピンボード、デイリーノート、エリア、プロジェクト、タスク——Plainvaが提供するすべてのビューを、例で満たしています。",
  folders: {
    quickNotes: "クイックメモ",
    journal: "ジャーナル",
    areas: "エリア",
    projects: "プロジェクト",
    tasks: "タスク",
    resources: "リソース",
    archive: "アーカイブ",
    attachments: "添付ファイル",
    templates: "テンプレート",
  },
  folderHints: {
    quickNotes: "まだ行き先が決まっていないもの——ピンボードとして表示されます。",
    journal: "1日1件のノート——カレンダーで表示されます。",
    areas: "終わりのない継続的な責任範囲——ギャラリーとして表示されます。",
    projects: "終わりのある取り組み——ボードとタイムラインで管理します。",
    tasks: "標準のタスクデータベースです——ボードとテーブル。",
    resources: "残しておきたい資料です。",
    archive: "完了した作業です。ここへ移すと、アクティブなビューから外れます。",
    attachments: "画像やファイルです。",
    templates: "ノートテンプレートです——それぞれ対応するデータベースに紐づいています。",
  },
  welcome: {
    file: "はじめに.md",
    title: "Plainvaへようこそ",
    intro:
      "この保管庫はツアーです。以下の各フォルダーには例がたくさん入っていて、それぞれのデータベースが異なるビューを見せてくれます——開いて自由に変更してみてください。ここにあるものはどれも大切にする必要はありません。",
    outro:
      "見えているものはすべて、このフォルダーの中の普通のMarkdownです。不要なものは削除し、残りは自分の好きな名前に変更すれば、この保管庫はあなたのものになります。",
  },
  templates: {
    project: { file: "プロジェクト.md", body: "# {{title}}\n\n## 目標\n\n## 次のステップ\n\n- [ ] \n" },
    task: { file: "タスク.md", body: "# {{title}}\n\n" },
    area: { file: "エリア.md", body: "# {{title}}\n\n## 理想の状態\n\n" },
    resource: { file: "リソース.md", body: "# {{title}}\n\n## 残す理由\n\n" },
    quickNote: { file: "クイックメモ.md", body: "# {{title}}\n\n" },
    daily: {
      file: "デイリーノート.md",
      description: "新規デイリーノート用のテンプレートです——{{date}}、{{time}}、{{daily±1}}はノート作成時に置き換えられます。",
      body: "# {{title}}\n\n{{daily-1}} · {{date:dddd}} · {{daily+1}}\n\n## タスク\n\n- [ ] \n\n## ノート\n\n{{cursor}}\n",
    },
    meeting: {
      file: "ミーティング.md",
      description: "どのデータベースにも割り当てられていません——「すべてのテンプレートを表示」に表示されます。1つのダイアログで3つの質問をします。",
      body: "# {{title}}\n\n**種類:** {{select:種類|週次,1on1,ワークショップ,レビュー}}\n**日付:** {{date_prompt:ミーティングの日付}}\n**参加者:** {{prompt:参加者|自分}}\n\n## アジェンダ\n\n{{cursor}}\n\n## 決定事項\n\n## タスク\n\n- [ ] \n",
    },
  },
  baseFiles: {
    areas: "エリア.base",
    projects: "プロジェクト.base",
    tasks: "タスク.base",
    resources: "リソース.base",
    quickNotes: "クイックメモ.base",
    journal: "ジャーナル.base",
    archive: "アーカイブ.base",
  },
  keys: {
    focus: "focus", cover: "cover", projects: "projects",
    status: "status", area: "area", start: "start", end: "end", tasks: "tasks",
    done: "done", project: "project", due: "due", priority: "priority",
    date: "date", mood: "mood", topics: "topics",
    kind: "kind", url: "url", readStatus: "read",
    finished: "finished",
  },
  options: {
    projectStatus: ["予定", "進行中", "待機中", "完了"],
    taskStatus: ["未着手", "進行中", "完了"],
    priority: ["高", "中", "低"],
    mood: ["良い", "普通", "大変", "生産的"],
    resourceKind: ["書籍", "記事", "動画", "ツール", "リファレンス"],
    resourceStatus: ["未読", "既読"],
  },
  views: {
    table: "テーブル", board: "ボード", timeline: "タイムライン", gallery: "ギャラリー",
    list: "リスト", tree: "ツリー", calendar: "カレンダー", pinboard: "ピンボード",
  },
  subItems: { parent: "親アイテム", children: "サブアイテム" },
  welcomeSections: { databases: "データベース", start: "はじめの一歩" },
  samples: {
    areas: [
      { title: "仕事", body: "報酬をもらっているすべてのこと。ここにあるプロジェクトには締め切りがあります。", icon: "💼", color: "#2a7f7b", props: { focus: "残業せずにやり遂げる", cover: "添付ファイル/cover.svg" } },
      { title: "家庭", body: "住まい、書類仕事、動かし続けなければならないこと。", icon: "🏠", color: "#8a6d3b", props: { focus: "期限切れをゼロにする", cover: "添付ファイル/cover.svg" } },
      { title: "健康", body: "睡眠、運動、食事——地味だけど、他のすべてを左右すること。", icon: "🌱", color: "#3d7f4a", props: { focus: "週3回" } },
      { title: "学び", body: "来年もっとうまくなりたいこと。", icon: "📚", color: "#5a5a8a", props: { focus: "月1冊" } },
    ],
    projects: [
      { title: "ウェブサイトのリニューアル", body: "新しいスタートページとより分かりやすい構成。\n\n[[仕事]] を参照。", props: { status: "進行中", area: "[[仕事]]", start: "{{today-6}}", end: "{{today+9}}" } },
      { title: "新オフィスへの移転", body: "小さい部屋に、同じデスクで。", props: { status: "予定", area: "[[仕事]]", start: "{{today+4}}", end: "{{today+13}}" } },
      { title: "確定申告", body: "領収書を2枚待っています。", props: { status: "待機中", area: "[[家庭]]", start: "{{today-3}}", end: "{{today+6}}" } },
      { title: "マラソン計画", body: "12週間、週3回のランニング。\n\n[[健康]] に属します。", props: { status: "完了", area: "[[健康]]", start: "{{today-12}}", end: "{{today-2}}" } },
    ],
    tasks: [
      { title: "スタートページを下書きする", body: "2案作って、それから決める。", props: { done: false, status: "進行中", project: "[[ウェブサイトのリニューアル]]", due: "{{today+1}}", priority: "高" } },
      { title: "フィードバックを集める", body: "3人、それぞれ15分。", props: { done: false, status: "未着手", project: "[[ウェブサイトのリニューアル]]", due: "{{today+5}}", priority: "中", parent: "[[スタートページを下書きする]]" } },
      { title: "テキストを書く", body: "短い文で。", props: { done: false, status: "未着手", project: "[[ウェブサイトのリニューアル]]", due: "{{today+7}}", priority: "中" } },
      { title: "古いページを整理する", body: "", props: { done: true, status: "完了", project: "[[ウェブサイトのリニューアル]]", due: "{{today-2}}", priority: "低" } },
      { title: "新しい部屋の寸法を測る", body: "デスクは160cm。", props: { done: false, status: "未着手", project: "[[新オフィスへの移転]]", due: "{{today+3}}", priority: "中" } },
      { title: "段ボールを注文する", body: "", props: { done: false, status: "未着手", project: "[[新オフィスへの移転]]", due: "{{today+8}}", priority: "低" } },
      { title: "領収書を依頼する", body: "メールで、手短に。", props: { done: false, status: "進行中", project: "[[確定申告]]", due: "{{today}}", priority: "高" } },
      { title: "理学療法の予約を取る", body: "", props: { done: true, status: "完了", project: "[[マラソン計画]]", due: "{{today-4}}", priority: "中" } },
      { title: "来シーズンの計画を立てる", body: "短い距離で、睡眠は多めに。", props: { done: false, status: "未着手", due: "{{today+11}}", priority: "低" } },
    ],
    quickNotes: [
      { title: "はじめにお読みください", body: "このボードのカードは、ごく普通のノートです。動かしたり、ピン留めしたり、色を付けたり——あるいは全部消してしまってもかまいません。\n\n#tour", pinned: true, color: "#2a7f7b" },
      { title: "買い物", body: "- [ ] コーヒー\n- [ ] オリーブオイル\n- [x] パン\n\n#家庭", color: "#8a6d3b" },
      { title: "読書会のアイデア", body: "月に一度、一冊の本、スライドなし。\n\n#アイデア" },
      { title: "名言", body: "> 二度と見つけられないノートは、書かれなかったのと同じ。\n\n#名言", color: "#5a5a8a" },
      { title: "スケッチ", body: "下の画像は添付ファイルフォルダーに入っています。\n\n![[添付ファイル/skizze.svg]]\n\n#tour", pinned: true },
      { title: "キーボード", body: "`Mod+P` でコマンドパレットを開き、`F1` ですべてのショートカットを一覧表示します。\n\n#tour" },
    ],
    journal: [
      { title: "{{today}}", body: "ツアーを始めた。リストよりボードの方が分かりやすい。\n\n[[スタートページを下書きする]] に取り組んだ。", props: { date: "{{today}}", mood: "生産的", topics: ["tour"] } },
      { title: "{{today-1}}", body: "静かな一日。[[確定申告]] の書類を整理した。", props: { date: "{{today-1}}", mood: "普通", topics: ["家庭"] } },
    ],
    resources: [
      { title: "Markdown 早見表", body: CHEAT_SHEET_JA, props: { kind: "リファレンス", read: "既読", cover: "添付ファイル/cover.svg" } },
      { title: "Plainva ハンドブック", body: "完全なガイドは plainva.com/docs にあります。", props: { kind: "リファレンス", url: "https://plainva.com/docs", read: "未読" } },
      { title: "Deep work", body: "Cal Newport 著。スケジューリングについての章が特に役立つ。", props: { kind: "書籍", read: "未読", area: "[[学び]]" } },
      { title: "キーボードショートカット", body: "Plainvaで `F1` を押す——一覧は検索できます。", props: { kind: "リファレンス", read: "既読", area: "[[学び]]" } },
    ],
    archive: [
      { title: "旧ウェブサイト", body: "[[ウェブサイトのリニューアル]] に置き換えられました。テキストのために保存しています。", props: { finished: "{{today-20}}" } },
    ],
  },
};

const PARA_STRINGS_JA: ParaStrings = {
  name: "PARA",
  description: "プロジェクト、エリア、リソース、アーカイブ——行動との近さで分類する手法（Tiago Forte）。",
  folders: {
    projects: "プロジェクト",
    tasks: "タスク",
    areas: "エリア",
    resources: "リソース",
    archive: "アーカイブ",
    templates: "テンプレート",
  },
  folderHints: {
    projects: "明確な目標と終了日を持つ取り組みです（プロジェクト.base）。",
    tasks: "単一の次のステップ——それぞれ自分のプロジェクトを指します（タスク.base）。",
    areas: "終了日のない、継続的な責任範囲です。",
    resources: "参照するためのテーマ、資料、知識です。",
    archive: "他のフォルダーから来た、完了・非アクティブなものです。",
  },
  welcome: {
    file: "はじめに.md",
    description: "この保管庫の出発点となる簡単なガイドです。",
    title: "はじめに",
    intro:
      "この保管庫はPARAメソッド（Tiago Forte）に沿って整理されています。内容はテーマではなく、行動との近さによって分類されます。以下の例は実際のノートです——自由に変更したり、移動したり、削除したりしてください。",
    outro:
      "データベースを開くと、プロジェクトをステータス別に確認し、タスクを割り当て、それぞれのエリアに関連付けられます——完了したものはアーカイブへ移り、リンクとindex.mdの一覧はPlainvaが自動的に最新の状態に保ちます。",
  },
  welcomeSections: { databases: "データベース", start: "はじめの一歩" },
  baseFiles: { projects: "プロジェクト.base", tasks: "タスク.base", areas: "エリア.base" },
  keys: { status: "status", area: "area", due: "due", tasks: "tasks", project: "project", projects: "projects" },
  options: {
    projectStatus: ["予定", "進行中", "待機中", "完了"],
    taskStatus: ["未着手", "進行中", "完了"],
  },
  views: { table: "テーブル", byStatus: "ステータス別" },
  templates: {
    project: { file: "プロジェクト.md", body: "# {{title}}\n\n## 目標\n\n## 次のステップ\n\n- [ ] \n" },
    task: { file: "タスク.md", body: "# {{title}}\n\n## ノート\n\n- [ ] \n" },
  },
  samples: {
    areas: [
      {
        title: "チーム",
        body: "エリアは終了日のない継続的な責任です。プロジェクトは「エリア」プロパティを通じてここに関連付けられます——エリア.baseのテーブルには、それが反映されて表示されます。",
      },
      { title: "財務", body: "経理、契約、保険。進行中のプロジェクトがなくても、これは続いていきます。" },
      { title: "健康", body: "終わりを迎えるのではなく、継続的な注意を必要とするすべてのことです。" },
    ],
    projects: [
      {
        title: "確定申告2026",
        body: "プロジェクトには明確な目標と見通せる終わりがあります。これはまだ着手していない予定の状態です——だからボードの最初の列に置かれています。",
        props: { status: "予定", area: "[[財務]]", due: "{{today+45}}" },
      },
      {
        title: "新オフィスへの移転",
        body: "アクティブな例です。以下のタスクは「プロジェクト」プロパティを通じてここを指しており、プロジェクト.baseはそれらを「タスク」列に反映して表示します。\n\n- [ ] プロジェクトの目標を記録する\n- [ ] 次のステップを決める",
        props: { status: "進行中", area: "[[チーム]]", due: "{{today+21}}" },
      },
      {
        title: "腰痛改善プログラム",
        body: "自分ではコントロールできない何か——ここでは予約待ち——を待っている状態です。まさにそのために3番目の列があります。",
        props: { status: "待機中", area: "[[健康]]", due: "{{today+10}}" },
      },
      {
        title: "ウェブサイトのリニューアル",
        body: "完了しました。完了したプロジェクトはアーカイブへ移すまで表示され続けます——データベースはファイルに追従します。",
        props: { status: "完了", area: "[[チーム]]", due: "{{today-5}}" },
      },
    ],
    tasks: [
      {
        title: "引っ越し業者の見積もりを取る",
        body: "タスクは単一の具体的な次のステップです。",
        props: { status: "未着手", project: "[[新オフィスへの移転]]", due: "{{today+3}}" },
      },
      {
        title: "旧オフィスの解約予告期間を確認する",
        body: "着手したが、まだ完了していません——ボードの中央の列です。",
        props: { status: "進行中", project: "[[新オフィスへの移転]]", due: "{{today+1}}" },
      },
      {
        title: "チームとフロアプランを調整する",
        body: "カードをボードの別の列にドラッグしてみましょう。Plainvaが新しいステータスをノートに書き込みます。",
        props: { status: "進行中", project: "[[新オフィスへの移転]]", due: "{{today+7}}" },
      },
      {
        title: "領収書を整理する",
        body: "まだ着手していないプロジェクトに属しています——これは問題ありませんし、しばしば有用です。",
        props: { status: "未着手", project: "[[確定申告2026]]", due: "{{today+14}}" },
      },
      {
        title: "理学療法の予約を取る",
        body: "完了しました。タスクはノートとして残ります——変わったのはステータスだけです。",
        props: { status: "完了", project: "[[腰痛改善プログラム]]", due: "{{today-2}}" },
      },
      {
        title: "旧ドメインをリダイレクトする",
        body: "完了したプロジェクトの最後のステップです。",
        props: { status: "完了", project: "[[ウェブサイトのリニューアル]]", due: "{{today-6}}" },
      },
    ],
    resources: [
      {
        title: "オフィス移転チェックリスト",
        body: "リソースは参照するための資料です——目標も終了日もありません。あえてどのデータベースにも属していません。すべてが行・列を必要とするわけではないからです。\n\n- [ ] 銀行と保険会社での住所変更\n- [ ] ネットワークとプリンターの設置",
      },
      {
        title: "PARAとフォルダーの違い",
        body: "PARAは行動との近さで分類します。プロジェクトには終わりがあり、エリアは継続し、リソースは参照資料であり、アーカイブはそれ以外のすべてです。役割が変わったら、ノートをフォルダー間で移動しましょう。",
      },
    ],
    archive: [
      {
        title: "見本市2025",
        body: "アーカイブされたものはこう見えます——ごく普通のノートが、別のフォルダーに入っているだけです。何も失われていません——アクティブなデータベースに表示されなくなるだけです。",
      },
    ],
  },
};

const GTD_STRINGS_JA: GtdStrings = {
  name: "GTD",
  description: "Getting Things Done——インボックス、タスク、プロジェクト、リファレンス、「いつか/たぶん」リスト。",
  folders: {
    inbox: "インボックス",
    tasks: "タスク",
    projects: "プロジェクト",
    reference: "リファレンス",
    someday: "いつか/たぶん",
    templates: "テンプレート",
  },
  folderHints: {
    inbox: "入ってくるすべてのものの集積場所です——定期的に空にしましょう。",
    tasks: "単一の次のアクション——ステータスとコンテキストで整理します（タスク.base）。",
    projects: "複数のステップが必要なものすべてです（プロジェクト.base）。",
    reference: "行動を必要としない、参照用の資料です。",
    someday: "後回しにするアイデアや構想です。",
  },
  welcome: {
    file: "はじめに.md",
    title: "はじめに",
    description: "この保管庫の出発点となる簡単なガイドです。",
    intro:
      "この保管庫はGetting Things Done（David Allen）に従っています。すべてはまずインボックスに入り、そこから具体的なタスクやプロジェクトへと処理されます。以下の例は実際のノートです——処理したり、移動したり、削除したりしてください。",
    outro:
      "タスク.baseでは、各タスクを「プロジェクト」プロパティを通じてプロジェクトに割り当てます。すると、プロジェクト.baseの「タスク」列に、各プロジェクトに属するものが自動的に表示されます。週次レビューがシステムの信頼性を保ちます。",
  },
  welcomeSections: { databases: "データベース", start: "はじめの一歩" },
  baseFiles: { tasks: "タスク.base", projects: "プロジェクト.base" },
  keys: { status: "status", context: "context", project: "project", due: "due", tasks: "tasks" },
  options: {
    taskStatus: ["インボックス", "次のアクション", "待機中", "いつか", "完了"],
    context: ["@自宅", "@職場", "@外出", "@電話"],
    projectStatus: ["進行中", "待機中", "いつか", "完了"],
  },
  views: { table: "テーブル", byStatus: "ステータス別", byContext: "コンテキスト別" },
  templates: {
    task: { file: "タスク.md", body: "# {{title}}\n\n## ノート\n\n- [ ] \n" },
    project: { file: "プロジェクト.md", body: "# {{title}}\n\n## 望ましい結果\n\n## 次のステップ\n\n- [ ] \n" },
  },
  review: {
    title: "週次レビュー",
    description: "GTDの週次レビュー用チェックリストです。",
    body: "- [ ] インボックスを空にする\n- [ ] プロジェクトリストを見直し、次のアクションを確認する\n- [ ] 「いつか/たぶん」リストにざっと目を通す\n- [ ] 今後2週間のカレンダーを確認する",
  },
  samples: {
    projects: [
      {
        title: "キッチンをリフォームする",
        body: "望ましい結果: これが完了したとき、何が実現しているか？GTDでは1つ以上のステップが必要なものはすべてプロジェクトです——「プロジェクト」らしく感じられないものも含めて。",
        props: { status: "進行中" },
      },
      {
        title: "車の点検",
        body: "他の誰かからの連絡待ちです——ここでは整備工場からの折り返しの電話です。だからこのプロジェクトはボードの2番目の列にあります。",
        props: { status: "待機中" },
      },
      {
        title: "スペイン語を学ぶ",
        body: "いつか、たぶん。頭の中ではなくシステムの中に置いておくためのものです——ただし今すぐ注意を必要としているわけではありません。",
        props: { status: "いつか" },
      },
      {
        title: "確定申告の書類を整理する",
        body: "完了しました。完了したプロジェクトは、片付けるまで表示され続けます——データベースはファイルに追従します。",
        props: { status: "完了" },
      },
    ],
    tasks: [
      {
        title: "アイデアを集める",
        body: "インボックスに入ったばかりで、まだ処理されていません。次のレビューで、このタスクにコンテキストとプロジェクトが割り当てられます。",
        props: { status: "インボックス" },
      },
      {
        title: "キッチンの寸法を測る",
        body: "タスクは単一の具体的な次のアクションです。「プロジェクト」プロパティを通じて、このリフォームに属しています。",
        props: { status: "次のアクション", context: "@自宅", project: "[[キッチンをリフォームする]]", due: "{{today+2}}" },
      },
      {
        title: "大工の見積もりを確認する",
        body: "カードをボードの別の列にドラッグしてみましょう。Plainvaが新しいステータスをノートに書き込みます。",
        props: { status: "次のアクション", context: "@職場", project: "[[キッチンをリフォームする]]", due: "{{today+5}}" },
      },
      {
        title: "整備工場に折り返し電話する",
        body: "他の誰かからの連絡待ちです。@電話というコンテキストは、電話を手にしたときに一気に片付けられることをまとめて集めます。",
        props: { status: "待機中", context: "@電話", project: "[[車の点検]]" },
      },
      {
        title: "近くの語学講座を探す",
        body: "「いつか」プロジェクトに属し、それとともに待機しています。それもまた1つの決断です——今はやらない、という決断です。",
        props: { status: "いつか", context: "@外出", project: "[[スペイン語を学ぶ]]" },
      },
      {
        title: "昨年の領収書をスキャンする",
        body: "完了しました。タスクはノートとして残ります——変わったのはステータスだけです。",
        props: { status: "完了", context: "@自宅", project: "[[確定申告の書類を整理する]]", due: "{{today-4}}" },
      },
    ],
    reference: [
      {
        title: "GTDの2つの問い",
        body: "リファレンスは、行動する必要のない資料です——あえてどのデータベースにも属していません。\n\nインボックスを処理するとき、あなたは2つの問いに答えます: それは行動可能か？もしそうなら——具体的な次のアクションは何か？それ以外はすべて、リファレンス、いつか、またはごみ箱行きです。",
      },
    ],
    someday: [
      {
        title: "去年の夏のフォトブック",
        body: "「いつか」は「二度とやらない」という意味ではなく、「今ではない」という意味です。週次レビューでこのリストにざっと目を通します——2回目を引くものは、プロジェクトになります。",
      },
    ],
  },
};

const ZK_STRINGS_JA: ZettelkastenStrings = {
  name: "Zettelkasten",
  description: "1ノート1アイデアを密に結びつける手法——フリーティングノート、文献ノート、パーマネントノート（Luhmann）。",
  folders: {
    fleeting: "フリーティングノート",
    literature: "文献ノート",
    permanent: "パーマネントノート",
    templates: "テンプレート",
  },
  folderHints: {
    fleeting: "素早く書き留めた未整理の考え——一時的なもので、後で処理します。",
    literature: "読んだ内容を自分の言葉でまとめたもの。出典付きです。",
    permanent: "自分の言葉で丁寧に書かれた、長く残るアイデア——1ノートに1つ、他のノートと密にリンクします。",
  },
  welcome: {
    file: "はじめに.md",
    title: "はじめに",
    description: "この保管庫の出発点となる簡単なガイドです。",
    intro:
      "この保管庫はZettelkasten（Niklas Luhmann）の手法に従っています。1つのノートに1つのアイデアだけを書き、つながりはフォルダー階層ではなくリンクから生まれます。以下のスリップは互いにリンクしています。それらをたどってから、グラフを見てみましょう。",
    outro:
      "文献.baseでは出典を読書ステータスごとに管理できます。スリップ.baseはパーマネントノートを、その「出典」プロパティを通じて元となった文献に結びつけます。",
  },
  welcomeSections: { databases: "データベース", start: "はじめの一歩" },
  baseFiles: { literature: "文献.base", slips: "スリップ.base" },
  keys: { author: "author", year: "year", kind: "kind", status: "status", url: "url", slips: "slips", source: "source" },
  options: {
    kind: ["書籍", "記事", "動画", "ポッドキャスト", "ウェブサイト"],
    status: ["未読", "既読", "処理済み"],
  },
  views: { table: "テーブル", byStatus: "ステータス別" },
  templates: {
    literature: { file: "文献ノート.md", body: "# {{title}}\n\n## 要約\n\n## 出典\n" },
    slip: { file: "スリップ.md", body: "# {{title}}\n\n1つのアイデアを、完全な文章で。\n\n## 関連スリップ\n\n- \n" },
  },
  samples: {
    permanent: [
      {
        title: "1つのスリップに1つの思考",
        body: "パーマネントノートには、ちょうど1つのアイデアだけを、完全な文章で自分の言葉で書きます。そうして初めて、後で元のノートを探さなくても、別の文脈で再利用できるようになります。\n\n次へ: [[整理するのではなくリンクする]] と [[書くことは考えることだ]]。",
        props: { source: ["[[Luhmann - スリップボックスによるコミュニケーション]]"] },
      },
      {
        title: "整理するのではなくリンクする",
        body: "フォルダーはすべてのノートを、ちょうど1つの引き出しに押し込みます。リンクは、それが属するだけ多くの文脈に存在することを許します——だからこそ、スリップボックスは時間とともに手に負えなくなるのではなく、価値を増していくのです。\n\n対をなすもの: [[1つのスリップに1つの思考]]。実践的な帰結: [[入口となるスリップ]]。",
        props: { source: ["[[Luhmann - スリップボックスによるコミュニケーション]]"] },
      },
      {
        title: "書くことは考えることだ",
        body: "自分の言葉でアイデアを書けるなら、それを理解しているということです。書けないなら、まだ理解していないのです。文献ノートをスリップへと書き直すことは、だから単なる転記ではありません——それこそが本当の作業なのです。\n\n関連: [[1つのスリップに1つの思考]]。",
        props: { source: ["[[Ahrens - スマートノートの取り方]]"] },
      },
      {
        title: "入口となるスリップ",
        body: "スリップボックスには入口が必要です。入口となるスリップは、今取り組んでいる糸口へのリンクを集めます——それは目次の代わりではなく、それ自体が変わり続ける1枚のスリップです。\n\n糸口: [[整理するのではなくリンクする]] · [[書くことは考えることだ]]。",
      },
    ],
    literature: [
      {
        title: "Luhmann - スリップボックスによるコミュニケーション",
        body: "読んだ内容を自分の言葉で要約し、出典を記録します。パーマネントノートは「出典」プロパティを通じてここを参照します——「スリップ」列に、それがどれかが表示されます。",
        props: { author: "Niklas Luhmann", year: 1981, kind: "記事", status: "処理済み" },
      },
      {
        title: "Ahrens - スマートノートの取り方",
        body: "読んだが、まだスリップに書き直していません。それこそがステータスの役割です——次に見たとき、作業がどこで止まっていたかを教えてくれます。",
        props: { author: "Sönke Ahrens", year: 2017, kind: "書籍", status: "既読" },
      },
      {
        title: "ノート術についてのポッドキャスト",
        body: "まだ読んでいません——あるいは聴いていません。ボードでは、このソースは手をつけるまで最初の列にあります。",
        props: { kind: "ポッドキャスト", status: "未読" },
      },
    ],
    fleeting: [
      {
        title: "散歩中のメモ",
        body: "フリーティングノートは生の素材です: 走り書きで、不完全で、短命です。処理すると、それはスリップになるか——あるいは何にもならず、それもまた構いません。\n\n- アイデア: 参照はフォルダーより価値がある\n- 確認: そのLuhmannの引用は正確か？",
      },
    ],
  },
};

// ACE and Johnny.Decimal stayed inline objects the longest; the samples below
// are new (the old inline blocks carried a welcome note and nothing else), so
// the prose is fresh, but every folder name, welcome sentence and folder hint
// that already existed in this file's earlier inline blocks is reused
// verbatim — see the git history of this file for the source.
const ACE_STRINGS_JA: AceStrings = {
  name: "ACE (Linking Your Thinking)",
  description: "アトラス、カレンダー、エフォート——Nick Miloが提唱するMOC中心の知識管理手法。",
  folders: { atlas: "アトラス", calendar: "カレンダー", efforts: "エフォート" },
  folderHints: {
    atlas: "あなたの知識の地図——MOCとまとめノートです。",
    calendar: "時間に結びついたもの——デイリーノート、日記、振り返りです。",
    efforts: "現在積極的に取り組んでいるすべてのことです。",
  },
  welcome: {
    file: "はじめに.md",
    title: "はじめに",
    description: "この保管庫の出発点となる簡単なガイドです。",
    intro:
      "この保管庫は「Linking Your Thinking」（Nick Milo）のACEスキームを採用しています。知識は深い階層ではなく、Maps of Content（MOC）によって結びつけられます。以下の例はすべてHomeノートにつながっています——クリックしてたどったら、グラフも見てみましょう。",
    outro:
      "アトラスのHomeノートから始めて、そこから自分の知識へリンクを広げていきましょう。MOCそのものもただのノートです——育ち、分裂し、また消えていってかまいません。",
  },
  welcomeSections: { start: "はじめの一歩" },
  home: {
    title: "Home",
    description: "最上位のMap of Contentです。",
    lead: "Homeノートはあなたの入口です。ここに最も重要なMaps of Contentと現在のエフォートをリンクしてください。フォルダーではこれはできません——フォルダーは1つのノートを1か所にしか置けないからです。",
    mapsHeading: "マップ",
    effortsHeading: "現在のエフォート",
  },
  maps: [
    {
      title: "執筆 MOC",
      body: "Map of Contentは、あるテーマに属するものを集め、自分の言葉で整理します。目次の代わりではありません——ある時点での、そのテーマに対するあなたの見方です。",
      leads: "ここから先へ:",
    },
    {
      title: "庭 MOC",
      body: "MOCもアトラスの外を指してかまいません。このマップは進行中のエフォートへ続いています。この縦横無尽なリンクこそが、この手法の核心です。",
      leads: "ここから先へ:",
    },
  ],
  samples: {
    atlas: [
      {
        title: "なぜフォルダーではなくマップなのか",
        body: "フォルダーは「どこにあるか」に答えます。マップは「何が、なぜ結びついているか」に答えます——そして同じノートが複数のマップに登場してかまいません。\n\nマップに戻る: [[執筆 MOC]]。",
      },
    ],
    efforts: [
      {
        title: "花壇を作る",
        body: "エフォートとは、今取り組んでいる、終わりの見える何かです。あえてアトラスには置きません——アトラスは残り続けるもののためにあります。\n\n- [ ] サイズを決める\n- [ ] 木材を調達する\n\n[[庭 MOC]] に属します。",
      },
    ],
    calendar: [
      {
        title: "{{today}}",
        body: "時間に結びついたものはカレンダーフォルダーに置きます: デイリーノート、振り返り——テーマではなく日付に属するすべてです。\n\n今日見たもの: [[なぜフォルダーではなくマップなのか]]。",
      },
    ],
  },
};

const JD_STRINGS_JA: JdStrings = {
  name: "Johnny.Decimal",
  description: "番号付きのゾーンとカテゴリー（10-19 / 11 / 11.01）で、何でも確実に見つけ出せるようにする手法。",
  folders: {
    system: "00-09 システム",
    systemIndex: "00 インデックス",
    personal: "10-19 プライベート",
    finance: "11 財務",
    health: "12 健康",
    work: "20-29 仕事",
    projects: "21 プロジェクト",
    meetings: "22 ミーティング",
  },
  folderHints: {
    system: "システム自体の管理——インデックスと運用ルールです。",
    personal: "個人的なテーマのサンプルゾーンです。",
    work: "仕事のテーマのサンプルゾーンです。",
  },
  welcome: {
    file: "はじめに.md",
    title: "はじめに",
    description: "この保管庫の出発点となる簡単なガイドです。",
    intro:
      "この保管庫はJohnny.Decimalに沿って整理されています。ゾーンは最大10個（10-19、20-29……）、各ゾーンのカテゴリーも最大10個（11、12……）——そして各ノートには11.01のようなIDが割り当てられます。以下の例は、それがどのようなものかを示しています。",
    outro:
      "ゾーンとカテゴリーは自分のテーマに合わせて自由に名前を変えてください——意図的に限定された深さ（ゾーン→カテゴリー→ID）こそが、この手法の核心です。番号は、ノートが消えても二度と再利用されません。",
  },
  welcomeSections: { start: "はじめの一歩" },
  index: {
    id: "00.00",
    title: "インデックス",
    description: "Johnny.Decimalのインデックス: すべての番号を1か所にまとめます。",
    lead: "すべてのゾーン、カテゴリー、IDの一覧をここに記録してください。番号を探す人は、まずここを見ます——インデックスに載っていない番号は存在しません。",
  },
  samples: [
    {
      id: "11.01",
      title: "家計簿",
      body: "カテゴリー11の最初のノートには01が割り当てられます——次のノートは02、というように続きます。番号は、ノートの名前を変えても、そのノートに紐づいたままです。",
    },
    {
      id: "21.01",
      title: "ウェブサイト刷新",
      body: "プロジェクト全体にも、ちょうど1つの番号が割り当てられます。それに属するものはすべて、専用のサブフォルダーに埋もれるのではなく、その番号を参照します。",
    },
    {
      id: "22.01",
      title: "ウェブサイトキックオフ",
      body: "会議メモは専用のカテゴリーです。プロジェクト番号を圧迫しないようにするためです。これは [[21.01 ウェブサイト刷新]] に属します。",
    },
  ],
};

const JOURNAL_STRINGS_JA: JournalStrings = {
  name: "Journal",
  description: "テンプレートがあらかじめ用意されたデイリーノートとジャーナルデータベース——最初からすべて設定済みです。",
  folders: { journal: "ジャーナル", templates: "テンプレート" },
  folderHints: {
    journal: "1日1件のデイリーノートです。",
    templates: "新規ノート用のテンプレートです——デイリーノート用のテンプレートは既に設定済みです。",
  },
  welcome: {
    file: "はじめに.md",
    title: "はじめに",
    description: "この保管庫の出発点となる簡単なガイドです。",
    intro:
      "この保管庫は毎日の記録のために作られています。デイリーノートはジャーナルフォルダーに置かれ、テンプレートフォルダーのテンプレートから作成されます。すでに2日分のサンプルが用意されています——今日と昨日です。",
    outro:
      "右側のサイドバーでカレンダーを開き、日付をクリックして最初のデイリーノートを作成しましょう。ジャーナル.baseは、日付・気分・キーワードとともに、エントリーをテーブルとカレンダーで表示します。",
  },
  welcomeSections: { databases: "データベース", start: "はじめの一歩" },
  baseFile: "ジャーナル.base",
  keys: { date: "date", mood: "mood", tags: "tags" },
  moods: ["良い", "普通", "悪い", "生産的", "疲れ気味"],
  views: { table: "テーブル", calendar: "カレンダー" },
  template: {
    file: "デイリーノート.md",
    description: "新規デイリーノート用のテンプレートです——{{date}}、{{time}}、{{title}}は自動的に置き換えられます。",
    body: "# {{title}}\n\n## ノート\n\n## タスク\n\n- [ ] \n",
  },
  samples: [
    {
      offset: 0,
      mood: "生産的",
      tags: ["仕事", "執筆"],
      body: "エントリーはこのような形になります。気分とタグはフロントマターに書かれます——だからこそジャーナル.baseは、それらを二重に管理することなくソートしたり絞り込んだりできます。\n\n## ノート\n\n- 右側のサイドバーのカレンダーから、どの日にも移動できます。\n\n## タスク\n\n- [x] 最初のデイリーノートを書く\n- [ ] 明日また戻ってくる",
    },
    {
      offset: -1,
      mood: "疲れ気味",
      tags: ["日常"],
      body: "短いエントリーも、やはりエントリーです。時間が経つと面白くなるのは1日単独ではなく、その積み重ねです——そのために日付順のテーブルビューがあります。\n\n## ノート\n\n- あまり進みませんでしたが、早めに切り上げました。",
    },
  ],
};

export function templates(): VaultTemplateDefinition[] {
  return [
    buildPlainvaTour(TOUR_STRINGS_JA),
    buildPara(PARA_STRINGS_JA),
    buildZettelkasten(ZK_STRINGS_JA),
    buildAce(ACE_STRINGS_JA),
    buildJd(JD_STRINGS_JA),
    buildGtd(GTD_STRINGS_JA),
    buildJournal(JOURNAL_STRINGS_JA),
    buildProject(PROJECT_STRINGS_JA),
  ];
}
