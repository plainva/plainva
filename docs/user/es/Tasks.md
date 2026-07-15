# Tareas

Stand: 2026-07-15

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

## Compatibilidad con Obsidian

Las tareas son casillas GFM (GitHub-Flavored Markdown) normales. Plainva nunca añade una sintaxis especial: las mismas líneas `- [ ]` se renderizan como casillas en Obsidian y se leen con claridad en cualquier editor. Las convenciones `📅 date` y `#tag` son el estilo habitual de Obsidian-Tasks, pero son solo texto en tu nota.

## Ver también

- [Notas y Markdown](Notes_and_Markdown.md) — escribir listas de tareas en el editor
- [Buscar](Search.md) — búsqueda de texto completo en todo el vault
- [Bases de datos (.base)](Databases_Base.md) — bases de datos a nivel de nota
