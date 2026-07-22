# Configurar la sincronización

Última actualización: 2026-07-21

Plainva sincroniza opcionalmente cada vault con un almacenamiento a tu elección — directamente desde la aplicación, sin ningún servicio gestionado por Plainva de por medio: tus datos viajan exclusivamente entre tu equipo y tu propia cuenta/servidor. Esta página recorre la configuración por proveedor.

Qué servicios funcionan en general (también mediante WebDAV o el cliente de escritorio del proveedor) se explica en [Compatibilidad de sincronización](Sync_Compatibility.md).

## Fundamentos

- La configuración vive en **Ajustes → tu vault → Cuentas en la nube**: **Conectar cuenta…** abre el asistente — elige primero el **proveedor**, luego marca los **servicios** (para la sincronización de archivos: **Archivos**), luego inicia sesión. La vista de fichas ordena los proveedores por popularidad real; con **Buscar proveedores…** también encuentras los proveedores de correo disponibles como preajuste. **Solo una** cuenta por vault lleva el servicio **Archivos**. La zona **Sincronización** muestra entonces la cuenta conectada con su **Carpeta en la nube** y regula el comportamiento (**Intervalo de sincronización**, cola); **Gestionar cuenta** te lleva de vuelta a las cuentas en la nube.
- Para el servicio **Archivos**, además de **Microsoft** (OneDrive), **Google** (Drive), **Dropbox**, **Nextcloud**, **Almacenamiento de objetos (S3)** y el genérico **WebDAV / CalDAV**, las fichas también incluyen **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru**, **Koofr** y **pCloud**: ahí basta tu dirección de correo más una **contraseña de aplicación** — las direcciones del servidor ya están rellenadas (basado en WebDAV; se puede cambiar mediante **Avanzado: definir los endpoints individualmente**).
- **Abrir un vault en línea ya existente desde la pantalla de bienvenida**: **Abrir vault** → **Vault en línea** te guía por los mismos tres pasos con cualquier proveedor — **1. Conectar** (inicia sesión o introduce las credenciales), **2. Elige la carpeta en la nube** (ahí mismo también puedes crear una carpeta nueva mediante **Nueva carpeta**), **3. Elige o crea la carpeta local**. También puedes configurar la sincronización de un vault ya abierto en cualquier momento desde Configuración.
- **Crear un nuevo vault en la nube**: **Nuevo vault** → **En un servicio en línea** — primero eliges la estructura inicial (vacía o una plantilla como PARA), luego te conectas y eliges la carpeta de destino en la nube o la creas mediante **Nueva carpeta**, y por último la carpeta local. La estructura se crea en la carpeta local y se sube automáticamente en la primera sincronización.
- Los guardados locales se suben de inmediato; Plainva comprueba si hay cambios remotos en el **Intervalo de sincronización (segundos)** configurado.
- Los cambios sin conexión se ponen en cola y se transfieren en el próximo contacto; la barra de estado muestra **En línea**/**Sin conexión** y el indicador de sincronización muestra el estado (**Sincronizar ahora** al hacer clic). Durante una sincronización larga o la primera vez, la barra de estado muestra el progreso como un contador (p. ej., **Sync 123/540**), para que veas cómo va recorriendo el vault.
- La primera vez que conectas un vault en línea, un aviso puntual te recuerda que la sincronización inicial puede tardar un poco según el tamaño del vault — puedes seguir trabajando mientras se ejecuta.
- Si ambos lados cambian el mismo archivo, Plainva los combina automáticamente (fusión a tres bandas). Si eso no es posible, tu versión se conserva de forma segura como un archivo `.CONFLICT` — nunca se pierde nada (ver [FAQ](FAQ.md)).
- **Resolver conflictos**: un banner en la nota afectada (y **Resolver conflicto…** en el menú contextual del archivo `.CONFLICT` en el árbol) abre el diálogo de comparación — el estado actual del archivo a la izquierda, tu versión conservada a la derecha, editable con toma por bloques. **Guardar la versión derecha y resolver** escribe el resultado en el archivo y limpia la copia de conflicto; **Conservar el otro lado** descarta tu copia (queda una instantánea de versión). El diálogo de error de sincronización también lista las copias de conflicto existentes y lleva a la misma comparación con un clic.
- **Protección contra eliminaciones masivas**: si una parte inusualmente grande de los archivos sincronizados está a punto de eliminarse en la nube de una sola vez (por ejemplo, porque la carpeta local del vault se vació o se movió), Plainva retiene las eliminaciones y pregunta primero: **Eliminar en la nube** las ejecuta, **No eliminar (restaurar)** las descarta y restaura los archivos desde la nube en la próxima sincronización. Las eliminaciones que confirmaste tú mismo en Plainva no se retienen; en eliminaciones grandes (más de 10 archivos o más del 20 % del vault), Plainva pide en su lugar una segunda confirmación antes de eliminar.
- Los adjuntos (imágenes, etc.) también se sincronizan.
- **Las carpetas vacías** también se sincronizan: una carpeta creada en Plainva aparece de inmediato en la nube, y las carpetas vacías en la nube aparecen en tus otros dispositivos a más tardar en el próximo listado completo.
- Las credenciales y los tokens se guardan en el llavero del sistema operativo (estado: **Configuración → App → Acerca de y diagnóstico → Llavero del sistema**), nunca en archivos dentro del vault.
- **Desconectar** detiene la sincronización del vault; no se elimina ningún archivo en ningún sitio al hacerlo.

## WebDAV / Nextcloud

La ruta más sencilla para servidores autoalojados y la mayoría de los almacenamientos en la nube:

1. En **Cuentas en la nube** → **Conectar cuenta…**, elige la ficha **Nextcloud** (o **WebDAV / CalDAV**).
2. Introduce la **Dirección del servidor**, el **Nombre de usuario** y la **Contraseña o token de aplicación** — usa una contraseña de aplicación en lugar de tu contraseña principal siempre que sea posible (en Nextcloud: Configuración → Seguridad → Contraseñas de aplicación).
3. **Conectar** valida las credenciales; después elige la **Carpeta en la nube** mediante **Elegir carpeta…**.

Particularidad de **Nextcloud**: UN solo formulario cubre archivos **y** calendario — Plainva deriva los endpoints de WebDAV y CalDAV de la propia dirección del servidor (las direcciones derivadas se muestran en el asistente; **Avanzado: definir los endpoints individualmente** permite URLs separadas). Marca ambos servicios y una sola conexión los conecta a los dos.

Las direcciones típicas de servidor (Nextcloud, Koofr, MagentaCLOUD, Storage Box y muchas más) están listadas en [Compatibilidad de sincronización](Sync_Compatibility.md).

## Google Drive

Google Drive funciona actualmente con tus propias credenciales ("Bring Your Own"): creas una vez un proyecto gratuito de Google Cloud, del que solo tú eres propietario. La guía paso a paso: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Versión corta: en **Cuentas en la nube** → **Conectar cuenta…**, elige la ficha **Google**, marca el servicio **Archivos**, introduce el **Client ID** y el **Client Secret** de tu proyecto de Google, y luego **Iniciar sesión con Google…** — el inicio de sesión se abre en tu navegador. Una vez conectado, elige la **Carpeta en la nube** mediante **Elegir carpeta…** directamente desde tu Drive (subcarpetas incluidas, por defecto «Plainva»). Nota: mientras el proyecto de Google esté en modo de prueba, el inicio de sesión caduca a los 7 días y debe renovarse mediante **Volver a conectar** en los detalles de la cuenta.

## OneDrive

Plainva incluye su propio registro de aplicación — **ya no necesitas tu propio ID**:

1. En **Cuentas en la nube** → **Conectar cuenta…**, elige la ficha **Microsoft** y marca el servicio **Archivos** (OneDrive) — si quieres, junto con **Calendario y tareas** y **Correo** (una cuenta de Microsoft puede llevar los tres servicios).
2. **Iniciar sesión con Microsoft…** y confirma el inicio de sesión en el navegador. Listo — Plainva crea la carpeta (por defecto «Plainva») y sincroniza todo su contenido, incluidos los archivos añadidos desde fuera.
3. Opcional: una vez conectado, elige la **Carpeta en la nube** mediante **Elegir carpeta…** directamente desde tu OneDrive (subcarpetas incluidas).

Opcional: mediante **Usar tu propio ID de aplicación** puedes indicar en su lugar un Client ID registrado por ti (p. ej. por restricciones corporativas). Guía detallada: [OneDrive y Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Dropbox

Plainva incluye su propia app de Dropbox — **no hace falta ninguna app propia**:

1. En **Cuentas en la nube** → **Conectar cuenta…**, elige la ficha **Dropbox** (solo lleva el servicio **Archivos**).
2. **Iniciar sesión con Dropbox…** y confirma en el navegador. Listo (carpeta por defecto `/Plainva`).
3. Opcional: una vez conectado, elige la **Carpeta en la nube** mediante **Elegir carpeta…** directamente desde tu Dropbox (subcarpetas incluidas).

Opcional: mediante **Usar tu propio ID de aplicación** puedes indicar en su lugar una App Key registrada por ti. Guía detallada: [OneDrive y Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Almacenamiento compatible con S3

Para AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner y otros — basado en claves, sin ningún inicio de sesión por navegador. En **Cuentas en la nube** → **Conectar cuenta…**, elige la ficha **Almacenamiento de objetos (S3)** y rellena los campos:

| Campo | Significado |
|---|---|
| **Endpoint** | URL base de la API de S3, p. ej. `https://s3.eu-central-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com` o `http://127.0.0.1:9000` para MinIO local |
| **Bucket** | Nombre del bucket |
| **Región** | Región SigV4; "us-east-1" funciona con la mayoría de los almacenes no AWS, Cloudflare R2 usa "auto" |
| **Access Key ID** / **Secret Access Key** | Un par de claves de API del proveedor |
| **Prefijo de clave (opcional)** | Subcarpeta dentro del bucket donde vive el vault; vacío = raíz del bucket |
| **URLs path-style** | Recomendado (MinIO, R2 y la mayoría de los compatibles); desactívalo solo para buckets de AWS virtual-hosted |

Puedes elegir el **Prefijo de clave** (la carpeta en la nube) mediante **Elegir carpeta…** directamente desde el bucket una vez conectado.

Después de **Conectar**, la sincronización empieza de inmediato.

## Ver también

- [Compatibilidad de sincronización](Sync_Compatibility.md) — qué servicios funcionan y cómo, incluida la ruta del cliente de escritorio
- [FAQ y solución de problemas](FAQ.md) — archivos en conflicto, comportamiento sin conexión

## Cifrado de sincronización (frase de contraseña)

> **Reemplazado en P3:** Las instrucciones siguientes ya no se aplican al contenido. Usa [Seguridad y uso compartido](Security_and_Sharing.md). La frase que queda aquí protege solo ajustes y secretos opcionales.

Plainva puede cifrar lo que sale de tu dispositivo hacia el servidor de sincronización, mientras que tu vault local siempre se mantiene en Markdown simple, legible por Obsidian.

Abre **Ajustes → Sincronización → Frase de contraseña de sincronización y cifrado**:

1. **Establece una frase de contraseña.** Esto crea una clave de cifrado para el vault y muestra un **código de recuperación** de un solo uso — guárdalo en un lugar seguro; es la única forma de volver a entrar si olvidas la frase de contraseña. A partir de ese momento, los **ajustes** sincronizados del vault viajan cifrados.
2. **Cifrar el contenido del vault** (opcional). El botón **Cifrar** vuelve a subir cada nota al servidor de sincronización como texto cifrado. Tus archivos locales siguen siendo Markdown simple, así que un vault local nunca corre riesgo — pruébalo primero en un vault desechable. Cuando termine la subida, usa **Finalizar migración** para aceptar solo texto cifrado a partir de entonces.
3. **En otro dispositivo**, abre el mismo vault sincronizado. Plainva detecta que el vault está cifrado y te pide la frase de contraseña (o el código de recuperación). Después de desbloquear, las notas se descifran y aparecen localmente.

La clave desbloqueada se guarda en caché en cada dispositivo. Activa **Requerir frase de contraseña en cada inicio** para volver a introducirla después de cada reinicio en su lugar, y usa **Bloquear** para eliminar la clave en caché de este dispositivo.

**Sincronizar ajustes** transfiere los ajustes compartidos del vault y los metadatos de las cuentas; las rutas locales, el diseño y los datos de ejecución siguen siendo propios de cada dispositivo. **Sincronizar secretos de cuentas** es una opción independiente para contraseñas de aplicación y credenciales BYO permitidas; los tokens OAuth nunca se comparten. El estado de cifrado guía por **Preparación**, **Migración**, **Estricto**, **Descifrado** y **Rotación de clave**. Los dispositivos móviles pueden desbloquear el mismo vault cifrado con su frase de contraseña.
