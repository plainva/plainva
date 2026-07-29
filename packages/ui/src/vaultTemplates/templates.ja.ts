import { DEFAULT_DAILY_NOTE_TYPE, welcomeBody, type VaultTemplateDefinition } from "./types";
import { defineBase } from "./baseBuilders";
import { buildPlainvaTour, TOUR_STRINGS_EN } from "./plainvaTour";
import { buildPara, type ParaStrings } from "./paraTemplate";

/** Japanese template set — folder/file names follow the app language.
 *
 * PARA, GTD, Zettelkasten and Journal additionally ship pre-wired `.base`
 * databases (Gesamtplan DB-Vorlagen 2026-07-04); ACE and Johnny.Decimal stay
 * link-/folder-based on purpose. Database column KEYS are kept ASCII/romaji;
 * option VALUES, view names and `.base` file names are fully localized.
 * Relation columns and their reverse counterparts are wired here so the
 * databases show real data as soon as the vault is indexed. */

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

export function templates(): VaultTemplateDefinition[] {
  return [
    // TODO(P4): replace with this language's own tour strings (structure is identical).
    buildPlainvaTour(TOUR_STRINGS_EN),
    buildPara(PARA_STRINGS_JA),
    {
      id: "zettelkasten",
      name: "Zettelkasten",
      description: "1ノート1アイデアを密に結びつける手法——フリーティングノート、文献ノート、パーマネントノート（Luhmann）。",
      folders: ["フリーティングノート", "文献ノート", "パーマネントノート", "テンプレート"],
      bases: [
        defineBase({
          path: "文献.base",
          sourceFolder: "文献ノート",
          columns: [
            { key: "author", input: "text" },
            { key: "year", input: "number" },
            { key: "kind", input: "select", options: ["書籍", "記事", "動画", "ポッドキャスト", "ウェブサイト"] },
            { key: "status", input: "status", options: ["未読", "既読", "処理済み"] },
            { key: "url", input: "url" },
            { key: "slips", reverseOf: { base: "スリップ.base", property: "source" } },
          ],
          views: [
            { name: "テーブル", type: "table" },
            { name: "ステータス別", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "テンプレート/文献ノート.md",
        }),
        defineBase({
          path: "スリップ.base",
          sourceFolder: "パーマネントノート",
          columns: [{ key: "source", input: "relation", relationBase: "文献.base" }],
          views: [{ name: "テーブル", type: "table" }],
        }),
      ],
      notes: [
        {
          path: "はじめに.md",
          description: "この保管庫の出発点となる簡単なガイドです。",
          body: welcomeBody(
            "はじめに",
            "この保管庫はZettelkasten（Niklas Luhmann）の手法に従っています。1つのノートに1つのアイデアだけを書き、つながりはフォルダー階層ではなくリンクから生まれます。",
            [
              { name: "フリーティングノート", description: "素早く書き留めた未整理の考え——一時的なもので、後で処理します。" },
              { name: "文献ノート", description: "読んだ内容を自分の言葉でまとめたもの。出典付きです。" },
              { name: "パーマネントノート", description: "自分の言葉で丁寧に書かれた、長く残るアイデア——1ノートに1つ、他のノートと密にリンクします。" },
            ],
            "文献.baseでは出典を読書ステータスごとに管理できます。スリップ.baseはパーマネントノートを、その「出典」プロパティを通じて元となった文献に結びつけます。"
          ),
        },
        {
          path: "パーマネントノート/サンプルノート.md",
          description: "パーマネントノートの例です。",
          properties: { source: ["[[サンプル文献ノート]]"] },
          body: "# サンプルノート\n\nパーマネントノートには、ちょうど1つのアイデアだけを、完全な文章で自分の言葉で書きます。\n\n関連するノートは本文中で直接リンクしましょう——そうやってアイデアのネットワークが育っていきます。\n",
        },
        {
          path: "文献ノート/サンプル文献ノート.md",
          description: "文献ノートの例です。",
          properties: { author: "Niklas Luhmann", year: 1992, kind: "書籍", status: "既読" },
          body: "# サンプル文献ノート\n\n読んだ内容を自分の言葉でまとめ、出典を記録します。パーマネントノートは「出典」プロパティを通じてこの文献ノートを参照します。\n",
        },
        {
          path: "テンプレート/文献ノート.md",
          properties: { status: "未読" },
          body: "# {{title}}\n\n## 要約\n\n## 出典\n",
        },
      ],
      settings: { templateFolder: "テンプレート" },
    },
    {
      id: "ace",
      name: "ACE (Linking Your Thinking)",
      description: "アトラス、カレンダー、エフォート——Nick Miloが提唱するMOC中心の知識管理手法。",
      folders: ["アトラス", "カレンダー", "エフォート"],
      notes: [
        {
          path: "はじめに.md",
          description: "この保管庫の出発点となる簡単なガイドです。",
          body: welcomeBody(
            "はじめに",
            "この保管庫は「Linking Your Thinking」（Nick Milo）のACEスキームを採用しています。知識は深い階層ではなく、Maps of Content（MOC）によって結びつけられます。",
            [
              { name: "アトラス", description: "あなたの知識の地図——MOCとまとめノートです。" },
              { name: "カレンダー", description: "時間に結びついたもの——デイリーノート、日記、振り返りです。" },
              { name: "エフォート", description: "現在積極的に取り組んでいるすべてのことです。" },
            ],
            "アトラスのHomeノートから始めて、そこから自分の知識へリンクを広げていきましょう。"
          ),
        },
        {
          path: "アトラス/Home.md",
          description: "最上位のMap of Contentです。",
          body: "# Home\n\nHomeノートはあなたの入口です。ここに最も重要なMaps of Contentと現在のエフォートをリンクしてください。\n",
        },
      ],
    },
    {
      id: "jd",
      name: "Johnny.Decimal",
      description: "番号付きのゾーンとカテゴリー（10-19 / 11 / 11.01）で、何でも確実に見つけ出せるようにする手法。",
      folders: [
        "00-09 システム",
        "00-09 システム/00 インデックス",
        "10-19 プライベート",
        "10-19 プライベート/11 財務",
        "10-19 プライベート/12 健康",
        "20-29 仕事",
        "20-29 仕事/21 プロジェクト",
        "20-29 仕事/22 ミーティング",
      ],
      notes: [
        {
          path: "はじめに.md",
          description: "この保管庫の出発点となる簡単なガイドです。",
          body: welcomeBody(
            "はじめに",
            "この保管庫はJohnny.Decimalに沿って整理されています。ゾーンは最大10個（10-19、20-29……）、各ゾーンのカテゴリーも最大10個（11、12……）——そして各ノートには11.01のようなIDが割り当てられます。",
            [
              { name: "00-09 システム", description: "システム自体の管理——インデックスと運用ルールです。" },
              { name: "10-19 プライベート", description: "個人的なテーマのサンプルゾーンです。" },
              { name: "20-29 仕事", description: "仕事のテーマのサンプルゾーンです。" },
            ],
            "ゾーンとカテゴリーは自分のテーマに合わせて自由に名前を変えてください——意図的に限定された深さ（ゾーン→カテゴリー→ID）こそが、この手法の核心です。"
          ),
        },
        {
          path: "00-09 システム/00 インデックス/00.00 インデックス.md",
          description: "Johnny.Decimalのインデックス: すべての番号を1か所にまとめます。",
          body: "# 00.00 インデックス\n\nすべてのゾーン、カテゴリー、IDの一覧をここに記録してください。番号を探す人は、まずここを見ます。\n\n## 10-19 プライベート\n\n- 11 財務\n- 12 健康\n\n## 20-29 仕事\n\n- 21 プロジェクト\n- 22 ミーティング\n",
        },
      ],
    },
    {
      id: "gtd",
      name: "GTD",
      description: "Getting Things Done——インボックス、タスク、プロジェクト、リファレンス、「いつか/たぶん」リスト。",
      folders: ["インボックス", "タスク", "プロジェクト", "リファレンス", "いつか/たぶん", "テンプレート"],
      bases: [
        defineBase({
          path: "タスク.base",
          sourceFolder: "タスク",
          columns: [
            { key: "status", input: "status", options: ["インボックス", "次のアクション", "待機中", "いつか", "完了"] },
            { key: "context", input: "select", options: ["@自宅", "@職場", "@外出", "@電話"] },
            { key: "project", input: "relation", relationBase: "プロジェクト.base", relationLimit: "one" },
            { key: "due", input: "date" },
          ],
          views: [
            { name: "テーブル", type: "table" },
            { name: "ステータス別", type: "board", groupBy: "status" },
            { name: "コンテキスト別", type: "board", groupBy: "context" },
          ],
          newItemTemplate: "テンプレート/タスク.md",
        }),
        defineBase({
          path: "プロジェクト.base",
          sourceFolder: "プロジェクト",
          columns: [
            { key: "status", input: "status", options: ["進行中", "待機中", "いつか", "完了"] },
            { key: "tasks", reverseOf: { base: "タスク.base", property: "project" } },
          ],
          views: [
            { name: "テーブル", type: "table" },
            { name: "ステータス別", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "テンプレート/プロジェクト.md",
        }),
      ],
      notes: [
        {
          path: "はじめに.md",
          description: "この保管庫の出発点となる簡単なガイドです。",
          body: welcomeBody(
            "はじめに",
            "この保管庫はGetting Things Done（David Allen）に従っています。すべてはまずインボックスに入り、そこから具体的なタスクやプロジェクトへと処理されます。",
            [
              { name: "インボックス", description: "入ってくるすべてのものの集積場所です——定期的に空にしましょう。" },
              { name: "タスク", description: "単一の次のアクション——ステータスとコンテキストで整理します（タスク.base）。" },
              { name: "プロジェクト", description: "複数のステップが必要なものすべてです（プロジェクト.base）。" },
              { name: "リファレンス", description: "行動を必要としない、参照用の資料です。" },
              { name: "いつか/たぶん", description: "後回しにするアイデアや構想です。" },
            ],
            "タスク.baseでは、各タスクを「プロジェクト」プロパティを通じてプロジェクトに割り当てます。すると、プロジェクト.baseの「タスク」列に、各プロジェクトに属するものが自動的に表示されます。週次レビューがシステムの信頼性を保ちます。"
          ),
        },
        {
          path: "週次レビュー.md",
          description: "GTDの週次レビュー用チェックリストです。",
          body: "# 週次レビュー\n\n- [ ] インボックスを空にする\n- [ ] プロジェクトリストを見直し、次のアクションを確認する\n- [ ] 「いつか/たぶん」リストにざっと目を通す\n- [ ] 今後2週間のカレンダーを確認する\n",
        },
        {
          path: "プロジェクト/サンプルプロジェクト.md",
          description: "GTDプロジェクトノートの例です。",
          properties: { status: "進行中" },
          body: "# サンプルプロジェクト\n\n望ましい結果: 「完了」とはどのような状態か？\n\n次のアクション:\n\n- [ ] 具体的な次のステップを1つ記録する\n",
        },
        {
          path: "タスク/サンプルタスク.md",
          description: "プロジェクトに関連付けられたタスクの例です。",
          properties: { status: "次のアクション", context: "@職場", project: "[[サンプルプロジェクト]]" },
          body: "# サンプルタスク\n\nタスクは単一の具体的な次のアクションです。「プロジェクト」プロパティを通じて、サンプルプロジェクトに属します。\n",
        },
        {
          path: "タスク/アイデアを集める.md",
          description: "処理前の新しいインボックス項目の例です。",
          properties: { status: "インボックス" },
          body: "# アイデアを集める\n\nインボックスに入ったばかりで、まだ処理されていません。次のレビューで、このタスクにコンテキストとプロジェクトが割り当てられます。\n",
        },
        {
          path: "テンプレート/タスク.md",
          properties: { status: "インボックス" },
          body: "# {{title}}\n\n## ノート\n\n- [ ] \n",
        },
        {
          path: "テンプレート/プロジェクト.md",
          properties: { status: "進行中" },
          body: "# {{title}}\n\n## 望ましい結果\n\n## 次のステップ\n\n- [ ] \n",
        },
      ],
      settings: { templateFolder: "テンプレート" },
    },
    {
      id: "journal",
      name: "Journal",
      description: "テンプレートがあらかじめ用意されたデイリーノートとジャーナルデータベース——最初からすべて設定済みです。",
      folders: ["ジャーナル", "テンプレート"],
      bases: [
        defineBase({
          path: "ジャーナル.base",
          sourceFolder: "ジャーナル",
          columns: [
            { key: "date", input: "date" },
            { key: "mood", input: "select", options: ["良い", "普通", "悪い", "生産的", "疲れ気味"] },
            { key: "keywords", input: "tags" },
          ],
          views: [
            { name: "テーブル", type: "table", sort: [{ property: "date", direction: "DESC" }] },
            { name: "カレンダー", type: "calendar", dateField: "date" },
          ],
        }),
      ],
      notes: [
        {
          path: "はじめに.md",
          description: "この保管庫の出発点となる簡単なガイドです。",
          body: welcomeBody(
            "はじめに",
            "この保管庫は毎日の記録のために作られています。デイリーノートはジャーナルフォルダーに置かれ、テンプレートフォルダーのテンプレートから作成されます。",
            [
              { name: "ジャーナル", description: "1日1件のデイリーノートです。" },
              { name: "テンプレート", description: "新規ノート用のテンプレートです——デイリーノート用のテンプレートは既に設定済みです。" },
            ],
            "右側のサイドバーでカレンダーを開き、日付をクリックして最初のデイリーノートを作成しましょう。ジャーナル.baseは、日付・気分・キーワードとともに、エントリーをテーブルとカレンダーで表示します。"
          ),
        },
        {
          path: "テンプレート/デイリーノート.md",
          description: "新規デイリーノート用のテンプレートです——{{date}}、{{time}}、{{title}}は自動的に置き換えられます。",
          type: DEFAULT_DAILY_NOTE_TYPE,
          properties: { date: "{{date}}" },
          body: "# {{title}}\n\n## ノート\n\n## タスク\n\n- [ ] \n",
        },
      ],
      settings: { dailyNotesFolder: "ジャーナル", templateFolder: "テンプレート", dailyNoteTemplate: "デイリーノート.md" },
    },
  ];
}
