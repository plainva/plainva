# Calendário & tarefas externas

Última revisão: 2026-08-14

O Plainva pode conectar suas contas de calendário e tarefas já existentes — **CalDAV** (Nextcloud, Fastmail, mailbox.org …), **Google** (Agenda + Tarefas) e **Microsoft** (calendário do Outlook + To Do) — e trabalhar com elas em ambas as direções. Suas notas continuam sendo o centro: eventos podem virar notas de reunião, e listas de tarefas externas se espelham no seu [banco de tarefas padrão](Tasks.md) como notas comuns.

## Conectando uma conta

Abra **Configurações → seu vault → Contas na nuvem → Conectar conta…**, escolha um provedor e, na etapa de serviços, marque **Calendário e tarefas**:

- **Nextcloud / CalDAV**: endereço do servidor, nome de usuário e uma **senha de app** (no Nextcloud: Configurações → Segurança → Dispositivos e sessões). Sem registro, sem chaves — para o Nextcloud, o Plainva deriva o endereço CalDAV a partir do endereço do servidor (para outros servidores CalDAV, use o bloco **WebDAV / CalDAV** ou **Avançado: definir os endpoints individualmente**).
- **Apple iCloud, Yahoo, AOL, Zoho, Fastmail, mailbox.org, Yandex, Mail.ru**: blocos dedicados com os endereços de calendário já preenchidos — basta o endereço de e-mail mais uma **senha de app**, sem campo de servidor (na Apple a senha de app é obrigatória; o assistente traz o link do guia do provedor). Observação: o próprio Yahoo sinaliza que seu serviço CalDAV não é confiável — se ele se comportar de forma estranha, a culpa não é do Plainva.
- **Google**: precisa do seu próprio ID de cliente OAuth (o mesmo modelo BYO da sincronização com o Google Drive — veja o [guia do Drive](Google_Drive_BYO_Guide.md)). No seu projeto do Google Cloud, ative também a *Google Calendar API* e a *Google Tasks API* e acrescente seus escopos à tela de consentimento. O navegador se abre para a autorização; ao conectar, a conta é validada antes de qualquer coisa ser salva.
- **Microsoft**: basta clicar em **Entrar com a Microsoft…** e confirmar no navegador — nenhuma configuração é necessária. Uma conta Microsoft também pode carregar **Arquivos** (OneDrive) e **E-mail** na mesma passagem.

O assistente mostra um status por serviço ("conectado — n calendários encontrados"). Você gerencia os **calendários** (os marcados aparecem na aba do calendário) e as **listas de tarefas** (desmarcadas por padrão, propositalmente — marcar uma inicia a sincronização de tarefas descrita abaixo) na área **Calendário**; a **Pasta de reuniões** (onde as notas de reunião são criadas) e o **Calendário padrão** também ficam lá. Senhas e tokens ficam no chaveiro do seu sistema operacional.

