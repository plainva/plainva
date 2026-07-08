# Bases de datos (.base)

Stand: 2026-07-08

Con los archivos `.base` conviertes notas en bases de datos: tablas, tableros, calendarios — con filtros, propiedades tipadas y relaciones entre bases de datos. El concepto se parece a las bases de datos de Notion, con una diferencia decisiva: **los datos no viven en la base de datos, viven en tus notas.**

> **Consejo:** Si creas un nuevo vault a partir de la plantilla **PARA**, **GTD**, **Zettelkasten** o **Journal** (ver [Primeros pasos](Getting_Started.md)), ya tienes bases de datos correspondientes configuradas y enlazadas entre sí — un buen punto de partida para ver cómo encaja todo.

## El concepto central

Un archivo `.base` guarda solo la *vista* de tus notas: qué fuentes (carpetas, etiquetas), qué vistas, qué filtros y columnas. Los valores reales viven en el frontmatter de las notas individuales en Markdown — cada fila de la tabla *es* una nota.

En concreto, eso significa:

- Edita una celda en la tabla y Plainva escribe el valor en el frontmatter de la nota.
- Elimina el archivo `.base` y solo pierdes la vista — todos los datos permanecen en las notas.
- Las mismas notas pueden aparecer en cualquier número de bases de datos a la vez.

El formato de archivo es compatible con el formato Bases de Obsidian (detalles al final de esta página).

## Crear una base de datos

- **Árbol de archivos**: clic derecho → **Nueva base de datos (.base)** — o mediante el botón **Nuevo** de la barra lateral (**Nueva base**).
- El asistente **Nueva base de datos** pregunta dos cosas: la **Fuente de datos** (al menos una **Carpeta** o una **Etiqueta**; combinarlas acota el resultado — un contador en vivo muestra cuántas notas coinciden) y las columnas (propiedades encontradas en las notas coincidentes, listas para adoptar). Luego **Crear base de datos**.
- **Dentro de una nota**: comando de barra oblicua **Incrustar base de datos** (mostrar una `.base` existente en línea) o **Crear base de datos integrada** (crear una nueva `.base` en la carpeta e incrustarla).

Cada base de datos puede llevar su propio icono con un **Color del icono de la base de datos** — visible en el árbol de archivos, las pestañas y el encabezado.

## Vistas

Una base de datos puede tener cualquier número de vistas; cada una tiene un **Tipo de vista**:

| Vista | Para qué sirve |
|---|---|
| **Tabla** | Cuadrícula clásica, ordenable, con edición en línea y subelementos opcionales |
| **Lista** | Lista compacta de filas |
| **Galería** | Tarjetas con una **Imagen de portada** opcional |
| **Tablero** | Columnas al estilo Kanban agrupadas por una propiedad (**Agrupar por**) — arrastrar tarjetas entre columnas cambia el valor; arrastrar un **encabezado de columna** reordena las columnas |
| **Calendario** | Entradas por **Campo de fecha** en un calendario mensual, arrastrables |
| **Cronología** | Eje temporal con **Fecha de inicio** y **Fecha de fin** opcional |

**Añadir vista** crea más; **Opciones de vista** ofrece **Renombrar**, **Duplicar**, **Eliminar** y reordenar por arrastre. Plainva recuerda la última vista activa por archivo. Calendario y Cronología necesitan un campo de fecha (**Solo fecha** o **Fecha y hora** como **Formato**); las entradas muestran los campos activados en **Propiedades**.

## Configurar: fuentes, filtros, orden, propiedades

El botón **Configurar** (arriba a la derecha) abre el panel con cuatro áreas:

