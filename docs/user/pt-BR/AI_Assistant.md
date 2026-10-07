# Assistente de IA (Beta)

Última revisão: 2026-10-07

O Plainva pode responder perguntas sobre suas notas com um modelo de IA da sua escolha. Ele lê seu vault, cita as notas que usou, abre notas e visualizações para você e propõe alterações em um trecho selecionado como sugestões — nunca muda uma nota sozinho. O assistente é **experimental** e fica desligado até você ativá-lo, separadamente em cada dispositivo.

## Ativando

Abra **Configurações → IA e automação** (a parte do App) e ative **Usar IA neste dispositivo**. Sem o interruptor não há botão de IA, nem aba de IA, nem assistente. Nada é enviado a lugar nenhum até você perguntar algo.

## Escolhendo um provedor

O Plainva não traz um serviço de IA próprio: você usa um provedor à sua escolha, com sua própria chave. Qualquer provedor pode ser escolhido; o Plainva informa os termos e a retenção de cada um para que você decida — não exclui nenhum.

| Tipo | Provedores |
|---|---|
| Provedores de nuvem | Anthropic, OpenAI, Google Gemini |
| Gateways e servidores próprios | OpenRouter, qualquer **Servidor compatível com OpenAI** |
| Neste computador (desktop) | Ollama, LM Studio |
| Neste celular | Apple (iPhone), Gemini Nano (Android) |

1. Em **IA e automação**, escolha **Adicionar provedor** e selecione um. Cada entrada traz uma observação curta sobre seus termos — por exemplo, que o acesso gratuito do Google pode permitir que pessoas leiam suas entradas.
2. Digite a chave com **Inserir chave**. A chave vai para o armazenamento seguro deste dispositivo; o Plainva nunca a mostra de novo — nem para a IA, nem na tela.
3. **Testar conexão** carrega a própria lista de modelos do provedor. Se falhar, a mensagem diz por quê (uma chave rejeitada, nenhuma conexão, um modelo desconhecido).

Um **Servidor compatível com OpenAI** é adicionado pelo endereço. O Plainva pergunta mais uma vez antes de adicioná-lo, em uma janela do sistema operacional, e envia somente para o endereço que você confirmou. `http` simples só funciona para um servidor neste dispositivo; tudo o mais precisa de `https`.

Se você ainda não tem uma chave: um modelo neste computador (Ollama, LM Studio) não custa nada, e o console de cada provedor emite chaves.

**O modelo do sistema no celular.** Em um iPhone com Apple Intelligence (a partir do iPhone 15 Pro), **Adicionar provedor** oferece primeiro **Apple**; em alguns celulares Android, **Gemini Nano**. Ele não precisa de chave, não custa nada e nada sai do dispositivo — por isso nenhum resumo pergunta antes do envio. Sua janela é pequena, cerca de 4.000 tokens para as notas, a pergunta e a resposta juntas: vão menos notas, as rodadas anteriores são encurtadas e ele não usa ferramentas. A linha diz se ele está pronto e, se não, por quê — Apple Intelligence desativado, um dispositivo que não consegue rodá-lo, um modelo que o sistema ainda está preparando; no Android, **Carregar modelo** pede ao sistema que o baixe. O modelo da Apple não fala todos os idiomas (sem polonês). Se o perfil **Local** o indicar, ele também escreve os resumos no celular.

## Modelos e perfis

Quatro perfis — **Rápido**, **Equilibrado**, **Forte** e **Local** — são a sua atribuição de modelos. Escolha um provedor e um modelo para cada um, a partir da lista do provedor ou digitando o id do modelo exatamente como o provedor o chama. **Padrão para novas conversas** decide com qual perfil uma nova conversa começa. O Plainva não chama nenhum modelo de “o melhor”.

Um quinto espaço, **Áudio**, guarda o modelo que transcreve as notas de voz; nunca é o padrão de uma conversa.

Um sexto espaço, **Embeddings**, guarda o modelo com que a pesquisa por significado calcula quando você escolhe **Provedor próprio** em **Pesquisa semântica** — veja [Pesquisa](Search.md).

## Perguntando

