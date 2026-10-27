# Configurando a Sincronização do Google Drive (Traga Suas Próprias Credenciais)

Última revisão: 2026-10-26

O Plainva entra no Google com o **Login neste dispositivo**. Quando a sua versão inclui o **Login padrão** para o Google, você não informa nada e não precisa desta página. Caso contrário — ou se preferir um projeto seu —, você usa suas próprias credenciais da API do Google: esta abordagem de **Traga Suas Próprias Credenciais (BYO)** oferece uma forma segura de sincronizar seus arquivos privados.

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
3. Como "Application type", escolha **Desktop app** para o Plainva no computador. Para o celular (Android e iPhone), crie em vez disso um cliente do tipo **iOS** — veja o fim desta página.
4. Nome: por exemplo, "Plainva Desktop Client".
5. Clique em **Create**.
6. Um pop-up mostra seu **Client ID** e **Client Secret**.

### 5. Informá-los no Plainva
1. Abra **Configurações → seu vault → Contas na nuvem**.
2. Para uma conta nova, escolha **Conectar conta…** → o bloco **Google** e marque os serviços; para uma conta que você já tem, abra-a e escolha **Alterar** em **Login neste dispositivo**.
3. Escolha **ID de cliente próprio** e cole o **Client ID** e o **Client Secret** copiados — no celular, apenas o **Client ID** do cliente iOS; ele não tem chave secreta. Depois, **Salvar**.
4. Clique em **Entrar com o Google…** (para uma conta que você já tem: **Entrar novamente**).
5. Uma janela do navegador do Google se abre. Entre com a conta que você adicionou em "Test users".
6. O Google pode avisar que o app não é verificado. Clique em **Advanced** e depois em **Go to Plainva (unsafe)**.
7. Confirme as permissões solicitadas — um único consentimento cobre todos os serviços que você marcou.
8. O ID de cliente próprio vale só para este dispositivo; os outros dispositivos mantêm a configuração deles. Informe-o em cada dispositivo que deva usar o seu projeto.

Seu vault agora sincroniza com segurança com o Google Drive por meio das suas próprias credenciais.

<!-- accounts-tasks-2026-09-11 -->
## Google OAuth — Desktop / Android / iOS

As instruções para computador acima exigem um cliente de computador com ID do cliente e a chave secreta correspondente. No celular, tanto no Android quanto no iOS, o Plainva faz login no Google pelo navegador: crie no seu projeto do Google um cliente OAuth do tipo **iOS**, também para Android, com o ID do pacote `com.plainva.app`. O Plainva retorna por `com.plainva.app:/oauth2redirect`; não há chave secreta do cliente. Informe o ID do cliente no celular em **Login neste dispositivo** → **ID de cliente próprio**. Não crie um cliente do tipo Android: o Google aceita o nome do pacote e a impressão digital do certificado da versão da Play em um único projeto no mundo e recusa qualquer outro (“o nome do pacote Android e a impressão digital já estão em uso”). Um cliente Android configurado para o Plainva 0.8.3 ou 0.8.4 não funciona para um novo login; as contas que já estão conectadas continuam funcionando. Um cliente de computador não substitui o registro móvel. Para agendas, ative também a Google Calendar API e a Google Tasks API. Se o Google mostrar “Erro 400: redirect_uri_mismatch” no celular, o ID do cliente é do tipo “App para computador”: crie um cliente do tipo **iOS** como descrito aqui e insira o ID dele no lugar. Abaixo do campo do ID do cliente, **Abrir o guia de Google** leva a esta seção.

[Google: iOS / Desktop](https://developers.google.com/identity/protocols/oauth2/native-app) · [Google: Android](https://developer.android.com/identity/authorization)



Adicione arquivos, calendário ou email diretamente à conta que deve carregá-los. Para Google e Microsoft, isso é um único consentimento para tudo o que a conta carrega mais o novo serviço.

O registro do Google não corresponde ao retorno deste dispositivo. Confira o tipo de cliente e a configuração móvel no guia do Google.

<!-- account-grants-destination-2026-09-14 -->
Um erro genérico não revela o status de publicação nem a lista de usuários de teste do projeto Google. Confira essas configurações no Google Cloud e leia a mensagem específica do provedor. O cliente de desktop precisa do ID e segredo correspondente; o registro móvel depende da plataforma e da versão instalada.
