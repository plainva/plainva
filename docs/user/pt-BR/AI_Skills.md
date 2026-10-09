# Habilidades (Beta)

Última revisão: 2026-10-09

Uma habilidade é um conjunto de instruções para um trabalho que se repete: preparar uma reunião, organizar suas tarefas, uma revisão semanal. O Plainva traz treze, e você pode escrever as suas. As habilidades usam o formato aberto Agent Skills — uma pasta com um `SKILL.md` — e por isso também funcionam em outros apps de IA que leem esse formato.

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
| **Investigar** | Investiga uma pergunta na web e nas suas notas, com cada fonte citada. |
| **E-mail e calendário** | Repassa os e-mails recentes e os próximos compromissos: o que precisa de resposta, o que preparar, quais tarefas decorrem disso. |
| **Escrever e revisar** | Resume, encurta ou reescreve uma nota — como texto que você aproveita. |
| **Cuidar do conhecimento** | Encontra notas que dizem o mesmo, estão desatualizadas ou não se ligam a nada. |
| **Revisar links** | Verifica os links de uma nota: que não levam a lugar nenhum, que faltam, de mão única. |
| **Cuidar da memória** | Revisa a memória: entradas que dizem o mesmo, se contradizem ou estão desatualizadas — e prepara rascunhos do que unir e do que retirar. |
| **Verificar privacidade** | Encontra o que de uma nota deveria ficar neste dispositivo e sugere uma regra. |
| **Reflexão** | Revisita com você as notas de um dia ou de uma semana — com gentileza, nunca um diagnóstico. |

Todas apenas leem: nenhuma altera uma nota ou envia algo. A que prepara rascunhos é **Cuidar da memória**: o que ela sugere para a memória fica esperando até você aceitar. Só **Investigar** usa a internet, e só **E-mail e calendário** lê seu e-mail — veja abaixo. Verificar privacidade e Reflexão foram pensadas para um modelo neste dispositivo; com um modelo na nuvem a visão de envio avisa. Desligue qualquer habilidade em **Habilidades** — o interruptor vale para este vault neste dispositivo. **Criar sua própria versão** copia uma para o seu vault, onde você pode alterá-la.

## Na internet e no seu e-mail

**Investigar** é a única habilidade que vem com o Plainva e usa a internet. Iniciá-la é uma escolha sua para a conversa dela, como o globo abaixo do campo de entrada: onde você ativou **A IA pode usar a internet neste vault**, ela pesquisa e lê páginas — e enquanto suas notas estiverem na conversa, cada página e cada pesquisa continua perguntando antes, como descrito em **Na internet**, em [Assistente de IA](AI_Assistant.md). Onde o interruptor está desligado, ela investiga só nas suas notas e diz isso. O mesmo vale quando a IA carrega a habilidade por conta própria em uma conversa que você começou sem internet.

**E-mail e calendário** lê e-mail pela mesma pergunta de qualquer conversa: **Ler seu e-mail?** na primeira vez. Ela nunca lê sozinha o texto de uma mensagem; um segundo leitor, sem ferramentas, escreve um relatório sobre ele. Ambos estão descritos em [Assistente de IA](AI_Assistant.md).

Uma habilidade sua só usa a internet quando a linha `allowed-tools` dela nomeia `web_search` ou `fetch_url`. **Revisar e aprovar** então diz **Usa a internet onde você a permitiu para este vault.** antes de você aprová-la. Uma habilidade que não nomeia ferramentas nunca traz a internet junto.

Uma execução de teste nunca usa a internet e nunca pergunta: o e-mail que ela não tinha permissão para ler nesta sessão continua não lido.

## Propor alterações

Uma habilidade sua só propõe alterações quando a linha `allowed-tools` dela nomeia as ferramentas para isso: `propose_edit` e `set_property` para sugestões no texto e nas propriedades de uma nota, `create_note`, `create_entry`, `create_task` e `add_journal_entry` para rascunhos, `rename_note`, `move_note` e `delete_note` para planos. **Revisar e aprovar** então nomeia cada uma delas e diz **Pode sugerir alterações, deixar rascunhos e apresentar planos. Nada muda no vault antes de você aceitar, criar ou confirmar.** Uma habilidade que não nomeia ferramentas não propõe nada — uma que você aprovou antes também não ganha nada —, e uma execução de teste não deixa nada. O que são as três formas: **Propor alterações** em [Assistente de IA](AI_Assistant.md).

## Suas próprias habilidades

