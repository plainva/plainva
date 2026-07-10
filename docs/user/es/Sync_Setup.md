# Configurar la sincronización

Stand: 2026-07-10

Plainva sincroniza opcionalmente cada vault con un almacenamiento a tu elección — directamente desde la aplicación, sin ningún servicio gestionado por Plainva de por medio: tus datos viajan exclusivamente entre tu equipo y tu propia cuenta/servidor. Esta página recorre la configuración por proveedor.

Qué servicios funcionan en general (también mediante WebDAV o el cliente de escritorio del proveedor) se explica en [Compatibilidad de sincronización](Sync_Compatibility.md).

## Fundamentos

- La configuración vive en **Configuración → Configuración del vault → Sincronización en la nube**. El **Proveedor de sincronización** se elige por vault: **Ninguno (solo local)**, **WebDAV / Nextcloud**, **Google Drive**, **OneDrive**, **Dropbox** o **Almacenamiento compatible con S3** — siempre exactamente uno por vault.
- **Configurar un nuevo vault en línea desde la pantalla de bienvenida**: **Abrir vault en línea** te guía por los mismos tres pasos con cualquier proveedor — **1. Conectar** (inicia sesión o introduce las credenciales), **2. Elige la carpeta en la nube**, **3. Elige o crea la carpeta local**. También puedes configurar la sincronización de un vault ya abierto en cualquier momento desde Configuración.
- Los guardados locales se suben de inmediato; Plainva comprueba si hay cambios remotos en el **Intervalo de sincronización (segundos)** configurado.
- Los cambios sin conexión se ponen en cola y se transfieren en el próximo contacto; la barra de estado muestra **En línea**/**Sin conexión** y el indicador de sincronización muestra el estado (**Sincronizar ahora** al hacer clic). Durante una sincronización larga o la primera vez, la barra de estado muestra el progreso como un contador (p. ej., **Sync 123/540**), para que veas cómo va recorriendo el vault.
- La primera vez que conectas un vault en línea, un aviso puntual te recuerda que la sincronización inicial puede tardar un poco según el tamaño del vault — puedes seguir trabajando mientras se ejecuta.
- Si ambos lados cambian el mismo archivo, Plainva los combina automáticamente (fusión a tres bandas). Si eso no es posible, tu versión se conserva de forma segura como un archivo `.CONFLICT` — nunca se pierde nada (ver [FAQ](FAQ.md)).
- **Resolver conflictos**: un banner en la nota afectada (y **Resolver conflicto…** en el menú contextual del archivo `.CONFLICT` en el árbol) abre el diálogo de comparación — el estado actual del archivo a la izquierda, tu versión conservada a la derecha, editable con toma por bloques. **Guardar la versión derecha y resolver** escribe el resultado en el archivo y limpia la copia de conflicto; **Conservar el otro lado** descarta tu copia (queda una instantánea de versión). El diálogo de error de sincronización también lista las copias de conflicto existentes y lleva a la misma comparación con un clic.
- **Protección contra eliminaciones masivas**: si una parte inusualmente grande de los archivos sincronizados está a punto de eliminarse en la nube de una sola vez (por ejemplo, porque la carpeta local del vault se vació o se movió), Plainva retiene las eliminaciones y pregunta primero: **Eliminar en la nube** las ejecuta, **No eliminar (restaurar)** las descarta y restaura los archivos desde la nube en la próxima sincronización. Las eliminaciones que confirmaste tú mismo en Plainva no se retienen; en eliminaciones grandes (más de 10 archivos o más del 20 % del vault), Plainva pide en su lugar una segunda confirmación antes de eliminar.
- Los adjuntos (imágenes, etc.) también se sincronizan.
- Las credenciales y los tokens se guardan en el llavero del sistema operativo (estado: **Configuración → Diagnóstico del sistema → Llavero del sistema**), nunca en archivos dentro del vault.
- **Desconectar** detiene la sincronización del vault; no se elimina ningún archivo en ningún sitio al hacerlo.

## WebDAV / Nextcloud

La ruta más sencilla para servidores autoalojados y la mayoría de los almacenamientos en la nube:

1. Establece el **Proveedor de sincronización** en **WebDAV / Nextcloud**.
2. Introduce la **URL del servidor**, el **Nombre de usuario** y la **Contraseña o token de aplicación** — usa una contraseña de aplicación en lugar de tu contraseña principal siempre que sea posible (en Nextcloud: Configuración → Seguridad → Contraseñas de aplicación).
3. Elige la carpeta de destino mediante **Explorar servidor**, luego **Guardar**.

Las direcciones típicas de servidor (Nextcloud, Koofr, MagentaCLOUD, Storage Box y muchas más) están listadas en [Compatibilidad de sincronización](Sync_Compatibility.md).

## Google Drive

Google Drive funciona actualmente con tus propias credenciales ("Bring Your Own"): creas una vez un proyecto gratuito de Google Cloud, del que solo tú eres propietario. La guía paso a paso: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Versión corta: introduce el **Client ID** y el **Client Secret** de tu proyecto de Google, define la **Carpeta de Drive (nombre)** (por defecto "Plainva"), y luego **Conectar con Google** — el inicio de sesión se abre en tu navegador. Una vez conectado, elige la carpeta mediante **Elegir carpeta…** directamente desde tu Drive (subcarpetas incluidas) en lugar de escribir el nombre. Nota: mientras el proyecto de Google esté en modo de prueba, el inicio de sesión caduca a los 7 días y debe renovarse mediante **Volver a conectar**.

## OneDrive

Plainva incluye su propio registro de aplicación — **ya no necesitas tu propio ID**:

1. Establece el **Proveedor de sincronización** en **OneDrive**; opcionalmente define la **Carpeta de OneDrive (nombre)** (por defecto "Plainva").
2. **Conectar con Microsoft** y confirma el inicio de sesión en el navegador. Listo — Plainva crea la carpeta y sincroniza todo su contenido, incluidos los archivos añadidos desde fuera.
3. Opcional: una vez conectado, elige la carpeta de destino mediante **Elegir carpeta…** directamente desde tu OneDrive (subcarpetas incluidas) en lugar de escribir el nombre.

Opcional: mediante **Usar tu propio ID de aplicación** puedes indicar en su lugar un Client ID registrado por ti (p. ej. por restricciones corporativas). Guía detallada: [OneDrive y Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Dropbox

Plainva incluye su propia app de Dropbox — **no hace falta ninguna app propia**:

1. Establece el **Proveedor de sincronización** en **Dropbox**; opcionalmente define la **Carpeta de Dropbox (ruta)** (por defecto `/Plainva`).
2. **Conectar con Dropbox** y confirma en el navegador. Listo.
3. Opcional: una vez conectado, elige la carpeta de destino mediante **Elegir carpeta…** directamente desde tu Dropbox (subcarpetas incluidas) en lugar de escribir la ruta.

Opcional: mediante **Usar tu propio ID de aplicación** puedes indicar en su lugar una App Key registrada por ti. Guía detallada: [OneDrive y Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Almacenamiento compatible con S3

Para AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner y otros — basado en claves, sin ningún inicio de sesión por navegador:

| Campo | Significado |
|---|---|
| **Endpoint** | URL base de la API de S3, p. ej. `https://s3.eu-central-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com` o `http://127.0.0.1:9000` para MinIO local |
| **Bucket** | Nombre del bucket |
| **Región** | Región SigV4; "us-east-1" funciona con la mayoría de los almacenes no AWS, Cloudflare R2 usa "auto" |
| **Access Key ID** / **Secret Access Key** | Un par de claves de API del proveedor |
| **Prefijo de clave (opcional)** | Subcarpeta dentro del bucket donde vive el vault; vacío = raíz del bucket |
| **URLs path-style** | Recomendado (MinIO, R2 y la mayoría de los compatibles); desactívalo solo para buckets de AWS virtual-hosted |

También puedes elegir el **Prefijo de clave** mediante **Elegir carpeta…** directamente desde el bucket — esto ya funciona antes de guardar, en cuanto el endpoint, el bucket y las claves estén rellenados.

Después de **Aplicar**, la sincronización empieza de inmediato.

## Ver también

- [Compatibilidad de sincronización](Sync_Compatibility.md) — qué servicios funcionan y cómo, incluida la ruta del cliente de escritorio
- [FAQ y solución de problemas](FAQ.md) — archivos en conflicto, comportamiento sin conexión
