# Configurar OneDrive & Dropbox (registro de app próprio)

Última revisão: 2026-07-11

**Normalmente você não precisa desta página:** o Plainva já vem com seus próprios IDs de app para OneDrive e Dropbox — você escolhe o provedor, clica em **Conectar** e faz login. Este guia é apenas para o caso **opcional** de você querer usar seu próprio registro de app (gratuito) (por exemplo, por restrições corporativas). Nas configurações de sincronização, você exibe os campos de ID em **Usar seu próprio ID de aplicativo** e então informa um único valor público:

- **OneDrive** → um **Client ID** (formato `00000000-0000-0000-0000-000000000000`)
- **Dropbox** → uma **App Key** (uma string curta)

Ambos os registros são gratuitos, não exigem cartão de crédito nem assinatura paga. Você **não** precisa de uma senha secreta (client secret) — os valores acima são públicos e seguros para armazenar.

Esta página é o complemento detalhado das versões resumidas em [Configurar Sincronização](Sync_Setup.md).

> Os IDs incluídos no Plainva já vêm preenchidos — você só precisa das Partes A/B abaixo para o seu **próprio** registro.

---

## Parte A — OneDrive (Microsoft Entra)

**Pré-requisito:** uma conta Microsoft (a mesma cujo OneDrive você quer sincronizar). No primeiro login, a Microsoft cria automaticamente um diretório gratuito para você — nenhuma assinatura do Azure é necessária.

### 1. Abra o portal

1. Acesse **[entra.microsoft.com](https://entra.microsoft.com)** (`portal.azure.com` também funciona).
2. Faça login com sua conta Microsoft.

### 2. Crie um novo registro de app

1. Menu **Identidade → Aplicativos → Registros de aplicativo**, depois **+ Novo registro**.
2. **Nome:** livre escolha, por exemplo `Plainva` (apenas para exibição).
3. **Tipos de conta com suporte:** escolha **"Contas em qualquer diretório organizacional … e contas pessoais da Microsoft"**. Somente essa opção corresponde ao endpoint de login do Plainva; "somente este diretório" faz contas pessoais do OneDrive falharem.
4. **URI de redirecionamento** — resolva isso aqui mesmo:
   - Plataforma: **"Cliente público/nativo (para dispositivos móveis e desktop)"**.
   - Valor: `http://localhost` (exatamente assim — sem porta, sem barra no final).

   > ⚠️ Não escolha "Web" nem "SPA". "Web" exige um client secret e o login falhará.
5. **Registrar**.

### 3. Copie o Client ID

Na **Visão geral** do app, copie o valor **"ID do aplicativo (cliente)"** — esse é o seu valor para o Plainva. (Você não precisa do "ID do diretório (locatário)".)

### 4. Permita fluxos de cliente público

1. Menu **Autenticação**.
2. Bem no final, defina **"Permitir fluxos de cliente público"** como **Sim**.
3. **Salvar**.

### 5. Defina as permissões

1. Menu **Permissões de API → + Adicionar uma permissão → Microsoft Graph → Permissões delegadas**.
2. Marque as duas:
   - `Files.ReadWrite`
   - `offline_access` (fornece o token de login de longa duração — **sem ele** o Plainva se recusa a conectar)
3. **Adicionar**. O consentimento do administrador não é necessário para contas pessoais; você mesmo consente no momento do login.

### Informe no Plainva

1. **Configurações → Vault → Sincronização**.
2. Defina o **Provedor de sincronização** como **OneDrive**.
3. Cole o ID do aplicativo copiado no campo **Client ID**; opcionalmente defina a **Pasta no OneDrive (nome)** (padrão `Plainva`).
4. **Conectar à Microsoft** → faça login no navegador e confirme o acesso. O navegador então avisa que você pode fechar a janela.

---

## Parte B — Dropbox

**Pré-requisito:** uma conta Dropbox.

### 1. Abra o console de apps

1. Acesse **[dropbox.com/developers/apps](https://www.dropbox.com/developers/apps)** e faça login.
2. Clique em **Create app**.

### 2. Escolha o tipo de app

1. **Choose an API:** **Scoped access**.
2. **Type of access:** **Full Dropbox** — não "App folder".

   > ⚠️ **Full Dropbox** é obrigatório: "App folder" enxerga apenas uma subpasta isolada e não encontrará vaults já existentes no restante do seu Dropbox.
3. **Name:** um nome globalmente único, por exemplo `Plainva-Sync-<seunome>` (apenas técnico, ninguém mais o vê).
4. **Create app**.

### 3. Registre a redirect URI

Aba **Settings → OAuth 2 → Redirect URIs**: informe **exatamente** `http://127.0.0.1:41953` e clique em **Add**.

> ⚠️ Precisa coincidir caractere por caractere: `127.0.0.1` (não `localhost`), porta `41953`, sem barra no final. O Plainva vincula exatamente essa porta; qualquer desvio interrompe o login.

### 4. Defina as permissões

Aba **Permissions** — marque as seguintes e clique em **Submit** ao final:

- `files.metadata.read`
- `files.content.read`
- `files.content.write`

> ⚠️ Se você alterar as permissões depois, precisará **Reconectar** no Plainva; caso contrário, os direitos antigos continuam valendo.

### 5. Copie a App key

Aba **Settings**: copie o valor **App key** — esse é o seu valor para o Plainva. (Você não precisa do "App secret".)

> Seu app permanece no status "Development". Isso é suficiente para uso privado; "Apply for production" só é necessário se muitas outras pessoas forem usar a mesma App key.

### Informe no Plainva

1. **Configurações → Vault → Sincronização**.
2. Defina o **Provedor de sincronização** como **Dropbox**.
3. Cole a App key copiada no campo **App Key**; opcionalmente defina a **Pasta no Dropbox (caminho)** (padrão `/Plainva`).
4. **Conectar ao Dropbox** → faça login no navegador e confirme o acesso.

---

## Se algo der errado

| Sintoma | Causa | Solução |
|---|---|---|
| OneDrive: "Microsoft returned no refresh_token" | `offline_access` ausente | Passo A5: adicione `offline_access`, depois **Reconectar** |
| OneDrive: o login pede um secret / falha | Plataforma "Web" em vez de "Mobile and desktop" | Passo A2: plataforma **Cliente público/nativo**, redirect `http://localhost` |
| OneDrive: conta pessoal é rejeitada | Tipo de conta errado | Passo A2: escolha "… e contas pessoais da Microsoft" |
| Dropbox: o login trava / "redirect_uri mismatch" | Redirect não exato | Passo B3: exatamente `http://127.0.0.1:41953` |
| Dropbox: "Port 41953 is in use" | Outro programa bloqueia a porta | Feche o aplicativo bloqueador, tente novamente |
| Dropbox: não encontra o vault / faltam direitos | "App folder" em vez de "Full Dropbox", ou permissões sem **Submit** | Verifique o passo B2 / B4, depois **Reconectar** |

## Veja também

- [Configurar Sincronização](Sync_Setup.md) — versão resumida e os demais provedores
- [Compatibilidade de Sincronização](Sync_Compatibility.md) — quais serviços funcionam e como
- [FAQ e Solução de Problemas](FAQ.md)
