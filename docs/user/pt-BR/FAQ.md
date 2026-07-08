# FAQ e Solução de Problemas

Stand: 2026-07-07

Respostas para as perguntas mais comuns — da compatibilidade com o Obsidian a arquivos de conflito e backups.

## Fundamentos

### Onde ficam meus dados?

Exclusivamente com você: um vault é uma pasta comum de arquivos Markdown no seu computador. O Plainva não opera nenhum servidor próprio e não guarda cópias em lugar nenhum. Se você sincroniza, os dados vão direto entre o seu computador e o *seu* armazenamento (seu Nextcloud, seu OneDrive, seu bucket …). As credenciais ficam no chaveiro do sistema operacional.

### Posso usar o Plainva e o Obsidian lado a lado?

Sim — essa é uma promessa central, com uma ressalva sincera. O Plainva grava Markdown puro com frontmatter padrão; tudo o que é específico do Plainva fica agrupado sob chaves `plainva:` (em notas e arquivos `.base`), que o Obsidian simplesmente ignora ao abrir os arquivos. O Obsidian mostra a chave `plainva` como um objeto não editável em suas propriedades — isso é inofensivo. Visualizações exclusivas do Plainva, como Quadro ou Calendário, aparecem no Obsidian como uma tabela simples.

A ressalva: **abrir é sempre seguro, editar nem sempre.** Um vault existente do Obsidian pode ser aberto e editado no Plainva sem riscos — nada é migrado ou reformatado. Mas, quando um vault passa a usar recursos do Plainva (extensões de banco de dados como quadros, relações ou colunas reversas, arquivos `index.md` gerenciados), editar esses arquivos específicos no Obsidian pode quebrar a funcionalidade do Plainva, porque o Obsidian não conhece as extensões `plainva:`. Notas sem extensões do Plainva podem ser editadas em qualquer lugar, a qualquer momento. Na primeira vez que você usa uma dessas extensões, um diálogo de aviso (**Extensão do Plainva**) avisa sobre isso; pode ser desativado em **Configurações → Avisos**.

### O Plainva modifica meu vault existente?

Não sem pedir. Arquivos existentes só são alterados quando você inicia explicitamente uma ação (por exemplo, a [conversão OKF](OKF.md) — com pré-visualização e backups). Apenas arquivos recém-criados recebem automaticamente o pequeno cabeçalho de frontmatter do OKF.

## Arquivos e edição

### Excluí algo — desapareceu de vez?

Não, duas vezes não: antes de cada exclusão, o Plainva salva o arquivo como um snapshot — clique com o botão direito no nome do vault → **Restaurar arquivos excluídos…** o traz de volta dentro do aplicativo. Além disso, arquivos e pastas excluídos vão para a lixeira do sistema operacional (para pastas inteiras, a lixeira é o meio principal de recuperação). Detalhes: [Backups & Histórico de Versões](Backups_and_Versioning.md).

### Existem versões mais antigas das minhas notas?

Sim: o Plainva cria automaticamente versões de arquivo enquanto você edita. Clique com o botão direito em um arquivo → **Histórico de versões…** mostra todos os snapshots com uma visualização de comparação e **Restaurar**. Além disso, o Plainva faz backup de todo o vault diariamente como um ZIP fora da pasta do vault. Detalhes: [Backups & Histórico de Versões](Backups_and_Versioning.md).

### Por que meu index.md é somente leitura?

Ele foi gerado pelo Plainva e é mantido atualizado automaticamente (reconhecível pelo aviso "Este index.md é gerenciado pelo Plainva…"). **Editar mesmo assim** o entrega permanentemente aos seus cuidados manuais — ele deixará de ser atualizado automaticamente. Detalhes: [OKF](OKF.md).

### O que acontece quando renomeio uma propriedade em um banco de dados?

