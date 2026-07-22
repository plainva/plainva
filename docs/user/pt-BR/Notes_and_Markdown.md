# Notas & Markdown

Última revisão: 2026-07-22

Toda nota no Plainva é um arquivo Markdown (`.md`) comum. Esta página explica como escrever com conforto e o que realmente acaba indo para o arquivo — porque é exatamente isso que torna suas notas portáteis: qualquer editor de texto, o Obsidian ou um diff do git conseguem lê-las.

## O princípio central: tudo é texto

Tudo o que você vê no Plainva — texto formatado, tabelas, propriedades, ícones — é armazenado como texto aberto:

```markdown
---
type: Note
okf_version: "0.1"
tags: [projeto]
plainva:
  icon: "🚀"
  header_color: "#2f6f6f"
---
# Meu Projeto

Um pensamento em **negrito** com um link para [[Outra Nota]].

- [ ] Primeira tarefa
```

O bloco entre as linhas `---` é o **frontmatter** (YAML): é ali que ficam as propriedades da nota. Abaixo dele vem o texto Markdown normal. A apresentação específica do Plainva (ícone, cor do cabeçalho) fica agrupada sob a única chave `plainva:` — outros programas simplesmente a ignoram.

## Escrevendo na Visualização ao Vivo

A **Visualização ao vivo** é o modo padrão: o Markdown é renderizado enquanto você digita, mas continua editável o tempo todo.

### O menu de barra

Digite `/` no início de uma linha para abrir o menu de inserção. Ele é agrupado em seções:

- **Blocos básicos** — Texto, Título 1–6, Lista com marcadores, Lista numerada, Lista de tarefas, Citação, Bloco de código, Tabela, Divisor, **Fórmula (LaTeX)**, **Diagrama Mermaid**
- **Formatação** — Negrito, Itálico, Tachado, Código inline, Destaque, **Emoji**
- **Links e mídia** — Link, Link interno, Imagem (web), Imagem interna, Incorporar, Incorporar banco de dados, Criar banco de dados embutido
- **Documento** — Ícone do documento, Cor do cabeçalho, Inserir modelo
- **Callouts** — 13 variantes (Nota, Info, Tarefa, Resumo, Dica, Sucesso, Pergunta, Aviso, Falha, Perigo, Bug, Exemplo, Citação)

### Mais ajudas de escrita

