# Captura de e-mail

Última revisão: 2026-07-18

O Plainva pode ler sua caixa de e-mail — e só ler —, para tirar conhecimento dos e-mails e levá-lo para o seu vault. Ele deliberadamente **não** é um cliente de e-mail: conecta-se via IMAP em modo somente leitura, nunca altera nada na caixa de correio (nem mesmo as marcações de não lido) e nunca envia e-mails por conta própria.

## Conectando uma caixa de correio

**Configurações → Vault → Calendário e contas → E-mail (IMAP, somente leitura) → Adicionar conta…**: host, porta e uma **senha de app**. Para o Gmail isso é `imap.gmail.com`, porta `993`, com uma senha de app de [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (exige autenticação de dois fatores) — sem OAuth, sem verificação. Ao conectar, o login é validado antes de qualquer coisa ser salva; a senha vai para o chaveiro do seu sistema operacional. A configuração **Pasta de e-mail** escolhe onde os e-mails capturados são armazenados (padrão `Mail`).

## Lendo e-mails

Abra a aba de e-mail pela barra de ações à esquerda (ícone de e-mail) ou pela paleta de comandos (**Abrir e-mail**). A lista mostra sua caixa de entrada da mais recente para a mais antiga (não lidas em negrito, **Carregar mais** avança para mais páginas). Selecionar uma mensagem a abre em um **visualizador em sandbox**:

- **O conteúdo remoto é bloqueado** — pixels de rastreamento, imagens remotas e carregadores de estilo são removidos e contados ("Conteúdo remoto bloqueado (n)"). Somente imagens inline autocontidas são exibidas.
- Links aparecem como texto simples e não são clicáveis dentro do visualizador.
- Scripts e formulários nunca são executados. A mensagem é renderizada em um frame isolado com uma política de conteúdo estrita.

Os anexos são listados com nome e tamanho; o `.eml` original (abaixo) os contém por completo.

## Levando uma mensagem para o vault

Três botões em cada mensagem:

- **Salvar como nota** — cria uma nota na sua pasta de e-mail (`AAAA-MM-DD Assunto.md`) com o remetente e a data no frontmatter e o corpo em texto simples abaixo do título do assunto. Capturar a mesma mensagem duas vezes abre a nota existente em vez de duplicá-la.
- **+ .eml** — além disso, guarda o original bruto ao lado da nota e o vincula a ela. O `.eml` contém tudo, inclusive os anexos, e abre em qualquer programa de e-mail.
- **→ Tarefa** — cria um item no seu [banco de tarefas padrão](Tasks.md) com o assunto como título, a data de hoje como vencimento e o status aberto já preenchido.

## Tirando conteúdo — sem enviar

O Plainva nunca fala SMTP. Em vez disso:

- **Responder como nota** (em uma mensagem): cria uma nota endereçada ao remetente (`to:` no frontmatter) com o original citado — escreva sua resposta no Plainva.
- **Salvar nota como rascunho na caixa de correio** (paleta de comandos, em qualquer nota aberta): grava a nota como um **rascunho na sua própria caixa de correio** via IMAP — escolha a conta, o destinatário e a pasta de rascunhos, depois abra seu programa de e-mail normal, revise e envie por lá. A formatação é preservada.
- **Enviar nota por e-mail (mailto)** (paleta de comandos): abre seu programa de e-mail padrão com a nota como texto simples (notas longas são encurtadas).
- **Copiar nota como texto de e-mail** (paleta de comandos): coloca a nota na área de transferência com formatação — cole em qualquer editor de e-mail.
