# FAQ e Solução de Problemas

Última revisão: 2026-09-03

Respostas para as perguntas mais comuns — da compatibilidade com o Obsidian a arquivos de conflito e backups.

## Fundamentos

### Onde ficam meus dados?

Exclusivamente com você: um vault é uma pasta comum de arquivos Markdown no seu computador. O Plainva não opera nenhum servidor próprio e não guarda cópias em lugar nenhum. Se você sincroniza, os dados vão direto entre o seu computador e o *seu* armazenamento (seu Nextcloud, seu OneDrive, seu bucket …). As credenciais ficam no chaveiro do sistema operacional.

### Posso usar o Plainva e o Obsidian lado a lado?

Sim — essa é uma promessa central, com uma ressalva sincera. O Plainva grava Markdown puro com frontmatter padrão; tudo o que é específico do Plainva fica agrupado sob chaves `plainva:` (em notas e arquivos `.base`), que o Obsidian simplesmente ignora ao abrir os arquivos. O Obsidian mostra a chave `plainva` como um objeto não editável em suas propriedades — isso é inofensivo. Visualizações exclusivas do Plainva, como Quadro ou Calendário, aparecem no Obsidian como uma tabela simples.

A ressalva: **abrir é sempre seguro, editar nem sempre.** Um vault existente do Obsidian pode ser aberto e editado no Plainva sem riscos — nada é migrado ou reformatado. Mas, quando um vault passa a usar recursos do Plainva (extensões de banco de dados como quadros, relações ou colunas reversas, arquivos `index.md` gerenciados), editar esses arquivos específicos no Obsidian pode quebrar a funcionalidade do Plainva, porque o Obsidian não conhece as extensões `plainva:`. Notas sem extensões do Plainva podem ser editadas em qualquer lugar, a qualquer momento. Na primeira vez que você usa uma dessas extensões, um diálogo de aviso (**Extensão do Plainva**) avisa sobre isso; pode ser desativado em **Configurações → App → Inicialização e comportamento**.

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

### Uma nota diária antiga está faltando na visão Tarefas

Notas diárias muito antigas podem ter herdado uma configuração do modelo delas que oculta suas tarefas. Pesquise no vault por `"tasks: false"` — **com** as aspas, ou você também encontrará notas em que as duas palavras aparecem apenas por coincidência. Nos resultados, a linha fica no frontmatter dentro de um bloco `plainva:`; exclua ali `tasks: false` (e `templateFor:`, se presente) e a nota volta a aparecer. Notas recém-criadas a partir de um modelo não herdam mais isso.

## Sincronização

### O que é um arquivo .CONFLICT?

Se o mesmo arquivo foi alterado aqui e em outro dispositivo ao mesmo tempo, o Plainva primeiro tenta mesclar as duas versões automaticamente. Se isso não for possível, **sua** versão é salva com segurança como um arquivo `.CONFLICT` ao lado do original — nada nunca se perde. Arquivos de conflito são marcados na árvore de arquivos; clique com o botão direito para escolher **Manter esta versão** (a versão de conflito substitui o original) ou **Descartar conflito**.

Para resolver, **Comparar versões** (clique direito no arquivo de conflito, o aviso na nota ou o diálogo de erro de sincronização) mostra as duas versões lado a lado — a nota à esquerda, a cópia à direita — com as saídas **adotar**, **manter ambas**, **descartar cópia** e **depois**; no desktop o lado direito também pode ser mesclado linha a linha. Toda saída que descarta algo pergunta antes.

### Meu login do Google fica expirando

Com a configuração "Bring Your Own", seu projeto do Google permanece no modo de teste; o Google então encerra a sessão após 7 dias. O Plainva renova os tokens automaticamente em segundo plano, mas, uma vez expirado, use **Reconectar** nas configurações de sincronização. Detalhes: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

### Meu vault fica em uma pasta do OneDrive/Dropbox/iCloud e o Plainva se comporta de forma estranha

Defina a pasta do vault como "sempre manter neste dispositivo" / "disponível offline" no cliente de sincronização do provedor. Arquivos de espaço reservado somente online (Files On-Demand, "online-only") interferem na indexação e na sincronização. Detalhes: [Compatibilidade de Sincronização](Sync_Compatibility.md).

### Estou offline — o que acontece com minhas alterações?

