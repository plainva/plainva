# Tareas

Última actualización: 2026-08-04
La vista **Tareas** reúne en un solo lugar todas las casillas de tu vault: todos los elementos de lista `- [ ]` y `- [x]` de todas tus notas, agrupados por la nota en la que viven. Es la vista de "¿qué me queda por hacer?" sobre Markdown puro — sin plugin, sin archivo especial.

## Por qué una vista aparte (y no una `.base`)

Una [base de datos (`.base`)](Databases_Base.md) trabaja con notas completas — una fila por nota. Una casilla es una sola *línea* dentro de una nota, y una nota puede contener muchas, así que una `.base` no puede listarlas. La vista Tareas se basa en líneas: lee las líneas de tareas directamente, así que una sola nota de proyecto con diez subtareas muestra las diez.

## Abrir la vista Tareas

- Haz clic en el **icono de lista de tareas** en la **barra de acciones** del extremo izquierdo, o
- abre la **paleta de comandos** (`Ctrl/Cmd+P`) y ejecuta **Abrir tareas**.

Se abre como una pestaña, igual que cualquier nota.

## En el teléfono

La vista Tareas también existe en el móvil. La abres mediante el **▾** junto al título en la barra superior, y puedes colocarla en la barra de navegación (**Ajustes** → **Barra de navegación**).

Muestra las mismas dos secciones que en el escritorio: la **Base de datos de tareas** arriba, la lista de casillas bajo **Desde notas** abajo, con los filtros **Abiertas**/**Hechas**/**Todas** y la búsqueda en texto libre. Marcar, **Cambiar estado**, mover una casilla **a la base de datos**, **+ Nueva tarea**, **Bloquear tiempo** y la **Repetición** funcionan como se describe arriba y escriben los mismos archivos: la misma nota con frontmatter, el mismo `[[enlace interno]]` en la línea original, la misma regla bajo `plainva.repeat`.

Qué base de datos usa tu vault como base de datos de tareas se define en el teléfono, en **Ajustes** → **Contenido y estructura**. El ajuste viaja mediante la [sincronización de ajustes](Sync_Setup.md), así que solo tienes que elegirlo una vez, en el dispositivo que prefieras.

Los cuatro filtros de la barra de escritorio aparecen en el teléfono como chips sobre la lista: **Carpeta**, **Etiqueta**, **Con fecha límite** y **Mostrar ocultas**. Chips en lugar de menús desplegables, porque una barra de filtros sobre una lista ya de por sí estrecha cuesta más espacio del que aporta — un toque abre la selección, un segundo la vuelve a quitar.

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

Las casillas son rápidas para anotar, pero a veces una línea se convierte en una tarea "real" — con un estado, una fecha límite y su propia nota. Para eso, elige una **Base de datos de tareas predeterminada** en la configuración, en **Contenido y estructura**: una [base de datos (`.base`)](Databases_Base.md) donde esas tareas viven como notas propias. **Crear base de datos…** prepara una ya lista (carpeta de almacenamiento más una `.base` con una **columna de casilla de hecho** (`hecho`), una columna de estado, una columna de fecha límite, una vista de tabla y una vista de tablero); también puedes elegir una base de datos ya existente. La propiedad de casilla es la verdad de finalización de una tarea (activada/desactivada, igual que en los proveedores); la columna de estado se mantiene coherente cuando la marcas. Una base de datos sin columna de casilla recurre a la convención de estado: la primera opción = abierta, la última = hecha.

Una vez configurada, la vista Tareas muestra dos secciones: las entradas de la **Base de datos de tareas** arriba, y **Desde notas** abajo — la lista de casillas de siempre. El estado se puede editar directamente en la vista general: la casilla ES la propiedad de casilla de hecho de la nota y la alterna (la columna de estado la sigue), y al hacer clic en el chip de estado se abre un menú con todas las opciones (**Cambiar estado**). Los filtros **Abiertas**/**Hechas**/**Todas** se aplican a ambas secciones, y **Abrir como base de datos** salta a la vista completa de la base de datos con su tablero y sus filtros. **Actualizar** además dispara una sincronización real con el proveedor cuando hay cuentas conectadas.

## Convertir una casilla en una tarea de base de datos

Cada fila de casilla lleva un icono de base de datos: **Mover a la base de datos de tareas**. Un clic

