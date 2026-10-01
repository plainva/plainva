# Habilidades (Beta)

Última revisão: 2026-10-01

Uma habilidade é um conjunto de instruções para um trabalho que se repete: preparar uma reunião, organizar suas tarefas, uma revisão semanal. O Plainva traz dez, e você pode escrever as suas. As habilidades usam o formato aberto Agent Skills — uma pasta com um `SKILL.md` — e por isso também funcionam em outros apps de IA que leem esse formato.

## Usar uma habilidade

Inicie uma habilidade com um clique: como chip em uma conversa vazia (as três mais usadas), em **Habilidades** na aba de IA, no celular em **Conversas → Habilidades** ou pela paleta de comandos. A conversa passa então a usar a habilidade: as instruções dela vão junto, e ela usa só as ferramentas e pastas que nomeia.

Você também pode simplesmente perguntar. Em toda conversa a IA conhece os nomes e as descrições das suas habilidades ativas e carrega uma quando a sua pergunta combina — basta “prepare minha próxima reunião”.

## As habilidades incluídas no Plainva

| Habilidade | O que faz |
|---|---|
| **Orientação do dia** | O que importa hoje: tarefas com prazo, compromissos e o que você fez por último. |
| **Revisão semanal** | Os últimos sete dias e a semana que vem, com três sugestões. |
| **Status do projeto** | Objetivo, progresso, pontos em aberto e o próximo passo de um projeto. |
| **Preparar reunião** | Prepara uma reunião a partir de notas anteriores e pontos em aberto, ou a resume depois. |
| **Triagem de tarefas** | Organiza suas tarefas abertas: o que agora, o que pode esperar, o que descartar. |
| **Escrever e revisar** | Resume, encurta ou reescreve uma nota — como texto que você aproveita. |
| **Cuidar do conhecimento** | Encontra notas que dizem o mesmo, estão desatualizadas ou não se ligam a nada. |
| **Revisar links** | Verifica os links de uma nota: que não levam a lugar nenhum, que faltam, de mão única. |
| **Verificar privacidade** | Encontra o que de uma nota deveria ficar neste dispositivo e sugere uma regra. |
| **Reflexão** | Revisita com você as notas de um dia ou de uma semana — com gentileza, nunca um diagnóstico. |

Todas apenas leem: nenhuma altera uma nota, envia algo ou acessa a internet. Verificar privacidade e Reflexão foram pensadas para um modelo neste dispositivo; com um modelo na nuvem a visão de envio avisa. Desligue qualquer habilidade em **Habilidades** — o interruptor vale para este vault neste dispositivo. **Criar sua própria versão** copia uma para o seu vault, onde você pode alterá-la.

## Suas próprias habilidades

**Nova habilidade** pede um nome, uma descrição — é por ela que a IA escolhe a habilidade — e as instruções. O Plainva as grava como `.agent/skills/<nome>/SKILL.md` no seu vault, onde viajam com ele como qualquer nota. **Editar** abre o arquivo como uma nota.

**Importar…** aceita uma habilidade como arquivo `.zip` ou `.skill`. Antes de gravar qualquer coisa, o Plainva a verifica: exatamente uma habilidade no formato, nenhum caminho fora da pasta dela, os limites de tamanho. Ele informa a licença, os scripts que não executará e as ferramentas que não tem.

## Nada roda antes da sua aprovação

Uma habilidade do seu vault que é nova ou foi alterada — pela sincronização, por uma importação ou por uma edição neste ou em outro dispositivo — só roda quando você a aprova **neste dispositivo**. Essas habilidades aguardam no topo de **Habilidades**, em **Aguardando sua aprovação**, e em **Configurações → IA e automação** (a parte do vault). **Revisar e aprovar** mostra o que a habilidade pode fazer, o que mudou desde a sua última aprovação, as instruções, os arquivos e onde ela fica. A aprovação vale exatamente para esta versão; qualquer alteração a anula. As aprovações ficam neste dispositivo, nunca no vault.

O mesmo vale para um `AGENTS.md` no topo do seu vault: depois de aprovado, suas instruções permanentes vão em toda nova conversa. Nem uma habilidade nem o `AGENTS.md` podem suspender suas regras de privacidade, e uma habilidade nunca recebe mais do que uma conversa tem — ela só pode restringir.

## O que vai para o provedor

A visão de envio mostra em **Instruções** o que vai junto: a habilidade da conversa, a lista de habilidades que a IA pode carregar e o `AGENTS.md`. Quando instruções do seu vault vão pela primeira vez para uma nuvem, a visão aparece de novo. Caracteres invisíveis em uma habilidade nunca chegam a um modelo.

## Limites da beta

As habilidades não executam scripts, e as que precisam da web ou do seu e-mail virão depois. Suas próprias habilidades não são oferecidas aos apps de IA conectados pelo servidor MCP; apenas as incluídas no Plainva.