- **Desktop:** o botão de IA na barra de ações, **Ctrl+J** (⌘J no macOS) ou **Perguntar à IA** na paleta de comandos abre o assistente — uma pequena janela sobre o seu trabalho. **Abrir como aba** move a mesma conversa para a aba de IA, onde suas conversas estão listadas.
- **Celular:** **Perguntar à IA** no menu ⋮ de uma nota abre a folha de IA sobre essa nota. A área **IA** (na folha de áreas, ou na barra de navegação se você a colocar lá) mostra a conversa em tela cheia; **Conversas** lista as anteriores.
- **Ao lado da nota:** no desktop, a mesma conversa é a última seção da barra lateral direita, **IA**. No celular ou no tablet, é a aba **IA** do contexto da nota — ao lado de **Propriedades** e **Backlinks** —, que um tablet mostra ao lado da nota.

A nota que você tem aberta vai junto automaticamente; remova-a do contexto com o ✕ dela, se quiser. **Fixar nota…** adiciona mais notas. O assistente também pode pesquisar por conta própria: ele pesquisa no vault, lê notas e suas seções, bancos de dados, backlinks e notas vinculadas, lista tarefas, compromissos e as notas abertas ou alteradas há pouco, e abre notas e visualizações. Ele não pode mudar, criar ou excluir nada.

O assistente também pode mostrar coisas a você: abrir uma nota em um título, mostrar uma nota no grafo, levar o calendário até um dia, abrir visualizações, mostrar e ocultar as barras laterais. Para isso, usa os comandos da paleta de comandos — e, deles, só os que mostram algo: não pode acionar os que criam, alteram, excluem, exportam ou abrem uma janela.

Cada conversa começa com a linha “As respostas são escritas por uma IA — ⟨modelo⟩ via ⟨provedor⟩”. Sob cada resposta, uma linha diz o que foi enviado para onde: quantas notas, aproximadamente quantos tokens e — quando o provedor publica preços — o custo aproximado. **Parar** encerra uma resposta a qualquer momento.

Um link em uma resposta só abre depois que você confirma o endereço dele, e imagens em respostas nunca são carregadas.

## O que vai junto

A cada pergunta, o Plainva reúne o que pode importar — neste dispositivo, antes de enviar qualquer coisa:

- **Onde você está:** a data e a hora, a nota ou o banco de dados aberto e sua seleção nele, suas abas abertas, as tarefas que vencem na próxima semana, os próximos compromissos e a nota diária de hoje.
- **Notas que podem importar:** encontradas pelas suas palavras, pelos links da nota aberta e pelo que você abriu ou alterou há pouco. Primeiro decidem suas regras de privacidade; só as notas que elas permitem são avaliadas. Algumas vão como seções — não como notas inteiras —, outras só com o título e um cartão — a primeira frase da seção e cada frase com números, datas, tarefas, negações ou links, palavra por palavra — ou só com o nome; o assistente lê mais delas quando precisa.

Uma nota que a conversa já contém e que não mudou desde então é nomeada, não enviada de novo. Lugares do seu diário e valores de humor nunca são enviados por conta própria.

## Antes de enviar qualquer coisa

A primeira solicitação de uma sessão mostra um resumo: para onde vai (provedor e modelo), quais notas e qual parte de cada uma, o que mais vai junto (sua seleção, compromissos, tarefas), o que foi retido e aproximadamente quantos tokens. **Enviar** envia; **Cancelar** não envia nada e devolve suas palavras ao campo de entrada; o − ao lado de uma nota a deixa de fora. Dentro do que você aprovou, as próximas solicitações vão sem perguntar. O resumo volta sempre que o escopo cresce: outro modelo ou provedor, um novo tipo de dado, notas de outra pasta, novas ferramentas ou uma solicitação muito maior. Um modelo neste dispositivo nunca pergunta.

Se quiser ver o resumo antes de cada solicitação, ative **Perguntar antes de cada solicitação** — no próprio resumo ou em **Configurações → IA e automação**, em **Envio**.

A linha sob cada resposta abre o resumo do que foi com ela. Se uma resposta não cita nenhuma das notas enviadas, um aviso acima dessa linha diz isso; confira então a resposta com as notas. Quando notas foram junto, a linha também indica a cobertura: **cobertura alta** quando quase toda afirmação da resposta cita uma nota, **cobertura parcial** ou **cobertura baixa** quando são menos.