O novo nome é gravado no frontmatter de **todas as notas correspondentes** (após confirmação, com um indicador de progresso). O mesmo princípio vale para excluir: a caixa de seleção **Também remover do frontmatter das notas** limpa as notas de origem também. Ambas as ações atuam nos seus arquivos — é exatamente para isso que existem.

### Posso desfazer a conversão OKF?

Antes de qualquer alteração, o assistente faz backup do arquivo em `.plainva/backups/okf-conversion-<timestamp>/`. O relatório final indica a pasta exata; você pode copiar arquivos individuais de volta dali. Use também a **Pré-visualização (sem alterações)** antes de converter.

## Sincronização

### O que é um arquivo .CONFLICT?

Se o mesmo arquivo foi alterado aqui e em outro dispositivo ao mesmo tempo, o Plainva primeiro tenta mesclar as duas versões automaticamente. Se isso não for possível, **sua** versão é salva com segurança como um arquivo `.CONFLICT` ao lado do original — nada nunca se perde. Arquivos de conflito são marcados na árvore de arquivos; clique com o botão direito para escolher **Manter esta versão** (a versão de conflito substitui o original) ou **Descartar conflito**.

### Meu login do Google fica expirando

Com a configuração "Bring Your Own", seu projeto do Google permanece no modo de teste; o Google então encerra a sessão após 7 dias. O Plainva renova os tokens automaticamente em segundo plano, mas, uma vez expirado, use **Reconectar** nas configurações de sincronização. Detalhes: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

### Meu vault fica em uma pasta do OneDrive/Dropbox/iCloud e o Plainva se comporta de forma estranha

Defina a pasta do vault como "sempre manter neste dispositivo" / "disponível offline" no cliente de sincronização do provedor. Arquivos de espaço reservado somente online (Files On-Demand, "online-only") interferem na indexação e na sincronização. Detalhes: [Compatibilidade de Sincronização](Sync_Compatibility.md).

### Estou offline — o que acontece com minhas alterações?

Elas são salvas localmente como de costume e reunidas em uma fila; assim que a conexão volta, o Plainva as transfere automaticamente. A barra de status mostra **Online**/**Offline**.

### A barra de status mostra Offline mesmo eu tendo internet

Nesse caso, a própria conexão de sincronização está com problema — geralmente porque o login expirou ou as credenciais mudaram (por exemplo, no Google Drive). Clique em **Offline** na barra de status ou no triângulo de aviso ao lado do nome do vault: o diálogo mostra a mensagem de erro exata, e **Abrir configurações de sincronização** leva você direto ao formulário do provedor correspondente, onde você reconecta (por exemplo, **Reconectar**). Cada clique também dispara imediatamente uma nova tentativa de sincronização.

## App

### Por que o F5 não recarrega e onde está o menu de contexto do navegador?

O Plainva é um aplicativo de desktop, não uma página web. As teclas de recarregar (F5, Ctrl+R) estão desativadas de propósito — recarregar descartaria suas abas abertas e as edições não salvas. O menu de contexto embutido da WebView também fica oculto; clicar com o botão direito sobre um texto selecionado ainda oferece **Copiar**, e a árvore de arquivos, as abas e as tabelas mantêm seus próprios menus de contexto.

### Como mudo o idioma?

**Configurações → Geral → Idioma** (atualmente alemão e inglês).

### "Verificar atualizações" não encontra nada

Enquanto ainda não houver versões públicas (releases), a verificação de atualização informa: "Ainda não há atualizações públicas (releases) disponíveis." Isso não é um erro.

### Existem recursos ocultos?

A Frota Estelar não comenta rumores. Mas dizem que o logotipo na barra de título reage a batidas persistentes — e quem então souber as palavras certas verá o Plainva sob uma luz totalmente nova depois disso. Alguns dizem: em quatro delas.

## Veja também

- [Configurar Sincronização](Sync_Setup.md) e [Compatibilidade de Sincronização](Sync_Compatibility.md)
- [OKF](OKF.md) — conversão, index.md, campos de sistema
