# OKF — Open Knowledge Format

Última revisão: 2026-08-21

OKF (Open Knowledge Format) é uma convenção aberta para coleções de conhecimento em Markdown: arquivos Markdown puros com um cabeçalho de frontmatter pequeno e uniforme. Esta página explica o que é o OKF, o que o Plainva faz automaticamente por ele — e por que você não *precisa* usar nada disso.

## O que é o OKF?

A ideia: todo documento no vault diz por si mesmo o que ele é. Um cabeçalho mínimo no frontmatter já basta:

```markdown
---
type: Note
---
# Minha nota
```

- **`type`** — que tipo de documento é este (por exemplo, `Note`, `Daily Note`, `Project`). O único campo obrigatório da convenção.
- **`okf_version`** — a versão da convenção que o vault segue. Ela mora **uma vez**, no `index.md` raiz (atualmente `"0.2"`), não em cada nota.
- **`index.md`** — cada pasta pode conter um `index.md` como seu sumário; os nomes `index.md` e `log.md` são reservados para isso e não devem ser usados para notas comuns.

> Vai escrever arquivos com uma ferramenta ou script? O contrato exato de campos — valores permitidos, como cada tipo de propriedade é serializado e as regras de nomes reservados — está na [Referência do Formato de Arquivo](File_Format_Reference.md).

**De onde vem o OKF:** o OKF é uma especificação aberta do Google Cloud ([`GoogleCloudPlatform/knowledge-catalog`](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md), licença Apache-2.0). O Plainva segue o **OKF 0.2** (publicado em 25 de julho de 2026). Novos na 0.2 são cinco campos opcionais com os quais uma nota diz de onde veio, se alguém a revisou e se ela ainda vale — `generated`, `verified`, `sources`, `stale_after` e `status`. O que o Plainva mostra e escreve deles está descrito abaixo, em "Proveniência, revisão e ciclo de vida".

## Por que o Plainva usa o OKF?

O Markdown puro é maravilhosamente portátil — mas, sozinho, não tem nenhuma estrutura confiável. O OKF acrescenta exatamente a estrutura que falta, e tudo continua sendo Markdown comum com frontmatter padrão:

- **Bancos de dados, filtros e modelos podem confiar na estrutura.** Toda nota carrega um `type`, então as visualizações `.base` sobre arquivos puros permanecem robustas.
- **As pastas continuam navegáveis.** Um sumário em `index.md` por pasta funciona tanto para pessoas quanto para ferramentas.
- **Scripts e assistentes de IA podem trabalhar com o seu vault com segurança**, porque o formato em disco é uniforme e documentado.
- **Sem aprisionamento (lock-in).** O OKF é uma convenção aberta sobre o Markdown puro — outras ferramentas OKF entendem seus arquivos, hoje e daqui a dez anos.

## O que o Plainva faz automaticamente

**Arquivos novos** recebem o cabeçalho OKF automaticamente: toda nota criada no Plainva recebe `type` no frontmatter — desde o OKF 0.2, o marcador de versão `okf_version` mora uma vez no `index.md` raiz, não mais em cada nota. Você configura os valores por vault: **Configurações → Vault → Conteúdo e estrutura → OKF (Open Knowledge Format)** → **type para novas notas** (padrão `Note`) e **type para notas diárias** (padrão `Daily Note`). Se um modelo traz seu próprio `type`, o modelo prevalece.

**Arquivos existentes nunca são alterados sem que você peça.** O Plainva só adiciona campos OKF ao criar novos arquivos ou quando você inicia explicitamente a conversão.

**Campos de sistema protegidos:** no painel de **Propriedades**, `type` e — onde notas mais antigas ainda o carregam — `okf_version` são marcados como campos de sistema do OKF ("Campo de sistema do OKF – gerenciado pelo Plainva"): o valor de `type` é selecionável em uma lista suspensa de tipos conhecidos, `okf_version` é somente exibição; renomear, trocar o tipo e excluir ficam travados para que a convenção não se quebre por acidente.

**O explicador:** **O que é OKF?** nas configurações te dá a versão resumida em três frases, além de um link para esta página. Ele não abre mais sozinho; se um vault contém arquivos que não seguem o formato OKF, o Plainva avisa isso uma vez em uma pequena mensagem com um botão que leva direto à conversão.

## Proveniência, revisão e ciclo de vida (OKF 0.2)

Desde o OKF 0.2, uma nota pode dizer de onde veio, quem a revisou e se ela ainda vale. O Plainva transforma isso em três coisas:

