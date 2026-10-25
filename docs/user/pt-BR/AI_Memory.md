# Memória (Beta)

Última revisão: 2026-10-25

A memória guarda o que a IA deve saber sobre você e o seu trabalho sem que você precise repetir: o que você faz, como prefere as respostas, quem são seus clientes. São dois arquivos no seu vault. Nada entra nela sem o seu sim, e você pode ler, alterar e excluir cada entrada.

## Dois lugares

**Sempre incluído** entra em toda nova conversa. Mantenha-o curto: ele tem espaço para 2.000 caracteres, e uma barra mostra o quanto ele está cheio. Uma entrada que não cabe mais é marcada como **Sem espaço — não é incluída** — ela fica salva, mas não vai junto. As entradas são incluídas na ordem em que aparecem, por isso o que mais importa deve ficar no topo; você muda a ordem no arquivo.

**Para consulta** não vai junto. Quando uma pergunta pode depender de algo que você disse à IA antes, ela consulta ali, e a conversa mostra **Pesquisando na memória**. Este é o lugar para o que importa só às vezes: as condições de um cliente, uma decisão e o motivo dela.

## Abrir a memória

No desktop, escolha **Memória** na aba de IA, ao lado de **Habilidades**. No celular, é **Conversas → Memória**. **Configurações → IA e automação** (a parte do vault) também leva até lá: **Abrir a memória**, em **Habilidades e memória**.

## Adicionar uma entrada você mesmo

**Nova entrada** pede três coisas: o texto (uma coisa por entrada, em uma única linha de no máximo 500 caracteres), o lugar (**Sempre incluído** ou **Para consulta**) e se ela é para **Somente modelos neste dispositivo**. Marque essa opção para o que nenhum modelo na nuvem deve saber.

O botão ⋯ de uma entrada — no celular, um toque na entrada — oferece **Editar**, mover para o outro lugar (**Incluir sempre** ou **Só para consulta**) e **Excluir**.

## Deixar a IA lembrar de algo

Diga isso em uma conversa: “Lembre-se de que eu cobro por dia, não por hora.” A IA rascunha uma entrada; ela mesma nunca escreve uma. Abaixo da resposta dela, um cartão **Rascunho · Entrada da memória** mostra o texto inteiro. Escolha o lugar e depois **Lembrar** — ou **Descartar**. Um rascunho sobre o qual você ainda não decidiu fica em **Pendentes**, e a memória informa quantos estão esperando.

“Esqueça que …” funciona do mesmo jeito: o cartão diz **Rascunho · Remover da memória**, e **Remover** retira a entrada. Quando você diz à IA que algo mudou, o cartão mostra, em **Substitui**, de qual entrada a nova formulação toma o lugar.

Uma conversa concluída também pode sugerir entradas: **Aprender com esta conversa** lê a conversa mais uma vez e deixa rascunhos, cada um com a sua evidência. Como isso funciona e o que uma revisão assim pode sugerir de fato está descrito em [Habilidades](AI_Skills.md).

## Uma regra não é uma memória

“Responda sempre em alemão” não é algo a saber — é algo a fazer. Uma regra assim não vai para a memória: ela vira uma linha das **Instruções do vault** (`AGENTS.md`), que todo modelo recebe como instrução. Adicione uma com **Adicionar uma regra**, em **Regras para a IA**, ou peça à IA; o cartão dela então diz **Rascunho · Regra para a IA**, com o botão **Adicionar como regra**.

Como todas as instruções, o arquivo precisa ser aprovado em cada dispositivo antes de valer ali (veja [Habilidades](AI_Skills.md)). Uma regra que você adiciona em um dispositivo em que o arquivo já foi aprovado vale ali na hora; seus outros dispositivos perguntam antes.

## Arrumar

Uma memória que cresceu acaba se repetindo. Em **Arrumar**, a visualização da memória aponta o que este dispositivo notou por conta própria, sem consultar um modelo: duas entradas que dizem quase o mesmo, uma entrada com mais de um ano e entradas em **Sempre incluído** que não cabem mais. **Comparar** mostra as duas entradas juntas, cada uma com tudo o que o menu dela permite fazer.

Para olhar mais de perto, há uma habilidade. **Cuidar da memória** lê as entradas com o modelo de uma conversa e prepara rascunhos do que pode ser unido e do que pode ser retirado; a linha **Pedir uma revisão da memória** a inicia. O que ela sugere são rascunhos como todos os outros: nada muda antes de você aceitar, e quando duas entradas se contradizem ela pergunta em vez de decidir.

## Estilo de escrita

