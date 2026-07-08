# Bancos de Dados (.base)

Stand: 2026-07-08

Com arquivos `.base` você transforma notas em bancos de dados: tabelas, quadros, calendários — com filtros, propriedades tipadas e relações entre bancos de dados. O conceito lembra os bancos de dados do Notion, com uma diferença decisiva: **os dados não vivem no banco de dados, eles vivem nas suas notas.**

> **Dica:** Se você criar um novo vault a partir do modelo **PARA**, **GTD**, **Zettelkasten** ou **Journal** (veja [Primeiros Passos](Getting_Started.md)), bancos de dados correspondentes já vêm configurados e vinculados entre si — um bom ponto de partida para ver como tudo se encaixa.

## O conceito central

Um arquivo `.base` armazena apenas a *visualização* das suas notas: quais fontes (pastas, tags), quais visualizações, quais filtros e colunas. Os valores em si vivem no frontmatter das notas individuais em Markdown — cada linha da tabela *é* uma nota.

Concretamente, isso significa que:

- Ao editar uma célula na tabela, o Plainva grava o valor no frontmatter da nota.
- Ao excluir o arquivo `.base`, você perde apenas a visualização — todos os dados permanecem nas notas.
- As mesmas notas podem aparecer em qualquer número de bancos de dados ao mesmo tempo.

O formato do arquivo é compatível com o formato Bases do Obsidian (detalhes ao final desta página).

## Criando um banco de dados

- **Árvore de arquivos**: clique com o botão direito → **Novo banco de dados (.base)** — ou pelo botão **Novo** da barra lateral (**Nova base**).
- O assistente **Novo banco de dados** pergunta duas coisas: a **Fonte de dados** (pelo menos uma **Pasta** ou uma **Tag**; combiná-las restringe ainda mais o resultado — um contador ao vivo mostra quantas notas correspondem) e as colunas (propriedades encontradas nas notas correspondentes, prontas para adotar). Depois **Criar banco de dados**.
- **Dentro de uma nota**: comando de barra **Incorporar banco de dados** (mostrar um `.base` existente embutido) ou **Criar banco de dados embutido** (criar um novo `.base` na pasta e incorporá-lo).

Todo banco de dados pode ter seu próprio ícone com uma **Cor do ícone do banco de dados** — visível na árvore de arquivos, nas abas e no cabeçalho.

## Visualizações

Um banco de dados pode ter qualquer número de visualizações; cada uma tem um **Tipo de visualização**:

| Visualização | Para que serve |
|---|---|
| **Tabela** | Grade clássica, ordenável, com edição inline e subitens opcionais |
| **Lista** | Lista compacta de linhas |
| **Galeria** | Cartões com uma **Imagem de capa** opcional |
| **Quadro** | Colunas Kanban agrupadas por uma propriedade (**Agrupar por**) — arrastar cartões entre colunas altera o valor; arrastar um **cabeçalho de coluna** reordena as colunas |
| **Calendário** | Itens por **Campo de data** em um calendário mensal, arrastáveis |
| **Linha do tempo** | Eixo temporal com **Data de início** e **Data de término** opcional |

**Adicionar visualização** cria mais; **Opções da visualização** oferece **Renomear**, **Duplicar**, **Excluir** e reordenação por arrastar. O Plainva lembra qual foi a última visualização ativa por arquivo. Calendário e Linha do tempo precisam de um campo de data (**Somente data** ou **Data e hora** como **Formato**); os itens exibem os campos ativados em **Propriedades**.

## Configurar: fontes, filtros, ordenação, propriedades

O botão **Configurar** (no canto superior direito) abre o painel com quatro áreas:

