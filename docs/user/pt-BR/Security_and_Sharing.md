# Segurança e compartilhamento

## Central de segurança, recifragem e slices publicados

O painel segue os mockups com cartões de recuperação, dispositivos e equipe; uma ação abre o vault, conexão, configuração ou desbloqueio necessário. A revogação pode iniciar recifragem completa retomável. Crie um Vault Slice por **Detalhes → Conteúdo → Permissões → Revisão**. Publicações externas ficam num workspace criptografado separado; a projeção higienizada remove propriedades privadas, links excluídos e incorporações. A liberação pública exige revisão criptográfica independente e testes reais Android/iOS.

Última revisão: 2026-07-22

Plainva mantém o vault como arquivos legíveis no dispositivo e armazena a cópia na nuvem como objetos criptografados opacos. Depois de conectar uma conta, abra **Configurações → vault → Segurança e compartilhamento**.

## Configuração

1. Escolha nomes de proprietário e dispositivo. As chaves ficam no chaveiro do sistema ou, se indisponível, sob uma frase secreta local.
2. Salve o arquivo `.pvrecovery` e guarde separadamente o código exibido. Cada bloco tem um número de grupo visível; digite os valores dos dois grupos destacados para confirmar que o backup está legível. As duas partes são necessárias e não contêm credenciais da nuvem.
3. Ative o workspace. Plainva publica a política assinada e criptografa todos os arquivos em `.pvws/`. O vault local continua legível e a migração retoma após interrupções.

O texto simples antigo permanece ao lado de `.pvws/` durante a migração. Só no estado **Protegido** ele pode ser removido explicitamente; arquivos locais nunca são removidos.

Alterações offline ficam em uma fila durável. Exclusões exigem tombstones assinados e alterações paralelas são preservadas como cópias `.CONFLICT-…`.

## Dispositivos e recuperação

Um novo dispositivo móvel cria uma solicitação QR/código. Digite o código curto em um desktop já aprovado e compare as impressões digitais antes de confirmar. Um dispositivo removido não pode assinar novas alterações. Se todos forem perdidos, **Restaurar acesso** cria um novo dispositivo proprietário usando o arquivo `.pvrecovery` e seu código separado, sem reescrever conteúdo. **Renovar recuperação** ancora uma nova identidade com assinatura dupla e invalida o conjunto antigo.

## Membros, funções e slices

Proprietários e administradores podem convidar membros, criar grupos e limitar uma função ao workspace inteiro, a um slice ou a um objeto. Editor edita, Commenter comenta, Reader apenas lê e Contributor apenas cria no escopo atribuído. A verificação ocorre antes da gravação local e novamente antes da assinatura, incluindo importações, restaurações, automações e ações de IA.

Um slice contém uma pasta, uma seleção ou uma regra dinâmica por caminho, tipo, tags e propriedades. Sempre use **Prévia** antes de publicar. Objetos não autorizados não são materializados nem entram em pesquisa, grafo ou prévias.

## Comentários, versões e quarentena

Comentários e marcadores de resolução são criptografados e assinados. **Histórico de versões** lê revisões criptografadas e restaura uma versão como nova alteração assinada ou cópia. Um artefato remoto inválido é isolado em **Integridade e forks locais**: tente novamente, exporte o ciphertext, marque como reparado ou ignore. Ele não bloqueia o restante da sincronização e ausência remota nunca significa exclusão.

## Remover corretamente um vault cifrado

Quando você não precisar mais de um vault cifrado, desative-o no Plainva **antes** de excluir a pasta na nuvem. A ordem importa: a proteção fail-closed mantém a sincronização parada se a cópia na nuvem desaparecer enquanto o Plainva ainda espera que a conexão esteja cifrada — isso protege você de um invasor que remova a cifragem para forçar texto simples.

1. Abra **Configurações → vault → Security & Sharing**.
2. No cartão de recuperação, escolha **Desativar o espaço de trabalho**. O Plainva apaga as chaves locais e os dados do workspace neste dispositivo e reabre o vault como um vault normal.
3. Só então exclua a pasta na nuvem (os objetos `.pvws/`) no seu provedor, se quiser se livrar dela. O Plainva não exclui por você os objetos cifrados da nuvem.

Se você já excluiu a cópia na nuvem e a sincronização agora falha com um erro "workspace ausente" ou "manifesto ausente", a correção é o mesmo redefinir, oferecido onde o erro aparece:

- Para um **workspace** cifrado, abra **Security & Sharing**. O status mostra um erro com uma nota de recuperação; escolha **Desativar o espaço de trabalho** para redefinir o workspace neste dispositivo e a sincronização voltar a funcionar.
- Para uma **conexão de sincronização** com conteúdo cifrado, clique no status de sincronização para abrir a caixa de diálogo de erro e escolha **Redefinir criptografia**. Esse botão só aparece quando os dados de criptografia remotos estão ausentes ou inválidos.

Ambas as ações são explícitas e confirmadas. O Plainva nunca rebaixa silenciosamente uma conexão cifrada para texto simples, e nenhuma das ações exclui arquivos locais. Se a nuvem ainda contiver conteúdo cifrado que você realmente quer, cancele em vez disso — redefinir retomaria a sincronização em texto simples.

Remover um vault com **Esquecer os dados do aplicativo** (Splash → remover um vault → esquecer também os dados do aplicativo) também limpa esses marcadores de criptografia, de modo que um vault removido assim não deixa nada que possa bloquear uma reconexão posterior.