## Ver contexto

O olho abaixo do campo de entrada, **Ver contexto**, mostra o que a próxima solicitação levaria — antes de sair, para o modelo escolhido agora. Para cada nota: por que foi escolhida (aberta agora, fixada, combina com suas palavras, próximo no significado, vinculada, vence em breve …), qual parte vai e aproximadamente quantos tokens. Cada nota você pode

- deixar de fora da próxima solicitação (**Incluir de novo** a traz de volta),
- fixar na conversa,
- manter neste dispositivo para sempre: isso grava a regra `cloud: deny` na nota (veja abaixo).

As notas que suas regras retêm também aparecem, para você saber o que falta; elas nunca são avaliadas nem enviadas. **Enviar com este contexto** envia o que você digitou. Numa aba de IA larga, a visualização fica aberta como uma coluna ao lado da conversa.

Acima das notas, **Enviado** diz quanto dessas notas vai junto — por exemplo ~870 de 3.460 tokens — e **Economizado** quanto isso é a menos do que enviar inteiras todas as notas propostas; na primeira vez, também diz quantos tokens teriam sido. **Mostrar como trilha no grafo** abre o grafo com a nota aberta e as fontes destacadas, e os links entre elas.

Quando o texto que iria para uma nuvem parece conter uma senha ou chave, um número de conta ou de cartão, um número de documento ou fiscal, ou dados de saúde, uma linha abaixo da nota mostra **Possivelmente sensível** e o que foi detectado — em **Ver contexto** e no resumo antes do envio. **Manter neste dispositivo** escreve a regra `cloud: deny` na nota. Para números e segredos, **Ocultar nesta conversa** os troca por um marcador como `⟦withheld account⟧` em cada mensagem desta conversa, também quando o modelo lê a nota por conta própria, até você escolher **Enviar sem ocultar**; o resumo os conta em **Retido**. Tarefas e compromissos têm a mesma escolha na linha **Tarefas, compromissos e dados da nota aberta**. Na primeira vez em uma sessão em que algo desse tipo iria sem ocultar, o resumo pergunta antes do envio. A verificação acontece neste dispositivo; é um aviso, não um filtro: pode deixar passar coisas e nunca impede uma solicitação. Um trecho selecionado vai como está; com um modelo neste dispositivo, nenhum aviso aparece.

## Resumos

Com **Resumos com o modelo local** (em **Configurações → IA e automação**, desativado até você ativar), um modelo no seu computador escreve resumos curtos das seções longas das suas notas, de notas inteiras, das pastas de primeiro nível e do vault. Ele só funciona quando o perfil **Local** indica um servidor neste computador (Ollama, LM Studio; no celular, o modelo do sistema) — nunca uma nuvem em segundo plano — e só enquanto o Plainva está ocioso; no celular, só enquanto ele está aberto. Cada resumo é verificado: o resumo de uma seção precisa manter palavra por palavra cada número, data, valor, link, tag e cada negação; senão, vão as frases da própria seção. Um resumo fica ligado ao texto exato que representa; se você mudar a seção, ele não é usado até ser escrito de novo. Resumos de pastas e do vault só são escritos a partir de notas que suas regras deixam ir para uma nuvem. Em **Ver contexto**, uma fonte enviada como resumo diz isso, e **Original** envia as próprias frases com a próxima mensagem.

## Com uma seleção

Selecione um texto em uma nota, e a IA trabalha só com esse trecho.

- **Desktop:** enquanto você edita, **IA** na barra de seleção oferece **Como sugestão** — **Reescrever**, **Encurtar**, **Traduzir…**, **Criar tarefas** — e **No assistente** — **Explicar** e **Perguntar sobre a seleção…** (**Ctrl+J**, ⌘J no macOS).
- **Celular:** **IA** na barra acima de uma seleção — ao ler e ao editar — abre a folha de IA.
- **Em cada conversa:** enquanto houver texto selecionado na nota aberta, a linha **Com a seleção** acima da entrada oferece as mesmas ações.