**Cada dispositivo faz login por conta própria.** Se você usa a [sincronização de configurações](Sync_Setup.md#criptografia-de-sincronização-senha), os *detalhes* da conta viajam com você, mas o login nunca — ele fica propositalmente no dispositivo. Uma conta que chegou dessa forma aparece na lista no outro dispositivo, mas ainda não está conectada ali; no [app mobile](Mobile_App.md), ela então carrega o marcador **entrar** e o calendário explica isso em vez de ficar vazio. Basta conectar uma vez.

**Quando um login expira.** A área do calendário mostra então o erro diretamente na conta afetada e diz o que fazer: se o login expirou ou foi revogado, ela oferece **Entrar novamente** — um único acesso que restabelece **todos** os serviços dessa conta, no caso da Microsoft e do Google (arquivos, calendário, e-mail). Se o problema estiver na configuração do provedor (Client ID errado ou excluído, uma API ausente no projeto), o aviso aponta para lá em vez de oferecer um novo login; em caso de erro de rede, basta tentar novamente mais tarde. Com um projeto do Google no **modo de teste**, a causa mais comum é o limite de 7 dias — detalhes no [guia do Drive](Google_Drive_BYO_Guide.md). Enquanto uma conta não puder ser alcançada, o Plainva não afirma mais que ela não oferece listas de tarefas: a lista fica vazia, com o erro acima dela. O mesmo vale no aplicativo móvel: a linha da conta diz o motivo e **Entrar novamente** conserta a conta no lugar.

## A aba do calendário

**As entradas de status do Google** — local de trabalho, tempo de foco e ausência — aparecem como uma linha própria ou como uma faixa discreta atrás do dia, não como mais um bloco de compromisso: "Trabalhando de casa" não é uma reunião, e um dia com três dessas e uma reunião não pode parecer quatro reuniões. O Plainva as **lê** e nunca as escreve: criar uma ausência no Google recusa convites automaticamente, e esse não é um efeito colateral que uma visualização de calendário deva provocar.

Abra-a pela barra de ações à esquerda (ícone de calendário) ou pela paleta de comandos (**Abrir calendário**). Cinco visualizações estão disponíveis pelo alternador no cabeçalho: **Dia**, **3 dias** e **Semana** mostram uma **grade de horários** com uma coluna de horas à esquerda; os eventos aparecem como blocos no horário de início, a altura corresponde à duração, eventos sobrepostos ficam lado a lado, e uma linha vermelha marca "agora". Eventos de dia inteiro e (com a sobreposição de tarefas ativada) tarefas com vencimento ficam na faixa acima da grade. **Mês** mostra a grade do mês (um ponto colorido por calendário) mais, à direita, uma grade de horários de um único dia para o dia selecionado. **Agenda** lista as próximas semanas agrupadas por dia. **Hoje** retorna; as setas avançam pelo período atual (um dia, três dias, uma semana ou um mês). O primeiro dia da semana segue a configuração **Início da semana** (Configurações → App → Aparência: Segunda-feira, Sábado ou Domingo) — ela também se aplica ao calendário da barra lateral. A visualização se atualiza automaticamente a cada poucos minutos; o botão **Atualizar agora** força isso. Para calendários da Microsoft e para a maioria dos servidores CalDAV, o Plainva agora busca apenas as **alterações** em vez de todo o intervalo a cada vez — visivelmente menos dados, principalmente no celular. Ainda assim, uma atualização completa continua rodando pelo menos uma vez por hora, para que nada fique parado que uma lista de alterações tenha deixado passar; e nada é excluído a não ser o que o provedor relata explicitamente como excluído. Com o Google, toda atualização é completa: a API dele não permite listas de alterações junto com um intervalo de datas. Eventos que já terminaram aparecem **esmaecidos** (como no Google Agenda), para que o restante da agenda de hoje se destaque. Um **evento de vários dias** é uma **barra** contínua sobre os dias que ele cobre — um único rótulo, um único alvo de clique, em vez de uma entrada por dia. Se ele passar do fim da semana, é cortado reto na borda e continua na linha seguinte sem repetir o título. A faixa de dia inteiro das visualizações Dia, 3 dias e Semana funciona da mesma forma.

- **Criar um evento**: **clicar em um horário vazio na grade de horários** abre uma pequena janela de criação rápida (título, horário, calendário, local) — **Salvar** cria na hora, **Mais opções** abre o diálogo completo do evento. **Arrastar** pela grade define a duração. O **+** no cabeçalho abre o diálogo completo: título, calendário, data/hora ou um período de dia inteiro, local, uma **descrição**, uma **cor**, **participantes** e uma **repetição** opcional no estilo Outlook. A cor sobrescreve a cor do calendário apenas para esse evento (sem efeito em contas Microsoft — o Outlook não tem cores por evento).
- **Participantes**: digite um endereço de e-mail e pressione **Enter** (ou vírgula) para adicioná-lo como um **chip**; o × remove um. A repetição fica logo ao lado da data/hora — escolha uma frequência, um intervalo, os dias da semana (semanal) e como ela termina (nunca / em uma data / após N ocorrências); você também pode adicionar ou alterar a recorrência de um evento já existente.
- **Ver**: **clicar em um evento** abre a **prévia do evento** — uma janela flutuante que mostra o evento em vez de editá-lo: o horário, o local, a descrição, os participantes com suas respostas, além de **Aceitar / Provisório / Recusar**, **Nota de reunião** e, no **⋮**, todas as demais ações (cor, bloquear em outras agendas, enviar por e-mail, excluir). A janela não escurece o app, pode ser movida e redimensionada; **Esc** a fecha. Se o evento pertence a uma **série**, a prévia diz isso — com a frequência e, quando carregada, a próxima ocorrência. Não se pergunta nada: "só este ou todos?" é uma pergunta sobre editar, não sobre ver.
- **Editar / excluir**: **Editar evento** na prévia abre o diálogo pré-preenchido com seus valores e com as ações **Nota de reunião** e **Excluir**. As alterações são gravadas no provedor com uma verificação de segurança: se o evento mudou remotamente nesse meio-tempo, o Plainva atualiza a visualização em vez de sobrescrever.
- **Eventos recorrentes**: um evento de uma série se abre para edição como qualquer outro — a pergunta só aparece ao **salvar**, e apenas se você realmente mudou algo. O diálogo nomeia a alteração ("Horário: 09:00 → 09:15") e então pergunta se ela deve valer **somente para este evento** ou **para todos os eventos da série**. Com "todos", só o que você mudou vai para a série; a data de início dela e tudo que você não tocou permanecem como estavam. Se você fechar o formulário sem alterar nada, não acontece absolutamente nada — nenhum diálogo, nenhuma gravação ao provedor. **Excluir** continua perguntando antes: ali, o clique já é a mudança.
- **Mover / redimensionar**: você pode **arrastar** um evento diretamente na grade de horários — arrastar o corpo reagenda o evento (também para outro dia, nas visualizações de semana/3 dias), arrastar a **borda inferior** altera a duração. O novo horário é gravado no provedor na hora (eventos recorrentes continuam editáveis apenas pelo diálogo, por enquanto).
- **Como um evento aparece**: um evento **cancelado** continua visível, mas aparece apenas como **contorno** com o **título riscado** — você vê que o horário ficou livre em vez de perdê-lo em silêncio. Um **convite que você ainda não respondeu** também é um contorno (ainda não é o seu compromisso); um evento **provisório** — marcado assim por quem organiza ou respondido com “talvez” por você — fica **hachurado**. Tudo o que está confirmado continua preenchido. A agenda acrescenta a palavra (**Cancelado**, **Sem resposta**, **Provisório**). Se você **recusou**, o evento passa a ser um **contorno esmaecido** com o título riscado (**Você recusou** na agenda): ele acontece para os outros, mas já não faz parte do seu dia. Um cancelamento de quem organiza continua mais nítido — esse afeta todos.
- **RSVP e respostas**: quando você foi convidado para um evento, o diálogo permite **Aceitar**, marcar como **Provisório** ou **Recusar** — o Plainva envia sua resposta ao provedor (Google/Microsoft/CalDAV). A **lista de participantes** mostra quem aceitou ou recusou (o canal de retorno).
- **Convites por e-mail**: quando um evento tem participantes, marque **Notificar participantes por e-mail**. No Google, o Plainva então pede ao Google que envie seu convite nativo (o mesmo evento, então as respostas do destinatário sincronizam de volta com o seu evento); a Microsoft notifica os participantes automaticamente. Para CalDAV — ou para enviar uma cópia da sua própria caixa de e-mail — a ação **Enviar por e-mail** do calendário abre o compositor de e-mail com um convite iCalendar compatível com o padrão anexado, para que o Gmail e outros clientes o mostrem como um evento com Sim/Talvez/Não.
- **Bloquear em outras agendas**: a ação **Copiar** em um evento (ou o botão **Bloquear em outras agendas** no diálogo dele) o espelha em uma ou mais das suas outras agendas graváveis — como um espaço reservado opaco de **Ocupado** ou **Com detalhes** (no estilo do Notion Calendar). Um evento recorrente é espelhado com sua recorrência, então o bloqueio também se repete.
- **Eventos recorrentes** trazem um selo de repetição. Editar ou excluir uma instância pergunta **"Somente este evento"** (cria uma exceção ou pula apenas essa ocorrência) ou **"Todos os eventos"** (altera a série inteira). O Plainva nunca reescreve uma regra de recorrência existente.
- **Mostrar tarefas** (ao lado do botão **Atualizar agora**, quando um banco de tarefas padrão estiver configurado): sobrepõe os itens com vencimento do seu [banco de tarefas padrão](Tasks.md) à faixa da grade de horários e à grade do mês. Desativado por padrão, a escolha é lembrada por dispositivo. Quando a coluna de vencimento carrega um **horário** (tipo de coluna “data e hora”), a tarefa fica no seu lugar **na grade do dia** em vez da faixa de dia inteiro — tracejada em vez de preenchida, porque um prazo não é um intervalo, com a caixa de seleção dentro do próprio bloco. Sem horário, nada muda.
  - Clicar na **caixa de seleção** marca a tarefa como concluída direto ali — você não precisa abrir a nota. Clicar no **título** continua abrindo-a. Marcar como concluída grava o mesmo arquivo que a visualização de Tarefas usa: se a tarefa tiver uma **Repetição**, a próxima é criada.
  - **As tarefas ganham uma cor diferente dos eventos.** Um evento passado já terminou e aparece esmaecido; uma tarefa **atrasada**, ao contrário, é mais urgente e fica **destacada**. Tarefas que vencem hoje aparecem normais, as futuras esmaecidas, as concluídas riscadas.
  - Um **ícone de repetição** na linha mostra que essa tarefa tem uma repetição. Mesmo assim, ela aparece apenas **uma vez** no calendário — veja [Tarefas](Tasks.md) para saber por quê.

## Evento → nota de reunião

O ícone de nota em qualquer evento cria (ou reabre) sua **nota de reunião** — uma nota comum na sua pasta de reuniões, com o nome `AAAA-MM-DD Título.md`, pré-preenchida com data, local e participantes, além de uma pequena marcação `plainva.pim` no frontmatter que a vincula ao evento. Clicar de novo no mesmo evento sempre abre a mesma nota; uma nota sua que por acaso tenha o mesmo nome nunca é tocada.

## Listas de tarefas externas no seu banco de tarefas

Listas de lembretes (Lembretes da Apple via CalDAV do iCloud, listas de tarefas do Nextcloud) são coleções próprias no servidor e por isso aparecem em **Listas de tarefas** — nunca em **Calendários**. Se uma conta conectada não mostrar listas de tarefas, a seção informa isso e oferece **Procurar novamente**; se a busca falhou, o motivo é exibido e sua seleção anterior é mantida.

Marque uma **lista de tarefas** em uma conta conectada, e suas tarefas aparecem como notas no seu [banco de tarefas padrão](Tasks.md): o título vira a nota (H1), a data de vencimento vai para a coluna de data do banco de dados, e a conclusão se mapeia na **propriedade de caixa de seleção de concluído** do banco de dados (a coluna de status a acompanha; um banco de dados sem uma coluna de caixa de seleção usa a convenção de status — primeira opção = aberta, última = concluída). A sincronização é bidirecional e campo a campo:

- Edite a nota (título, vencimento, status) → a alteração é enviada ao provedor.
- Altere a tarefa remotamente → a nota acompanha.
- Se ambos os lados mudaram, sua alteração local vence para aquele campo; o restante segue o lado remoto.

Duas regras de segurança protegem seus dados: **excluir a nota nunca exclui a tarefa remota** (ela só para de sincronizar e não é reimportada), e **uma tarefa excluída remotamente nunca exclui sua nota** (ela simplesmente vira uma nota comum). Renomear ou mover uma nota de tarefa não tem problema — a marcação no frontmatter mantém o vínculo.

Limites atuais: tarefas criadas como notas comuns não são enviadas ao provedor (crie-as remotamente ou pelo banco de tarefas), e tudo nesta página é, por enquanto, desktop-first.

Cópias criadas por **Bloquear em outros calendários** carregam um vínculo Plainva específico do provedor no Google, Microsoft e CalDAV. As visualizações mostram essa relação com um ícone de link; após atualizar, origem e bloqueio são associados novamente em vez de virarem duplicatas independentes.

## Lembretes no computador

Em **Configurações → Calendário → Lembretes** você ativa **Lembrar compromissos**; na primeira vez o sistema pede a permissão uma única vez. Vale o lembrete que o próprio compromisso traz — só quando ele nada diz é que a **Antecedência** se aplica, e os compromissos de dia inteiro se manifestam no horário escolhido em **Compromissos de dia inteiro**. **Tarefas vencidas** inclui também as tarefas do seu banco de dados de tarefas, e **Somente estes calendários** limita de onde vêm os lembretes (nada marcado significa: todos, e um calendário conectado depois entra por conta própria).

**A diferença para o telefone está na configuração, não nas letras miúdas.** No telefone o sistema operacional assume o lembrete e o desperta mesmo com o aplicativo fechado. No computador esse repasse não existe: **o Plainva desperta sozinho e, por isso, precisa estar em execução.** Com o aplicativo fechado o lembrete se perde e não é recuperado. Em compensação, aqui não há limite algum.

A notificação em si não traz botão — o computador não oferece isso. A ação fica no aviso dentro do aplicativo: **Mostrar no calendário** para um compromisso, **Abrir tarefa** para uma tarefa. A janela nunca se impõe ao primeiro plano.

### Continuar em segundo plano

Como um lembrete no computador só chega enquanto o Plainva estiver em execução, em **Configurações → Início e comportamento → Segundo plano** há dois interruptores — separados, porque são dois desejos diferentes, e ambos **desligados por padrão**:

- **Iniciar com o sistema** registra o Plainva no login.
- **Continuar na área de notificação ao fechar** coloca um ícone do Plainva na área de notificação; fechar a janela deixa de encerrar o aplicativo e passa a guardá-lo ali. Pelo ícone você volta com **Abrir**, vê o **próximo compromisso** e encerra o Plainva com **Sair**.

**O segundo interruptor prova a si mesmo.** Nem todo ambiente mostra uma área de notificação — e não dá para prever com segurança se um ícone realmente aparecerá. Por isso o Plainva o cria e **pergunta se você o vê**. Só um sim mantém a configuração; se você disser não, o ícone é removido e o interruptor permanece desligado. Assim a janela nunca pode sumir sem caminho de volta. A mesma proteção vale na próxima inicialização: se o ícone não puder mais ser criado, a configuração se desliga.

A linha **Os lembretes aparecem** logo abaixo informa a qualquer momento o que vale: *enquanto o Plainva estiver em execução* ou *mesmo com a janela fechada*.

**Vale saber:** enquanto o Plainva continua em segundo plano, também continuam a **sincronização, a atualização do calendário e a verificação de backup**. O vault estará atualizado na próxima vez que você o abrir — o aplicativo trabalha enquanto você não está olhando.


## Exibir bancos de dados no calendário

O calendário pode exibir **entradas dos seus bancos de dados** ao lado dos compromissos. A barra **Exibir:** acima da visualização lista cada visualização `.base` do tipo **calendário** ou **linha do tempo** que indique uma coluna de data. Um clique exibe, outro oculta.

Uma entrada exibida assim **continua reconhecível como nota**: borda tracejada, um losango à frente, nunca a forma preenchida de um compromisso. Clicar abre a mesma pré-visualização que uma linha de banco de dados já tem. **Arrastá-la para outro dia grava a coluna de data** da nota — exatamente o que fazer a edição dessa célula na tabela faz. Se a coluna tiver hora, a entrada fica nessa hora na grade do dia; sem hora, fica na faixa de dia inteiro.

**Quais visualizações são exibidas pertence ao vault** e viaja pela sincronização de configurações: seu calendário fica igual no computador e no celular.

**E o contrário:** na visualização de calendário de um banco de dados, o botão **Compromissos ao fundo** mostra os compromissos reais do dia como uma linha discreta — você vê contra o que está planejando. São de propósito apenas fundo: não são linhas desse banco de dados e não são clicáveis.

## Colocar um item de banco de dados no calendário

Um item com data pode virar um **compromisso real** no seu provedor. O menu da linha (ou a folha de ações no telefone) oferece **Adicionar ao calendário**. O compromisso assume a data do item — com hora, se a coluna tiver uma, senão como compromisso de dia inteiro — e leva um link de volta para a nota.

A partir daí os dois ficam vinculados, por três regras fixas:

* **Se você mover o compromisso** no Google, no Outlook ou no servidor CalDAV, **a coluna de data da nota acompanha.**
* **Se você excluir a nota,** a caixa de diálogo de exclusão informa que ela está vinculada a um compromisso. O compromisso permanece no seu provedor — o Plainva nunca o exclui de passagem.
* **Se você excluir o compromisso,** apenas o vínculo desaparece. A nota e sua data ficam intactas.

Isso é diferente de **reservar tempo** numa tarefa: lá você reserva tempo para algo e a data da tarefa continua onde está. Aqui você diz: *este item É este compromisso.*