- **Fuente de datos** — las fuentes de carpeta y etiqueta de la base de datos (también se puede elegir la **Carpeta raíz**). Sin fuente = todos los archivos.
- **Filtro** — filas de reglas formadas por propiedad, operador y valor. Los operadores se adaptan al tipo de campo: **es** / **no es** / **contiene** / **no contiene** / **está vacío** / **no está vacío**, para números **mayor que** / **menor que** / **como mínimo** / **como máximo**, para fechas **después de** / **antes de** / **desde** / **hasta**. La **Lógica** de arriba decide si deben cumplirse **Todas** las condiciones (Y) o **Cualquiera** (O). **Añadir grupo** construye grupos de filtros al estilo Notion: un cuadro con su propia lógica Y/O dentro de la lógica principal. Los filtros muy anidados procedentes de Obsidian aparecen como **Filtro complejo (no editable)** — se conservan y se aplican. Los filtros se guardan **por vista** (el panel indica **Se aplica a esta vista**): cada vista conserva sus propias reglas de filtro, mientras que la **Fuente de datos** (carpetas/etiquetas) se comparte en toda la base de datos. Todo vive en el archivo `.base`, no en un almacén aparte.
- **Orden** — varias reglas de orden (**Ascendente**/**Descendente**); cambia su prioridad arrastrando.
- **Propiedades** — mostrar/ocultar columnas, reordenar por arrastre, crear una **Nueva propiedad**.

## Propiedades y tipos de campo

Al hacer clic en el encabezado de una columna se abre el editor de propiedades (**Propiedad: X**):

- **Nombre** — renombrar afecta a las notas: al guardar, la propiedad se renombra en el frontmatter de todas las notas coincidentes (con confirmación e indicador de progreso).
- **Tipo de campo** — Texto, Número, Casilla de verificación, Fecha, Fecha y hora, Lista, Etiquetas, Selección, Estado, Selección múltiple, URL, Correo electrónico, Teléfono, Relación (el mismo menú de tipos agrupado que en el panel de **Propiedades** de las notas).
- **Opciones** (para Selección/Estado/Selección múltiple) — valores fijos con un **Color** y, para **Estado**, un **Grupo**/etapa (p. ej. pendiente → en curso → hecho); reordenar arrastrando. Al abrir el editor de la columna, la lista de opciones ya viene rellenada con los valores que se usan en la base de datos, así que puedes asignarle un color a cada uno sin necesidad de volver a escribirlo.
- **Eliminar propiedad** — quita la columna, el esquema, los filtros y las reglas de orden de la base de datos. La casilla **Quitarla también del frontmatter de las notas** (activada por defecto) limpia además las notas de origen.

Notas sobre el comportamiento:

- Si a una propiedad le falta en algunas notas, Plainva ofrece **añadirla (vacía) a N archivos de origen**.
- Para **Selección**, **Estado**, **Selección múltiple**, **Lista** y **Etiquetas**, una coma en un valor separa varias entradas; en el tipo **Texto** la coma se queda como texto normal.
- Los campos de sistema OKF `type` y `okf_version` también están protegidos aquí: nombre, tipo de campo y eliminar están bloqueados, y las celdas de `okf_version` son de solo lectura (contexto: [OKF](OKF.md)).

## Relaciones

Las relaciones enlazan notas entre sí — como en Notion, pero guardadas como `[[enlaces internos]]` completamente normales en el frontmatter (visibles en Obsidian como enlaces de propiedad en los que se puede hacer clic).

- **Crearlas**: añade una propiedad de tipo de campo **Relación**. Opcionalmente elige una **Base de datos de destino (.base)** — entonces el selector solo sugiere notas de esa base de datos (vacío = **Cualquier nota**; **Esta base de datos** permite auto-relaciones). La **Cardinalidad** limita a **Exactamente 1** o permite **Sin límite**.
- **Establecer valores**: el selector busca notas, excluye la entrada actual y puede crear un destino al vuelo mediante **Crear nueva nota**. Un chip que dice "La nota enlazada no existe" marca un enlace roto (destino eliminado o renombrado fuera de Plainva).
- **Relación inversa**: la opción **Mostrar en "X"** crea una columna calculada en la base de datos de destino que muestra los enlaces en sentido inverso — es directamente editable (las ediciones se escriben en las notas que enlazan). Eliminar la relación también elimina su columna inversa.
- **Subelementos**: para las auto-relaciones puedes **Activar subelementos** — las entradas con una relación padre aparecen plegables bajo su entrada padre en la tabla (los ciclos se gestionan; desactivado, la lista permanece plana y los valores se conservan).
- **Tablero por relación**: los tableros pueden agruparse por una relación; arrastrar tarjetas entre columnas reescribe el enlace.
- **Filtrar por relaciones**: contiene / no contiene / está vacío / no está vacío, con un selector de notas.
- Los retroenlaces también cuentan: los enlaces del frontmatter aparecen en el panel de **Retroenlaces**, y los renombrados de archivos actualizan automáticamente los enlaces de relación.

## Crear nuevos elementos

El botón **Entrada** de arriba a la izquierda (antes **Nuevo**; claramente separado del **Nuevo** global de la barra lateral) crea un nuevo elemento:

- El nombre del archivo sigue el patrón `{nombre de la base de datos}_{número correlativo}` (los espacios se convierten en `_`); la nota empieza con un encabezado a juego y hereda las fuentes de etiquetas de la base de datos y los valores de filtro simples, de modo que aparece de inmediato en la vista. Después se abre la ventana de vista previa para rellenarla.
- **Carpeta de almacenamiento**: los elementos nuevos siempre acaban en una carpeta designada. Si la base de datos no tiene ninguna fuente de carpeta, un diálogo te guía una vez por su creación; con varias fuentes de carpeta eliges una vez. Cámbialo en cualquier momento mediante el menú de flecha del botón → **Cambiar carpeta de almacenamiento…**.
- **Plantillas**: el menú de flecha (**Plantillas y carpeta de almacenamiento**) lista las plantillas de la carpeta de plantillas de tu vault — úsala una vez, márcala con una estrella mediante **Establecer como predeterminada** (entonces cada clic en **Entrada** de esta base de datos la usará) o **Crear nueva plantilla** (una plantilla nueva empieza con un encabezado `# {{title}}`, de modo que las entradas creadas a partir de ella heredan el nombre de archivo como H1). El mismo menú también ofrece **Abrir carpeta de plantillas**, que muestra la carpeta de plantillas en el árbol de archivos: las plantillas son notas normales que puedes editar, renombrar o eliminar allí.

## Uso cotidiano

- **Edición en línea**: un solo clic en una celda (o en el valor de una tarjeta) la hace editable — en todas las vistas.
- **Abrir**: un clic en el título de una entrada abre la nota en la ventana de vista previa — una ventana flotante que puedes arrastrar por su barra de título y redimensionar desde la esquina. Mantiene su propio historial de **Atrás**/**Adelante** para las notas que abres dentro de ella, tiene un interruptor que muestra una columna de **Propiedades** para la nota mostrada, y ofrece **Abrir como pestaña** y **Abrir en panel dividido**. `Ctrl`+clic abre directamente en el panel dividido; alternativamente, arrastra una tarjeta a la zona de destino **Suelta aquí: abrir en panel dividido**.
- **Arrastrar**: mientras arrastras tarjetas (Tablero, Calendario, Cronología), una tarjeta fantasma sigue al cursor. En un **Tablero** también puedes arrastrar un **encabezado de columna** para reordenar las columnas — en los tableros de **Selección**/**Estado** esto reordena las opciones de la propiedad (así que los desplegables en todas partes lo siguen); los tableros de relación y de texto libre recuerdan el orden por vista.
- **Color del tablero**: en los ajustes de **Vista** de un tablero, **Color de columna** permite que una columna adopte el color de su grupo — ya sea **Columna completa** (se tiñe toda la columna) o **Solo el chip** (solo el chip de la cabecera, la opción por defecto). Se aplica a los grupos de Selección/Estado/Selección múltiple.
- **Incrustar**: las bases de datos se pueden incrustar en notas (comando de barra oblicua **Incrustar base de datos** o `@` → **Bases de datos**) y usarse ahí con toda su funcionalidad.
- **Alcance automático dentro de un elemento relacionado**: cuando incrustas una base de datos dentro de un único elemento de una base de datos *relacionada*, se filtra automáticamente a ese elemento — incrusta la base de datos de tareas dentro de la nota de un proyecto y solo verás las tareas de ese proyecto. Esto funciona en ambos sentidos (incrusta el lado de "varios" para ver las filas que apuntan al elemento anfitrión, o el lado de "uno" para ver a qué apunta el anfitrión) y también con bases de datos autorreferenciales (auto-relaciones) que tienen una jerarquía de padre y subelementos (incrustar la base de datos dentro de un elemento muestra los subelementos de ese elemento, anidados). Un pequeño chip **Filtro** en el encabezado de la base de datos incrustada muestra a qué está acotada; úsalo para cambiar la relación o elegir **Mostrar todo**. El alcance nunca se escribe en el archivo `.base`, de modo que la misma base de datos muestra las filas correctas en cada elemento en el que está incrustada.
- **Las entradas nuevas heredan el enlace**: crear una entrada con **Entrada** dentro de una incrustación acotada de este tipo la enlaza automáticamente con el elemento anfitrión (una tarea que creas en la lista de tareas incrustada de un proyecto pertenece de inmediato a ese proyecto). En el sentido inverso, es el elemento anfitrión el que se enlaza con la nueva entrada; una relación de valor único ya asignada no se modifica.
- **Filtro explícito "Esta nota" (como el filtro "esta página" de Notion)**: en vez de depender del alcance automático, puedes hacerlo explícito y permanente. En **Configurar → Filtro**, añade una regla sobre una propiedad de relación y elige el valor **Esta nota**. La base de datos queda entonces acotada a la nota en la que esté incrustada — ideal para **plantillas**: incrusta la base de datos de tareas en una plantilla de proyecto, y cada proyecto creado a partir de ella muestra sus propias tareas. Funciona con cualquier propiedad de wiki-link, no solo con relaciones detectadas, y un filtro explícito **Esta nota** tiene prioridad sobre el alcance automático. Este filtro solo vive en Plainva (no se escribe en la `.base` como un filtro normal), de modo que tanto Obsidian como una apertura independiente muestran todas las filas.

## Ejemplo: así se ve un archivo .base

Los archivos `.base` son YAML — aquí una lista de proyectos sencilla:

```yaml
filters:
  and:
    - 'file.hasTag("project")'
properties:
  note.status:
    displayName: Status
    plainva:
      input: status
      options:
        - value: open
          color: teal
          group: Active
        - value: done
          color: gray
          group: Completed
views:
  - type: table
    name: All projects
  - type: table
    name: Board
    plainva:
      render: board
      groupBy: status
```

Todo lo específico de Plainva (colores, representación del tablero, relaciones, carpeta de almacenamiento) vive bajo claves `plainva:`.

## Editar archivos .base directamente (herramientas e IA)

Si un script o un asistente de IA escribe archivos `.base` sin pasar por Plainva, hay tres reglas estrictas importantes — rompe una y Obsidian se niega a abrir todo el archivo:

- **Solo las claves de nivel superior `filters`, `formulas`, `properties`, `views`.** Nunca añadas otra clave de nivel superior; todos los extras de Plainva van bajo subclaves anidadas `plainva:`.
- **Cada vista necesita un `name` de tipo string no vacío.**
- **Un objeto `filters` lleva exactamente uno de `and` / `or` / `not` por nivel** (nunca dos uno al lado del otro).

Una trampa más: los ids de propiedad llevan el prefijo `note.` en el mapa `properties:` y en el `order`/`sort` de una vista (`note.status`), pero van **sin prefijo** dentro de expresiones de filtro (`status == "Done"`) y dentro de subclaves de `plainva` (`groupBy: status`).

El contrato completo tal como queda en el disco — cada campo, el ejemplo completo de relaciones bidireccionales y las reglas de edición segura — está en la [Referencia del formato de archivo](File_Format_Reference.md).

## ¿Y Obsidian?

El formato coincide con el formato Bases de Obsidian; Plainva escribe sus extensiones exclusivamente en subclaves `plainva:`, que Obsidian ignora ("degradación elegante"):

- Obsidian abre el archivo sin errores; las vistas exclusivas de Plainva como Tablero/Calendario/Cronología aparecen ahí como una tabla normal.
- Las columnas de relación inversa aparecen vacías en Obsidian (son calculadas); los valores de relación en las notas se ven ahí como enlaces en los que se puede hacer clic.
- La primera vez que usas una de estas extensiones, un diálogo (**Extensión de Plainva**) lo señala; se puede desactivar en **Configuración** mediante **Bases de datos extendidas** o **Avisos**.

## Ver también

- [Referencia del formato de archivo](File_Format_Reference.md) — el contrato exacto en disco de `.base` para herramientas y edición manual
- [Notas y Markdown](Notes_and_Markdown.md) — propiedades/frontmatter en detalle
- [OKF](OKF.md) — qué aporta en la práctica un `type` uniforme
