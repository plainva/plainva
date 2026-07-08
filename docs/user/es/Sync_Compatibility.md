# Compatibilidad de sincronización de Plainva

Stand: 2026-07-04 (actualizado tras las integraciones de OneDrive, Dropbox y S3)

Plainva sincroniza vaults mediante adaptadores de sincronización intercambiables. Esta página muestra qué servicios puedes usar hoy — integrados directamente, mediante el protocolo WebDAV, o mediante el propio cliente de escritorio de sincronización del proveedor.

## Integrados directamente

| Proveedor | Estado | Notas |
|---|---|---|
| Carpeta local | Disponible | No requiere configuración; los cambios externos (p. ej. de otras herramientas de sincronización) se detectan automáticamente. |
| WebDAV / Nextcloud | Disponible, verificado con Nextcloud | URL del servidor, nombre de usuario y (recomendado) una contraseña de aplicación. |
| Google Drive | Disponible (credenciales propias, BYO) | Requiere tu propio proyecto de Google Cloud, ver la [guía de Google Drive BYO](Google_Drive_BYO_Guide.md). |
| OneDrive | Disponible (nuevo 2026-07-04, aceptación nativa pendiente) | Inicio de sesión por navegador (PKCE, sin secreto). Hasta que Plainva incluya su propio registro de aplicación, necesitas tu propio registro de app de Entra (gratis): tipo "Aplicaciones móviles y de escritorio", URI de redirección `http://localhost`. |
| Dropbox | Disponible (nuevo 2026-07-04, aceptación nativa pendiente) | Inicio de sesión por navegador (PKCE, sin secreto). Hasta que Plainva incluya su propia app, necesitas tu propia app de Dropbox (gratis): acceso Full Dropbox, URI de redirección exactamente `http://127.0.0.1:41953`. |
| Almacenamiento de objetos compatible con S3 | Disponible (nuevo 2026-07-04, aceptación nativa pendiente) | AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner y otros — solo un endpoint, un bucket, una región y un par de claves de API; sin inicio de sesión por navegador. |

## Servicios utilizables mediante WebDAV

El adaptador WebDAV habla el WebDAV estándar, así que los siguientes servicios deberían funcionar, entre otros. Todavía no se han verificado de forma individual — los comentarios son bienvenidos. Las direcciones son patrones típicos; compruébalas en la documentación de tu proveedor y usa una contraseña de aplicación en lugar de tu contraseña principal siempre que sea posible.

| Servicio | Dirección WebDAV típica |
|---|---|
| Nextcloud (autoalojado o con un proveedor) | `https://<server>/remote.php/dav/files/<user>/` |
| ownCloud | `https://<server>/remote.php/dav/files/<user>/` |
| Koofr | `https://app.koofr.net/dav/Koofr` |
| Strato HiDrive | `https://webdav.hidrive.strato.com` |
| MagentaCLOUD (Telekom) | `https://magentacloud.de/remote.php/dav/files/<user>/` |
| GMX Mediacenter | `https://webdav.mc.gmx.net` |
| WEB.DE online storage | `https://webdav.smartdrive.web.de` |
| Hetzner Storage Box | `https://<user>.your-storagebox.de` |
| Synology NAS | Activa el paquete WebDAV Server, luego `https://<nas>:5006` |
| QNAP NAS | Activa WebDAV en el sistema; dirección según la documentación de QNAP |
| Seafile | Activa SeafDAV, luego `https://<server>/seafdav` |

## Mediante el cliente de escritorio de sincronización del proveedor (carpeta local)

Hasta que lleguen las integraciones nativas, puedes usar cualquier servicio cuyo cliente de escritorio mantenga sincronizada una carpeta local. Plainva entonces trata el vault como una carpeta local y detecta los cambios externos automáticamente.

**Importante:** configura la carpeta del vault como "mantener siempre en este dispositivo" / "disponible sin conexión". Los archivos marcador de posición solo en línea (Files On-Demand, solo en línea, modo de transmisión) pueden interferir con la indexación y la sincronización.

- **OneDrive** (integración con el Explorador; desactiva Files On-Demand para la carpeta del vault)
- **Dropbox** (cliente de escritorio; evita "solo en línea" para la carpeta del vault)
- **Google Drive para escritorio** (modo "Reflejo" en lugar de "Transmisión" para la carpeta del vault)
- **iCloud Drive** (iCloud para Windows o macOS; configura la carpeta como "Mantener descargado")
- **Syncthing / Resilio Sync** (P2P, sin proveedor de nube alguno)

## Nota sobre las nuevas integraciones (2026-07-04)

OneDrive, Dropbox y el almacenamiento compatible con S3 se han integrado directamente desde el 2026-07-04 (ver la tabla de arriba) — antes de lo previsto en la planificación por etapas del plan maestro (§13.3). En cuanto Plainva incluya registros de aplicación centrales para OneDrive y Dropbox, el paso de tu propio client ID o app key desaparece; los campos vendrán ya rellenados. La ruta del cliente de escritorio de sincronización (ver arriba) sigue disponible como alternativa.

## Deliberadamente no planificado

- **iCloud como integración de API:** Apple no ofrece ninguna API oficial de terceros para iCloud Drive. Usa en su lugar la carpeta local de iCloud (ver arriba).
- **Proton Drive / Mega:** sin APIs oficiales o solo difíciles de integrar (cifrado E2E, SDK en C++). Se mantienen bajo observación.
- **Lista de seguimiento** (bajo demanda): pCloud, Box, Filen, SFTP.
