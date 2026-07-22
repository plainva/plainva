# La aplicación móvil

Última actualización: 2026-07-22

Plainva también está disponible como aplicación para Android e iOS. Funciona sobre los mismos archivos Markdown, el mismo formato **OKF** y el mismo motor de sincronización que la aplicación de escritorio — tu bóveda se mantiene idéntica en ambos mundos.

## Diseño

- **Barra inferior:** tres pantallas de disposición libre más la pestaña fija **Más**. **Más** enumera todas las pantallas (Notas, Hoy, Etiquetas, Marcadores, Calendario, Bases de datos, Grafo) — un toque la abre, el **tirador** reordena la lista: las tres primeras forman la barra (marcadas con un recuadro), arrastrar una hacia arriba la incorpora a la barra.
- **＋** flota como un botón redondo sobre la barra y abre la creación rápida: nota, nota diaria, carpeta, base de datos, «Desde plantilla…».
- **Barra superior:** búsqueda y los **Ajustes** (⋮); la pantalla de inicio muestra además «Recientes» y tus marcadores.
- **Ajustes:** el botón ⋮ abre primero la lista de áreas (como el panel izquierdo de la configuración de escritorio) — un toque abre esa página. Arriba del todo, **Vault activo** lleva a la gestión de vaults: cambiar de vault (marca de verificación = activo), **Crear un vault** y **Conectar una bóveda en la nube**.

## Leer y editar notas

Las notas se abren **renderizadas y de solo lectura**; el lápiz de arriba a la derecha cambia al modo de edición (con una barra de herramientas sobre el teclado: formato, listas, enlace interno, comandos de barra oblicua, insertar foto). Las inclusiones `![[Nota]]` aparecen como tarjetas de vista previa que se pueden tocar.

El botón **Detalles de la nota** en la cabecera (entre el marcador y el menú ⋮) abre la ficha contextual de la nota: propiedades (editables directamente), retroenlaces, esquema, grafo y el **historial de versiones** — cada edición crea automáticamente snapshots que puedes revisar, comparar y restaurar. El código fuente Markdown y la búsqueda en la nota están en el menú ⋮.

## Bases de datos (`.base`)

Las bases de datos `.base` funcionan como en la aplicación de escritorio: cada vista (**Tabla**, **Lista**, **Galería**, **Tablero**, **Calendario**, **Cronología**), la edición tipada de celdas, las tarjetas del **Tablero** se mueven manteniendo pulsado. **Configurar** gestiona las vistas, las columnas, los filtros (incluidos los grupos), el orden y las propiedades. Los esquemas de relación (destinos, cardinalidad) se siguen gestionando en la aplicación de escritorio.

Una vista **Tablón** muestra las notas como un tablero de dos columnas de tarjetas adhesivas: tocar abre la nota, mantener pulsado muestra las acciones (fijar, etiquetas, color, eliminar), arrastrar tras mantener pulsado reordena, y las casillas de verificación se marcan directamente en la tarjeta. El campo de entrada de arriba captura una nota nueva. Consejo: apunta la base de datos a tu carpeta de entrada (**Ajustes** → **Contenido y estructura**) y tanto las notas rápidas del ＋ como los textos compartidos desde otras apps caerán directamente en el tablón.

## Calendario y eventos

El **Calendario** (pestaña inferior o desde «Más») muestra tus notas diarias en una cuadrícula mensual. El icono del reloj arriba a la derecha abre el **calendario de eventos** con las vistas **Día**, **3 días** y **Agenda** — tus calendarios conectados usan el mismo modelo de cuentas que la aplicación de escritorio. Tocar un evento muestra sus detalles; para una invitación puedes **aceptar**, marcarla como **provisional** o **rechazar** directamente ahí.

Gestiona las cuentas desde el icono de engranaje en el calendario de eventos: conecta **CalDAV** en el dispositivo con una contraseña de aplicación (p. ej. Fastmail, Nextcloud, iCloud); Google y Microsoft se conectan mediante inicio de sesión en el navegador. Por cuenta puedes mostrar u ocultar calendarios individuales.

## Sincronización

En los **Ajustes** (⋮), **Vault activo** lleva a la gestión de vaults; ahí conectas el almacenamiento en la nube (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Conectar una bóveda en la nube** trae al dispositivo un vault en la nube ya existente; **Crear un vault** pregunta primero **En este dispositivo** o **En un servicio en línea** y después por la estructura inicial (vacía o una plantilla como PARA) — en la ruta en línea sigue el proceso de conexión: la carpeta de destino en la nube se puede crear nueva ahí mismo mediante **Nueva carpeta**, y la estructura se sube en la primera sincronización. El primer inicio («Conectar una bóveda en la nube») ofrece la misma elección entre un vault existente y uno nuevo en la nube. Cada conexión obtiene su propia bóveda separada en el dispositivo. La página de la bóveda muestra el estado, el progreso, las transferencias pendientes y ofrece **Exportar el vault** (ZIP a través del menú para compartir).

## Red de seguridad

Los snapshots (historial de versiones), un diario de borradores (tras un fallo, la nota ofrece tu último estado sin guardar) y las copias en conflicto con una vista de comparación protegen tus datos. La retención se configura en **Ajustes** → **Copias de seguridad y versionado**.

## Compartir y accesos directos

En Android e iOS, el texto y las URL compartidos se convierten en una nota nueva en la carpeta de entrada; las imágenes y los archivos se importan como adjuntos (hasta 25 MB por archivo). En Android, mantén pulsado el icono para los accesos adicionales **Nueva nota** y **Hoy**. La página del vault permite activar **Sincronizar ajustes** y desbloquear o bloquear de forma segura un vault cifrado con su frase de contraseña.

## Carpetas, fotos y calendario

El botón flotante **Más** sigue disponible dentro de carpetas anidadas y todas las acciones crean en la carpeta abierta. En el encabezado, el **menú de tres puntos** abre los ajustes; las carpetas nuevas se crean desde el botón **Más**.

El botón de foto ofrece **Hacer una foto** o **Elegir de la fototeca**, conserva la posición de inserción y muestra errores de permisos o archivos.

**Calendario** abre directamente el calendario del proveedor conectado. Las notas diarias permanecen en **Hoy**; se eliminó la antigua pantalla mensual intermedia sin modificar datos existentes.
