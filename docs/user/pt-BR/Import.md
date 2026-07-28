# Importar de outro aplicativo

Última revisão: 2026-07-28

O Plainva pode trazer notas de outros aplicativos de notas. A importação sempre grava no vault que você tem aberto no momento, em uma subpasta que você nomeia — assim ela nunca toca no restante do seu vault, e você pode mover ou excluir a pasta importada depois, como qualquer outra pasta.

**A importação acontece no desktop.** O aplicativo móvel não importa: traga as notas no desktop e elas chegam ao seu celular pela sincronização, como qualquer outro arquivo.

## Iniciando uma importação

Duas formas de começar:

- **Paleta de comandos** (`Mod+P`) → **Importar de outro aplicativo...**
- **Clique com o botão direito em uma pasta** na árvore de arquivos → **Importar de outro aplicativo...**

O assistente tem três etapas: escolha o aplicativo de onde você está vindo, escolha os arquivos de exportação (ou informe um token do Notion) e nomeie a pasta de destino. Você recebe então uma prévia com o número de notas e bancos de dados e uma lista de tudo que o importador não consegue trazer. Nada é gravado até você pressionar **Iniciar importação**.

## O que você pode importar

| Origem | O que você seleciona | O que é trazido |
|---|---|---|
| **Notion (API, token de integração)** | Um token de integração | Páginas, hierarquia de pastas, bancos de dados com linhas, relações, 21 tipos de propriedade |
| **Notion (exportação ZIP)** | O ZIP ou a pasta descompactada | Páginas e estrutura de pastas. Bancos de dados são criados **vazios** |
| **Evernote (ENEX)** | Um ou mais arquivos `.enex` | Notas, tags, listas de tarefas (marcadas e desmarcadas), datas de criação/atualização |
| **Google Keep (Takeout)** | O ZIP do Takeout ou os arquivos `.json` | Notas, listas de tarefas, marcadores como tags, cor, fixadas/arquivadas |
| **Simplenote (JSON)** | O arquivo `.json` exportado | Notas ativas e suas tags |
| **Logseq (grafo de arquivos)** | A pasta do seu grafo | Os arquivos, copiados sem alterações |
| **Pasta Markdown / ZIP** | Uma pasta, arquivos ou um ZIP | Os arquivos `.md` e sua estrutura de pastas |

Não existe um importador do Obsidian — e nenhum é necessário. O Plainva abre um vault do Obsidian diretamente: **Abrir vault** e escolha a pasta.

## O Notion em detalhes

O Notion é a única origem em que os dois caminhos diferem bastante.

**Com um token de integração (recomendado).** Crie um token em `notion.so/my-integrations`. Depois abra cada página do Notion que você quer importar, escolha **"..."** no canto superior direito → **Conexões**, e adicione sua integração — o Notion só expõe páginas que você conectou explicitamente.

Através da API, o Plainva vê a estrutura, não só o texto:

- A hierarquia de páginas se torna uma estrutura de pastas.
- Todo banco de dados se torna um arquivo `.base` mais uma pasta com **uma nota por linha**.
- **Relações se tornam wiki links** entre essas notas, nas duas direções.
- 21 tipos de propriedade são mapeados — seleção, status, seleção múltipla, data, número, caixa de seleção, URL, e-mail, telefone, fórmula, rollup, relação, pessoas, ID único e mais.
- Visualizações de tabela, quadro, calendário e lista são geradas a partir do esquema do banco de dados.
- Bancos de dados incorporados dentro de uma página se tornam incorporações `![[Database.base]]` ao vivo.

**A partir de uma exportação ZIP.** Isso funciona offline e não precisa de token, mas a exportação do Notion não contém o esquema do banco de dados nem os IDs das páginas. Páginas e suas pastas são trazidas, e **os links entre as páginas importadas continuam funcionando** — o Notion os grava com um ID longo em cada segmento do caminho, e o Plainva os aponta para as notas que realmente foram gravadas. Bancos de dados são criados como arquivos `.base` **vazios**, e o relatório informa isso. Se seus bancos de dados forem importantes, use o caminho da API.

