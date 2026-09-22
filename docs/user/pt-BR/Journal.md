# Diário

Última revisão: 2026-09-22

O diário é o jeito rápido de anotar algo sem abrir uma nota: um pensamento, um telefonema, uma linha sobre o dia. Cada entrada é uma linha de lista comum com uma hora — `- 14:05 O roteador fica no porão` — sob um título da **nota diária de hoje**. Não há um novo formato de arquivo nem um banco de dados: as entradas vivem nas suas notas diárias, legíveis em qualquer editor e compatíveis com os plugins de diário do Obsidian (Thino, Knomo).

## Escrevendo uma entrada

Um campo, um **Enter**. O Plainva carimba a hora; você só digita o texto. Tags, links e uma segunda linha são simplesmente digitados — o texto é Markdown comum.

- **No desktop:** `Ctrl+Shift+J` abre o campo **Entrada de diário** de qualquer lugar no Plainva. O mesmo campo está no menu **＋** da barra lateral, na paleta de comandos e no menu da área de notificação (**Entrada de diário**). `Enter` salva, `Shift+Enter` começa uma nova linha, `Esc` descarta.
- **No telefone:** o botão **＋** oferece **Entrada de diário**; a tela do diário tem seu próprio botão de caneta. Um toque longo no ícone do aplicativo também oferece **Entrada de diário** — como atalho do aplicativo no Android, como ação rápida no iOS. Ali, `Enter` continua sendo uma quebra de linha; **Salvar entrada** salva.
- **Pela folha de compartilhamento (telefone):** escolha o Plainva e marque **Para o diário** — o texto e o link viram a entrada, arquivos compartilhados vão para a pasta de anexos e são incorporados.
- **Com uma imagem:** o campo do telefone tem **Adicionar foto**; no desktop você cola uma imagem da área de transferência no campo. A imagem vai para onde os anexos ficam e é incorporada na entrada.

Se a nota diária de hoje ainda não existir, ela é criada no caminho — a partir do seu modelo de nota diária, sem fazer as perguntas dele. Depois de salvar, um aviso diz **Entrada salva** e oferece **Desfazer**.

O campo faz uma coisa só: uma entrada de diário. Abaixo dele, **Criar uma tarefa em vez disso** entrega o que você digitou à [visão de tarefas](Tasks.md), onde a tarefa nasce como sempre, e fecha o campo. O chip **Como tarefa** é outra coisa: deixa a entrada no diário e lhe dá uma caixa (`- [ ] 14:05 pedir a peça`), de modo que ela também aparece na visão de tarefas em **De notas**. A caixa do chip fica vazia até você escolhê-lo.

## A visualização do diário

**Abrir diário** (barra de ações no desktop, **Seções** no telefone, ou a paleta de comandos) mostra todos os dias como um único fluxo: o dia mais novo no topo, e dentro de um dia, a entrada mais nova primeiro. Os links abrem, as tags são pílulas, uma imagem incorporada aparece como prévia, e uma entrada longa fica recolhida — **Mais** a abre.

- **Buscar e filtrar:** o campo de busca procura nos dias carregados; os chips **Todas**, **Somente tarefas** e as tags mais frequentes restringem o fluxo. Um clique em uma tag de uma entrada filtra por ela.
- **Dias mais antigos:** o Plainva carrega os últimos 14 dias que têm entradas. **Carregar anteriores** busca o próximo trecho; **Ir para um dia** abre o seletor de data, no qual os dias com entradas são marcados, e carrega até tão longe quanto o dia escolhido.
- **Abrir nota** no título de um dia abre aquela nota diária; um clique em uma entrada abre a nota naquela linha.
- **Caixas de seleção** de entradas de tarefa podem ser marcadas direto no fluxo. Elas se comportam como na visualização de tarefas, incluindo a data de conclusão e a próxima ocorrência de uma tarefa recorrente.

