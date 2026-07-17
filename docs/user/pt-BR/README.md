# Guia do Usuário do Plainva

Última revisão: 2026-07-06

Esta tradução foi gerada automaticamente — correções são bem-vindas.

O Plainva é um editor de vault Markdown: suas notas são arquivos Markdown comuns em uma pasta (um "vault") no seu computador — sem silo de banco de dados, sem conta na nuvem obrigatória. Este guia explica como trabalhar com o Plainva e como os formatos de arquivo funcionam.

## Conteúdo

| Página | O que aborda |
|---|---|
| [Primeiros Passos](Getting_Started.md) | Abrir ou criar um vault, a interface, os modos do editor, abas e visualização dividida |
| [Notas & Markdown](Notes_and_Markdown.md) | Como os arquivos Markdown funcionam: escrever, formatar, propriedades (frontmatter), ícones, links, modelos, imagens |
| [Bancos de Dados (.base)](Databases_Base.md) | Ver notas como um banco de dados — visualizações, filtros, propriedades, relações, novos itens (parecido com o Notion, mas baseado em arquivos) |
| [OKF](OKF.md) | O Open Knowledge Format: `type`, `okf_version`, o gerenciamento de index.md e a conversão opcional do vault |
| [Referência do Formato de Arquivo](File_Format_Reference.md) | O formato exato em disco de cada arquivo do vault — para ferramentas, scripts ou uma IA editando notas e arquivos `.base` diretamente |
| [Automação & Scripts](Automation_and_Scripts.md) | Estendendo o Plainva sem plugins: como scripts, ferramentas CLI e agentes de IA leem e escrevem em um vault com segurança |
| [Backups & Histórico de Versões](Backups_and_Versioning.md) | Versões automáticas de arquivo, restauração (inclusive de arquivos excluídos) e backups diários em ZIP do vault |
| [O aplicativo móvel](Mobile_App.md) | Plainva no Android e iOS: estrutura, edição, bancos de dados, sincronização e rede de segurança |
| [Configurar Sincronização](Sync_Setup.md) | Passo a passo por provedor: WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3 |
| [Compatibilidade de Sincronização](Sync_Compatibility.md) | Quais serviços funcionam hoje — diretamente, via WebDAV ou via o cliente de desktop do provedor |
| [Google Drive (BYO)](Google_Drive_BYO_Guide.md) | Configurar a sincronização do Google Drive com suas próprias credenciais |
| [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md) | Configurar a sincronização do OneDrive e do Dropbox com um registro de app próprio |
| [Busca](Search.md) | Busca de texto completo, alternador rápido, localizar e substituir, tags |
| [Tarefas](Tasks.md) | A visualização de tarefas de todo o vault: toda caixa de seleção nas suas notas, com filtros de status/tag/pasta/vencimento e alternância com um clique |
| [Grafo](Graph.md) | Grafo de contexto, mapa do vault com modo de limpeza e viagem no tempo, grafo como visualização de banco de dados |
| [Atalhos de Teclado](Keyboard_Shortcuts.md) | Todos os atalhos de teclado em um só lugar |
| [FAQ e Solução de Problemas](FAQ.md) | Perguntas frequentes: compatibilidade com o Obsidian, arquivos de conflito, backups e mais |

## Princípios fundamentais

- **Seus arquivos pertencem a você.** Um vault é apenas uma pasta comum com arquivos Markdown. Você pode abri-la, copiá-la ou fazer backup dela com qualquer outro programa a qualquer momento.
- **Markdown puro é o formato canônico.** Até os recursos extras (propriedades, ícones, bancos de dados) são armazenados em formatos de texto abertos e legíveis.
- **Compatível com o Obsidian.** Vaults existentes do Obsidian nunca são danificados ou reformatados; o Obsidian consegue abrir todos os arquivos criados pelo Plainva.