**O que o Plainva mostra.**

- Uma nota com `status: draft` ou `status: deprecated` carrega um selo no cabeçalho do documento — **Rascunho** ou **Descontinuada**. `stable` permanece silencioso; uma coluna `status` própria com outros valores (digamos, `Open` em um banco de tarefas) não é um estado de ciclo de vida e não recebe nenhum selo.
- Depois que `stale_after` passa, o aviso **Marcada como desatualizada (desde …)** fica acima da nota com um atalho para as propriedades. O aviso é apenas exibição — o Plainva não altera nada na nota.
- A seção **Confiança e origem** do painel de propriedades (no celular: no painel de contexto da nota) resume os campos e deriva deles um nível de confiança: **Não verificada**, **Confirmada pela máquina** ou **Revisada por uma pessoa** — além de quem gerou, a lista de verificações, as fontes como links clicáveis, o status e a data de desatualização.

**O que o Plainva escreve.**

- `generated` (e, quando uma fonte é conhecida, `sources`) é definido por exatamente três caminhos de escrita automáticos: o **importador** (`plainva-import/<version>`, um instante por execução — o relatório de importação também o traz), a **captura de e-mail** (`plainva-mail-capture/<version>`, com o Message-ID da mensagem como fonte) e a **sincronização de tarefas** (`plainva-task-sync/<version>`, somente quando ela cria uma nota).
- `verified` é escrito apenas por **Marcar como revisada**, na seção **Confiança e origem**: o Plainva acrescenta `human:<seu nome>` com o instante atual à lista — uma segunda revisão nunca sobrescreve a primeira. Seu nome é pedido uma vez por vault; ele fica neste dispositivo e pode ser alterado em **Configurações → Vault → Conteúdo e estrutura → Nome do revisor**.
- O editor nunca toca nesses campos por conta própria, e notas existentes nunca são seladas retroativamente. `status` e `stale_after` são seus para definir, como propriedade ou no frontmatter.

**Atualizando a versão do bundle.** A versão da convenção mora uma vez no `index.md` raiz. Um vault que ainda declara `"0.1"` continua funcionando sem alterações — em **Configurações → Vault → Conteúdo e estrutura → Versão do bundle** (no celular: **Configurações → Vault → Manutenção → Versão do bundle**) você a atualiza para 0.2 com **Atualizar…**. O diálogo mostra de antemão o que muda: a linha no `index.md` raiz e, como uma caixa de seleção (ativada por padrão), a remoção do campo legado `okf_version` das notas que ainda o carregam. Todo arquivo é copiado como backup antes de ser alterado; **Limpar…** faz apenas a segunda parte. A tabela de campos e as regras de escrita em detalhe estão na [Referência do Formato de Arquivo](File_Format_Reference.md).

## index.md: o sumário por pasta

Um `index.md` é o sumário de uma pasta: uma lista das notas e subpastas que ela contém, com descrições e links relativos.

- **Gerando** — sempre por sua ação, nunca do nada: clique com o botão direito em uma pasta → **Gerar/atualizar index.md**, ou em lote pelo **gerenciador de index.md** (**Configurações → Vault → Conteúdo e estrutura**).
- **Adotando em vez de gerar** — se você já tem notas de visão geral (MOC, Visão geral, nota de pasta, README …), o gerenciador as sugere como candidatas. **Adotar** renomeia o arquivo para `index.md` (os links são atualizados em todo o vault) e pode opcionalmente prepará-lo para o OKF.
- **Manutenção automática** — listagens *geradas* pelo Plainva carregam um marcador invisível no final do arquivo (um comentário HTML). Somente esses arquivos marcados são mantidos atualizados automaticamente sempre que a pasta muda — e apenas em vaults OKF (reconhecíveis pelo `okf_version` no `index.md` raiz).
- **Somente leitura com uma saída** — arquivos index.md gerenciados abrem no modo de leitura com o aviso "Este index.md é gerenciado pelo Plainva e atualizado automaticamente." Ali você pode **Atualizar** — ou escolher **Editar mesmo assim**: isso remove o marcador e o arquivo volta a ser totalmente seu (sem mais atualizações automáticas).
- **Tudo de uma vez** — **Atualizar todos os arquivos index.md** está disponível no menu de contexto da raiz do vault e nas configurações; arquivos sem o marcador são ignorados.
- **Preenchendo as lacunas** — dentro do gerenciador de index.md, o botão **Gerar index.md nas pastas que não têm** pré-seleciona toda pasta que ainda não tem um index.md, para que você possa criá-los todos de uma vez.
- **No telefone** — o mesmo, por duas portas: manter uma pasta pressionada oferece **Criar visão geral** ou **Atualizar visão geral**, conforme o que aquela pasta precisa. Para a passada ocasional pelo cofre inteiro existe **Configurações → Vault → Manutenção → Visões gerais**: as pastas sem visão geral vêm primeiro, e **Gerar index.md nas N pastas que não têm** cria todas de uma vez. Uma pasta cujo `index.md` você mesmo escreveu é listada e deixada em paz — adotar é uma decisão com nome nessa lista, nunca o efeito colateral de um toque. A manutenção automática também roda no telefone agora: um cofre editado ali não fica mais desatualizado até que um desktop o abra.
- No modo de leitura, listagens gerenciadas são renderizadas como cartões com ícones de arquivo/pasta; os links abrem direto dentro do Plainva.

