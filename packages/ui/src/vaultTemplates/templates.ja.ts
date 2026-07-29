import { DEFAULT_DAILY_NOTE_TYPE, welcomeBody, type VaultTemplateDefinition } from "./types";
import { defineBase } from "./baseBuilders";
import { buildPlainvaTour, TOUR_STRINGS_EN } from "./plainvaTour";
import { buildPara, type ParaStrings } from "./paraTemplate";
import { buildGtd, type GtdStrings } from "./gtdTemplate";
import { buildZettelkasten, type ZettelkastenStrings } from "./zettelkastenTemplate";

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

export function templates(): VaultTemplateDefinition[] {
  return [
    // TODO(P4): replace with this language's own tour strings (structure is identical).
    buildPlainvaTour(TOUR_STRINGS_EN),
    buildPara(PARA_STRINGS_JA),
    buildZettelkasten(ZK_STRINGS_JA),
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
    buildGtd(GTD_STRINGS_JA),
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
