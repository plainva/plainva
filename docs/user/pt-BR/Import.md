# Importar de outro aplicativo

Última revisão: 2026-08-21

O Plainva pode trazer notas de outros aplicativos de notas. A importação sempre grava no vault que você tem aberto no momento, em uma subpasta que você nomeia — assim ela nunca toca no restante do seu vault, e você pode mover ou excluir a pasta importada depois, como qualquer outra pasta.

**A importação funciona nos dois dispositivos, com as mesmas fontes.** No desktop, a tela de boas-vindas, a paleta de comandos e o menu de contexto de uma pasta levam até ela; no telefone, você a encontra em **Configurações → Manutenção → Importar de outro aplicativo**. As fontes que precisam de acesso a um serviço — o Notion pela API — também estão disponíveis lá.

## Iniciando uma importação

Três formas de começar:

- **Tela de boas-vindas** → **Importar de outro aplicativo** — o caminho para quem ainda não tem nenhum vault, o caso normal quando você está trocando de aplicativo.
- **Paleta de comandos** (`Mod+P`) → **Importar de outro aplicativo...**
- **Clique com o botão direito em uma pasta** na árvore de arquivos → **Importar de outro aplicativo...**

A primeira etapa pede sua exportação — **Escolher arquivos...** ou **Escolher pasta...**, o que você tiver. O assistente então nomeia o aplicativo que reconheceu e você decide para onde a importação grava. Em seguida vem uma prévia com os números da execução, os limites desta importação e as opções para a origem. Nada é gravado até você pressionar **Iniciar importação**.

**Você não precisa saber qual item corresponde à sua exportação.** Escolha os arquivos, e o Plainva reconhece a origem — uma exportação do Notion pelos IDs longos em seus caminhos, um grafo do Logseq por suas pastas `journals/` e `pages/`, uma exportação do Keep ou Simplenote pelo conteúdo do JSON. O assistente informa o que reconheceu; se ele errar, altere na lista acima e sua escolha permanece.

## Para onde a importação grava

Exatamente um dos dois por importação — nunca os dois:

- **Novo vault**: você escolhe uma pasta vazia, o Plainva cria nela um vault novo e importa para lá. Nada do que você já tem pode ser afetado, e desfazer toda a importação é simplesmente excluir essa pasta. Essa é a escolha certa se você está experimentando o Plainva. No telefone, um vault não é uma pasta que você escolhe, e sim uma área do aplicativo: você só dá um nome a ele. Desfazer a importação significa então remover esse vault em **Mais → Vaults**.
- **Subpasta do vault aberto**: tudo é colocado em uma única subpasta recém-criada, que você nomeia. O restante do seu vault permanece intocado.

A linha de destino abaixo da escolha sempre indica a pasta exata, então onde as coisas vão parar nunca é um palpite.

## Opções desta importação

A prévia mostra, abaixo dos números, as opções **que combinam com a origem reconhecida** — cada origem traz as suas próprias, e o que uma origem não consegue fazer nunca aparece ali. Elas ficam aí, e não antes, porque as perguntas só fazem sentido depois que você vê o que está por vir; uma opção que muda os números faz com que eles sejam recontados na hora.

- **Manter as datas da origem** (ativado) — as notas importadas mantêm as datas de criação e modificação da origem. Sem essa opção, todas recebem a data de hoje.
- **Importar também as notas excluídas** (desativado) — para Google Keep e Simplenote, cujas exportações incluem a lixeira. Por padrão, o que está lá permanece lá; o relatório o cita pelo nome.

## O que a prévia mostra

A prévia é a última parada antes de qualquer gravação, e ela nomeia tudo o que depois seria uma surpresa:

- os números da execução — notas e bancos de dados, além de **anexos** e **listas de tarefas** onde a origem tiver algum,
- a pasta de destino exata,
- o que este importador **não consegue** trazer, e cada item do arquivo compactado que foi ignorado,
- para um vault com conexão à nuvem, o aviso de que as notas importadas serão **enviadas** depois,
- para origens muito grandes, o aviso de que o índice de busca e a primeira sincronização vão demorar um pouco.

## Interrompendo uma execução

Um workspace grande pode demorar, por isso uma importação pode ser interrompida: **Parar importação** durante a execução. O que já chegou ao vault permanece lá, e o relatório descreve isso — uma importação parcial não é uma importação quebrada. Assim como em uma importação completa, a pasta é o desfazer.

## O que você pode importar

