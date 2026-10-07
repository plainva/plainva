# Agentes externos (Beta)

Última revisão: 2026-10-07

Um agente externo é um programa de IA de outro fabricante — um agente que você instalou no seu computador e no qual você mesmo fez login, com a sua própria assinatura ou chave. O Plainva pode iniciar um agente assim na pasta de um vault e mostrar a sessão dele na aba de IA. Isso faz parte das funções experimentais de IA e funciona só no desktop.

Um agente externo não é o assistente do Plainva. O [Assistente de IA](AI_Assistant.md) envia só o que o resumo dele mostrou a você, e nunca o que suas regras de privacidade retêm. Um agente lê e envia por conta própria. Esta página diz o que o Plainva controla numa sessão assim — e o que não controla.

## O que o Plainva não controla

- **O programa.** Um agente é o programa de outra pessoa. Ele roda neste computador com as suas permissões, na pasta do vault, e não fica cercado: pode ler e alterar tudo o que você pode.
- **O que ele lê e envia.** Ele lê arquivos por conta própria — também notas que você mantém fora da nuvem — e envia o que escolher para o serviço dele. Suas regras de privacidade e o resumo antes do envio não o alcançam, e nada pergunta a você antes de ele enviar.
- **O que ele escreve por conta própria.** Uma alteração que o agente faz por conta própria está no vault na hora, sem sugestão. A sessão avisa quando o agente informa uma alteração assim; uma alteração que ele não informa, o Plainva não vê.
- **O login dele.** O agente faz login sozinho. O Plainva nunca vê as credenciais dele e não guarda nenhuma.

Inicie um agente só num vault cujo conteúdo possa chegar ao serviço do agente.

## O que o Plainva controla

- **As próprias ferramentas.** Onde **Deixar apps de IA deste computador lerem este vault** está ativado, as ferramentas do Plainva são oferecidas ao agente — as mesmas de qualquer app em [Conectar apps de IA](Connect_AI_Apps.md): só as pastas que você concede, nunca uma nota mantida fora da nuvem ou da internet, e só leitura — a menos que você permita ali que ele sugira alterações.
- **O que o agente pede ao Plainva para ler.** Uma nota mantida fora da nuvem ou da internet e as pastas do próprio Plainva não são entregues. O agente fica sabendo, e você também.
- **O que o agente pede ao Plainva para escrever.** Nada é escrito. Uma alteração numa nota vira uma rodada de sugestões com o nome do agente, e uma nota nova espera como rascunho até você criá-la.
- **Sem terminal.** O Plainva não oferece a um agente um terminal próprio.

## Adicionar um agente

1. Instale o agente você mesmo, como o fabricante dele descreve, e faça login nele no programa dele.
2. Abra **Configurações → IA e automação** (a parte do App). Em **Agentes externos**, **Encontrado neste computador** marca os agentes que o Plainva conhece pelo nome e encontra instalados; **Adicionar** adiciona um. Para qualquer outro programa que fale o Agent Client Protocol, escolha **Adicionar agente…** em **Outro agente** e preencha **Nome**, **Programa** e **Argumentos, um por linha**.
3. Seu sistema mostra o comando inteiro mais uma vez antes de ele ser lembrado.

O Plainva não instala nenhum agente e não baixa nenhum. Ele inicia exatamente o programa que você confirmou, diretamente e sem shell. O comando é lembrado neste dispositivo, nunca no vault. **Remover** faz o Plainva esquecer como iniciar um agente; o programa em si e o login dele ficam como estão.

## Começar uma sessão

Abra a aba de IA e escolha **Agente**. Antes de qualquer coisa iniciar, **Antes de iniciar ⟨agente⟩** lista o que o agente faz por conta própria e o que o Plainva controla, e diz se as ferramentas do Plainva serão oferecidas. **Começar a sessão** inicia o programa do agente na pasta do vault. Na primeira vez que você inicia um agente num vault desde que o Plainva foi aberto, seu sistema pergunta mais uma vez e mostra a pasta e o comando inteiro.

Roda uma sessão por vez, e ela pertence ao vault em que foi iniciada: **Encerrar a sessão** para o programa do agente, e fechar o vault ou o Plainva também. Enquanto ela roda, a primeira linha da sessão diz quem é o agente e que suas regras de privacidade não valem para ele. Nenhum agente é iniciado dentro de um workspace criptografado.

## Fazer login

