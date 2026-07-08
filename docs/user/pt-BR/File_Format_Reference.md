# Referência do Formato de Arquivo

Stand: 2026-07-07

Esta página é o contrato exato, tal como gravado em disco, para **todo arquivo em um vault do Plainva**. Ela é escrita para que uma ferramenta — outro programa, script ou assistente de IA — possa ler e editar arquivos do vault diretamente, com segurança, sem passar pela interface do Plainva. Se você só usa o app, nunca precisa desta página; as [demais páginas do guia](README.md) cobrem o uso normal.

Tudo aqui é texto UTF-8 puro. Notas são Markdown com frontmatter YAML; bancos de dados são YAML. Nada é proprietário e nada é oculto.

## Regras de ouro (leia primeiro)

1. **A nota é a fonte da verdade. Uma `.base` é apenas uma visualização.** Os *valores* das propriedades vivem no frontmatter das notas individuais — nunca dentro da `.base`. Para alterar um valor, edite a nota.
2. **Notas continuam nativas do Obsidian.** No frontmatter de uma nota, escreva sempre escalares e listas simples (string, número, booleano, data ISO, lista YAML). Nunca escreva um objeto aninhado ou uma flag "ativo/selecionado" em uma nota.
3. **Uma `.base` usa apenas as quatro chaves de nível superior do Obsidian** (`filters`, `formulas`, `properties`, `views`). Adicionar qualquer outra chave de nível superior faz o Obsidian rejeitar o arquivo inteiro. Tudo o que é específico do Plainva vive sob subchaves aninhadas `plainva:`.
4. **Preserve o que você não entende.** Chaves desconhecidas devem sobreviver a um ciclo de leitura/escrita sem alterações. Não "limpe" chaves que você não reconhece.
5. **Escreva UTF-8 sem BOM, com quebras de linha LF.**

## O vault em um relance

Um vault é uma pasta comum. Os tipos de arquivo que você vai encontrar:

