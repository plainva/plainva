# Segurança e compartilhamento

> **Experimental — ainda sem revisão independente.** Workspaces criptografados são lançados como uma prévia. O design ainda não passou por uma revisão criptográfica independente, e evidências de dois dispositivos em hardware Android e iOS reais ainda estão sendo coletadas. Experimente, mas mantenha um backup de tudo que você não pode perder, e não confie nele para material que você precisa proteger.

## Central de segurança, recifragem e slices publicados

**Segurança e compartilhamento** tem dois níveis. A **Visão geral** (primeiro nível) mostra o status de proteção, **Concluir migração** quando restam sobras de texto simples, **Remover a conexão com a nuvem criptografada** e dois cartões que abrem o segundo nível — **Dispositivos e recuperação** e **Compartilhar com outros**. No segundo nível, a navegação por áreas substitui a coluna esquerda de configurações, agrupada em **Seu acesso** (Dispositivos, recuperação) e **Compartilhamento** (Membros, grupos, slices, publicações); **‹ Visão geral** volta ao primeiro nível. As ações visíveis continuam disponíveis: uma ação abre o vault, conexão, configuração ou desbloqueio necessário. A revogação pode iniciar recifragem completa retomável. Crie um Vault Slice por **Detalhes → Conteúdo → Permissões → Revisão**. Publicações externas ficam num workspace criptografado separado; a projeção higienizada remove propriedades privadas, links excluídos e incorporações. A liberação pública exige revisão criptográfica independente e testes reais Android/iOS.

Crie um Vault Slice com as quatro etapas **Detalhes → Conteúdo → Permissões → Revisão**. Publicações externas usam um namespace de workspace criptografado separado. Projeções higienizadas removem propriedades privadas do frontmatter, neutralizam links para notas excluídas e omitem incorporações excluídas. As permissões do Google Drive, OneDrive, Nextcloud, Dropbox, WebDAV e S3 são proteção adicional, nunca um substituto para funções criptografadas. A liberação pública continua bloqueada até que a revisão criptográfica independente e evidências reais de dois dispositivos em Android/iOS sejam registradas.

Última revisão: 2026-08-20

Plainva mantém o vault como arquivos legíveis no dispositivo e armazena a cópia na nuvem como objetos criptografados opacos. Depois de conectar uma conta, abra **Configurações → vault → Segurança e compartilhamento**.

No celular, a área informa primeiro o estado real deste vault: **Somente neste dispositivo** sem conexão de nuvem, **Esta conexão não é criptografada** em um vault de nuvem comum — **Configurar a criptografia** executa ali as mesmas três etapas do computador (identidade → arquivo de recuperação e código → ativação com progresso retomável) — ou as etapas de entrada assim que a conexão tiver um espaço de trabalho criptografado.

## Configuração

1. Escolha nomes de proprietário e dispositivo. As chaves ficam no chaveiro do sistema ou, se indisponível, sob uma frase secreta local.
2. Salve o arquivo `.pvrecovery` e guarde separadamente o código exibido. Cada bloco tem um número de grupo visível; digite os valores dos dois grupos destacados para confirmar que o backup está legível. As duas partes são necessárias e não contêm credenciais da nuvem.
3. Ative o workspace. Plainva publica a política assinada e criptografa todos os arquivos em `.pvws/`. O vault local continua legível e a migração retoma após interrupções.

O texto simples antigo permanece ao lado de `.pvws/` durante a migração. Só no estado **Protegido** ele pode ser removido explicitamente; arquivos locais nunca são removidos.

## No dia a dia

As alterações feitas offline permanecem em uma fila durável. Toda alteração é assinada; uma exclusão remota sozinha nunca apaga um arquivo local, mas uma lápide assinada pode. Edições paralelas offline são preservadas como cópias `.CONFLICT-…`. **Bloquear** remove as chaves do workspace da sessão atual; **Desbloquear** usa o chaveiro do sistema ou a frase secreta local.

## Dispositivos e recuperação

Para adicionar **o seu próprio** segundo dispositivo, abra **Dispositivos e recuperação → Dispositivos → Adicionar outro dispositivo**: o Plainva mostra um código de convite vinculado à sua própria participação — ele **não** cria um novo membro. Cole-o no segundo dispositivo (**Segurança e compartilhamento → entrar**) e aprove-o em um dispositivo que já participa; compare primeiro a impressão digital nos dois dispositivos. Para incluir outra pessoa, use **Compartilhar com outros → Membros → Convidar uma pessoa** (veja abaixo). Um dispositivo removido não pode assinar novas alterações válidas. O convite e a solicitação de emparelhamento de um dispositivo que entra também são mostrados como códigos QR escaneáveis — no celular, **Escanear convite** lê um código com a câmera em vez de colar texto.

Remover um dispositivo ou um membro tem dois custos possíveis, e o celular também oferece os dois. **Somente daqui em diante** encerra o acesso a novas chaves imediatamente e é rápido. **Recriptografar tudo** também reescreve tudo o que já está criptografado; é um trabalho longo, continua em segundo plano e retoma sozinho após reiniciar — o cartão de status conta os objetos enquanto roda. Nenhuma das duas opções consegue recuperar o que o outro lado já baixou, por isso a pergunta avisa disso antes de você escolher. Você nunca pode remover o dispositivo que está segurando: isso deixaria este dispositivo trancado para fora, com apenas o pacote de recuperação restando.