Uma ação de sugestão envia apenas o trecho selecionado — não o resto da nota, nem notas fixadas, nem ferramentas — e pergunta com o mesmo resumo de uma pergunta. A resposta volta para a nota como uma rodada de sugestões, como a de uma pessoa: em **Sugestões** você aceita ou recusa cada alteração ou a rodada inteira, e nada muda na nota antes disso. A linha de autor da rodada diz **Plainva IA · ⟨modelo⟩**, para que fique visível qual trecho uma IA escreveu. **Criar tarefas** adiciona as tarefas abaixo do trecho em vez de substituí-lo. Cada ação mantém sua conversa no histórico.

Um trecho de uma nota que suas regras mantêm longe da nuvem — ou um com links para essas notas ou com dados de local — não vai para nenhum modelo na nuvem. Em um workspace criptografado as ações de sugestão ainda não estão disponíveis: as sugestões nele ainda não podem indicar a IA como autora.

## Em um tópico de comentários

Dirija-se ao assistente em um comentário e ele responde no tópico. Digite um **@** no campo de comentário e escolha **IA** — a entrada com o símbolo da IA — ou escreva o nome você mesmo: **@IA**, **@AI** e **@KI** chegam todos a ele, seja qual for o idioma do app. Assim que seu comentário é enviado, o tópico mostra abaixo de **IA** a linha **está escrevendo uma resposta…**; **Parar** interrompe. A resposta aparece como resposta no mesmo tópico, com a linha de autor **Plainva IA · ⟨modelo⟩**. Diferente de uma sugestão, ela não espera ser aceita — é uma anotação ao lado da nota, nunca texto dentro dela — e, no dispositivo que perguntou, você a exclui como uma sua.

O tópico vai para o modelo como uma pergunta: seus comentários, o trecho ao qual está preso e a própria nota, pelo mesmo resumo. Um tópico de comentários é um tipo de dado próprio, por isso o resumo pergunta na primeira vez. Onde suas regras mantêm a nota longe da nuvem, os comentários dela também não vão para lá, e os links neles para notas assim são retidos. Só um comentário que você envia neste dispositivo chama o assistente; um que chega pela sincronização nunca faz isso, diga o que disser. Endereços da web que a IA traz por conta própria — em uma resposta, uma sugestão ou uma transcrição — são escritos de modo que nada os abra ou carregue (`https[://]…`); os endereços que seu próprio texto já continha ficam como estão. Em um workspace criptografado ainda não dá para se dirigir ao assistente: os comentários nele ainda não podem indicar a IA como autora.

## Habilidades

Habilidades são instruções para trabalho recorrente. Doze vêm com o Plainva — entre elas **Orientação do dia**, **Revisão semanal** e **Status do projeto** como chips em uma conversa vazia — e você pode escrever ou importar as suas. Inicie uma com um clique ou simplesmente pergunte: a IA carrega sozinha uma habilidade adequada. Suas próprias habilidades só rodam depois que você as aprova neste dispositivo. Tudo sobre elas: [Habilidades](AI_Skills.md).

## Transcrever uma nota de voz

Em cada nota de voz — no editor, no modo de leitura, no diário e nos cartões — **Transcrever** transforma a gravação em texto. Ela vai como está para o modelo do perfil **Áudio**, pelo mesmo resumo de uma pergunta; uma gravação é um tipo de dado próprio, por isso o resumo pergunta na primeira vez. A transcrição volta como sugestão abaixo da gravação, com o autor **Plainva IA · ⟨modelo⟩** — aceite ou recuse em **Sugestões**.

**Áudio** precisa de um provedor com rota de áudio: OpenAI (por exemplo `gpt-4o-transcribe` ou `whisper-1`), Gemini ou um servidor compatível seu — um servidor neste computador mantém a gravação no dispositivo. É possível transcrever gravações de até 11 MB. Uma gravação em uma nota que suas regras mantêm longe da nuvem não vai para nenhum modelo na nuvem, e os workspaces criptografados ainda não oferecem isso.

## Explicar uma imagem

Em cada imagem do vault, **Explicar imagem** pergunta à IA o que a imagem mostra.

