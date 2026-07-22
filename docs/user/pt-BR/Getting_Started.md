# Primeiros Passos

Última revisão: 2026-07-22

Esta página leva você da instalação ao primeiro trabalho de verdade: abrir ou criar um vault, conhecer a interface e entender os três modos do editor.

## O que é um vault?

Um vault é uma pasta comum no seu computador que guarda suas notas em Markdown. O Plainva adiciona uma subpasta oculta `.plainva/` para o índice de busca e as configurações — suas notas em si continuam sendo arquivos `.md` intocados. Você pode ter vários vaults (por exemplo, "Pessoal" e "Trabalho") e alternar entre eles.

## Abrir ou criar um vault

Ao iniciar, a tela de boas-vindas recebe você:

- **Abrir vault** — o Plainva primeiro pergunta **"Onde está seu vault?"**: **Pasta local** abre uma pasta existente com arquivos Markdown neste computador (vaults do Obsidian funcionam prontamente); **Vault on-line** sincroniza um vault existente da nuvem para uma pasta local — as mesmas três etapas para todos os provedores (**Conectar**, **escolher a pasta na nuvem**, **escolher a pasta local**; veja [Configurar Sincronização](Sync_Setup.md)).
- **Novo vault** — a primeira pergunta é **"Onde seu vault deve ficar?"** (**Neste computador** ou **Em um serviço on-line**), depois você escolhe a estrutura inicial: comece vazio ou a partir de uma estrutura de pastas pronta; ambos são ajustáveis a qualquer momento. O **Vault vazio** contém apenas uma visão geral em `index.md`. Os modelos disponíveis são **PARA**, **Zettelkasten**, **ACE (Linking Your Thinking)**, **Johnny.Decimal**, **GTD** e **Journal** — cada um cria pastas, uma nota de boas-vindas com um guia rápido e visões gerais em `index.md` mantidas automaticamente no [formato OKF](OKF.md) (os nomes de pastas e arquivos seguem o idioma do app). O modelo **Journal** também configura as opções de notas diárias do vault. Os modelos **PARA**, **GTD**, **Zettelkasten** e **Journal** também trazem [bancos de dados](Databases_Base.md) já vinculados, com modelos de nota correspondentes — por exemplo, projetos com um quadro de status e um link para a área, ou tarefas que apontam para o seu projeto. No caminho on-line, a conexão segue o mesmo fluxo: escolha o provedor, conecte, escolha a pasta na nuvem ou crie uma nova com **Nova pasta**, escolha a pasta local — a estrutura escolhida é criada na pasta local e enviada para a nuvem pela primeira sincronização.

**Vaults recentes** lista tudo o que você já abriu antes. **Remover da lista** remove uma entrada apenas do Plainva — os arquivos permanecem no disco. Ative **Abrir automaticamente o último vault ao iniciar** para pular a tela de boas-vindas no futuro. Ao remover, o Plainva pergunta se você também quer esquecer todos os dados do aplicativo do vault (índice de busca, configurações, layout da janela, credenciais de sincronização; backups ZIP automáticos apenas pela caixa extra) — sua pasta do vault permanece intacta em qualquer caso.

## A interface

- **Barra lateral esquerda** — quatro visualizações: **Arquivos** (a árvore de arquivos), **Tags** (todas as `#tags` do vault), **Favoritos** e **Bancos de dados** (cada `.base` do vault, agrupado por pasta — clique para abrir). No topo fica o grande botão **Novo** (Nova nota, mais **Mais opções** para Nova pasta, Nova base, Nota diária). Embaixo: o seletor de vault, **Abrir nota diária** e **Configurações**. O botão de seta dupla ao lado das quatro visualizações recolhe ou expande todas as pastas de uma vez, e **Mostrar na árvore de arquivos** no menu ⋮ do editor mostra a nota aberta diretamente na árvore. Na visualização **Arquivos**, um cabeçalho mostra o nome e o ícone do vault atual, e uma faixa **Abertos recentemente** acima da árvore oferece acesso com um clique às notas que você abriu mais recentemente.
- **Barra de título** — suas abas abertas. As abas podem ser reordenadas arrastando e movidas entre painéis do editor.
- **Área do editor** — onde você lê e escreve. Pelo menu da aba (**Dividir à direita** / **Dividir abaixo**) ou pelos atalhos `Ctrl+Alt+V` / `Ctrl+Alt+S` você divide o editor em dois painéis, por exemplo uma nota ao lado de um banco de dados.
- **Barra lateral direita** — quatro seções, reordenáveis por arrastar: **Calendário** (notas diárias), **Estrutura** (títulos da nota ativa), **Backlinks** (quem faz link para cá) e **Propriedades** (o frontmatter da nota).
- **Barra de status** — contagem de palavras/caracteres, status de sincronização (Local/Online/Offline) e status de salvamento (**Salvando...** / **Salvo**).

