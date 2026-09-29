# Assistente de IA (Beta)

Última revisão: 2026-09-29

O Plainva pode responder perguntas sobre suas notas com um modelo de IA da sua escolha. Ele lê seu vault, cita as notas que usou e pode abrir notas e visualizações para você — não muda nada. O assistente é **experimental** e fica desligado até você ativá-lo, separadamente em cada dispositivo.

## Ativando

Abra **Configurações → IA e automação** (a parte do App) e ative **Usar IA neste dispositivo**. Sem o interruptor não há botão de IA, nem aba de IA, nem assistente. Nada é enviado a lugar nenhum até você perguntar algo.

## Escolhendo um provedor

O Plainva não traz um serviço de IA próprio: você usa um provedor à sua escolha, com sua própria chave. Qualquer provedor pode ser escolhido; o Plainva informa os termos e a retenção de cada um para que você decida — não exclui nenhum.

| Tipo | Provedores |
|---|---|
| Provedores de nuvem | Anthropic, OpenAI, Google Gemini |
| Gateways e servidores próprios | OpenRouter, qualquer **Servidor compatível com OpenAI** |
| Neste computador (desktop) | Ollama, LM Studio |

1. Em **IA e automação**, escolha **Adicionar provedor** e selecione um. Cada entrada traz uma observação curta sobre seus termos — por exemplo, que o acesso gratuito do Google pode permitir que pessoas leiam suas entradas.
2. Digite a chave com **Inserir chave**. A chave vai para o armazenamento seguro deste dispositivo; o Plainva nunca a mostra de novo — nem para a IA, nem na tela.
3. **Testar conexão** carrega a própria lista de modelos do provedor. Se falhar, a mensagem diz por quê (uma chave rejeitada, nenhuma conexão, um modelo desconhecido).

Um **Servidor compatível com OpenAI** é adicionado pelo endereço. O Plainva pergunta mais uma vez antes de adicioná-lo, em uma janela do sistema operacional, e envia somente para o endereço que você confirmou. `http` simples só funciona para um servidor neste dispositivo; tudo o mais precisa de `https`.

Se você ainda não tem uma chave: um modelo neste computador (Ollama, LM Studio) não custa nada, e o console de cada provedor emite chaves.

## Modelos e perfis

Quatro perfis — **Rápido**, **Equilibrado**, **Forte** e **Local** — são a sua atribuição de modelos. Escolha um provedor e um modelo para cada um, a partir da lista do provedor ou digitando o id do modelo exatamente como o provedor o chama. **Padrão para novas conversas** decide com qual perfil uma nova conversa começa. O Plainva não chama nenhum modelo de “o melhor”.

## Perguntando

- **Desktop:** o botão de IA na barra de ações, **Ctrl+J** (⌘J no macOS) ou **Perguntar à IA** na paleta de comandos abre o assistente — uma pequena janela sobre o seu trabalho. **Abrir como aba** move a mesma conversa para a aba de IA, onde suas conversas estão listadas.
- **Celular:** **Perguntar à IA** no menu ⋮ de uma nota abre a folha de IA sobre essa nota. A área **IA** (na folha de áreas, ou na barra de navegação se você a colocar lá) mostra a conversa em tela cheia; **Conversas** lista as anteriores.
- **Ao lado da nota:** no desktop, a mesma conversa é a última seção da barra lateral direita, **IA**. No celular ou no tablet, é a aba **IA** do contexto da nota — ao lado de **Propriedades** e **Backlinks** —, que um tablet mostra ao lado da nota.

A nota que você tem aberta vai junto automaticamente; remova-a do contexto com o ✕ dela, se quiser. **Fixar nota…** adiciona mais notas. O assistente também pode pesquisar por conta própria: ele pesquisa no vault, lê notas e suas seções, bancos de dados, backlinks e notas vinculadas, lista tarefas, compromissos e as notas abertas ou alteradas há pouco, e abre notas e visualizações. Ele não pode mudar, criar ou excluir nada.

Cada conversa começa com a linha “As respostas são escritas por uma IA — ⟨modelo⟩ via ⟨provedor⟩”. Sob cada resposta, uma linha diz o que foi enviado para onde: quantas notas, aproximadamente quantos tokens e — quando o provedor publica preços — o custo aproximado. **Parar** encerra uma resposta a qualquer momento.

