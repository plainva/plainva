# Segurança e compartilhamento

## Central de segurança, recifragem e slices publicados

**Segurança e compartilhamento** tem dois níveis. A **Visão geral** (primeiro nível) mostra o status de proteção, **Concluir migração** quando restam sobras de texto simples, **Remover a conexão com a nuvem criptografada** e dois cartões que abrem o segundo nível — **Dispositivos e recuperação** e **Compartilhar com outros**. No segundo nível, a navegação por áreas substitui a coluna esquerda de configurações, agrupada em **Seu acesso** (Dispositivos, recuperação) e **Compartilhamento** (Membros, grupos, slices, publicações); **‹ Visão geral** volta ao primeiro nível. As ações visíveis continuam disponíveis: uma ação abre o vault, conexão, configuração ou desbloqueio necessário. A revogação pode iniciar recifragem completa retomável. Crie um Vault Slice por **Detalhes → Conteúdo → Permissões → Revisão**. Publicações externas ficam num workspace criptografado separado; a projeção higienizada remove propriedades privadas, links excluídos e incorporações. A liberação pública exige revisão criptográfica independente e testes reais Android/iOS.

Última revisão: 2026-07-23

Plainva mantém o vault como arquivos legíveis no dispositivo e armazena a cópia na nuvem como objetos criptografados opacos. Depois de conectar uma conta, abra **Configurações → vault → Segurança e compartilhamento**.

## Configuração

1. Escolha nomes de proprietário e dispositivo. As chaves ficam no chaveiro do sistema ou, se indisponível, sob uma frase secreta local.
2. Salve o arquivo `.pvrecovery` e guarde separadamente o código exibido. Cada bloco tem um número de grupo visível; digite os valores dos dois grupos destacados para confirmar que o backup está legível. As duas partes são necessárias e não contêm credenciais da nuvem.
3. Ative o workspace. Plainva publica a política assinada e criptografa todos os arquivos em `.pvws/`. O vault local continua legível e a migração retoma após interrupções.

O texto simples antigo permanece ao lado de `.pvws/` durante a migração. Só no estado **Protegido** ele pode ser removido explicitamente; arquivos locais nunca são removidos.

Alterações offline ficam em uma fila durável. Exclusões exigem tombstones assinados e alterações paralelas são preservadas como cópias `.CONFLICT-…`.

## Dispositivos e recuperação

Para adicionar **o seu próprio** segundo dispositivo, abra **Dispositivos e recuperação → Dispositivos → Adicionar outro dispositivo**: o Plainva mostra um código de convite vinculado à sua própria participação — ele **não** cria um novo membro. Cole-o no segundo dispositivo (**Segurança e compartilhamento → entrar**) e aprove-o em um dispositivo que já participa; compare primeiro a impressão digital nos dois dispositivos. Para incluir outra pessoa, use **Compartilhar com outros → Membros → Convidar uma pessoa** (veja abaixo). Um dispositivo removido não pode assinar novas alterações válidas.

A recuperação fica em **Dispositivos e recuperação → Recuperação**, dividida em **Status atual** (se há um pacote de recuperação salvo, e a impressão digital do workspace) e o **Fluxo de recuperação**. Se todos os dispositivos forem perdidos, escolha ali **Restaurar acesso** e abra o arquivo `.pvrecovery` com seu código guardado separadamente; o Plainva cria um novo dispositivo proprietário, pode revogar os dispositivos perdidos e não reescreve os objetos de conteúdo. **Renovar recuperação** substitui o conjunto de recuperação antigo por meio de uma cadeia de ancoragem com assinatura dupla. Guarde novamente o novo arquivo e o código separadamente; o conjunto antigo fica inválido depois.

## Membros, funções e slices

Proprietários e administradores podem convidar membros, criar grupos e limitar uma função ao workspace inteiro, a um slice ou a um objeto. Editor edita, Commenter comenta, Reader apenas lê e Contributor apenas cria no escopo atribuído. A verificação ocorre antes da gravação local e novamente antes da assinatura, incluindo importações, restaurações, automações e ações de IA.

Um slice contém uma pasta, uma seleção ou uma regra dinâmica por caminho, tipo, tags e propriedades. Sempre use **Prévia** antes de publicar. Objetos não autorizados não são materializados nem entram em pesquisa, grafo ou prévias.

## Comentários, versões e quarentena

Comentários e marcadores de resolução são criptografados e assinados. **Histórico de versões** lê revisões criptografadas e restaura uma versão como nova alteração assinada ou cópia. Um artefato remoto inválido é isolado em **Integridade e forks locais**: tente novamente, exporte o ciphertext, marque como reparado ou ignore. Ele não bloqueia o restante da sincronização e ausência remota nunca significa exclusão.

## Remover corretamente um vault cifrado

Quando você não precisar mais de um vault cifrado, desative-o no Plainva **antes** de excluir a pasta na nuvem. A ordem importa: a proteção fail-closed mantém a sincronização parada se a cópia na nuvem desaparecer enquanto o Plainva ainda espera que a conexão esteja cifrada — isso protege você de um invasor que remova a cifragem para forçar texto simples.

1. Abra **Configurações → vault → Security & Sharing**.
2. Na visão geral, no cartão **Criptografia**, escolha **Remover a conexão com a nuvem criptografada**. O Plainva apaga as chaves locais e os dados do workspace neste dispositivo e reabre o vault como um vault normal. (Isto é local do dispositivo; uma ação global de "anular a criptografia" que também reescreve a cópia na nuvem de volta para texto simples é uma ação separada adicionada depois.)
3. Só então exclua a pasta na nuvem (os objetos `.pvws/`) no seu provedor, se quiser se livrar dela. O Plainva não exclui por você os objetos cifrados da nuvem.

Se você já excluiu a cópia na nuvem e a sincronização agora falha com um erro "workspace ausente" ou "manifesto ausente", a correção é o mesmo redefinir, oferecido onde o erro aparece:

- Para um **workspace** cifrado, abra **Security & Sharing**. O status mostra um erro com uma nota de recuperação; no cartão **Criptografia** escolha **Remover a conexão com a nuvem criptografada** para redefinir o workspace neste dispositivo e a sincronização voltar a funcionar.
- Para uma **conexão de sincronização** com conteúdo cifrado, clique no status de sincronização para abrir a caixa de diálogo de erro e escolha **Redefinir criptografia**. Esse botão só aparece quando os dados de criptografia remotos estão ausentes ou inválidos.

Ambas as ações são explícitas e confirmadas. O Plainva nunca rebaixa silenciosamente uma conexão cifrada para texto simples, e nenhuma das ações exclui arquivos locais. Se a nuvem ainda contiver conteúdo cifrado que você realmente quer, cancele em vez disso — redefinir retomaria a sincronização em texto simples.

Remover um vault com **Esquecer os dados do aplicativo** (Splash → remover um vault → esquecer também os dados do aplicativo) também limpa esses marcadores de criptografia, de modo que um vault removido assim não deixa nada que possa bloquear uma reconexão posterior.
