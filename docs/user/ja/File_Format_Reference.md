# ファイル形式リファレンス

最終更新: 2026-07-15

このページは、**Plainva保管庫内のすべてのファイル**について、ディスク上での正確な形式契約を示します。ツール——他のプログラム、スクリプト、あるいはAIアシスタント——がPlainvaのユーザーインターフェースを経由せずに保管庫のファイルを直接読み書きできるように書かれています。アプリだけを使うなら、このページは不要です。通常の使い方は[他のガイドページ](README.md)で説明しています。

ここに書かれているものはすべて純粋なUTF-8テキストです。ノートはYAMLフロントマター付きのMarkdownで、データベースはYAMLです。独自仕様のものは何もなく、隠されたものもありません。

## 黄金律（まず読むこと）

1. **ノートが真実の源です。`.base`は単なるビューにすぎません。** プロパティの*値*は個々のノートのフロントマターに存在し——`.base`の中には決して存在しません。値を変更するには、ノートを編集してください。
2. **ノートはObsidianネイティブのままです。** ノートのフロントマターには、常に単純なスカラーとリストのみを書いてください（文字列、数値、真偽値、ISO日付、YAMLリスト）。入れ子になったオブジェクトや「アクティブ/選択中」フラグをノートに書き込むことは絶対にありません。
3. **`.base`はObsidianの4つのトップレベルキーだけを使います**（`filters`、`formulas`、`properties`、`views`）。他のトップレベルキーを追加すると、Obsidianはファイル全体を拒否します。Plainva固有のデータはすべて入れ子の`plainva:`サブキーの下に置かれます。
4. **理解できないものは保持してください。** 未知のキーは、読み書きの往復を経ても変わらず生き残らなければなりません。認識できないキーを「整理」しないでください。
5. **BOMなしのUTF-8で、LF改行で書いてください。**

## 保管庫の全体像

保管庫は普通のフォルダーです。あなたが出会うファイルタイプ:

