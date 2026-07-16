# Referencia del formato de archivo

Stand: 2026-07-16

Esta página es el contrato exacto, tal como queda en el disco, para **cada archivo de un vault de Plainva**. Está escrita para que una herramienta — u otro programa, un script o un asistente de IA — pueda leer y editar con seguridad los archivos del vault directamente, sin pasar por la interfaz de Plainva. Si solo usas la aplicación, nunca necesitas esta página; las [demás páginas de la guía](README.md) cubren el uso normal.

Todo aquí es texto UTF-8 puro. Las notas son Markdown con frontmatter YAML; las bases de datos son YAML. Nada es propietario ni está oculto.

## Reglas de oro (leer primero)

1. **La nota es la fuente de la verdad. Una `.base` es solo una vista.** Los *valores* de las propiedades viven en el frontmatter de las notas individuales — nunca en la `.base`. Para cambiar un valor, edita la nota.
2. **Las notas siguen siendo nativas de Obsidian.** En el frontmatter de una nota, escribe siempre solo escalares y listas simples (string, número, booleano, fecha ISO, lista YAML). Nunca escribas un objeto anidado ni un indicador de "activo/seleccionado" en una nota.
3. **Una `.base` usa solo los cuatro claves de nivel superior de Obsidian** (`filters`, `formulas`, `properties`, `views`). Añadir cualquier otra clave de nivel superior hace que Obsidian rechace todo el archivo. Todos los datos específicos de Plainva van bajo subclaves anidadas `plainva:`.
4. **Conserva lo que no entiendas.** Las claves desconocidas deben sobrevivir intactas a un ciclo de lectura/escritura. No "limpies" claves que no reconozcas.
5. **Escribe UTF-8 sin BOM, con finales de línea LF.**

## El vault de un vistazo

Un vault es una carpeta normal. Los tipos de archivo que encontrarás:

