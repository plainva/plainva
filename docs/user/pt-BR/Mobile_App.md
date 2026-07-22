# O app mobile

Última revisão: 2026-07-22

O Plainva também está disponível como aplicativo para Android e iOS. Ele funciona com os mesmos arquivos Markdown, o mesmo formato **OKF** e o mesmo mecanismo de sincronização do app de desktop — seu vault permanece idêntico nos dois mundos.

## Layout

- **Barra inferior:** três telas organizáveis livremente, mais a aba fixa **Mais**. **Mais** lista todas as telas (Notas, Hoje, Tags, Favoritos, Calendário, Bancos de dados, Grafo) — um toque a abre, a **alça** reorganiza a lista: as três primeiras formam a barra (marcadas com uma moldura), arrastar uma para cima a promove para a barra.
- **＋** flutua como um botão redondo acima da barra e abre a criação rápida: nota, nota diária, pasta, banco de dados, "A partir de modelo…".
- **Barra superior:** busca e as **Configurações** (⋮); a tela inicial também mostra "Recentes" e seus favoritos.
- **Configurações:** o botão ⋮ abre primeiro a lista de áreas (como o lado esquerdo das configurações do desktop) — um toque abre a respectiva página. No topo, **Vault ativo** leva ao gerenciamento de vaults: trocar de vault (marca de seleção = ativo), **Criar um vault** e **Conectar um cofre na nuvem**.

## Ler e editar notas

As notas abrem **renderizadas e somente leitura**; o lápis no canto superior direito muda para o modo de edição (com uma barra de ferramentas acima do teclado: formatação, listas, link wiki, comandos de barra, inserir foto). Incorporações `![[Nota]]` aparecem como cartões de pré-visualização tocáveis.

O botão **Detalhes da nota** no cabeçalho (entre o marcador e o menu ⋮) abre o painel de contexto da nota: propriedades (diretamente editáveis), backlinks, estrutura, grafo e o **histórico de versões** — cada edição cria automaticamente snapshots que você pode inspecionar, comparar e restaurar. O código-fonte Markdown e a busca na nota ficam no menu ⋮.

## Bancos de dados (`.base`)

Os bancos de dados `.base` funcionam como no desktop: todas as visualizações (tabela, lista, galeria, quadro, calendário, linha do tempo), edição tipada de células, os cartões do quadro se movem tocando e segurando. **Configurar** gerencia visualizações, colunas, filtros (incluindo grupos), ordenação e propriedades. Os esquemas de relação (destinos, cardinalidade) continuam sendo mantidos no desktop.

Uma visualização **Mural** mostra as notas como um quadro de duas colunas com cartões adesivos: tocar abre a nota, tocar e segurar mostra as ações (fixar, marcadores, cor, excluir), arrastar após tocar e segurar reordena, e as caixas de seleção são marcadas direto no cartão. O campo de entrada no topo captura uma nova nota. Dica: aponte o banco de dados para a sua pasta de entrada (**Configurações** → **Conteúdo e estrutura**) e as notas rápidas do ＋, assim como os textos compartilhados de outros apps, caem direto no mural.

## Calendário e eventos

O **Calendário** (aba inferior ou em "Mais") mostra suas notas diárias em uma grade mensal. O ícone do relógio no canto superior direito abre o **calendário de eventos** com as visualizações **Dia**, **3 dias** e **Agenda** — seus calendários conectados usam o mesmo modelo de contas do desktop. Tocar em um evento mostra os detalhes; para um convite, você pode **aceitar**, marcar como **talvez** ou **recusar** ali mesmo.

Gerencie as contas pelo ícone de engrenagem no calendário de eventos: conecte o **CalDAV** no dispositivo com uma senha de aplicativo (p. ex. Fastmail, Nextcloud, iCloud); Google e Microsoft seguem via login pelo navegador. Por conta, você pode mostrar ou ocultar calendários individuais.

## Sincronização

Em **Configurações** (⋮), **Vault ativo** leva ao gerenciamento de vaults; lá você conecta o armazenamento na nuvem (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Conectar um cofre na nuvem** traz um vault existente na nuvem para o dispositivo; **Criar um vault** primeiro pergunta **Neste dispositivo** ou **Em um serviço on-line** e depois pede a estrutura inicial (vazio ou um modelo como PARA) — no caminho on-line, a conexão vem em seguida: a pasta de destino na nuvem pode ser criada na hora com **Nova pasta** na folha do seletor, e a estrutura é enviada pela primeira sincronização. No primeiro início do app, a opção (**"Conectar um cofre na nuvem"**) oferece a mesma escolha entre um vault existente e um novo vault na nuvem. Cada conexão recebe seu próprio vault separado no dispositivo. A página do vault mostra o status, o progresso, as transferências pendentes e oferece **Exportar o vault** (ZIP pela folha de compartilhamento).

## Rede de segurança

Snapshots (histórico de versões), um diário de rascunhos (depois de uma falha, a nota oferece o último estado não salvo) e cópias em conflito com uma visão de comparação protegem seus dados. A retenção é configurada em **Configurações** → **Backup e versionamento**.

## Compartilhamento e atalhos

No Android e iOS, texto e URLs compartilhados viram uma nova nota na pasta de entrada; imagens e arquivos são importados como anexos (até 25 MB por arquivo). No Android, toque e segure o ícone para os atalhos adicionais **Nova nota** e **Hoje**. A página do vault permite ativar **Sincronizar configurações** e desbloquear ou bloquear com segurança um vault criptografado usando a senha.

## Pastas, fotos e calendário

O botão flutuante **Mais** continua disponível em pastas aninhadas e cada ação cria na pasta aberta. No cabeçalho, o **menu de três pontos** abre as configurações; novas pastas são criadas pelo botão **Mais**.

O botão de foto oferece **Tirar foto** ou **Escolher da galeria**, preserva a posição de inserção e mostra erros de permissão ou arquivo.

**Calendário** abre diretamente o calendário do provedor conectado. As notas diárias permanecem em **Hoje**; a antiga tela mensal intermediária foi removida sem alterar dados existentes.
