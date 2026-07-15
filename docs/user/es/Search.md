# Buscar

Stand: 2026-07-15

Plainva ofrece tres formas de buscar: búsqueda de texto completo en todo el vault, el selector rápido para abrir archivos, y buscar y reemplazar dentro de una nota.

## Búsqueda de texto completo en el vault

El campo de búsqueda en la parte superior de la barra lateral busca en todo el vault — títulos *y* contenidos. Se apoya en un índice local de texto completo (SQLite FTS5) que se construye al abrir el vault y se mantiene actualizado con cada cambio; por eso la búsqueda funciona sin conexión y sin retraso apreciable.

La búsqueda reacciona mientras escribes: los prefijos de palabra ya coinciden ("Proy" encuentra "Proyecto plan") — no hace falta pulsar Enter. La **X** a la derecha del campo borra la búsqueda actual (o pulsa `Esc`); la barra lateral vuelve entonces a mostrar el árbol de archivos normal.

La lista de resultados muestra el número de coincidencias arriba y agrupa los resultados: primero las coincidencias de **Nombre de archivo** (el término aparece en el nombre de la nota), luego las de **Contenido**. Cada fila muestra el icono del documento, la ruta de la carpeta y — en las coincidencias de contenido — un fragmento de texto con la coincidencia resaltada. Al hacer clic en un resultado se abre la nota y salta directamente a la primera aparición; ahí queda seleccionada. Si no hay coincidencias, la lista muestra **Sin resultados**.

El campo de búsqueda también se aplica a las demás vistas de la barra lateral: en **Etiquetas** filtra la lista de etiquetas, en **Marcadores** los marcadores.

### Operadores de búsqueda

- `"frase exacta"` — las comillas hacen coincidir la secuencia de palabras exactamente. Esto también sirve como búsqueda de palabra completa para un solo término: `"plan"` encuentra "plan" pero no "planificación".
- `-término` — excluye las notas que contienen el término (también funciona con frases: `-"versión antigua"`).
- `path:carpeta` — solo archivos cuya ruta contiene el texto (p. ej. `path:Proyectos`; con espacios: `path:"Mi Carpeta"`).
- `tag:nombre` — solo notas con esa etiqueta, incluidas las etiquetas anidadas: `tag:proyecto` también encuentra `#proyecto/interno`. `tag:#proyecto` también funciona.
- Los operadores pueden negarse (`-path:Archivo`, `-tag:hecho`) y combinarse libremente con términos de búsqueda: `plan tag:proyecto -borrador`.
- Varios términos se combinan con AND. Los caracteres especiales como `- ( ) : *` dentro de los términos son inofensivos — Plainva trata la entrada de forma literal.

## Selector rápido

`Ctrl+O` o `Ctrl+K` abre el selector rápido: escribe, navega con las teclas de flecha, abre con `Enter`. Sin entrada de texto muestra la lista **Archivos recientes** — la forma más rápida de saltar entre tus notas actuales. Las coincidencias también se pueden abrir directamente en una nueva pestaña (el pie del diálogo muestra las teclas).

La coincidencia es difusa (fuzzy): `prjplan` también encuentra "Project Plan" — las letras solo tienen que aparecer en orden, y los inicios de palabra cuentan extra. Y cuando la nota aún no existe, la lista muestra **Crear '…'**: `Enter` la crea de inmediato (en la raíz del vault) y la abre — escribe un nombre, pulsa Enter, empieza a escribir.

Debajo de las coincidencias de nombre, el selector muestra además un grupo **Contenido**: notas cuyo texto coincide con tu entrada, con un fragmento resaltado de la coincidencia. Abrir una de estas coincidencias salta directamente al punto de la nota — igual que en la búsqueda de la barra lateral.

## Buscar y reemplazar dentro de una nota

`Ctrl+F` abre la barra de búsqueda del editor (en vista previa en vivo y en modo fuente):

- **Buscar** con `Enter`/**siguiente** y **anterior** entre las coincidencias; **todo** resalta cada aparición.
- Opciones: **mayús/minús**, **palabra completa**, **regex**.
- **Reemplazar**: reemplaza coincidencias individuales (**reemplazar**) o **reemplazar todo**.

### En todo el vault

`Ctrl/Cmd+Shift+F` (o **Buscar y reemplazar en el vault** en la paleta de comandos) busca en todas las notas a la vez. Escribe un término, pulsa **Buscar**, y las coincidencias aparecen agrupadas por nota, con una línea de contexto cada una. Escribe un reemplazo, desmarca cualquier nota que quieras dejar fuera, y **Reemplazar en N notas** reescribe el resto — cada nota se guarda de forma segura (escritura atómica + un snapshot de versión), así que una vista previa obsoleta nunca puede sobrescribir contenido más reciente. Mayús/minús, palabra completa y regex también funcionan aquí; en modo regex, las referencias inversas `$1`/`$2` están disponibles en el reemplazo.

## Etiquetas

La vista **Etiquetas** de la barra lateral lista todas las `#etiquetas` del vault con un recuento de coincidencias; un clic muestra los **Archivos con #etiqueta**. Las etiquetas funcionan en el texto (`#proyecto`) y en el frontmatter (`tags: [proyecto]`). El campo de búsqueda de la barra lateral también filtra la lista de etiquetas.

**Renombrar una etiqueta** en todo el vault: haz clic derecho en una etiqueta de la vista **Etiquetas** e introduce un nuevo nombre. Plainva reescribe la etiqueta en todas partes — en el cuerpo de las notas (`#tag` y sus etiquetas anidadas `#tag/child`) y en el frontmatter (`tags:`) — guardando cada nota afectada por la misma vía segura. Las etiquetas no relacionadas que simplemente contienen ese nombre (por ejemplo, `#area/tag`) permanecen intactas.

## Navegar dentro de una nota

El **Esquema** de la barra lateral derecha lista todos los encabezados de la nota activa — un clic salta al punto correspondiente. Para saltar entre notas, también ayudan **Retroenlaces** (quién enlaza aquí) y los botones **Atrás**/**Adelante** del editor.

## Ver también

- [Atajos de teclado](Keyboard_Shortcuts.md)
- [Bases de datos (.base)](Databases_Base.md) — consultas estructuradas sobre propiedades en lugar de texto completo
