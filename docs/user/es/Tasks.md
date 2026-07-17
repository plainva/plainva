# Tareas

Última actualización: 2026-07-17

La vista **Tareas** reúne en un solo lugar todas las casillas de tu vault: todos los elementos de lista `- [ ]` y `- [x]` de todas tus notas, agrupados por la nota en la que viven. Es la vista de "¿qué me queda por hacer?" sobre Markdown puro — sin plugin, sin archivo especial.

## Por qué una vista aparte (y no una `.base`)

Una [base de datos (`.base`)](Databases_Base.md) trabaja con notas completas — una fila por nota. Una casilla es una sola *línea* dentro de una nota, y una nota puede contener muchas, así que una `.base` no puede listarlas. La vista Tareas se basa en líneas: lee las líneas de tareas directamente, así que una sola nota de proyecto con diez subtareas muestra las diez.

## Abrir la vista Tareas

- Haz clic en el **icono de lista de tareas** en la **barra de acciones** del extremo izquierdo, o
- abre la **paleta de comandos** (`Ctrl/Cmd+P`) y ejecuta **Abrir tareas**.

Se abre como una pestaña, igual que cualquier nota.

## Leer la lista

Las tareas se agrupan por nota; el título de la nota es un encabezado en el que puedes hacer clic para abrir la nota. Cada tarea muestra su casilla y su texto, con un tachado una vez que está hecha. Una **fecha límite** escrita como `📅 2026-08-01` en la línea de la tarea aparece como una pequeña insignia.

## Filtrar

La barra en la parte superior reduce la lista:

- **Abiertas / Hechas / Todas** — según el estado de la casilla (empieza en **Abiertas**).
- **Filtrar tareas…** — texto libre; coincide con el texto de la tarea.
- **Todas las carpetas** — solo tareas en la carpeta elegida (y sus subcarpetas).
- **Todas las etiquetas** — solo tareas que llevan una `#tag` en línea elegida.
- **Con fecha límite** — solo tareas que tienen una fecha `📅`.

Las etiquetas y las fechas límite se leen directamente de la línea de la tarea — por ejemplo `- [ ] Pagar factura #finance 📅 2026-08-01`.

## Marcar tareas

Haz clic en la **casilla** de una tarea para alternarla entre abierta y hecha. El cambio se escribe directamente de vuelta en la nota (como una escritura de archivo normal y segura — solo cambia el carácter `[ ]`/`[x]`), así que la nota, Obsidian y cualquier sincronización permanecen sincronizados. Haz clic en el **texto** de la tarea en su lugar para abrir la nota y saltar a esa línea.

Si una nota cambió desde que se generó la lista, un cambio de estado obsoleto se omite y la lista se actualiza — usa el botón **Actualizar** de arriba a la derecha para recargar en cualquier momento.

## Base de datos de tareas predeterminada

Las casillas son rápidas para anotar, pero a veces una línea se convierte en una tarea "real" — con un estado, una fecha límite y su propia nota. Para eso, elige una **Base de datos de tareas predeterminada** en la configuración, en **Contenido y estructura**: una [base de datos (`.base`)](Databases_Base.md) donde esas tareas viven como notas propias. **Crear base de datos…** prepara una ya lista (carpeta de almacenamiento más una `.base` con una columna de estado, una columna de fecha límite, una vista de tabla y una vista de tablero); también puedes elegir una base de datos ya existente.

Una vez configurada, la vista Tareas muestra dos secciones: las entradas de la **Base de datos de tareas** arriba (con estado y fecha límite; **Abrir como base de datos** salta a la vista completa de la base de datos con su tablero y sus filtros), y **Desde notas** abajo — la lista de casillas de siempre.

## Convertir una casilla en una tarea de base de datos

Cada fila de casilla lleva un icono de base de datos: **Mover a la base de datos de tareas**. Un clic

- crea una nueva nota en la carpeta de almacenamiento de la base de datos (usando su plantilla predeterminada, si tiene una),
- traslada una fecha `📅` a la columna de fecha límite, establece la primera opción de estado para las tareas abiertas y guarda las `#tags` de la línea como etiquetas de la nota,
- enlaza la nueva nota con su nota de origen mediante una propiedad `source`, y
- reemplaza la línea de la casilla en la nota de origen por un enlace interno a la nueva nota de tarea — el elemento sigue siendo legible donde se escribió, y la tarea ahora vive en la base de datos.

Haz **clic derecho** en el icono para elegir en su lugar otra base de datos como destino; sin una base de datos de tareas predeterminada, el clic abre ese selector directamente. Todo sigue siendo Markdown puro: la nueva tarea es una nota normal con frontmatter, y el enlace en la nota de origen es un `[[enlace interno]]` normal.

## Ocultar notas de la vista Tareas

Algunas notas contienen casillas que nunca son tareas "reales" — sobre todo las **plantillas**. Para mantenerlas fuera de la lista, una nota puede excluirse a sí misma. La verdad se queda en el archivo: la exclusión es un campo de frontmatter en la nota, no un ajuste oculto de la aplicación. Se sincroniza, es visible en Obsidian y se puede comprobar con cualquier editor de texto:

```yaml
---
plainva:
  tasks: false
---
```

No tienes que escribir este campo a mano:

- **Ocultar de las tareas** — un icono de ojo se encuentra a la derecha de la fila de encabezado de cada nota; un clic escribe el marcador en esa nota y la oculta.
- **Mostrar ocultas** — esta opción en la barra de filtros trae de vuelta las notas ocultas (atenuadas), cada una con un icono **Volver a mostrar en tareas** que elimina el marcador.
- **Ocultar plantillas** — si tu carpeta de plantillas contiene notas con casillas, aparece un botón **Ocultar plantillas** arriba a la derecha que estampa el marcador en todas ellas a la vez.

Las plantillas recién creadas llevan el marcador automáticamente. Cuando creas una nota **a partir de** una plantilla, se elimina de nuevo — la nota nueva es contenido real y muestra sus tareas con normalidad.

## Compatibilidad con Obsidian

Las tareas son casillas GFM (GitHub-Flavored Markdown) normales. Plainva nunca añade una sintaxis especial: las mismas líneas `- [ ]` se renderizan como casillas en Obsidian y se leen con claridad en cualquier editor. Las convenciones `📅 date` y `#tag` son el estilo habitual de Obsidian-Tasks, pero son solo texto en tu nota.

## Ver también

- [Notas y Markdown](Notes_and_Markdown.md) — escribir listas de tareas en el editor
- [Buscar](Search.md) — búsqueda de texto completo en todo el vault
- [Bases de datos (.base)](Databases_Base.md) — bases de datos a nivel de nota
