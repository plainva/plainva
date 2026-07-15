# Tarefas

Última revisão: 2026-07-15

A visualização de Tarefas reúne todas as caixas de seleção do seu vault em um só lugar: todos os itens de lista `- [ ]` e `- [x]` de todas as suas notas, agrupados pela nota a que pertencem. É a visualização "o que ainda preciso fazer?" sobre Markdown puro — sem plugin, sem arquivo especial.

## Por que uma visualização separada (e não um `.base`)

Um [banco de dados (`.base`)](Databases_Base.md) funciona sobre notas inteiras — uma linha por nota. Uma caixa de seleção é uma única *linha* dentro de uma nota, e uma nota pode conter várias delas, então um `.base` não consegue listá-las. A visualização de Tarefas é baseada em linhas: ela lê as linhas de tarefa diretamente, então uma única nota de projeto com dez subtarefas mostra as dez.

## Abrindo a visualização de Tarefas

- Clique no **ícone de lista de verificação** na barra de ações à extrema esquerda, ou
- abra a **paleta de comandos** (`Ctrl/Cmd+P`) e execute **Abrir tarefas**.

Ela abre como uma aba, como qualquer nota.

## Lendo a lista

As tarefas são agrupadas por nota; o título da nota é um cabeçalho no qual você pode clicar para abrir a nota. Cada tarefa mostra sua caixa de seleção e seu texto, ficando tachada assim que é concluída. Uma **data de vencimento** escrita como `📅 2026-08-01` na linha da tarefa aparece como um pequeno emblema.

## Filtragem

A barra no topo restringe a lista:

- **Abertas / Concluídas / Todas** — pelo estado da caixa de seleção (começa em **Abertas**).
- **Filtrar tarefas…** — texto livre; corresponde ao texto da tarefa.
- **Todas as pastas** — apenas tarefas na pasta escolhida (e suas subpastas).
- **Todas as tags** — apenas tarefas com uma `#tag` inline escolhida.
- **Com vencimento** — apenas tarefas que têm uma data `📅`.

Tags e datas de vencimento são lidas diretamente da linha da tarefa — por exemplo, `- [ ] Pagar fatura #finance 📅 2026-08-01`.

## Marcando tarefas como concluídas

Clique na **caixa de seleção** de uma tarefa para alternar entre aberta e concluída. A alteração é gravada diretamente de volta na nota (como uma escrita de arquivo normal e segura — apenas o caractere `[ ]`/`[x]` muda), então a nota, o Obsidian e qualquer sincronização permanecem em sintonia. Clique no **texto** da tarefa em vez disso para abrir a nota e pular até aquela linha.

Se uma nota mudou desde que a lista foi construída, uma alternância desatualizada é ignorada e a lista é atualizada — use o botão **Atualizar** no canto superior direito para recarregar a qualquer momento.

## Compatibilidade com o Obsidian

As tarefas são caixas de seleção comuns do GFM (GitHub-Flavored Markdown). O Plainva nunca adiciona uma sintaxe especial: as mesmas linhas `- [ ]` são renderizadas como caixas de seleção no Obsidian e são lidas corretamente em qualquer editor. As convenções `📅 data` e `#tag` são o estilo comum do Obsidian-Tasks, mas são apenas texto na sua nota.

## Veja também

- [Notas & Markdown](Notes_and_Markdown.md) — escrevendo listas de tarefas no editor
- [Busca](Search.md) — busca de texto completo em todo o vault
- [Bancos de Dados (.base)](Databases_Base.md) — bancos de dados no nível da nota