- crea una nueva nota en la carpeta de almacenamiento de la base de datos (usando su plantilla predeterminada, si tiene una),
- traslada una fecha `📅` a la columna de fecha límite, establece la primera opción de estado para las tareas abiertas y guarda las `#tags` de la línea como etiquetas de la nota,
- enlaza la nueva nota con su nota de origen mediante una propiedad `source`, y
- reemplaza la línea de la casilla en la nota de origen por un enlace interno a la nueva nota de tarea — el elemento sigue siendo legible donde se escribió, y la tarea ahora vive en la base de datos.

Haz **clic derecho** en el icono para elegir en su lugar otra base de datos como destino; sin una base de datos de tareas predeterminada, el clic abre ese selector directamente. Todo sigue siendo Markdown puro: la nueva tarea es una nota normal con frontmatter, y el enlace en la nota de origen es un `[[enlace interno]]` normal.

**+ Nueva tarea** en la cabecera de la sección crea una entrada directamente en la base de datos de tareas (misma carpeta de almacenamiento, plantilla y valores por defecto que al mover una casilla) y la abre. Las casillas escritas en una nota permanecen en esa nota: solo se convierten en tareas de la base cuando las mueves.

## Bloquear tiempo para una tarea

En Plainva las tareas tienen granularidad **diaria**: una tarea tiene fecha de vencimiento, no una hora. Cuando quieras reservar un hueco para una de ellas, Plainva crea un **evento** — ese es el objeto que posee un intervalo de tiempo, se dibuja con sus solapamientos en la cuadrícula y se sincroniza con tu cuenta de calendario.

El icono de calendario en una fila de tarea abre **Bloquear tiempo**: la fecha (prerrellenada con el vencimiento), el inicio y la **Duración** (15 min, 30 min, 1 h, 2 h o **Personalizada**), además de un selector de calendario cuando hay más de uno con permiso de escritura. El evento lleva el título de la tarea y enlaza de vuelta a la nota.

En una tarea de la base de datos, la nota además recuerda el bloque en su frontmatter (`plainva.blocks`), de modo que el enlace es visible desde ambos lados. Una fila con casilla no tiene nota propia — allí solo se crea el evento, que apunta a la nota en la que está la fila. El icono solo aparece si hay una cuenta de calendario conectada.

## Tareas repetitivas

Una tarea que vuelve con regularidad obtiene una **Repetición** mediante el icono de repetición en la sección **Base de datos de tareas**. Plainva no crea una **serie**: marcar la tarea como hecha crea la **siguiente** como su propia nota junto a la terminada, con la nueva fecha de vencimiento. De ese modo solo hay una tarea abierta a la vez, la terminada queda como registro de lo hecho, y no existe una serie invisible de la que se pueda borrar todo por accidente — elimina una tarea y la cadena termina.

El diálogo ofrece tres cosas:

- **Ritmo** — Diaria, Semanal, Mensual o Anual, más el intervalo bajo **Cada** (por ejemplo, «Cada 3» + «Diaria» = cada tres días).
- **Contado desde: El vencimiento** — una cadencia fija («cada lunes»). Si marcas como hecha con retraso una tarea vencida, Plainva salta al siguiente vencimiento **en el futuro** en lugar de llenar la lista con las que se te pasaron.
- **Contado desde: La finalización** — el ritmo empieza el día en que la marcas como hecha («cada tres días después de regar las plantas»).

**No repetir** elimina la repetición de nuevo. Las tareas mensuales nunca se desplazan más allá del fin de un mes: el 31 de enero más un mes es el 28 o el 29 de febrero, no el 3 de marzo.

La regla vive en el frontmatter de la nota (`plainva.repeat`) y por eso viaja con tu sincronización — no es un ajuste oculto de la aplicación, ni tampoco una columna de la base de datos, porque pertenece a **esta** tarea, no a cada entrada de la base de datos. Las tareas reflejadas desde una lista de tareas de tu proveedor no ofrecen la repetición: se repiten allí, y un segundo ritmo superpuesto devolvería duplicados al proveedor.

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

## Completar desde la vista general

Al marcar una tarea en la vista general, Plainva escribe la casilla en la nota de origen y actualiza esa nota en el índice antes de consultar de nuevo la lista. La tarea sale de **Abiertas** inmediatamente y no reaparece desde un índice antiguo.
