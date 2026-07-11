# Backups & Histórico de Versões

Stand: 2026-07-11

O Plainva protege seu trabalho em dois níveis: **versões de arquivo** (snapshots automáticos de cada arquivo individual ao editar e excluir) e **backups do vault** (arquivos ZIP regulares de todo o vault, armazenados fora da pasta do vault). Ambos rodam em segundo plano sem qualquer configuração e podem ser ajustados nas configurações em **Backup e versionamento**.

## Versões de arquivo (snapshots)

Antes de cada salvamento, o Plainva armazena um snapshot do estado anterior — como uma cópia em texto simples em `.plainva/backups/` dentro do vault (esta pasta fica oculta na árvore de arquivos, na busca e na sincronização). Para evitar centenas de cópias enquanto você digita, aplica-se um **Intervalo de snapshot** (padrão: no máximo uma nova versão a cada 2 minutos). **Excluir sempre gera um snapshot**, independentemente do intervalo.

Retenção (configurável por vault):

- **Intervalo de snapshot**: A cada alteração / 30 s / 2 min / 5 min / 10 min
- **Versões por arquivo**: padrão 100 — acima disso, as mais antigas são removidas
- **Idade máxima**: padrão 90 dias — versões mais antigas são removidas **permanentemente** por uma execução de limpeza diária ("Ilimitado" desativa isso)

Ao renomear ou mover um arquivo, o histórico de versões dele se move junto.

## Visualizando e restaurando versões

Clique com o botão direito em um arquivo na árvore de arquivos (ou na aba dele), ou use o menu **⋮** no canto superior direito do editor → **Histórico de versões…** abre a lista de versões:

- O lado esquerdo lista todos os snapshots agrupados por dia, com hora e tamanho.
- O lado direito mostra uma pré-visualização; para arquivos de texto, **Comparar com a versão atual** mostra a versão selecionada lado a lado com o conteúdo atual (versão antiga à esquerda, estado atual à direita).
- **Restaurar** substitui o conteúdo atual pela versão selecionada. Não se preocupe: o estado atual é salvo primeiro como um snapshot — então uma restauração sempre pode ser desfeita.
- **Restaurar como cópia** cria a versão como um novo arquivo ao lado do original (`Name (Version 2026-07-05 14-30).md`) sem alterá-lo.

Imagens também têm versões (com pré-visualização); outros arquivos binários podem ser restaurados sem pré-visualização.

## Restaurando arquivos excluídos

Como toda exclusão gera um snapshot do arquivo antes, o Plainva pode trazer arquivos excluídos de volta: clique com o botão direito no nome do vault no topo da árvore de arquivos → **Restaurar arquivos excluídos…** (também acessível pelas configurações). A lista mostra todos os arquivos cujos snapshots ainda existem enquanto o original desapareceu — **Restaurar** recria o estado mais recente no local original (pastas são recriadas conforme necessário), **Versões…** abre o histórico completo do arquivo excluído.

Observação: excluir uma **pasta inteira** a move para a lixeira do sistema operacional — nesse caso, a lixeira do sistema é o meio principal de recuperação; no Plainva você pode encontrar apenas snapshots mais antigos dos arquivos contidos.

## Backups automáticos do vault (ZIP)

Além disso, o Plainva faz backup de todo o vault como um arquivo ZIP — por padrão **diariamente** em segundo plano (ao abrir o vault, se o último backup tiver mais de 24 horas). Isso protege você mesmo que a pasta do vault em si seja perdida ou danificada, porque os ZIPs ficam **fora** do vault:

- O destino padrão é a pasta de dados do aplicativo (exibida em **Pasta de destino** nas configurações; **Abrir pasta** leva você direto até lá).
- Por meio de **Escolher pasta…** você pode escolher um disco externo ou um NAS; **Padrão** volta para a pasta de dados do aplicativo. Se o destino estiver momentaneamente inacessível (NAS desligado), a barra de status menciona isso discretamente e o Plainva tenta novamente mais tarde.
- **Backups a manter** (padrão: 7) limita a quantidade; ZIPs mais antigos do mesmo vault são excluídos automaticamente. Arquivos de terceiros na pasta de destino nunca são tocados.
- **Fazer backup agora** inicia um backup manualmente a qualquer momento; a barra de status mostra a execução e o resultado.

Os arquivos ZIP são nomeados `VaultName_2026-07-05_14-30-00.zip` e contêm todas as notas, anexos e sua configuração `.obsidian` — eles **não** contêm a pasta interna `.plainva` (o índice de busca é reconstruído na próxima abertura; as versões de arquivo deliberadamente não fazem parte do ZIP).

**Restaurando a partir de um ZIP:** o ZIP é um arquivo compactado completamente normal. Extraia-o em qualquer lugar e abra a pasta extraída no Plainva como um vault — pronto.

## Configurações em resumo

Configurações → **Vault** → **Backup e versionamento**:

| Configuração | Padrão | Significado |
|---|---|---|
| **Backup automático do vault (ZIP)** | Ativado | ZIP diário em segundo plano |
| **Pasta de destino** | Pasta de dados do aplicativo | Onde os ZIPs são armazenados, livremente escolhível |
| **Backups a manter** | 7 | Essa quantidade de ZIPs é mantida |
| **Intervalo de snapshot** | 2 min | No máximo com essa frequência uma nova versão de arquivo é criada ao digitar |
| **Versões por arquivo** | 100 | Limite superior por arquivo |
| **Idade máxima** | 90 dias | Versões mais antigas são removidas permanentemente |

## Bom saber

- As versões de arquivo são cópias comuns em `.plainva/backups/` — em último caso, você pode abri-las sem o Plainva em qualquer gerenciador de arquivos.
- A sincronização própria do Plainva nunca transfere `.plainva`. Se você sincronizar a pasta do vault com um cliente de terceiros (por exemplo, o app do Nextcloud), os snapshots viajam junto — isso custa algum espaço de armazenamento, mas não causa dano.
- Conflitos de sincronização são adicionalmente protegidos por arquivos `.CONFLICT` (veja a [FAQ](FAQ.md)); o histórico de versões complementa isso com a linha do tempo de cada arquivo.
