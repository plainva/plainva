# Tareas

Última actualización: 2026-09-20

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

- **Abiertas / Hechas / Todas** — según el estado de la casilla (empieza en **Abiertas**). Este filtro pertenece a la lista **Todas**; las listas del planificador **Hoy**, **Próximamente**, **Bandeja de entrada** y **Hechas** responden esa pregunta por sí solas.
- **Filtrar tareas…** — texto libre; coincide con el texto de la tarea.
- **Todas las carpetas** — solo tareas en la carpeta elegida (y sus subcarpetas).
- **Todas las etiquetas** — solo tareas que llevan una `#tag` en línea elegida.
- **Con fecha límite** — solo tareas que tienen una fecha `📅`.

Las etiquetas y las fechas límite se leen directamente de la línea de la tarea — por ejemplo `- [ ] Pagar factura #finance 📅 2026-08-01`.

## Marcar tareas

Haz clic en la **casilla** de una tarea para alternarla entre abierta y hecha. El cambio se escribe directamente de vuelta en la nota (como una escritura de archivo normal y segura — solo cambia el carácter `[ ]`/`[x]`), así que la nota, Obsidian y cualquier sincronización permanecen sincronizados. Haz clic en el **texto** de la tarea en su lugar para abrir la nota y saltar a esa línea.

Si una nota cambió desde que se generó la lista, un cambio de estado obsoleto se omite y la lista se actualiza — usa el botón **Actualizar** de arriba a la derecha para recargar en cualquier momento.

## Base de datos de tareas predeterminada

Las casillas son rápidas para anotar, pero a veces una línea se convierte en una tarea "real" — con un estado, una fecha límite y su propia nota. Para eso, elige una **Base de datos de tareas predeterminada** en la configuración, en **Contenido y estructura**: una [base de datos (`.base`)](Databases_Base.md) donde esas tareas viven como notas propias. **Crear base de datos…** prepara una ya lista (carpeta de almacenamiento más una `.base` con una **columna de casilla de hecho** (`hecho`), una columna de estado, una columna de fecha límite, y una vista de tabla, una de tablero y una de cronología — la cronología pone cada tarea en su día de vencimiento); también puedes elegir una base de datos ya existente. La propiedad de casilla es la verdad de finalización de una tarea (activada/desactivada, igual que en los proveedores); la columna de estado se mantiene coherente cuando la marcas. Una base de datos sin columna de casilla recurre a la convención de estado: la primera opción = abierta, la última = hecha.

Una vez configurada, la vista Tareas muestra dos secciones: las entradas de la **Base de datos de tareas** arriba, y **Desde notas** abajo — la lista de casillas de siempre. El estado se puede editar directamente en la vista general: la casilla ES la propiedad de casilla de hecho de la nota y la alterna (la columna de estado la sigue), y al hacer clic en el chip de estado se abre un menú con todas las opciones (**Cambiar estado**). Los filtros **Abiertas**/**Hechas**/**Todas** se aplican a ambas secciones, y **Abrir como base de datos** salta a la vista completa de la base de datos con su tablero y sus filtros. **Actualizar** además dispara una sincronización real con el proveedor cuando hay cuentas conectadas.

## Convertir una casilla en una tarea de base de datos

Cada fila de casilla lleva un icono de base de datos: **Mover a la base de datos de tareas**. Un clic

- crea una nueva nota en la carpeta de almacenamiento de la base de datos (usando su plantilla predeterminada, si tiene una),
- traslada una fecha `📅` a la columna de fecha límite, establece la primera opción de estado para las tareas abiertas y guarda las `#tags` de la línea como etiquetas de la nota,
- enlaza la nueva nota con su nota de origen mediante una propiedad `source`, y
- reemplaza la línea de la casilla en la nota de origen por un enlace interno a la nueva nota de tarea — el elemento sigue siendo legible donde se escribió, y la tarea ahora vive en la base de datos.

Haz **clic derecho** en el icono para elegir en su lugar otra base de datos como destino; sin una base de datos de tareas predeterminada, el clic abre ese selector directamente. Todo sigue siendo Markdown puro: la nueva tarea es una nota normal con frontmatter, y el enlace en la nota de origen es un `[[enlace interno]]` normal.

**+ Nueva tarea** en la cabecera de la sección coloca el cursor en el campo de captura situado encima de las listas (ver *Planificador, captura rápida, prioridad y estados* más abajo). La tarea se crea directamente en la base de datos de tareas — misma carpeta de almacenamiento, misma plantilla y los mismos valores predeterminados que al promover una casilla — y un aviso ofrece **Abrir**. Las casillas escritas en una nota permanecen en esa nota — solo se convierten en tareas de la base de datos cuando las mueves.

## Bloquear tiempo para una tarea

