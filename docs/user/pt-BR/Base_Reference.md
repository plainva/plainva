# Referência de Bancos de Dados (.base)

Última revisão: 2026-11-03

Esta página lista tudo o que um arquivo `.base` pode conter e o que o Plainva faz com cada parte: cada chave de nível superior, cada forma de filtro, cada tipo de visualização com suas opções, resumos, ordenação, limites, o que acontece com chaves que o Plainva não conhece e onde o Plainva se comporta de forma diferente do Obsidian Bases. Ela descreve o que o código do Plainva lê, avalia e grava hoje — não a documentação do Obsidian.

Para o uso no dia a dia, leia primeiro [Bancos de Dados (.base)](Databases_Base.md). As regras que uma ferramenta deve respeitar ao gravar arquivos do vault diretamente, e o exemplo completo de relações, estão na [Referência do Formato de Arquivo](File_Format_Reference.md).

## Visão geral

| Parte do arquivo | O que o Plainva faz |
|---|---|
| `filters` | Lê e aplica as fontes (pasta, tag) e as condições listadas em [Filtros](#filtros) |
| `views` | Lê os oito tipos de visualização, sua ordem, ordenação, filtros e resumos |
| `properties` | Lê o esquema de colunas, o nome de exibição e o bloco `plainva` do Plainva |
| `summaries` (visualização) | Calcula os catorze resumos internos |
| `formulas` | Mantém no arquivo, não calcula |
| `summaries` (nível superior) | Mantém as fórmulas de resumo personalizadas, não as calcula |
| `this` | Ainda não é suportado |
| Outras chaves | Mantém no arquivo (veja [Chaves que o Plainva não conhece](#chaves-que-o-plainva-não-conhece)) |

## Chaves de nível superior

Um arquivo `.base` é YAML com estas chaves de nível superior. Todas são opcionais; um arquivo sem `views` abre com uma tabela.

| Chave | Conteúdo | No Plainva |
|---|---|---|
| `filters` | Quais notas pertencem ao banco de dados (fontes) | Lida e aplicada |
| `properties` | Uma entrada por coluna, identificada pelo id da propriedade | Lida; os acréscimos do Plainva ficam no seu bloco `plainva` |
| `views` | A lista de visualizações | Lida; toda visualização precisa de um `name` |
| `formulas` | Fórmulas do Obsidian, `name: expression` | Mantidas sem alteração, não calculadas |
| `summaries` | Fórmulas de resumo personalizadas do Obsidian | Mantidas sem alteração, não calculadas |

O Plainva nunca grava outra chave de nível superior: o Obsidian se recusa a abrir um `.base` com uma chave que ele não conhece. Uma chave `columns:` de nível superior gravada por versões muito antigas do Plainva ainda é lida e movida para `properties` na próxima vez que o arquivo for salvo.

## Propriedades (`properties`)

### Ids de propriedade

Um id de propriedade dá nome a uma coluna. Existem três tipos:

| Id | Significa | Exemplo |
|---|---|---|
| `note.<key>` | Uma chave do frontmatter das notas | `note.status` |
| `file.<field>` | Um dado sobre o arquivo (veja [Campos de arquivo](#campos-de-arquivo-file)) | `file.mtime` |
| `formula.<name>` | Uma fórmula do Obsidian de `formulas` | `formula.price_per_unit` |

As chaves de `properties`, o `order` de uma visualização e `sort[].property` usam esses ids. Dentro de uma expressão de filtro e dentro de um bloco `plainva`, uma chave de frontmatter é escrita sem prefixo (`status`); uma expressão de filtro entende `note.status` também.

Quando uma nota escreve uma chave com maiúsculas e minúsculas diferentes da coluna (`Due` contra a coluna `due`), o Plainva ainda mostra o valor nessa coluna e grava as alterações de volta com a grafia da própria nota.

### Nome de exibição

`properties.<id>.displayName` é o rótulo de coluna do Obsidian. O Plainva o mostra como cabeçalho da coluna e o mantém. Sem ele, uma chave de frontmatter é mostrada com a primeira letra maiúscula (apenas na tela); os campos de arquivo têm nomes próprios, por exemplo **Nome**, **Modificado**, **Tamanho**, **Caminho**, **Lista de tarefas** e **Dia do nome do arquivo**.

### O bloco `plainva` de uma coluna

Tudo o que o Plainva acrescenta a uma coluna fica em `properties.<id>.plainva`. O Obsidian o ignora.

| Chave | Valor | Significado |
|---|---|---|
| `input` | um tipo de campo (lista abaixo) | O tipo de campo da coluna |
| `ratingMax` | número, de 1 a 10 | Quantas marcas uma avaliação tem (padrão 5) |
| `ratingGlyph` | um caractere | A marca que uma avaliação desenha (padrão um ponto) |
| `options` | lista de opções | Valores fixos para seleção, status e seleção múltipla |
| `relationBase` | caminho de `.base` relativo ao vault | O banco de dados para o qual uma relação aponta |
| `relationLimit` | `one` | Uma relação guarda exatamente um link; ausente significa sem limite |
| `reverseOf` | `{ base, property }` | Uma coluna calculada de relação reversa |
| `rollup` | `{ through, of, fn, where }` | Uma coluna calculada de agregação (veja [Agregações](#agregações)) |
| `previousKeys` | lista de até 8 nomes anteriores | Permite que os comentários encontrem de novo uma coluna renomeada |

### Tipos de campo (`input`)

`text`, `number`, `rating`, `checkbox`, `date`, `datetime`, `select`, `status`, `multiselect`, `list`, `tags`, `url`, `email`, `phone`, `relation`.

Duas grafias mais antigas também são lidas: `multi-select` como `multiselect` e `link` como `relation`. Uma coluna sem `input` — ou com um valor que não está nesta lista — recebe seu tipo a partir dos valores nas notas: `true`/`false` é uma caixa de seleção, um número é um número, uma lista de `[[links]]` é uma relação, `2026-07-03` é uma data, um endereço da web é uma URL, e assim por diante. Uma coluna de relação reversa e uma coluna de agregação não têm `input`.

### Opções e cores

Uma opção é `{ value, label, color, group }`; apenas `value` é obrigatório. `color` é um dos nomes da paleta `gray`, `teal`, `blue`, `green`, `amber`, `coral`, `purple`, `pink` — um nome desconhecido volta a uma cor derivada do valor. `group` é usado apenas por **Status**: opções com o mesmo grupo formam uma etapa. Um texto simples é lido como uma opção com esse valor.

### Agregações

Uma coluna de agregação calcula um valor a partir das notas para as quais uma coluna de link deste banco de dados aponta. O valor não é armazenado em nenhum arquivo.

- `through` — uma coluna de relação ou de relação reversa deste banco de dados.
- `of` — uma propriedade das notas vinculadas; não é necessária para `count`.
- `fn` — uma de `count`, `countWhere`, `percentWhere`, `sum`, `average`, `median`, `min`, `max`, `earliest`, `latest`, `checked`, `unchecked`, `empty`, `filled`, `unique`.
- `where` — `{ op, value }`, exigido por `countWhere` e `percentWhere`; `op` é um de `==`, `!=`, `contains`, `notContains`, `>`, `<`, `>=`, `<=`, e um `value` vazio significa "está vazio".

Uma agregação à qual falta uma parte obrigatória, ou que nomeia uma função que não está nesta lista, é ignorada: a coluna fica vazia e o banco de dados continua abrindo. Uma agregação através de outra coluna calculada também fica vazia.

## Campos de arquivo (`file.*`)

Estes valores vêm do arquivo, não do seu frontmatter. Cada linha de um banco de dados traz o seguinte:

| Campo | Valor |
|---|---|
| `file.name` | A propriedade `title` da nota, se ela tiver uma; caso contrário, o nome do arquivo sem `.md` |
| `file.path` | O caminho relativo ao vault |
| `file.mtime` | Última modificação, em milissegundos |
| `file.ctime` | Criação, em milissegundos, quando o sistema de arquivos informa |
| `file.size` | Tamanho em bytes |
| `file.tags` | Todas as tags da nota, do frontmatter e do texto, cada uma com `#`; preenchido quando um filtro, um mural ou uma visualização que mostra a coluna ou ordena por ela precisa delas |
| `file.tasks` | Progresso das caixas de seleção como `done/total`; preenchido para quadros e para uma visualização que mostra a coluna |
| `file.day` | O dia que o nome do arquivo de uma nota diária representa, segundo a pasta e o formato do vault; somente leitura, e só o campo de data de um calendário ou de uma linha do tempo pode usá-lo |
| `file.revision` | Um marcador interno de alteração; não conte com ele |

`file.folder` funciona como fonte (veja [Fontes](#fontes)), mas não é uma coluna. `file.basename`, `file.ext`, `file.links`, `file.backlinks`, `file.embeds`, `file.properties` e `file.file` não são fornecidos: uma coluna com um deles fica vazia, e um filtro os lê como vazios.

## Filtros

### Onde ficam os filtros

O `filters` de nível superior contém as **fontes** — quais notas pertencem ao banco de dados. Cada visualização pode ter seu próprio `filters` com condições que restringem apenas essa visualização; o Plainva grava as condições ali. Os dois níveis valem juntos. Condições que um arquivo mantém no nível superior continuam funcionando; o próximo salvamento no Plainva as move para cada visualização.

### Fontes

| Fonte | Expressão |
|---|---|
| Pasta | `file.folder == "Projects/Active"` — a pasta e todas as suas subpastas; `""` e `"/"` são o vault inteiro |
| Tag | `file.hasTag("project")` — a nota traz exatamente esta tag; um `#` no início é ignorado |

Várias fontes se combinam com `and` ou `or` como qualquer outra condição. Um banco de dados sem fontes contém todas as notas do vault. Anexos, os arquivos reservados `index.md` e `log.md`, e arquivos ou pastas cujo nome começa com um ponto nunca são linhas.

### Condições

Uma condição é um texto. Os valores ficam entre aspas duplas; `\"` e `\\` escapam uma aspa e uma barra invertida. A propriedade é escrita sem prefixo ou com `note.`.

| Condição | Expressão |
|---|---|
| é | `status == "Done"` |
| não é | `status != "Done"` |
| contém | `contains(labels, "urgent")` ou `labels.contains("urgent")` |
| não contém | `!contains(labels, "urgent")` ou `!labels.contains("urgent")` |
| maior que, menor que | `effort > "3"`, `effort < "8"` |
| no mínimo, no máximo | `due >= "2026-07-01"`, `due <= "2026-07-31"` |
| está vazio | `status == ""` ou `status.isEmpty()` |
| não está vazio | `status != ""` ou `!status.isEmpty()` |
| tem uma tag | `file.tags.contains("#work")`, negada com `!` |
| cor do cabeçalho, ícone | `note.plainva.header_color == "#2a7f7b"`, `note.plainva.icon == "lucide:pin"` |

### Como os valores são comparados

- **é** e **não é** comparam texto. Em uma lista (tags, seleção múltipla, relação), **é** significa "a lista tem esta entrada", **não é** "ela não tem". Uma nota sem a propriedade nunca corresponde a **é** e sempre corresponde a **não é**.
- **contém** procura o texto dentro do valor, ou dentro de cada entrada de uma lista. `labels.contains("x")` em uma lista exige uma entrada que seja exatamente `x`; em `file.tags` as duas formas exigem a tag inteira, então `#work` não corresponde a `#workshop` nem a `#work/child`.
- **maior que**, **menor que**, **no mínimo**, **no máximo** comparam como números quando os dois lados são números, e caso contrário como texto — o que coloca as datas ISO (`2026-07-03`) na ordem certa. Uma nota sem valor nunca corresponde a eles.
- **está vazio** corresponde a uma propriedade ausente, a um valor vazio e a uma lista vazia.
- Uma caixa de seleção é comparada como `"true"` ou `"false"`.

### `and`, `or`, `not`

Um objeto `filters` tem exatamente um entre `and`, `or` e `not` em cada nível; suas entradas são textos de condição ou outros objetos de filtro.

| Chave | Corresponde quando |
|---|---|
| `and` | todas as entradas correspondem |
| `or` | pelo menos uma entrada corresponde |
| `not` | nenhuma entrada corresponde |

O Plainva avalia qualquer profundidade. O painel de filtros edita um nível de grupos sob **Todas** ou **Qualquer** (**Adicionar grupo**); uma estrutura mais profunda aparece como **Filtro complexo (não editável)**, permanece no arquivo e é aplicada — uma condição dentro dela que o Plainva não consegue ler é indicada abaixo dela como não aplicada. Um arquivo mais antigo com `and` e `or` lado a lado em um mesmo nível é lido como "todas as de `and` e uma das de `or`" e gravado na forma válida no próximo salvamento.

### O que o Plainva não consegue ler

Apenas as formas das duas tabelas acima são compreendidas. Qualquer outra coisa — `file.inFolder(…)`, `file.hasLink(…)`, `file.hasProperty(…)`, um número sem aspas (`price > 2`), `&&` e `||` dentro de um único texto, aritmética, funções de data como `now()`, ou `this` — permanece no arquivo e é mostrada no painel de filtros como foi escrita, com a observação **Não aplicada: o Plainva não consegue ler esta condição, então ela não filtra nada.** A visualização então mostra mais notas do que o mesmo filtro mostra no Obsidian.

## Fórmulas

O Plainva não calcula as fórmulas do Obsidian. `formulas` permanece no arquivo sem alteração, e uma coluna `formula.<name>` no `order` de uma visualização é mostrada sem valores. **Exportar tabela** → **Fórmulas (.base)** grava algumas agregações como fórmulas para que o Obsidian possa calculá-las (veja [Bancos de Dados](Databases_Base.md)).

## Visualizações

### Chaves de toda visualização

| Chave | Valor | No Plainva |
|---|---|---|
| `type` | `table`, `list`, `cards` | O tipo de visualização; veja a tabela seguinte |
| `name` | texto | Obrigatório; o Plainva dá um nome a uma visualização que não tenha um quando salva |
| `order` | lista de ids de propriedade | As colunas visíveis, nesta ordem |
| `sort` | lista de `{ property, direction }` | Regras de ordenação, `ASC` ou `DESC` |
| `filters` | objeto de filtro | As condições próprias da visualização |
| `summaries` | mapa de id de propriedade → nome do resumo | O rodapé de cada coluna |
| `plainva` | mapa | As opções de visualização do Plainva, abaixo |

### Os oito tipos de visualização

O Obsidian conhece `table`, `list` e `cards`. Os demais tipos de visualização do Plainva são armazenados como `type: table` mais `plainva.render`, então o Obsidian os mostra como uma tabela.

| Tipo de visualização | `type` no disco | `plainva.render` |
|---|---|---|
| **Tabela** (`table`) | `table` | — |
| **Lista** (`list`) | `list` | — |
| **Galeria** (`gallery`) | `cards` | — |
| **Quadro** (`board`) | `table` | `board` |
| **Calendário** (`calendar`) | `table` | `calendar` |
| **Linha do tempo** (`timeline`) | `table` | `timeline` |
| **Grafo** (`graph`) | `table` | `graph` |
| **Mural** (`pinboard`) | `table` | `pinboard` |

Quadro, Calendário, Linha do tempo, Grafo e Mural são oferecidos como **Tipo de visualização** apenas enquanto **Permitir extensões do Plainva para arquivos .base** estiver ativado. Um `type` que o Plainva não conhece é mostrado como uma tabela e permanece no arquivo como foi escrito até que você escolha outro **Tipo de visualização**.

### Opções da visualização (`views[i].plainva`)

Dentro do bloco `plainva`, uma propriedade é escrita sem prefixo (`status`), não como `note.status`.

| Chave | Tipos de visualização | Valor |
|---|---|---|
| `render` | Quadro, Calendário, Linha do tempo, Grafo, Mural | O tipo de visualização, veja acima |
| `groupBy` | Quadro | A propriedade de que as colunas são feitas; sem ela, a propriedade do `groupBy` próprio do Obsidian na visualização |
| `boardLaneBy` | Quadro | Uma segunda propriedade para **Raias por** |
| `boardWipLimits` | Quadro | Mapa de valor da coluna → máximo de cartões (**Limite de WIP**), números inteiros acima de 0 |
| `boardColorMode` | Quadro | `column` tinge a coluna inteira; ausente = apenas o chip do cabeçalho |
| `boardColumnOrder` | Quadro | Ordem manual das colunas; `__UNGROUPED__` é a coluna sem valor |
| `colorBy` | Quadro, Linha do tempo | Cartões e barras assumem a cor da opção desta propriedade (**Cor por**) |
| `dateField` | Calendário, Linha do tempo | A data de início (**Campo de data**, **Data de início**); uma propriedade de data ou `file.day` |
| `endField` | Calendário, Linha do tempo | A **Data de término** |
| `coverImage` | Galeria | A propriedade que guarda a **Imagem de capa** |
| `subItemsProperty` | Tabela | A relação com o item pai para **Subitens** |
| `widths` | Tabela | Mapa de coluna → largura em pixels |
| `dateFormat` | todos | `long`, `iso` ou `relative`; ausente = a forma curta padrão |
| `graphEdges` | Grafo | Propriedades de relação desenhadas como arestas |
| `graphColorBy` | Grafo | Uma propriedade de seleção ou status que colore os nós |
| `graphSizeBy` | Grafo | Uma propriedade numérica que define o tamanho dos nós |
| `graphShowExternal` | Grafo | `true` mostra também destinos de links fora da visualização |
| `graphShowIncoming` | Grafo | `true` mostra também links que chegam de outros bancos de dados |
| `pinboardOrder` | Mural | Caminhos dos cartões não fixados, em ordem manual |
| `pinboardPinned` | Mural | Caminhos dos cartões fixados, em ordem |
| `pinboardFilterBy` | Mural | **Origem dos marcadores**: uma propriedade de seleção múltipla; ausente = tags |

### Opções do arquivo inteiro (só a primeira visualização)

Estas chaves pertencem ao banco de dados inteiro. O Plainva as grava apenas no bloco `plainva` da primeira visualização e lê o primeiro valor válido de cada uma.

| Chave | Valor |
|---|---|
| `fileIconColor` | Cor hexadecimal do ícone do banco de dados (**Cor do ícone do banco de dados**) |
| `newItemFolder` | Pasta onde **Entrada** guarda as novas entradas |
| `newItemTemplate` | Modelo para novas entradas |
| `contextFilters` | Propriedades que limitam um banco de dados incorporado à nota em que ele está incorporado (**Esta nota**) |
| `taskList` | Conta e lista (`"<account id> <list id>"`) em que uma nova tarefa também é criada |

## Resumos

`views[i].summaries` associa uma coluna a um destes nomes; o rodapé o calcula sobre as linhas que a visualização mostra.

| Nome | No Plainva | Resultado |
|---|---|---|
| `Average` | **Média** | Média dos números |
| `Min` | **Mín** | Menor número |
| `Max` | **Máx** | Maior número |
| `Sum` | **Soma** | Total dos números |
| `Range` | **Amplitude** | Maior menos menor número; para datas, o intervalo em dias |
| `Median` | **Mediana** | Valor central dos números |
| `Stddev` | **Desvio padrão** | Desvio padrão de todos os números (populacional) |
| `Earliest` | **Mais antiga** | Data mais antiga |
| `Latest` | **Mais recente** | Data mais recente |
| `Checked` | **Marcadas** | Linhas cujo valor é `true` ou `yes` |
| `Unchecked` | **Não marcadas** | Todas as outras linhas |
| `Empty` | **Sem valor** | Linhas sem valor |
| `Filled` | **Com valor** | Linhas com valor |
| `Unique` | **Distintos** | Número de valores diferentes; as entradas de uma lista contam uma a uma |

Os números são arredondados para duas casas decimais, e uma vírgula decimal também é lida. Uma coluna sem valor utilizável não mostra rodapé em vez de 0. Qualquer outro nome é uma fórmula personalizada do `summaries` de nível superior: o Plainva a mantém e mostra **Personalizado: …** no menu, mas não calcula nenhum valor.

## Ordenação e agrupamento

- **Ordenação** — `sort` é uma lista de regras; a primeira regra decide primeiro, a seguinte apenas entre linhas iguais. Números são ordenados como números, todo o resto como texto (datas ISO na ordem certa). Linhas sem valor vêm por último nas duas direções. Sem nenhuma regra, as notas alteradas mais recentemente vêm primeiro. O Plainva também lê `field` no lugar de `property`, e `asc`/`desc` em qualquer caixa.
- **Agrupamento** — o quadro agrupa por `plainva.groupBy`, com raias por `plainva.boardLaneBy`. Uma visualização que traz, em vez disso, o `groupBy` próprio do Obsidian agrupa seu quadro por essa propriedade, e uma mudança do agrupamento é gravada nele (seu `direction` permanece). O Plainva não agrupa uma tabela por ele.

## Incorporar um banco de dados, e `this`

`![[Projects.base]]` em uma nota mostra o banco de dados dentro da nota, no modo de leitura e no editor. Uma parte depois de `#` (o nome de uma visualização, como em `![[Projects.base#Board]]`) é ignorada: a incorporação mostra a visualização usada por último neste banco de dados. Um bloco de código ` ```base ` em uma nota é mostrado como código, não como um banco de dados.

**`this` ainda não é suportado.** Um filtro ou uma fórmula que usa `this` permanece no arquivo, mas o Plainva não o avalia. Duas coisas cobrem o caso mais comum, "mostrar as entradas que pertencem a esta nota": `contextFilters` (**Esta nota** no painel de filtros) limita um banco de dados incorporado à nota em que ele está incorporado por meio de uma propriedade de relação, e um banco de dados incorporado que se relaciona com o banco de dados da sua nota hospedeira oferece por si só **Filtrar este banco de dados pela nota atual**. As duas agem apenas dentro do Plainva; o Obsidian mostra todas as linhas.

## Limites

- O `limit` do Obsidian em uma visualização é mantido, mas não aplicado: uma visualização mostra todas as suas linhas.
- O painel de filtros edita um nível de grupos de filtro; os mais profundos são aplicados, mas ali só podem ser excluídos.
- Um valor de filtro precisa estar entre aspas duplas (veja [O que o Plainva não consegue ler](#o-que-o-plainva-não-consegue-ler)).
- Uma fonte de pasta sempre inclui as subpastas.
- `ratingMax` é desenhado entre 1 e 10, `previousKeys` guarda no máximo 8 nomes, um **Limite de WIP** só aceita números inteiros acima de 0, e `relationLimit` só conhece `one`.
- Uma agregação não pode calcular sobre outra coluna calculada.

## Chaves que o Plainva não conhece

O Plainva lê um `.base`, altera apenas o que você alterou no app e grava o arquivo inteiro de novo — como YAML com fins de linha LF e sem BOM, então comentários e o espaçamento de um arquivo escrito à mão não são mantidos. Do que ele não conhece:

- **Mantido:** qualquer outra chave de nível superior, `formulas`, o `summaries` de nível superior, `displayName` e toda outra chave de uma entrada de `properties`, chaves desconhecidas no bloco `plainva` de uma coluna ou de uma visualização, uma agregação que o Plainva não consegue ler, as chaves de uma visualização que o Plainva não usa (`limit`, `image`, …), um tipo de visualização que ele não conhece e condições de filtro que ele não consegue ler. Um valor que o Plainva entende, mas que você não alterou, mantém a grafia do arquivo (`status` ou `note.status`, uma opção escrita como texto simples).
- **Reescrito:** apenas as formas antigas do próprio Plainva — um mapa `columns:` de nível superior passa para `properties`, `and` e `or` lado a lado em um mesmo nível assumem a forma válida, e uma visualização que versões muito antigas salvaram como `type: board` passa a ser `type: table` com `plainva.render`.
- **Posição:** as chaves que uma visualização mantém pertencem a essa visualização. Excluir ou mover uma visualização no Plainva as leva junto, e **Duplicar** as copia para a nova visualização.

## Diferenças em relação ao Obsidian Bases

| Assunto | Obsidian | Plainva |
|---|---|---|
| Fórmulas, resumos personalizados | Calculados | Mantidos, não calculados |
| `this` | Suportado | Ainda não suportado |
| Expressões de filtro | A linguagem de expressões completa | As formas em [Condições](#condições) |
| `file.folder == "X"` | Apenas notas diretamente em `X` | `X` e todas as suas subpastas |
| `file.hasTag("x")` | Também `#x/child` | Exatamente `#x` |
| `file.name` | O nome do arquivo | A propriedade `title`, se a nota tiver uma |
| `limit`, `groupBy` da visualização | Aplicados | `limit` mantido, não aplicado; `groupBy` agrupa um quadro, não uma tabela |
| Tipos de visualização | `table`, `list`, `cards` e tipos de plugins | Oito tipos; um desconhecido é mostrado como tabela e mantido no arquivo |
| `![[db.base#View]]` | Abre essa visualização | A visualização usada por último |
| Bloco de código ` ```base ` | Um banco de dados | Um bloco de código |
| Blocos `plainva` do Plainva | Ignorados | Quadro, calendário, linha do tempo, grafo, mural, relações, agregações, tipos de campo |

## Veja também

- [Bancos de Dados (.base)](Databases_Base.md) — bancos de dados no uso diário
- [Referência do Formato de Arquivo](File_Format_Reference.md) — as regras em disco para ferramentas, relações nos dois sentidos, `index.md`
- [Notas & Markdown](Notes_and_Markdown.md) — propriedades em uma nota