A recuperação fica em **Dispositivos e recuperação → Recuperação**, dividida em **Status atual** (se há um pacote de recuperação salvo, e a impressão digital do workspace) e o **Fluxo de recuperação**. Se todos os dispositivos forem perdidos, escolha ali **Restaurar acesso** e abra o arquivo `.pvrecovery` com seu código guardado separadamente; o Plainva cria um novo dispositivo proprietário, pode revogar os dispositivos perdidos e não reescreve os objetos de conteúdo. **Renovar recuperação** substitui o conjunto de recuperação antigo por meio de uma cadeia de ancoragem com assinatura dupla. Guarde novamente o novo arquivo e o código separadamente; o conjunto antigo fica inválido depois. O Plainva pergunta antes, porque o arquivo que você tem em mãos deixa de funcionar nesse momento.

## Membros, funções e slices

Proprietários e administradores podem convidar membros, criar grupos e limitar uma função ao workspace inteiro, a um slice ou a um objeto. Editor edita, Commenter comenta, Reader apenas lê e Contributor apenas cria no escopo atribuído. A verificação ocorre antes da gravação local e novamente antes da assinatura, incluindo importações, restaurações, automações e ações de IA.

A propriedade pode passar para outro membro ativo. Abra **Compartilhar com outros → Membros** (no celular: a área **Team**) e escolha **Transferir a propriedade** ao lado dessa pessoa. É preciso o arquivo de recuperação atual e seu código, porque propriedade e conjunto de recuperação se movem juntos: o Plainva cria primeiro um pacote de recuperação substituto e só o entrega depois que você o salvar. Entregue esse arquivo e o novo código ao novo proprietário por canais separados — você se torna Admin, e essa pessoa passa a ser a única Owner.

Um slice contém uma pasta, uma seleção ou uma regra dinâmica por caminho, tipo, tags e propriedades. Sempre use **Prévia** antes de publicar. Objetos não autorizados não são materializados nem entram em pesquisa, grafo ou prévias.

## Comentários, versões e quarentena

Commenter recebe um editor somente leitura com uma área de comentários. Os comentários e os marcadores de resolução são, eles mesmos, objetos criptografados e assinados do workspace. **Histórico de versões** lê revisões criptografadas do workspace e restaura uma revisão anterior como uma nova alteração assinada ou como uma cópia.

Artefatos remotos inválidos são isolados individualmente em **Integridade e forks locais**. Você pode tentar novamente, exportar o ciphertext, marcar como reparado um artefato reparado externamente, ou ignorá-lo deliberadamente. Um arquivo inválido não bloqueia o restante de uma sincronização válida, e a mera ausência remota nunca significa exclusão. Uma alteração de um programa local sem permissão de escrita é mantida como uma cópia privada de fork.

## Remover corretamente um vault cifrado

Quando você não precisar mais de um vault cifrado, desative-o no Plainva **antes** de excluir a pasta na nuvem. A ordem importa: a proteção fail-closed mantém a sincronização parada se a cópia na nuvem desaparecer enquanto o Plainva ainda espera que a conexão esteja cifrada — isso protege você de um invasor que remova a cifragem para forçar texto simples.

1. Abra **Configurações → vault → Security & Sharing**.
2. Na visão geral, no cartão **Criptografia**, escolha **Remover a conexão com a nuvem criptografada**. O Plainva apaga as chaves locais e os dados do workspace neste dispositivo e reabre o vault como um vault normal. (Isto é local do dispositivo: a cópia na nuvem continua criptografada. Para tê-la de volta como texto simples, o caminho é **Anular a criptografia** — veja o parágrafo abaixo.)
3. Só então exclua a pasta na nuvem (os objetos `.pvws/`) no seu provedor, se quiser se livrar dela. O Plainva não exclui por você os objetos cifrados da nuvem.

No celular, a mesma etapa fica no mesmo lugar, com uma diferença: você a confirma digitando o nome do vault. Tudo o mais é idêntico — as chaves locais e os dados do workspace desaparecem, o vault reabre como um vault normal, e os objetos criptografados na nuvem permanecem até você mesmo excluí-los. Funciona sem conexão, porque nada nisso é remoto.

Para, em vez disso, **encerrar a criptografia por completo e manter o vault na nuvem como arquivos comuns**, escolha **Remover a criptografia** no mesmo cartão **Criptografia**: o Plainva reabre o vault como um vault de nuvem normal e reenvia todas as suas notas para a mesma nuvem como arquivos de texto simples e, então, para de criptografar. Os arquivos locais nunca são alterados e nada é excluído; a antiga pasta criptografada `.pvws/` permanece até você excluí-la no seu provedor (o Plainva não pode remover por você esses objetos imutáveis). Confirme primeiro o aviso de perigo — as notas saem do armazenamento criptografado como texto simples.

Se você já excluiu a cópia na nuvem e a sincronização agora falha com um erro "workspace ausente" ou "manifesto ausente", a correção é o mesmo redefinir, oferecido onde o erro aparece:

- Para um **workspace** cifrado, abra **Security & Sharing**. O status mostra um erro com uma nota de recuperação; no cartão **Criptografia** escolha **Remover a conexão com a nuvem criptografada** para redefinir o workspace neste dispositivo e a sincronização voltar a funcionar.
- Para uma **conexão de sincronização** com conteúdo cifrado, clique no status de sincronização para abrir a caixa de diálogo de erro e escolha **Redefinir criptografia**. Esse botão só aparece quando os dados de criptografia remotos estão ausentes ou inválidos.

Ambas as ações são explícitas e confirmadas. O Plainva nunca rebaixa silenciosamente uma conexão cifrada para texto simples, e nenhuma das ações exclui arquivos locais. Se a nuvem ainda contiver conteúdo cifrado que você realmente quer, cancele em vez disso — redefinir retomaria a sincronização em texto simples.

Remover um vault com **Esquecer os dados do aplicativo** (Splash → remover um vault → esquecer também os dados do aplicativo) também limpa esses marcadores de criptografia, de modo que um vault removido assim não deixa nada que possa bloquear uma reconexão posterior.