## Os três modos do editor

Alterne o modo no canto superior direito do editor:

| Modo | Para que serve |
|---|---|
| **Modo de leitura** | Visualização totalmente renderizada para ler e navegar. Os links abrem direto dentro do Plainva. |
| **Visualização ao vivo** | O padrão para escrever: o Markdown é renderizado enquanto você digita; os caracteres de formatação só aparecem onde você está trabalhando. |
| **Código Markdown** | O texto bruto sem renderização — para controle total. |

Qual modo as notas abrem é você quem escolhe: selecione a **Visualização padrão** em **Configurações → App → Editor e notas** (leitura, ao vivo ou código). Alternar o modo no editor vale para aquele arquivo durante a sessão atual.

Você também pode alternar entre **Largura de leitura** e **Largura total**.

## Fundamentos da árvore de arquivos

- **Criar:** clique com o botão direito em uma pasta → **Nova nota aqui**, **Nova pasta** ou **Novo banco de dados (.base)**. O grande botão **Novo** cria dentro da pasta selecionada no momento (ou na pasta pai de um arquivo selecionado).
- **Selecionar:** clicar seleciona, `Ctrl`+clique adiciona/remove individualmente, `Shift`+clique seleciona um intervalo, clique com o botão do meio abre em uma nova aba.
- **Menu de contexto:** inclui **Renomear** (atualiza os links em todo o vault), **Duplicar**, **Abrir na divisão (direita)** / **Abrir na divisão (abaixo)**, **Adicionar aos favoritos**, **Copiar caminho**, **Mostrar no gerenciador de arquivos**, **Excluir**.
- **Seleção múltipla:** excluir pergunta uma vez para todos os itens, duplicar e mover por arrastar funcionam para toda a seleção. Os itens excluídos vão para a lixeira do sistema operacional.
- Novas notas começam automaticamente com um `# Título` derivado do nome do arquivo.
- O `index.md` próprio de uma pasta (sua visão geral) é ordenado no **topo** dessa pasta na árvore, acima de suas subpastas e arquivos — não em ordem alfabética entre as demais notas.

## Notas diárias

O botão **Nota diária**, na barra de ações à esquerda, abre ou cria a nota de hoje. Configure a pasta base, o formato de data e um modelo opcional em **Configurações → Vault → Conteúdo e estrutura** (**Escolher pasta…** ao lado do campo permite escolher a pasta diretamente no vault).

O **Calendário** à direita é uma visão geral do dia: **clicar** em uma data abre a [aba do calendário](Calendar_and_Tasks.md) naquele dia; um **clique com o botão direito** abre um menu que nomeia o dia no topo e oferece **Abrir calendário**, **Nota diária** e os eventos e as tarefas com vencimento daquele dia. Dias com uma nota diária trazem um pequeno **ícone de sol**, dias com eventos, pontos coloridos por calendário. O botão **Hoje** leva você de volta ao mês atual; clicar no nome do mês abre um seletor rápido de mês/ano. Lá você também pode ativar **Mostrar números da semana** para adicionar uma coluna com a semana ISO — a configuração é lembrada.

## Configurações

**Configurações** (ícone de engrenagem na parte inferior da barra de ações à extrema esquerda, ou `Ctrl+,`) fecham pelo **X** no canto superior direito, `Esc` ou um clique fora da janela. As alterações são salvas imediatamente e automaticamente — apenas as credenciais na nuvem são aplicadas deliberadamente por **Login** na área **Contas na nuvem** (veja [Configurar Sincronização](Sync_Setup.md)). As configurações se dividem em duas partes; cada área na barra lateral esquerda abre sua própria página, onde as configurações ficam em cartões de grupo nomeados:

