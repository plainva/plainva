# Automação & Scripts

Última revisão: 2026-07-15

O Plainva não tem um sistema de plugins que execute código de terceiros. Em vez disso, o próprio vault é a interface de extensão: suas notas são Markdown puro, os bancos de dados são YAML puro (`.base`), e as [convenções do OKF](OKF.md) dão a cada arquivo uma estrutura previsível. Qualquer coisa capaz de ler e escrever arquivos — um script de shell, um programa em Python, uma ferramenta CLI, uma tarefa agendada ou um agente de IA — pode estender, gerar ou reorganizar seu vault sem uma única API específica do Plainva.

Esta página explica como fazer isso com **segurança**. O formato exato, byte a byte, de cada arquivo está documentado separadamente na [Referência do Formato de Arquivo](File_Format_Reference.md); esta página é o complemento prático: as regras, o fluxo de trabalho e o que entregar a um assistente de IA.

## Por que arquivos em vez de uma sandbox de plugins

- **Segurança.** Um sistema de plugins de código executa o programa de outra pessoa dentro do seu editor, com acesso às suas notas. Arquivos simples não exigem esse tipo de confiança: um script só toca a pasta para a qual você o aponta, com as permissões normais do seu sistema operacional.
- **Longevidade.** O formato sobrevive ao app. Um arquivo Markdown que você gerou com um script há cinco anos ainda abre hoje — no Plainva, no Obsidian, em qualquer editor de texto. Não há API de plugin para se tornar obsoleta.
- **O formato é o contrato.** Como o formato em disco é aberto e documentado, a "API" é estável e inspecionável. Você pode fazer diff nele, versioná-lo no Git e raciocinar sobre ele.

Se você quiser algo que o Plainva não faz de fábrica, não é preciso esperar por um plugin — basta escrever um pequeno script que atue sobre os arquivos.

## Lendo um vault com segurança

Tudo é texto UTF-8:

- **Notas (`.md`)** — um bloco opcional de frontmatter YAML (entre duas linhas `---` bem no topo) guarda as propriedades; o corpo em Markdown vem em seguida. Analise o frontmatter com qualquer biblioteca YAML.
- **Bancos de dados (`.base`)** — YAML puro descrevendo visualizações sobre notas. Os *valores* nunca ficam na `.base`; eles vivem no frontmatter das notas.
- **Estrutura** — tags são `#tag` no corpo ou `tags:` no frontmatter; links são `[[Note]]` (links wiki) ou `[text](path.md)`. Tarefas são itens de lista `- [ ]` / `- [x]`.

A leitura nunca exige cuidado — arquivos de texto não podem ser "corrompidos" ao serem lidos. As regras abaixo são todas sobre *escrita*.

## Escrevendo em um vault com segurança

Siga estas regras e o Plainva (e o Obsidian) aceitarão suas alterações sem problemas. O Plainva observa a pasta do vault: uma escrita externa é detectada e reindexada automaticamente, geralmente em menos de um segundo.

1. **Escreva UTF-8 sem BOM, com quebras de linha LF.** Ferramentas do Windows que usam UTF-16 ou CRLF por padrão produzem arquivos que o Plainva trata como alterados a cada sincronização.
2. **Escreva de forma atômica.** Escreva em um arquivo temporário na mesma pasta e depois renomeie-o para o destino. Uma nota escrita pela metade (por exemplo, depois de uma falha) é pior do que nenhuma alteração. O próprio Plainva escreve toda nota dessa maneira.
3. **Preserve o frontmatter do OKF e as chaves desconhecidas.** Mantenha `type` e `okf_version` ao reescrever uma nota, e nunca descarte chaves de frontmatter que você não reconhece — carregue-as adiante sem alterações. Não "organize" chaves que você não entende.
4. **Nunca toque em `.plainva/`.** Essa pasta guarda o índice local do dispositivo do Plainva, os backups, as fixações do grafo e o estado de sincronização. Ela não faz parte do seu conteúdo, e seus scripts nunca devem escrever nela, sincronizá-la ou incluí-la em um commit do Git.
5. **Respeite as regras de `.base`.** Uma `.base` usa apenas as quatro chaves de nível superior do Obsidian (`filters`, `formulas`, `properties`, `views`); toda visualização precisa de um `name`; os filtros têm raiz única. Todos os dados específicos do Plainva ficam sob subchaves aninhadas `plainva:`. A [Referência do Formato de Arquivo](File_Format_Reference.md#databases-base) traz o contrato completo, incluindo um exemplo de relação de duas vias.
6. **Não brigue com o editor.** Se uma nota está aberta *e* tem edições não salvas no Plainva, prefira não reescrevê-la a partir de um script no mesmo momento. O Plainva tem um resolvedor de conflitos como rede de segurança, mas o caminho mais limpo é deixar o app salvar primeiro (ou editar notas que não estejam abertas no momento).

## Padrões

Algumas tarefas comuns, todas apenas operações de arquivo:

- **Criar notas em lote** — gere arquivos `.md` com um bloco de frontmatter do OKF (`type`, `okf_version`, além das suas próprias propriedades) e um corpo em Markdown. O Plainva as indexa assim que aparecem.
- **Geradores de notas diárias ou relatórios** — um script agendado que escreve uma nota datada na sua pasta de notas diárias, preenchida a partir de outra fonte.
- **Varreduras de propriedades** — leia o frontmatter de cada nota, transforme um campo e grave-o de volta (de forma atômica, preservando chaves desconhecidas).
- **Exportar / publicar** — leia o vault e renderize-o em HTML, um site estático ou um PDF. Apenas leitura — sem regras com que se preocupar.
- **Manutenção de links** — reescaneie links `[[Note]]` e `tags:` e produza um relatório, ou corrija-os no local.

Mantenha os scripts idempotentes sempre que possível: executá-los duas vezes não deve duplicar conteúdo.

## Entregando o vault a um assistente de IA

Um agente de IA com acesso de leitura/escrita a uma pasta de vault é exatamente o caso para o qual este design foi feito. Para que ele funcione corretamente:

1. **Entregue a ele a [Referência do Formato de Arquivo](File_Format_Reference.md).** Ela é escrita para leitura por máquina: o contrato de frontmatter do OKF, a serialização propriedade→YAML, o esquema completo de `.base` com suas regras rígidas do Obsidian, o contrato do `index.md` e as regras de segurança — tudo o que um agente precisa para editar arquivos sem quebrá-los.
2. **Aponte-o para a pasta do vault, não para a pasta `.plainva/`.** Deixe claro que `.plainva/` está fora dos limites.
3. **Peça edições atômicas e mínimas.** Um agente que reescreve uma nota inteira para alterar uma propriedade deve preservar o restante do frontmatter e do corpo ao pé da letra.

Como o contrato é um documento, não uma API viva, as mesmas instruções funcionam com qualquer assistente, offline ou online.

## Recapitulação de segurança

- UTF-8, sem BOM, LF.
- Escreva de forma atômica (arquivo temporário + renomear).
- Preserve `type`, `okf_version` e chaves desconhecidas.
- Nunca escreva em `.plainva/`.
- `.base`: quatro chaves de nível superior, visualizações nomeadas, filtros de raiz única, subchaves `plainva:` para todo o resto.
- O vault é observado — alterações externas aparecem no Plainva automaticamente.

## Veja também

- [Referência do Formato de Arquivo](File_Format_Reference.md) — o formato exato em disco de cada arquivo
- [OKF](OKF.md) — o Open Knowledge Format que dá aos arquivos sua estrutura previsível
- [Bancos de Dados (.base)](Databases_Base.md) — como funcionam as visualizações `.base`