**Nova habilidade** pede um nome, uma descrição — é por ela que a IA escolhe a habilidade — e as instruções. O Plainva as grava como `.agent/skills/<nome>/SKILL.md` no seu vault, onde viajam com ele como qualquer nota. **Editar** abre o arquivo como uma nota.

**Importar…** aceita uma habilidade como arquivo `.zip` ou `.skill`. Antes de gravar qualquer coisa, o Plainva a verifica: exatamente uma habilidade no formato, nenhum caminho fora da pasta dela, os limites de tamanho. Ele informa a licença, os scripts que não executará e as ferramentas que não tem. Arquivos ocultos — nomes que começam com um ponto — não fazem parte de uma habilidade e ficam de fora.

## Nada roda antes da sua aprovação

Uma habilidade do seu vault que é nova ou foi alterada — pela sincronização, por uma importação ou por uma edição neste ou em outro dispositivo — só roda quando você a aprova **neste dispositivo**. Essas habilidades aguardam no topo de **Habilidades**, em **Aguardando sua aprovação**, e em **Configurações → IA e automação** (a parte do vault). **Revisar e aprovar** mostra o que a habilidade pode fazer, o que mudou desde a sua última aprovação, as instruções, os arquivos e onde ela fica. A aprovação vale exatamente para esta versão; qualquer alteração a anula. As aprovações ficam neste dispositivo, nunca no vault.

O mesmo vale para um `AGENTS.md` no topo do seu vault: depois de aprovado, suas instruções permanentes vão em toda nova conversa. Nem uma habilidade nem o `AGENTS.md` podem suspender suas regras de privacidade, e uma habilidade nunca recebe mais do que uma conversa tem — ela só pode restringir. Uma regra que você adiciona na memória, ou aceita da IA, é mais uma linha deste arquivo; veja [Memória](AI_Memory.md).

## Testar habilidades com um modelo

Uma habilidade pode trazer cenários de teste: uma mensagem que a inicia e o que uma boa execução faz. As habilidades incluídas os têm; para as suas, escreva-os em `tests/scenarios.json`, na pasta da habilidade:

```json
{
  "version": 1,
  "scenarios": [
    {
      "id": "rates",
      "message": "Check the offer against last year's rates.",
      "tools": { "required": ["read_note"], "forbidden": ["run_command"] },
      "cites": ["Offer"],
      "never": ["internal margin"]
    }
  ]
}
```

`tools` indica as ferramentas que uma boa execução usa e as que ela não deve tocar; `cites`, as notas que a resposta cita; `never`, texto que não deve aparecer nela. Uma habilidade tem no máximo oito cenários.

**Testar com ⟨modelo⟩** — no fim de **Habilidades** ou no menu de uma habilidade — roda os cenários com o modelo que uma nova conversa usaria. Nada começa sozinho: o diálogo primeiro diz quantos cenários rodariam e com qual modelo, e você define um **Teto** em dólares americanos; o teste termina entre dois cenários assim que ele é atingido. Se não há preço conhecido para o modelo, o teste termina após um número fixo de tokens; um modelo neste dispositivo não precisa de teto.

Cada cenário é uma execução comum da sua habilidade: lê seu vault como uma execução à mão, passa pelo mesmo resumo antes do envio, conta no seu consumo e deixa sua conversa no histórico, onde a próxima execução a substitui. Depois, cada cenário mostra seu resultado em palavras, e a linha da habilidade diz como foi sua última execução. Um resultado vale para um modelo e uma versão da habilidade: se você escolher outro modelo ou alterar a habilidade, a linha diz isso em vez de mostrar um resultado que não conta mais. Alguns cenários incluídos perguntam sobre notas do vault de testes do Plainva; no seu vault eles não valem, e o diálogo os conta à parte em vez de reprová-los.

## Aprender com uma conversa

Uma conversa pode deixar algo: um fato que vale a pena saber, uma regra ou uma habilidade que não foi longe o bastante. **Aprender com esta conversa** — no menu de uma conversa na lista e abaixo da última resposta dela — pede isso. Nada lê suas conversas em segundo plano.

Um diálogo primeiro diz o que aconteceria: a conversa vai mais uma vez para o modelo que a conduziu, e para nenhum outro — o que você escreveu e o que foi respondido, com os nomes das ferramentas usadas. Nada do que uma ferramenta devolveu vai junto, nem nota alguma. Se uma habilidade sua rodou na conversa, as instruções dela vão junto, para que uma versão melhor possa ser sugerida. **Aprender** inicia a revisão; ela custa uma solicitação.

