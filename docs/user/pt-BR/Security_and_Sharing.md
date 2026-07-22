# Segurança e compartilhamento

Última revisão: 2026-07-22

Plainva mantém o vault como arquivos legíveis no dispositivo e armazena a cópia na nuvem como objetos criptografados opacos. Depois de conectar uma conta, abra **Configurações → vault → Segurança e compartilhamento**.

## Configuração

1. Escolha nomes de proprietário e dispositivo. As chaves ficam no chaveiro do sistema ou, se indisponível, sob uma frase secreta local.
2. Salve o arquivo `.pvrecovery`, guarde o código separadamente e informe os dois grupos solicitados. As duas partes são necessárias e não contêm credenciais da nuvem.
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