Cada entrada tem um menu (clique com o botão direito ou **⋯** no desktop; **⋯**, um toque longo ou um deslize no telefone): **Editar** muda o texto no lugar e mantém a hora, **Copiar** copia o texto, **Transformar em tarefa** adiciona a caixa de seleção e **Transformar de volta em entrada** a remove, **Mostrar na nota** pula para a linha, **Excluir** remove a entrada — com **Desfazer** no aviso que aparece em seguida.

As entradas de um único dia também aparecem onde você olha esse dia: como seção **Diário** na barra lateral direita do desktop (para o dia da nota diária aberta, senão hoje) e no celular na tela **Hoje** para o dia escolhido. Na barra lateral é uma seção como qualquer outra: recolhe, lembra disso, pode ser ocultada e começa fechada. Suas linhas têm uma linha só: ali não se opera nada, toda linha começa na mesma borda e uma tarefa leva uma marca discreta à direita em vez de uma caixa (marque no fluxo ou na nota). O lápis no cabeçalho abre o campo habitual **Entrada de diário** para exatamente esse dia, e **Todos os dias** leva ao fluxo.

## Como uma entrada é armazenada

```markdown
## Journal

- 09:12 Liguei para a oficina #cliente
- [ ] 10:30 Pedir a peça de reposição
- 14:05 O roteador fica no porão
  A chave está com a Sra. Berger.
```

- As entradas são anexadas ao final da seção, de modo que o arquivo se lê cronologicamente; a visualização mostra a mais nova no topo.
- O título é **Journal** por padrão e pode ser alterado por vault em **Configurações → Vault → Conteúdo e estrutura** (**Título do diário**; no telefone em **Configurações → Conteúdo e estrutura**). O nível dele não importa. Se o título estiver faltando, o Plainva adiciona `## Journal` ao final da nota. Alterar a configuração não renomeia títulos existentes.
- O Plainva também lê `- 14:05:30 Text` (com segundos) e entradas com caixa de seleção, e continua a lista da forma como sua nota já escreve (`-`, `*` ou `+`, com ou sem linhas em branco entre as entradas). Linhas existentes nunca são reformatadas.
- Uma alteração que não pode ser posicionada com segurança — por exemplo, porque um bloco de código na seção nunca foi fechado — é recusada com uma mensagem, e o campo mantém o seu texto.

O formato exato está na [Referência do Formato de Arquivo](File_Format_Reference.md).

## Dois dispositivos ao mesmo tempo

Se dois dispositivos adicionarem entradas à mesma nota diária antes de terem sincronizado, isso **não é um conflito**: o Plainva mescla as entradas por horário, e cada linha dos dois dispositivos é mantida. Isso também vale quando os dois dispositivos criaram a nota do dia de forma independente. Qualquer outra alteração simultânea na nota é tratada com o mesmo cuidado de sempre (veja [Compatibilidade de Sincronização](Sync_Compatibility.md)).

## Captura rápida global (desktop, opcional)

Em **Configurações → Inicialização e comportamento → Captura rápida global** você pode ativar **Capturar de qualquer lugar com um atalho de todo o sistema**. O atalho — `Ctrl+Alt+J` por padrão (`Cmd+Option+J` no macOS) — então abre uma pequena janela com o campo de entrada mesmo enquanto outro aplicativo está em primeiro plano, contanto que o Plainva esteja em execução (também na área de notificação). `Enter` escreve a entrada na nota diária de hoje do vault que está aberto no Plainva e fecha a janela; `Esc` descarta.

- **Alterar** grava um novo atalho: pressione a combinação que você quiser, com `Ctrl`, `Alt` ou a tecla Windows/Command. **Restaurar o padrão** traz o padrão de volta.
- Se outro aplicativo já usa o atalho, ou o sistema não o aceita, o Plainva avisa isso abaixo do interruptor, em vez de deixar um atalho que não faz nada.
- Sob o **Wayland** (Linux), o sistema não dá aos aplicativos nenhum atalho de todo o sistema; o Plainva avisa isso e não registra nada. O item da área de notificação e `Ctrl+Shift+J` levam ao mesmo campo.
- O atalho pertence ao dispositivo e não faz parte do perfil de configurações.