- **App** — tudo que se aplica ao app inteiro, em cinco áreas. **Aparência**: o seletor de **Tema** como cartões de pré-visualização — além do **Azul-petróleo** (o padrão), você tem **Nord**, **Solarized**, **Gruvbox**, **Catppuccin**, **Papel** (estilo E-Ink, o mais calmo possível), **Sépia** (papel quente), **Floresta**, **Meia-noite** (preto OLED), **Alto contraste** e **Fósforo verde**/**Fósforo âmbar** (terminal retrô com scanlines discretas); além do **Modo** (**Claro**/**Escuro**/**Padrão do sistema**; temas de modo único como **Meia-noite** fixam o modo, e o alternador claro/escuro na barra de título pausa enquanto eles estão ativos), **Idioma**, **Início da semana**, **Densidade** e **Zoom da interface**. **Editor e notas**: **Visualização padrão**, **Tamanho da fonte do conteúdo** e **Fonte do conteúdo**. **Inicialização e comportamento**: abrir o último vault automaticamente, avisos de compatibilidade. **Atualizações**: o Plainva verifica silenciosamente novas versões ao iniciar e mostra um aviso quando encontra uma — clique nele para baixar e instalar a atualização na hora (o aviso permanece até o Plainva reiniciar). Desative em **Verificar atualizações ao iniciar**. **Sobre e diagnóstico**: detalhes de versão, o status do **Chaveiro do sistema**, **Métricas de desempenho**, **Exportar diagnóstico…** (sem conteúdo de notas) e **Relatar um problema**. Os atalhos de teclado ficam acessíveis a qualquer momento por `F1` ou **Mostrar atalhos de teclado**, no canto inferior esquerdo.
- **Vault** — o vault selecionado fica como um pequeno cartão na barra lateral (o vault ativo tem um ponto); com vários vaults, **Trocar** abaixo dele abre uma lista de seleção. Abaixo, as áreas por vault: **Contas na nuvem** é o único lugar para todo login na nuvem — **Conectar conta…** escolhe o provedor (Microsoft, Google, Nextcloud, Dropbox, S3, WebDAV ou uma caixa de e-mail) e os serviços (**Arquivos**, **Calendário e tarefas**, **E-mail**) que essa conta deve carregar. As áreas de serviço **Sincronização** (veja [Configurar Sincronização](Sync_Setup.md)), **Calendário** (veja [Calendário & tarefas](Calendar_and_Tasks.md)) e **E-mail** (veja [Captura de e-mail](Email_Capture.md)) só aparecem quando uma conta conectada carrega esse serviço. Sempre presentes: **Conteúdo e estrutura** (**Notas diárias**, **Modelos e tarefas** incluindo a **Pasta de modelos**, **OKF (Open Knowledge Format)** — veja [OKF](OKF.md) — e **Bancos de dados estendidos**), **Backup e versionamento** e **Manutenção** (**Reconstruir índice**, restaurar arquivos excluídos, estatísticas do vault).

## Personalizando a interface

- **Alternar as barras laterais** pelos dois botões da barra de título ou por `Ctrl+Alt+B` (esquerda) / `Ctrl+Alt+R` (direita) — ótimo para escrever com foco. O Plainva lembra o estado.
- **Paleta de comandos**: `Ctrl+P` abre **Comandos** — digite e pressione `Enter` para executar (nova nota, nota diária, dividir, barras laterais, **Fazer backup agora** e muito mais).
- **Densidade**: em **Configurações → App → Aparência**, escolha entre **Confortável** e **Compacto** — Compacto aperta listas, menus e linhas de tabela; o conteúdo das notas não é afetado.
- **Fonte do conteúdo**: em **Configurações → App → Editor e notas**, defina o **Tamanho da fonte do conteúdo** (12–24 px) e a **Fonte do conteúdo** (**Padrão do tema**, **Serifada**, **Sem serifa**, **Monoespaçada** ou **Personalizada…** com o nome de qualquer fonte instalada) — isso escala apenas o editor e o modo de leitura; a interface não muda.
- **Zoom da interface**: redimensiona TODA a interface entre 80 % e 150 % — em **Configurações → App → Aparência** ou por `Ctrl+Plus`/`Ctrl+Minus` (`Ctrl+0` redefine).
- **Diálogos e avisos sem janelas nativas**: as confirmações aparecem como diálogos do Plainva no estilo do seu tema (ações destrutivas ganham um botão vermelho), avisos curtos como notificações discretas no canto inferior direito — chega de pop-ups do sistema.

## Veja também

- [Notas & Markdown](Notes_and_Markdown.md) — tudo sobre a escrita
- [Atalhos de Teclado](Keyboard_Shortcuts.md)
- [FAQ e Solução de Problemas](FAQ.md)

## O grafo

Por **Ctrl/Cmd+Shift+G** (ou a seção **Grafo** na barra lateral direita) você vê seu vault como um mapa: pastas como bolhas, notas como nós, relações como arestas rotuladas — incluindo um modo de limpeza e viagem no tempo. Detalhes: [Grafo](Graph.md).

## Memória da barra lateral direita

Seções contextuais vazias como **Estrutura**, **Backlinks** e **Propriedades** fecham sem substituir a preferência global. A barra lateral direita inteira também lembra uma preferência global para notas; telas sem contexto de nota a fecham apenas temporariamente.