Una tarea tiene una fecha de vencimiento y puede llevar una **hora del día** (`2026-09-21T14:00`) — es entonces cuando Plainva te avisa. Una hora es un instante, no un intervalo. Cuando quieras reservar un hueco para una de ellas, Plainva crea un **evento** — ese es el objeto que posee un intervalo de tiempo, se dibuja con sus solapamientos en la cuadrícula y se sincroniza con tu cuenta de calendario.

El icono de calendario en una fila de tarea abre **Bloquear tiempo**: la fecha (prerrellenada con el vencimiento), el inicio y la **Duración** (15 min, 30 min, 1 h, 2 h o **Personalizada**), además de un selector de calendario cuando hay más de uno con permiso de escritura. El evento lleva el título de la tarea y enlaza de vuelta a la nota. Un **clic derecho** en la fila muestra las mismas acciones que la hoja en el teléfono: hecha/abierta, mover a la base de datos, repetición, bloquear tiempo.

En una tarea de la base de datos, la nota además recuerda el bloque en su frontmatter (`plainva.blocks`), de modo que el enlace es visible desde ambos lados. Una fila con casilla no tiene nota propia — allí solo se crea el evento, que apunta a la nota en la que está la fila. El icono solo aparece si hay una cuenta de calendario conectada.

## Tareas repetitivas

Una tarea que vuelve con regularidad obtiene una **Repetición** mediante el icono de repetición en la sección **Base de datos de tareas**. Plainva no crea una **serie**: marcar la tarea como hecha crea la **siguiente** como su propia nota junto a la terminada, con la nueva fecha de vencimiento. De ese modo solo hay una tarea abierta a la vez, la terminada queda como registro de lo hecho, y no existe una serie invisible de la que se pueda borrar todo por accidente — elimina una tarea y la cadena termina.

El diálogo ofrece tres cosas:

- **Ritmo** — Diaria, Semanal, Mensual o Anual, más el intervalo bajo **Cada** (por ejemplo, «Cada 3» + «Diaria» = cada tres días).
- **Contado desde: El vencimiento** — una cadencia fija («cada lunes»). Si marcas como hecha con retraso una tarea vencida, Plainva salta al siguiente vencimiento **en el futuro** en lugar de llenar la lista con las que se te pasaron.
- **Contado desde: La finalización** — el ritmo empieza el día en que la marcas como hecha («cada tres días después de regar las plantas»).

**No repetir** elimina la repetición de nuevo. Las tareas mensuales nunca se desplazan más allá del fin de un mes: el 31 de enero más un mes es el 28 o el 29 de febrero, no el 3 de marzo.

En el **calendario**, por eso, una tarea repetitiva aparece solo **una vez**, en su fecha de vencimiento actual, con un icono de repetición en la fila. Eso no es un defecto, sino la otra cara del generador: no existe una serie de la que el calendario pueda dibujar más repeticiones, y las filas sin una nota detrás no se podrían abrir. En cambio, establecer la repetición en el **evento vinculado** (mediante **Bloquear tiempo**) sí es una serie de eventos real: tu proveedor la expande y ves muchas repeticiones — pero eso no crea **ninguna tarea**, solo eventos.

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

<!-- accounts-tasks-2026-09-11 -->
## Separar tareas con el mismo título

Las tareas del proveedor se identifican por su identidad. Las distintas repeticiones tienen archivos propios. Los falsos conflictos existentes pueden conservarse como tareas separadas.

Estos archivos pertenecen a tareas diferentes. Las tareas recurrentes con el mismo título pueden ser instancias distintas. Ambos contenidos se conservan como tareas separadas.

**Conservar como tareas separadas** — Este archivo no cambia: Archivo actual  La copia en conflicto se conserva como archivo independiente: copia de conflicto

<!-- tasks-jex-2026-09-14 -->
## Metadatos de Tasks y repetición

Escritorio, móvil y vista previa en vivo reconocen ➕ creación, ✅ finalización, 📅 vencimiento, ⏳ planificación, 🛫 inicio, 🆔 ID y 🔁 repetición. Fechas: YYYY-MM-DD. Los ID existentes sobreviven al mover líneas; los datos desconocidos permanecen en Markdown.

Solo se automatizan las reglas en inglés `every [N] day/week/month/year[s] [when done]` (N: 1–999). Completar avanza un período, aunque siga vencido; `when done` cuenta desde la finalización. Se conservan las distancias entre fechas y se ajusta el fin de mes. Sin fecha, la siguiente sigue sin fecha. Reglas complejas, dependencias, ID de bloque o duplicados, fechas inválidas, contenido indentado, repetición nativa y tareas de proveedores desactivan este generador.