| Archivo | Qué es | Editable como texto |
|---|---|---|
| `*.md` | Una nota: frontmatter YAML + cuerpo Markdown | Sí |
| `*.base` | Una vista de base de datos sobre notas (YAML) | Sí |
| `index.md` | El índice de contenidos gestionado de una carpeta (nombre reservado) | Sí, con cuidado — ver [index.md](#indexmd-índice-de-contenidos-de-una-carpeta) |
| `log.md` | Nombre reservado, actualmente sin uso | Dejar en paz |
| imágenes, PDFs, … | Adjuntos | No (binario) |
| `.plainva/` | Carpeta interna de Plainva (copias de seguridad, estado) | **No — nunca tocar** |

Los nombres reservados `index.md` y `log.md` nunca son notas normales; no crees contenido ordinario bajo esos nombres.

---

## Notas (`.md`)

Una nota es un archivo Markdown. Un bloque opcional de frontmatter YAML (entre dos líneas `---`) en la parte superior contiene sus propiedades; a continuación sigue el cuerpo Markdown.

```markdown
---
type: Note
okf_version: "0.1"
tags: [project, active]
status: In progress
due: 2026-07-20
plainva:
  icon: "🚀"
  header_color: "#2f6f6f"
---
# My Project

A **bold** thought that links to [[Another Note]].

- [ ] First task
```

### Campos de frontmatter OKF

Plainva sigue OKF (Open Knowledge Format), una convención mínima. Dos campos de nivel superior:

| Campo | Tipo | Significado |
|---|---|---|
| `type` | string | Qué clase de documento es (`Note`, `Daily Note`, `Project`, …). El único campo que OKF realmente exige. |
| `okf_version` | string | La versión de la convención con la que se escribió el archivo, p. ej. `"0.1"`. Ponla entre comillas para que YAML la conserve como string. |

Un archivo **sin** `type` se abre igualmente bien; simplemente "no es conforme con OKF". Un `okf_version` ausente por sí solo no es una infracción. Cuando creas una nota nueva, añadir `type` (y `okf_version`) es buena práctica. Ver [OKF](OKF.md) para la justificación completa.

### Serialización de los valores de propiedad

Cada clave de frontmatter es una propiedad. Escribe el valor en la forma YAML nativa de su tipo:

| Tipo de propiedad | Forma YAML | Ejemplo |
|---|---|---|
| Texto | string escalar | `title: Hello` |
| Número | número | `priority: 3` |
| Casilla de verificación | booleano | `done: true` |
| Fecha | string de fecha ISO | `due: 2026-07-20` |
| Fecha y hora | string de fecha y hora ISO | `at: 2026-07-20T14:30:00` |
| Lista | lista YAML de strings | `authors: [Ada, Alan]` |
| Etiquetas | lista YAML de strings | `tags: [project, active]` |
| Selección / Estado | un único string escalar | `status: Done` |
| Selección múltiple | lista YAML de strings | `labels: [urgent, later]` |
| URL / Correo electrónico / Teléfono | string escalar | `site: https://example.org` |
| Relación (simple) | **string** de wiki-link | `project: "[[Project Alpha]]"` |
| Relación (múltiple) | lista YAML de strings de wiki-link | `related: ["[[A]]", "[[B]]"]` |

El valor "activo" de una propiedad de Selección/Estado es justo ese escalar simple. La *paleta de opciones permitidas* y sus colores **no** viven en la nota — viven en la `.base` que la gobierna (ver [Opciones y colores](#opciones-y-colores)). Esto mantiene la nota 100 % nativa de Obsidian.

> Pon los valores de wiki-link entre comillas (`"[[X]]"`). Un `[[X]]` sin comillas es una secuencia de flujo YAML y no se interpretará como pretendes.

### El namespace `plainva:` en las notas

Los extras específicos de Plainva para notas se agrupan bajo una única clave `plainva:` para que otros editores puedan ignorarlos:

| Clave | Valor | Significado |
|---|---|---|
| `icon` | grafema emoji, o `lucide:<kebab-name>` | Icono del documento (al estilo Notion) |
| `icon_color` | color hex (`#rgb` / `#rrggbb` / `#rrggbbaa`) | Tinte para un icono `lucide:` (los emojis lo ignoran) |
| `header_color` | color hex | Franja de encabezado a todo lo ancho |
| `tasks` | `false` | Excluye las casillas de esta nota de la [vista Tareas](Tasks.md) |
| `templateFor` | lista de wiki-links a archivos `.base` | Asigna una **plantilla** a las bases de datos indicadas (solo tiene sentido en notas dentro de la carpeta de plantillas) |

Todos son opcionales. Si no escribes ninguno, omite la clave `plainva:` por completo. Los valores inválidos se ignoran al leer, nunca se tratan como error.

`templateFor` es el contrato de campo de la asignación de plantilla (ver [Bases de datos (.base)](Databases_Base.md)): en una nota dentro de la carpeta de plantillas, enumera las bases de datos cuyo menú **Entrada** muestra la plantilla por defecto. Los valores son wiki-links completos, incluida la extensión `.base` — sin cualificar (`"[[Tasks.base]]"` coincide con el archivo de ese nombre en cualquier carpeta, por lo que sobrevive a simples traslados de carpeta) o cualificados con ruta (`"[[Projekte/Tasks.base]]"` coincide exactamente con esa ruta). Plainva escribe enlaces sin cualificar y solo cualifica cuando existen dos archivos `.base` con el mismo nombre. Se tolera un escalar en lugar de una lista. Cuando se crea una entrada a partir de la plantilla, `templateFor` — a diferencia de las demás claves `plainva:` — **no** se copia en la nota nueva.

### Enlaces

- **Wiki-link:** `[[Nombre de la nota]]` — resuelto por nombre de nota en todo el vault. Con ancla de encabezado: `[[Nota#Sección]]`. Con texto mostrado: `[[Nota|texto mostrado]]`.
- **Enlace Markdown:** `[texto](ruta/relativa.md)` también funciona.
- Los **retroenlaces** se derivan automáticamente, incluso desde wiki-links en frontmatter (eso es lo que hace que las relaciones aparezcan como retroenlaces).

---

## Bases de datos (`.base`)

Un archivo `.base` es YAML. Guarda una *vista* sobre notas — qué notas (fuentes), cómo mostrarlas (vistas), cómo filtrarlas y ordenarlas, y el esquema de columnas. No guarda **ningún valor de nota**. El formato es compatible con el plugin Bases de Obsidian.

### Reglas estrictas — rompe una y Obsidian rechaza todo el archivo

- **Solo estas claves de nivel superior:** `filters`, `formulas`, `properties`, `views`. Nunca añadas otra clave de nivel superior. (Históricamente, una clave `columns:` de nivel superior rompía todos los archivos — no reintroduzcas ese patrón.)
- **Cada vista necesita un `name` de tipo string no vacío.**
- **Un objeto `filters` lleva exactamente uno de `and` / `or` / `not` en cada nivel** — nunca dos uno al lado del otro.

Plainva mismo repara los archivos antiguos que infringen las dos últimas reglas la próxima vez que los guarda, pero una herramienta que escribe directamente debe respetarlas desde el principio.

### Identificadores de propiedad: cuándo usar el prefijo `note.`

Esto confunde a la gente, así que se explica de forma explícita:

| Dónde | Forma | Ejemplo |
|---|---|---|
| Claves del mapa `properties:` | con prefijo | `note.status`, `file.name` |
| La lista `order:` de una vista | con prefijo | `[file.name, note.status]` |
| `sort[].property` de una vista | con prefijo | `note.due` |
| Dentro de expresiones de **filtro** | **sin prefijo** | `status == "Done"` |
| Dentro de subclaves de `plainva` (`groupBy`, `dateField`, `endField`, `subItemsProperty`) | **sin prefijo** | `groupBy: status` |

Regla general: los campos estructurales *de cara a Obsidian* usan `note.<key>` (y `file.<x>` para los integrados como `file.name`, `file.folder`, `file.mtime`); todo lo que está dentro de una **fórmula de filtro** o de un **bloque `plainva`** usa la clave de frontmatter tal cual, sin prefijo.

### Claves de nivel superior

- **`filters`** — qué notas pertenecen a esta base de datos. En Plainva esta clave contiene únicamente las **fuentes** (carpeta/etiqueta); las condiciones de filtro de propiedad se guardan por vista en `views[i].filters`. Ver [Filtros](#filtros).
- **`properties`** — el esquema de columnas, indexado por id de propiedad. Las subclaves nativas de Obsidian como `displayName` (etiqueta del encabezado de columna) están permitidas y se conservan; toda la riqueza de Plainva vive bajo `properties[id].plainva`.
- **`views`** — una lista ordenada de vistas. Cada una necesita un `name` y un `type`.
- **`formulas`** — una función de Obsidian. Plainva no las crea, pero las conserva sin modificar.

### El mapa de subclaves `plainva:`

Todo lo específico de Plainva está bajo namespace. Tres ubicaciones:

**`properties[<note.key>].plainva`** — por columna:

| Clave | Valor | Significado |
|---|---|---|
| `input` | uno de los tipos de entrada de abajo | El tipo de campo de la columna |
| `options` | lista de objetos de opción | Valores curados para selección/estado/selección múltiple |
| `relationBase` | ruta `.base` relativa al vault | Base de datos de destino de la relación (ver [Relaciones](#relaciones-el-contrato-bidireccional)) |
| `relationLimit` | `one` | Cardinalidad: un único enlace. Omitir para ilimitado. |
| `reverseOf` | `{ base, property }` | Marca una columna de **relación inversa calculada** (sin `input`) |

**`views[i].plainva`** — por vista:

| Clave | Valor | Significado |
|---|---|---|
| `render` | `board` / `calendar` / `timeline` | Tipo de vista exclusivo de Plainva (ver abajo) |
| `groupBy` | clave de propiedad sin prefijo | Columna de agrupación del tablero |
| `dateField` | clave de propiedad sin prefijo | Fecha de inicio del calendario/cronología |
| `endField` | clave de propiedad sin prefijo | Fecha de fin de la cronología |
| `coverImage` | clave de propiedad sin prefijo | Propiedad de imagen de portada de la galería |
| `subItemsProperty` | clave de propiedad sin prefijo | Columna de relación padre (auto-relación) para anidar subelementos |
| `widths` | mapa de id → px | Anchos de columna |
| `dateFormat` | string | Formato de fecha por vista (`default` es implícito — omitirlo) |

Además del bloque `plainva`, una vista puede llevar un objeto nativo **`views[i].filters`** — los **filtros de propiedad por vista** (la misma gramática de raíz única `and`/`or`/`not` que el `filters` de nivel de archivo). Plainva guarda aquí las reglas de filtro de propiedad, un conjunto por vista, de modo que cada vista filtra de forma independiente; el `filters` de nivel de archivo conserva entonces solo las fuentes. Obsidian aplica `views[i].filters` por vista de forma nativa.

**`views[0].plainva`** — claves de todo el archivo, permitidas **solo en la primera vista**:

| Clave | Valor | Significado |
|---|---|---|
| `fileIconColor` | color hex | Tinte del icono de la base de datos (árbol/pestañas/encabezado) |
| `newItemFolder` | carpeta relativa al vault | Dónde guarda el botón "Nuevo" los elementos nuevos |
| `newItemTemplate` | ruta `.md` relativa al vault | Plantilla predeterminada para elementos nuevos |
| `contextFilters` | lista de claves de propiedad simples | Filtros de autorreferencia ("Esta nota") — ver abajo |

`contextFilters` es el equivalente en Plainva al filtro "esta página" de Notion. Cada entrada es una clave de propiedad; cuando la base de datos está incrustada en una nota, sus filas quedan acotadas a esa nota anfitriona a través de esa propiedad (resuelto mediante el índice de enlaces — una propiedad de enlace propia (de relación o de wiki-link simple) hace coincidir las filas que apuntan al anfitrión, una columna inversa calculada hace coincidir aquello a lo que apunta el anfitrión). Deliberadamente **no** se escribe en el `filters` nativo, de modo que Obsidian lo ignora y muestra todas las filas; abierta de forma independiente en Plainva también se descarta (no hay anfitrión) y muestra todas las filas. Varias entradas se combinan con Y.

### Tipos de entrada

`plainva.input` es uno de:

```
text  number  checkbox  date  datetime
select  status  multiselect
list  tags  url  email  phone
relation
```

Una columna calculada de **relación inversa** **no** tiene `input` — se identifica únicamente por `reverseOf`.

### Opciones y colores

Las columnas de Selección/Estado/Selección múltiple pueden llevar una lista curada de opciones. Cada opción:

```yaml
options:
  - value: Open          # required
    color: amber         # optional palette name (see below)
    group: Active        # optional; STATUS only — orders options into stages
  - value: Done
    color: green
    group: Closed
```

`color` es un **nombre de paleta**, no un color CSS. Nombres válidos: `gray`, `teal`, `blue`, `green`, `amber`, `coral`, `purple`, `pink`. Un color desconocido recurre a un color derivado del valor.

### Tipos de vista

`views[i].type` en el disco es un tipo nativo de Obsidian. Las vistas exclusivas de Plainva se escriben como `type: table` más un indicador `plainva.render`, de modo que Obsidian las degrada a una tabla sencilla:

| Quieres | `type` en el disco | `plainva.render` |
|---|---|---|
| Tabla | `table` | — |
| Lista | `list` | — |
| Galería | `cards` | — |
| Tablero | `table` | `board` |
| Calendario | `table` | `calendar` |
| Cronología | `table` | `timeline` |

### Filtros

`filters` selecciona qué notas están en la base de datos y las acota.

**Las condiciones de fuente** deciden la pertenencia:

- Carpeta: `file.folder == "Path/To/Folder"` (relativo al vault; la carpeta raíz es `""`).
- Etiqueta: `file.hasTag("project")` (sin `#` inicial).

Varias fuentes son simplemente varias entradas. Ningún `filters` en absoluto = todas las notas del vault.

**Dónde viven las condiciones de propiedad:** a nivel de archivo, `filters` se aplica a todas las vistas. Plainva, en cambio, guarda las reglas de filtro de propiedad **por vista** en `views[i].filters` (la misma estructura de raíz única) y conserva a nivel de archivo solo las fuentes, de modo que cada vista puede filtrar de forma independiente. Ambos son válidos para Obsidian; una herramienta puede escribir cualquiera de los dos. Un archivo antiguo con condiciones de propiedad a nivel de archivo sigue funcionando — Plainva las distribuye a cada vista la próxima vez que se guarda.

**Las condiciones de propiedad** usan nombres de propiedad sin prefijo y estos operadores:

| Operador | Expresión |
|---|---|
| igual a | `status == "Done"` |
| distinto de | `status != "Done"` |
| contiene | `contains(labels, "urgent")` |
| no contiene | `!contains(labels, "urgent")` |
| mayor / menor | `priority > "2"`, `priority < "5"` |
| como mínimo / como máximo | `priority >= "2"`, `priority <= "5"` |
| está vacío | `status == ""` |
| no está vacío | `status != ""` |

**Estructura (¡de raíz única!):** uno de `and` / `or` / `not`, cuyas entradas son strings de condición — o un nivel de objetos de grupo anidados `{and:[...]}` / `{or:[...]}` (grupos al estilo Notion). Ejemplo combinando una fuente, una condición y un grupo OR:

```yaml
filters:
  and:
    - 'file.folder == "Projects"'
    - 'status != "Done"'
    - or:
        - 'priority == "1"'
        - 'priority == "2"'
```

### Una `.base` completa y anotada

```yaml
filters:
  and:
    - 'file.folder == "Projects"'          # source: notes in the Projects folder
properties:
  note.status:                             # column id is note.-prefixed
    displayName: Status                    # optional Obsidian column label
    plainva:
      input: status
      options:
        - value: Open
          color: amber
          group: Active
        - value: Done
          color: green
          group: Closed
views:
  - type: table                            # first view: also carries file-wide keys
    name: All projects                     # every view needs a name
    order: [file.name, note.status]        # order uses note.-prefixed ids
    plainva:
      fileIconColor: "#2f6f6f"
      newItemFolder: Projects
  - type: table                            # a board is a native table + render hint
    name: Board
    plainva:
      render: board
      groupBy: status                      # groupBy uses the BARE key
```

---

## Relaciones (el contrato bidireccional)

Una relación enlaza notas entre sí. Es lo más propenso a errores al escribir a mano, porque abarca **tres** lugares. Mantén los tres consistentes.

1. **El valor vive en el frontmatter de la nota de origen**, como un wiki-link (o una lista de ellos):

   ```markdown
   ---
   type: Task
   project: "[[Project Alpha]]"
   ---
   ```

2. **La `.base` de origen declara la columna de relación** (`relationBase` = la base de datos de destino; `relationLimit: one` para un enlace único):

   ```yaml
   properties:
     note.project:
       plainva:
         input: relation
         relationBase: Projects.base
         relationLimit: one
   ```

3. **La `.base` de destino puede mostrar la relación inversa** con una columna **calculada**. Sus valores **no** se guardan en ningún sitio — se derivan de los enlaces de las notas de origen:

   ```yaml
   properties:
     note.tasks:
       plainva:
         reverseOf:
           base: Tasks.base       # the source .base (vault-relative path)
           property: project      # the BARE source property key
   ```

### Ejemplo trabajado: Tareas ↔ Proyectos

**`Tasks.base`**

```yaml
filters:
  and:
    - 'file.folder == "Tasks"'
properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Open
          color: amber
        - value: Done
          color: green
  note.project:
    plainva:
      input: relation
      relationBase: Projects.base
      relationLimit: one
views:
  - type: table
    name: All tasks
    order: [file.name, note.status, note.project]
```

**`Projects.base`**

```yaml
filters:
  and:
    - 'file.folder == "Projects"'
properties:
  note.tasks:
    plainva:
      reverseOf:
        base: Tasks.base
        property: project
views:
  - type: table
    name: All projects
    order: [file.name, note.tasks]
```

**`Tasks/Write proposal.md`**

```markdown
---
type: Task
okf_version: "0.1"
status: Open
project: "[[Project Alpha]]"
---
# Write proposal
```

**`Projects/Project Alpha.md`**

```markdown
---
type: Project
okf_version: "0.1"
---
# Project Alpha
```

Resultado: en `Projects.base`, la columna calculada `tasks` de **Project Alpha** lista "Write proposal", porque el `project` de esa tarea enlaza de vuelta a ella. Fíjate en que `Project Alpha.md` **no** tiene una clave `tasks:` — el lado inverso es calculado, nunca guardado.

### Lo que NO debes hacer con las relaciones

- **No escribas valores inversos en las notas.** Una columna `reverseOf` es calculada. Escribir una clave `tasks:` en `Project Alpha.md` es incorrecto y no sobrevivirá a un ciclo de lectura/escritura.
- **Haz que los destinos del enlace se resuelvan.** `"[[Project Alpha]]"` debe coincidir con el nombre de una nota existente, o el enlace aparecerá roto.
- **Mantén las rutas relativas al vault** con barras normales y sin `./` inicial (`Projects.base`, `DB/Projects.base`).
- **`reverseOf.property` es la clave de origen sin prefijo** (`project`), no `note.project`.

### Auto-relaciones y subelementos

Para una relación cuyo destino es la misma base de datos, apunta `relationBase` a esa misma `.base`. Para anidar hijos bajo padres en una vista de tabla, establece `views[i].plainva.subItemsProperty` a la clave de relación padre sin prefijo. Los ciclos se gestionan; con los subelementos desactivados, las filas quedan planas y los valores se conservan.

---

## `index.md` (índice de contenidos de una carpeta)

`index.md` es un nombre reservado para el índice de contenidos de una carpeta.

- **Solo el `index.md` de la raíz puede llevar frontmatter**, y solo `okf_version` (marca el vault como activo en OKF). Un `index.md` que no esté en la raíz debe estar **libre de frontmatter** — el frontmatter ahí es una infracción del nombre reservado.
- Un `index.md` **gestionado** por Plainva termina con el marcador `<!-- plainva:index generated -->` (un comentario HTML, invisible en el modo de lectura). Su presencia significa que Plainva mantiene el archivo actualizado automáticamente. Si editas ese archivo a mano, conserva el marcador (y mantén la forma generada) o elimínalo deliberadamente para hacerte cargo del archivo de forma permanente.
- Los listados generados son secciones de enlaces con la forma `* [Título](url/relativa) - descripción`.

Si generas una descripción de carpeta a mano, la opción segura es **no** añadir el marcador — así Plainva nunca la sobrescribirá.

---

### Vistas de grafo (`plainva.render: "graph"`)

Una vista de grafo se guarda como cualquier vista no nativa: `type: table` más el indicador de render. Sus opciones viven en el MISMO namespace `views[i].plainva`:

```yaml
views:
  - type: table
    name: Net
    plainva:
      render: graph
      graphEdges: [projekt]        # relation property keys drawn as edges
      graphColorBy: status         # select/status property -> node color
      graphSizeBy: prio            # number property -> node size
      graphShowExternal: true      # include relation targets outside the view
      graphShowIncoming: true      # incluir relaciones de OTRAS bases de datos que apuntan hacia aquí (p. ej. las tareas de un proyecto)
```

Todas las claves de opción del grafo son opcionales; omítelas por completo cuando no estén definidas. Obsidian renderiza el mismo archivo como una tabla sencilla y no debe dar error.

Una vista de **tablero** (`plainva.render: "board"`) puede llevar además `views[i].plainva.boardColumnOrder` — una lista de claves de columnas de grupo (`__UNGROUPED__` marca la columna sin valor) que recuerda un orden de columnas manual. Los tableros de Selección/Estado reordenan en su lugar las `options` de la propiedad. Omite la clave si no está definida.

## No tocar y seguridad

- **`.plainva/`** contiene copias de seguridad y estado interno. Nunca leas lógica de programa desde ahí ni escribas en ella.
- **Las claves desconocidas son sagradas.** Cuando reescribas una `.base` o una nota, arrastra sin cambios cada clave que no tenías intención de modificar. Plainva mismo conserva las claves desconocidas de `.base` mediante una copia interna en bruto; un escritor externo debería hacer lo mismo (analizar → cambiar solo lo que se pretende → serializar).
- **Los valores cambian en la nota, no en la `.base`.** Para fijar una celda, edita el frontmatter de la nota. La `.base` solo decide qué notas y columnas se muestran.
- **No añadas claves `.base` de nivel superior** más allá de `filters` / `formulas` / `properties` / `views`.
- **Codificación:** UTF-8 sin BOM, finales de línea LF, en todas partes.

## Ver también

- [Notas y Markdown](Notes_and_Markdown.md) — el mismo material desde el ángulo de escribir a mano en la app
- [Bases de datos (.base)](Databases_Base.md) — bases de datos explicadas para el uso cotidiano
- [OKF](OKF.md) — `type`, `okf_version`, index.md y la conversión del vault
