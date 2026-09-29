# Conectar apps de IA (Beta)

Última revisão: 2026-09-29

Apps de IA no seu computador — Claude Code, Claude Desktop, Cursor, VS Code e outros que falam o Model Context Protocol (MCP) — podem ler o seu cofre pelo Plainva: pesquisar nele, ler notas e suas seções, estruturas, backlinks, bancos de dados, tarefas e notas recentes, e abrir uma nota no Plainva. Eles não podem mudar nada. Isso faz parte das funções experimentais de IA e funciona só no desktop.

## Como funciona

O Plainva traz ao lado do app um pequeno programa auxiliar, `plainva-mcp`. Um app de IA o inicia, e o programa auxiliar se conecta ao Plainva em execução por um canal privado deste computador — um named pipe no Windows, um socket numa pasta privada no macOS e no Linux. Nenhuma porta de rede é aberta. O Plainva precisa estar rodando com o cofre aberto; caso contrário, o app recebe uma mensagem clara.

## Ativar

1. Abra **Configurações → IA e automação** e ative **Usar IA neste dispositivo**.
2. Ative **Deixar apps de IA deste computador lerem este cofre**.
3. Configure o app (veja abaixo). Na primeira conexão, o Plainva pergunta qual app é, qual programa o iniciou e quais pastas ele pode ler. Nada vem marcado: escolha pastas ou **O cofre inteiro** e depois **Permitir**. **Recusar** afasta o app, e o Plainva não pergunta por ele de novo durante dez minutos.

O app guarda um segredo no chaveiro do sistema para a próxima vez. As pastas valem por app e por cofre: em outro cofre, o app pergunta de novo.

## Configurar um app

- **Claude Code:** copie o **Comando para o Claude Code** das configurações e execute-o em um terminal.
- **Claude Desktop:** **Criar pacote…** grava um arquivo `plainva.mcpb`; abra-o, e o Claude Desktop instala o Plainva.
- **Outros apps (JSON):** copie a configuração e adicione-a às configurações MCP do app, por exemplo ao `mcp.json` do Cursor.

## O que um app vê

Só as pastas que você permitiu, e só o que suas regras de privacidade deixam ir para um modelo na nuvem: notas com `cloud: deny`, ou numa pasta com essa regra, não existem para um app — nem o texto nem os títulos —, links para elas são retidos, e lugares do diário nunca vão. As pastas do próprio Plainva (`.plainva`, `.agent`) e as próprias regras nunca podem ser lidas. Cada caminho de uma solicitação e de uma resposta é verificado duas vezes: na janela do app e na parte nativa do Plainva.

As configurações listam os apps permitidos com suas pastas e as últimas solicitações. **Remover** retira a permissão de um app em todos os cofres.

## Limites

- Só no desktop: celulares não executam esses apps, e nem o iOS nem o Android deixam um app oferecer a outro um canal privado.
- ChatGPT e claude.ai no navegador não o alcançam: eles só se conectam a servidores na internet, e o Plainva não mantém nenhum.
- Só leitura; deixar um app propor mudanças virá numa versão posterior.