Elas são salvas localmente como de costume e reunidas em uma fila; assim que a conexão volta, o Plainva as transfere automaticamente. A barra de status mostra **Online**/**Offline**.

### A barra de status mostra Offline mesmo eu tendo internet

Nesse caso, a própria conexão de sincronização está com problema — geralmente porque o login expirou ou as credenciais mudaram (por exemplo, no Google Drive). Clique em **Offline** na barra de status ou no triângulo de aviso ao lado do nome do vault: o diálogo mostra a mensagem de erro exata, e **Abrir configurações de sincronização** leva você direto ao formulário do provedor correspondente, onde você reconecta (por exemplo, **Reconectar**). Cada clique também dispara imediatamente uma nova tentativa de sincronização.

### Por que o provedor X está faltando (Proton, Tuta, iCloud Drive …)?

O Plainva conecta qualquer provedor que ofereça uma interface aberta (IMAP, CalDAV, WebDAV, S3 ou uma API documentada). Alguns serviços simplesmente não oferecem acesso para outros apps — isso não é uma escolha do Plainva: o **Proton Mail** é criptografado de ponta a ponta e só fala IMAP através do Proton Mail Bridge local pago (existe uma predefinição para isso); o Proton Calendar e o Proton Drive não têm interface utilizável. O **Tuta** deliberadamente não oferece nem IMAP nem CalDAV. O **iCloud Drive** não tem interface para apps de terceiros (o **Mail** e o **Calendário** do iCloud, por outro lado, funcionam através do bloco da Apple). O **Baidu Netdisk/TeraBox** e o **NAVER MYBOX** fecharam ou desativaram suas interfaces para desenvolvedores independentes. Se estiver faltando um provedor com interface aberta, conte para a gente no GitHub.

## App

### O que o F5 faz, e onde está o menu de contexto do navegador?

O Plainva é um aplicativo de desktop, não uma página web. Por isso o `F5` (e o Ctrl+R) não recarrega a janela — isso descartaria suas abas abertas e as edições não salvas. Em vez disso, a tecla **relê o vault**: o Plainva concilia o índice com a pasta e, em vaults on-line, também busca os arquivos da nuvem. O menu de contexto embutido da WebView continua oculto; clicar com o botão direito sobre um texto selecionado ainda oferece **Copiar**, e a árvore de arquivos, as abas e as tabelas mantêm seus próprios menus de contexto.

### Por que não vejo imediatamente arquivos criados externamente?

Normalmente o Plainva percebe sozinho quando outro programa altera algo na pasta do seu vault. Quando isso falha — por exemplo em unidades de rede, em pastas na nuvem, ou quando o arquivo veio de outro computador — use **Reler o vault**:

* `F5`, ou a seta circular no cabeçalho da árvore de arquivos,
* **Reler esta pasta** no menu de contexto de uma pasta (mais rápido em vaults muito grandes),
* o comando **Reler o vault** na paleta de comandos (`Ctrl/Cmd+P`).

O Plainva então mostra um breve relatório: quantos arquivos eram novos, alterados ou removidos — e **quais entradas foram ignoradas**. Uma pasta ignorada é o motivo mais comum de um arquivo nunca "chegar": o Plainva não conseguiu lê-la (permissões ausentes, unidade de rede desconectada) ou ela aponta em círculo para si mesma. Em vaults on-line, o relatório também informa que uma sincronização completa com a nuvem foi solicitada.

Além disso, o Plainva concilia automaticamente sempre que você volta para a janela vindo de outro programa (no máximo a cada 30 segundos; a nuvem no máximo a cada 5 minutos). Se um arquivo continuar invisível mesmo assim, use **Reconstruir o índice do zero** em Configurações → Vault → Manutenção.

### Por que não vejo nenhuma animação?

O Plainva respeita a configuração "reduzir movimento" do seu sistema. Se as transições e os efeitos estiverem ausentes (botões, menus e destaques não se movem), as animações estão desativadas no seu sistema operacional. No **Windows**: Configurações → Acessibilidade → Efeitos visuais → ative **Efeitos de animação**. No **macOS**: Ajustes do Sistema → Acessibilidade → Tela → desative **Reduzir Movimento**.

### Como mudo o idioma?

**Configurações → App → Aparência → Idioma** (atualmente alemão e inglês).

### "Verificar atualizações" não encontra nada

Enquanto ainda não houver versões públicas (releases), a verificação de atualização informa: "Ainda não há atualizações públicas (releases) disponíveis." Isso não é um erro.

### Existem recursos ocultos?

A Frota Estelar não comenta rumores. Mas dizem que o logotipo na barra de título reage a batidas persistentes — e quem então souber as palavras certas verá o Plainva sob uma luz totalmente nova depois disso. Alguns dizem: em quatro delas.

## Veja também

- [Configurar Sincronização](Sync_Setup.md) e [Compatibilidade de Sincronização](Sync_Compatibility.md)
- [OKF](OKF.md) — conversão, index.md, campos de sistema