- **Barra de formatação da seleção** — selecione um trecho de texto e uma pequena barra oferece **Negrito**, **Itálico**, **Tachado**, **Código inline**, **Destaque** e **Link**.
- **Menções com `@`** — digite `@` em qualquer lugar do texto para inserir uma **Data** (Hoje, Amanhã, Ontem ou **Escolher data…**, armazenada como data ISO), um link para uma **Nota**, ou uma incorporação de **Banco de dados**.
- **Emoji** — o comando de barra **Emoji** (`/emoji`) abre um seletor de emojis no cursor; ou digite `:name` (por exemplo, `:rocket`) para sugestões em linha. De qualquer forma, o Plainva insere o **caractere** real do emoji (Unicode portátil), nunca um `:shortcode:` — assim a nota continua legível no Obsidian, no GitHub e em qualquer outro lugar. (Isso é diferente do **Ícone do documento** da nota, que é armazenado no frontmatter.)
- **Alças de bloco** — uma alça aparece à esquerda de cada parágrafo ao passar o mouse: arraste-a para mover o bloco, clique nela para abrir **Ações do bloco** (**Transformar em** Texto/Título/Lista/Tarefa/Citação/Bloco de código, **Duplicar**, **Mover para cima**/**Mover para baixo**, **Excluir bloco**). Se você arrastar uma lista para o lado de outra lista do mesmo tipo, o Plainva insere uma linha separadora invisível `<!-- -->` para que as duas listas continuem separadas — em Markdown, listas do mesmo estilo normalmente se fundiriam apesar da linha em branco (também no Obsidian).
- **Tabelas** — renderizadas como um widget com edição por clique em cada célula. A exibição da célula renderiza formatação (**negrito**, *itálico*, `código`, destaque), links clicáveis (`[[Link Interno]]`, endereços da web) e `<br>` como quebra de linha; ao editar, você vê o texto bruto. O menu da tabela oferece inserir/excluir linhas e colunas, além do alinhamento (**Alinhar à esquerda**/**Centralizar**/**Alinhar à direita**).
- **Listas continuam sozinhas** (Enter insere o próximo marcador de lista), blocos de código recebem destaque de sintaxe conforme a linguagem (também no modo de leitura), o conteúdo colado é convertido para Markdown (colagem inteligente), e os títulos podem ser recolhidos.
- **Localizar e substituir** dentro da nota atual: `Ctrl+F` (veja [Busca](Search.md)).

## Links e backlinks

- **Links internos**: `[[Nome da nota]]` (link wiki) — pelo menu de barra ou por `@` com busca de notas embutida. Links clássicos do Markdown `[texto](caminho.md)` também funcionam.
- **Destinos que ainda não existem**: um link wiki para uma nota que ainda não foi criada aparece **esmaecido, com sublinhado tracejado** (tanto na Visualização ao vivo quanto no modo de leitura). **Clicar nele cria a nota** e a abre — colocada na pasta da nota atual (ou no caminho indicado, se o link contiver um, por exemplo `[[Folder/New note]]`). Para ser perguntado antes, ative **Configurações → App → Editor e notas → Perguntar antes de criar links vazios**.
- **Backlinks**: a seção **Backlinks** na barra lateral direita mostra quais notas fazem link para a ativa — agrupadas por arquivo de origem, com um contador para ocorrências múltiplas.
- **Renomear com cuidado dos links**: ao renomear um arquivo na árvore de arquivos, o Plainva atualiza todo link para ele em todo o vault (âncoras como `#Seção` são preservadas) e reporta: "N link(s) em M arquivo(s) foram atualizados para o novo nome."

## Propriedades (frontmatter)

A seção **Propriedades** na barra lateral direita mostra o frontmatter da nota como um formulário. **Adicionar propriedade** cria novas; cada propriedade tem um **Tipo de campo**:

| Grupo | Tipos |
|---|---|
| **Básico** | Texto, Número, Caixa de seleção, Data, Data e hora |
| **Escolha** | Seleção, Status, Seleção múltipla |
| **Listas e relações** | Lista, Tags, Relação |
| **Web e contato** | URL, E-mail, Telefone |

Os tipos de escolha podem ter opções fixas com uma **Cor** e (para **Status**) um **Grupo**/etapa — essas listas de opções são gerenciadas nos bancos de dados (`.base`), veja [Bancos de Dados (.base)](Databases_Base.md).

Dois campos são protegidos: `type` e `okf_version` são **campos de sistema do OKF** gerenciados pelo Plainva — o valor de `type` é selecionável em uma lista suspensa de tipos conhecidos, enquanto nome/tipo de campo/exclusão ficam travados (contexto: [OKF](OKF.md)).

## Ícone do documento e cor do cabeçalho

Toda nota pode ter um ícone (ao estilo do Notion, acima do título, visível também nas abas e na árvore de arquivos) e uma faixa de cor em largura total:

- Na Visualização ao vivo, passe o mouse acima do título: **Adicionar ícone** / **Adicionar cor de cabeçalho** (depois: **Alterar ícone** / **Alterar cor do cabeçalho**) — ou use os comandos de barra **Ícone do documento** e **Cor do cabeçalho**.
- O seletor de ícones tem dois modos: **Emoji** e **Ícones** (o conjunto de ícones Lucide, com uma cor selecionável).
- Ambos são armazenados no frontmatter sob `plainva:` (`icon`, `icon_color`, `header_color`) — pura apresentação, que não afeta outros programas.

## Modelos

Defina uma **Pasta de modelos** em **Configurações → Vault → Conteúdo e estrutura** (**Escolher pasta…** ao lado do campo permite escolher a pasta diretamente no vault). Depois insira modelos com `Ctrl+Alt+T` ou o comando de barra **Inserir modelo**. Os modelos definem por completo o conteúdo dos novos arquivos — inclusive o frontmatter: se um modelo traz seu próprio `type`, o modelo prevalece. Ao inserir em uma nota existente, o frontmatter do modelo é omitido — apenas o conteúdo é inserido.

**Placeholders**: os modelos interpolam `{{title}}` (o título da nota), `{{date}}` e `{{time}}`. Ao *inserir* um modelo, mais dois são resolvidos: `{{cursor}}` marca onde o cursor fica posicionado depois, e `{{prompt:Label}}` pergunta por um valor (exibido como *Label*) e insere sua resposta. Ao criar uma *nova* nota a partir de um modelo, `{{cursor}}` é removido, e qualquer `{{prompt:…}}` fica em branco.

Criar modelos funciona de qualquer lugar: a paleta de comandos (`Ctrl+P`) oferece **Criar novo modelo** (um modelo novo abre para edição) e **Salvar a nota atual como modelo** (copia a nota aberta para a pasta de modelos). Modelos são arquivos Markdown comuns — edite, renomeie ou exclua-os diretamente na árvore de arquivos.

## Notas diárias

**Abrir nota diária** (barra lateral) ou um clique no **Calendário** cria a nota de hoje usando seu formato de data na pasta de notas diárias configurada, opcionalmente a partir de um modelo.

## Tarefas, fórmulas, diagramas e notas de rodapé

- **Caixas de seleção de tarefas**: `- [ ] tarefa` é renderizada como uma caixa de seleção em todos os lugares — e no **modo de leitura** você pode clicar nela: o Plainva grava `[x]` ou `[ ]` de volta no arquivo.
- **Matemática (LaTeX)**: `$E = mc^2$` inline e `$$…$$` como bloco são renderizados como fórmulas no modo de leitura E na visualização ao vivo (KaTeX). Com o cursor dentro de uma fórmula, você vê a sintaxe; clicar em uma fórmula renderizada a abre para edição. Só o modo de código-fonte sempre mostra a sintaxe bruta. Você não precisa decorar o bloco `$$…$$` — o comando de barra **Fórmula (LaTeX)** (`/katex`) o insere e posiciona o cursor dentro dele.
- **Diagramas Mermaid**: um bloco de código com a linguagem `mermaid` (mais rápido pelo comando de barra **Diagrama Mermaid**, `/mermaid`) é desenhado como um diagrama no modo de leitura e na visualização ao vivo — clicar no diagrama mostra o código para edição:

  ````markdown
  ```mermaid
  graph TD
    Idea --> Note --> Knowledge
  ```
  ````

- **Notas de rodapé**: `Texto[^1]` mais `[^1]: A nota de rodapé.` no final — o modo de leitura renderiza a referência e o aparato de notas de rodapé com marcas de salto. O jeito mais rápido é o comando de barra **Nota de rodapé** (`/footnote`) — ele insere a próxima referência livre e pula direto para a definição no final da nota.

## Imprimir e salvar como PDF

O menu **⋮** do editor e a paleta de comandos (`Ctrl+P`) têm **Imprimir / Salvar como PDF…**: a impressão sempre usa a visualização de leitura (a partir do modo ao vivo/código-fonte, o Plainva muda para ela primeiro). No diálogo do sistema, você pode escolher "Salvar como PDF" em vez de uma impressora.

## Exportando uma nota

- **Exportar como Markdown…** (menu **⋮** do editor ou paleta de comandos): salva uma cópia da nota em qualquer lugar pelo diálogo do sistema — por exemplo, para entregá-la a outro programa. Anexos vinculados (imagens) não são copiados junto; se a nota fizer referência a algum, o Plainva mostra um aviso curto.
- **PDF**: use **Imprimir / Salvar como PDF…** (acima) e escolha "Salvar como PDF" no diálogo do sistema.

## Abrindo uma nota em outro editor

Suas notas são arquivos `.md` comuns, então qualquer editor Markdown consegue abri-las. O menu **⋮** do editor tem **Abrir no aplicativo padrão**, que entrega a nota atual ao aplicativo que o seu sistema usa para arquivos Markdown (Byword, MacDown, VS Code e assim por diante). O Plainva continua observando o arquivo, então as edições feitas lá aparecem aqui automaticamente.

## Imagens e anexos

- **Inserir**: comandos de barra **Imagem interna** (buscar e incorporar do vault) ou **Imagem (web)** (por URL). Também: basta **colar** uma imagem da área de transferência (Ctrl+V) — ela é salva ao lado da nota e incorporada. E você pode **arrastar arquivos do explorador de arquivos para o editor**: imagens são incorporadas (`![[…]]`), outros arquivos são copiados e vinculados (`[[…]]`).
- **Visualizar**: arquivos de imagem (PNG, JPG, GIF, WebP, SVG, BMP, AVIF) abrem no visualizador de imagens integrado com **Ampliar**/**Reduzir**, **Ajustar** e **Tamanho real (1:1)**.
- **Editar**: o botão **Editar** abre o editor de imagens com **Cortar**, girar/inverter, **Redimensionar**, ferramentas de desenho (**Caneta**, **Seta**, **Retângulo**, **Texto**) e **Desfazer**/**Refazer**. Salve no local ou **Salvar como cópia…**. Os formatos editáveis são PNG, JPG e WebP; outros formatos abrem somente para visualização.
- Outros anexos abrem no programa padrão do sistema ao clicar duas vezes.

## E o Obsidian?

Tudo permanece Markdown padrão com frontmatter padrão. O Obsidian abre os arquivos por completo; ele mostra a chave agrupada `plainva:` como um objeto não editável no painel de propriedades — isso é intencional e inofensivo.

## Veja também

- [Bancos de Dados (.base)](Databases_Base.md) — notas como tabela, quadro ou calendário
- [OKF](OKF.md) — o que `type` e `okf_version` significam
- [Busca](Search.md) e [Atalhos de Teclado](Keyboard_Shortcuts.md)

## Formatar uma seleção

Quando uma seleção abrange várias linhas, **negrito**, *itálico*, tachado, destaque e código em linha são aplicados separadamente a cada linha não vazia. Prefixos de lista, citação, título e tarefa ficam fora dos marcadores. Links continuam em uma linha porque um rótulo multilinha não é Markdown portátil.

Um título ATX e uma tarefa GFM são tipos de bloco alternativos. O Plainva não grava uma combinação inválida. A formatação em linha funciona nos dois; use `- [ ] **Tarefa importante**` para destacar o título.