Um link em uma resposta só abre depois que você confirma o endereço dele, e imagens em respostas nunca são carregadas.

## O que vai junto

A cada pergunta, o Plainva reúne o que pode importar — neste dispositivo, antes de enviar qualquer coisa:

- **Onde você está:** a data e a hora, a nota ou o banco de dados aberto e sua seleção nele, suas abas abertas, as tarefas que vencem na próxima semana, os próximos compromissos e a nota diária de hoje.
- **Notas que podem importar:** encontradas pelas suas palavras, pelos links da nota aberta e pelo que você abriu ou alterou há pouco. Primeiro decidem suas regras de privacidade; só as notas que elas permitem são avaliadas. Algumas vão como seções — não como notas inteiras —, outras só com o título e um trecho da busca ou só com o nome; o assistente lê mais delas quando precisa.

Uma nota que a conversa já contém e que não mudou desde então é nomeada, não enviada de novo. Lugares do seu diário e valores de humor nunca são enviados por conta própria.

## Antes de enviar qualquer coisa

A primeira solicitação de uma sessão mostra um resumo: para onde vai (provedor e modelo), quais notas e qual parte de cada uma, o que mais vai junto (sua seleção, compromissos, tarefas), o que foi retido e aproximadamente quantos tokens. **Enviar** envia; **Cancelar** não envia nada e devolve suas palavras ao campo de entrada; o − ao lado de uma nota a deixa de fora. Dentro do que você aprovou, as próximas solicitações vão sem perguntar. O resumo volta sempre que o escopo cresce: outro modelo ou provedor, um novo tipo de dado, notas de outra pasta, novas ferramentas ou uma solicitação muito maior. Um modelo neste dispositivo nunca pergunta.

Se quiser ver o resumo antes de cada solicitação, ative **Perguntar antes de cada solicitação** — no próprio resumo ou em **Configurações → IA e automação**, em **Envio**.

A linha sob cada resposta abre o resumo do que foi com ela. Se uma resposta não cita nenhuma das notas enviadas, um aviso acima dessa linha diz isso; confira então a resposta com as notas.

## Ver contexto

O olho abaixo do campo de entrada, **Ver contexto**, mostra o que a próxima solicitação levaria — antes de sair, para o modelo escolhido agora. Para cada nota: por que foi escolhida (aberta agora, fixada, combina com suas palavras, vinculada, vence em breve …), qual parte vai e aproximadamente quantos tokens. Cada nota você pode

- deixar de fora da próxima solicitação (**Incluir de novo** a traz de volta),
- fixar na conversa,
- manter neste dispositivo para sempre: isso grava a regra `cloud: deny` na nota (veja abaixo).

As notas que suas regras retêm também aparecem, para você saber o que falta; elas nunca são avaliadas nem enviadas. **Enviar com este contexto** envia o que você digitou. Numa aba de IA larga, a visualização fica aberta como uma coluna ao lado da conversa.

## Regras de privacidade

Algumas notas nunca devem chegar a um provedor de nuvem. Uma regra pode ficar no frontmatter de uma nota:

```yaml
plainva:
  ai:
    cloud: deny
```

ou, para uma pasta inteira, em **Configurações → IA e automação** (a parte do Vault), que grava as regras em `.agent/policy.yml`. Uma nota mantida fora da nuvem não contribui com nada — nem texto, nem título — e os links para ela em outras notas são retidos. Modelos neste dispositivo continuam permitidos. Workspaces criptografados mantêm a nuvem desligada, a menos que você a permita ali. O formato exato está na [Referência do Formato de Arquivo](File_Format_Reference.md).

## Histórico e uso

As conversas ficam neste dispositivo, por vault — nunca no vault e nunca sincronizadas. **Manter conversas** decide por quanto tempo; você pode excluir conversas individuais na lista ou todas as de um vault de uma vez. **Uso neste mês** soma os tokens por provedor e modelo.

## Limites da beta

- No desktop, a IA roda apenas na janela principal.
- No celular, uma resposta só chega enquanto o Plainva estiver aberto.
- O assistente lê; propor alterações como sugestões vem em uma versão posterior.