| Arquivo | O que é | Editável como texto |
|---|---|---|
| `*.md` | Uma nota: frontmatter YAML + corpo em Markdown | Sim |
| `*.base` | Uma visualização de banco de dados sobre notas (YAML) | Sim |
| `index.md` | O sumário gerenciado de uma pasta (nome reservado) | Sim, com cuidado — veja [index.md](#indexmd-sumário-de-uma-pasta) |
| `log.md` | Nome reservado, atualmente sem uso | Deixe intocado |
| imagens, PDFs, … | Anexos | Não (binário) |
| `.plainva/` | Pasta interna do Plainva (backups, estado) | **Não — nunca toque** |

Os nomes reservados `index.md` e `log.md` nunca são notas comuns; não crie conteúdo comum sob esses nomes.

---

## Notas (`.md`)

Uma nota é um arquivo Markdown. Um bloco opcional de frontmatter YAML (entre duas linhas `---`) bem no topo guarda suas propriedades; o corpo em Markdown vem em seguida.

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

### Campos de frontmatter do OKF

O Plainva segue o OKF (Open Knowledge Format), uma convenção mínima. Dois campos de nível superior:

| Campo | Tipo | Significado |
|---|---|---|
| `type` | string | Que tipo de documento é este (`Note`, `Daily Note`, `Project`, …). O único campo que o OKF realmente exige. |
| `okf_version` | string | A versão da convenção segundo a qual o arquivo foi escrito, por exemplo `"0.1"`. Coloque entre aspas para o YAML mantê-la como string. |

Um arquivo **sem** `type` ainda abre normalmente; ele simplesmente "não é conformante com o OKF". Um `okf_version` ausente, isoladamente, não é uma violação. Ao criar uma nova nota, adicionar `type` (e `okf_version`) é uma boa prática. Veja [OKF](OKF.md) para a justificativa completa.

### Serialização dos valores de propriedade

Cada chave de frontmatter é uma propriedade. Escreva o valor na forma YAML nativa do seu tipo:

| Tipo de propriedade | Forma YAML | Exemplo |
|---|---|---|
| Texto | string escalar | `title: Hello` |
| Número | número | `priority: 3` |
| Caixa de seleção | booleano | `done: true` |
| Data | string de data ISO | `due: 2026-07-20` |
| Data e hora | string de data e hora ISO | `at: 2026-07-20T14:30:00` |
| Lista | lista YAML de strings | `authors: [Ada, Alan]` |
| Tags | lista YAML de strings | `tags: [project, active]` |
| Seleção / Status | string escalar única | `status: Done` |
| Seleção múltipla | lista YAML de strings | `labels: [urgent, later]` |
| URL / E-mail / Telefone | string escalar | `site: https://example.org` |
| Relação (única) | **string** de link wiki | `project: "[[Project Alpha]]"` |
| Relação (múltipla) | lista YAML de strings de link wiki | `related: ["[[A]]", "[[B]]"]` |

O valor "ativo" de uma propriedade de Seleção/Status é apenas esse escalar simples. A *paleta de opções permitidas* e suas cores **não** vivem na nota — elas vivem na `.base` que a governa (veja [Opções e cores](#opções-e-cores)). Isso mantém a nota 100% nativa do Obsidian.

> Coloque valores de link wiki entre aspas (`"[[X]]"`). Um `[[X]]` sem aspas é uma sequência de fluxo YAML e não será interpretado como você pretende.

### O namespace `plainva:` em notas

Extras exclusivamente de apresentação são agrupados sob uma única chave `plainva:` para que outros editores possam ignorá-los:

| Chave | Valor | Significado |
|---|---|---|
| `icon` | grafema de emoji, ou `lucide:<nome-kebab>` | Ícone do documento (estilo Notion) |
| `icon_color` | cor hex (`#rgb` / `#rrggbb` / `#rrggbbaa`) | Tonalidade para um ícone `lucide:` (emojis a ignoram) |
| `header_color` | cor hex | Faixa de cabeçalho em largura total |

Todos os três são opcionais. Se você não escrever nenhum deles, omita a chave `plainva:` inteiramente. Valores inválidos são ignorados na leitura, nunca tratados como erro.

### Links

- **Link wiki:** `[[Nome da nota]]` — resolvido pelo nome da nota em todo o vault. Com âncora de título: `[[Nota#Seção]]`. Com texto de exibição: `[[Nota|texto exibido]]`.
- **Link Markdown:** `[texto](caminho/relativo.md)` também funciona.
- **Backlinks** são derivados automaticamente, inclusive a partir de links wiki no frontmatter (é isso que faz relações aparecerem como backlinks).

---

## Bancos de dados (`.base`)

Um arquivo `.base` é YAML. Ele armazena uma *visualização* sobre notas — quais notas (fontes), como exibi-las (visualizações), como filtrar e ordenar, e o esquema de colunas. Ele **não** armazena valores de nota. O formato é compatível com o plugin Bases do Obsidian.

### Regras rígidas — violar uma delas faz o Obsidian rejeitar o arquivo inteiro

- **Apenas estas chaves de nível superior:** `filters`, `formulas`, `properties`, `views`. Nunca adicione outra chave de nível superior. (Historicamente, uma chave `columns:` de nível superior quebrava todo arquivo — não reintroduza esse padrão.)
- **Toda visualização precisa de um `name` em string não vazia.**
- **Um objeto `filters` carrega exatamente um entre `and` / `or` / `not` em cada nível** — nunca dois lado a lado.

O próprio Plainva corrige arquivos mais antigos que violam as duas últimas regras na próxima vez que os salva, mas uma ferramenta que escreve diretamente precisa acertá-las de antemão.

### Identificadores de propriedade: quando usar o prefixo `note.`

Isso costuma confundir as pessoas, por isso fica explícito:

| Onde | Forma | Exemplo |
|---|---|---|
| Chaves do mapa `properties:` | com prefixo | `note.status`, `file.name` |
| Lista `order:` de uma visualização | com prefixo | `[file.name, note.status]` |
| `sort[].property` de uma visualização | com prefixo | `note.due` |
| Dentro de expressões de **filtro** | **sem prefixo** | `status == "Done"` |
| Dentro de subchaves `plainva` (`groupBy`, `dateField`, `endField`, `subItemsProperty`) | **sem prefixo** | `groupBy: status` |

Regra geral: os campos estruturais *voltados para o Obsidian* usam `note.<key>` (e `file.<x>` para embutidos como `file.name`, `file.folder`, `file.mtime`); tudo dentro de uma **fórmula de filtro** ou de um **bloco `plainva`** usa a chave de frontmatter sem prefixo.

### Chaves de nível superior

- **`filters`** — quais notas pertencem a este banco de dados. No Plainva, isso contém apenas as **fontes** (pasta/tag); as condições de filtro de propriedade são armazenadas por visualização em `views[i].filters`. Veja [Filtros](#filtros).
- **`properties`** — o esquema de colunas, indexado pelo id da propriedade. Subchaves nativas do Obsidian como `displayName` (rótulo do cabeçalho da coluna) são permitidas e preservadas; toda a riqueza do Plainva vive sob `properties[id].plainva`.
- **`views`** — uma lista ordenada de visualizações. Cada uma precisa de `name` e `type`.
- **`formulas`** — um recurso do Obsidian. O Plainva não cria essas entradas, mas as preserva intocadas.

### O mapa de subchaves `plainva:`

Tudo o que é específico do Plainva tem namespace. Três locais:

**`properties[<note.key>].plainva`** — por coluna:

| Chave | Valor | Significado |
|---|---|---|
| `input` | um dos tipos de entrada abaixo | O tipo de campo da coluna |
| `options` | lista de objetos de opção | Valores selecionados para seleção/status/seleção múltipla |
| `relationBase` | caminho `.base` vault-relativo | Banco de dados de destino da relação (veja [Relações](#relações-o-contrato-de-duas-vias)) |
| `relationLimit` | `one` | Cardinalidade: link único. Omita para ilimitado. |
| `reverseOf` | `{ base, property }` | Marca uma coluna de **relação reversa calculada** (sem `input`) |

**`views[i].plainva`** — por visualização:

| Chave | Valor | Significado |
|---|---|---|
| `render` | `board` / `calendar` / `timeline` | Tipo de visualização exclusivo do Plainva (veja abaixo) |
| `groupBy` | chave de propriedade sem prefixo | Coluna de agrupamento do quadro |
| `dateField` | chave de propriedade sem prefixo | Data de início do calendário/linha do tempo |
| `endField` | chave de propriedade sem prefixo | Data de término da linha do tempo |
| `coverImage` | chave de propriedade sem prefixo | Propriedade de imagem de capa da galeria |
| `subItemsProperty` | chave de propriedade sem prefixo | Coluna pai de autorrelação para o aninhamento de subitens |
| `widths` | mapa de id → px | Larguras de coluna |
| `dateFormat` | string | Formato de data por visualização (`default` é implícito — omita) |

Além do bloco `plainva`, uma visualização pode carregar um objeto nativo **`views[i].filters`** — os **filtros de propriedade por visualização** (a mesma gramática de raiz única `and`/`or`/`not` do `filters` no nível do arquivo). O Plainva armazena aqui as regras de filtro de propriedade, um conjunto por visualização, de modo que cada visualização filtra de forma independente; o `filters` no nível do arquivo então mantém apenas as fontes. O Obsidian aplica `views[i].filters` nativamente, por visualização.

**`views[0].plainva`** — chaves válidas para o arquivo inteiro, permitidas **somente na primeira visualização**:

| Chave | Valor | Significado |
|---|---|---|
| `fileIconColor` | cor hex | Tonalidade do ícone do banco de dados (árvore/abas/cabeçalho) |
| `newItemFolder` | pasta vault-relativa | Onde o botão "Novo" armazena novos itens |
| `newItemTemplate` | caminho `.md` vault-relativo | Modelo padrão para novos itens |
| `contextFilters` | lista de chaves de propriedade simples | Filtros de autorreferência ("Esta nota") — veja abaixo |

`contextFilters` é o equivalente do Plainva ao filtro "this page" do Notion. Cada entrada é uma chave de propriedade; quando o banco de dados está incorporado em uma nota, suas linhas ficam filtradas para essa nota hospedeira através dessa propriedade (resolvido através do índice de links — uma propriedade de relação própria ou de link wiki simples corresponde a linhas que apontam para o hospedeiro, uma coluna reversa calculada corresponde ao que o hospedeiro aponta). Ele deliberadamente **não** é gravado nos `filters` nativos, então o Obsidian o ignora e mostra todas as linhas; se aberto de forma autônoma no Plainva, ele também é descartado (sem hospedeiro) e mostra todas as linhas. Várias entradas se combinam com E.

### Tipos de entrada

`plainva.input` é um dos seguintes:

```
text  number  checkbox  date  datetime
select  status  multiselect
list  tags  url  email  phone
relation
```

Uma coluna calculada de **relação reversa** **não tem** `input` — ela é identificada apenas por `reverseOf`.

### Opções e cores

Colunas de Seleção/Status/Seleção múltipla podem carregar uma lista de opções selecionadas. Cada opção:

```yaml
options:
  - value: Open          # required
    color: amber         # optional palette name (see below)
    group: Active        # optional; STATUS only — orders options into stages
  - value: Done
    color: green
    group: Closed
```

`color` é um **nome de paleta**, não uma cor CSS. Nomes válidos: `gray`, `teal`, `blue`, `green`, `amber`, `coral`, `purple`, `pink`. Uma cor desconhecida recorre a uma cor derivada do valor.

### Tipos de visualização

`views[i].type` em disco é um tipo nativo do Obsidian. Renderizações exclusivas do Plainva são escritas como `type: table` mais uma dica `plainva.render`, para que o Obsidian as degrade a uma tabela simples:

| Você quer | `type` em disco | `plainva.render` |
|---|---|---|
| Tabela | `table` | — |
| Lista | `list` | — |
| Galeria | `cards` | — |
| Quadro | `table` | `board` |
| Calendário | `table` | `calendar` |
| Linha do tempo | `table` | `timeline` |

### Filtros

`filters` seleciona quais notas estão no banco de dados e as restringe.

**Condições de fonte** decidem a associação:

- Pasta: `file.folder == "Path/To/Folder"` (vault-relativa; a pasta raiz é `""`).
- Tag: `file.hasTag("project")` (sem `#` à frente).

Múltiplas fontes são simplesmente múltiplas entradas. Nenhum `filters` = toda nota no vault.

**Onde vivem as condições de propriedade:** no nível do arquivo, `filters` se aplica a todas as visualizações. O Plainva, em vez disso, armazena as regras de filtro de propriedade **por visualização** em `views[i].filters` (mesma estrutura de raiz única) e mantém apenas as fontes no nível do arquivo, de modo que cada visualização possa filtrar de forma independente. Ambos são válidos para o Obsidian; uma ferramenta pode escrever qualquer um dos dois. Um arquivo legado com condições de propriedade no nível do arquivo continua funcionando — o Plainva as distribui para cada visualização no próximo salvamento.

**Condições de propriedade** usam nomes de propriedade sem prefixo e estes operadores:

| Operador | Expressão |
|---|---|
| igual a | `status == "Done"` |
| diferente de | `status != "Done"` |
| contém | `contains(labels, "urgent")` |
| não contém | `!contains(labels, "urgent")` |
| maior / menor | `priority > "2"`, `priority < "5"` |
| no mínimo / no máximo | `priority >= "2"`, `priority <= "5"` |
| está vazio | `status == ""` |
| não está vazio | `status != ""` |

**Estrutura (com raiz única!):** um entre `and` / `or` / `not`, cujas entradas são strings de condição — ou um nível de objetos de grupo aninhados `{and:[...]}` / `{or:[...]}` (grupos ao estilo Notion). Exemplo combinando uma fonte, uma condição e um grupo OU:

```yaml
filters:
  and:
    - 'file.folder == "Projects"'
    - 'status != "Done"'
    - or:
        - 'priority == "1"'
        - 'priority == "2"'
```

### Uma `.base` completa e comentada

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

## Relações (o contrato de duas vias)

Uma relação vincula notas entre si. Isto é o que mais gera erros ao escrever à mão, porque se estende por **três** lugares. Mantenha os três consistentes.

1. **O valor vive no frontmatter da nota de origem**, como um link wiki (ou uma lista deles):

   ```markdown
   ---
   type: Task
   project: "[[Project Alpha]]"
   ---
   ```

2. **A `.base` de origem declara a coluna de relação** (`relationBase` = o banco de dados de destino; `relationLimit: one` para um único link):

   ```yaml
   properties:
     note.project:
       plainva:
         input: relation
         relationBase: Projects.base
         relationLimit: one
   ```

3. **A `.base` de destino pode mostrar o inverso** com uma coluna **calculada**. Seus valores **não** são armazenados em lugar nenhum — são derivados dos links das notas de origem:

   ```yaml
   properties:
     note.tasks:
       plainva:
         reverseOf:
           base: Tasks.base       # the source .base (vault-relative path)
           property: project      # the BARE source property key
   ```

### Exemplo prático: Tarefas ↔ Projetos

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

Resultado: em `Projects.base`, a coluna calculada `tasks` de **Project Alpha** lista "Write proposal", porque o `project` dessa tarefa aponta de volta para ela. Note que `Project Alpha.md` **não tem** chave `tasks:` — o lado reverso é calculado, nunca armazenado.

### O que NÃO fazer com relações

- **Não escreva valores reversos em notas.** Uma coluna `reverseOf` é calculada. Escrever uma chave `tasks:` em `Project Alpha.md` está errado e não sobrevive a um ciclo de ida e volta.
- **Garanta que os destinos do link resolvam.** `"[[Project Alpha]]"` precisa corresponder a um nome de nota existente, ou o link aparece como quebrado.
- **Mantenha os caminhos vault-relativos**, com barras normais e sem `./` à frente (`Projects.base`, `DB/Projects.base`).
- **`reverseOf.property` é a chave de origem sem prefixo** (`project`), não `note.project`.

### Autorrelações e subitens

Para uma relação cujo destino é o mesmo banco de dados, aponte `relationBase` para essa mesma `.base`. Para aninhar filhos sob pais em uma visualização de tabela, defina `views[i].plainva.subItemsProperty` como a chave de relação pai sem prefixo. Ciclos são tratados; com subitens desativados, as linhas permanecem planas e os valores são mantidos.

---

## `index.md` (sumário de uma pasta)

`index.md` é um nome reservado para o sumário de uma pasta.

- **Somente o `index.md` da raiz pode carregar frontmatter**, e apenas `okf_version` (ele marca o vault como ativo no OKF). Um `index.md` fora da raiz precisa ser **livre de frontmatter** — frontmatter ali é uma violação de nome reservado.
- Um `index.md` **gerenciado** pelo Plainva termina com o marcador `<!-- plainva:index generated -->` (um comentário HTML, invisível no modo de leitura). Sua presença significa que o Plainva mantém o arquivo atualizado automaticamente. Se você editar esse arquivo à mão, preserve o marcador (e mantenha a forma gerada) ou remova-o deliberadamente para assumir o arquivo permanentemente.
- Listagens geradas são seções de links no formato `* [Título](url/relativa) - descrição`.

Se você estiver gerando uma visão geral de pasta à mão, a escolha segura é **não** adicionar o marcador — assim o Plainva nunca a sobrescreverá.

---

### Visualizações de grafo (`plainva.render: "graph"`)

Uma visualização de grafo é armazenada como qualquer visualização não nativa: `type: table` mais a dica de renderização. Suas opções vivem no MESMO namespace `views[i].plainva`:

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
      graphShowIncoming: true      # relações de OUTROS bancos de dados que apontam para cá (por exemplo, as tarefas de um projeto)
```

Todas as chaves de opção do grafo são opcionais; omita-as inteiramente quando não definidas. O Obsidian renderiza o mesmo arquivo como uma tabela simples e não deve gerar erro.

Uma visualização de **Quadro** (`plainva.render: "board"`) também pode carregar `views[i].plainva.boardColumnOrder` — uma lista de chaves de coluna de grupo (`__UNGROUPED__` marca a coluna sem valor) que lembra uma ordem manual de colunas. Quadros de Seleção/Status, em vez disso, reordenam as `options` da propriedade. Omita a chave quando não definida.

## O que não tocar e segurança

- **`.plainva/`** guarda backups e estado interno. Nunca leia lógica de programa dali nem escreva ali.
- **Chaves desconhecidas são sagradas.** Ao reescrever uma `.base` ou uma nota, carregue adiante toda chave que você não pretendia alterar. O próprio Plainva preserva chaves desconhecidas de `.base` por meio de uma cópia bruta interna; um escritor de terceiros deve fazer o mesmo (analisar → alterar apenas o que você pretende → serializar).
- **Os valores mudam na nota, não na `.base`.** Para definir uma célula, edite o frontmatter da nota. A `.base` só decide quais notas e colunas são exibidas.
- **Não adicione chaves de nível superior em `.base`** além de `filters` / `formulas` / `properties` / `views`.
- **Codificação:** UTF-8 sem BOM, quebras de linha LF, em todos os lugares.

## Veja também

- [Notas & Markdown](Notes_and_Markdown.md) — o mesmo material sob o ângulo de escrever à mão no app
- [Bancos de Dados (.base)](Databases_Base.md) — bancos de dados explicados para o uso do dia a dia
- [OKF](OKF.md) — `type`, `okf_version`, index.md e a conversão do vault
