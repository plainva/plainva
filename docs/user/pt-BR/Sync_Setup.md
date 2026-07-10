# Configurar Sincronização

Stand: 2026-07-10

O Plainva sincroniza cada vault opcionalmente com um armazenamento de sua escolha — direto do app, sem nenhum serviço administrado pelo Plainva no meio: seus dados trafegam exclusivamente entre seu computador e sua própria conta/servidor. Esta página percorre a configuração por provedor.

Quais serviços funcionam em geral (também via WebDAV ou o cliente de desktop do provedor) está descrito em [Compatibilidade de Sincronização](Sync_Compatibility.md).

## Fundamentos

- A configuração fica em **Configurações → Configurações do vault → Sincronização na nuvem**. O **Provedor de sincronização** é escolhido por vault: **Nenhum (somente local)**, **WebDAV / Nextcloud**, **Google Drive**, **OneDrive**, **Dropbox** ou **Armazenamento compatível com S3** — sempre exatamente um por vault.
- **Configurar um novo vault online a partir da tela inicial**: **Abrir vault online** guia você pelas mesmas três etapas em todos os provedores — **1. Conectar** (fazer login ou informar credenciais), **2. Escolher a pasta na nuvem**, **3. Escolher ou criar a pasta local**. Você também pode configurar a sincronização de um vault já aberto a qualquer momento em Configurações.
- Salvamentos locais são enviados imediatamente; o Plainva verifica alterações remotas no **Intervalo de sincronização (segundos)** configurado.
- Alterações offline ficam em uma fila e são transferidas no próximo contato; a barra de status mostra **Online**/**Offline** e o indicador de sincronização mostra o estado (**Sincronizar agora** ao clicar). Durante uma sincronização longa ou a primeira sincronização, a barra de status mostra o progresso como um contador (por exemplo, **Sync 123/540**), para que você veja que ela está avançando pelo vault.
- Na primeira vez que você conecta um vault online, um aviso único lembra que a sincronização inicial pode demorar um pouco dependendo do tamanho do vault — você pode continuar trabalhando enquanto ela roda.
- Se os dois lados alterarem o mesmo arquivo, o Plainva os mescla automaticamente (mesclagem em três vias). Se isso não for possível, sua versão é preservada com segurança como um arquivo `.CONFLICT` — nada nunca se perde (veja [FAQ](FAQ.md)).
- **Resolver conflitos**: um banner na nota afetada (e **Resolver conflito…** no menu de contexto do arquivo `.CONFLICT` na árvore) abre o diálogo de comparação — o estado atual do arquivo à esquerda, sua versão preservada à direita, editável com adoção por bloco. **Salvar o lado direito e resolver** grava o resultado no arquivo e remove a cópia de conflito; **Manter o outro lado** descarta sua cópia (um snapshot de versão permanece). O diálogo de erro de sincronização também lista as cópias de conflito existentes e leva à mesma comparação com um clique.
- **Proteção contra exclusões em massa**: se uma parcela incomumente grande dos arquivos sincronizados estiver prestes a ser excluída na nuvem de uma só vez (por exemplo, porque a pasta local do vault foi esvaziada ou movida), o Plainva retém as exclusões e pergunta primeiro: **Excluir na nuvem** as executa, **Não excluir (restaurar)** as descarta e restaura os arquivos da nuvem na próxima sincronização. As exclusões que você mesmo confirmou no Plainva não são retidas — em exclusões grandes (mais de 10 arquivos ou mais de 20% do vault), o Plainva pede uma segunda confirmação antes de excluir.
- Anexos (imagens etc.) também são sincronizados.
- Credenciais e tokens são armazenados no chaveiro do sistema operacional (status: **Configurações → Diagnóstico do sistema → Chaveiro do sistema**), nunca em arquivos dentro do vault.
- **Desconectar** interrompe a sincronização do vault; nenhum arquivo é excluído em lugar nenhum ao fazer isso.

## WebDAV / Nextcloud

O caminho mais simples para servidores autogerenciados e a maioria dos armazenamentos na nuvem:

1. Defina o **Provedor de sincronização** como **WebDAV / Nextcloud**.
2. Informe a **URL do servidor**, o **Nome de usuário** e a **Senha ou token de aplicativo** — use uma senha de aplicativo em vez da sua senha principal sempre que possível (no Nextcloud: Configurações → Segurança → Senhas de aplicativo).
3. Escolha a pasta de destino com **Explorar servidor**, depois **Salvar**.

Endereços de servidor típicos (Nextcloud, Koofr, MagentaCLOUD, Storage Box e muitos outros) estão listados em [Compatibilidade de Sincronização](Sync_Compatibility.md).

## Google Drive

O Google Drive hoje funciona com suas próprias credenciais ("Bring Your Own"): você cria uma vez um projeto gratuito no Google Cloud, que pertence só a você. O guia passo a passo: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Versão resumida: informe o **Client ID** e o **Client Secret** do seu projeto do Google, defina a **Pasta no Drive (nome)** (padrão "Plainva"), depois **Conectar ao Google** — o login abre no seu navegador. Depois de conectado, escolha a pasta com **Escolher pasta…** direto do seu Drive (subpastas incluídas), em vez de digitar o nome. Observação: enquanto o projeto do Google estiver no modo de teste, o login expira após 7 dias e precisa ser renovado por **Reconectar**.

## OneDrive

O Plainva já vem com seu próprio registro de app — você **não precisa mais de um ID próprio**:

1. Defina o **Provedor de sincronização** como **OneDrive**; opcionalmente defina a **Pasta no OneDrive (nome)** (padrão "Plainva").
2. **Conectar à Microsoft** e confirme o login no navegador. Pronto — o Plainva cria a pasta e sincroniza todo o seu conteúdo, inclusive arquivos adicionados externamente.
3. Opcional: depois de conectado, escolha a pasta de destino com **Escolher pasta…** direto do seu OneDrive (subpastas incluídas), em vez de digitar o nome.

Opcional: em **Usar seu próprio ID de aplicativo** você pode informar, em vez disso, um Client ID registrado por você mesmo (por exemplo, por restrições corporativas). Guia detalhado: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Dropbox

O Plainva já vem com seu próprio app do Dropbox — **nenhum app próprio é necessário**:

1. Defina o **Provedor de sincronização** como **Dropbox**; opcionalmente defina a **Pasta no Dropbox (caminho)** (padrão `/Plainva`).
2. **Conectar ao Dropbox** e confirme no navegador. Pronto.
3. Opcional: depois de conectado, escolha a pasta de destino com **Escolher pasta…** direto do seu Dropbox (subpastas incluídas), em vez de digitar o caminho.

Opcional: em **Usar seu próprio ID de aplicativo** você pode informar, em vez disso, uma App Key registrada por você mesmo. Guia detalhado: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Armazenamento compatível com S3

Para AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner e outros — baseado em chaves, sem nenhum login pelo navegador:

| Campo | Significado |
|---|---|
| **Endpoint** | URL base da API S3, por exemplo `https://s3.eu-central-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com` ou `http://127.0.0.1:9000` para MinIO local |
| **Bucket** | Nome do bucket |
| **Região** | Região SigV4; `us-east-1` funciona para a maioria dos armazenamentos fora da AWS, o Cloudflare R2 usa `auto` |
| **Access Key ID** / **Secret Access Key** | Um par de chaves de API do provedor |
| **Prefixo de chave (opcional)** | Subpasta dentro do bucket onde o vault fica; vazio = raiz do bucket |
| **URLs path-style** | Recomendado (funciona para MinIO, R2 e a maioria dos compatíveis); desative apenas para buckets AWS virtual-hosted |

Você também pode escolher o **Prefixo de chave** com **Escolher pasta…** direto do bucket — isso já funciona antes de salvar, assim que o endpoint, o bucket e as chaves estiverem preenchidos.

Após **Salvar**, a sincronização começa imediatamente.

## Veja também

- [Compatibilidade de Sincronização](Sync_Compatibility.md) — quais serviços funcionam e como, incluindo o caminho do cliente de desktop
- [FAQ e Solução de Problemas](FAQ.md) — arquivos de conflito, comportamento offline
