# Segurança e compartilhamento

Última revisão: 2026-07-22

Plainva mantém o vault como arquivos legíveis no dispositivo e armazena a cópia na nuvem como objetos criptografados opacos. Depois de conectar uma conta, abra **Configurações → vault → Segurança e compartilhamento**.

## Configuração

1. Escolha nomes de proprietário e dispositivo. As chaves ficam no chaveiro do sistema ou, se indisponível, sob uma frase secreta local.
2. Salve o arquivo `.pvrecovery`, guarde o código separadamente e informe os dois grupos solicitados. As duas partes são necessárias e não contêm credenciais da nuvem.
3. Ative o workspace. Plainva publica a política assinada e criptografa todos os arquivos em `.pvws/`. O vault local continua legível e a migração retoma após interrupções.

O texto simples antigo permanece ao lado de `.pvws/` durante a migração. Só no estado **Protegido** ele pode ser removido explicitamente; arquivos locais nunca são removidos.

Alterações offline ficam em uma fila durável. Exclusões exigem tombstones assinados e alterações paralelas são preservadas como cópias `.CONFLICT-…`. Outros dispositivos, restauração, equipes e slices chegam depois.
