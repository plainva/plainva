# Referencia de bases de datos (.base)

Última actualización: 2026-11-03

Esta página enumera todo lo que puede contener un archivo `.base` y lo que Plainva hace con cada parte: cada clave de nivel superior, cada forma de filtro, cada tipo de vista con sus opciones, los resúmenes, el orden, los límites, qué ocurre con las claves que Plainva no conoce y en qué se comporta Plainva de forma distinta a Obsidian Bases. Describe lo que el código de Plainva lee, evalúa y escribe hoy — no la documentación de Obsidian.

Para el uso cotidiano, lee primero [Bases de datos (.base)](Databases_Base.md). Las reglas que debe respetar una herramienta cuando escribe directamente en los archivos del vault, y el ejemplo completo de relaciones, están en la [Referencia del formato de archivo](File_Format_Reference.md).

## De un vistazo

| Parte del archivo | Qué hace Plainva |
|---|---|
| `filters` | Lee y aplica las fuentes (carpeta, etiqueta) y las condiciones que se enumeran en [Filtros](#filtros) |
| `views` | Lee los ocho tipos de vista, su orden, orden de clasificación, filtros y resúmenes |
| `properties` | Lee el esquema de columnas, el nombre visible y el bloque `plainva` de Plainva |
| `summaries` (vista) | Calcula los catorce resúmenes incorporados |
| `formulas` | Las conserva en el archivo, no las calcula |
| `summaries` (nivel superior) | Conserva las fórmulas de resumen personalizadas, no las calcula |
| `this` | Aún no es compatible |
| Otras claves | Las conserva en el archivo (ver [Claves que Plainva no conoce](#claves-que-plainva-no-conoce)) |

## Claves de nivel superior

Un archivo `.base` es YAML con estas claves de nivel superior. Todas son opcionales; un archivo sin `views` se abre con una tabla.

| Clave | Contenido | En Plainva |
|---|---|---|
| `filters` | Qué notas pertenecen a la base de datos (fuentes) | Se lee y se aplica |
| `properties` | Una entrada por columna, con el id de la propiedad como clave | Se lee; las adiciones de Plainva viven en su bloque `plainva` |
| `views` | La lista de vistas | Se lee; cada vista necesita un `name` |
| `formulas` | Fórmulas de Obsidian, `name: expression` | Se conservan sin cambios, no se calculan |
| `summaries` | Fórmulas de resumen personalizadas de Obsidian | Se conservan sin cambios, no se calculan |

Plainva nunca escribe otra clave de nivel superior: Obsidian se niega a abrir un `.base` con una clave que no conoce. Una clave `columns:` de nivel superior escrita por versiones muy antiguas de Plainva se sigue leyendo y se traslada a `properties` la próxima vez que se guarda el archivo.

## Propiedades (`properties`)

### Ids de propiedad

Un id de propiedad da nombre a una columna. Existen tres tipos:

| Id | Significa | Ejemplo |
|---|---|---|
| `note.<key>` | Una clave del frontmatter de las notas | `note.status` |
| `file.<field>` | Un dato sobre el archivo (ver [Campos de archivo](#campos-de-archivo-file)) | `file.mtime` |
| `formula.<name>` | Una fórmula de Obsidian de `formulas` | `formula.price_per_unit` |

Las claves de `properties`, el `order` de una vista y `sort[].property` usan estos ids. Dentro de una expresión de filtro y dentro de un bloque `plainva`, una clave del frontmatter se escribe sin prefijo (`status`); una expresión de filtro entiende también `note.status`.

Cuando una nota escribe una clave con otra capitalización que la columna (`Due` frente a la columna `due`), Plainva sigue mostrando el valor en esa columna y escribe los cambios con la grafía propia de la nota.

### Nombre visible

`properties.<id>.displayName` es la etiqueta de columna de Obsidian. Plainva la muestra como encabezado de la columna y la conserva. Sin ella, una clave del frontmatter se muestra con la primera letra en mayúscula (solo en pantalla); los campos de archivo tienen sus propios nombres, por ejemplo **Nombre**, **Modificado**, **Tamaño**, **Ruta**, **Lista de tareas** y **Día del nombre del archivo**.

### El bloque `plainva` de una columna

Todo lo que Plainva añade a una columna vive bajo `properties.<id>.plainva`. Obsidian lo ignora.

| Clave | Valor | Significado |
|---|---|---|
| `input` | un tipo de campo (lista más abajo) | El tipo de campo de la columna |
| `ratingMax` | número, de 1 a 10 | Cuántas marcas tiene una valoración (por defecto 5) |
| `ratingGlyph` | un carácter | La marca que dibuja una valoración (por defecto un punto) |
| `options` | lista de opciones | Valores fijos para selección, estado y selección múltiple |
| `relationBase` | ruta `.base` relativa al vault | La base de datos a la que apunta una relación |
| `relationLimit` | `one` | Una relación contiene exactamente un enlace; si falta, no hay límite |
| `reverseOf` | `{ base, property }` | Una columna calculada de relación inversa |
| `rollup` | `{ through, of, fn, where }` | Una columna calculada de agregación (ver [Agregaciones](#agregaciones)) |
| `previousKeys` | lista de hasta 8 nombres anteriores | Permite que los comentarios vuelvan a encontrar una columna renombrada |

### Tipos de campo (`input`)

`text`, `number`, `rating`, `checkbox`, `date`, `datetime`, `select`, `status`, `multiselect`, `list`, `tags`, `url`, `email`, `phone`, `relation`.

También se leen dos grafías antiguas: `multi-select` como `multiselect` y `link` como `relation`. Una columna sin `input` — o con un valor que no está en esta lista — obtiene su tipo de los valores de las notas: `true`/`false` es una casilla de verificación, un número un número, una lista de `[[links]]` una relación, `2026-07-03` una fecha, una dirección web una URL, y así sucesivamente. Una columna de relación inversa y una columna de agregación no tienen `input`.

### Opciones y colores

Una opción es `{ value, label, color, group }`; solo `value` es obligatorio. `color` es uno de los nombres de la paleta `gray`, `teal`, `blue`, `green`, `amber`, `coral`, `purple`, `pink` — un nombre desconocido recurre a un color derivado del valor. `group` lo usa solo **Estado**: las opciones con el mismo grupo forman una etapa. Una cadena simple se lee como una opción con ese valor.

### Agregaciones

Una columna de agregación calcula un valor a partir de las notas a las que apunta una columna de enlace de esta base de datos. El valor no se guarda en ningún archivo.

- `through` — una columna de relación o de relación inversa de esta base de datos.
- `of` — una propiedad de las notas enlazadas; no hace falta para `count`.
- `fn` — una de `count`, `countWhere`, `percentWhere`, `sum`, `average`, `median`, `min`, `max`, `earliest`, `latest`, `checked`, `unchecked`, `empty`, `filled`, `unique`.
- `where` — `{ op, value }`, obligatorio para `countWhere` y `percentWhere`; `op` es uno de `==`, `!=`, `contains`, `notContains`, `>`, `<`, `>=`, `<=`, y un `value` vacío significa «está vacío».

Una agregación a la que le falta una parte obligatoria, o que nombra una función que no está en esta lista, se ignora: la columna queda vacía y la base de datos se abre igualmente. Una agregación a través de otra columna calculada también queda vacía.

## Campos de archivo (`file.*`)

Estos valores proceden del archivo, no de su frontmatter. Cada fila de una base de datos lleva lo siguiente:

| Campo | Valor |
|---|---|
| `file.name` | La propiedad `title` de la nota si la tiene; si no, el nombre del archivo sin `.md` |
| `file.path` | La ruta relativa al vault |
| `file.mtime` | Última modificación, en milisegundos |
| `file.ctime` | Creación, en milisegundos, cuando el sistema de archivos la informa |
| `file.size` | Tamaño en bytes |
| `file.tags` | Todas las etiquetas de la nota, del frontmatter y del texto, cada una con `#`; se rellena cuando un filtro, un tablón o una vista que muestra la columna u ordena por ella las necesita |
| `file.tasks` | Progreso de las casillas como `done/total`; se rellena para los tableros y para una vista que muestra la columna |
| `file.day` | El día que representa el nombre de archivo de una nota diaria, según la carpeta y el formato del vault; solo lectura, y solo el campo de fecha de un calendario o una cronología puede usarlo |
| `file.revision` | Un marcador interno de cambios; no cuentes con él |

`file.folder` funciona como fuente (ver [Fuentes](#fuentes)) pero no es una columna. `file.basename`, `file.ext`, `file.links`, `file.backlinks`, `file.embeds`, `file.properties` y `file.file` no se proporcionan: una columna con alguno de ellos queda vacía, y un filtro los lee como vacíos.

## Filtros

### Dónde viven los filtros

El `filters` de nivel superior contiene las **fuentes**: qué notas pertenecen a la base de datos. Cada vista puede llevar sus propios `filters` con condiciones que acotan solo esa vista; Plainva escribe ahí las condiciones. Ambos niveles se aplican a la vez. Las condiciones que un archivo mantiene en el nivel superior siguen funcionando; el próximo guardado en Plainva las traslada a cada vista.

### Fuentes

| Fuente | Expresión |
|---|---|
| Carpeta | `file.folder == "Projects/Active"` — la carpeta y todas sus subcarpetas; `""` y `"/"` son todo el vault |
| Etiqueta | `file.hasTag("project")` — la nota lleva exactamente esta etiqueta; un `#` inicial se ignora |

Varias fuentes se combinan con `and` u `or` como cualquier otra condición. Una base de datos sin fuentes contiene todas las notas del vault. Los adjuntos, los archivos reservados `index.md` y `log.md`, y los archivos o carpetas cuyo nombre empieza por un punto nunca son filas.

### Condiciones

Una condición es una cadena. Los valores van entre comillas dobles; `\"` y `\\` escapan una comilla y una barra invertida. La propiedad se escribe sin prefijo o con `note.`.

| Condición | Expresión |
|---|---|
| es | `status == "Done"` |
| no es | `status != "Done"` |
| contiene | `contains(labels, "urgent")` o `labels.contains("urgent")` |
| no contiene | `!contains(labels, "urgent")` o `!labels.contains("urgent")` |
| mayor que, menor que | `effort > "3"`, `effort < "8"` |
| como mínimo, como máximo | `due >= "2026-07-01"`, `due <= "2026-07-31"` |
| está vacío | `status == ""` o `status.isEmpty()` |
| no está vacío | `status != ""` o `!status.isEmpty()` |
| tiene una etiqueta | `file.tags.contains("#work")`, negado con `!` |
| color de encabezado, icono | `note.plainva.header_color == "#2a7f7b"`, `note.plainva.icon == "lucide:pin"` |

### Cómo se comparan los valores

- **es** y **no es** comparan texto. En una lista (etiquetas, selección múltiple, relación), **es** significa «la lista tiene esta entrada» y **no es** «no la tiene». Una nota sin la propiedad nunca cumple **es** y siempre cumple **no es**.
- **contiene** busca el texto dentro del valor, o dentro de cada entrada de una lista. `labels.contains("x")` sobre una lista exige una entrada que sea exactamente `x`; sobre `file.tags` ambas formas exigen la etiqueta completa, así que `#work` no coincide con `#workshop` ni con `#work/child`.
- **mayor que**, **menor que**, **como mínimo**, **como máximo** comparan como números cuando ambos lados son números y, si no, como texto — lo que coloca las fechas ISO (`2026-07-03`) en el orden correcto. Una nota sin valor nunca los cumple.
- **está vacío** coincide con una propiedad ausente, un valor vacío y una lista vacía.
- Una casilla de verificación se compara como `"true"` o `"false"`.

### `and`, `or`, `not`

Un objeto `filters` tiene exactamente uno de `and`, `or` y `not` en cada nivel; sus entradas son cadenas de condición u otros objetos de filtro.

| Clave | Coincide cuando |
|---|---|
| `and` | coincide cada entrada |
| `or` | coincide al menos una entrada |
| `not` | no coincide ninguna entrada |

Plainva evalúa cualquier profundidad. El panel de filtros edita un nivel de grupos bajo **Todas** o **Cualquiera** (**Añadir grupo**); una estructura más profunda aparece como **Filtro complejo (no editable)**, permanece en el archivo y se aplica — una condición dentro de ella que Plainva no puede leer se indica debajo como no aplicada. Un archivo antiguo con `and` y `or` uno junto al otro en un mismo nivel se lee como «todas las de `and` y una de `or`» y se escribe en la forma válida en el próximo guardado.

### Lo que Plainva no puede leer

Solo se entienden las formas de las dos tablas anteriores. Todo lo demás — `file.inFolder(…)`, `file.hasLink(…)`, `file.hasProperty(…)`, un número sin comillas (`price > 2`), `&&` y `||` dentro de una misma cadena, aritmética, funciones de fecha como `now()`, o `this` — permanece en el archivo y se muestra tal cual en el panel de filtros, con la nota **No se aplica: Plainva no puede leer esta condición, así que no filtra nada.** La vista muestra entonces más notas que el mismo filtro en Obsidian.

## Fórmulas

Plainva no calcula las fórmulas de Obsidian. `formulas` permanece en el archivo sin cambios, y una columna `formula.<name>` en el `order` de una vista se muestra sin valores. **Exportar tabla** → **Fórmulas (.base)** escribe algunas agregaciones como fórmulas para que Obsidian pueda calcularlas (ver [Bases de datos (.base)](Databases_Base.md)).

## Vistas

### Claves de toda vista

| Clave | Valor | En Plainva |
|---|---|---|
| `type` | `table`, `list`, `cards` | El tipo de vista; ver la tabla siguiente |
| `name` | texto | Obligatorio; Plainva da un nombre a una vista que no lo tenga al guardar |
| `order` | lista de ids de propiedad | Las columnas visibles, en este orden |
| `sort` | lista de `{ property, direction }` | Reglas de orden, `ASC` o `DESC` |
| `filters` | objeto de filtro | Las condiciones propias de la vista |
| `summaries` | mapa de id de propiedad → nombre de resumen | El pie de cada columna |
| `plainva` | mapa | Las opciones de vista de Plainva, más abajo |

### Los ocho tipos de vista

Obsidian conoce `table`, `list` y `cards`. Los demás tipos de vista de Plainva se guardan como `type: table` más `plainva.render`, así que Obsidian los muestra como una tabla.

| Tipo de vista | `type` en disco | `plainva.render` |
|---|---|---|
| **Tabla** (`table`) | `table` | — |
| **Lista** (`list`) | `list` | — |
| **Galería** (`gallery`) | `cards` | — |
| **Tablero** (`board`) | `table` | `board` |
| **Calendario** (`calendar`) | `table` | `calendar` |
| **Cronología** (`timeline`) | `table` | `timeline` |
| **Grafo** (`graph`) | `table` | `graph` |
| **Tablón** (`pinboard`) | `table` | `pinboard` |

Tablero, Calendario, Cronología, Grafo y Tablón se ofrecen como **Tipo de vista** solo mientras **Permitir extensiones de Plainva para archivos .base** está activado. Un `type` que Plainva no conoce se muestra como una tabla y permanece tal cual en el archivo hasta que elijas otro **Tipo de vista**.

### Opciones de vista (`views[i].plainva`)

Dentro del bloque `plainva` una propiedad se escribe sin prefijo (`status`), no como `note.status`.

| Clave | Tipos de vista | Valor |
|---|---|---|
| `render` | Tablero, Calendario, Cronología, Grafo, Tablón | El tipo de vista, ver arriba |
| `groupBy` | Tablero | La propiedad de la que se forman las columnas; sin ella, la propiedad del propio `groupBy` de Obsidian en la vista |
| `boardLaneBy` | Tablero | Una segunda propiedad para **Carriles por** |
| `boardWipLimits` | Tablero | Mapa de valor de columna → máximo de tarjetas (**Límite de WIP**), números enteros mayores que 0 |
| `boardColorMode` | Tablero | `column` tiñe toda la columna; si falta = solo el chip del encabezado |
| `boardColumnOrder` | Tablero | Orden manual de las columnas; `__UNGROUPED__` es la columna sin valor |
| `colorBy` | Tablero, Cronología | Las tarjetas y las barras toman el color de opción de esta propiedad (**Color según**) |
| `dateField` | Calendario, Cronología | La fecha de inicio (**Campo de fecha**, **Fecha de inicio**); una propiedad de fecha o `file.day` |
| `endField` | Calendario, Cronología | La **Fecha de fin** |
| `coverImage` | Galería | La propiedad que contiene la **Imagen de portada** |
| `subItemsProperty` | Tabla | La relación padre para los **Subelementos** |
| `widths` | Tabla | Mapa de columna → ancho en píxeles |
| `dateFormat` | todos | `long`, `iso` o `relative`; si falta = la forma corta por defecto |
| `graphEdges` | Grafo | Propiedades de relación dibujadas como aristas |
| `graphColorBy` | Grafo | Una propiedad de selección o estado que colorea los nodos |
| `graphSizeBy` | Grafo | Una propiedad numérica que da tamaño a los nodos |
| `graphShowExternal` | Grafo | `true` muestra también los destinos de enlace fuera de la vista |
| `graphShowIncoming` | Grafo | `true` muestra también los enlaces que llegan desde otras bases de datos |
| `pinboardOrder` | Tablón | Rutas de las tarjetas sin fijar, en orden manual |
| `pinboardPinned` | Tablón | Rutas de las tarjetas fijadas, en orden |
| `pinboardFilterBy` | Tablón | **Origen de las etiquetas**: una propiedad de selección múltiple; si falta = etiquetas |

### Opciones de todo el archivo (solo la primera vista)

Estas claves pertenecen a toda la base de datos. Plainva las escribe solo en el bloque `plainva` de la primera vista y lee el primer valor válido de cada una.

| Clave | Valor |
|---|---|
| `fileIconColor` | Color hexadecimal del icono de la base de datos (**Color del icono de la base de datos**) |
| `newItemFolder` | Carpeta donde **Entrada** guarda las entradas nuevas |
| `newItemTemplate` | Plantilla para las entradas nuevas |
| `contextFilters` | Propiedades que limitan una base de datos incrustada a la nota en la que está incrustada (**Esta nota**) |
| `taskList` | Cuenta y lista (`"<account id> <list id>"`) en la que también se crea una tarea nueva |

## Resúmenes

`views[i].summaries` asigna a una columna uno de estos nombres; el pie lo calcula sobre las filas que muestra la vista.

| Nombre | En Plainva | Resultado |
|---|---|---|
| `Average` | **Promedio** | Media de los números |
| `Min` | **Mín** | El número más pequeño |
| `Max` | **Máx** | El número más grande |
| `Sum` | **Suma** | Total de los números |
| `Range` | **Rango** | El número más grande menos el más pequeño; para fechas, el intervalo en días |
| `Median` | **Mediana** | Valor central de los números |
| `Stddev` | **Desv. típica** | Desviación típica de todos los números (poblacional) |
| `Earliest` | **Más temprana** | La fecha más temprana |
| `Latest` | **Más tardía** | La fecha más tardía |
| `Checked` | **Marcadas** | Filas cuyo valor es `true` o `yes` |
| `Unchecked` | **Sin marcar** | Todas las demás filas |
| `Empty` | **Sin valor** | Filas sin valor |
| `Filled` | **Con valor** | Filas con valor |
| `Unique` | **Distintos** | Número de valores diferentes; las entradas de una lista cuentan una por una |

Los números se redondean a dos decimales, y también se lee una coma decimal. Una columna sin ningún valor utilizable no muestra pie en lugar de 0. Cualquier otro nombre es una fórmula personalizada del `summaries` de nivel superior: Plainva la conserva y muestra **Personalizado: …** en el menú, pero no calcula ningún valor.

## Orden y agrupación

- **Orden** — `sort` es una lista de reglas; la primera decide en primer lugar y la siguiente solo entre filas iguales. Los números se ordenan como números, todo lo demás como texto (las fechas ISO en el orden correcto). Las filas sin valor van al final en ambas direcciones. Sin ninguna regla, las notas modificadas más recientemente van primero. Plainva también lee `field` en lugar de `property`, y `asc`/`desc` en cualquier capitalización.
- **Agrupación** — el tablero agrupa por `plainva.groupBy`, con carriles por `plainva.boardLaneBy`. Una vista que lleva en su lugar el propio `groupBy` de Obsidian agrupa su tablero por esa propiedad, y un cambio de la agrupación se escribe en él (su `direction` se mantiene). Plainva no agrupa una tabla por él.

## Incrustar una base de datos y `this`

`![[Projects.base]]` en una nota muestra la base de datos dentro de la nota, en la vista de lectura y en el editor. Una parte tras `#` (un nombre de vista, como en `![[Projects.base#Board]]`) se ignora: la incrustación muestra la última vista usada para esta base de datos. Un bloque de código ` ```base ` en una nota se muestra como código, no como una base de datos.

**`this` aún no es compatible.** Un filtro o una fórmula que use `this` permanece en el archivo, pero Plainva no lo evalúa. Dos cosas cubren el caso más habitual, «mostrar las entradas que pertenecen a esta nota»: `contextFilters` (**Esta nota** en el panel de filtros) limita una base de datos incrustada a la nota en la que está incrustada mediante una propiedad de relación, y una base de datos incrustada que se relaciona con la base de datos de su nota anfitriona ofrece por sí sola **Filtrar esta base por la nota actual**. Ambas actúan solo dentro de Plainva; Obsidian muestra todas las filas.

## Límites

- El `limit` de Obsidian en una vista se conserva pero no se aplica: una vista muestra todas sus filas.
- El panel de filtros edita un nivel de grupos de filtros; los más profundos se aplican, pero allí solo se pueden eliminar.
- Un valor de filtro debe ir entre comillas dobles (ver [Lo que Plainva no puede leer](#lo-que-plainva-no-puede-leer)).
- Una fuente de carpeta siempre incluye las subcarpetas.
- `ratingMax` se dibuja entre 1 y 10, `previousKeys` conserva como máximo 8 nombres, un **Límite de WIP** solo acepta números enteros mayores que 0, y `relationLimit` solo conoce `one`.
- Una agregación no puede calcular sobre otra columna calculada.

## Claves que Plainva no conoce

Plainva lee un `.base`, cambia solo lo que cambiaste en la app y escribe el archivo entero de nuevo — como YAML con saltos de línea LF y sin BOM, de modo que los comentarios y el espaciado de un archivo escrito a mano no se conservan. De lo que no conoce:

- **Se conserva:** cualquier otra clave de nivel superior, `formulas`, el `summaries` de nivel superior, `displayName` y cualquier otra clave de una entrada de `properties`, las claves desconocidas en el bloque `plainva` de una columna o de una vista, una agregación que Plainva no puede leer, las claves de una vista que Plainva no usa (`limit`, `image`, …), un tipo de vista que no conoce y las condiciones de filtro que no puede leer. Un valor que Plainva entiende pero que no has cambiado conserva la grafía del archivo (`status` o `note.status`, una opción escrita como texto plano).
- **Se reescribe:** solo las formas antiguas propias de Plainva — un mapa `columns:` de nivel superior pasa a `properties`, `and` y `or` uno junto al otro en un mismo nivel pasan a la forma válida, y una vista que versiones muy antiguas guardaron como `type: board` pasa a ser `type: table` con `plainva.render`.
- **Posición:** las claves que conserva una vista pertenecen a esa vista. Eliminar o mover una vista en Plainva se las lleva consigo, y **Duplicar** las copia a la nueva vista.

## Diferencias con Obsidian Bases

| Tema | Obsidian | Plainva |
|---|---|---|
| Fórmulas, resúmenes personalizados | Se calculan | Se conservan, no se calculan |
| `this` | Compatible | Aún no es compatible |
| Expresiones de filtro | El lenguaje de expresiones completo | Las formas de [Condiciones](#condiciones) |
| `file.folder == "X"` | Solo las notas directamente en `X` | `X` y todas sus subcarpetas |
| `file.hasTag("x")` | También `#x/child` | Exactamente `#x` |
| `file.name` | El nombre del archivo | La propiedad `title` si la nota la tiene |
| `limit`, `groupBy` de la vista | Se aplican | `limit` se conserva, no se aplica; `groupBy` agrupa un tablero, no una tabla |
| Tipos de vista | `table`, `list`, `cards` y tipos de plugins | Ocho tipos; uno desconocido se muestra como tabla y se conserva en el archivo |
| `![[db.base#View]]` | Abre esa vista | La última vista usada |
| Bloque de código ` ```base ` | Una base de datos | Un bloque de código |
| Los bloques `plainva` de Plainva | Se ignoran | Tablero, calendario, cronología, grafo, tablón, relaciones, agregaciones, tipos de campo |

## Ver también

- [Bases de datos (.base)](Databases_Base.md) — las bases de datos en el uso cotidiano
- [Referencia del formato de archivo](File_Format_Reference.md) — las reglas en disco para herramientas, relaciones en ambos sentidos, `index.md`
- [Notas y Markdown](Notes_and_Markdown.md) — propiedades en una nota