- **Desktop:** na barra de ferramentas de uma imagem aberta e no menu que se abre ao clicar com o botão direito em uma imagem de uma nota — ao editar e no modo de leitura.
- **Celular:** abaixo de uma imagem aberta (em uma imagem de uma nota, **Abrir imagem** leva você até lá).

A imagem vai, com a pergunta, para o modelo com que as novas conversas começam — em uma conversa própria, na qual você pode continuar perguntando: o que diz uma tabela, o que está na segunda coluna, o que significa um diagrama. O resumo mostra a imagem antes de ela ser enviada; uma imagem é um tipo de dado próprio, por isso o resumo pergunta na primeira vez.

**O que vai não é o arquivo.** O Plainva desenha a imagem, a reduz para no máximo 1.568 pixels no lado mais longo e a salva de novo para o envio. Assim ela vai sem o que o arquivo registra sobre ela: o local onde uma foto foi tirada, a data, a câmera. O resumo mostra exatamente a imagem que vai, com o tamanho dela. Essa cópia fica com a conversa neste dispositivo, para que você ainda possa ver depois o que o provedor recebeu; se você excluir a conversa, ela some.

**Regras.** Uma imagem em uma pasta que suas regras mantêm longe da nuvem não vai para nenhum modelo na nuvem. O mesmo vale para uma imagem mostrada em uma nota com a regra `cloud: deny` — não importa onde você pressione **Explicar imagem**, inclusive na imagem aberta: antes de enviar, o Plainva procura quais notas incorporam a imagem e, se não conseguir descobrir, a imagem fica neste dispositivo. Um modelo neste dispositivo continua permitido. O que está escrito em uma imagem é conteúdo, como o texto de uma nota, nunca uma instrução: a conversa de **Explicar imagem** pode consultar o seu vault, mas não pode usar a internet e não aciona nada no app.

**Quais modelos leem imagens.** A maioria dos modelos na nuvem lê. O modelo do sistema no celular não lê, e **Explicar imagem** avisa isso. Quando a lista de um provedor diz que um modelo não lê imagens, o resumo avisa antes de você enviar. Se um provedor recusar a solicitação, escolha outro modelo abaixo da conversa e pergunte de novo — a imagem continua nela.

## Na internet

O assistente não pode usar a internet até você permitir — três vezes:

1. **Para o vault.** Em **Configurações → IA e automação** (a parte do Vault), ative **A IA pode usar a internet neste vault**. O interruptor fica desligado em todos os vaults até você decidir e vale somente neste dispositivo.
2. **Para uma conversa.** Antes da primeira mensagem de uma nova conversa, pressione o globo abaixo do campo de entrada — **Deixar esta conversa usar a internet**. Se uma conversa pode ou não usar a internet é decidido quando ela começa; para mudar isso, comece uma nova conversa. Uma conversa que pode usá-la diz isso na primeira linha. Iniciar a habilidade **Investigar** é a mesma escolha: a conversa dela pode usar a internet — veja [Habilidades](AI_Skills.md).
3. **Para cada solicitação.** Enquanto suas notas estiverem na conversa, cada página que o assistente quer ler e cada pesquisa que ele quer fazer perguntam antes, com o endereço completo ou as palavras da pesquisa — é tudo o que sai do seu dispositivo para isso. **Ler página** ou **Pesquisar** deixa passar esta única solicitação; **Não ler** ou **Não pesquisar** a deixa de lado, e o assistente continua sem ela.

**O que é uma solicitação.** Ler uma página é uma solicitação deste dispositivo ao site, como abrir a página em um navegador — sem cookies, sem login e sem nada das suas notas; como em qualquer visita, o site vê o seu endereço IP. Só páginas públicas via `https` são lidas; endereços da sua rede doméstica ou da empresa são recusados. Uma pesquisa vai para o provedor do seu modelo — Anthropic, OpenAI, Google Gemini ou OpenRouter —, que pesquisa exatamente com as palavras que lhe foram mostradas; os provedores podem cobrar as pesquisas separadamente. Um modelo neste dispositivo pode ler páginas, mas não pode pesquisar, e o modelo do sistema no celular não pode usar a internet de forma alguma.