| Origem | O que você seleciona | O que é trazido |
|---|---|---|
| **Notion (API, token de integração)** | Um token de integração | Páginas, hierarquia de pastas, bancos de dados com linhas, relações, 21 tipos de propriedade |
| **Notion (exportação ZIP)** | O ZIP ou a pasta descompactada | Páginas e estrutura de pastas; um banco de dados recebe suas colunas e os valores das linhas do CSV ao lado |
| **Evernote (ENEX)** | Um ou mais arquivos `.enex` | Notas, tags, listas de tarefas (marcadas e desmarcadas), datas de criação/atualização |
| **Google Keep (Takeout)** | O ZIP do Takeout ou os arquivos `.json` | Notas, listas de tarefas, marcadores como tags, cor no cabeçalho da nota, notas fixadas como mural |
| **Simplenote (JSON)** | O arquivo `.json` exportado | Notas ativas e suas tags |
| **Logseq (grafo de arquivos)** | A pasta do seu grafo | Os arquivos, copiados sem alterações |
| **Joplin** | A pasta ou o ZIP da exportação Markdown | Notas com seus cadernos, frontmatter, tags e recursos |
| **Bear (TextBundle)** | As pastas `.textbundle` exportadas | Notas com suas imagens |
| **Notesnook** | A exportação Markdown | Notas e suas pastas de caderno; uma nota em dois cadernos é importada uma vez |
| **Capacities** | A pasta ou o ZIP da exportação | Notas com suas propriedades como frontmatter, além das mídias |
| **Amplenote** | O ZIP da exportação | Notas com seu frontmatter e suas imagens |
| **Supernotes** | A exportação Markdown | Cartões em Markdown, com os arquivos de metadados ao lado |
| **Heptabase** | A exportação Markdown | Cartões com seu frontmatter; o layout do whiteboard não é trazido |
| **UpNote** | A exportação Markdown | Notas com seus cadernos e anexos |
| **Craft** | A exportação Markdown | Documentos com seus recursos |
| **Anytype** | A exportação Markdown | Objetos com suas relações como frontmatter |
| **Standard Notes** | O backup JSON descriptografado | Notas com seus títulos e tags |
| **Workflowy / Dynalist** | A exportação OPML | Uma nota por item de primeiro nível, seus filhos como listas aninhadas |
| **Trilium** | A exportação da subárvore | A árvore de notas e seus anexos; notas em HTML viram Markdown |
| **Roam Research** | A exportação JSON | Páginas como notas, esquemas como listas aninhadas; referências de bloco viram o texto para o qual apontavam |
| **Reflect** | A exportação Markdown | Notas com seus wiki links e notas diárias |
| **TiddlyWiki** | A exportação JSON | Tiddlers como notas com suas tags e datas; o WikiText permanece como foi escrito |
| **Tana** | Um texto Tana Paste | Cada nó de nível superior vira uma nota, seus filhos continuam como marcadores |
| **RemNote** | A exportação Markdown | Documentos com seus rems aninhados |
| **Pasta / ZIP HTML** | Uma pasta, arquivos ou um ZIP de páginas HTML | As páginas como notas Markdown, com os links entre elas redirecionados |
| **Pasta Markdown / ZIP** | Uma pasta, arquivos ou um ZIP | Os arquivos `.md` e sua estrutura de pastas |

**Obsidian** também está na lista, mas não inicia nenhuma importação — e nem precisa. O Plainva trabalha com os mesmos arquivos Markdown: o item explica isso e oferece **Abrir vault**. Wiki links, tags, frontmatter e arquivos `.base` continuam funcionando, e seu vault permanece utilizável no Obsidian. Sendo honesto: não existe ecossistema de plugins, nem Canvas nem Dataview — em vez disso você tem filtros no `.base`, e a sintaxe de plugin nas suas notas permanece ali como texto simples.

## Por que meu aplicativo não está aqui?

Alguns aplicativos não estão na lista, e o motivo é diferente a cada vez — o que importa, porque dois deles só faltam por enquanto.

- **OneNote** — não existe exportação em massa que produza algo aproveitável. O caminho seria a Graph API da Microsoft com login delegado: uma chamada por página, outra para cada imagem, mais uma decisão sobre como uma tela livre vira Markdown. Está anotado como projeto futuro, não descartado — a própria API é gratuita.
- **Apple Notes** — a Apple também não oferece exportação em massa, e ler as notas significa fazer engenharia reversa de um banco SQLite, só no macOS. Ferramentas de exportação consagradas já fazem isso. Exporte para Markdown com uma delas e traga a pasta por **Pasta Markdown / ZIP**.
- **Zoho Notebook**, **Turtl**, **Nimbus/FuseBase** — sem exportação documentada que valha a pena importar.
- **Confluence** — sua API devolve o formato de armazenamento próprio do Confluence, um dialeto XHTML construído em torno de macros que exigiria um conversor próprio; e é um wiki de equipe, não uma coleção pessoal. O caminho hoje é a exportação do espaço: exporte o espaço como **HTML** e traga a pasta por **Pasta / ZIP HTML**. Os links entre as páginas exportadas continuam funcionando.

Para tudo que não está listado, o caminho é o mesmo: se o seu aplicativo consegue escrever arquivos Markdown, a entrada **Pasta Markdown / ZIP** os aceita, junto com a estrutura de pastas.

## O Notion em detalhes

O Notion é a única origem em que os dois caminhos diferem bastante.

**Com um token de integração (recomendado).** Crie um token em `notion.so/my-integrations` — o assistente detalha as três etapas e abre a página para você. Depois abra cada página do Notion que você quer importar, escolha **"..."** no canto superior direito → **Conexões**, e adicione sua integração — o Notion só expõe páginas que você conectou explicitamente.

