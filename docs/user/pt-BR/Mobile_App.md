# O app mobile

Última atualização: 2026-09-04

O Plainva também está disponível como aplicativo para Android e iOS. Ele funciona com os mesmos arquivos Markdown, o mesmo formato **OKF** e o mesmo mecanismo de sincronização do app de desktop — seu vault permanece idêntico nos dois mundos.

## Instalar o app

O app mobile está em **teste aberto** no Google Play. No **Android** você entra direto: abra o link do teste por [plainva.com/android-beta](https://plainva.com/android-beta), toque em **Tornar-se testador** e instale o app pelo Google Play — sem convite e sem entrar em nenhum grupo. O Plainva também está publicado na Play Store. No **iPhone**, a distribuição é pelo TestFlight; a lista de espera fica em [plainva.com](https://plainva.com).

**Requisitos de sistema:** no iPhone e no iPad, o Plainva precisa do **iOS 16.4** ou mais recente — ali o motor que desenha a interface faz parte do sistema, e um Safari mais novo não muda isso. No Android, o Android 7 basta, mas o **Android System WebView** precisa estar atualizado; se estiver velho demais, o Plainva avisa na inicialização e indica o caminho pela Play Store.

É uma versão inicial: mantenha um backup do seu vault e me conte o que não funciona.

## Layout

- **Barra inferior:** **de duas a quatro** superfícies de trabalho à sua escolha, mais o item fixo **Seções** no final — ao todo, de três a cinco destinos para uma barra. **Notas** permanece sempre visível: é assim que você chega aos seus arquivos.
- **Cada seção** (Notas, Hoje, Tarefas, Calendário, E-mail, Grafo, Comentários abertos) fica sempre a um toque de distância pela **folha de seções**: **Seções** na barra ou um **toque longo na barra**. A folha marca a seção atual e leva direto, na parte de baixo, a **Personalizar a barra de navegação…**. Tags, favoritos e os itens recentes deixaram de ser seções próprias — agora ficam em **Notas**.
- **Configurando a barra:** **Configurações** → **Barra de navegação**. Use **−**/**+** para definir quantas superfícies de trabalho a barra mostra (2–4, com prévia ao vivo) e a **alça de arrastar** para organizar a lista: as entradas do topo formam a barra (marcadas com uma moldura), arrastar uma para cima a promove. Arrastar até a borda superior ou inferior rola a lista junto, de modo que um único movimento cobre a lista inteira. Nada fica escondido — o que não está na barra continua acessível por **Seções**. Se a seção em que você está sair da barra, o app vai para a primeira visível. Você também pode organizar a mesma barra **no desktop** (Configurações → Vault → Barras e áreas); com a sincronização de configurações ativada, a organização viaja entre seus dispositivos.
- **Uma linha de pasta conta tudo o que está abaixo dela**, não apenas as notas que ficam diretamente nela — uma pasta cheia de subpastas não diz mais “0 notas” ao lado de uma seta que leva a centenas.
- **＋** flutua como um botão redondo acima da barra e abre a criação rápida em dois grupos: nota, "A partir de modelo…", nota diária, pasta, banco de dados — e abaixo evento e tarefa, criados no calendário e na lista de tarefas. O menu **Novo** do desktop oferece as mesmas entradas na mesma ordem.
- **Manter uma linha pressionada mostra o que essa linha faz** — nota, pasta, banco de dados e tarefa respondem da mesma forma, e **Selecionar vários** é a primeira entrada dessa folha. Deslizar para a esquerda executa diretamente as duas ações mais frequentes; a folha e o gesto oferecem as mesmas coisas na mesma ordem.
- **Cabeçalho:** o mesmo em toda parte — à esquerda Voltar (ausente numa superfície de trabalho), no centro o título e uma linha de contexto, à direita a busca e ⋮. Ao rolar, ele se descola do conteúdo e a barra de navegação se recolhe aos ícones; ao rolar para cima, ela se abre de novo.
- **Um ⋮ sempre significa a mesma coisa:** ações sobre o objeto que está aberto. As configurações do app não ficam atrás dele.
- **Configurações:** bem no fim de **Notas**, assim como no desktop. Abrem primeiro a lista de seções (como o lado esquerdo das configurações do desktop) — um toque abre a respectiva página. No topo, **Vault ativo** leva ao gerenciamento de vaults: trocar de vault (marca de seleção = ativo), **Criar um vault** e **Conectar um cofre na nuvem**. A lista mostra **as mesmas áreas do computador** — incluindo **Inicialização e comportamento** (mostrar novamente as boas-vindas e as novidades), **Barras e áreas** (a barra de navegação) e **Manutenção** (Estatísticas do vault, reconstruir o índice, restaurar arquivos excluídos). Só falta **Atualizações**: o app não se atualiza sozinho, quem faz isso são a Google Play e o TestFlight. **Manutenção** traz também a **importação de outros apps** — no telefone ela sempre escreve numa subpasta do vault aberto, mostra antes o que criaria, pode ser interrompida durante a execução e deixa um relatório.

## Ler e editar notas

As notas abrem **renderizadas e somente leitura**; o lápis no canto superior direito muda para o modo de edição (com uma barra de ferramentas acima do teclado: formatação, listas, link wiki, comandos de barra, inserir foto). Incorporações `![[Nota]]` aparecem como cartões de pré-visualização tocáveis.

Pastas podem ser **pesquisadas** e **ordenadas** pela barra acima da lista — por **Título**, **Última alteração** ou **Criação**; escolher de novo inverte a direção, e a ordenação é lembrada no dispositivo. Em uma inicialização a frio a última nota aberta reabre, e cada nota abre onde você a deixou. Listas com subitens dobram e desdobram com um toque no marcador.

O botão **Detalhes da nota** no cabeçalho (entre o marcador e o menu ⋮) abre o painel de contexto da nota: propriedades (diretamente editáveis), backlinks, estrutura, grafo e o **histórico de versões** — cada edição cria automaticamente snapshots que você pode inspecionar, comparar e restaurar. O código-fonte Markdown e a busca na nota ficam no menu ⋮.

Em uma tela larga (um tablet a partir de 1024 px) esse painel pode ficar aberto como uma **terceira coluna** ao lado da nota, em vez de abrir e fechar toda vez. O interruptor se chama **Fixar o painel de contexto** e fica em **Configurações → Aparência → Layout**; vale para este dispositivo. Com ele desativado — ou em uma janela mais estreita — o mesmo botão abre o painel como antes.

## Modelos

Os modelos funcionam exatamente como no desktop: os placeholders (`{{title}}`, `{{date}}`, `{{daily+1}}`, `{{weekday:monday}}` …) são preenchidos quando a nota é criada, **todas** as perguntas de um modelo chegam juntas em **uma** folha — cancele e nada é criado — e `{{cursor}}` posiciona o cursor assim que a nota é aberta.

As regras **pasta → modelo** e **tipo de nota → modelo** são definidas no desktop; elas viajam com a sincronização de configurações e também valem aqui — então uma nota em `Projekte/` começa da mesma forma nos dois dispositivos, inclusive na captura pelo `＋` e em **+ Entrada** num banco de dados. Dois detalhes: `{{weekday:…}}` sempre conta a partir de segunda-feira no celular (o início da semana vem de **Aparência**), e `{{clipboard}}` pergunta o conteúdo da área de transferência na mesma folha, em vez de lê-lo sem perguntar. A lista completa de placeholders está em [Notas & Markdown](Notes_and_Markdown.md).

## Bancos de dados (`.base`)

Os bancos de dados `.base` funcionam como no desktop: todas as visualizações (tabela, lista, galeria, quadro, calendário, linha do tempo), edição tipada de células, os cartões do quadro se movem tocando e segurando. **Configurar** gerencia visualizações, colunas, filtros (incluindo grupos), ordenação e propriedades.

A **visualização de calendário** tem três períodos: **mês**, **semana**, **dia**. O mês continua sendo a entrada — é o único que ainda mostra uma forma na tela de um celular; semana e dia são listas, porque sete colunas de conteúdo deixam de ser legíveis nessa largura. Uma entrada que atravessa vários dias aparece como **barra** em vez de se repetir a cada dia, e os horários vêm antes do título. A **linha do tempo** mostra uma **linha por entrada** com uma barra do começo ao fim: as duas pontas podem ser **arrastadas com o dedo**, o que escreve o campo de data da nota. Em **Configurar** você escolhe o campo de data e o de data final e **cor por** — mesma configuração, mesmo arquivo que no desktop. Os esquemas de relação (destinos, cardinalidade) continuam sendo mantidos no desktop.

**Vários itens de uma vez**: mantenha uma linha pressionada e escolha **Selecionar vários** — a primeira opção dessa folha. Depois disso, um toque seleciona em vez de abrir, e uma barra na parte de baixo mostra quantos itens estão selecionados. A partir daí você pode **excluir** a seleção (uma única pergunta, não doze — com a mesma visão geral das conexões que uma exclusão isolada oferece) ou usar **Definir valor…** para definir uma propriedade em todos de uma vez: escolha primeiro a propriedade, depois o valor. Onde uma propriedade mostra **atualmente misto**, os itens selecionados têm valores diferentes. Um valor vazio remove a propriedade. Enquanto roda, você vê o progresso e pode cancelar; o que já foi gravado permanece. Tags, listas, seleção múltipla e relações ficam de fora de propósito — ali, "definir tudo como X" significaria que todo valor existente desaparece.

Uma visualização **Mural** mostra as notas como um quadro de duas colunas com cartões adesivos: tocar abre a nota, tocar e segurar mostra as ações (fixar, marcadores, cor, excluir), arrastar após tocar e segurar reordena, e as caixas de seleção são marcadas direto no cartão. O campo de entrada no topo captura uma nova nota. Dica: aponte o banco de dados para a sua pasta de entrada (**Configurações** → **Conteúdo e estrutura**) e as notas rápidas do ＋, assim como os textos compartilhados de outros apps, caem direto no mural.

## Tarefas

A área **Tarefas** reúne todas as caixas de seleção do seu vault — todas as linhas `- [ ]` e `- [x]` de todas as notas, agrupadas por nota. É a visão geral baseada em linhas que um banco de dados não consegue dar, porque um banco de dados trabalha sobre notas inteiras.

Tocar em uma tarefa abre a nota **naquela linha**; a caixa marca a conclusão e grava de volta exatamente o caractere `[ ]`/`[x]`. Datas de vencimento (`📅`) e `#tags` aparecem como chips, para não se repetirem dentro do texto.

Se o seu vault tem um **banco de tarefas** (**Configurações** → **Conteúdo e estrutura**), a área o mostra como sua própria seção acima: marcar como concluída, alterar status, **+ Nova tarefa** e **Abrir como banco de dados**. Se o banco de dados designar uma lista de tarefas de um provedor (**Configurar** → **Fonte de dados** → **Criar também novas tarefas em** — configurável aqui, assim como no desktop), a folha de criação também traz um interruptor **Criar também em “…”**: ativado, porque escolher a lista já é a decisão, e desativado para a única tarefa que deve permanecer no vault. Uma caixa de seleção movida e uma mensagem capturada como tarefa seguem o mesmo caminho. Cada linha de caixa de seleção também traz **Para o banco** na linha meta — a linha permanece como um link wiki, e a tarefa passa a viver como uma nota própria.

As **Listas de tarefas** que você selecionou para suas contas são espelhadas nesse banco de dados pelo próprio celular — ele importa novas tarefas, reconhece uma nota existente pela sua âncora (em vez de criar uma segunda) e envia suas edições ao provedor. Exclua uma nota de tarefa deliberadamente e a tarefa também é excluída no provedor — com oito segundos de **Desfazer**; envie o app para segundo plano dentro desse prazo e a tarefa permanece. Um arquivo simplesmente ausente, por outro lado, nunca exclui nada. As regras em detalhe estão em [Calendário & tarefas](Calendar_and_Tasks.md). Quando isso acontece está descrito em [Calendário e eventos](#calendário-e-eventos): um telefone não mantém nenhuma sincronização em segundo plano, então o Plainva a recupera quando você volta ao aplicativo e quando abre esta área.

Acima da lista você tem os mesmos filtros do desktop: **Pasta**, **Etiqueta**, **Com vencimento** e **Mostrar ocultas**. Ocultar é uma propriedade da **nota**, não da tarefa individual — o ícone de olho no cabeçalho de uma nota grava `plainva.tasks: false` no frontmatter dessa nota e a tira da visão geral; **Ocultar modelos** faz o mesmo de uma vez para toda a pasta de modelos. O arquivo mantém suas tarefas, elas só param de contar. Pressionar e segurar **Para o banco** escolhe o **banco de dados de destino** quando seu vault tem mais de um.

Uma linha de tarefa mostra o título em toda a largura; status, vencimento, repetição e tags ficam abaixo dele, e exatamente uma ação fica à direita. **Bloquear tempo** (o ícone de calendário à direita) cria um evento de calendário para a tarefa quando há um calendário conectado (data, início, duração, além do seletor de calendário quando há mais de um gravável); **Repetição** na linha meta cria a próxima tarefa com um novo vencimento quando você marca esta como concluída. Ambas estão descritas em [Tarefas](Tasks.md).

## Hoje

**Hoje** é a superfície do dia. A faixa no topo seleciona um dia — ela vai **nas duas direções**, duas semanas para trás e duas semanas para a frente, e um ponto marca cada dia que já tem uma nota diária. Abaixo dela fica a **nota diária** do dia selecionado (com seu modelo e sua pasta, para abrir ou criar), depois os **compromissos e vencimentos** daquele dia, e por fim o que você editou naquele dia.

A seção do meio reúne o que normalmente fica em duas áreas separadas: primeiro os eventos de dia inteiro, depois os com horário, em ordem cronológica, e por último as tarefas que vencem naquele dia. Tocar em uma tarefa abre a nota dela. Sem um calendário conectado e sem um banco de tarefas, a seção simplesmente não aparece.

## Tags

A lista de tags fica em **Notas**. Tocar abre as notas de uma tag; a seta expande as tags aninhadas. **Pressionar e segurar** uma tag oferece **Renomear tag** — em todo o vault, como no desktop: o Plainva reescreve toda nota que a carrega (no frontmatter e como `#tag` no texto, incluindo suas `tag/child` filhas) e depois te diz em quantas notas ela foi substituída. Uma nota que não pode ser lida ou gravada é ignorada — as demais são renomeadas de qualquer forma.

## Localizar e substituir em todo o vault

O caminho é a lupa no cabeçalho e então `>` e **Localizar e substituir no vault**. A tela pesquisa em todas as notas de uma vez. Digite um termo, toque em **Localizar** e as ocorrências aparecem agrupadas por nota com a contagem; um toque abre as linhas de uma nota, e apenas uma fica aberta por vez. Desmarque as notas que quiser excluir — por nota, nunca por linha, porque uma nota é substituída por inteiro ou não é. **Substituir em N notas** reescreve o restante, com barra de progresso e um **Cancelar** que para na próxima nota. Cada nota é relida imediatamente antes de ser gravada, para que uma prévia desatualizada nunca sobrescreva conteúdo mais novo; uma nota que mudou nesse meio-tempo é ignorada e isso é informado. Diferenciar maiúsculas, palavra inteira e regex também valem aqui.

Cada ocorrência mostra duas linhas — **antes** com o trecho encontrado, **depois** com o resultado, referências `$1` resolvidas com expressão regular — para você conferir a mudança antes de gravar qualquer coisa.
## Visões gerais (index.md)

Em um cofre OKF, o `index.md` é o índice de uma pasta. O telefone oferece dois caminhos, pensados para dois momentos diferentes.

**Para o momento em que você percebe:** mantenha uma pasta pressionada — a folha oferece **Criar visão geral** quando não há nenhuma e **Atualizar visão geral** quando o Plainva mantém a existente. A linha nomeia o próprio efeito em vez de pedir que você escolha. Se você mesmo escreveu o `index.md` daquela pasta, a linha nem aparece: seu arquivo é seu.

**Para a arrumação:** **Configurações → Vault → Manutenção → Visões gerais** lista cada pasta com sua contagem de notas e seu estado — ordenado por *onde falta algo*, não alfabeticamente, para que as poucas pastas que pedem atenção não fiquem soterradas entre as que já estão prontas. No topo, **Gerar index.md nas N pastas que não têm** cria as que faltam de uma só vez. Se uma pasta sem `index.md` já contém uma nota de visão geral (MOC, visão geral, README…), você pode **adotá-la** aqui — isso renomeia o arquivo e leva os links junto por todo o cofre, e por isso pergunta antes.

**Sempre em dia.** As visões gerais geradas pelo Plainva carregam uma marca invisível. Só esses arquivos são mantidos — e de agora em diante o telefone também os mantém: crie, mova ou exclua notas ali e o Plainva reescreve pouco depois as visões gerais afetadas. Antes só o desktop fazia isso, então um cofre cuidado no telefone envelhecia em silêncio.

**Somente leitura, com uma saída.** Uma visão geral gerenciada abre como leitura, com uma faixa acima: **Atualizar** a reescreve, **Editar mesmo assim** remove a marca — depois disso o arquivo é inteiramente seu e não é mais sobrescrito automaticamente. Sem essa proteção, a próxima execução escreveria em silêncio por cima do que você digitou.


## Converter para o formato OKF

Levar um vault inteiro para o [formato OKF](OKF.md) agora também funciona pelo telefone: **Configurações → Vault → Manutenção → Converter para o formato OKF**. O assistente faz a varredura, deixa você escolher o `type` padrão, **nomeia as notas afetadas** e só então escreve — cada arquivo passa pela pasta de backup antes de ser alterado.

Como um telefone pode encerrar um app em execução a qualquer momento, aqui a execução também para no próximo arquivo quando você toca em **Pausar** ou o app vai para segundo plano. O fato de o Plainva perguntar, na próxima vez que você abrir o vault, se uma execução interrompida deve ser **continuada** ou **revertida** vale para os dois dispositivos; **Depois** é uma resposta válida, a pergunta volta e não se perde.

Uma execução interrompida deixa um vault parcialmente convertido, não quebrado: apenas campos de frontmatter são adicionados, cada nota continua sendo Markdown válido e qualquer outro editor ainda consegue lê-la.

### OKF 0.2 no celular

Os campos do [OKF 0.2](OKF.md) — origem, revisão, status, desatualização — são lidos e mostrados no celular exatamente como no desktop: o selo **Rascunho**/**Descontinuada** no cabeçalho da nota, o aviso **Marcada como desatualizada** acima da nota, e a seção **Confiança e origem** no painel de contexto da nota, com o nível de confiança. **Marcar como revisada** também fica ali: acrescenta `human:<seu nome>` à lista verified; o Plainva pergunta o nome uma vez por vault, mantém-no no dispositivo e permite alterá-lo em **Configurações → Vault → Conteúdo e estrutura → Nome do revisor**. A versão do bundle de um vault é atualizada para 0.2 em **Configurações → Vault → Manutenção → Versão do bundle** — com uma prévia, um backup e a caixa de seleção que remove o campo legado `okf_version` das notas.

## Grafo

O **mapa do vault** mostra seu vault como nós e arestas. Tocar em uma bolha de pasta a expande, tocar em uma nota a abre; os chips acima filtram por tipo de nota, tag e tipo de aresta. Arraste um nó e **o mapa lembra onde você o colocou** — o arranjo lembrado fica em `.plainva/graph.json` e permanece propositalmente neste dispositivo, como o índice de busca.

**Pressionar e segurar** um nó abre o menu dele: abrir (ou expandir/recolher no caso de uma pasta), **Focar na seleção** e, se o nó estiver fixado, **Desafixar**. Pressionar e segurar uma **aresta** nomeia as duas extremidades e abre uma das notas. Arraste uma nota **sobre outra** e o Plainva oferece **vinculá-las** — como um link de texto no fim da nota, ou por meio de uma relação do banco de dados correspondente; uma relação que permite exatamente uma entrada pergunta antes, porque ela substitui o valor atual. O chip **Selecionar** transforma um arraste sobre uma área vazia em um retângulo de seleção (o celular não tem tecla modificadora); notas selecionadas podem ser excluídas juntas, com a mesma confirmação de uma única. **Exportar como SVG…** entrega o mapa para a folha de compartilhamento do seu dispositivo.

A mesma limpeza em pequena escala é o que faz o **grafo no painel de contexto da nota**: ele mostra a vizinhança da nota aberta e, abaixo, sugestões do que mais poderia pertencer a ela. **Vincular** coloca o link no trecho do texto — não no final da nota — e uma sugestão descartada permanece descartada, mesmo depois que a nota é fechada.

O chip **Limpar** abre a lista de limpeza: **órfãs** (notas para as quais nada aponta), **links quebrados** (referências para lugar nenhum) e **menções** — lugares em que uma nota é citada mas não vinculada. Você exclui uma órfã com a mesma confirmação usada em qualquer outro lugar, cria a nota que falta para um link quebrado, e vincula uma menção exatamente **no trecho**, em vez de no final da nota. O que você descarta permanece descartado: não retorna na próxima execução. A varredura de menções lê todas as notas e por isso só começa quando você pede — e pode ser interrompida a qualquer momento.

O **Foco** também pode ser ativado pelo menu do nó: o mapa então mostra apenas a vizinhança dele até a profundidade que você escolher (1–3). O chip que exibe a profundidade limpa o foco de novo. Mais dois chips leem o mapa por idade: o **Mapa de calor** tinge cada nó conforme o quão recentemente ele mudou, e a **Viagem no tempo** oculta tudo o que for mais recente que o controle deslizante — assim você pode ver o vault crescer.

## Calendário e eventos

A área **Calendário** mostra seus calendários conectados nas visualizações **Dia**, **3 dias** e **Agenda** — o mesmo modelo de contas do desktop. Você chega até ela pela barra de navegação ou por **Seções**. Cada coluna de dia traz, no topo, seu **dia da semana e a data**, e abaixo dela uma faixa para os **eventos de dia inteiro** daquele dia; ambos rolam junto com a grade em vez de ocupar espaço permanentemente. Tocar em um evento abre a **prévia do evento** como folha — a mesma superfície da janela flutuante do desktop: intervalo de horário, local, descrição, participantes com suas respostas e, no caso de uma série, seu ritmo junto com o próximo compromisso. Para um convite, ela oferece **Aceitar**, **Provisório** e **Recusar**, e abaixo **Editar evento**, **Nota da reunião** e **Excluir evento**. Deslizar para baixo fecha a folha. As notas diárias não ficam aqui — elas ficam em **Hoje**.

Tocar em um lembrete de evento abre o próprio evento — a visão do dia na data dele, com o evento aberto. A visão que você usou por último (dia, 3 dias, agenda) é lembrada no dispositivo, como no desktop.

**Quando o telefone vai ver.** Em segundo plano, nenhum relógio corre em um telefone: a sincronização periódica fica parada enquanto o aplicativo não está à frente. Por isso o Plainva consulta por conta própria assim que você **volta ao aplicativo** e sempre que abre **Calendários**, **Tarefas** ou as **Contas de calendário** — no máximo uma vez por minuto, para que ir e voltar com frequência não dispare uma sequência de sincronizações. A volta também **replaneja os lembretes**, mesmo que nada de novo tenha chegado: o relógio andou de qualquer forma. Se você não quiser esperar, continuam ali **Atualizar agora** e puxar a lista para baixo.

Gerencie as contas pelo ícone de engrenagem no calendário de eventos: conecte o **CalDAV** no dispositivo com uma senha de aplicativo (p. ex. Fastmail, Nextcloud, iCloud); Google e Microsoft seguem via login pelo navegador. Por conta, você pode mostrar ou ocultar calendários individuais.

A partir de um evento, **Nota de reunião** cria a nota correspondente a ele — a mesma nota que o desktop também encontra: ela permanece vinculada ao evento, então chamá-la de novo a reabre em vez de criar uma segunda, e ela vai parar na **Pasta de reuniões**. Você escolhe essa pasta na área de contas, em **Configurações do calendário**, com um **navegador de pastas** em vez de digitar o caminho; ali também fica o **Calendário padrão** (aquele em que um novo evento começa); ambos pertencem ao vault e viajam com a sincronização de configurações. O mesmo lugar permite escolher, por conta, quais **Listas de tarefas** são espelhadas no seu banco de tarefas.

**O login é por dispositivo.** O que sincroniza são as *configurações* da sua conta, nunca o login em si — de propósito: credenciais não devem sair do dispositivo. Uma conta que chegou pela sincronização de configurações aparece então na lista, mas com o marcador **entrar**, com uma linha logo abaixo dizendo o que fazer. Enquanto nenhuma conta estiver conectada neste dispositivo, o calendário e o e-mail explicam isso no lugar em vez de simplesmente ficarem vazios, e **Entrar neste dispositivo** leva você até as contas. Contas conectadas mostram **ativa**. Se um login expirar depois ou for revogado, a linha diz **acesso expirado** junto com o motivo — e **Entrar novamente** o recoloca em funcionamento sem remover a conta: a mesma conta, os mesmos calendários. Para Google e Microsoft, o Plainva procura o registro de aplicativo necessário no próprio dispositivo — na conta, na sincronização de arquivos da mesma conta ou em outra conta do mesmo provedor. Isso vale tanto para **Entrar novamente** quanto para **adicionar** uma conta: se o Plainva encontrar um, o formulário mostra **ID do cliente obtido deste dispositivo** com **Editar** ao lado. Só quando realmente não há nenhum é que o formulário se abre e pergunta por ele.

**Um login para todos os serviços — também aqui.** Se uma conta Microsoft ou Google carrega vários serviços (arquivos e calendário, por exemplo), a área **Contas na nuvem** oferece unificá-los em um único login. Depois disso, um único login mantém todos os serviços ativos, e não apenas um — antes, um serviço podia continuar funcionando enquanto outro da mesma conta expirava silenciosamente. Uma caixa de correio do Gmail fica de fora: ela roda por IMAP com senha de app e não exige consentimento. A oferta permanece enquanto o login compartilhado não cobrir todos os serviços da conta. Se faltar um serviço, os detalhes da conta trazem duas saídas: **Redefinir o login compartilhado** deixa cada serviço voltar a usar o seu próprio, e **Sair do assistente** descarta uma tentativa de conexão que nunca terminou.

**Lembretes.** Em **Configurações do calendário → Lembretes** você ativa **Lembrar dos compromissos**; o telefone pede então uma vez a permissão de notificações. Vale o lembrete que o próprio compromisso traz — só quando ele não diz nada é que o Plainva avisa 15 minutos antes, e os compromissos de dia inteiro na véspera às 19:00. Um compromisso que expressamente não quer lembrete não recebe nenhum. Os próximos 14 dias são planejados, no máximo 64 lembretes com antecedência — é o que o iOS permite; o Plainva reabastece essa janela sempre que você abre o aplicativo e após cada atualização do calendário, e diz a partir de quando um período não cabe mais, em vez de engolir compromissos em silêncio. **O limite que permanece:** o telefone só pode anunciar o que viu na última sincronização — um convite que chega dez minutos antes do início não alcança mais nenhuma notificação.

**O que você ajusta junto.** A **Antecedência** vale para compromissos sem lembrete próprio; **Compromissos de dia inteiro** define em qual noite ou manhã eles se manifestam. **Tarefas vencidas** inclui também as tarefas do seu banco de dados de tarefas — com horário, como um compromisso; sem horário, pela linha **Tarefas sem horário** logo abaixo, que por padrão lembra **no dia de vencimento às 09:00**. **Somente estes calendários** limita de onde vêm os lembretes; se você não selecionar nada, aparece **Todos**, e um calendário acrescentado depois entra por conta própria; a folha permanece aberta até você terminar, então você marca vários calendários de uma vez. A notificação traz duas ações: num compromisso **Nota de reunião** (cria a nota ou abre a existente), numa tarefa **Concluir** — que a conclui ali mesmo e, numa tarefa recorrente, cria a próxima sem que você abra o aplicativo. Abaixo das configurações, uma linha também diz **o que foi realmente agendado** — por exemplo "Agendado: 12 compromissos · 3 tarefas" — ou por que nada foi, por exemplo porque neste aparelho não há nenhum banco de tarefas configurado. Quando ainda não há nada para escolher, a linha diz isso em vez de afirmar **Todos**: **Ainda sem calendários** quando há uma conta conectada mas nenhum calendário chegou ainda — um toque ali oferece **Atualizar agora** — e **Nenhuma conta conectada** enquanto nenhuma conta de calendário estiver configurada.

## E-mail

Em **Configurações → E-mail** você conecta uma **caixa de correio da Microsoft** (Outlook.com, Microsoft 365) diretamente pelo login no navegador — sem senha de app. Como no calendário, o login vale por dispositivo.

Depois você pode abrir **E-mail** como uma área própria pela **folha de seções** e colocá-la na barra de navegação. A linha abaixo do título mostra pasta, não lidas e conta, e abre o seletor de pastas. Toque em uma mensagem para lê-la; **Salvar como nota** a arquiva na pasta **Mail** do seu cofre (capturar duas vezes abre a mesma nota). Imagens remotas continuam bloqueadas até você liberá-las para aquela mensagem — uma imagem carregada informa ao remetente quando e onde você leu. As quatro ações — **Responder**, **Responder a todos**, **Encaminhar** e **Salvar como nota** — ficam em uma linha ancorada na borda inferior; enquanto uma mensagem está aberta, a barra de navegação recua e cede o espaço. Segure uma linha para abrir sua folha: **Selecionar vários** vem primeiro e, abaixo, as mesmas ações do menu de contexto do desktop — lida/não lida, marcar, mover, adiar, spam e excluir.

**Caixas IMAP também funcionam no telefone.** Adicione uma em **Configurações → E-mail**: escolha o provedor, informe o endereço e a senha de aplicativo, e o Plainva preenche os servidores. Se o seu provedor não estiver na lista, **Avançado** permite digitar você mesmo os servidores IMAP e SMTP, as portas e um nome de usuário diferente, e uma conta existente pode ser editada depois. Para selecionar várias mensagens, basta tocar e segurar uma delas; depois, um toque adiciona outras. Na visão de conversas, manter pressionada ou tocar a linha da conversa escolhe a troca inteira — e cada mensagem mantém a própria pasta, então uma resposta de **Enviados** é marcada lá.

Uma mensagem aberta oferece **Responder**, **Responder a todos** e **Encaminhar**. Uma resposta cita o original abaixo do seu texto; "Responder a todos" também inclui os demais destinatários e deixa de fora o seu próprio endereço. Ao **redigir**, **Anexar arquivo** adiciona um arquivo do cofre — no celular, o cofre é o armazenamento que você consegue acessar, e tudo o que chega ao dispositivo (um anexo salvo, uma foto inserida) já está lá. Cada anexo ganha sua própria linha com **Remover anexo**, enquanto a mensagem ainda não tiver sido enviada.

Uma mensagem que você começou não precisa ser enviada: **Salvar rascunho** a arquiva na pasta de rascunhos da sua conta — onde qualquer programa de e-mail nessa caixa vai encontrá-la, não em um lugar exclusivo do telefone. Qual é essa pasta, o servidor informa; só quando ele fica em silêncio o nome é adivinhado. Na lista, dois interruptores ficam ao lado da linha da pasta: **Não lidos** reduz o que está carregado no momento (assim o contador e **Carregar mais** continuam acessíveis), enquanto **Marcadas** pede ao servidor todas as mensagens marcadas da pasta — inclusive as que estão bem abaixo da página carregada. Em **Todas as caixas de entrada** o interruptor de marcadas fica ausente de propósito: essa consulta nomeia exatamente uma caixa de entrada.

A partir de uma mensagem aberta, três caminhos levam ao cofre: **Salvar como nota**, **→ Tarefa** no menu ⋮ (cria uma entrada no seu banco de tarefas padrão — com o modelo, o status e a data da mensagem) e **+ .eml**, que também guarda a mensagem original e cria um link para ela a partir da nota. Os três são ancorados: capturar a mesma mensagem duas vezes abre o que já existe. **Excluir** agora também fica no menu ⋮ em vez de ao lado da seta de voltar; na lista, basta um deslize. Mover para a lixeira oferece **Desfazer**, porque pode ser revertido — excluir definitivamente da lixeira continua perguntando, porque isso não pode. E, em vez de vários avisos empilhados uns sobre os outros, agora há **uma** única linha: o erro; senão, as contas inacessíveis (a partir de duas, como número); senão, o aviso sobre a cópia salva.

Uma nota pode ser enviada pelo seu próprio menu ⋮: **Enviar nota por e-mail (mailto)** a entrega ao aplicativo de e-mail do telefone — o Plainva não precisa de uma conta própria para isso —, enquanto **Enviar por e-mail** abre o próprio editor de e-mails do Plainva com assunto e texto.

## Importar de outro aplicativo

Em **Configurações → Manutenção → Importar de outro aplicativo** você traz notas de outro aplicativo para este dispositivo — com as mesmas fontes do desktop.

Primeiro você escolhe para onde a importação escreve: em uma **subpasta** do vault aberto ou em um **novo vault** neste dispositivo. O vault novo é a escolha certa quando ainda não há nada aqui; você só dá um nome a ele, e desfazer toda a importação significa removê-lo em **Mais → Vaults**.

As fontes que precisam de acesso — o Notion pela API — pedem um token no assistente. Ele vale para essa única execução e não é armazenado.

Os detalhes de cada fonte estão em [Importar de outro aplicativo](Import.md).

## Sincronização

As **Configurações** (bem no fim de **Notas**) levam, por meio de **Vault ativo**, ao gerenciamento de vaults; lá você conecta o armazenamento na nuvem (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Conectar um cofre na nuvem** traz um vault existente na nuvem para o dispositivo; **Criar um vault** primeiro pergunta **Neste dispositivo** ou **Em um serviço on-line** e depois pede a estrutura inicial (vazio ou um modelo como PARA) — no caminho on-line, a conexão vem em seguida, a pasta de destino na nuvem pode ser criada na hora com **Nova pasta** na folha do seletor, e a estrutura é enviada na primeira sincronização. O primeiro início do app oferece a mesma escolha entre um vault existente e um novo vault na nuvem ("Conectar um cofre na nuvem"). Cada conexão recebe seu próprio vault separado no dispositivo. A página do vault mostra o status, o progresso, as transferências pendentes e oferece **Exportar o vault** (um ZIP pela folha de compartilhamento).

A página do vault é organizada de acordo com para que servem seus controles: no topo, um **cartão de status** responde à única pergunta com que se abre essa página — está funcionando? (estado, última execução, transferências pendentes e intervalo em uma linha). Abaixo, grupos nomeados — **Conexão**, **Conteúdo** — e bem embaixo, destacada por sua própria borda, a **Zona de perigo** com **Desconectar sincronização** e **Excluir cofre**. Antes havia até nove botões de aparência idêntica em uma única fileira, com **Restaurar arquivos excluídos** logo ao lado de **Excluir cofre**.

Em **Conteúdo**, ao lado de **Exportar o vault**, agora também está o **backup automático do vault**: um ZIP de todo o vault por dia, do qual os últimos **sete** são mantidos (**Backups a manter**); **Fazer backup agora** cria um imediatamente. Os arquivos ficam nos documentos do aparelho, não no cache — algo que o sistema operacional pode esvaziar a qualquer momento não é um arquivo. Um telefone não tem alarme em segundo plano: a verificação acontece ao abrir o app e sempre que você volta a ele, então o backup recupera o atraso em vez de rodar num horário fixo. A linha abaixo do interruptor informa, por isso, quando ele rodou pela última vez — é assim que um backup que silenciosamente nunca acontece se torna visível. Até agora, o celular só tinha a exportação manual — um vault que ninguém pensava em exportar ficava sem nenhum arquivo. Após uma reinstalação no Android, o telefone não consegue mais ler seus arquivos antigos — eles ficam na pasta, mas não são contados nem limpos; o cartão **Backups mais antigos não podem ser lidos** diz isso em vez de afirmar "0 backups".

A frequência com que este cofre verifica mudanças remotas é definida na mesma página (**intervalo de sincronização**, no mínimo 5 segundos) — os salvamentos locais sobem imediatamente de qualquer forma. No Google Drive, OneDrive, Dropbox e S3 a **pasta na nuvem** também pode ser trocada depois; no WebDAV a pasta faz parte do endereço do servidor, então você reconecta. Se a sincronização de configurações estiver criptografada, você pode ativar **Pedir a senha a cada início**: a chave então não fica guardada no aparelho. E **Segurança e compartilhamento** agora diz abertamente que espaços de trabalho criptografados são experimentais e ainda não passaram por auditoria independente — guarde o arquivo e o código de recuperação em local seguro.

A página do vault também informa se suas **configurações** viajam com você — como um cartão com um estado claro, em vez de um botão qualquer:

- **As configurações não estão sendo sincronizadas**: a sincronização de configurações está desativada para este vault. Ative-a pelo desktop.
- **Ainda não criptografado**: este vault ainda não tem frase secreta de sincronização. Você já pode defini-la **no telefone**: o assistente mostra o código de recuperação e pede que você digite de volta dois grupos escolhidos aleatoriamente antes que qualquer coisa seja gravada. Se já existir uma frase secreta na nuvem, o telefone avisa e nunca cria uma segunda — isso deixaria todos os outros dispositivos de fora.
- **Ainda não desbloqueado neste dispositivo**: suas configurações ficam armazenadas de forma criptografada na nuvem. Digite a frase secreta definida ao configurar isso — no desktop ou aqui, no telefone; este dispositivo as desbloqueia uma vez com ela.
- **As configurações estão sendo sincronizadas**: este dispositivo está desbloqueado; pastas, visualizações e regras de backup permanecem sincronizadas com seus outros dispositivos.

Cada cartão também informa o que *não* viaja: os logins sempre ficam no dispositivo (veja [Calendário e eventos](#calendário-e-eventos)).

**Configurações** → **Segurança e compartilhamento** informa o que a conexão realmente é — e, em um vault de nuvem comum, configura o espaço de trabalho criptografado direto no telefone (identidade → arquivo de recuperação e código → ativação). Sem conexão de nuvem não há nada para criptografar, e a área diz isso.

As duas configurações — o espaço de trabalho criptografado e a frase secreta de sincronização — agora funcionam como **um fluxo próprio, sem barra de navegação**: enquanto uma delas está aberta, existe exatamente uma saída, e ela pergunta antes. Isso não é enfeite. Até a última etapa, sua chave existe só na memória, e sair a descarta; antes, um toque na barra podia fazer isso sem dizer nada. A última etapa mostra uma barra de progresso quando há algo a contar — o espaço de trabalho volta a criptografar cada arquivo, enquanto a frase secreta de sincronização consiste em duas gravações, e inventar uma porcentagem para esta última seria uma mentira em forma de barra.

**Os compartilhamentos são gerenciados aqui agora**, não apenas no desktop: em **Pessoas e permissões** você convida um membro com um papel (**Convidar** o cria — o dispositivo dele você pareia depois), cria um grupo e altera o papel de um grupo direto na linha dele. Em **Slices** você cria um compartilhamento para uma **Pasta**. Deliberadamente fora do celular: slices a partir de uma seleção livre ou de uma regra dinâmica — ambos exigiriam telas que não existem aqui. Você escolhe a pasta com **Escolher pasta…** em vez de digitar o caminho.

**Deixar outro app sincronizar a pasta (iPhone e iPad).** A pasta do Plainva aparece no app **Arquivos**, em **No meu iPhone** → **Plainva**. Assim, outro programa — um cliente Syncthing, por exemplo — pode selecioná-la e mantê-la sincronizada entre seus dispositivos sem que o Plainva se conecte a nenhum serviço de nuvem. O vault que você criou no dispositivo fica ali como `vault`; cada conexão na nuvem ganha sua própria subpasta em `vaults`. O contrário não vale: o Plainva trabalha na própria pasta, não na de outro app. No Android essa pasta não fica visível para outros programas.

**Uma pasta existente como vault (Android e iOS).** Em **Vaults → Criar um vault** há um terceiro caminho, **Uma pasta neste dispositivo**: você escolhe uma pasta mantida por outro programa — Syncthing, o app Arquivos, um segundo cliente de sincronização — e o Plainva lê e grava ali sem copiar nada. A pasta continua sendo a pasta: se você remover o vault, só a conexão desaparece, os arquivos ficam. Mudanças que outro programa faz ali são vistas ao voltar ao app e ao abrir uma nota. A sincronização na nuvem fica desligada para esses vaults — uma segunda sincronização no mesmo local sobrescreveria a primeira — e o cartão nos detalhes do vault diz isso. Se o acesso expirar (pasta movida, permissão revogada), o cartão avisa e **Reconectar pasta** o restaura.

## Rede de segurança

Snapshots (histórico de versões), um diário de rascunhos (depois de uma falha, a nota oferece o último estado não salvo) e cópias em conflito com uma visão de comparação protegem seus dados. A retenção é configurada em **Configurações** → **Backup e versionamento**.

**Se alguém alterar a mesma nota em outro lugar** enquanto você digita aqui, o Plainva guarda a sua versão como cópia ao lado e adota a que chegou. Isso agora fica **na nota** e permanece até você resolver: um aviso acima do texto informa o caminho da cópia, abre-a e mostra as **diferenças** quando você quiser. Antes era uma mensagem que sumia em segundos — e o salvamento continuava tentando, de modo que cada rodada escrevia mais uma cópia. Agora é escrita exatamente uma.

**Diferenças** abre a mesma tela de comparação do desktop: a nota à esquerda, sua cópia à direita, linhas iguais recolhidas e as mesmas saídas — **adotar**, **manter ambas** (a cópia passa a se chamar `Nota (Version …).md`), **descartar cópia**, cada uma perguntando antes.

**Ao excluir uma pasta**, a caixa de diálogo informa quantos arquivos ela contém — o número também aparece no botão. O Plainva primeiro cria um snapshot de cada arquivo dentro dela, que você pode recuperar em **Configurações** → **Manutenção** → **Restaurar arquivos excluídos**. Ela também declara um limite com clareza: **só pode ser preservado o que este telefone já escreveu pelo menos uma vez.** Uma nota que só chegou por sincronização e nunca foi editada aqui não existe em nenhum snapshot. Diferente do desktop, um telefone não tem lixeira do sistema operacional para recuperar isso. Se a exclusão afetar mais de dez arquivos, ou mais de um quinto do vault, o Plainva pergunta uma segunda vez — exatamente como no desktop.

## Compartilhamento e atalhos

No Android e no iOS, o texto e as URLs compartilhados viram uma nova nota na pasta de entrada; as imagens e os arquivos compartilhados são importados como anexos (até 25 MB por arquivo). No Android, toque e segure o ícone do app para os atalhos adicionais **Nova nota** e **Hoje**.

## Pastas, fotos e calendário

O botão flutuante **Mais** continua disponível em pastas aninhadas, e cada ação de criação rápida cria na pasta que você tem aberta — incluindo novas pastas. Já o ⋮ no cabeçalho pertence ao objeto que está aberto: ele mostra as ações desse objeto, nunca as configurações do app.

O botão de foto do editor oferece **Tirar foto** ou **Escolher da galeria**, preserva a posição de inserção e mostra de forma visível os erros de permissão ou de arquivo. As fotos vão para a pasta de anexos do cofre — a mesma que o seu computador usa.

Eventos e notas diárias são propositalmente separados: **Calendário** mostra os calendários conectados (veja [Calendário e eventos](#calendário-e-eventos)), **Hoje** mostra a nota diária de um dia escolhido. Não existe uma visualização mensal local das notas diárias — quem cumpre esse papel é a faixa em **Hoje**.

## Anexos e imagens

Além de notas e bancos de dados, o navegador agora mostra os **anexos** — imagens, PDFs e tudo o mais que estiver na pasta. Uma imagem abre dentro do Plainva; o resto é entregue ao sistema, que sabe o que é um PDF e o Plainva não. Por **Compartilhar** um arquivo vai para qualquer outro app.

O menu ⋮ de uma nota traz **Exportar como Markdown…**: entrega o próprio arquivo à folha de compartilhamento do sistema, onde estão Imprimir, “Salvar em Arquivos” e todos os editores instalados. **Compartilhar**, acima, envia apenas o texto da nota. Se a nota tiver anotações abertas, o Plainva pergunta antes **Incluir as anotações?** — **Como lista no final (legível em qualquer lugar)** ou **Marcadas no texto (CriticMarkup)**; as marcações de âncora invisíveis são removidas em todos os casos.

## Deslizar

**Deslize uma linha para a esquerda** para revelar suas ações: **Favorito** e **Excluir** numa nota, **Renomear** e **Excluir** numa pasta, **Excluir** num banco de dados e na caixa de e-mail. São as mesmas ações que a linha oferece no seu menu (pressionar e segurar) — o deslize é só o caminho mais curto até lá, nunca o único. Na primeira vez, uma faixa acima da lista avisa isso; você a dispensa com um toque, e ela aparece exatamente uma vez por vault.

Excluir pede confirmação pela mesma caixa de diálogo de sempre. Enquanto você seleciona várias linhas, o deslize fica desativado — um gesto que aponta para exatamente uma linha não tem um significado claro ao lado de uma seleção que você ainda está montando. Com as **conversas** ativadas na caixa de e-mail, um deslize numa conversa afeta a conversa **inteira** (em vez de um desfazer, ela então informa quantas mensagens eram); uma mensagem individual expandida ainda se desliza sozinha. Linhas de tarefa não têm ações de deslize — elas trazem seus controles visíveis na própria linha.

## Em telas largas

O app segue a largura da janela, não o nome do dispositivo:

- **abaixo de 600 px** — uma superfície após a outra, como no telefone.
- **de 600 a 839 px** — a barra de navegação vira uma **faixa lateral**; continua sendo uma única superfície.
- **a partir de 840 px** — o navegador e a superfície de trabalho ficam **lado a lado**. É o mesmo navegador da área **Notas**, só que ao lado do seu trabalho em vez de na frente dele.

**A faixa lateral mostra todas as seções.** No celular, a barra inferior comporta de três a cinco destinos — mais do que um polegar alcança com confiabilidade, por isso o restante fica atrás de **Seções**. Na borda de uma superfície larga esse limite não vale: a lista **inteira** fica ali na sua ordem (**Configurações → Barra de navegação**), o desvio por **Seções** deixa de existir, e as **Configurações** ficam bem no final. A faixa lateral começa abaixo da barra de status — em um tablet com um recorte de câmera, o primeiro ícone dela costumava ficar embaixo dele.

**O navegador se recolhe.** Enquanto você procura uma nota, a coluna da esquerda pertence a essa busca; enquanto você escreve uma, ela pertence à nota. O ícone no fim da faixa lateral — logo acima de **Configurações** — a recolhe e a reabre, e a superfície de trabalho então ocupa a largura inteira. O interruptor só aparece onde existe uma segunda coluna (a partir de 840 px), vale para este dispositivo e permanece como você deixou mesmo depois de reiniciar. No desktop é a mesma ação — lá ela se chama **Alternar barra lateral esquerda**.

Em um tablet, ou em um telefone grande virado de lado, você obtém o mesmo modelo espacial do desktop — navegar à esquerda, trabalhar no meio — em vez de um telefone ampliado.


## Bancos de dados no calendário

Acima das visualizações do calendário há uma fileira de chips: qualquer visualização `.base` do tipo **calendário** ou **linha do tempo** que indique uma coluna de data pode ser exibida ali. As entradas exibidas aparecem entre os compromissos nas listas de dia e agenda — com um **losango e borda tracejada**, para que uma nota nunca pareça um compromisso; na grade do mês, como **ponto vazado**. Um toque abre a nota.

**A seleção pertence ao vault**, não ao aparelho: o que você exibe no computador está aqui assim que a sincronização de configurações rodar. No celular, agenda-se pela folha da entrada — arrastar fica no computador.

No sentido inverso, a visualização de calendário de um banco de dados pode mostrar o **número de compromissos reais** do dia no canto da célula — você vê contra o que está planejando.

## Notificações de anotações

Quando alguém escreveu em uma nota, o Plainva pode avisar — os mesmos três níveis e o mesmo botão de prévia do desktop, em **Configurações → Conteúdo e estrutura**. Tocar na mensagem abre a nota e destaca o cartão a que ela se refere. Você silencia uma nota específica pelo sino na folha de comentários.

Quando várias anotações são novas de uma vez, a notificação abre **Comentários abertos** na aba **Novos** — exatamente os tópicos a que se referia; **Todos** e **Para mim** ficam ao lado.

**Aqui a mensagem chega mais tarde que no desktop, e isso é uma característica, não um defeito.** O Plainva não tem servidor que possa cutucar o seu telefone — construir um significaria um servidor alheio saber quando quem comentou qual nota. Por isso uma anotação é percebida onde o telefone olha de qualquer maneira: após um ciclo de sincronização e ao voltar ao primeiro plano. Nenhum temporizador roda em segundo plano para isso; nenhuma plataforma de telefone permite.
