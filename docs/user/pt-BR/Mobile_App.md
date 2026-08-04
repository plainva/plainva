# O app mobile

Última revisão: 2026-08-03

O Plainva também está disponível como aplicativo para Android e iOS. Ele funciona com os mesmos arquivos Markdown, o mesmo formato **OKF** e o mesmo mecanismo de sincronização do app de desktop — seu vault permanece idêntico nos dois mundos.

## Instalar o app

O app mobile está em **beta fechado**. No **Android** você entra em dois passos: entre no grupo de testadores por [plainva.com/android-beta](https://plainva.com/android-beta) e depois aceite no Google Play. No **iPhone**, a distribuição é pelo TestFlight; a lista de espera fica em [plainva.com](https://plainva.com).

O Google só libera o app na Play Store pública quando 12 testadores permanecem por 14 dias seguidos — então entrar e simplesmente deixar instalado já ajuda.

## Layout

- **Barra inferior:** **de duas a quatro** superfícies de trabalho à sua escolha, mais o item fixo **Seções** no final — ao todo, de três a cinco destinos para uma barra. **Notas** permanece sempre visível: é assim que você chega aos seus arquivos.
- **Cada seção** (Notas, Hoje, Tarefas, Calendário, E-mail, Grafo) fica sempre a um toque de distância pela **folha de seções**: **Seções** na barra, o **▾ ao lado do título**, ou um **toque longo na barra**. A folha marca a seção atual e leva direto, na parte de baixo, a **Personalizar a barra de navegação…**. Tags, favoritos e os itens recentes deixaram de ser seções próprias — agora ficam em **Notas**.
- **Configurando a barra:** **Configurações** → **Barra de navegação**. Use **−**/**+** para definir quantas superfícies de trabalho a barra mostra (2–4, com prévia ao vivo) e a **alça de arrastar** para organizar a lista: as entradas do topo formam a barra (marcadas com uma moldura), arrastar uma para cima a promove. Arrastar até a borda superior ou inferior rola a lista junto, de modo que um único movimento cobre a lista inteira. Nada fica escondido — o que não está na barra continua acessível por **Seções**. Se a seção em que você está sair da barra, o app vai para a primeira visível. Você também pode organizar a mesma barra **no desktop** (Configurações → Vault → Barras e áreas); com a sincronização de configurações ativada, a organização viaja entre seus dispositivos.
- **＋** flutua como um botão redondo acima da barra e abre a criação rápida: nota, nota diária, pasta, banco de dados, "A partir de modelo…".
- **Cabeçalho:** o mesmo em toda parte — à esquerda Voltar (ausente numa superfície de trabalho), no centro o título e uma linha de contexto, à direita a busca e ⋮. Ao rolar, ele se descola do conteúdo e a barra de navegação se recolhe aos ícones; ao rolar para cima, ela se abre de novo.
- **Um ⋮ sempre significa a mesma coisa:** ações sobre o objeto que está aberto. As configurações do app não ficam atrás dele.
- **Configurações:** bem no fim de **Notas**, assim como no desktop. Abrem primeiro a lista de seções (como o lado esquerdo das configurações do desktop) — um toque abre a respectiva página. No topo, **Vault ativo** leva ao gerenciamento de vaults: trocar de vault (marca de seleção = ativo), **Criar um vault** e **Conectar um cofre na nuvem**.

## Ler e editar notas

As notas abrem **renderizadas e somente leitura**; o lápis no canto superior direito muda para o modo de edição (com uma barra de ferramentas acima do teclado: formatação, listas, link wiki, comandos de barra, inserir foto). Incorporações `![[Nota]]` aparecem como cartões de pré-visualização tocáveis.

O botão **Detalhes da nota** no cabeçalho (entre o marcador e o menu ⋮) abre o painel de contexto da nota: propriedades (diretamente editáveis), backlinks, estrutura, grafo e o **histórico de versões** — cada edição cria automaticamente snapshots que você pode inspecionar, comparar e restaurar. O código-fonte Markdown e a busca na nota ficam no menu ⋮.

## Modelos

Os modelos funcionam exatamente como no desktop: os placeholders (`{{title}}`, `{{date}}`, `{{daily+1}}`, `{{weekday:monday}}` …) são preenchidos quando a nota é criada, **todas** as perguntas de um modelo chegam juntas em **uma** folha — cancele e nada é criado — e `{{cursor}}` posiciona o cursor assim que a nota é aberta.

As regras **pasta → modelo** e **tipo de nota → modelo** são definidas no desktop; elas viajam com a sincronização de configurações e também valem aqui — então uma nota em `Projekte/` começa da mesma forma nos dois dispositivos, inclusive na captura pelo `＋` e em **+ Entrada** num banco de dados. Dois detalhes: `{{weekday:…}}` sempre conta a partir de segunda-feira no celular (a configuração de início da semana ainda não existe lá), e `{{clipboard}}` pergunta o conteúdo da área de transferência na mesma folha, em vez de lê-lo sem perguntar. A lista completa de placeholders está em [Notas & Markdown](Notes_and_Markdown.md).

## Bancos de dados (`.base`)

Os bancos de dados `.base` funcionam como no desktop: todas as visualizações (tabela, lista, galeria, quadro, calendário, linha do tempo), edição tipada de células, os cartões do quadro se movem tocando e segurando. **Configurar** gerencia visualizações, colunas, filtros (incluindo grupos), ordenação e propriedades. Os esquemas de relação (destinos, cardinalidade) continuam sendo mantidos no desktop.

Uma visualização **Mural** mostra as notas como um quadro de duas colunas com cartões adesivos: tocar abre a nota, tocar e segurar mostra as ações (fixar, marcadores, cor, excluir), arrastar após tocar e segurar reordena, e as caixas de seleção são marcadas direto no cartão. O campo de entrada no topo captura uma nova nota. Dica: aponte o banco de dados para a sua pasta de entrada (**Configurações** → **Conteúdo e estrutura**) e as notas rápidas do ＋, assim como os textos compartilhados de outros apps, caem direto no mural.

## Tarefas

A área **Tarefas** reúne todas as caixas de seleção do seu vault — todas as linhas `- [ ]` e `- [x]` de todas as notas, agrupadas por nota. É a visão geral baseada em linhas que um banco de dados não consegue dar, porque um banco de dados trabalha sobre notas inteiras.

Tocar em uma tarefa abre a nota **naquela linha**; a caixa marca a conclusão e grava de volta exatamente o caractere `[ ]`/`[x]`. Datas de vencimento (`📅`) e `#tags` aparecem como chips, para não se repetirem dentro do texto.

Se o seu vault tem um **banco de tarefas** (**Configurações** → **Conteúdo e estrutura**), a área o mostra como sua própria seção acima: marcar como concluída, alterar status, **+ Nova tarefa** e **Abrir como banco de dados**. Cada linha de caixa de seleção também traz um botão que a **move para o banco de dados** — a linha permanece como um link wiki, e a tarefa passa a viver como uma nota própria.

Acima da lista você tem os mesmos filtros do desktop: **Pasta**, **Etiqueta**, **Com vencimento** e **Mostrar ocultas**. Ocultar é uma propriedade da **nota**, não da tarefa individual — o ícone de olho no cabeçalho de uma nota grava `plainva.tasks: false` no frontmatter dessa nota e a tira da visão geral; **Ocultar modelos** faz o mesmo de uma vez para toda a pasta de modelos. O arquivo mantém suas tarefas, elas só param de contar. Pressionar e segurar o botão de mover escolhe o **banco de dados de destino** quando seu vault tem mais de um.

Mais duas ações em uma tarefa de banco de dados: **Bloquear tempo** cria um evento de calendário para a tarefa quando há um calendário conectado (data, início, duração, além do seletor de calendário quando há mais de um gravável), e **Repetição** cria a próxima tarefa com um novo vencimento quando você marca esta como concluída. Ambas estão descritas em [Tarefas](Tasks.md).

## Hoje

**Hoje** é a superfície do dia. A faixa no topo seleciona um dia — ela vai **nas duas direções**, duas semanas para trás e duas semanas para a frente, e um ponto marca cada dia que já tem uma nota diária. Abaixo dela fica a **nota diária** do dia selecionado (com seu modelo e sua pasta, para abrir ou criar), depois os **compromissos e vencimentos** daquele dia, e por fim o que você editou naquele dia.

A seção do meio reúne o que normalmente fica em duas áreas separadas: primeiro os eventos de dia inteiro, depois os com horário, em ordem cronológica, e por último as tarefas que vencem naquele dia. Tocar em uma tarefa abre a nota dela. Sem um calendário conectado e sem um banco de tarefas, a seção simplesmente não aparece.

## Tags

A lista de tags fica em **Notas**. Tocar abre as notas de uma tag; a seta expande as tags aninhadas. **Pressionar e segurar** uma tag oferece **Renomear tag** — em todo o vault, como no desktop: o Plainva reescreve toda nota que a carrega (no frontmatter e como `#tag` no texto, incluindo suas `tag/child` filhas) e depois te diz em quantas notas ela foi substituída. Uma nota que não pode ser lida ou gravada é ignorada — as demais são renomeadas de qualquer forma.

## Grafo

O **mapa do vault** mostra seu vault como nós e arestas. Tocar em uma bolha de pasta a expande, tocar em uma nota a abre; os chips acima filtram por tipo de nota, tag e tipo de aresta. Arraste um nó e **o mapa lembra onde você o colocou** — o arranjo lembrado fica em `.plainva/graph.json` e permanece propositalmente neste dispositivo, como o índice de busca.

**Pressionar e segurar** um nó ativa o **foco** sobre ele: o mapa então mostra apenas a vizinhança dele até a profundidade que você escolher (1–3). O chip que exibe a profundidade limpa o foco de novo. Mais dois chips leem o mapa por idade: o **Mapa de calor** tinge cada nó conforme o quão recentemente ele mudou, e a **Viagem no tempo** oculta tudo o que for mais recente que o controle deslizante — assim você pode ver o vault crescer.

## Calendário e eventos

O **Calendário** (aba inferior ou em "Mais") mostra suas notas diárias em uma grade mensal. O ícone do relógio no canto superior direito abre o **calendário de eventos** com as visualizações **Dia**, **3 dias** e **Agenda** — seus calendários conectados usam o mesmo modelo de contas do desktop. Tocar em um evento mostra os detalhes; para um convite, você pode **aceitar**, marcar como **talvez** ou **recusar** ali mesmo.

Gerencie as contas pelo ícone de engrenagem no calendário de eventos: conecte o **CalDAV** no dispositivo com uma senha de aplicativo (p. ex. Fastmail, Nextcloud, iCloud); Google e Microsoft seguem via login pelo navegador. Por conta, você pode mostrar ou ocultar calendários individuais.

A partir de um evento, **Nota de reunião** cria a nota correspondente a ele — a mesma nota que o desktop também encontra: ela permanece vinculada ao evento, então chamá-la de novo a reabre em vez de criar uma segunda, e ela vai parar na **Pasta de reuniões**. Essa pasta e o **Calendário padrão** (aquele em que um novo evento começa) são definidos na área de contas, em **Configurações do calendário**; ambos pertencem ao vault e viajam com a sincronização de configurações. O mesmo lugar permite escolher, por conta, quais **Listas de tarefas** são espelhadas no seu banco de tarefas.

**O login é por dispositivo.** O que sincroniza são as *configurações* da sua conta, nunca o login em si — de propósito: credenciais não devem sair do dispositivo. Uma conta que chegou pela sincronização de configurações aparece então na lista, mas com o marcador **entrar**, com uma linha logo abaixo dizendo o que fazer. Enquanto nenhuma conta estiver conectada neste dispositivo, o calendário explica isso no lugar em vez de simplesmente ficar vazio, e **Entrar neste dispositivo** leva você até as contas. Contas conectadas mostram **ativa**. Se um login expirar depois ou for revogado, a linha diz **acesso expirado** junto com o motivo — e **Entrar novamente** o recoloca em funcionamento sem remover a conta: a mesma conta, os mesmos calendários.

**Um login para todos os serviços — também aqui.** Se uma conta Microsoft ou Google carrega vários serviços (arquivos e calendário, por exemplo), a área **Contas na nuvem** oferece unificá-los em um único login. Depois disso, um único login mantém todos os serviços ativos, e não apenas um — antes, um serviço podia continuar funcionando enquanto outro da mesma conta expirava silenciosamente. Uma caixa de correio do Gmail fica de fora: ela roda por IMAP com senha de app e não exige consentimento.

## E-mail

Em **Configurações → E-mail** você conecta uma **caixa de correio da Microsoft** (Outlook.com, Microsoft 365) diretamente pelo login no navegador — sem senha de app. Como no calendário, o login vale por dispositivo.

Depois você pode abrir **E-mail** como uma área própria pelo ▾ ao lado do título e colocá-la na barra de navegação. A linha abaixo do título mostra pasta, não lidas e conta, e abre o seletor de pastas. Toque em uma mensagem para lê-la; **Salvar como nota** a arquiva na pasta **Mail** do seu cofre (capturar duas vezes abre a mesma nota). Imagens remotas continuam bloqueadas até você liberá-las para aquela mensagem — uma imagem carregada informa ao remetente quando e onde você leu.

**Caixas IMAP também funcionam no telefone.** Adicione uma em **Configurações → E-mail**: escolha o provedor, informe o endereço e a senha de aplicativo, e o Plainva preenche os servidores. Se o seu provedor não estiver na lista, **Avançado** permite digitar você mesmo os servidores IMAP e SMTP, as portas e um nome de usuário diferente, e uma conta existente pode ser editada depois. Para selecionar várias mensagens, basta tocar e segurar uma delas; depois, um toque adiciona outras. Na visão de conversas, manter pressionada ou tocar a linha da conversa escolhe a troca inteira — e cada mensagem mantém a própria pasta, então uma resposta de **Enviados** é marcada lá.

Uma mensagem aberta oferece **Responder**, **Responder a todos** e **Encaminhar**. Uma resposta cita o original abaixo do seu texto; "Responder a todos" também inclui os demais destinatários e deixa de fora o seu próprio endereço. Ao **redigir**, **Anexar arquivo** adiciona um arquivo do cofre — no celular, o cofre é o armazenamento que você consegue acessar, e tudo o que chega ao dispositivo (um anexo salvo, uma foto inserida) já está lá. Cada anexo ganha sua própria linha com **Remover anexo**, enquanto a mensagem ainda não tiver sido enviada.

Uma mensagem que você começou não precisa ser enviada: **Salvar rascunho** a arquiva na pasta de rascunhos da sua conta — onde qualquer programa de e-mail nessa caixa vai encontrá-la, não em um lugar exclusivo do telefone. Qual é essa pasta, o servidor informa; só quando ele fica em silêncio o nome é adivinhado. Na lista, dois interruptores ficam ao lado da linha da pasta: **Não lidos** reduz o que está carregado no momento (assim o contador e **Carregar mais** continuam acessíveis), enquanto **Marcadas** pede ao servidor todas as mensagens marcadas da pasta — inclusive as que estão bem abaixo da página carregada. Em **Todas as caixas de entrada** o interruptor de marcadas fica ausente de propósito: essa consulta nomeia exatamente uma caixa de entrada.

A partir de uma mensagem aberta, três caminhos levam ao cofre: **Salvar como nota**, **→ Tarefa** no menu ⋮ (cria uma entrada no seu banco de tarefas padrão — com o modelo, o status e a data da mensagem) e **+ .eml**, que também guarda a mensagem original e cria um link para ela a partir da nota. Os três são ancorados: capturar a mesma mensagem duas vezes abre o que já existe. **Excluir** agora também fica no menu ⋮ em vez de ao lado da seta de voltar; na lista, basta um deslize. Mover para a lixeira oferece **Desfazer**, porque pode ser revertido — excluir definitivamente da lixeira continua perguntando, porque isso não pode. E, em vez de vários avisos empilhados uns sobre os outros, agora há **uma** única linha: o erro; senão, as contas inacessíveis (a partir de duas, como número); senão, o aviso sobre a cópia salva.

Uma nota pode ser enviada pelo seu próprio menu ⋮: **Enviar nota por e-mail (mailto)** a entrega ao aplicativo de e-mail do telefone — o Plainva não precisa de uma conta própria para isso —, enquanto **Enviar por e-mail** abre o próprio editor de e-mails do Plainva com assunto e texto.

## Sincronização

Em **Configurações** (⋮), **Vault ativo** leva ao gerenciamento de vaults; lá você conecta o armazenamento na nuvem (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Conectar um cofre na nuvem** traz um vault existente na nuvem para o dispositivo; **Criar um vault** primeiro pergunta **Neste dispositivo** ou **Em um serviço on-line** e depois pede a estrutura inicial (vazio ou um modelo como PARA) — no caminho on-line, a conexão vem em seguida: a pasta de destino na nuvem pode ser criada na hora com **Nova pasta** na folha do seletor, e a estrutura é enviada pela primeira sincronização. No primeiro início do app, a opção (**"Conectar um cofre na nuvem"**) oferece a mesma escolha entre um vault existente e um novo vault na nuvem. Cada conexão recebe seu próprio vault separado no dispositivo. A página do vault mostra o status, o progresso, as transferências pendentes e oferece **Exportar o vault** (ZIP pela folha de compartilhamento).

A frequência com que este cofre verifica mudanças remotas é definida na mesma página (**intervalo de sincronização**, no mínimo 5 segundos) — os salvamentos locais sobem imediatamente de qualquer forma. No Google Drive, OneDrive, Dropbox e S3 a **pasta na nuvem** também pode ser trocada depois; no WebDAV a pasta faz parte do endereço do servidor, então você reconecta. Se a sincronização de configurações estiver criptografada, você pode ativar **Pedir a senha a cada início**: a chave então não fica guardada no aparelho. E **Segurança e compartilhamento** agora diz abertamente que espaços de trabalho criptografados são experimentais e ainda não passaram por auditoria independente — guarde o arquivo e o código de recuperação em local seguro.

A página do vault também informa se suas **configurações** viajam com você — como um cartão com um estado claro, em vez de um botão qualquer:

- **As configurações não estão sendo sincronizadas**: a sincronização de configurações está desativada para este vault. Ative-a pelo desktop.
- **Ainda não criptografado**: este vault ainda não tem frase secreta de sincronização. Você já pode defini-la **no telefone**: o assistente mostra o código de recuperação e pede que você digite de volta dois grupos escolhidos aleatoriamente antes que qualquer coisa seja gravada. Se já existir uma frase secreta na nuvem, o telefone avisa e nunca cria uma segunda — isso deixaria todos os outros dispositivos de fora.
- **Ainda não desbloqueado neste dispositivo**: suas configurações ficam armazenadas de forma criptografada na nuvem. Digite a frase secreta definida ao configurar isso — no desktop ou aqui, no telefone; este dispositivo as desbloqueia uma vez com ela.
- **As configurações estão sendo sincronizadas**: este dispositivo está desbloqueado; pastas, visualizações e regras de backup permanecem sincronizadas com seus outros dispositivos.

Cada cartão também informa o que *não* viaja: os logins sempre ficam no dispositivo (veja [Calendário e eventos](#calendário-e-eventos)).

**Configurações** → **Segurança e compartilhamento** informa o que a conexão realmente é — e, em um vault de nuvem comum, configura o espaço de trabalho criptografado direto no telefone (identidade → arquivo de recuperação e código → ativação). Sem conexão de nuvem não há nada para criptografar, e a área diz isso.

## Rede de segurança

Snapshots (histórico de versões), um diário de rascunhos (depois de uma falha, a nota oferece o último estado não salvo) e cópias em conflito com uma visão de comparação protegem seus dados. A retenção é configurada em **Configurações** → **Backup e versionamento**.

## Compartilhamento e atalhos

No Android e iOS, texto e URLs compartilhados viram uma nova nota na pasta de entrada; imagens e arquivos são importados como anexos (até 25 MB por arquivo). No Android, toque e segure o ícone para os atalhos adicionais **Nova nota** e **Hoje**. A página do vault permite ativar **Sincronizar configurações** e desbloquear ou bloquear com segurança um vault criptografado usando a senha.

## Pastas, fotos e calendário

O botão flutuante **Mais** continua disponível em pastas aninhadas e cada ação cria na pasta aberta. No cabeçalho, o **menu de três pontos** abre as configurações; novas pastas são criadas pelo botão **Mais**.

O botão de foto oferece **Tirar foto** ou **Escolher da galeria**, preserva a posição de inserção e mostra erros de permissão ou arquivo. As fotos vão para a pasta de anexos do cofre, a mesma que o seu computador usa.

**Calendário** abre diretamente o calendário do provedor conectado. As notas diárias permanecem em **Hoje**; a antiga tela mensal intermediária foi removida sem alterar dados existentes.