**De onde vem um endereço.** A pergunta diz se você informou o endereço, se uma nota ou um resultado o citou — ou se o modelo o montou sozinho. Um endereço que o modelo montou poderia levar algo das suas notas: leia-o antes de deixá-lo passar.

**Sites sem confirmação.** Com **Sempre para ⟨site⟩** em uma pergunta, ou em **Sites sem confirmação** nas configurações do vault, as páginas de um site são lidas sem perguntar — desde que o endereço tenha sido citado por você, por uma nota ou por um resultado. Um endereço que o modelo montou sempre pergunta.

**O que o assistente lê.** Nunca a página em si. Uma segunda solicitação ao mesmo modelo, sem ferramentas, lê a página e escreve um relatório curto: um resumo, afirmações com o trecho em que se baseiam e links que realmente estão na página. Uma página que tenta dar instruções ao assistente chega até ele, portanto, como um relatório sobre uma página — nunca como uma página com a qual ele trabalha. Abaixo da resposta, **Lido na web** lista as páginas lidas, e a linha abaixo dela abre tudo o que foi solicitado.

**Notas que ficam de fora.** Uma nota ou pasta com **Acesso à web: nunca** (veja Regras de privacidade abaixo) não existe para uma conversa que pode usar a internet: nem no contexto dela, nem para as ferramentas dela, e os links para ela são retidos.

Um link em uma resposta cujo endereço o próprio modelo montou é marcado, e a pergunta antes de abri-lo diz isso. Se nenhuma resposta chega — sem conexão, o provedor não responde —, a conversa lista, em vez disso, as notas que melhor combinam com sua pergunta.

## E-mail e compromissos

**Compromissos.** O assistente lista compromissos dos seus calendários conectados — dia, hora e título, se você pedir também o local e quem participa — e lê um único compromisso em detalhe: o organizador, os participantes com as respostas deles e a sua. Ele nunca recebe o link de uma reunião online; esse fica no calendário.

**E-mail.** Se houver contas de e-mail conectadas neste vault, o assistente pode pesquisar e ler mensagens. O e-mail não é uma das ferramentas com que uma conversa começa: o assistente só o procura quando a sua pergunta precisa dele, e no primeiro acesso o Plainva pergunta — **Ler seu e-mail?** **Permitir** vale para este provedor até você fechar o Plainva; outro modelo ou outro provedor pergunta de novo. **Não permitir** deixa o acesso de fora, e o assistente continua sem ele. Um modelo neste dispositivo não pergunta, porque nada sai do dispositivo para ele.

**O que o assistente lê do e-mail.** De uma pesquisa, ele vê a data, o remetente e o assunto das mensagens — nunca o texto delas. Ele nunca lê sozinho o texto de uma mensagem nem a descrição de um compromisso: outras pessoas os escreveram, e quem escreve um e-mail ou um convite pode escrevê-lo justamente para esse leitor. Um segundo leitor, sem nenhuma ferramenta, os lê e escreve um relatório curto — um resumo, afirmações com o trecho em que se baseiam e links que realmente estão ali. Se um modelo neste dispositivo estiver definido como **Local** em **Modelos e perfis**, esse modelo é o leitor, e o texto em si não sai do dispositivo; só o relatório vai para o provedor. Caso contrário, quem lê é o provedor da conversa, em uma solicitação à parte, sem ferramentas. A pergunta diz de antemão quem lê.

**O que não muda.** O assistente só lê: uma mensagem que ele leu continua não lida, e ele não move, não responde e não exclui nada, nem abre anexos — só diz o nome deles. Abaixo da resposta você vê quantas mensagens foram lidas, e a linha abaixo dela diz quem leu o texto.

## Ferramentas externas (MCP)

O assistente pode usar ferramentas de servidores que você mesmo conecta, pelo Model Context Protocol (MCP) — um sistema de tickets, um wiki, um banco de dados da sua equipe. É o sentido contrário de [Conectar apps de IA](Connect_AI_Apps.md): lá, outros apps leem o seu vault pelo Plainva; aqui, o assistente do Plainva pergunta a outros servidores. Nada de um servidor é usado antes de você olhar o que ele oferece, e cada chamada é mostrada a você antes de sair.