O que volta são rascunhos, cada um com a **Evidência** que a revisão aponta para ele, e nada disso vale antes de você aceitar. Você decide sobre uma entrada da memória e sobre uma regra no cartão de cada uma, como descrito em [Memória](AI_Memory.md). O rascunho de uma habilidade tem, em vez disso, o botão **Revisar**.

Uma conversa que leu uma página da web, um e-mail ou uma ferramenta externa só sugere entradas da memória: o que um desconhecido escreveu não vira regra nem habilidade. O mesmo vale quando a conversa se baseia em notas mantidas fora da nuvem ou da internet, e as entradas que vêm dela levam essa regra. Uma conversa conduzida com um modelo neste dispositivo é revisada neste dispositivo.

### Aceitar uma sugestão para uma habilidade

**Revisar** mostra o que mudaria, linha por linha, e o que a habilidade pode fazer — o que continua como está: uma sugestão altera as instruções de uma habilidade e nada mais. As ferramentas, as pastas e os limites dela nunca são definidos por um modelo. O diálogo diz também se a versão atual foi testada, quanto uma execução custa a mais ou a menos e de qual conversa a sugestão veio. **Ajustar** transforma a comparação em um campo em que você pode digitar.

**Aceitar** grava a nova versão e a aprova neste dispositivo, porque você a viu aqui. Nos seus outros dispositivos, a habilidade passa a aguardar a aprovação de cada um, como após qualquer alteração. Uma sugestão para uma nova habilidade começa com os padrões do Plainva: ela lê e mostra, e não altera nada. Uma habilidade que você importou e as habilidades que vêm com o Plainva nunca são reescritas por uma sugestão.

### Versões em observação e o caminho de volta

Uma versão que veio de uma sugestão fica em observação por três execuções, e a linha dela as conta. Se uma execução termina sem uma resposta, a tela de habilidades nomeia a habilidade em **Versões em observação** e oferece duas opções: **Voltar à versão anterior** ou **Manter**. Nada volta à versão anterior por conta própria.

**Versões anteriores…**, no menu de uma habilidade, lista o que o histórico de versões do vault guarda do arquivo da habilidade. O diálogo compara a versão que você escolhe com a habilidade como ela está agora — as linhas dela e o que ela pode fazer — e avisa onde a versão anterior pode fazer mais. **Restaurar esta versão** grava de volta a versão escolhida e a aprova neste dispositivo. As versões ficam guardadas neste dispositivo.

Para uma habilidade que mudou de qualquer outra forma — pela sincronização ou por uma edição em outro dispositivo —, **Revisar e aprovar** diz o mesmo sob **Em comparação com a versão aprovada**: quais ferramentas entraram e saíram, as pastas, o limite.

Em **O que foi aprendido**, a tela de habilidades abre `.agent/logs/learning.md`: uma linha para cada habilidade e cada regra aceita a partir de uma sugestão, com o dia e a conversa. O arquivo viaja com o seu vault.

## Arrumar

As habilidades se acumulam. Em **Arrumar**, a visualização de habilidades aponta o que este dispositivo notou por conta própria. Nenhum modelo é consultado para isso e nada é enviado, e cada linha é uma pergunta, não uma constatação:

- Duas habilidades que dizem quase o mesmo, de modo que a IA escolhe uma ou a outra. **Comparar** coloca as duas lado a lado.
- Uma habilidade sua que não roda há mais de 90 dias. **Desligar** a tira do catálogo; ela continua no vault.
- Uma habilidade cuja lista menciona uma ferramenta que o Plainva não tem. Ela roda sem essa ferramenta.
- Uma habilidade que não passou no teste com o modelo escolhido agora.
- Uma habilidade cujas execuções terminam repetidamente sem resposta, e um caminho que você seguiu manualmente em três conversas. Nos dois casos, uma revisão da última conversa desse tipo pode sugerir algo — como descrito em “Aprender com uma conversa”: ela custa uma solicitação e pergunta antes.

Cada linha oferece um passo, e nenhum acontece sozinho. **Não mostrar mais** tira uma linha da vista neste dispositivo; ela volta quando a situação em si muda.

## O que vai para o provedor

A visão de envio mostra em **Instruções** o que vai junto: a habilidade da conversa, a lista de habilidades que a IA pode carregar e o `AGENTS.md`. Quando instruções do seu vault vão pela primeira vez para uma nuvem, a visão aparece de novo. Caracteres invisíveis em uma habilidade nunca chegam a um modelo.

## Limites da beta

Uma habilidade não executa scripts próprios; para pequenos programas que leem o seu vault, veja [Scripts](AI_Scripts.md). Suas próprias habilidades não são oferecidas aos apps de IA conectados pelo servidor MCP; apenas as incluídas no Plainva.
