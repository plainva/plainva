# Configurar Sincronização

Última revisão: 2026-07-21

O Plainva sincroniza cada vault opcionalmente com um armazenamento de sua escolha — direto do app, sem nenhum serviço administrado pelo Plainva no meio: seus dados trafegam exclusivamente entre seu computador e sua própria conta/servidor. Esta página percorre a configuração por provedor.

Quais serviços funcionam em geral (também via WebDAV ou o cliente de desktop do provedor) está descrito em [Compatibilidade de Sincronização](Sync_Compatibility.md).

## Fundamentos

- A configuração fica em **Configurações → seu vault → Contas na nuvem**: **Conectar conta…** abre o assistente — primeiro escolha o **provedor**, depois marque os **serviços** (para sincronizar arquivos: **Arquivos**), depois faça login. A visão em blocos lista os provedores por alcance real; em **Buscar provedores…** você também encontra os provedores de e-mail disponíveis como predefinição. Exatamente **uma** conta por vault carrega o serviço **Arquivos**. A área **Sincronização** então mostra a conta conectada com sua **Pasta na nuvem** e mantém o comportamento (**Intervalo de sincronização**, fila); **Gerenciar conta** leva de volta às contas na nuvem.
- Para o serviço **Arquivos**, além de **Microsoft** (OneDrive), **Google** (Drive), **Dropbox**, **Nextcloud**, **Armazenamento de objetos (S3)** e o genérico **WebDAV / CalDAV**, os blocos também incluem **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru**, **Koofr** e **pCloud**: neles basta o seu endereço de e-mail mais uma **senha de app** — os endereços de servidor já ficam preenchidos (baseado em WebDAV; alterável em **Avançado: definir os endpoints individualmente**).
- **Configurar um vault online existente a partir da tela inicial**: **Abrir vault** → **Vault on-line** guia você pelas mesmas três etapas em todos os provedores — **1. Conectar** (fazer login ou informar credenciais), **2. Escolher a pasta na nuvem** (uma pasta nova também pode ser criada ali com **Nova pasta**), **3. Escolher ou criar a pasta local**. Você também pode configurar a sincronização de um vault já aberto a qualquer momento em Configurações.
- **Criar um novo vault na nuvem**: **Novo vault** → **Em um serviço on-line** — primeiro você escolhe a estrutura inicial (vazio ou um modelo como PARA), depois conecta e escolhe a pasta de destino na nuvem ou a cria com **Nova pasta**, por fim a pasta local. A estrutura é criada na pasta local e enviada automaticamente pela primeira sincronização.
- Salvamentos locais são enviados imediatamente; o Plainva verifica alterações remotas no **Intervalo de sincronização (segundos)** configurado.
- Alterações offline ficam em uma fila e são transferidas no próximo contato; a barra de status mostra **Online**/**Offline** e o indicador de sincronização mostra o estado (**Sincronizar agora** ao clicar). Durante uma sincronização longa ou a primeira sincronização, a barra de status mostra o progresso como um contador (por exemplo, **Sync 123/540**), para que você veja que ela está avançando pelo vault.
- Na primeira vez que você conecta um vault online, um aviso único lembra que a sincronização inicial pode demorar um pouco dependendo do tamanho do vault — você pode continuar trabalhando enquanto ela roda.
- Se os dois lados alterarem o mesmo arquivo, o Plainva os mescla automaticamente (mesclagem em três vias). Se isso não for possível, sua versão é preservada com segurança como um arquivo `.CONFLICT` — nada nunca se perde (veja [FAQ](FAQ.md)).
- **Resolver conflitos**: um banner na nota afetada (e **Resolver conflito…** no menu de contexto do arquivo `.CONFLICT` na árvore) abre o diálogo de comparação — o estado atual do arquivo à esquerda, sua versão preservada à direita, editável com adoção por bloco. **Salvar o lado direito e resolver** grava o resultado no arquivo e remove a cópia de conflito; **Manter o outro lado** descarta sua cópia (um snapshot de versão permanece). O diálogo de erro de sincronização também lista as cópias de conflito existentes e leva à mesma comparação com um clique.
- **Proteção contra exclusões em massa**: se uma parcela incomumente grande dos arquivos sincronizados estiver prestes a ser excluída na nuvem de uma só vez (por exemplo, porque a pasta local do vault foi esvaziada ou movida), o Plainva retém as exclusões e pergunta primeiro: **Excluir na nuvem** as executa, **Não excluir (restaurar)** as descarta e restaura os arquivos da nuvem na próxima sincronização. As exclusões que você mesmo confirmou no Plainva não são retidas — em exclusões grandes (mais de 10 arquivos ou mais de 20% do vault), o Plainva pede uma segunda confirmação antes de excluir.
- Anexos (imagens etc.) também são sincronizados.
- **Pastas vazias** também são sincronizadas: uma pasta criada no Plainva aparece na nuvem imediatamente, e pastas vazias na nuvem aparecem nos seus outros dispositivos no mais tardar na próxima listagem completa.
- Credenciais e tokens são armazenados no chaveiro do sistema operacional (status: **Configurações → App → Sobre e diagnóstico → Chaveiro do sistema**), nunca em arquivos dentro do vault.
- **Desconectar** interrompe a sincronização do vault; nenhum arquivo é excluído em lugar nenhum ao fazer isso.

## WebDAV / Nextcloud

O caminho mais simples para servidores autogerenciados e a maioria dos armazenamentos na nuvem:

1. Em **Contas na nuvem** → **Conectar conta…** escolha o bloco **Nextcloud** (ou **WebDAV / CalDAV**).
2. Informe o **Endereço do servidor**, o **Nome de usuário** e a **Senha ou token de aplicativo** — use uma senha de aplicativo em vez da sua senha principal sempre que possível (no Nextcloud: Configurações → Segurança → Senhas de aplicativo).
3. **Conectar** valida as credenciais; depois escolha a **Pasta na nuvem** com **Escolher pasta…**.

Caso especial do **Nextcloud**: UM único formulário cobre arquivos **e** calendário — o Plainva deriva os endpoints WebDAV e CalDAV a partir do endereço do servidor (os endereços derivados aparecem no assistente; **Avançado: definir os endpoints individualmente** permite URLs separadas). Marcando os dois serviços, uma única passagem conecta ambos.

Endereços de servidor típicos (Nextcloud, Koofr, MagentaCLOUD, Storage Box e muitos outros) estão listados em [Compatibilidade de Sincronização](Sync_Compatibility.md).

## Google Drive

O Google Drive hoje funciona com suas próprias credenciais ("Bring Your Own"): você cria uma vez um projeto gratuito no Google Cloud, que pertence só a você. O guia passo a passo: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Versão resumida: em **Contas na nuvem** → **Conectar conta…** escolha o bloco **Google**, marque o serviço **Arquivos**, informe o **Client ID** e o **Client Secret** do seu projeto do Google, depois **Entrar com o Google…** — o login abre no seu navegador. Depois de conectado, escolha a **Pasta na nuvem** com **Escolher pasta…** direto do seu Drive (subpastas incluídas, padrão "Plainva"). Observação: enquanto o projeto do Google estiver no modo de teste, o login expira após 7 dias e precisa ser renovado por **Entrar novamente**, nos detalhes da conta.

## OneDrive

O Plainva já vem com seu próprio registro de app — você **não precisa mais de um ID próprio**:

1. Em **Contas na nuvem** → **Conectar conta…** escolha o bloco **Microsoft** e marque o serviço **Arquivos** (OneDrive) — se quiser, junto com **Calendário e tarefas** e **E-mail** (uma conta Microsoft pode carregar os três serviços).
2. **Entrar com a Microsoft…** e confirme o login no navegador. Pronto — o Plainva cria a pasta (padrão "Plainva") e sincroniza todo o seu conteúdo, inclusive arquivos adicionados externamente.
3. Opcional: depois de conectado, escolha a **Pasta na nuvem** com **Escolher pasta…** direto do seu OneDrive (subpastas incluídas).

Opcional: em **Usar seu próprio ID de aplicativo** você pode informar, em vez disso, um Client ID registrado por você mesmo (por exemplo, por restrições corporativas). Guia detalhado: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Dropbox

O Plainva já vem com seu próprio app do Dropbox — **nenhum app próprio é necessário**:

1. Em **Contas na nuvem** → **Conectar conta…** escolha o bloco **Dropbox** (ele carrega apenas o serviço **Arquivos**).
2. **Entrar com o Dropbox…** e confirme no navegador. Pronto (pasta padrão `/Plainva`).
3. Opcional: depois de conectado, escolha a **Pasta na nuvem** com **Escolher pasta…** direto do seu Dropbox (subpastas incluídas).

Opcional: em **Usar seu próprio ID de aplicativo** você pode informar, em vez disso, uma App Key registrada por você mesmo. Guia detalhado: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Armazenamento compatível com S3

Para AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner e outros — baseado em chaves, sem nenhum login pelo navegador. Em **Contas na nuvem** → **Conectar conta…** escolha o bloco **Armazenamento de objetos (S3)** e preencha os campos:

| Campo | Significado |
|---|---|
| **Endpoint** | URL base da API S3, por exemplo `https://s3.eu-central-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com` ou `http://127.0.0.1:9000` para MinIO local |
| **Bucket** | Nome do bucket |
| **Região** | Região SigV4; `us-east-1` funciona para a maioria dos armazenamentos fora da AWS, o Cloudflare R2 usa `auto` |
| **Access Key ID** / **Secret Access Key** | Um par de chaves de API do provedor |
| **Prefixo de chave (opcional)** | Subpasta dentro do bucket onde o vault fica; vazio = raiz do bucket |
| **URLs path-style** | Recomendado (funciona para MinIO, R2 e a maioria dos compatíveis); desative apenas para buckets AWS virtual-hosted |

Você pode escolher o **Prefixo de chave** (a pasta na nuvem) com **Escolher pasta…** direto do bucket depois de conectar.

Após **Conectar**, a sincronização começa imediatamente.

## Veja também

- [Compatibilidade de Sincronização](Sync_Compatibility.md) — quais serviços funcionam e como, incluindo o caminho do cliente de desktop
- [FAQ e Solução de Problemas](FAQ.md) — arquivos de conflito, comportamento offline

## Criptografia de sincronização (senha)

O Plainva pode criptografar o que sai do seu dispositivo em direção ao servidor de sincronização, enquanto o seu vault local sempre permanece em Markdown puro, que o Obsidian consegue ler.

Abra **Configurações → Sincronização → Senha de sincronização e criptografia**:

1. **Defina uma senha.** Isso cria uma chave de criptografia para o vault e mostra um **código de recuperação** único — guarde-o em local seguro; é a única forma de voltar a entrar caso você esqueça a senha. A partir daí, as **configurações** sincronizadas do vault passam a trafegar criptografadas.
2. **Criptografar o conteúdo do vault** (opcional). O botão **Criptografar** envia novamente cada nota ao servidor de sincronização como texto cifrado. Seus arquivos locais continuam em Markdown puro, então um vault local nunca corre risco — experimente primeiro em um vault descartável. Quando o envio terminar, use **Concluir migração** para passar a aceitar somente texto cifrado a partir daí.
3. **Em outro dispositivo**, abra o mesmo vault sincronizado. O Plainva detecta que o vault está criptografado e pede a senha (ou o código de recuperação). Depois de desbloquear, as notas são descriptografadas e aparecem localmente.

A chave desbloqueada fica em cache em cada dispositivo. Ative **Exigir senha a cada início** para digitá-la novamente após cada reinicialização em vez disso, e use **Bloquear** para remover a chave em cache deste dispositivo.

**Sincronizar configurações** transfere as configurações compartilhadas do vault e os metadados das contas; caminhos locais, layout e dados de execução permanecem específicos do dispositivo. **Sincronizar segredos das contas** é uma opção separada para senhas de app estáticas e credenciais BYO permitidas; tokens OAuth nunca são compartilhados. O estado da criptografia orienta por **Preparação**, **Migração**, **Estrito**, **Descriptografia** e **Rotação de chave**. Dispositivos móveis podem desbloquear o mesmo vault criptografado com a senha.