**Adicionar um servidor.** Em **Configurações → IA e automação** (a parte do Vault), em **Ferramentas externas (MCP)**, escolha **Adicionar um servidor…**. Dê a ele um nome seu e o endereço dele (`https://…`), e um token de acesso se o servidor pedir — ele vai para o armazenamento seguro deste dispositivo e nunca é mostrado de novo. No desktop, um servidor também pode ser um **Programa neste computador**: o arquivo a iniciar, os argumentos dele e os valores para o ambiente dele. O Plainva o inicia diretamente, sem shell, e em uma sandbox quando o seu computador tem uma que o Plainva possa usar. O seu sistema mostra o endereço ou o comando inteiro mais uma vez antes de ele ser lembrado. No celular, um servidor é sempre um endereço.

**Fazer login.** Alguns servidores pedem um login em vez de um token. A revisão dele diz então **O servidor pede um login.** Escolha **Entrar…**: o Plainva pergunta ao servidor onde fica o login dele, abre essa página no seu navegador e espera você voltar. O que ele recebe fica no armazenamento seguro deste dispositivo e vai somente para este servidor; nem você nem a IA o veem. Ele é renovado sem você enquanto o servidor permitir e, quando termina, a revisão pede que você entre novamente. Se o serviço de login não permite que aplicativos se registrem sozinhos, o Plainva pede o **ID do cliente** que o responsável pelo servidor deu a você. **Sair** esquece o login; um login e um token de acesso armazenado substituem um ao outro.

**Revisar o servidor.** Um servidor recém-adicionado ainda não oferece nada. A revisão dele mostra o que está registrado e o que o servidor lista: a descrição dele mesmo, as ferramentas com suas descrições — palavras do próprio servidor — e os prompts. **Aprovar** permite exatamente esses textos, neste dispositivo. Antes de um servidor ser usado, o Plainva carrega de novo o que ele lista e compara com o que você aprovou; se algo diferir, o servidor fica bloqueado até você olhar de novo, e a revisão diz o que mudou.

**O que um vault permite.** Cada vault decide por si: se usa o servidor (**Usar ⟨servidor⟩ neste vault**), quais das ferramentas dele o assistente pode chamar — nenhuma vem marcada, e só podem ser marcadas as que dizem que apenas leem —, e em **Notas que podem acompanhar uma chamada**, se **Nenhuma**, **Pastas escolhidas** ou **O vault inteiro**.

**Em uma conversa.** As ferramentas dos seus servidores não estão entre as ferramentas com que uma conversa começa: o assistente só as procura quando a sua pergunta precisa delas, e o resumo antes do envio nomeia os servidores a que pertencem. Cada chamada pergunta antes — **Chamar ⟨servidor⟩?** — com a ferramenta e exatamente o que seria enviado. **Chamar** deixa passar esta única chamada, **Não chamar** a deixa de lado, e não existe um “sempre”. Uma chamada nem chega a sair se a conversa leu uma nota que fica fora do que o vault permite a este servidor, ou uma que você mantém fora da nuvem. O que volta é tratado como o texto de um desconhecido: o assistente lê e não aceita instruções dele.

**Prompts.** Um servidor pode oferecer prompts — solicitações prontas. Eles ficam sob uma conversa vazia, e só você os inicia. Na primeira vez, o Plainva mostra no que um prompt se transforma antes de ser enviado como sua mensagem; a partir daí, exatamente esse texto vai sem perguntar, e outro texto bloqueia o servidor.

**O que o Plainva guarda.** O endereço ou o comando é lembrado neste dispositivo, os valores armazenados no armazenamento seguro dele; a sua aprovação fica nos dados do próprio Plainva, nunca no vault — assim, quem pode gravar no vault não pode aprovar um servidor. Em **Chamadas recentes neste vault**, a revisão lista quando uma ferramenta foi chamada, qual e como terminou — nunca o que foi dito. **Remover servidor** exclui o servidor deste dispositivo, para todos os vaults.

Uma conversa iniciada por uma habilidade, uma ação em uma seleção e uma resposta em um tópico de comentários não alcançam as ferramentas externas, e o modelo do próprio sistema no celular também não.

## Manter uma resposta como nota