Marcar añade la fecha de finalización a las tareas con metadatos. La repetición admitida añade un ID si falta y un ID `pv-…` distinto a la siguiente. Casilla y sucesora forman una sola edición Markdown; Deshacer revierte toda la edición. Reabrir y marcar otra vez conserva la sucesora y sus cambios.

Las tareas nativas de base de datos siguen saltando períodos vencidos. Un plan de destino guardado evita duplicados. Si no se confirma la sucesora, revisa la carpeta; reabrir y marcar puede reanudar un fallo de escritura. Si la fuente cambió, no se escribe una copia diferente: revisa las notas y crea la sucesora manualmente si hace falta. Una sucesora confirmada y borrada después no se restaura.

## Restaurar filtros de tareas

El estado, texto de búsqueda, carpeta, etiqueta, filtro de vencimiento y visibilidad de tareas ocultas se recuerdan por bóveda en este dispositivo, incluso al abrir una nota o reiniciar. « Restablecer filtros » vuelve a las tareas abiertas sin otros filtros. Las carpetas y etiquetas no disponibles siguen visibles y se pueden quitar desde sus selectores. Olvidar la bóveda elimina este estado. La base de tareas predeterminada conserva su configuración de bóveda; los filtros no se sincronizan.

<!-- planner-capture-2026-09-20 -->
## Planificador, captura rápida, prioridad y estados

La vista de tareas se abre en **Hoy**. Las listas — una barra a la izquierda en el escritorio, un segmento encima de la lista en el teléfono — son **Hoy** (lo que vence hoy, con **Atrasadas** arriba), **Próximamente** (los próximos 14 días, por día), **Bandeja de entrada** (tareas abiertas sin fecha), **Todas** (las dos secciones descritas arriba, con el filtro **Abiertas**/**Hechas**/**Todas**) y **Hechas**. Cada lista se nutre de ambas fuentes, la base de datos de tareas y las casillas de tus notas, ordenadas por prioridad, luego por hora, luego por título. Los demás filtros se aplican a cada lista, y la lista elegida se recuerda por vault. En el escritorio, la barra también lista las etiquetas más frecuentes como filtros de un clic; en el teléfono, la pantalla **Hoy** lleva a la **Hoy** del planificador.

Encima de las listas está el campo de captura; en el teléfono, **+ Nueva tarea** y el botón **＋** lo abren como una hoja. Escribe una línea — `Enviar oferta mañana 14:00 !!! #cliente cada semana` — y pulsa Intro: Plainva crea la tarea en la base de datos de tareas. Entiende hoy, mañana, pasado mañana, los días de la semana, «en 3 días», «la próxima semana», fechas en cifras, una hora (`14:30`, `2 pm`), un ritmo (diario, semanal, mensual, anual, «cada lunes», «cada 2 semanas»), `!`, `!!` y `!!!` para prioridad baja, media y alta, y `#tags` — las palabras en el idioma de la aplicación, cifras y signos en cualquier idioma. Todo lo reconocido queda marcado dentro del campo y se lista debajo como un bloque eliminable **antes** de que se guarde nada; si quitas un bloque, sus palabras vuelven a contar simplemente como título. En el teléfono, unos botones rápidos escriben las mismas palabras por ti. Si la base de datos de tareas nombra una lista de un proveedor, un chip decide si la tarea se crea también allí.

**Establecer prioridad** en el menú de una fila (clic derecho en el escritorio, mantener pulsado en el teléfono) ofrece **alta**, **media**, **baja** y **ninguna**; una bandera delante del título la muestra. En la base de datos de tareas, la prioridad es una columna de selección: una base de datos creada ahora ya la tiene, una más antigua la recibe la primera vez que estableces una prioridad — nunca por el simple hecho de abrirla. Una casilla lleva la marca del plugin Obsidian Tasks en su línea: Plainva lee 🔺 y ⏫ como alta, 🔼 como media, 🔽 y ⏬ como baja, y escribe ⏫, 🔼 o 🔽.

`- [/]` (**En curso**) y `- [-]` (**Cancelada**) también son tareas. Reciben su propia casilla en el editor, en el modo de lectura y en cada lista; en curso cuenta como abierta, cancelada como cerrada. Un clic solo sigue alternando entre abierta y hecha — completa una tarea en curso y reabre una cancelada. **Establecer estado** en el menú de la fila fija los dos estados; Plainva no los escribe nunca por su cuenta.

Más formas de entrada: **Nueva tarea** en el menú de la bandeja del sistema en el escritorio (cuando Plainva sigue ejecutándose en segundo plano), en Android el acceso directo del launcher **Nueva tarea** (mantén pulsado el icono de la app), y en el teléfono **Crear como tarea** cuando compartes algo con Plainva — el texto y los archivos adjuntos terminan en la nota de la tarea. Cómo te avisa una tarea con hora se describe en [Calendario y tareas externas](Calendar_and_Tasks.md).
