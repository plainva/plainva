# OKF — Open Knowledge Format

Stand: 2026-07-08

OKF (Open Knowledge Format) é uma convenção aberta para coleções de conhecimento em Markdown: arquivos Markdown puros com um cabeçalho de frontmatter pequeno e uniforme. Esta página explica o que é o OKF, o que o Plainva faz automaticamente por ele — e por que você não *precisa* usar nada disso.

## O que é o OKF?

A ideia: todo documento no vault diz por si mesmo o que ele é. Um cabeçalho mínimo no frontmatter já basta:

```markdown
---
type: Note
okf_version: "0.1"
---
# Minha nota
```

- **`type`** — que tipo de documento é este (por exemplo, `Note`, `Daily Note`, `Project`). O único campo obrigatório da convenção.
- **`okf_version`** — a versão da convenção segundo a qual o arquivo foi escrito.
- **`index.md`** — cada pasta pode conter um `index.md` como seu sumário; os nomes `index.md` e `log.md` são reservados para isso e não devem ser usados para notas comuns.

> Vai escrever arquivos com uma ferramenta ou script? O contrato exato de campos — valores permitidos, como cada tipo de propriedade é serializado e as regras de nomes reservados — está na [Referência do Formato de Arquivo](File_Format_Reference.md).

## Por que o Plainva usa o OKF?

O Markdown puro é maravilhosamente portátil — mas, sozinho, não tem nenhuma estrutura confiável. O OKF acrescenta exatamente a estrutura que falta, e tudo continua sendo Markdown comum com frontmatter padrão:

- **Bancos de dados, filtros e modelos podem confiar na estrutura.** Toda nota carrega um `type`, então as visualizações `.base` sobre arquivos puros permanecem robustas.
- **As pastas continuam navegáveis.** Um sumário em `index.md` por pasta funciona tanto para pessoas quanto para ferramentas.
- **Scripts e assistentes de IA podem trabalhar com o seu vault com segurança**, porque o formato em disco é uniforme e documentado.
- **Sem aprisionamento (lock-in).** O OKF é uma convenção aberta sobre o Markdown puro — outras ferramentas OKF entendem seus arquivos, hoje e daqui a dez anos.

## O que o Plainva faz automaticamente

**Arquivos novos** recebem o cabeçalho OKF automaticamente: toda nota criada no Plainva recebe `type` e `okf_version` no frontmatter. Você configura os valores por vault: **Configurações → Configurações do vault → OKF (Open Knowledge Format)** → **type para novas notas** (padrão `Note`) e **type para notas diárias** (padrão `Daily Note`). Se um modelo traz seu próprio `type`, o modelo prevalece.

**Arquivos existentes nunca são alterados sem que você peça.** O Plainva só adiciona campos OKF ao criar novos arquivos ou quando você inicia explicitamente a conversão.

**Campos de sistema protegidos:** no painel de **Propriedades**, `type` e `okf_version` são marcados como campos de sistema do OKF ("Campo de sistema do OKF – gerenciado pelo Plainva"): o valor de `type` é selecionável em uma lista suspensa de tipos conhecidos, `okf_version` é somente exibição; renomear, trocar o tipo e excluir ficam travados para que a convenção não se quebre por acidente.

**O explicador:** ao abrir um vault pela primeira vez, o Plainva mostra **O que é OKF?** uma única vez — o mesmo resumo está sempre disponível nas configurações.

## index.md: o sumário por pasta

Um `index.md` é o sumário de uma pasta: uma lista das notas e subpastas que ela contém, com descrições e links relativos.

- **Gerando** — sempre por sua ação, nunca do nada: clique com o botão direito em uma pasta → **Gerar/atualizar index.md**, ou em lote pelo **gerenciador de index.md** (**Configurações → OKF → Abrir…**).
- **Adotando em vez de gerar** — se você já tem notas de visão geral (MOC, Visão geral, nota de pasta, README …), o gerenciador as sugere como candidatas. **Adotar** renomeia o arquivo para `index.md` (os links são atualizados em todo o vault) e pode opcionalmente prepará-lo para o OKF.
- **Manutenção automática** — listagens *geradas* pelo Plainva carregam um marcador invisível no final do arquivo (um comentário HTML). Somente esses arquivos marcados são mantidos atualizados automaticamente sempre que a pasta muda — e apenas em vaults OKF (reconhecíveis pelo `okf_version` no `index.md` raiz).
- **Somente leitura com uma saída** — arquivos index.md gerenciados abrem no modo de leitura com o aviso "Este index.md é gerenciado pelo Plainva e atualizado automaticamente." Ali você pode **Atualizar** — ou escolher **Editar mesmo assim**: isso remove o marcador e o arquivo volta a ser totalmente seu (sem mais atualizações automáticas).
- **Tudo de uma vez** — **Atualizar todos os arquivos index.md** está disponível no menu de contexto da raiz do vault e nas configurações; arquivos sem o marcador são ignorados.
- **Preenchendo as lacunas** — dentro do gerenciador de index.md, o botão **Gerar index.md nas pastas que não têm** pré-seleciona toda pasta que ainda não tem um index.md, para que você possa criá-los todos de uma vez.
- No modo de leitura, listagens gerenciadas são renderizadas como cartões com ícones de arquivo/pasta; os links abrem direto dentro do Plainva.

## Convertendo um vault existente (opt-in)

Se arquivos no vault não seguem o formato OKF (campo `type` ausente, ou nomes reservados usados como notas comuns), o Plainva oferece a conversão — uma vez ao abrir o vault, e permanentemente em **Configurações → OKF → Conversão OKF** (o item só aparece enquanto houver algo a fazer).

O assistente **Converter para o formato OKF** trabalha em etapas claras:

1. **Verificação** — mostra quantos arquivos são afetados (pastas de modelos e de sistema são excluídas; arquivos com frontmatter ilegível são ignorados, nunca "consertados").
2. **Decisões** — um `type` padrão para arquivos sem um; valores de `type` existentes podem ser **mantidos** (recomendado — já são tipos OKF válidos) ou renomeados para outro campo.
3. **Pré-visualização (sem alterações)** — uma simulação mostra antecipadamente o que mudaria.
4. **Converter** — cada arquivo é copiado para `.plainva/backups/` antes de ser alterado; um relatório resume o que mudou, o que foi ignorado e a pasta de backup. Depois você pode opcionalmente **continuar para o gerenciador de index.md**.

Uma dica do assistente: as alterações passam pela sincronização normalmente — em vaults com git, faça commit antes.

## Preciso usar o OKF?

Não. O OKF é um padrão suave:

- Arquivos novos recebem o cabeçalho automaticamente — isso nunca atrapalha e não custa nada.
- Vaults existentes (por exemplo, vindos do Obsidian) continuam funcionando sem alterações; a conversão é estritamente opt-in.
- Um `okf_version` ausente sozinho não conta como uma violação — você pode usar o Plainva e o Obsidian lado a lado permanentemente, sem avisos incômodos.
- O Obsidian e qualquer outro editor ainda conseguem abrir todo arquivo: ele é e continua sendo Markdown puro.

## Veja também

- [Referência do Formato de Arquivo](File_Format_Reference.md) — o contrato exato em disco de cada arquivo do vault
- [Notas & Markdown](Notes_and_Markdown.md) — frontmatter e propriedades
- [Bancos de Dados (.base)](Databases_Base.md) — o que um `type` uniforme traz na prática
- [FAQ e Solução de Problemas](FAQ.md) — backups e index.md somente leitura, entre outros
