# FAQ e Solução de Problemas

Última revisão: 2026-09-30

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

### Uma nota sumiu depois de movê-la ou renomeá-la

Com a sincronização por WebDAV ou S3, o Plainva 0.8.3 removia uma nota sincronizada que você movia ou renomeava dentro do aplicativo: o primeiro ciclo de sincronização seguinte interpretava a nota no novo local como excluída no servidor e a removia aqui — um instante antes de enviar a movimentação. Com Google Drive, Dropbox e OneDrive isso acontecia só de vez em quando. No 0.8.3, o ciclo seguinte também excluía a nota no servidor. O Plainva 0.8.4 corrige isso no desktop e no celular.

**Atualize todos os dispositivos que trabalham com o mesmo vault.** Um dispositivo que ainda está no 0.8.3 continua excluindo notas sincronizadas que são movidas ou renomeadas nele e replica exclusões sem perguntar.

Se aconteceu com você, a nota ainda existe em até três lugares:

- **O snapshot dentro do vault.** Antes de remover um arquivo, o Plainva o salva como `.plainva/backups/<pasta>/<nome>.md.<carimbo de data/hora>.bak`, onde `<pasta>` é a pasta *para onde* você moveu a nota. No desktop, clique com o botão direito no nome do vault → **Restaurar arquivos excluídos…**; no celular, **Configurações** → **Manutenção** → **Restaurar arquivos excluídos**. A lista mostra a nota com o novo caminho, e **Restaurar** a coloca de volta lá. O arquivo `.bak` é texto simples, então qualquer gerenciador de arquivos ou editor de texto também consegue abri-lo.
- **A lixeira do sistema** (desktop): o próprio arquivo foi para a lixeira do seu sistema operacional.
- **A lixeira do seu servidor**, se a nota também foi excluída lá (no Nextcloud, por exemplo, nos arquivos excluídos).

Se você moveu ou renomeou outras notas sincronizadas com o 0.8.3, vale a pena procurá-las nesses mesmos lugares.

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

### Movi um arquivo para fora do Plainva

O Plainva o acompanha. A árvore de arquivos mostra o arquivo no novo lugar, mesmo que você o tenha movido no Finder, no Explorador ou em outro programa. Se a nota estiver aberta — ou se você a abrir no lugar antigo, por exemplo a partir de um favorito —, o Plainva a procura: quando exatamente um arquivo em outro lugar tem o mesmo conteúdo e a mesma data de modificação, a aba o acompanha, uma mensagem curta indica a nova pasta, e favoritos, lugares no mural e comentários da nota mudam junto. As alterações não salvas vão junto para o novo lugar. Se não for inequívoco, por exemplo porque o mesmo conteúdo existe em vários lugares, **Movido?** pergunta qual é, e você escolhe o arquivo certo. Se o Plainva não encontrar nenhum, a aba continua em **Este arquivo não existe mais**, e o Plainva remove sozinho a entrada desatualizada do índice. Se você tinha alterações não salvas, elas ficam guardadas, e **Salvar aqui de novo** recria o arquivo no lugar antigo — o Plainva nunca grava ali por conta própria. Enquanto a busca ainda percorre o vault inteiro, **Ainda procurando em outros lugares do vault…** avisa.

O mesmo vale para uma aba aberta com um banco de dados (`.base`) ou uma imagem, e no telefone para as telas de banco de dados e de imagem: elas acompanham o arquivo movido, perguntam **Movido?** ou mostram **Este arquivo não existe mais**. Uma alteração em um banco de dados cujo arquivo faltava naquele momento vai junto para o novo lugar; se o Plainva não encontrar o arquivo, a alteração fica guardada até você escolher **Salvar aqui de novo**. Edições inacabadas de uma imagem vão junto para a aba no novo lugar e só são gravadas quando você escolhe **Salvar**. PDFs e outros arquivos que o Plainva entrega ao aplicativo do sistema não têm aba.

No celular, nada observa a pasta enquanto você trabalha. Em vez disso, o Plainva lê o vault de novo sempre que você **volta ao app** (no máximo uma vez por minuto) e sempre que você **puxa uma lista para baixo** — para todo vault, inclusive o que fica dentro do app e que o app Arquivos mostra no iOS. Ali uma nota movida acompanha o arquivo da mesma forma, inclusive uma aberta; se o Plainva não a encontrar, aparece **Esta nota não foi encontrada.**

O Plainva ignora arquivos do sistema: `.DS_Store`, `Thumbs.db`, `desktop.ini`, `Icon` (ícones de pasta), `.Spotlight-V100`, `.Trashes`, `.fseventsd` e os arquivos AppleDouble que o macOS coloca ao lado de cada arquivo em unidades de rede e pendrives (`._Nota.md`). Eles não aparecem na árvore de arquivos e não são enviados nem baixados. Uma cópia que uma versão anterior já enviou continua intacta na nuvem. Uma nota sua cujo nome apenas começa com `._` continua visível — o Plainva reconhece arquivos AppleDouble pelo conteúdo, não pelo nome.

### Por que não vejo nenhuma animação?

O Plainva respeita a configuração "reduzir movimento" do seu sistema. Se as transições e os efeitos estiverem ausentes (botões, menus e destaques não se movem), as animações estão desativadas no seu sistema operacional. No **Windows**: Configurações → Acessibilidade → Efeitos visuais → ative **Efeitos de animação**. No **macOS**: Ajustes do Sistema → Acessibilidade → Tela → desative **Reduzir Movimento**.

### Como mudo o idioma?

**Configurações → App → Aparência → Idioma**; no celular, **Configurações → Aparência → Idioma**. O Plainva fala dez idiomas: inglês, alemão, espanhol, francês, italiano, japonês, holandês, polonês, português (Brasil) e chinês simplificado.

### "Verificar atualizações" não encontra nada

Enquanto ainda não houver versões públicas (releases), a verificação de atualização informa: "Ainda não há atualizações públicas (releases) disponíveis." Isso não é um erro.

### Existem recursos ocultos?

A Frota Estelar não comenta rumores. Mas dizem que o logotipo na barra de título reage a batidas persistentes — e quem então souber as palavras certas verá o Plainva sob uma luz totalmente nova depois disso. Alguns dizem: em quatro delas.

## Veja também

- [Configurar Sincronização](Sync_Setup.md) e [Compatibilidade de Sincronização](Sync_Compatibility.md)
- [OKF](OKF.md) — conversão, index.md, campos de sistema