**O Plainva não armazena o token.** Ele vale apenas para essa execução e desaparece depois; nenhuma conta conectada é criada. Na próxima importação você precisará colá-lo novamente.

Através da API, o Plainva vê a estrutura, não só o texto:

- A hierarquia de páginas se torna uma estrutura de pastas.
- Todo banco de dados se torna um arquivo `.base` mais uma pasta com **uma nota por linha**.
- **Relações se tornam wiki links** entre essas notas, nas duas direções.
- 21 tipos de propriedade são mapeados — seleção, status, seleção múltipla, data, número, caixa de seleção, URL, e-mail, telefone, fórmula, rollup, relação, pessoas, ID único e mais.
- Visualizações de tabela, quadro, calendário e lista são geradas a partir do esquema do banco de dados.
- Bancos de dados incorporados dentro de uma página se tornam incorporações `![[Database.base]]` ao vivo.

**A partir de uma exportação ZIP.** Isso funciona offline e não precisa de token, mas a exportação do Notion não contém o esquema do banco de dados nem os IDs das páginas. Páginas e suas pastas são trazidas, e **os links entre as páginas importadas continuam funcionando** — o Notion os grava com um ID longo em cada segmento do caminho, e o Plainva os aponta para as notas que realmente foram gravadas. O `.csv` ao lado de cada pasta de banco de dados é lido para o que as próprias páginas não carregam: as colunas, seus tipos e os valores de cada linha como frontmatter. Linhas para as quais a exportação não tem página são gravadas como notas. A correspondência é feita pelo título — o caminho da API é o que tem IDs reais e continua sendo o melhor para um espaço construído sobre relações.

## O que as importações não conseguem trazer

Todo importador declara seus limites na prévia e novamente no relatório. Os principais:

- **Os anexos vêm junto.** De um ZIP ou de uma pasta eles mantêm o lugar que tinham na exportação, de modo que um link de imagem relativo dentro de uma nota continua funcionando. Do Notion pela API são baixados durante a importação — o Notion assina esses links e eles expiram em menos de uma hora — e vão para uma pasta `Attachments`; imagens que uma página busca em outro lugar da web continuam sendo links. Duas exceções ficam na sua exportação e são citadas uma a uma no relatório: anexos dentro de um `.enex` do Evernote e imagens do Google Keep.
- **Algumas entradas do ZIP são ignoradas de propósito:** arquivos muito grandes, links simbólicos e entradas com um caminho inseguro. Elas aparecem com um motivo na prévia, antes de você iniciar a importação.
- **Páginas muito longas do Notion** são lidas por completo, mas o conteúdo aninhado dentro de blocos expansíveis (toggles), colunas ou sublistas não é seguido.
- **Arquivos do Logseq são copiados sem alterações** — propriedades `key:: value` e referências de bloco não são convertidas em propriedades ou links do Plainva.
- **O que foi excluído continua excluído.** A lixeira do Simplenote e do Google Keep é ignorada — você decidiu abrir mão dessas notas uma vez, e uma importação não deve trazê-las de volta silenciosamente. Elas aparecem nomeadas no relatório, para que você veja o que ficou para trás.
- **Exportações ZIP do Notion** associam linhas e páginas pelo título (veja acima) e não trazem relações entre bancos de dados.

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
- Notas importadas recebem o frontmatter OKF usual — `type` mais um selo `generated` com o autor de importação do Plainva (`plainva-import/<version>`) e o instante da execução, além de `sources` quando a origem é conhecida — então se comportam como qualquer outra nota do Plainva em filtros e visualizações de `.base`. O selo permite encontrar tudo que chegou junto.
- Nada fora da subpasta de destino é modificado.

Se você preferir manter a importação completamente separada, crie um novo vault primeiro (**Novo vault** na tela de boas-vindas) e importe para ele.

## O relatório da importação

Cada execução grava um **relatório de importação** na pasta de destino. Ele lista:

- quantas notas e bancos de dados foram importados,
- o que este importador não consegue trazer de jeito nenhum,
- tudo que chegou **incompleto** ou foi **ignorado**, com o motivo,
- e cada arquivo, com seu status.

O relatório é o registro honesto da execução — se algo foi truncado ou descartado, ele aparece ali em vez de ser silenciosamente contado como sucesso. Vale a pena ler antes de excluir a exportação.

Bem no final está como **desfazer** a importação: tudo de uma execução fica em uma única pasta — excluí-la faz a importação desaparecer. Com o destino **Novo vault**, essa é a própria pasta do novo vault. Não é preciso nenhum comando de desfazer separado para isso. O próprio relatório é uma nota comum e pode ser excluído assim que você o tiver lido.

## Veja também

- [Bancos de Dados (.base)](Databases_Base.md) — o que acontece com bancos de dados do Notion importados
- [OKF](OKF.md) — o frontmatter que as notas importadas recebem
- [Primeiros Passos](Getting_Started.md) — criar um vault separado para uma importação
- **Tabelas e blocos de código em HTML perdem sua estrutura.** A conversão lê títulos, listas, ênfase, links e imagens; uma tabela vira o texto de suas células. Cada página afetada é citada no relatório.
