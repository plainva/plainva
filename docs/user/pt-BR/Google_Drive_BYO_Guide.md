# Configurando a Sincronização do Google Drive (Traga Suas Próprias Credenciais)

Última revisão: 2026-10-07

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

*Importante: você NÃO precisa publicar o app — ele funciona completamente no status "Testing". Nesse caso, espere que o Google faça o login expirar depois de **7 dias**, e definitivamente: nesse modo, o token de atualização também expira, então o Plainva não consegue renová-lo em segundo plano. O Plainva avisa isso em palavras simples ("login expirado"), e **Entrar novamente** nos detalhes da conta o restabelece em um único acesso, para todos os serviços dessa conta.*

**Em produção** remove a expiração fixa do modo de teste. Isso não garante um login permanente: o Google ainda pode expirar ou revogar o acesso. Os requisitos de publicação e verificação dependem do uso e das permissões solicitadas. [Google: expiração dos tokens de atualização](https://developers.google.com/identity/protocols/oauth2#expiration).

### 4. Criar credenciais (Client ID e Secret)
1. Abra **Credentials** no menu à esquerda.
2. Clique em **Create Credentials** no topo e escolha **OAuth client ID**.
3. Como "Application type", escolha **Desktop app** (ou "Other UI").
4. Nome: por exemplo, "Plainva Desktop Client".
5. Clique em **Create**.
6. Um pop-up mostra seu **Client ID** e **Client Secret**.

### 5. Informá-los no Plainva
1. Abra o Plainva e vá até as configurações do vault (ícone de engrenagem do vault em questão).
2. Abra a seção **Sincronização**.
3. Escolha **Google Drive** como o provedor.
4. Cole o **Client ID** e o **Client Secret** copiados nos campos correspondentes.
5. Clique em **Conectar ao Google**.
6. Uma janela do navegador do Google se abre. Entre com a conta que você adicionou em "Test users".
7. O Google pode avisar que o app não é verificado. Clique em **Advanced** e depois em **Go to Plainva (unsafe)**.
8. Confirme as permissões solicitadas.

Seu vault agora sincroniza com segurança com o Google Drive por meio das suas próprias credenciais.

<!-- accounts-tasks-2026-09-11 -->
## Google OAuth — Desktop / Android / iOS

As instruções de desktop exigem um cliente desktop com ID e segredo correspondente. Android usa Google Identity Services: registre o pacote `com.plainva.app` com o certificado SHA-1 da versão instalada. Versões do Play usam o certificado de assinatura do app; uma versão local pode usar outro. Android não usa redirecionamento do navegador nem segredo de cliente. No iOS, use um cliente iOS com bundle ID `com.plainva.app` e URI de retorno `com.plainva.app:/oauth2redirect`. Um cliente desktop não substitui o registro móvel. Para o calendário, ative também Google Calendar API e Google Tasks API.

**Android desde o Plainva 0.8.3:** as versões anteriores faziam login no Google pelo navegador com um ID do cliente. Um projeto do Google preparado para isso não tem cliente Android, e agora o login falha logo depois de você escolher a conta. Onde você adiciona uma conta do Google, o Plainva mostra o **Nome do pacote** e a **Impressão digital SHA-1 do certificado** da versão instalada, cada um com **Copiar**. Crie no mesmo projeto do Google um cliente OAuth do tipo Android com exatamente esses dois valores. Se ele faltar, o Plainva informa que o Google não aceita esta instalação; “**Login cancelado.**” só aparece quando você mesmo fecha a janela do Google. Uma versão do Google Play e um arquivo de instalação do GitHub podem ser assinados com certificados diferentes; nesse caso, cada um precisa do seu próprio cliente Android.

[Google: iOS / Desktop](https://developers.google.com/identity/protocols/oauth2/native-app) · [Google: Android](https://developer.android.com/identity/authorization)



Adicione arquivos, calendário ou email à conta adequada. O Plainva verifica o login selecionado e solicita as permissões que faltam.

O registro do Google não corresponde ao retorno deste dispositivo. Confira o tipo de cliente e a configuração móvel no guia do Google.

<!-- account-grants-destination-2026-09-14 -->
Um erro genérico não revela o status de publicação nem a lista de usuários de teste do projeto Google. Confira essas configurações no Google Cloud e leia a mensagem específica do provedor. O cliente de desktop precisa do ID e segredo correspondente; o registro móvel depende da plataforma e da versão instalada.
