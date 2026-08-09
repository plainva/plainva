# Captura de e-mail

Última revisão: 2026-08-09

O Plainva pode ler sua caixa de e-mail para tirar conhecimento dos e-mails e levá-lo para o seu vault — e, desde a versão 0.4.0, também compor e enviar e-mails. O foco continua sendo a **captura** de mensagens como notas; uma caixa de correio conectada via **IMAP** é sempre apenas lida para captura (nada nela muda, nem mesmo as marcações de não lido), a menos que você configure o envio.

> **Experimental.** O cliente de e-mail se comunica com contas externas reais (IMAP/SMTP e Microsoft) que não podem ser exercitadas nos testes automatizados do Plainva. Funciona e é usado diariamente, mas trate-o como uma prévia: guarde uma cópia de segurança e, por favor, relate qualquer coisa que pareça estranha.

## Conectando uma caixa de correio

**Configurações → seu vault → Contas na nuvem → Conectar conta…** e escolha o provedor:

- **Microsoft** — para Outlook.com e Microsoft 365: marque **E-mail** na etapa de serviços (se quiser, junto com **Arquivos** e **Calendário e tarefas** — uma conta, um login) e entre diretamente pelo navegador, sem senha de app e sem IMAP. O Plainva usa o registro central de app do Plainva para isso (você pode informar seu próprio ID de app opcionalmente nos detalhes da conta). Ler a caixa, capturar e **enviar diretamente** passam todos pelo login da Microsoft.
- **Apple iCloud**, **Yahoo**, **AOL**, **Zoho**, **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru** — blocos dedicados: endereço de e-mail mais uma **senha de app**, os servidores já vêm preenchidos (a maioria desses blocos também permite marcar **Calendário e tarefas** na mesma etapa — uma senha de app para todos os serviços escolhidos). O assistente traz o link do guia oficial de cada provedor para criar a senha de app.
- **Servidor de e-mail (IMAP)** — para todos os outros provedores: host, porta e uma senha ou **senha de app**. Há predefinições prontas para provedores do mundo todo — de **web.de**/**GMX** e **T-Online**, passando por **Orange**, **Libero**, **WP**, **Seznam** e **Comcast**, até **QQ Mail**, **NetEase**, **Naver** e **Yahoo! JAPAN**; a seleção **Provedor** tem uma linha de busca para isso, e digitar seu endereço escolhe automaticamente a predefinição correspondente. Quando um provedor tem particularidades, o assistente avisa logo abaixo do formulário: alguns exigem uma **senha de app** ou um **código de autorização** em vez da senha da conta, outros precisam que o IMAP seja ativado antes nas configurações do provedor — cada um com um link para o guia oficial. Para o Gmail isso é `imap.gmail.com`, porta `993`, com uma senha de app de [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (exige autenticação de dois fatores) — sem OAuth, sem verificação; o assistente já avisa isso sozinho para endereços do Gmail. **Caixas do Outlook.com** não podem mais se conectar via IMAP com senha (a Microsoft desativou esse caminho) — a predefinição aponta para o bloco **Microsoft**. O **Proton Mail** só funciona através do Proton Mail Bridge local pago (tem sua própria predefinição). Para enviar diretamente, é possível informar um host SMTP.

Conectar valida o login antes de salvar qualquer coisa; as credenciais vão para o chaveiro do seu sistema operacional. As caixas de correio conectadas e as configurações de captura ficam depois na área **E-mail**: a configuração **Pasta de e-mail** escolhe onde os e-mails capturados são armazenados (padrão `Mail`).

## Lendo e-mails

Abra a aba de e-mail pela barra de ações à esquerda (ícone de e-mail) ou pela paleta de comandos (**Abrir e-mail**). A lista mostra sua caixa de entrada da mais recente para a mais antiga (não lidas em negrito, **Carregar mais** avança para mais páginas). Selecionar uma mensagem a abre em um **visualizador em sandbox**:

- **O conteúdo remoto é bloqueado** — pixels de rastreamento, imagens remotas e carregadores de estilo são removidos e contados ("Conteúdo remoto bloqueado (n)"). Somente imagens inline autocontidas são exibidas. **Mostrar imagens**, ao lado do contador, revela uma vez as imagens https de uma mensagem; **Sempre carregar imagens remotas**, nas configurações de e-mail, transforma isso em uma opção permanente. Atenção: carregar imagens remotas permite que o remetente veja seu endereço IP e quando você abriu o e-mail — por isso o bloqueio é o padrão.
- **Lido significa lido** — uma mensagem que você abre passa a contar como lida depois de três segundos. Se você a marcar **como não lida à mão**, ela permanece não lida enquanto estiver aberta; a contagem regressiva só recomeça quando você a fecha e a abre de novo. O mesmo nos dois dispositivos — antes, o temporizador do desktop desfazia a marcação três segundos depois, e o telefone marcava a mensagem como lida assim que ela era aberta.
- Links aparecem como texto simples e não são clicáveis dentro do visualizador.
- Scripts e formulários nunca são executados. A mensagem é renderizada em um frame isolado com uma política de conteúdo estrita.
- **Conversas** — o botão acima da lista (ícone de balão) junta mensagens relacionadas em uma única linha: participantes, quantidade e o assunto com que a troca começou. Um toque a expande; cada mensagem mantém sua pasta e a informa quando não é a aberta. Para isso o Plainva também lê **Enviados**, de modo que suas próprias respostas façam parte da conversa. Desligado, tudo fica como antes — uma lista plana — e a escolha é lembrada por vault, nos dois dispositivos. O agrupamento segue a cadeia de respostas das mensagens (na Microsoft, a conversa que o próprio provedor mantém); só quando uma resposta não carrega essa cadeia é que o assunto ajuda, e então apenas para uma resposta reconhecível (“Re:”, “Enc:”) dentro de 30 dias, para que duas mensagens que apenas compartilham o assunto não se juntem.
- **Todas as caixas de entrada** — a primeira entrada acima da lista de pastas mostra as caixas de entrada de **todas** as contas em uma única lista, as mais recentes primeiro, e cada linha diz a qual conta pertence. Lido/não lido e sinalizar também funcionam aqui; mover e excluir continuam pertencendo a cada caixa, porque cada conta tem sua própria pasta de destino — abra a mensagem e você age na caixa dela. Uma conta cujo login está faltando é nomeada e não esvazia a lista das demais.
- **Selecionar vários** — Ctrl+clique (macOS: ⌘+clique) escolhe mensagens isoladas, Shift+clique um intervalo; na visão de conversas, um Ctrl+clique na conversa escolhe a troca inteira, e cada mensagem mantém a própria pasta.

Os anexos são listados com nome e tamanho; o `.eml` original (abaixo) os contém por completo.

Quando você abre uma pasta que já abriu antes, a lista aparece **imediatamente** a partir do cache local enquanto a atualização roda em segundo plano; até ela chegar, um aviso diz “atualizando” — só o que o servidor enviou conta como confirmado. O mesmo vale para uma mensagem que você já leu. No telefone, a mensagem **mais recente** de uma pasta é pré-carregada em segundo plano — ela abre sem espera, mesmo que você nunca a tenha aberto.

No desktop, as três colunas (pastas · lista · leitor) podem ser arrastadas pelos separadores; as larguras são lembradas **por vault** e sobrevivem a um reinício. Cada coluna mantém uma largura mínima, então o leitor nunca é espremido.

Quando uma atualização falha — sem rede, ou o provedor está limitando as requisições —, a lista continua mostrando a última cópia vista neste dispositivo, com um aviso dizendo isso, em vez de um painel vazio. Uma mensagem que você já leu continua legível do mesmo jeito. Isso é apenas um cache: o servidor sempre vence, nada aqui é a única cópia de nada, e remover o vault o remove junto.

## Levando uma mensagem para o vault

Três botões em cada mensagem:

- **Salvar como nota** — cria uma nota na sua pasta de e-mail (`AAAA-MM-DD Assunto.md`) com o remetente e a data no frontmatter e o corpo em texto simples abaixo do título do assunto. Capturar a mesma mensagem duas vezes abre a nota existente em vez de duplicá-la.
- **+ .eml** — além disso, guarda o original bruto ao lado da nota e o vincula a ela. O `.eml` contém tudo, inclusive os anexos, e abre em qualquer programa de e-mail.
- **→ Tarefa** — cria um item no seu [banco de tarefas padrão](Tasks.md) com o assunto como título, a data de hoje como vencimento e o status aberto já preenchido.

## Redigir e enviar

Assim que uma conta puder enviar — uma conta **Microsoft**, ou uma conta **IMAP** com um **host SMTP** configurado —, você pode escrever e enviar e-mails a partir do Plainva:

- **Redigir** (na aba de e-mail) abre uma janela flutuante com linhas rotuladas **De / Para / Cc / Cco**. Digite um endereço e pressione Enter ou vírgula para transformá-lo em um chip; **Cc/Cco** aparecem sob demanda. O corpo é um editor Markdown com uma barra de ferramentas de formatação e um menu de comandos "/". Um link `[texto](https://…)` aparece como um link pronto enquanto você escreve — os caracteres de Markdown voltam a aparecer assim que o cursor entra nele, e um clique abre o destino no navegador. No envio, o corpo é convertido para HTML de qualquer forma: o destinatário sempre recebe um link de verdade, não importa como ele aparecia na janela.
- **Responder**, **Responder a todos** e **Encaminhar** em qualquer mensagem abrem a mesma janela com o original citado e os destinatários pré-preenchidos; um encaminhamento leva consigo os anexos.
- **Enviar** sai por SMTP (contas IMAP) ou Microsoft Graph (contas Microsoft).
- **Esta nota por e-mail** (menu `⋮` de uma nota, ou a paleta de comandos) inicia uma mensagem com a nota atual anexada, ou incorporada como texto.

## Entregar uma nota sem o cliente de e-mail

Você não precisa enviar de dentro do Plainva. Isto funciona com qualquer nota e não precisa de SMTP:

- **Responder como nota** (em uma mensagem): cria uma nota endereçada ao remetente (`to:` no frontmatter) com o original citado — escreva sua resposta no Plainva.
- **Salvar nota como rascunho na caixa de correio** (paleta de comandos, em qualquer nota aberta): grava a nota como um **rascunho na sua própria caixa de correio** via IMAP — escolha a conta, o destinatário e a pasta de rascunhos, depois abra seu programa de e-mail normal, revise e envie por lá. A formatação é preservada.
- **Enviar nota por e-mail (mailto)** (paleta de comandos): abre seu programa de e-mail padrão com a nota como texto simples (notas longas são encurtadas).
- **Copiar nota como texto de e-mail** (paleta de comandos): coloca a nota na área de transferência com formatação — cole em qualquer editor de e-mail.

## Assinatura e endereços de remetente

Em **Configurações → E-mail → Envio**, cada caixa postal tem dois ajustes próprios:

- **Assinatura** — em Markdown, adicionada abaixo do seu texto ao escrever (e acima de um original citado ou encaminhado, onde o leitor espera encontrá-la). Trocar de remetente na janela de composição substitui a assinatura em vez de empilhar uma segunda. O campo usa o mesmo editor da janela de redação, então você vê a assinatura como ela será enviada.
- **Assinatura por endereço** — quando você tiver outros endereços de remetente, aparece o seletor **Assinatura para** acima do campo. “Padrão (todos os endereços)” é a assinatura da conta; escolha um endereço para escrever uma só para ele. Endereços sem assinatura própria continuam usando a padrão, e trocar de remetente ao redigir coloca a correta — inclusive entre dois endereços da mesma conta. Se esvaziar o campo de um endereço, ele volta para a padrão.
- **Endereços de remetente adicionais** — um por linha, p. ex. `Nome <alias@example.org>`. O campo **De** passa a listar endereços em vez de contas: primeiro o da própria caixa, depois os apelidos. Se um endereço é de fato aceito, quem decide é o seu provedor — um servidor que recusa enviar com um apelido avisa, e o Plainva mostra esse erro em vez de enviar silenciosamente com outro nome.

## Ações da caixa de correio

Estrelas/marcações são sincronizadas via IMAP e Microsoft; **Sinalizadas** mostra a seleção do servidor. As mensagens podem ser movidas individualmente ou em grupo. Fora da lixeira, **Excluir** sempre significa “mover para a lixeira”; somente nela aparece **Excluir permanentemente** após confirmação. No Gmail, mover altera rótulos e ações em **Todos os e-mails** podem afetar a mensagem em todos os rótulos; o Plainva avisa antes.

## Denunciar spam

**Spam** move uma mensagem para a pasta de spam da conta e, onde o servidor suporta, a marca com a palavra-chave `$Junk`. Dentro da pasta de spam o mesmo botão diz **Não é spam** e traz a mensagem de volta para a caixa de entrada. Ambos estão disponíveis no leitor, na seleção múltipla e, no telefone, como ação de deslizar da linha.

Sendo honesto: **mover sozinho não treina necessariamente o filtro.** Alguns servidores aprendem com isso, outros apenas guardam a palavra-chave e outros a rejeitam. Depois da ação, o Plainva diz o que realmente aconteceu — “marcada como spam e movida” ou apenas “movida”. Se a sua conta não tiver nenhuma pasta de spam, o Plainva oferece criar uma pasta **Junk** em vez de empurrar correio para um nome de pasta inventado.
