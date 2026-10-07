# Conectar apps de IA (Beta)

Última revisão: 2026-10-07

Apps de IA no seu computador — Claude Code, Claude Desktop, Cursor, VS Code e outros que falam o Model Context Protocol (MCP) — podem ler o seu vault pelo Plainva: pesquisar nele, ler notas e suas seções, estruturas, backlinks, bancos de dados, tarefas e notas recentes, e abrir uma nota no Plainva. Sozinhos eles não mudam nada: um app a que você permitir pode sugerir alterações, e elas esperam até você decidir (veja abaixo). Isso faz parte das funções experimentais de IA e funciona só no desktop.

O sentido contrário — o assistente do Plainva usando ferramentas de servidores que você mesmo conecta — está descrito em **Ferramentas externas (MCP)** na página [Assistente de IA](AI_Assistant.md).

Um terceiro caminho — o Plainva inicia um agente de IA de outro fabricante na pasta do vault, com a sessão dele na aba de IA — está descrito em [Agentes externos](External_Agents.md).

## Como funciona

O Plainva traz ao lado do app um pequeno programa auxiliar, `plainva-mcp`. Um app de IA o inicia, e o programa auxiliar se conecta ao Plainva em execução por um canal privado deste computador — um named pipe no Windows, um socket numa pasta privada no macOS e no Linux. Nenhuma porta de rede é aberta. O Plainva precisa estar rodando com o vault aberto; caso contrário, o app recebe uma mensagem clara.

## Ativar

1. Abra **Configurações → IA e automação** e ative **Usar IA neste dispositivo**.
2. Ative **Deixar apps de IA deste computador lerem este vault**.
3. Configure o app (veja abaixo). Na primeira conexão, o Plainva pergunta qual app é, qual programa o iniciou e quais pastas ele pode ler. Nada vem marcado: escolha pastas ou **O vault inteiro** e depois **Permitir**. **Recusar** afasta o app, e o Plainva não pergunta por ele de novo durante dez minutos. Abaixo das pastas fica **Pode sugerir alterações** — desativado enquanto você não marcar; o que isso permite está descrito mais abaixo.

O app guarda um segredo no chaveiro do sistema para a próxima vez. As pastas valem por app e por vault: em outro vault, o app pergunta de novo.

## Configurar um app

- **Claude Code:** copie o **Comando para o Claude Code** das configurações e execute-o em um terminal.
- **Claude Desktop:** **Criar pacote…** grava um arquivo `plainva.mcpb`; abra-o, e o Claude Desktop instala o Plainva.
- **Outros apps (JSON):** copie a configuração e adicione-a às configurações MCP do app, por exemplo ao `mcp.json` do Cursor.

## O que um app vê

Só as pastas que você permitiu, e só o que suas regras de privacidade deixam ir para um modelo na nuvem que pode acessar a internet — um app é tratado como tal, porque o Plainva não vê o que ele faz com o que lê: notas com `cloud: deny` ou `web: deny`, ou numa pasta com uma dessas regras, não existem para um app — nem o texto nem os títulos —, links para elas são retidos, e lugares do diário nunca vão. As pastas do próprio Plainva (`.plainva`, `.agent`) e as próprias regras nunca podem ser lidas. Cada caminho de uma solicitação e de uma resposta é verificado duas vezes: na janela do app e na parte nativa do Plainva.

As configurações listam os apps permitidos com suas pastas e as últimas solicitações. **Remover** retira a permissão de um app em todos os vaults. Isso vale na hora — também para um app que esteja conectado naquele momento.

Além das ferramentas, o Plainva oferece suas três habilidades como prompts, no idioma do app: `daily-orientation`, `weekly-review` e `project-status`, que pede o nome do projeto. Um app que aceita prompts os lista entre seus comandos.

## Deixar um app sugerir alterações

Ler nunca é uma permissão para escrever. Se um app também pode sugerir alterações é uma resposta à parte: **Pode sugerir alterações** na pergunta da primeira conexão, ou depois o interruptor **… pode sugerir alterações** nas configurações — por app e por vault, e desativado até você ativar. Vale a partir da próxima solicitação do app; as ferramentas adicionais aparecem no app quando ele se reconecta.

Um app a que você permitiu recebe mais seis ferramentas, e nenhuma delas muda o vault:

- **Uma alteração em uma nota** — no texto ou em uma das propriedades — vira uma sugestão na margem da nota, assinada com o nome do app e “(app de IA)”. Ali você aceita ou recusa cada alteração, como em qualquer sugestão (veja [Comentários e sugestões](Comments_and_Suggestions.md)).
- **Uma nota nova** vira um rascunho em **Pendentes**, na aba de IA. Ela existe quando você escolhe **Criar** ali.
- **Renomear, mover e excluir** perguntam antes. O Plainva mostra na própria janela o que aconteceria — ao renomear, também as notas cujos links acompanhariam — e o app mostra um aviso de que o Plainva está esperando. Só depois de **Permitir** no Plainva, e quando o app continuar, o Plainva faz isso do jeito que faz quando você faz à mão; o app só fica sabendo se aconteceu. Para excluir, o Plainva então abre a própria caixa de diálogo de exclusão, e nada desaparece antes de você confirmar ali. A um app que não consegue mostrar esse aviso, essas três ferramentas não são oferecidas.

Um endereço da web que um app traz é escrito de modo que nada o abra nem o carregue (`https[://]…`), como acontece com o assistente. As regras de privacidade da própria nota (`plainva.ai`) não são definidas por nenhum app, e dentro de um workspace criptografado nada é sugerido, rascunhado ou planejado. **Solicitações recentes** nas configurações diz, para cada solicitação, o que foi feito dela — também que o Plainva perguntou a você, ou que você disse não.

## Limites

- Só no desktop: celulares não executam esses apps, e nem o iOS nem o Android deixam um app oferecer a outro um canal privado.
- ChatGPT e claude.ai no navegador não o alcançam: eles só se conectam a servidores na internet, e o Plainva não mantém nenhum.
- Um app nunca muda o vault sozinho: o que ele escreve espera como sugestão ou rascunho, e renomear, mover ou excluir precisa do seu sim no Plainva.
