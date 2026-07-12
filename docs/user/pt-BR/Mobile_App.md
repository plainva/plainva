# O app mobile

Stand: 2026-07-12

O Plainva também está disponível como aplicativo para Android e iOS. Ele funciona com os mesmos arquivos Markdown, o mesmo formato **OKF** e o mesmo mecanismo de sincronização do app de desktop — seu vault permanece idêntico nos dois mundos.

## Layout

- **Barra inferior:** até quatro telas à sua escolha (Notas, Hoje, Tags, Favoritos, Calendário, Bancos de dados) ao redor do botão fixo **＋**. Altere a seleção em **Configurações** → **Barra de abas**.
- **＋**: um toque captura uma nova nota imediatamente (na pasta visível, senão na pasta de entrada). Toque e segure para a criação rápida: nota, nota diária, pasta, banco de dados, "A partir de modelo…".
- **Barra superior:** busca e o menu Mais; a tela inicial também mostra "Recentes" e seus favoritos.

## Ler e editar notas

As notas abrem **renderizadas e somente leitura**; o lápis no canto superior direito muda para o modo de edição (com uma barra de ferramentas acima do teclado: formatação, listas, link wiki, comandos de barra, inserir foto). Incorporações `![[Nota]]` aparecem como cartões de pré-visualização tocáveis.

O símbolo **ⓘ** abre o painel de contexto da nota: propriedades (diretamente editáveis), backlinks, estrutura, código-fonte Markdown, busca na nota e o **histórico de versões** — cada edição cria automaticamente snapshots que você pode inspecionar, comparar e restaurar.

## Bancos de dados (`.base`)

Os bancos de dados `.base` funcionam como no desktop: todas as visualizações (tabela, lista, galeria, quadro, calendário, linha do tempo), edição tipada de células, os cartões do quadro se movem tocando e segurando. **Configurar** gerencia visualizações, colunas, filtros (incluindo grupos), ordenação e propriedades. Os esquemas de relação (destinos, cardinalidade) continuam sendo mantidos no desktop.

## Sincronização

Em **Mais** → **Cofres** você conecta um armazenamento na nuvem (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). Cada conexão recebe seu próprio vault separado no dispositivo. A página do vault mostra o status, o progresso, as transferências pendentes e oferece **Exportar o vault** (ZIP pela folha de compartilhamento).

## Rede de segurança

Snapshots (histórico de versões), um diário de rascunhos (depois de uma falha, a nota oferece o último estado não salvo) e cópias em conflito com uma visão de comparação protegem seus dados. A retenção é configurada em **Configurações**.

## Compartilhamento e atalhos (Android)

Texto compartilhado de outros apps chega como uma nova nota na pasta de entrada. Toque e segure o ícone do app para os atalhos **Nova nota** e **Hoje**.