Um rascunho da IA soa como a IA. A seção **Estilo de escrita** descreve como você escreve, para que um rascunho possa soar como você — medido em notas que você mesmo escolhe.

**Escolher exemplos…** abre o seletor de notas de **Fixar nota…**; escolha até oito notas escritas por você. Este dispositivo mede nelas, sem modelo e sem enviar nada: o tamanho das suas frases e parágrafos, listas ou texto corrido, títulos, como você se dirige às pessoas (em alemão “du” ou “Sie”, em francês “tu” ou “vous” — onde uma língua mostra isso nas palavras), negrito, emojis, pontos de exclamação e travessões. Propriedades, código e citações não contam. Cada traço aparece com os números em que se baseia, e o ✕ dele o retira sozinho; **Trazer de volta** traz de volta o que você retirou. Nenhuma palavra ou expressão das suas notas é guardada: o dispositivo guarda os caminhos dos exemplos e o que você retirou, e mede de novo sempre que o estilo é mostrado ou usado.

O estilo só é usado onde você o escolhe: **Meu estilo**, o botão ao lado do globo sob o campo de mensagem, o dá à conversa que você começar em seguida — como a internet, fixado desde a primeira mensagem. A conversa passa a mostrar **Com o seu estilo de escrita**, o resumo de envio ganha uma linha **Estilo de escrita**, e um rascunho de uma conversa assim diz que foi escrito com o seu estilo de escrita; ele continua sendo um rascunho da IA, assinado com o modelo dela. A IA segue o estilo no que você guarda para si — uma nota, uma entrada do diário, uma reescrita do seu texto —, mas não por conta própria em um e-mail, um convite ou um comentário; peça isso ali, e ela o fará.

O estilo fica neste dispositivo, não no vault: em outro dispositivo, você escolhe os exemplos lá. Um exemplo que suas regras de privacidade reservam diante de um modelo não dá a esse modelo nenhum dos seus traços — o resumo de envio o conta em **Retido** —, e o que um modelo neste dispositivo escreve com traços de uma nota assim mantém as regras da nota.

## Privacidade

- Uma entrada pode ter uma regra própria: **Não para modelos na nuvem**, **Não em conversas com a internet**. Um modelo neste dispositivo recebe todas as entradas.
- Uma entrada que a IA rascunhou em uma conversa que leu notas com uma regra de privacidade recebe as mesmas regras — o cartão diz **A entrada recebe as regras de privacidade das notas em que esta conversa se baseou.** O que veio de uma nota que precisa ficar neste dispositivo não chega a uma nuvem pela memória.
- Suas [regras de privacidade](AI_Assistant.md) valem também para os dois arquivos: uma regra de pasta para `.agent/` mantém toda a memória fora da nuvem.
- A visão de envio tem uma linha **Memória** — quantas entradas vão junto — e conta em **Retido** as entradas que suas regras retêm. Ela nunca nomeia uma entrada.
- Para a IA, uma entrada é informação, não instrução: uma frase na memória não lhe dá nenhum direito.
- Uma conversa mantém a memória com a qual foi iniciada. Uma entrada que você exclui não vai para nenhuma conversa nova; as conversas que já começaram mantêm o que receberam.

## Desligar a memória

**Usar a memória neste dispositivo** fica ativado até você desativá-lo. Desativado, uma conversa neste dispositivo não recebe nada da memória e não acrescenta nada a ela. Os arquivos continuam como estão, e cada dispositivo decide por si.

## Os dois arquivos

`.agent/active_memory.md` (sempre incluído) e `.agent/MEMORY.md` (para consulta) são Markdown puro. Cada entrada é um item de lista, e os títulos agrupam as entradas. O que o Plainva sabe sobre uma entrada fica em um comentário depois dela:

```markdown
## Clients

- Harbour Studio pays within 14 days.
- I bill per day, not per hour. <!-- plainva: added=2026-10-09; by=assistant; source=Offer for Harbour Studio; deny=cloud -->
```

`added` e `by` dizem quando a entrada foi adicionada e se você mesmo a escreveu ou aceitou um rascunho, `source` nomeia a conversa de onde veio um rascunho, e `deny` guarda as regras dela (`cloud`, `web`). Você pode editar os arquivos em qualquer editor. No Plainva, **Abrir arquivo** abre qualquer um dos dois.

O Plainva não adivinha. Uma entrada cujo comentário está danificado é marcada como **Regras ilegíveis — não vai para nenhum modelo** até você corrigir o comentário ou adicionar a entrada de novo. Texto oculto em um comentário ou em caracteres invisíveis nunca é enviado; a entrada mostra então quantas partes ocultas ficaram de fora. Um arquivo comporta no máximo 2.000 entradas e 256 KB.