- **Fonte de dados** — as fontes de pasta e tag do banco de dados (a **Pasta raiz** também pode ser selecionada). Sem fonte = todos os arquivos.
- **Filtro** — linhas de regra compostas por propriedade, operador e valor. Os operadores se adaptam ao tipo de campo: **é** / **não é** / **contém** / **não contém** / **está vazio** / **não está vazio**, para números **maior que** / **menor que** / **no mínimo** / **no máximo**, para datas **depois de** / **antes de** / **a partir de** / **até**. A **Lógica** no topo decide se **Todas** as condições (E) ou **Qualquer** (OU) devem ser atendidas. **Adicionar grupo** cria grupos de filtro ao estilo Notion: um bloco com sua própria lógica E/OU dentro da lógica principal. Filtros profundamente aninhados vindos do Obsidian aparecem como **Filtro complexo (não editável)** — eles são mantidos e aplicados. Os filtros são salvos **por visualização** (o painel indica **Aplica-se a esta vista**): cada visualização mantém suas próprias regras de filtro, enquanto a **Fonte de dados** (pastas/tags) permanece compartilhada em todo o banco de dados. Tudo vive no arquivo `.base`, não em um repositório separado.
- **Ordenação** — várias regras de ordenação (**Crescente**/**Decrescente**); altere a prioridade delas arrastando.
- **Propriedades** — mostrar/ocultar colunas, arrastar para reordenar, criar uma **Nova propriedade**.

## Propriedades e tipos de campo

Clicar no cabeçalho de uma coluna abre o editor de propriedade (**Propriedade: X**):

- **Nome** — renomear afeta as notas: ao salvar, a propriedade é renomeada no frontmatter de todas as notas correspondentes (com confirmação e um indicador de progresso).
- **Tipo de campo** — Texto, Número, Caixa de seleção, Data, Data e hora, Lista, Tags, Seleção, Status, Seleção múltipla, URL, E-mail, Telefone, Relação (o mesmo menu de tipo agrupado do painel de **Propriedades** das notas).
- **Opções** (para Seleção/Status/Seleção múltipla) — valores fixos com uma **Cor** e, para **Status**, um **Grupo**/etapa (por exemplo, a fazer → em andamento → concluído); reordene arrastando. Ao abrir o editor de propriedade, a lista de opções já vem preenchida com os valores já usados no banco de dados, para que você possa atribuir uma cor a cada um sem precisar digitá-lo novamente.
- **Excluir propriedade** — remove a coluna, o esquema, os filtros e as regras de ordenação do banco de dados. A caixa de seleção **Também remover do frontmatter das notas** (ativada por padrão) limpa adicionalmente as notas de origem.

Notas de comportamento:

- Se uma propriedade estiver ausente em algumas notas, o Plainva oferece **adicioná-la (vazia) a N arquivos de origem**.
- Para **Seleção**, **Status**, **Seleção múltipla**, **Lista** e **Tags**, uma vírgula em um valor separa várias entradas; no tipo **Texto**, uma vírgula permanece texto simples.
- Os campos de sistema do OKF `type` e `okf_version` também são protegidos aqui: nome, tipo de campo e exclusão ficam travados, e as células de `okf_version` são somente leitura (contexto: [OKF](OKF.md)).

## Relações

Relações conectam notas entre si — como no Notion, mas armazenadas como `[[wiki links]]` perfeitamente normais no frontmatter (visíveis no Obsidian como links de propriedade clicáveis).

- **Criando**: adicione uma propriedade do tipo de campo **Relação**. Opcionalmente, escolha um **Banco de dados de destino (.base)** — o seletor então só sugere notas desse banco de dados (vazio = **Qualquer nota**; **Este banco de dados** habilita autorrelações). A **Cardinalidade** limita a **Exatamente 1** ou permite **Sem limite**.
- **Definindo valores**: o seletor busca notas, exclui o item atual e pode criar um destino na hora via **Criar nova nota**. Um chip dizendo "A nota vinculada não existe" marca um link quebrado (destino excluído/renomeado fora do Plainva).
- **Relação reversa**: a opção **Mostrar em "X"** cria uma coluna calculada no banco de dados de destino mostrando os links no sentido inverso — ela é diretamente editável (as edições gravam nas notas que fazem o link). Excluir a relação remove também sua coluna reversa.
- **Subitens**: para autorrelações, você pode **Ativar subitens** — itens com uma relação de pai aparecem recolhíveis sob o item pai na tabela (ciclos são tratados; quando desativado, a lista permanece plana e os valores são mantidos).
- **Quadro por relação**: quadros podem ser agrupados por uma relação; arrastar cartões entre colunas reescreve o link.
- **Filtrando por relações**: contém / não contém / está vazio / não está vazio, com um seletor de notas.
- Os backlinks também contam: links do frontmatter aparecem no painel de **Backlinks**, e renomeações de arquivo atualizam automaticamente os links de relação.

## Criando novos itens

O botão **Entrada** no canto superior esquerdo (antes **Novo**; claramente separado do **Novo** global da barra lateral) cria um novo item:

- O nome do arquivo segue o padrão `{nome do banco de dados}_{número sequencial}` (espaços viram `_`); a nota começa com um título correspondente e herda as fontes de tag e os valores de filtro simples do banco de dados, de modo que aparece imediatamente na visualização. A janela de pré-visualização então se abre para preenchimento.
- **Pasta de armazenamento**: novos itens sempre ficam em uma pasta designada. Se o banco de dados não tem uma fonte de pasta, um diálogo conduz você pela criação de uma vez só; com várias fontes de pasta, você escolhe uma vez. Altere a qualquer momento pelo menu de seta no botão → **Alterar pasta de armazenamento…**.
- **Modelos**: o menu de seta (**Modelos e pasta de armazenamento**) lista os modelos da pasta de modelos do seu vault — use um uma única vez, marque-o com a estrela em **Definir como padrão** (então todo clique em **Entrada** deste banco de dados o usará) ou **Criar novo modelo** (um novo modelo começa com um título `# {{title}}`, então itens criados a partir dele herdam o nome do arquivo como H1). O mesmo menu também oferece **Abrir pasta de modelos**, que mostra a pasta de modelos na árvore de arquivos — modelos são notas normais que você pode editar, renomear ou excluir ali.

## Uso no dia a dia

- **Edição inline**: um único clique em uma célula (ou no valor de um cartão) a torna editável — em todas as visualizações.
- **Abrindo**: clicar no título de um item abre a nota na janela de pré-visualização — uma janela flutuante que você pode arrastar pela barra de título e redimensionar pelo canto. Ela mantém seu próprio histórico de **Voltar**/**Avançar** para as notas que você abre dentro dela, tem um alternador que revela uma coluna de **Propriedades** para a nota exibida e oferece **Abrir como aba** e **Abrir na divisão**. `Ctrl`+clique abre diretamente na divisão; alternativamente, arraste um cartão para a zona de soltar **Solte aqui: abrir na divisão**.
- **Arrastando**: ao arrastar cartões (Quadro, Calendário, Linha do tempo), um cartão fantasma acompanha o ponteiro. Em um **Quadro** você também pode arrastar um **cabeçalho de coluna** para reordenar as colunas — em quadros de **Seleção**/**Status** isso reordena as opções da propriedade (então os menus suspensos em toda parte passam a seguir essa ordem); quadros de relação e de texto livre lembram a ordem por visualização.
- **Cor da coluna**: nas configurações de **Visualização** de um quadro, **Cor da coluna** permite que uma coluna assuma a cor do seu grupo — **Coluna inteira** (a coluna inteira fica colorida) ou **Apenas o chip** (apenas o chip do cabeçalho, o padrão). Vale para grupos de Seleção/Status/Seleção múltipla.
- **Incorporando**: bancos de dados podem ser incorporados em notas (comando de barra **Incorporar banco de dados** ou `@` → **Bancos de dados**) e usados lá com funcionalidade completa.
- **Escopo automático dentro de um elemento relacionado**: ao incorporar um banco de dados dentro de um único elemento de um banco de dados *relacionado*, ele é automaticamente filtrado para esse elemento — incorpore o banco de dados de tarefas dentro da nota de um projeto e você verá apenas as tarefas daquele projeto. Isso funciona nos dois sentidos (incorpore o lado "muitos" para ver as linhas que apontam para o elemento hospedeiro, ou o lado "um" para ver para onde o elemento hospedeiro aponta) e também vale para bancos de dados com autorrelações e hierarquia de pai/subitens (incorporar o banco de dados dentro de um elemento mostra os subitens desse elemento, de forma aninhada). Um pequeno chip **Filtro** no cabeçalho da incorporação mostra a que ela está restrita; use-o para trocar a relação ou escolher **Mostrar tudo**. O escopo nunca é gravado no arquivo `.base`, portanto o mesmo banco de dados mostra as linhas certas em cada elemento em que está incorporado.
- **Novas entradas herdam o vínculo**: criar uma entrada com **Entrada** dentro de uma incorporação assim restrita a vincula automaticamente ao elemento hospedeiro (uma tarefa criada na lista de tarefas incorporada de um projeto já pertence a esse projeto imediatamente). No sentido inverso, é o elemento hospedeiro que fica vinculado à nova entrada; uma relação de valor único já atribuída permanece intocada.
- **Filtro explícito "Esta nota" (como o "this page" do Notion)**: em vez de depender do escopo automático, você pode torná-lo explícito e permanente. Em **Configurar → Filtro**, adicione uma regra em uma propriedade de relação e escolha o valor **Esta nota**. O banco de dados fica então filtrado para a nota em que estiver incorporado — ideal para **modelos**: incorpore o banco de dados de tarefas em um modelo de projeto, e todo projeto criado a partir dele mostra suas próprias tarefas. Funciona para qualquer propriedade de link wiki, não apenas relações detectadas, e um filtro explícito **Esta nota** tem precedência sobre o escopo automático. Esse filtro vive apenas no Plainva (ele não é gravado na `.base` como um filtro normal), então tanto o Obsidian quanto uma abertura autônoma mostram todas as linhas.

## Exemplo: como é um arquivo .base

Arquivos `.base` são YAML — aqui está uma lista simples de projetos:

```yaml
filters:
  and:
    - 'file.hasTag("project")'
properties:
  note.status:
    displayName: Status
    plainva:
      input: status
      options:
        - value: open
          color: teal
          group: Active
        - value: done
          color: gray
          group: Completed
views:
  - type: table
    name: All projects
  - type: table
    name: Board
    plainva:
      render: board
      groupBy: status
```

Tudo o que é específico do Plainva (cores, renderização do quadro, relações, pasta de armazenamento) vive sob chaves `plainva:`.

## Editando arquivos .base diretamente (ferramentas e IA)

Se um script ou um assistente de IA escrever arquivos `.base` sem passar pelo Plainva, três regras rígidas importam — violar uma delas faz o Obsidian recusar-se a abrir o arquivo inteiro:

- **Apenas as chaves de nível superior `filters`, `formulas`, `properties`, `views`.** Nunca adicione outra chave de nível superior; todos os extras do Plainva vão sob subchaves aninhadas `plainva:`.
- **Toda visualização precisa de um `name` em string não vazia.**
- **Um objeto `filters` carrega exatamente um entre `and` / `or` / `not` por nível** (nunca dois lado a lado).

Mais uma pegadinha: os ids de propriedade levam o prefixo `note.` no mapa `properties:` e no `order`/`sort` de uma visualização (`note.status`), mas ficam **sem prefixo** dentro de expressões de filtro (`status == "Done"`) e dentro de subchaves `plainva` (`groupBy: status`).

O contrato completo em disco — cada campo, o exemplo completo de relações em duas vias e as regras de edição segura — está na [Referência do Formato de Arquivo](File_Format_Reference.md).

## E o Obsidian?

O formato corresponde ao formato Bases do Obsidian; o Plainva grava suas extensões exclusivamente em subchaves `plainva:`, que o Obsidian ignora ("degradação graciosa"):

- O Obsidian abre o arquivo sem erros; visualizações exclusivas do Plainva, como Quadro/Calendário/Linha do tempo, aparecem lá como uma tabela simples.
- Colunas de relação reversa aparecem vazias no Obsidian (elas são calculadas); valores de relação nas notas ficam visíveis lá como links clicáveis.
- Na primeira vez que você usa uma extensão do Plainva, um diálogo (**Extensão do Plainva**) avisa sobre isso; pode ser desativado em **Configurações** por **Bancos de dados estendidos** ou **Avisos**.

## Veja também

- [Referência do Formato de Arquivo](File_Format_Reference.md) — o contrato exato em disco de uma `.base` para ferramentas e edição manual
- [Notas & Markdown](Notes_and_Markdown.md) — propriedades/frontmatter em detalhes
- [OKF](OKF.md) — o que um `type` uniforme traz na prática
