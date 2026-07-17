# Compatibilidade de Sincronização do Plainva

Última revisão: 2026-07-08 (OneDrive e Dropbox agora vêm com IDs de app centrais — BYO não é mais necessário)

O Plainva sincroniza vaults por meio de adaptadores de sincronização intercambiáveis. Esta página mostra quais serviços você já pode usar hoje — diretamente integrados, via o protocolo WebDAV, ou via o próprio cliente de sincronização de desktop do provedor.

## Diretamente integrados

| Provedor | Status | Observações |
|---|---|---|
| Pasta local | Disponível | Nenhuma configuração necessária; alterações externas (por exemplo, feitas por outras ferramentas de sincronização) são detectadas automaticamente. |
| WebDAV / Nextcloud | Disponível, verificado com o Nextcloud | URL do servidor, nome de usuário e (recomendado) uma senha de aplicativo. |
| Google Drive | Disponível (credenciais BYO) | Requer seu próprio projeto no Google Cloud, veja o [guia do Google Drive BYO](Google_Drive_BYO_Guide.md). |
| OneDrive | Disponível | Login pelo navegador (PKCE, sem secret). O Plainva já vem com seu próprio registro de app — basta escolher o OneDrive e conectar, sem necessidade de configuração. Usar seu próprio registro de app (gratuito) no Entra continua sendo opcional (veja o guia [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md)). |
| Dropbox | Disponível | Login pelo navegador (PKCE, sem secret). O Plainva já vem com seu próprio app do Dropbox — basta escolher o Dropbox e conectar, sem necessidade de configuração. Usar seu próprio app (gratuito) do Dropbox continua sendo opcional (veja o guia [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md)). |
| Armazenamento de objetos compatível com S3 | Disponível (novo em 2026-07-04, aceitação nativa pendente) | AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner e outros — basta um endpoint, bucket, região e um par de chaves de API; sem login pelo navegador. |

## Serviços utilizáveis via WebDAV

O adaptador WebDAV fala o WebDAV padrão, então os serviços a seguir devem funcionar, entre outros. Eles ainda não foram verificados individualmente — comentários são bem-vindos. Os endereços são padrões típicos; confirme-os na documentação do seu provedor e use uma senha de aplicativo em vez da sua senha principal sempre que possível.

| Serviço | Endereço WebDAV típico |
|---|---|
| Nextcloud (autogerenciado ou com um provedor) | `https://<server>/remote.php/dav/files/<user>/` |
| ownCloud | `https://<server>/remote.php/dav/files/<user>/` |
| Koofr | `https://app.koofr.net/dav/Koofr` |
| Strato HiDrive | `https://webdav.hidrive.strato.com` |
| MagentaCLOUD (Telekom) | `https://magentacloud.de/remote.php/dav/files/<user>/` |
| GMX Mediacenter | `https://webdav.mc.gmx.net` |
| WEB.DE online storage | `https://webdav.smartdrive.web.de` |
| Hetzner Storage Box | `https://<user>.your-storagebox.de` |
| Synology NAS | Ative o pacote WebDAV Server, depois `https://<nas>:5006` |
| QNAP NAS | Ative o WebDAV no sistema; endereço conforme a documentação da QNAP |
| Seafile | Ative o SeafDAV, depois `https://<server>/seafdav` |

## Via o cliente de sincronização de desktop do provedor (pasta local)

Até que integrações nativas cheguem, você pode usar qualquer serviço cujo cliente de desktop mantenha uma pasta local sincronizada. O Plainva então trata o vault como uma pasta local e detecta alterações externas automaticamente.

**Importante:** defina a pasta do vault como "sempre manter neste dispositivo" / "disponível offline". Arquivos de espaço reservado somente online (Files On-Demand, online-only, modo de streaming) podem interferir na indexação e na sincronização.

- **OneDrive** (integração com o Explorer; desative o Files On-Demand para a pasta do vault)
- **Dropbox** (cliente de desktop; evite "somente online" para a pasta do vault)
- **Google Drive for Desktop** (modo "Espelhar" em vez de "Transmitir" para a pasta do vault)
- **iCloud Drive** (iCloud para Windows ou macOS; defina a pasta como "Manter baixado")
- **Syncthing / Resilio Sync** (P2P, sem nenhum provedor de nuvem)

## Observação sobre as novas integrações (2026-07-04)

OneDrive, Dropbox e o armazenamento compatível com S3 foram diretamente integrados desde 2026-07-04 (veja a tabela acima) — antes do planejado no faseamento do plano mestre (§13.3). O Plainva já vem com seus próprios registros de app para OneDrive e Dropbox, então você não precisa do seu próprio client ID ou app key — os campos vêm pré-preenchidos e basta conectar. Usar seu próprio ID de app continua sendo opcional (por exemplo, por restrições corporativas); veja o guia [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md). O caminho do cliente de sincronização de desktop (veja acima) continua disponível como alternativa.

## Deliberadamente não planejado

- **iCloud como uma integração de API:** a Apple não oferece uma API oficial de terceiros para o iCloud Drive. Use a pasta local do iCloud em vez disso (veja acima).
- **Proton Drive / Mega:** nenhuma API oficial ou apenas APIs difíceis de integrar (criptografia E2E, SDK em C++). Mantidos sob observação.
- **Lista de observação** (sob demanda): pCloud, Box, Filen, SFTP.