Um agente que não fez login avisa, e a sessão mostra **⟨agente⟩ pede um login** com as formas que o agente indica. Dependendo do agente, escolher uma abre uma janela de terminal com o programa do próprio agente, ou o agente leva você por conta própria ao login dele. O Plainva espera e depois inicia o agente de novo. Onde não dá para abrir um terminal, o Plainva mostra o comando para rodar num terminal seu; depois escolha **Tentar de novo**. O Plainva não vê nada do login.

## Em uma sessão

Digite o que o agente deve fazer. A nota que você tem aberta é indicada ao agente — o nome dela e onde ela fica, não o texto dela —, a menos que você a retire acima do campo de entrada; uma nota que você mantém fora da nuvem ou da internet nunca é indicada. A sessão mostra o que o agente diz, o plano dele e cada um dos passos dele, com os arquivos do vault que ele cita.

Quando o agente quer a sua permissão para um passo, **⟨agente⟩ pergunta** mostra isso. As palavras são do agente, e as opções são as que o agente oferece — **Permitir**, **Permitir sempre**, **Recusar**, **Recusar sempre**. Sua resposta vai só para o agente: o que ele faz depois de um sim é com ele, e um "sempre" é uma promessa que o agente cumpre, não o Plainva.

**Parar** encerra a resposta em que o agente está trabalhando.

## O que o agente escreve

**Pelo Plainva.** Uma alteração que o agente entrega ao Plainva nunca é escrita na nota. Quando a resposta do agente termina, cada nota que ele alterou traz uma rodada de sugestões, assinada **⟨nome⟩ (agente externo)**: em **Sugestões** você aceita ou recusa cada alteração ou a rodada inteira, como na rodada de uma pessoa. Uma propriedade que o texto do agente altera aparece nessa rodada como valor proposto, como os que a IA do próprio Plainva propõe. Uma nota que ainda não existe espera como rascunho — um cartão **Rascunho · Nota** na sessão, e o mesmo cartão na lista **Pendentes** da aba de IA, onde continua depois que a sessão termina. **Criar** a escreve exatamente no lugar que o agente indicou — marcada com `generated`, com o agente como autor —, e **Descartar** a descarta. Os endereços da web que o agente trouxe são escritos de modo que nada os abra nem os carregue (`https[://]…`).

O Plainva não aceita tudo: só notas Markdown; nem regras de IA, nem campos de confiança, nem propriedades próprias do Plainva; nenhum valor de propriedade que não seja texto, número, sim ou não, ou uma lista deles; nada que seja mantido fora da nuvem ou da internet; não mais de 150 alterações numa nota por vez; e nenhuma outra nota nova enquanto houver rascunhos demais esperando. O que ele não aceitou, a sessão diz, e o agente fica sabendo.

**Por conta própria.** Um agente também pode escrever arquivos por conta própria, como qualquer programa. Quando ele informa uma alteração assim, a sessão diz **O agente alterou ⟨nota⟩ por conta própria: está no vault sem sugestão.** Que caminho um agente toma, o Plainva não pode prometer: depende do agente e de como ele está configurado. Nas configurações, cada agente mostra o que foi visto pela última vez neste computador — quantas alterações vieram pelo Plainva e quantas ele escreveu por conta própria.

## O que o Plainva guarda

- **Neste dispositivo:** o comando que você confirmou, o seu nome para o agente e o que foi visto pela última vez das alterações dele — nos dados do próprio Plainva, nunca no vault.
- **Por vault:** **Últimas sessões neste vault** lista quando uma sessão rodou, com qual agente, e quantas mensagens, alterações pelo Plainva e alterações próprias houve — nunca o que foi dito.
- **Não a sessão em si:** o que você e o agente disseram some quando a sessão é fechada. O que o agente guarda do lado dele é assunto do agente.

Se o programa do agente terminar sozinho, a sessão avisa, e **Mostrar as últimas linhas dele** mostra o fim do que o programa escreveu.

## Limites

- Só no desktop e só na janela principal. No celular há o assistente do próprio Plainva.
- Não em um workspace criptografado.
- Uma sessão por vez, e sem histórico: uma sessão encerrada não pode ser aberta de novo.
- Os modos, modelos e comandos próprios de um agente não podem ser escolhidos pelo Plainva, e não dá para enviar imagens a ele.
- Até agora isso foi testado só com um agente de teste do próprio Plainva. Quais agentes funcionam aqui, e quais entregam suas alterações ao Plainva, aparece quando você os testa — comentários são bem-vindos.
