# Configurar la sincronización

Última actualización: 2026-08-10

Plainva sincroniza opcionalmente cada vault con un almacenamiento a tu elección — directamente desde la aplicación, sin ningún servicio gestionado por Plainva de por medio: tus datos viajan exclusivamente entre tu equipo y tu propia cuenta/servidor. Esta página recorre la configuración por proveedor.

Qué servicios funcionan en general (también mediante WebDAV o el cliente de escritorio del proveedor) se explica en [Compatibilidad de sincronización](Sync_Compatibility.md).

## Fundamentos

- La configuración vive en **Ajustes → tu vault → Cuentas en la nube**: **Conectar cuenta…** abre el asistente — elige primero el **proveedor**, luego marca los **servicios** (para la sincronización de archivos: **Archivos**), luego inicia sesión. La vista de fichas ordena los proveedores por popularidad real; con **Buscar proveedores…** también encuentras los proveedores de correo disponibles como preajuste. **Solo una** cuenta por vault lleva el servicio **Archivos**. La zona **Sincronización** muestra entonces la cuenta conectada con su **Carpeta en la nube** y regula el comportamiento (**Intervalo de sincronización**, cola); **Gestionar cuenta** te lleva de vuelta a las cuentas en la nube.
- Para el servicio **Archivos**, además de **Microsoft** (OneDrive), **Google** (Drive), **Dropbox**, **Nextcloud**, **Almacenamiento de objetos (S3)** y el genérico **WebDAV / CalDAV**, las fichas también incluyen **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru**, **Koofr** y **pCloud**: ahí basta tu dirección de correo más una **contraseña de aplicación** — las direcciones del servidor ya están rellenadas (basado en WebDAV; se puede cambiar mediante **Avanzado: definir los endpoints individualmente**).
- **Abrir un vault en línea ya existente desde la pantalla de bienvenida**: **Abrir vault** → **Vault en línea** te guía por los mismos tres pasos con cualquier proveedor — **1. Conectar** (inicia sesión o introduce las credenciales), **2. Elige la carpeta en la nube** (ahí mismo también puedes crear una carpeta nueva mediante **Nueva carpeta**), **3. Elige o crea la carpeta local**. También puedes configurar la sincronización de un vault ya abierto en cualquier momento desde Configuración.
- **Crear un nuevo vault en la nube**: **Nuevo vault** → **En un servicio en línea** — primero eliges la estructura inicial (vacía o una plantilla como PARA), luego te conectas y eliges la carpeta de destino en la nube o la creas mediante **Nueva carpeta**, y por último la carpeta local. La estructura se crea en la carpeta local y se sube automáticamente en la primera sincronización.
- Los guardados locales se suben de inmediato; Plainva comprueba si hay cambios remotos en el **Intervalo de sincronización (segundos)** configurado.
- Los cambios sin conexión se ponen en cola y se transfieren en el próximo contacto; la barra de estado muestra **En línea**/**Sin conexión** y el indicador de sincronización muestra el estado (**Sincronizar ahora** al hacer clic). Durante una sincronización larga o la primera vez, la barra de estado muestra el progreso como un contador (p. ej., **Sync 123/540**), para que veas cómo va recorriendo el vault.
- Si ambos lados cambian el mismo archivo, Plainva los combina automáticamente (fusión a tres bandas). Si eso no es posible, tu versión se conserva de forma segura como un archivo `.CONFLICT` — nunca se pierde nada (ver [FAQ](FAQ.md)).
- **Resolver conflictos**: un banner en la nota afectada (y **Resolver conflicto…** en el menú contextual del archivo `.CONFLICT` en el árbol) abre el diálogo de comparación — el estado actual del archivo a la izquierda, tu versión conservada a la derecha, editable con toma por bloques. **Guardar la versión derecha y resolver** escribe el resultado en el archivo y limpia la copia de conflicto; **Conservar el otro lado** descarta tu copia (queda una instantánea de versión). El diálogo de error de sincronización también lista las copias de conflicto existentes y lleva a la misma comparación con un clic.
- **Protección contra eliminaciones masivas**: si una parte inusualmente grande de los archivos sincronizados está a punto de eliminarse en la nube de una sola vez (por ejemplo, porque la carpeta local del vault se vació o se movió), Plainva retiene las eliminaciones y pregunta primero: **Eliminar en la nube** las ejecuta, **No eliminar (restaurar)** las descarta y restaura los archivos desde la nube en la próxima sincronización. Las eliminaciones que confirmaste tú mismo en Plainva no se retienen; en eliminaciones grandes (más de 10 archivos o más del 20 % del vault), Plainva pide en su lugar una segunda confirmación antes de eliminar.
- Los adjuntos (imágenes, etc.) también se sincronizan.
- **Las carpetas vacías** también se sincronizan: una carpeta creada en Plainva aparece de inmediato en la nube, y las carpetas vacías en la nube aparecen en tus otros dispositivos a más tardar en el próximo listado completo.
- Las credenciales y los tokens se guardan en el llavero del sistema operativo (estado: **Configuración → App → Acerca de y diagnóstico → Llavero del sistema**), nunca en archivos dentro del vault.
- **Accesos guardados** (**Ajustes → Vault → Sincronización**) muestra lo que Plainva ha guardado en el llavero, incluidas entradas de vaults que hace mucho que no abres. Cada fila indica el servicio y el vault; **Eliminar** pregunta antes. Plainva nunca borra nada aquí por su cuenta.
- **Desconectar** detiene la sincronización del vault; no se elimina ningún archivo en ningún sitio al hacerlo.

## WebDAV / Nextcloud

La ruta más sencilla para servidores autoalojados y la mayoría de los almacenamientos en la nube:

1. En **Cuentas en la nube** → **Conectar cuenta…**, elige la ficha **Nextcloud** (o **WebDAV / CalDAV**).
2. Introduce la **Dirección del servidor**, el **Nombre de usuario** y la **Contraseña o token de aplicación** — usa una contraseña de aplicación en lugar de tu contraseña principal siempre que sea posible (en Nextcloud: Configuración → Seguridad → Contraseñas de aplicación).
3. **Conectar** valida las credenciales; después elige la **Carpeta en la nube** mediante **Elegir carpeta…**.

Particularidad de **Nextcloud**: UN solo formulario cubre archivos **y** calendario — Plainva deriva los endpoints de WebDAV y CalDAV de la propia dirección del servidor (las direcciones derivadas se muestran en el asistente; **Avanzado: definir los endpoints individualmente** permite URLs separadas). Marca ambos servicios y una sola conexión los conecta a los dos.

Las direcciones típicas de servidor (Nextcloud, Koofr, MagentaCLOUD, Storage Box y muchas más) están listadas en [Compatibilidad de sincronización](Sync_Compatibility.md).

Si la contraseña de aplicación cambia más adelante, introdúcela **una sola vez** en los detalles de la cuenta, en **Credenciales**: Plainva la verifica con todos los servicios de esa cuenta y solo la guarda cuando todos la aceptan, de modo que ningún servicio se queda con la contraseña antigua.

## Google Drive

Google Drive funciona actualmente con tus propias credenciales ("Bring Your Own"): creas una vez un proyecto gratuito de Google Cloud, del que solo tú eres propietario. La guía paso a paso: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Versión corta: en **Cuentas en la nube** → **Conectar cuenta…**, elige la ficha **Google**, marca el servicio **Archivos**, introduce el **Client ID** y el **Client Secret** de tu proyecto de Google, y luego **Iniciar sesión con Google…** — el inicio de sesión se abre en tu navegador. Una vez conectado, elige la **Carpeta en la nube** mediante **Elegir carpeta…** directamente desde tu Drive (subcarpetas incluidas, por defecto «Plainva»). Nota: mientras tu proyecto de Google esté en modo **Testing**, el inicio de sesión caduca a los **7 días** — para siempre, porque Google también deja caducar el token de renovación en ese modo, así que Plainva no puede renovarlo en segundo plano. El sync te avisa entonces de que el inicio de sesión ha caducado, y **Volver a conectar** en los detalles de la cuenta lo restablece — una sola ronda para **todos** los servicios de esa cuenta. Si prefieres no hacerlo cada semana, pon el proyecto de Google en **En producción** en la consola: el inicio de sesión entonces permanece válido (en una app no verificada, Google muestra una vez una pantalla de advertencia, que puedes confirmar como su propietario).

Si marcas **Archivos** y **Calendario** juntos al conectar, Google pide tu consentimiento una **sola vez** y solicita exactamente los permisos de los servicios elegidos. Si añades otro servicio más adelante, aparece un segundo consentimiento complementario.

## OneDrive

Plainva incluye su propio registro de aplicación — **ya no necesitas tu propio ID**:

1. En **Cuentas en la nube** → **Conectar cuenta…**, elige la ficha **Microsoft** y marca el servicio **Archivos** (OneDrive) — si quieres, junto con **Calendario y tareas** y **Correo** (una cuenta de Microsoft puede llevar los tres servicios).
2. **Iniciar sesión con Microsoft…** y confirma el inicio de sesión en el navegador. Listo — Plainva crea la carpeta (por defecto «Plainva») y sincroniza todo su contenido, incluidos los archivos añadidos desde fuera.
3. Opcional: una vez conectado, elige la **Carpeta en la nube** mediante **Elegir carpeta…** directamente desde tu OneDrive (subcarpetas incluidas).

Opcional: mediante **Usar tu propio ID de aplicación** puedes indicar en su lugar un Client ID registrado por ti (p. ej. por restricciones corporativas). Guía detallada: [OneDrive y Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

Cuando conectas varios servicios de una misma cuenta juntos —por ejemplo **Archivos** y **Calendario**—, el proveedor pide tu consentimiento solo **una vez**, y Plainva guarda un único inicio de sesión para toda la cuenta. Esto se aplica tanto a **Microsoft** (archivos, calendario, correo) como a **Google** (archivos y calendario; un buzón de Gmail queda al margen, porque funciona por IMAP con contraseña de aplicación y no necesita consentimiento).

Las cuentas que todavía inician sesión por separado en cada servicio ofrecen **Un inicio de sesión para todos los servicios** — en la lista de cuentas y en los detalles de la cuenta, tanto en el escritorio como en la [app móvil](Mobile_App.md). Una sola ronda y, después, todos los servicios comparten el mismo inicio de sesión. Eso es más que comodidad: los inicios de sesión por separado podían desincronizarse, dejando un servicio en marcha mientras otro de la misma cuenta había caducado en silencio. En esas cuentas, **Volver a conectar** ahora renueva la cuenta entera en lugar de un solo servicio.

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

**Cuentas en todos tus dispositivos** son tres pasos. **1 · Ajustes y cuentas**: guarda los ajustes del baúl *y tus cuentas* (calendarios, buzones, selección de calendarios) en un archivo pequeño dentro del baúl — mientras no haya una frase de contraseña configurada no hace falta **ninguna**; en cuanto exista una, cada dispositivo debe introducirla antes de que los ajustes viajen desde él. **2 · Frase de contraseña de sincronización** (opcional): solo es necesaria si también deben viajar los inicios de sesión; además cifra los ajustes del paso 1. **3 · Llevar los inicios de sesión**: lleva además las contraseñas estáticas de IMAP y CalDAV, cifradas, y solo se puede activar cuando el paso 1 está en marcha y la frase de contraseña está desbloqueada — una contraseña solo puede viajar a una cuenta que el dispositivo ya conoce. No se llevan: rutas propias del dispositivo ni inicios de sesión OAuth (Microsoft, Google); sus tokens están ligados al dispositivo, así que la cuenta aparece en el nuevo dispositivo y allí necesita **Iniciar sesión** una vez.

En el **teléfono** encuentras la misma cadena en la página del baúl, con los mismos tres pasos y el mismo bloqueo. Las cuentas que llegan de otro dispositivo se crean allí; ya no las introduces a mano. Con **Traer desde otro dispositivo ahora** las obtienes de inmediato en lugar de esperar a la próxima ronda.

Si Plainva avisa de que una **versión anterior sigue publicando datos de cuenta retirados**, actualiza Plainva en todos los dispositivos que usan este vault. El dispositivo actual ignora las antiguas credenciales de cliente de Google y conserva su inicio de sesión local operativo. No confirmes la eliminación de los datos remotos antiguos hasta que se hayan actualizado todos los dispositivos participantes. Plainva ofrece el botón en el aviso bajo **Ajustes → Vault → Sincronización → Diagnóstico**: **Eliminar entradas retiradas**; la pregunta que hace es exactamente esa confirmación.

## Qué viaja y qué se queda aquí

Si aparece **Revisar cuentas duplicadas** en **Cuentas en la nube**, Plainva no decide por el nombre. Elige **Conservar esta cuenta** en la tarjeta correcta. La confirmación muestra el destino, los orígenes y los servicios afectados, y antes crea una copia de seguridad en este dispositivo. **Cancelar** no cambia nada. La combinación solo elimina cuentas locales, cachés y credenciales huérfanas; no elimina nada del proveedor.

<!-- plainva:profile-areas accounts content calendar mail backup sync layout -->

| Viaja con la bóveda | Se queda en este dispositivo |
| --- | --- |
| Cuentas: calendarios, buzones, cuentas en la nube, marcadores | Rutas absolutas: ubicación de la bóveda, destino de las copias |
| Carpetas y plantillas: notas diarias, carpeta de plantillas, carpeta de entrada, carpeta de adjuntos, base de tareas | Tokens de inicio de sesión de Microsoft y Google |
| Ajustes del calendario: carpeta de reuniones, calendario predeterminado | Qué buzón y qué carpeta tuviste abiertos por última vez |
| Ajustes de correo: carpeta de archivo, imágenes remotas | La disposición inicial de este dispositivo para bóvedas nuevas |
| Reglas de copia: intervalo de instantáneas, retención, archivos | Contraseñas estáticas, salvo que el paso 3 esté activado |
| Intervalo de sincronización |  |
| Disposición de las barras (escritorio) |  |

El teléfono lleva un poco menos: la disposición de las cuatro barras de **escritorio** se queda en el equipo — su propia barra de navegación sí viaja, y también la carpeta de reuniones. Su propia cadena en la página de la bóveda muestra lo que sí lleva, y ambos dispositivos indican debajo lo que la sincronización hizo realmente por última vez, con los nombres de los ajustes que viajaron y, en una recepción, los que cambiaron. El aviso «Ajustes adoptados de otro dispositivo» aparece como máximo una vez por sesión y solo si algo cambió de verdad; después lo indican estas líneas. Nuevo en esta versión: el teléfono también adopta el formato de nombre de las notas diarias, el tipo OKF de las notas nuevas y tus marcadores. Antes, una bóveda con otro formato de fecha obtenía una segunda nota diaria para el mismo día en cuanto el teléfono la tocaba.

El diagnóstico separa ahora **última comprobación** (campos locales del perfil), **última descarga**, **última aplicación** y **último envío real**. «Enviado» solo cambia después de escribir correctamente en la nube; las rondas sin cambios actualizan la comprobación y la descarga, pero no la hora de envío. Los resultados de credenciales aparecen aparte como recuentos de importadas, sin cambios, rechazadas, obsoletas, fallidas o en espera de una cuenta. Solo contienen códigos de motivo estables: nunca id de cuenta, contraseña, token ni error sin redactar. Un aviso de cliente antiguo indica que hay que actualizar Plainva en todos los dispositivos participantes; este dispositivo ignora los datos retirados del cliente de Google.

## Errores y reintento automático

El diálogo conserva el intento fallido exacto aunque un reintento automático ya haya cambiado el estado en vivo. Indica si el reintento está en curso o ha funcionado. Solo recomienda volver a conectar ante un error de autenticación; los errores de red, tiempo de espera y proveedor conservan sus detalles y se reintentan automáticamente.

## Nombres que solo se diferencian en la escritura

Google Drive no distingue mayúsculas de minúsculas al buscar, y Windows y macOS guardan `Nota.md` y `nota.md` en el mismo archivo. Si una carpeta contiene dos notas cuyos nombres solo se diferencian en eso —o solo en cómo se escribe una letra acentuada (`ü` como un carácter o como `u` con diéresis)—, Plainva no puede distinguirlas en el otro extremo. Entonces la sincronización no modifica ni borra nada y, en su lugar, informa de un error con ambos nombres. Cambia el nombre de una de las dos notas y la sincronización continúa.
