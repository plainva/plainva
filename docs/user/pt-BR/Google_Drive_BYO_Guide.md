# Configurando a Sincronização do Google Drive (Traga Suas Próprias Credenciais)

Stand: 2026-07-04

Esta tradução foi gerada automaticamente — correções são bem-vindas.

Para sincronizar um vault local com o seu Google Drive no Plainva, você pode usar suas próprias credenciais da API do Google. Como o Plainva ainda não passou pela verificação central CASA do Google, esta abordagem de **Traga Suas Próprias Credenciais (BYO)** oferece uma forma segura de sincronizar seus arquivos privados.

Você basicamente monta seu próprio pequeno "projeto de desenvolvedor" no Google, que pertence só a você e ao qual só você tem acesso.

## Guia passo a passo

### 1. Criar um projeto no Google Cloud Console
1. Acesse o [Google Cloud Console](https://console.cloud.google.com/).
2. Entre com sua conta do Google.
3. No canto superior esquerdo (ao lado do logotipo do Google Cloud), abra o menu suspenso de projetos e escolha **New Project**.
4. Informe um nome (por exemplo, "Plainva Sync") e clique em **Create**.

### 2. Ativar a Google Drive API
1. Selecione seu projeto recém-criado no menu suspenso no topo.
2. Procure por **Google Drive API** na barra de busca superior e escolha o item em "Marketplace".
3. Clique em **Enable**.

### 3. Configurar a tela de consentimento OAuth
Para que o Plainva use suas credenciais, uma tela de consentimento ("OAuth Consent Screen") precisa ser configurada. Como só você usa o app, ela permanece no modo "testing".

1. No menu lateral esquerdo, em **APIs & Services**, abra **OAuth consent screen**.
2. Em "User Type", escolha **External** (a menos que você use o Google Workspace) e clique em **Create**.
3. **Informações do app:**
   - Nome do app: por exemplo, "Plainva"
   - E-mail de suporte ao usuário: seu próprio e-mail
   - Informações de contato do desenvolvedor: seu próprio e-mail
   - Clique em **Save and Continue**.
4. **Escopos:**
   - Clique em **Add or Remove Scopes**.
   - Procure por `.../auth/drive` (Google Drive API, acesso completo) e marque a caixa.
   - *Contexto: o acesso completo é necessário para que o Plainva também consiga sincronizar arquivos que você coloca na sua pasta de sincronização pela interface web do Google Drive.*
   - Clique em Update, depois em **Save and Continue**.
5. **Usuários de teste:**
   - Clique em **Add Users**.
   - Informe exatamente o endereço de e-mail do Google que você usará depois para a sincronização no Plainva.
   - Clique em **Save and Continue**, depois volte ao painel.

*Importante: deixe o status em "Testing". Você NÃO precisa publicar o app. No modo de teste, os tokens expiram após 7 dias — o Plainva os renova automaticamente em segundo plano, mas após alterações significativas ou trocas de escopo você pode precisar entrar novamente.*

### 4. Criar credenciais (Client ID e Secret)
1. Abra **Credentials** no menu à esquerda.
2. Clique em **Create Credentials** no topo e escolha **OAuth client ID**.
3. Como "Application type", escolha **Desktop app** (ou "Other UI").
4. Nome: por exemplo, "Plainva Desktop Client".
5. Clique em **Create**.
6. Um pop-up mostra seu **Client ID** e **Client Secret**.

### 5. Informá-los no Plainva
1. Abra o Plainva e vá até as configurações do vault (ícone de engrenagem do vault em questão).
2. Abra a seção **Sincronização na nuvem**.
3. Escolha **Google Drive** como o provedor.
4. Cole o **Client ID** e o **Client Secret** copiados nos campos correspondentes.
5. Clique em **Conectar ao Google**.
6. Uma janela do navegador do Google se abre. Entre com a conta que você adicionou em "Test users".
7. O Google pode avisar que o app não é verificado. Clique em **Advanced** e depois em **Go to Plainva (unsafe)**.
8. Confirme as permissões solicitadas.

Seu vault agora sincroniza com segurança com o Google Drive por meio das suas próprias credenciais.