## O que as importações não conseguem trazer

Todo importador declara seus limites na prévia e novamente no relatório. Os principais:

- **Anexos e imagens não são importados.** O relatório os lista um a um para que você saiba o que fica na sua exportação; anexos do Evernote e imagens do Keep também ficam lá.
- **Algumas entradas do ZIP são ignoradas de propósito:** arquivos muito grandes, links simbólicos e entradas com um caminho inseguro. Elas aparecem com um motivo na prévia, antes de você iniciar a importação.
- **Páginas muito longas do Notion** são lidas por completo, mas o conteúdo aninhado dentro de blocos expansíveis (toggles), colunas ou sublistas não é seguido.
- **Arquivos do Logseq são copiados sem alterações** — propriedades `key:: value` e referências de bloco não são convertidas em propriedades ou links do Plainva.
- **O que foi excluído continua excluído.** A lixeira do Simplenote e do Google Keep é ignorada — você decidiu abrir mão dessas notas uma vez, e uma importação não deve trazê-las de volta silenciosamente. Elas aparecem nomeadas no relatório, para que você veja o que ficou para trás.
- **Exportações ZIP do Notion** criam bancos de dados vazios (veja acima).

## As datas também são trazidas

Uma coleção reunida ao longo de anos perde seu eixo temporal se, depois de uma importação, tudo aparecer com a data de hoje. Por isso o Plainva traz as datas de origem:

- Elas chegam como `created` e `updated` no frontmatter da nota importada, que é também onde o eixo temporal do grafo as lê.
- O próprio arquivo também recebe a data de modificação de origem, para que a ordenação por data e **Abertos recentemente** fiquem corretos. A data de criação do arquivo só pode ser definida no Windows; nos demais sistemas, o frontmatter é quem carrega essa informação.
- Se uma origem não trouxer datas, o Plainva usa a data do arquivo de exportação. Ele nunca inventa uma: sem nenhuma indicação, o campo fica vazio.

## Uma falha não interrompe toda a importação

Se uma única nota não puder ser gravada, a importação continua e o relatório a menciona com o motivo. O relatório é gravado mesmo quando a execução para antes do previsto — assim você sempre vê o que já chegou ao seu vault.

## Nada é sobrescrito

A importação grava no vault que você tem aberto, então ela foi construída para ser não destrutiva:

- Se um nome de nota já estiver em uso, a nota importada recebe um **número** (`Meeting (2).md`) em vez de substituir a existente. Isso também vale quando duas notas de origem compartilham um nome.
- Notas importadas recebem o frontmatter OKF usual (`type`, `okf_version`), então se comportam como qualquer outra nota do Plainva em filtros e visualizações de `.base`.
- Nada fora da subpasta de destino é modificado.

Se você preferir manter a importação completamente separada, crie um novo vault primeiro (**Novo vault** na tela de boas-vindas) e importe para ele.

## O relatório da importação

Cada execução grava um **relatório de importação** na pasta de destino. Ele lista:

- quantas notas e bancos de dados foram importados,
- o que este importador não consegue trazer de jeito nenhum,
- tudo que chegou **incompleto** ou foi **ignorado**, com o motivo,
- e cada arquivo, com seu status.

O relatório é o registro honesto da execução — se algo foi truncado ou descartado, ele aparece ali em vez de ser silenciosamente contado como sucesso. Vale a pena ler antes de excluir a exportação.

## Veja também

- [Bancos de Dados (.base)](Databases_Base.md) — o que acontece com bancos de dados do Notion importados
- [OKF](OKF.md) — o frontmatter que as notas importadas recebem
- [Primeiros Passos](Getting_Started.md) — criar um vault separado para uma importação