Abaixo de cada resposta concluída, **Manter como nota** transforma a resposta em uma nota do seu vault. Você pressiona e o Plainva escreve a nota — o assistente em si continua não mudando nada.

- **Para onde vai.** Para a **Pasta de entrada** do vault (**Configurações → Conteúdo e estrutura**), com um nome tirado da sua pergunta — em uma conversa iniciada por uma habilidade, da habilidade e da nota que estava aberta, ou do dia. Uma nota que já está lá nunca é tocada: a nova recebe o próximo nome livre. O Plainva a abre na hora.
- **Quem a escreveu.** A primeira linha diz isso em palavras — uma resposta do Plainva IA, com o modelo, a hora e a sua pergunta. As propriedades da nota dizem o mesmo para outras ferramentas: `generated`, com o modelo e a hora. Nada marca a nota como revisada; isso continua sendo coisa sua — veja [OKF](OKF.md).
- **Em que ela se baseia.** Abaixo da resposta, **Fontes** lista o que a execução realmente usou. O Plainva escreve essa lista a partir do próprio registro, não o modelo: as páginas lidas e quando, as pesquisas e por qual provedor, e as suas notas que foram junto ou foram lidas. As propriedades trazem a mesma lista como `sources`.
- **Endereços.** Todo endereço da web que o modelo escreveu na resposta é escrito de modo que nada o abra ou carregue (`https[://]…`), e uma imagem da web nunca é uma imagem na nota. Só as páginas em **Fontes** são links de verdade: endereços que a execução leu com a sua permissão. Links para as suas próprias notas continuam sendo links.
- **Regras.** Uma resposta mantida herda as regras de privacidade daquilo em que se baseia. Se uma nota que estava na conversa, ou uma que o assistente leu, é mantida fora da nuvem ou da internet, a nova nota leva a mesma regra — escrita na própria nota onde a pasta dela permitiria mais. Assim, uma resposta que um modelo neste dispositivo fez a partir de uma nota privada também não chega a uma nuvem como nota.

Em um workspace compartilhado, os membros dele podem ler uma nota — e também os leitores de uma publicação que abrange a pasta. Ali o Plainva pergunta sempre, com o nome da nota e a pasta: **Manter como nota** a escreve, **Não manter** não escreve nada.

## Regras de privacidade

Algumas notas nunca devem chegar a um provedor de nuvem. Uma regra pode ficar no frontmatter de uma nota:

```yaml
plainva:
  ai:
    cloud: deny
```

ou, para uma pasta inteira, em **Configurações → IA e automação** (a parte do Vault), que grava as regras em `.agent/policy.yml`. Uma nota mantida fora da nuvem não contribui com nada — nem texto, nem título — e os links para ela em outras notas são retidos. Modelos neste dispositivo continuam permitidos. Workspaces criptografados mantêm a nuvem desligada, a menos que você a permita ali. O formato exato está na [Referência do Formato de Arquivo](File_Format_Reference.md).

Uma imagem pertence às notas que a mostram: uma imagem incorporada em uma nota mantida fora da nuvem também não vai para nenhum modelo na nuvem (veja Explicar uma imagem acima).

Uma segunda regra, `web: deny` — **Acesso à web: nunca** nas configurações —, mantém uma nota ou uma pasta fora de toda conversa que pode usar a internet.

## Histórico e uso

As conversas ficam neste dispositivo, por vault — nunca no vault e nunca sincronizadas. **Manter conversas** decide por quanto tempo; você pode excluir conversas individuais na lista ou todas as de um vault de uma vez. **Uso neste mês** soma os tokens por provedor e modelo.

## Limites da beta

- No desktop, a IA roda apenas na janela principal.
- No celular, uma resposta só chega enquanto o Plainva estiver aberto.
- O assistente não muda nenhuma nota sozinho: propõe alterações em um trecho selecionado e transcrições de notas de voz, como sugestões que você aceita ou recusa; em um tópico de comentários ele escreve uma resposta ao lado da nota, nunca texto dentro dela. Uma resposta só vira nota quando você pressiona **Manter como nota**; é então que o Plainva a escreve, não o assistente.

O feedback sobre a beta vai para as discussões do projeto no GitHub: **Feedback sobre a IA (beta)** nas configurações abre uma.