## Convertendo um vault existente (opt-in)

Se arquivos no vault não seguem o formato OKF (campo `type` ausente, ou nomes reservados usados como notas comuns), o Plainva oferece a conversão — uma vez ao abrir o vault, e permanentemente em **Configurações → Vault → Conteúdo e estrutura** (o item só aparece enquanto houver algo a fazer).

O assistente **Converter para o formato OKF** trabalha em etapas claras:

1. **Verificação** — mostra quantos arquivos são afetados (pastas de modelos e de sistema são excluídas; arquivos com frontmatter ilegível são ignorados, nunca "consertados").
2. **Decisões** — um `type` padrão para arquivos sem um; valores de `type` existentes podem ser **mantidos** (recomendado — já são tipos OKF válidos) ou renomeados para outro campo.
3. **Pré-visualização (sem alterações)** — uma simulação mostra antecipadamente o que mudaria.
4. **Converter** — cada arquivo é copiado para `.plainva/backups/` antes de ser alterado; um relatório resume o que mudou, o que foi ignorado e a pasta de backup. Depois você pode opcionalmente **continuar para o gerenciador de index.md**.

Uma dica do assistente: as alterações passam pela sincronização normalmente — em vaults com git, faça commit antes.

### No telefone

O mesmo caminho existe no celular: **Configurações → Vault → Manutenção → Converter para o formato OKF**. As etapas são as mesmas — varredura, decisões, prévia, conversão — e a prévia nomeia as notas afetadas antes de qualquer coisa ser escrita.

Duas coisas se somam, porque um telefone pode tirar um app da memória a qualquer momento:

- **Pausar e continuar.** A execução para no próximo arquivo quando você toca em **Pausar** ou o app vai para segundo plano. Continuar escreve na mesma pasta de backup — nenhuma segunda aparece.
- **Perguntado na inicialização.** Se uma execução ficar inacabada, o Plainva avisa na próxima vez que você abrir o vault e oferece **Continuar** ou **Reverter**; **Depois** é uma resposta válida. Uma execução interrompida deixa um vault parcialmente convertido, não quebrado: apenas campos de frontmatter são adicionados e cada nota continua sendo Markdown válido.

**Reverter** restaura os arquivos a partir da pasta de backup — no desktop também, pelo relatório ao final da execução. A pasta de backup permanece depois; ela é a única cópia do estado anterior à conversão.

## Preciso usar o OKF?

Não. O OKF é um padrão suave:

- Arquivos novos recebem o cabeçalho automaticamente — isso nunca atrapalha e não custa nada.
- Vaults existentes (por exemplo, vindos do Obsidian) continuam funcionando sem alterações; a conversão é estritamente opt-in.
- Um `okf_version` ausente — ou um que notas mais antigas ainda carreguem — não conta como uma violação; você pode usar o Plainva e o Obsidian lado a lado permanentemente, sem avisos incômodos.
- O Obsidian e qualquer outro editor ainda conseguem abrir todo arquivo: ele é e continua sendo Markdown puro.

## Veja também

- [Referência do Formato de Arquivo](File_Format_Reference.md) — o contrato exato em disco de cada arquivo do vault
- [Notas & Markdown](Notes_and_Markdown.md) — frontmatter e propriedades
- [Bancos de Dados (.base)](Databases_Base.md) — o que um `type` uniforme traz na prática
- [FAQ e Solução de Problemas](FAQ.md) — backups e index.md somente leitura, entre outros