| ファイル | それが何か | テキストとして編集可能か |
|---|---|---|
| `*.md` | ノート: YAMLフロントマター + Markdown本文 | はい |
| `*.base` | ノートに対するデータベースビュー（YAML） | はい |
| `index.md` | フォルダーの管理された目次（予約名） | はい、注意が必要——[index.md](#indexmdフォルダーの目次)を参照 |
| `log.md` | 予約名、現在は未使用 | 触らないでください |
| 画像、PDFなど | 添付ファイル | いいえ（バイナリ） |
| `.plainva/` | Plainvaの内部フォルダー（バックアップ、状態） | **いいえ——絶対に触らないでください** |

予約名`index.md`と`log.md`は決して通常のノートではありません。これらの名前で通常のコンテンツを作成しないでください。

---

## ノート (`.md`)

ノートはMarkdownファイルです。任意のYAMLフロントマターブロック（2つの`---`行の間）が一番上にあり、プロパティを保持します。その後にMarkdown本文が続きます。

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

### OKFフロントマターフィールド

Plainvaは最小限の規約であるOKF（Open Knowledge Format）に従います。2つのトップレベルフィールドがあります。

| フィールド | 型 | 意味 |
|---|---|---|
| `type` | 文字列 | このドキュメントがどのような種類か（`Note`、`Daily Note`、`Project`など）。OKFが実際に要求する唯一のフィールドです。 |
| `okf_version` | 文字列 | ファイルがどのバージョンの規約に基づいて書かれたか、例えば`"0.1"`。YAMLが文字列として保持するよう、引用符で囲んでください。 |

`type`が**ない**ファイルも問題なく開きます。単に「OKF非準拠」であるというだけです。`okf_version`が欠けているだけでは違反にはなりません。新規ノートを作成する際は、`type`（および`okf_version`）を追加するのがよい習慣です。完全な根拠は[OKF](OKF.md)を参照してください。

### プロパティ値のシリアライズ

各フロントマターキーは1つのプロパティです。値はその型のネイティブなYAML形式で書いてください。

| プロパティタイプ | YAML形式 | 例 |
|---|---|---|
| テキスト | スカラー文字列 | `title: Hello` |
| 数値 | 数値 | `priority: 3` |
| チェックボックス | 真偽値 | `done: true` |
| 日付 | ISO日付文字列 | `due: 2026-07-20` |
| 日付と時刻 | ISO日時文字列 | `at: 2026-07-20T14:30:00` |
| リスト | 文字列のYAMLリスト | `authors: [Ada, Alan]` |
| タグ | 文字列のYAMLリスト | `tags: [project, active]` |
| 選択 / ステータス | 単一のスカラー文字列 | `status: Done` |
| 複数選択 | 文字列のYAMLリスト | `labels: [urgent, later]` |
| URL / メール / 電話 | スカラー文字列 | `site: https://example.org` |
| リレーション（単一） | Wikiリンク**文字列** | `project: "[[Project Alpha]]"` |
| リレーション（複数） | Wikiリンク文字列のYAMLリスト | `related: ["[[A]]", "[[B]]"]` |

選択/ステータスプロパティの「アクティブな」値は、単なるこのプレーンなスカラーです。*許可されたオプションのパレット*とその色は、ノートには**存在せず**——それらを支配する`.base`に存在します（[オプションと色](#オプションと色)を参照）。これにより、ノートは100%Obsidianネイティブに保たれます。

> Wikiリンクの値は引用符で囲んでください（`"[[X]]"`）。引用符のない`[[X]]`はYAMLのフローシーケンスとなり、意図したようにはパースされません。

### ノート内の`plainva:`ネームスペース

Plainva固有のノート拡張情報は、他のエディターが無視できるよう単一の`plainva:`キーの下にまとめられています。

| キー | 値 | 意味 |
|---|---|---|
| `icon` | 絵文字グラフェム、または`lucide:<kebab-name>` | ドキュメントアイコン（Notion風） |
| `icon_color` | 16進カラー（`#rgb` / `#rrggbb` / `#rrggbbaa`） | `lucide:`アイコンの色合い（絵文字はこれを無視します） |
| `header_color` | 16進カラー | 全幅のヘッダーストライプ |
| `tasks` | `false` | このノートのチェックボックスを[タスクビュー](Tasks.md)から除外する |

これらはすべて任意です。どれも書かない場合は、`plainva:`キー自体を省略してください。無効な値は読み込み時に無視され、エラーとしては扱われません。

### リンク

- **Wikiリンク:** `[[ノート名]]` — 保管庫全体でノート名によって解決されます。見出しアンカー付き: `[[ノート#セクション]]`。表示テキスト付き: `[[ノート|表示テキスト]]`。
- **Markdownリンク:** `[テキスト](相対/パス.md)`も動作します。
- **バックリンク**はフロントマターのWikiリンクからも含め、自動的に導出されます（これによりリレーションがバックリンクとして表示されます）。

---

## データベース (`.base`)

`.base`ファイルはYAMLです。ノートに対する*ビュー*——どのノート（ソース）、どう表示するか（ビュー）、どうフィルター・ソートするか、そして列スキーマ——を保存します。**ノートの値は一切保存しません。** この形式はObsidianのBasesプラグインと互換性があります。

### 破ってはいけないルール——1つでも破るとObsidianはファイル全体を拒否します

- **これらのトップレベルキーのみ:** `filters`、`formulas`、`properties`、`views`。他のトップレベルキーは絶対に追加しないでください（歴史的に、トップレベルの`columns:`キーはすべてのファイルを壊しました——このパターンを復活させないでください）。
- **すべてのビューは空でない文字列の`name`を必要とします。**
- **`filters`オブジェクトは各レベルで`and` / `or` / `not`のうち正確に1つだけを持ちます** — 決して2つを並べて持ちません。

Plainva自身は、最後の2つのルールに違反する古いファイルを次に保存するときに修復しますが、直接書き込むツールは最初から正しくしなければなりません。

### プロパティ識別子: `note.`接頭辞をいつ使うか

これはつまずきやすいポイントなので、明示しておきます。

| 場所 | 形式 | 例 |
|---|---|---|
| `properties:`マップのキー | 接頭辞付き | `note.status`、`file.name` |
| ビューの`order:`リスト | 接頭辞付き | `[file.name, note.status]` |
| ビューの`sort[].property` | 接頭辞付き | `note.due` |
| **フィルター**式の中 | **bare** | `status == "Done"` |
| `plainva`サブキーの中（`groupBy`、`dateField`、`endField`、`subItemsProperty`） | **bare** | `groupBy: status` |

経験則: *Obsidian向けの*構造フィールドは`note.<key>`を使い（そして`file.name`、`file.folder`、`file.mtime`のような組み込みには`file.<x>`を使い）、**フィルター式**または**`plainva`ブロック**の中はすべて、ありのままのフロントマターキーを使います。

### トップレベルキー

- **`filters`** — このデータベースに属するノート。Plainvaでは、これは**ソース**（フォルダー/タグ）のみを保持し、プロパティのフィルター条件はビューごとに`views[i].filters`の下に保存されます。[フィルター](#フィルター)を参照。
- **`properties`** — プロパティIDをキーとする列スキーマ。`displayName`（列見出しラベル）のようなネイティブのObsidianサブキーは許可され、保持されます。Plainvaのリッチネスはすべて`properties[id].plainva`の下にあります。
- **`views`** — 順序付きのビューのリスト。それぞれ`name`と`type`が必要です。
- **`formulas`** — Obsidianの機能です。Plainvaはこれらを作成しませんが、変更せずに保持します。

### `plainva:`サブキーマップ

Plainva固有のものはすべてネームスペース化されています。3つの場所があります。

**`properties[<note.key>].plainva`** — 列ごと:

| キー | 値 | 意味 |
|---|---|---|
| `input` | 下記の入力タイプのいずれか | 列のフィールドタイプ |
| `options` | オプションオブジェクトのリスト | 選択/ステータス/複数選択のキュレーションされた値 |
| `relationBase` | 保管庫相対の`.base`パス | リレーションの対象データベース（[リレーション](#リレーション両側の契約)を参照） |
| `relationLimit` | `one` | カーディナリティ: 単一リンク。省略すると無制限。 |
| `reverseOf` | `{ base, property }` | **計算された逆リレーション**列（`input`なし）を示す |

**`views[i].plainva`** — ビューごと:

| キー | 値 | 意味 |
|---|---|---|
| `render` | `board` / `calendar` / `timeline` | Plainva専用のビュー種別（下記参照） |
| `groupBy` | bareなプロパティキー | ボードのグループ化列 |
| `dateField` | bareなプロパティキー | カレンダー/タイムラインの開始日 |
| `endField` | bareなプロパティキー | タイムラインの終了日 |
| `coverImage` | bareなプロパティキー | ギャラリーのカバー画像プロパティ |
| `subItemsProperty` | bareなプロパティキー | サブアイテムのネスト用のセルフリレーション親列 |
| `widths` | id → pxのマップ | 列幅 |
| `dateFormat` | 文字列 | ビューごとの日付形式（`default`は暗黙——省略してください） |

`plainva`ブロックとは別に、ビューはネイティブの**`views[i].filters`**オブジェクトを持つことができます——**ビューごとのプロパティフィルター**です（ファイルレベルの`filters`と同じ、単一ルートの`and`/`or`/`not`構造です）。Plainvaはプロパティのフィルタールールをここに、ビューごとに1セットずつ保存するため、各ビューは独立してフィルタリングされます。ファイルレベルの`filters`はソースのみを保持します。Obsidianはネイティブに`views[i].filters`をビューごとに適用します。

**`views[0].plainva`** — ファイル全体のキー、**最初のビュー**のみで許可:

| キー | 値 | 意味 |
|---|---|---|
| `fileIconColor` | 16進カラー | データベースアイコンの色合い（ツリー/タブ/ヘッダー） |
| `newItemFolder` | 保管庫相対のフォルダー | 「新規作成」ボタンが新規項目を保存する場所 |
| `newItemTemplate` | 保管庫相対の`.md`パス | 新規項目のデフォルトテンプレート |
| `contextFilters` | bareなプロパティキーのリスト | 自己参照フィルター（「このノート」）——下記を参照 |

`contextFilters`は、Notionの「this page」フィルターに相当するPlainvaの機能です。各エントリはプロパティキーであり、データベースがノートに埋め込まれると、その行はそのプロパティを通じてホストノートに絞り込まれます（リンクインデックスを介して解決されます——所有側/Wikiリンクのプロパティはホストを指す行にマッチし、計算された逆リレーション列はホストが指す先にマッチします）。これは意図的にネイティブの`filters`には**書き込まれません**——そのためObsidianはこれを無視し、すべての行を表示します。Plainvaで単独で開いた場合も、ホストが存在しないため同様に適用されず、すべての行が表示されます。複数のエントリはAND条件で結合されます。

### 入力タイプ

`plainva.input`は次のいずれかです。

```
text  number  checkbox  date  datetime
select  status  multiselect
list  tags  url  email  phone
relation
```

計算された**逆**列には`input`が**ありません**——`reverseOf`によってのみ識別されます。

### オプションと色

選択/ステータス/複数選択列は、キュレーションされたオプションリストを持つことができます。各オプション:

```yaml
options:
  - value: Open          # required
    color: amber         # optional palette name (see below)
    group: Active        # optional; STATUS only — orders options into stages
  - value: Done
    color: green
    group: Closed
```

`color`はCSSカラーではなく**パレット名**です。有効な名前: `gray`、`teal`、`blue`、`green`、`amber`、`coral`、`purple`、`pink`。未知の色は、値から導出された色にフォールバックします。

### ビュータイプ

ディスク上の`views[i].type`はネイティブのObsidianタイプです。Plainva専用のレンダリングは`type: table`に`plainva.render`ヒントを加えて書き込まれるため、Obsidianはそれらを単純なテーブルに縮退させます。

| あなたが望むもの | ディスク上の`type` | `plainva.render` |
|---|---|---|
| テーブル | `table` | — |
| リスト | `list` | — |
| ギャラリー | `cards` | — |
| ボード | `table` | `board` |
| カレンダー | `table` | `calendar` |
| タイムライン | `table` | `timeline` |

### フィルター

`filters`は、どのノートがデータベースに含まれるかを選択し、それらを絞り込みます。

**ソース条件**がメンバーシップを決定します。

- フォルダー: `file.folder == "Path/To/Folder"`（保管庫相対、ルートフォルダーは`""`）。
- タグ: `file.hasTag("project")`（先頭の`#`なし）。

複数のソースは、単に複数のエントリです。`filters`が全くない場合 = 保管庫内のすべてのノート。

**プロパティ条件がどこに存在するか:** ファイルレベルでは、`filters`はすべてのビューに適用されます。Plainvaは代わりに、プロパティのフィルタールールを**ビューごと**に`views[i].filters`（同じ単一ルート構造）に保存し、ファイルレベルにはソースのみを保持するため、各ビューは独立してフィルタリングできます。どちらもObsidianにとって有効であり、ツールはどちらを書き込んでも構いません。ファイルレベルにプロパティ条件を持つ従来のファイルも引き続き動作します——Plainvaは次回の保存時に、それらを各ビューへ振り分けます。

**プロパティ条件**は、ありのままのプロパティ名と次の演算子を使います。

| 演算子 | 式 |
|---|---|
| 等しい | `status == "Done"` |
| 等しくない | `status != "Done"` |
| 含む | `contains(labels, "urgent")` |
| 含まない | `!contains(labels, "urgent")` |
| より大きい / より小さい | `priority > "2"`、`priority < "5"` |
| 以上 / 以下 | `priority >= "2"`、`priority <= "5"` |
| 空である | `status == ""` |
| 空でない | `status != ""` |

**構造（単一ルート！）:** `and` / `or` / `not`のいずれか1つで、そのエントリは条件文字列——または、1階層のネストされた`{and:[...]}` / `{or:[...]}`グループオブジェクト（Notion風のグループ）です。ソース、条件、ORグループを組み合わせた例:

```yaml
filters:
  and:
    - 'file.folder == "Projects"'
    - 'status != "Done"'
    - or:
        - 'priority == "1"'
        - 'priority == "2"'
```

### 完全な注釈付き`.base`

```yaml
filters:
  and:
    - 'file.folder == "Projects"'          # source: notes in the Projects folder
properties:
  note.status:                             # column id is note.-prefixed
    displayName: Status                    # optional Obsidian column label
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
  - type: table                            # first view: also carries file-wide keys
    name: All projects                     # every view needs a name
    order: [file.name, note.status]        # order uses note.-prefixed ids
    plainva:
      fileIconColor: "#2f6f6f"
      newItemFolder: Projects
  - type: table                            # a board is a native table + render hint
    name: Board
    plainva:
      render: board
      groupBy: status                      # groupBy uses the BARE key
```

---

## リレーション（両側の契約）

リレーションはノート同士を結びつけます。これは手で書く際に最もエラーが起きやすいものです。なぜなら**3つ**の場所にまたがるからです。3つすべてを一貫させてください。

1. **値はソースノートのフロントマターに存在します**、Wikiリンク（またはそのリスト）として:

   ```markdown
   ---
   type: Task
   project: "[[Project Alpha]]"
   ---
   ```

2. **ソースの`.base`がリレーション列を宣言します**（`relationBase` = 対象データベース、単一リンクの場合は`relationLimit: one`）:

   ```yaml
   properties:
     note.project:
       plainva:
         input: relation
         relationBase: Projects.base
         relationLimit: one
   ```

3. **対象の`.base`は、**計算**列で逆方向を表示できます。** その値はどこにも**保存されません**——ソースノートのリンクから導出されます:

   ```yaml
   properties:
     note.tasks:
       plainva:
         reverseOf:
           base: Tasks.base       # the source .base (vault-relative path)
           property: project      # the BARE source property key
   ```

### 実例: タスク ↔ プロジェクト

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

結果: `Projects.base`では、**Project Alpha**の計算列`tasks`に「Write proposal」が表示されます。なぜなら、そのタスクの`project`がProject Alphaにリンクバックしているからです。`Project Alpha.md`には`tasks:`キーが**ない**ことに注目してください——逆側は計算されるものであり、決して保存されません。

### リレーションでやってはいけないこと

- **逆方向の値をノートに書き込まないでください。** `reverseOf`列は計算されたものです。`Project Alpha.md`に`tasks:`キーを書き込むのは誤りであり、往復（round-trip）を生き残りません。
- **リンク先が解決するようにしてください。** `"[[Project Alpha]]"`は既存のノート名と一致しなければなりません。さもないとリンクは壊れて表示されます。
- **パスは保管庫相対に保ってください**、スラッシュを使い、先頭の`./`はなしで（`Projects.base`、`DB/Projects.base`）。
- **`reverseOf.property`はbareなソースキーです**（`project`）、`note.project`ではありません。

### セルフリレーションとサブアイテム

対象が同じデータベースであるリレーションの場合、`relationBase`はその同じ`.base`を指すようにしてください。テーブルビューで子を親の下にネストするには、`views[i].plainva.subItemsProperty`をbareな親リレーションキーに設定してください。循環参照は処理されます。サブアイテムを無効にすると、行はフラットのままで値は保持されます。

---

## `index.md`（フォルダーの目次）

`index.md`はフォルダーの目次のための予約名です。

- **フロントマターを持てるのはルートの`index.md`のみで**、それも`okf_version`のみです（これは保管庫をOKFアクティブとしてマークします）。ルート以外の`index.md`は**フロントマターがない**状態でなければなりません——そこにフロントマターがあると予約名違反になります。
- Plainvaが**管理する**`index.md`は、マーカー`<!-- plainva:index generated -->`（HTMLコメント、閲覧モードでは不可視）で終わります。これが存在するということは、Plainvaがそのファイルを自動的に最新の状態に保つことを意味します。そのようなファイルを手動で編集する場合は、マーカーを保持する（そして生成された形を保つ）か、意図的に削除してそのファイルを恒久的に引き継ぐかのどちらかにしてください。
- 生成される一覧は、`* [タイトル](相対/url) - 説明`の形式のリンクのセクションです。

フォルダー概要を手動で生成する場合、安全な選択はマーカーを**追加しない**ことです——そうすればPlainvaがそれを上書きすることは決してありません。

---

### グラフビュー（`plainva.render: "graph"`）

グラフビューは、ネイティブでないすべてのビューと同じように保存されます: `type: table`にレンダリングヒントを加えたものです。そのオプションは同じ`views[i].plainva`ネームスペースの中にあります。

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
      graphShowIncoming: true      # 他のデータベースからこれらのエントリを指すリレーションを含める (例: プロジェクトのタスク)
```

すべてのグラフオプションキーは任意です。設定しない場合は完全に省略してください。Obsidianは同じファイルを単純なテーブルとして表示し、エラーを出してはいけません。

**ボード**ビュー（`plainva.render: "board"`）は、追加で`views[i].plainva.boardColumnOrder`を持てます——グループ化列キーのリスト（`__UNGROUPED__`は値のない列を示します）で、手動での列の順序を記憶します。選択/ステータスのボードでは、代わりにプロパティの`options`を並べ替えます。設定しない場合はこのキーを省略してください。

## 触ってはいけないものと安全性

- **`.plainva/`**はバックアップと内部状態を保持します。そこにプログラムロジックを読み込んだり、書き込んだりしないでください。
- **未知のキーは神聖です。** `.base`やノートを書き直すときは、変更するつもりのなかったすべてのキーをそのまま引き継いでください。Plainva自身は内部の生コピーを通じて未知の`.base`キーを保持します。サードパーティの書き手も同じことをすべきです（パースする → 意図したものだけを変更する → シリアライズする）。
- **値はノートで変わるのであって、`.base`ではありません。** セルを設定するには、ノートのフロントマターを編集してください。`.base`はどのノートとどの列を表示するかだけを決めます。
- **`filters` / `formulas` / `properties` / `views`を超えるトップレベルの`.base`キーを追加しないでください。**
- **エンコーディング:** どこでもBOMなしのUTF-8、LF改行。

## 関連ページ

- [ノートとMarkdown](Notes_and_Markdown.md) — アプリ内で手書きするという視点から見た、同じ内容
- [データベース (.base)](Databases_Base.md) — 日常使いのために説明されたデータベース
- [OKF](OKF.md) — `type`、`okf_version`、index.md、そして保管庫の変換
