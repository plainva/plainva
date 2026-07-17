# Tarefas

Última revisão: 2026-07-17

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

## Banco de tarefas padrão

Caixas de seleção são rápidas de anotar, mas às vezes uma linha cresce até virar uma tarefa "de verdade" — com um status, uma data de vencimento e uma nota própria. Para isso, escolha um **Banco de tarefas padrão** em **Configurações → Vault → Conteúdo e estrutura**: um [banco de dados (`.base`)](Databases_Base.md) onde essas tarefas vivem como notas próprias. **Criar banco de dados…** já cria um pronto para uso (uma pasta de armazenamento e uma `.base` com uma **coluna de caixa de seleção de concluído** (`feito`), uma coluna de status, uma coluna de vencimento, uma visualização de tabela e uma de quadro); você também pode simplesmente escolher um banco de dados já existente. A propriedade da caixa de seleção é a verdade de conclusão da tarefa (ligada/desligada, assim como nos provedores); a coluna de status é mantida consistente quando você a marca como concluída. Um banco de dados sem uma coluna de caixa de seleção recorre à convenção de status: primeira opção = aberta, última = concluída.

Uma vez definido, a visualização de Tarefas mostra duas seções: no topo, as entradas do **Banco de tarefas**, e abaixo, **Das notas** — a familiar lista de caixas de seleção. O status é editável direto na visão geral: a caixa de seleção É a propriedade de caixa de seleção de concluído da nota e a alterna (a coluna de status a acompanha), e clicar no chip de status abre um menu com todas as opções (**Alterar status**). Os filtros **Abertas**/**Concluídas**/**Todas** se aplicam a ambas as seções, e **Abrir como banco de dados** leva à visualização completa do banco de dados, com seu quadro e filtros. **Atualizar** também dispara uma sincronização de verdade com o provedor quando há contas conectadas.

## Transformando uma caixa de seleção em uma tarefa de banco de dados

Toda linha de tarefa traz um ícone de banco de dados: **Mover para o banco de tarefas**. Um clique

- cria uma nova nota na pasta de armazenamento do banco de dados (usando seu modelo padrão, se houver um definido),
- leva a data `📅` para a coluna de vencimento, define a primeira opção de status para tarefas abertas e grava as `#tags` da linha como tags da nota,
- vincula a nova nota de volta à nota de origem por meio de uma propriedade `source`, e
- substitui a linha da caixa de seleção na nota de origem por um link wiki para a nova nota de tarefa — o item continua legível onde foi escrito, e a tarefa agora vive no banco de dados.

**Clique com o botão direito** no ícone para escolher outro banco de dados como destino; sem um banco de tarefas padrão definido, o clique já abre esse seletor imediatamente. Tudo permanece Markdown puro: a nova tarefa é uma nota comum com frontmatter, e o link na nota de origem é um `[[wiki link]]` normal.

## Ocultando notas da visualização de Tarefas

Algumas notas contêm caixas de seleção que nunca são tarefas "reais" — **modelos**, acima de tudo. Para mantê-las fora da lista, uma nota pode se excluir. A verdade permanece no arquivo: a exclusão é um campo de frontmatter na nota, não uma configuração oculta do app. Ela sincroniza, é visível no Obsidian e pode ser verificada com qualquer editor de texto:

```yaml
---
plainva:
  tasks: false
---
```

Você não precisa escrever esse campo manualmente:

- **Ocultar das tarefas** — um ícone de olho fica à direita da linha de cabeçalho de cada nota; um clique grava o marcador nessa nota e a oculta.
- **Mostrar ocultas** — esta opção na barra de filtros traz de volta as notas ocultas (esmaecidas), cada uma com um ícone para **Mostrar nas tarefas novamente** (que remove o marcador).
- **Ocultar modelos** — se sua pasta de modelos contém notas com caixas de seleção, um botão **Ocultar modelos** aparece no canto superior direito e grava o marcador em todas elas de uma só vez.

Modelos recém-criados carregam o marcador automaticamente. Quando você cria uma nota **a partir de** um modelo, ele é removido novamente — a nova nota é conteúdo real e mostra suas tarefas normalmente.

## Compatibilidade com o Obsidian

As tarefas são caixas de seleção comuns do GFM (GitHub-Flavored Markdown). O Plainva nunca adiciona uma sintaxe especial: as mesmas linhas `- [ ]` são renderizadas como caixas de seleção no Obsidian e são lidas corretamente em qualquer editor. As convenções `📅 data` e `#tag` são o estilo comum do Obsidian-Tasks, mas são apenas texto na sua nota.

## Veja também

- [Notas & Markdown](Notes_and_Markdown.md) — escrevendo listas de tarefas no editor
- [Busca](Search.md) — busca de texto completo em todo o vault
- [Bancos de Dados (.base)](Databases_Base.md) — bancos de dados no nível da nota
