# La aplicación móvil

Última actualización: 2026-07-17

Plainva también está disponible como aplicación para Android e iOS. Funciona sobre los mismos archivos Markdown, el mismo formato **OKF** y el mismo motor de sincronización que la aplicación de escritorio — tu bóveda se mantiene idéntica en ambos mundos.

## Diseño

- **Barra inferior:** hasta cuatro pantallas a tu elección (**Notas**, **Hoy**, **Etiquetas**, **Marcadores**, **Calendario**, **Bases de datos**) alrededor del botón fijo **＋**. Cambia la selección en **Ajustes** → **Barra de pestañas**.
- **＋**: un toque crea al instante una nota nueva (en la carpeta visible o, si no existe, en la carpeta de entrada). Mantén pulsado para la creación rápida: nota, nota diaria, carpeta, base de datos, «Desde plantilla…».
- **Barra superior:** búsqueda y el menú **Más**; la pantalla de inicio muestra además «Recientes» y tus marcadores.

## Leer y editar notas

Las notas se abren **renderizadas y de solo lectura**; el lápiz de arriba a la derecha cambia al modo de edición (con una barra de herramientas sobre el teclado: formato, listas, enlace interno, comandos de barra oblicua, insertar foto). Las inclusiones `![[Nota]]` aparecen como tarjetas de vista previa que se pueden tocar.

El botón **Detalles de la nota** en la cabecera (entre el marcador y el menú ⋮) abre la ficha contextual de la nota: propiedades (editables directamente), retroenlaces, esquema, grafo y el **historial de versiones** — cada edición crea automáticamente snapshots que puedes revisar, comparar y restaurar. El código fuente Markdown y la búsqueda en la nota están en el menú ⋮.

## Bases de datos (`.base`)

Las bases de datos `.base` funcionan como en la aplicación de escritorio: cada vista (**Tabla**, **Lista**, **Galería**, **Tablero**, **Calendario**, **Cronología**), la edición tipada de celdas, las tarjetas del **Tablero** se mueven manteniendo pulsado. **Configurar** gestiona las vistas, las columnas, los filtros (incluidos los grupos), el orden y las propiedades. Los esquemas de relación (destinos, cardinalidad) se siguen gestionando en la aplicación de escritorio.

Una vista **Tablón** muestra las notas como un tablero de dos columnas de tarjetas adhesivas: tocar abre la nota, mantener pulsado muestra las acciones (fijar, etiquetas, color, eliminar), arrastrar tras mantener pulsado reordena, y las casillas de verificación se marcan directamente en la tarjeta. El campo de entrada de arriba captura una nota nueva. Consejo: apunta la base de datos a tu carpeta de entrada (**Ajustes** → **Carpetas**) y tanto las notas rápidas del ＋ como los textos compartidos desde otras apps caerán directamente en el tablón.

## Sincronización

En **Más** → **Bóvedas** conectas almacenamiento en la nube (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Conectar una bóveda en la nube** trae al dispositivo un vault en la nube ya existente; **Crear un vault** pregunta primero **En este dispositivo** o **En un servicio en línea** y después por la estructura inicial (vacía o una plantilla como PARA) — en la ruta en línea sigue el proceso de conexión: la carpeta de destino en la nube se puede crear nueva ahí mismo mediante **Nueva carpeta**, y la estructura se sube en la primera sincronización. El primer inicio («Conectar una bóveda en la nube») ofrece la misma elección entre un vault existente y uno nuevo en la nube. Cada conexión obtiene su propia bóveda separada en el dispositivo. La página de la bóveda muestra el estado, el progreso, las transferencias pendientes y ofrece **Exportar el vault** (ZIP a través del menú para compartir).

## Red de seguridad

Los snapshots (historial de versiones), un diario de borradores (tras un fallo, la nota ofrece tu último estado sin guardar) y las copias en conflicto con una vista de comparación protegen tus datos. La retención se configura en **Ajustes**.

## Compartir y accesos directos (Android)

El texto compartido desde otras apps llega como una nota nueva en la carpeta de entrada. Mantén pulsado el icono de la app para los accesos directos **Nueva nota** y **Hoy**.
