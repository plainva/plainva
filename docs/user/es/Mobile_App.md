# La aplicación móvil

Última actualización: 2026-07-29

Plainva también está disponible como aplicación para Android e iOS. Funciona sobre los mismos archivos Markdown, el mismo formato **OKF** y el mismo motor de sincronización que la aplicación de escritorio — tu bóveda se mantiene idéntica en ambos mundos.

## Instalar la aplicación

La aplicación móvil está en **beta cerrada**. En **Android** entras en dos pasos: únete al grupo de probadores desde [plainva.com/android-beta](https://plainva.com/android-beta) y luego acepta en Google Play. En **iPhone**, la distribución va por TestFlight; la lista de espera está en [plainva.com](https://plainva.com).

Google solo publica la aplicación en la Play Store pública cuando 12 probadores permanecen 14 días seguidos, así que unirse y dejarla instalada ya ayuda.

## Diseño

- **Barra inferior:** **de tres a cinco** áreas de tu elección — ya no hay una pestaña fija **Más**; el espacio pertenece a tus áreas.
- **Cada área** (Notas, Hoy, Etiquetas, Marcadores, Calendario, Bases de datos, Tareas, Correo electrónico, Grafo) queda a un toque de distancia mediante la **hoja de áreas**: bien el **▾ junto al título** en la barra superior, bien un **toque prolongado en la barra inferior**. La hoja marca el área actual y lleva directamente, en la parte inferior, a **Organizar la barra de navegación…**.
- **Configurar la barra:** **Ajustes** → **Barra de navegación**. Usa **−**/**+** para definir cuántas áreas muestra la barra (de 3 a 5, con vista previa en vivo) y el **tirador** para organizar la lista: las entradas de arriba forman la barra (marcadas con un recuadro), arrastrar una hacia arriba la incorpora a la barra. Arrastrar hasta el borde superior o inferior hace que la lista se desplace también, de modo que un solo movimiento cubre toda la lista. La vista previa muestra exactamente las etiquetas que usa la propia barra. Nada se oculta nunca — lo que no está en la barra sigue siendo accesible mediante la hoja de áreas. Si el área en la que estás sale de la barra, la app pasa a la primera visible.
- **＋** flota como un botón redondo sobre la barra y abre la creación rápida: nota, nota diaria, carpeta, base de datos, «Desde plantilla…».
- **Barra superior:** el título con **▾** (abre la hoja de áreas), la búsqueda y los **Ajustes** (⋮); la pantalla de inicio muestra además «Abiertos recientemente» y tus marcadores.
- **Ajustes:** el botón ⋮ abre primero la lista de áreas (como el panel izquierdo de la configuración de escritorio) — un toque abre esa página. Arriba del todo, **Vault activo** lleva a la gestión de vaults: cambiar de vault (marca de verificación = activo), **Crear un vault** y **Conectar una bóveda en la nube**.

## Leer y editar notas

Las notas se abren **renderizadas y de solo lectura**; el lápiz de arriba a la derecha cambia al modo de edición (con una barra de herramientas sobre el teclado: formato, listas, enlace interno, comandos de barra oblicua, insertar foto). Las inclusiones `![[Nota]]` aparecen como tarjetas de vista previa que se pueden tocar.

El botón **Detalles de la nota** en la cabecera (entre el marcador y el menú ⋮) abre la ficha contextual de la nota: propiedades (editables directamente), retroenlaces, esquema, grafo y el **historial de versiones** — cada edición crea automáticamente snapshots que puedes revisar, comparar y restaurar. El código fuente Markdown y la búsqueda en la nota están en el menú ⋮.

## Plantillas

Las plantillas se comportan exactamente igual que en el escritorio: los marcadores de posición (`{{title}}`, `{{date}}`, `{{daily+1}}`, `{{weekday:monday}}` …) se rellenan al crear la nota, **todas** las preguntas de una plantilla llegan juntas en **una sola** hoja — cancelarla no crea nada — y `{{cursor}}` coloca el cursor al abrirse la nota.

Las reglas **carpeta → plantilla** y **tipo de nota → plantilla** se definen en el escritorio; viajan con la sincronización de ajustes y también se aplican aquí — de modo que una nota en `Projekte/` empieza igual en ambos dispositivos, incluida la captura con `＋` y **+ Entrada** en una base de datos. Dos detalles: `{{weekday:…}}` siempre cuenta desde el lunes en el teléfono (el ajuste de inicio de semana todavía no existe ahí), y `{{clipboard}}` pide el contenido del portapapeles en la misma hoja en lugar de leerlo sin preguntar. La lista completa de marcadores de posición está en [Notas y Markdown](Notes_and_Markdown.md).

## Bases de datos (`.base`)

Las bases de datos `.base` funcionan como en la aplicación de escritorio: cada vista (**Tabla**, **Lista**, **Galería**, **Tablero**, **Calendario**, **Cronología**), la edición tipada de celdas, las tarjetas del **Tablero** se mueven manteniendo pulsado. **Configurar** gestiona las vistas, las columnas, los filtros (incluidos los grupos), el orden y las propiedades. Los esquemas de relación (destinos, cardinalidad) se siguen gestionando en la aplicación de escritorio.

Una vista **Tablón** muestra las notas como un tablero de dos columnas de tarjetas adhesivas: tocar abre la nota, mantener pulsado muestra las acciones (fijar, etiquetas, color, eliminar), arrastrar tras mantener pulsado reordena, y las casillas de verificación se marcan directamente en la tarjeta. El campo de entrada de arriba captura una nota nueva. Consejo: apunta la base de datos a tu carpeta de entrada (**Ajustes** → **Contenido y estructura**) y tanto las notas rápidas del ＋ como los textos compartidos desde otras apps caerán directamente en el tablón.

## Tareas

El área **Tareas** reúne todas las casillas de tu vault — todas las líneas `- [ ]` y `- [x]` de todas las notas, agrupadas por nota. Es el resumen basado en líneas que una base de datos no te puede dar, porque una base de datos trabaja con notas completas.

Tocar una tarea abre la nota **en esa línea**; la casilla la marca como hecha y reescribe exactamente el carácter `[ ]`/`[x]`. Las fechas límite (`📅`) y las `#tags` aparecen como chips para no repetirse dentro del texto.

Si tu vault tiene una **base de datos de tareas** (**Ajustes** → **Contenido y estructura**), el área la muestra arriba como su propia sección: marcar, cambiar estado, **+ Nueva tarea** y **Abrir como base de datos**. Cada fila de casilla lleva entonces además un botón que **la mueve a la base de datos** — la línea se queda como enlace interno, y la tarea sigue viviendo como una nota propia.

Dos acciones más sobre una tarea de la base de datos: **Bloquear tiempo** crea un evento de calendario para la tarea cuando hay un calendario conectado (fecha, inicio, duración, más el selector de calendario cuando varios admiten escritura), y la **Repetición** crea la siguiente tarea con una nueva fecha de vencimiento cuando marcas esta como hecha. Ambas se describen en [Tareas](Tasks.md).

## Calendario y eventos

El **Calendario** (pestaña inferior o desde «Más») muestra tus notas diarias en una cuadrícula mensual. El icono del reloj arriba a la derecha abre el **calendario de eventos** con las vistas **Día**, **3 días** y **Agenda** — tus calendarios conectados usan el mismo modelo de cuentas que la aplicación de escritorio. Tocar un evento muestra sus detalles; para una invitación puedes **aceptar**, marcarla como **provisional** o **rechazar** directamente ahí.

Gestiona las cuentas desde el icono de engranaje en el calendario de eventos: conecta **CalDAV** en el dispositivo con una contraseña de aplicación (p. ej. Fastmail, Nextcloud, iCloud); Google y Microsoft se conectan mediante inicio de sesión en el navegador. Por cuenta puedes mostrar u ocultar calendarios individuales.

**El inicio de sesión es por dispositivo.** Lo que se sincroniza son los *ajustes* de tu cuenta, nunca el inicio de sesión en sí — es intencionado: las credenciales no deben salir del dispositivo. Por eso, una cuenta que llegó mediante la sincronización de ajustes aparece en la lista, pero lleva la marca **iniciar sesión**, con una línea debajo que indica qué hacer. Mientras ninguna cuenta haya iniciado sesión en este dispositivo, el calendario lo explica ahí mismo en lugar de quedarse vacío sin más, y **Iniciar sesión en este dispositivo** te lleva a las cuentas. Las cuentas con la sesión iniciada muestran **activa**. Si más tarde una sesión caduca o se revoca, la fila indica **sesión caducada** junto con el motivo, y **Volver a iniciar sesión** la pone en marcha sin eliminar la cuenta: la misma cuenta, los mismos calendarios.

**Un inicio de sesión para todos los servicios — también aquí.** Si una cuenta de Microsoft o Google lleva varios servicios (por ejemplo, archivos y calendario), la vista general de **Cuentas en la nube** ofrece fusionarlos en un único inicio de sesión. Después, un inicio de sesión mantiene activos todos los servicios y no solo uno — antes, un servicio podía seguir funcionando mientras otro de la misma cuenta había caducado en silencio. Un buzón de Gmail queda al margen: funciona por IMAP con contraseña de aplicación y no necesita consentimiento.

## Correo electrónico

En **Ajustes → Correo electrónico** conectas un **buzón de Microsoft** (Outlook.com, Microsoft 365) directamente mediante el inicio de sesión en el navegador, sin contraseña de aplicación. Igual que con el calendario, el inicio de sesión es por dispositivo.

Después puedes abrir **Correo electrónico** como área propia desde el ▾ junto al título y colocarla en la barra de navegación. La línea bajo el título muestra carpeta, mensajes sin leer y cuenta, y abre el selector de carpetas. Toca un mensaje para leerlo; **Guardar como nota** lo archiva en la carpeta **Mail** de tu bóveda (capturarlo dos veces abre la misma nota). Las imágenes remotas siguen bloqueadas hasta que las permitas para ese mensaje: una imagen cargada le indica al remitente cuándo y dónde lo leíste.

**Los buzones IMAP también funcionan en el teléfono.** Añade uno en **Ajustes → Correo electrónico**: elige el proveedor, introduce la dirección y la contraseña de aplicación, y Plainva rellena los servidores. Si tu proveedor no está en la lista, **Avanzado** te permite escribir tú mismo los servidores IMAP y SMTP, los puertos y un nombre de usuario distinto, y una cuenta existente se puede editar más tarde. Para seleccionar varios mensajes, basta con mantener pulsado uno de ellos.

## Sincronización

En los **Ajustes** (⋮), **Vault activo** lleva a la gestión de vaults; ahí conectas el almacenamiento en la nube (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Conectar una bóveda en la nube** trae al dispositivo un vault en la nube ya existente; **Crear un vault** pregunta primero **En este dispositivo** o **En un servicio en línea** y después por la estructura inicial (vacía o una plantilla como PARA) — en la ruta en línea sigue el proceso de conexión: la carpeta de destino en la nube se puede crear nueva ahí mismo mediante **Nueva carpeta**, y la estructura se sube en la primera sincronización. El primer inicio («Conectar una bóveda en la nube») ofrece la misma elección entre un vault existente y uno nuevo en la nube. Cada conexión obtiene su propia bóveda separada en el dispositivo. La página de la bóveda muestra el estado, el progreso, las transferencias pendientes y ofrece **Exportar el vault** (ZIP a través del menú para compartir).

La frecuencia con la que esta bóveda busca cambios remotos se ajusta en la misma página (**intervalo de sincronización**, mínimo 5 segundos); los guardados locales se suben de inmediato en cualquier caso. En Google Drive, OneDrive, Dropbox y S3 la **carpeta en la nube** también puede cambiarse después; en WebDAV la carpeta forma parte de la dirección del servidor, así que allí se vuelve a conectar. Si la sincronización de ajustes está cifrada, puedes activar además **Pedir la frase de contraseña en cada inicio**: la clave no se guarda en el dispositivo. Y **Seguridad y uso compartido** indica ahora abiertamente que los espacios cifrados son experimentales y no han sido auditados de forma independiente: guarda el archivo y el código de recuperación en un lugar seguro.

La página de la bóveda también indica si tu **configuración** te acompaña — como una tarjeta con un estado claro en lugar de un simple botón:

- **No se está sincronizando**: la sincronización de ajustes está desactivada para este vault. Actívala desde el escritorio.
- **Aún no cifrado**: esta bóveda todavía no tiene frase de contraseña de sincronización. Ahora puedes establecer una **en el teléfono**: el asistente muestra el código de recuperación y te pide que vuelvas a escribir dos grupos elegidos al azar antes de que se escriba absolutamente nada. Si ya existe una frase de contraseña en la nube, el teléfono te lo indica y nunca crea una segunda — eso dejaría fuera a todos los demás dispositivos.
- **Aún no desbloqueado en este dispositivo**: tu configuración está almacenada cifrada en la nube. Introduce la frase de contraseña elegida al configurarlo — en el escritorio o aquí, en el teléfono; este dispositivo la desbloquea una vez con ella.
- **Se está sincronizando**: este dispositivo está desbloqueado; las carpetas, las vistas y las reglas de copia de seguridad se mantienen al día con tus otros dispositivos.

Cada tarjeta también indica qué *no* viaja: los inicios de sesión siempre permanecen en el dispositivo (ver [Calendario y eventos](#calendario-y-eventos)).

**Ajustes** → **Seguridad y compartir** indica qué es realmente la conexión y, en un vault de nube normal, configura el espacio de trabajo cifrado directamente en el teléfono (identidad → archivo de recuperación y código → activación). Sin conexión de nube no hay nada que cifrar, y la sección lo dice.

## Red de seguridad

Los snapshots (historial de versiones), un diario de borradores (tras un fallo, la nota ofrece tu último estado sin guardar) y las copias en conflicto con una vista de comparación protegen tus datos. La retención se configura en **Ajustes** → **Copias de seguridad y versionado**.

## Compartir y accesos directos

En Android e iOS, el texto y las URL compartidos se convierten en una nota nueva en la carpeta de entrada; las imágenes y los archivos se importan como adjuntos (hasta 25 MB por archivo). En Android, mantén pulsado el icono para los accesos adicionales **Nueva nota** y **Hoy**. La página del vault permite activar **Sincronizar ajustes** y desbloquear o bloquear de forma segura un vault cifrado con su frase de contraseña.

## Carpetas, fotos y calendario

El botón flotante **Más** sigue disponible dentro de carpetas anidadas y todas las acciones crean en la carpeta abierta. En el encabezado, el **menú de tres puntos** abre los ajustes; las carpetas nuevas se crean desde el botón **Más**.

El botón de foto ofrece **Hacer una foto** o **Elegir de la fototeca**, conserva la posición de inserción y muestra errores de permisos o archivos. Las fotos van a la carpeta de adjuntos de la bóveda, la misma que usa tu ordenador.

**Calendario** abre directamente el calendario del proveedor conectado. Las notas diarias permanecen en **Hoy**; se eliminó la antigua pantalla mensual intermedia sin modificar datos existentes.
