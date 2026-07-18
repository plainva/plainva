# Calendário & tarefas externas

Última revisão: 2026-07-18

O Plainva pode conectar suas contas de calendário e tarefas já existentes — **CalDAV** (Nextcloud, Fastmail, mailbox.org …), **Google** (Agenda + Tarefas) e **Microsoft** (calendário do Outlook + To Do) — e trabalhar com elas em ambas as direções. Suas notas continuam sendo o centro: eventos podem virar notas de reunião, e listas de tarefas externas se espelham no seu [banco de tarefas padrão](Tasks.md) como notas comuns.

## Conectando uma conta

Abra **Configurações → Vault → Calendário e contas → Adicionar conta…** e escolha um provedor:

- **CalDAV**: URL do servidor, nome de usuário e uma **senha de app** (no Nextcloud: Configurações → Segurança → Dispositivos e sessões). Sem registro, sem chaves.
- **Google**: precisa do seu próprio ID de cliente OAuth (o mesmo modelo BYO da sincronização com o Google Drive — veja o [guia do Drive](Google_Drive_BYO_Guide.md)). No seu projeto do Google Cloud, ative também a *Google Calendar API* e a *Google Tasks API* e acrescente seus escopos à tela de consentimento. O navegador se abre para a autorização; ao conectar, a conta é validada antes de qualquer coisa ser salva.
- **Microsoft**: basta clicar em **Conectar** e confirmar no navegador — nenhuma configuração é necessária.

Cada conta lista seus **calendários** (os marcados aparecem na aba do calendário) e suas **listas de tarefas** (desmarcadas por padrão, propositalmente — marcar uma inicia a sincronização de tarefas descrita abaixo). Senhas e tokens ficam no chaveiro do seu sistema operacional. A configuração **Pasta de reuniões**, abaixo das contas, escolhe onde as notas de reunião são criadas.

## A aba do calendário

Abra-a pela barra de ações à esquerda (ícone de calendário) ou pela paleta de comandos (**Abrir calendário**). Cinco visualizações estão disponíveis pelo alternador no cabeçalho: **Dia**, **3 dias** e **Semana** mostram uma **grade de horários** com uma coluna de horas à esquerda; os eventos aparecem como blocos no horário de início, a altura corresponde à duração, eventos sobrepostos ficam lado a lado, e uma linha vermelha marca "agora". Eventos de dia inteiro e (com a sobreposição de tarefas ativada) tarefas com vencimento ficam na faixa acima da grade. **Mês** mostra a grade do mês (um ponto colorido por calendário) mais, à direita, uma grade de horários de um único dia para o dia selecionado. **Agenda** lista as próximas semanas agrupadas por dia. **Hoje** retorna; as setas avançam pelo período atual (um dia, três dias, uma semana ou um mês). O primeiro dia da semana segue a configuração **Início da semana** (Configurações → App → Aparência: Segunda-feira, Sábado ou Domingo) — ela também se aplica ao calendário da barra lateral. A visualização se atualiza automaticamente a cada poucos minutos; o botão **Atualizar agora** força isso.

- **Criar um evento**: **clicar em um horário vazio na grade de horários** abre uma pequena janela de criação rápida (título, horário, calendário, local) — **Salvar** cria na hora, **Mais opções** abre o diálogo completo do evento. **Arrastar** pela grade define a duração. O **+** no cabeçalho abre o diálogo completo: título, calendário, data/hora ou um período de dia inteiro, local, descrição, cor e, opcionalmente, uma simples **repetição** (Diária/Semanal/Mensal/Anual). A cor sobrescreve a cor do calendário apenas para esse evento (sem efeito em contas Microsoft — o Outlook não tem cores por evento).
- **Editar / excluir**: **clicar em um evento** na grade de horários abre o diálogo pré-preenchido com seus valores e com as ações **Nota de reunião** e **Excluir**. As alterações são gravadas no provedor com uma verificação de segurança: se o evento mudou remotamente nesse meio-tempo, o Plainva atualiza a visualização em vez de sobrescrever.
- **Mover / redimensionar**: você pode **arrastar** um evento diretamente na grade de horários — arrastar o corpo reagenda o evento (também para outro dia, nas visualizações de semana/3 dias), arrastar a **borda inferior** altera a duração. O novo horário é gravado no provedor na hora (eventos recorrentes continuam editáveis apenas pelo diálogo, por enquanto).
- **Eventos recorrentes** trazem um selo de repetição. Editar ou excluir uma instância pergunta **"Somente este evento"** (cria uma exceção ou pula apenas essa ocorrência) ou **"Todos os eventos"** (altera a série inteira). O Plainva nunca reescreve uma regra de recorrência existente.
- **Mostrar tarefas** (ao lado do botão **Atualizar agora**, quando um banco de tarefas padrão estiver configurado): sobrepõe os itens com vencimento do seu [banco de tarefas padrão](Tasks.md) à faixa da grade de horários e à grade do mês; tarefas concluídas aparecem riscadas. Desativado por padrão, a escolha é lembrada por dispositivo.

## Evento → nota de reunião

O ícone de nota em qualquer evento cria (ou reabre) sua **nota de reunião** — uma nota comum na sua pasta de reuniões, com o nome `AAAA-MM-DD Título.md`, pré-preenchida com data, local e participantes, além de uma pequena marcação `plainva.pim` no frontmatter que a vincula ao evento. Clicar de novo no mesmo evento sempre abre a mesma nota; uma nota sua que por acaso tenha o mesmo nome nunca é tocada.

## Listas de tarefas externas no seu banco de tarefas

Marque uma **lista de tarefas** em uma conta conectada, e suas tarefas aparecem como notas no seu [banco de tarefas padrão](Tasks.md): o título vira a nota (H1), a data de vencimento vai para a coluna de data do banco de dados, e a conclusão se mapeia na **propriedade de caixa de seleção de concluído** do banco de dados (a coluna de status a acompanha; um banco de dados sem uma coluna de caixa de seleção usa a convenção de status — primeira opção = aberta, última = concluída). A sincronização é bidirecional e campo a campo:

- Edite a nota (título, vencimento, status) → a alteração é enviada ao provedor.
- Altere a tarefa remotamente → a nota acompanha.
- Se ambos os lados mudaram, sua alteração local vence para aquele campo; o restante segue o lado remoto.

Duas regras de segurança protegem seus dados: **excluir a nota nunca exclui a tarefa remota** (ela só para de sincronizar e não é reimportada), e **uma tarefa excluída remotamente nunca exclui sua nota** (ela simplesmente vira uma nota comum). Renomear ou mover uma nota de tarefa não tem problema — a marcação no frontmatter mantém o vínculo.

Limites atuais: tarefas criadas como notas comuns não são enviadas ao provedor (crie-as remotamente ou pelo banco de tarefas), e tudo nesta página é, por enquanto, desktop-first.
