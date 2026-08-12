# Notas y Markdown

Última actualización: 2026-07-30

Cada nota en Plainva es un archivo Markdown normal (`.md`). Esta página explica cómo escribir cómodamente y qué termina realmente en el archivo — porque eso es exactamente lo que hace que tus notas sean portables: cualquier editor de texto, Obsidian o un diff de git pueden leerlas.

## El principio central: todo es texto

Todo lo que ves en Plainva — texto con formato, tablas, propiedades, iconos — se guarda como texto abierto:

```markdown
---
type: Note
okf_version: "0.1"
tags: [project]
plainva:
  icon: "🚀"
  header_color: "#2f6f6f"
---
# Mi proyecto

Un pensamiento en **negrita** con un enlace a [[Otra nota]].

- [ ] Primera tarea
```

El bloque entre las líneas `---` es el **frontmatter** (YAML): ahí es donde viven las propiedades de la nota. Debajo viene el texto normal en Markdown. La presentación específica de Plainva (icono, color de cabecera) se agrupa bajo la única clave `plainva:` — otros programas simplemente la ignoran.

## Escribir en la vista previa en vivo

**Vista previa en vivo** es el modo predeterminado: el Markdown se renderiza mientras escribes, pero sigue siendo editable en todo momento.

### El menú de barra oblicua

Escribe `/` al principio de una línea para abrir el menú de inserción. Está agrupado en secciones:

- **Bloques básicos** — Texto, Encabezado 1–6, Lista de viñetas, Lista numerada, Lista de tareas, Cita, Bloque de código, Tabla, Separador, **Fórmula (LaTeX)**, **Diagrama Mermaid**
- **Formato** — Negrita, Cursiva, Tachado, Código en línea, Resaltado, **Emoji**
- **Enlaces y medios** — Enlace, Enlace interno, Imagen (web), Imagen interna, Incrustación, Incrustar base de datos, Crear base de datos integrada
- **Documento** — Icono del documento, Color de cabecera, Insertar plantilla
- **Callouts** — 13 variantes (Nota, Info, Por hacer, Resumen, Consejo, Éxito, Pregunta, Advertencia, Fallo, Peligro, Bug, Ejemplo, Cita)

### Más ayudas para escribir

- **Barra de herramientas de selección** — selecciona algo de texto y una pequeña barra ofrece **Negrita**, **Cursiva**, **Tachado**, **Código en línea**, **Resaltado** y **Enlace**.
- **Menciones con `@`** — escribe `@` en cualquier parte del texto para insertar una **Fecha** (Hoy, Mañana, Ayer o **Elegir una fecha…**, guardada como fecha ISO), un enlace a una **Nota**, o una incrustación de **Base de datos**.
- **Emoji** — el comando de barra oblicua **Emoji** (`/emoji`) abre un selector de emojis en el cursor; o escribe `:name` (por ejemplo `:rocket`) para sugerencias en línea. En cualquier caso, Plainva inserta el **carácter** emoji real (Unicode portable), nunca un `:shortcode:` — así la nota se mantiene legible en Obsidian, en GitHub y en cualquier otro sitio. (Esto es independiente del **icono del documento** de la nota, que se guarda en el frontmatter.)
- **Manejadores de bloque** — al pasar el cursor aparece un manejador a la izquierda de cada párrafo: arrástralo para mover el bloque, haz clic para abrir **Acciones de bloque** (**Convertir en** Texto/Encabezado/Lista/Tarea/Cita/Bloque de código, **Duplicar**, **Mover arriba**/**Mover abajo**, **Eliminar bloque**). Si arrastras una lista junto a otra lista del mismo tipo, Plainva inserta una línea separadora invisible `<!-- -->` para que ambas listas se mantengan separadas — en Markdown, las listas del mismo estilo se fusionarían de otro modo pese a la línea en blanco (también en Obsidian).
- **Tablas** — se renderizan como un widget con celdas editables con un clic. La vista de la celda renderiza el formato (**negrita**, *cursiva*, `código`, resaltado), enlaces en los que se puede hacer clic (`[[Enlace interno]]`, direcciones web) y `<br>` como salto de línea; al editar ves el texto sin procesar. El menú de la tabla ofrece insertar/eliminar filas y columnas además de alineación (**Alinear a la izquierda**/**Centrar**/**Alinear a la derecha**).
- **Las listas se continúan solas** (Enter inserta el siguiente marcador de lista), los bloques de código reciben resaltado según el lenguaje (también en el modo lectura), el contenido pegado se convierte a Markdown (pegado inteligente) y los encabezados se pueden plegar.
- **Buscar y reemplazar** dentro de la nota actual: `Ctrl+F` (ver [Buscar](Search.md)).

## Enlaces y retroenlaces

- **Enlaces internos**: `[[Nombre de la nota]]` (enlace interno) — mediante el menú de barra oblicua o `@` con búsqueda integrada de notas. Los enlaces clásicos de Markdown `[texto](ruta.md)` también funcionan.
- **Destinos que aún no existen**: un enlace interno a una nota que todavía no se ha creado se muestra **atenuado y con un subrayado discontinuo** (tanto en la vista previa en vivo como en el modo lectura). **Hacer clic en él crea la nota** y la abre — se coloca en la carpeta de la nota actual (o en la ruta indicada si el enlace la incluye, por ejemplo `[[Carpeta/Nueva nota]]`). Para que se te pregunte primero, activa **Configuración → App → Editor y notas → Preguntar antes de crear enlaces vacíos**.
- **Retroenlaces**: La sección **Retroenlaces** de la barra lateral derecha muestra qué notas enlazan a la activa — agrupadas por archivo de origen, con un contador para varias apariciones.
- **Renombrar con cuidado de los enlaces**: Cuando renombras un archivo en el árbol de archivos, Plainva actualiza cada enlace hacia él en todo el vault (los anclajes como `#Sección` se conservan) e informa: "N enlace(s) en M archivo(s) se actualizaron al nuevo nombre".

## Propiedades (frontmatter)

La sección **Propiedades** de la barra lateral derecha muestra el frontmatter de la nota como un formulario. **Añadir propiedad** crea nuevas; cada propiedad tiene un **Tipo de campo**:

| Grupo | Tipos |
|---|---|
| **Básicos** | Texto, Número, Casilla de verificación, Fecha, Fecha y hora |
| **Elección** | Selección, Estado, Selección múltiple |
| **Listas y relaciones** | Lista, Etiquetas, Relación |
| **Web y contacto** | URL, Correo electrónico, Teléfono |

Los tipos de elección pueden llevar opciones fijas con un **Color** y (para **Estado**) un **Grupo**/etapa — estas listas de opciones se gestionan en las bases de datos (`.base`), ver [Bases de datos (.base)](Databases_Base.md).

Dos campos están protegidos: `type` y `okf_version` son **campos de sistema OKF** gestionados por Plainva — el valor de `type` se puede elegir en un desplegable de tipos conocidos, mientras que nombre/tipo de campo/eliminar están bloqueados (contexto: [OKF](OKF.md)).

## Icono del documento y color de cabecera

Cada nota puede llevar un icono (al estilo Notion, encima del título, también visible en las pestañas y el árbol de archivos) y una franja de color a todo lo ancho:

- En la vista previa en vivo, pasa el cursor por encima del título: **Añadir icono** / **Añadir color de cabecera** (más tarde: **Cambiar icono** / **Cambiar color de cabecera**) — o usa los comandos de barra oblicua **Icono del documento** y **Color de cabecera**.
- El selector de iconos tiene dos modos — **Emoji** e **Iconos** — que se manejan igual: una misma zona superior, una misma búsqueda, **categorías** (pestañas) en ambos modos y una sección **Usados recientemente** que sobrevive a un reinicio.
- El conjunto abarca unos **400 iconos seleccionados** en diez categorías (Conocimiento y archivos, Trabajo y tareas, Tecnología, Personas y contacto, Creatividad y medios, Día a día y hogar, Naturaleza y clima, Viajes y lugares, Dinero y números, Símbolos y estados). La búsqueda usa nombres y palabras clave.
- En el modo de iconos eliges un **color** arriba: la misma paleta que la franja de cabecera, **A** para el color estándar y **Color propio …** para un valor libre. Se aplica al icono que pulses a continuación.
- Ambos se guardan en el frontmatter bajo `plainva:` (`icon`, `icon_color`, `header_color`) — pura presentación que no afecta a otros programas.

## Plantillas

Configura una **Carpeta de plantillas** en **Configuración → Vault → Contenido y estructura** (**Elegir carpeta…** junto al campo permite elegir la carpeta directamente en el vault). Después inserta plantillas con `Ctrl+Alt+T` o el comando de barra oblicua **Insertar plantilla**. Las plantillas definen por completo el contenido de los archivos nuevos — incluido el frontmatter: si una plantilla trae su propio `type`, gana la plantilla. Al insertar en una nota existente, el frontmatter de la plantilla se omite: solo se inserta el contenido.

**Marcadores de posición**: las plantillas rellenan marcadores de posición con nombre — sin scripts, sin expresiones; nada de esto ejecuta código.

| Marcador de posición | Qué inserta |
| --- | --- |
| `{{title}}` | El título de la nota |
| `{{date}}`, `{{time}}` | La fecha y la hora; con tu propio formato: `{{date:DD.MM.YYYY}}` |
| `{{date+7}}`, `{{date-1}}` | Una fecha desplazada, combinable con un formato |
| `{{yesterday}}`, `{{tomorrow}}` | El día anterior, el día siguiente |
| `{{weekday:monday}}`, `{{weekday:next friday}}` | Ese día de la semana, de esta semana o de la siguiente; un formato sigue a los segundos dos puntos: `{{weekday:monday:DD.MM.}}`. El día en que empieza la semana depende de tu configuración de calendario |
| `{{daily}}`, `{{daily+1}}`, `{{daily-1}}` | Un enlace a la nota diaria de hoy, de mañana o de ayer |
| `{{folder}}`, `{{vault}}` | La carpeta de la nota, el nombre del vault |
| `{{cursor}}` | Sin texto — marca dónde queda el cursor después |
| `{{prompt:Label}}`, `{{prompt:Label\|Default}}` | Te pide texto (mostrado como *Label*) |
| `{{select:Label\|A,B,C}}` | Te pregunta con una lista de opciones |
| `{{date_prompt:Label}}` | Te pide una fecha |
| `{{selection}}` | El texto seleccionado — al insertar una plantilla |
| `{{clipboard}}` | El portapapeles — llega como una **pregunta previamente rellenada**, nunca de forma inadvertida en la nota |
| `\{{date}}` | El propio marcador de posición, sin resolver |

Cuando una plantilla pregunta algo, Plainva hace **todas** las preguntas en un único diálogo antes de escribir la nota — tanto si insertas como si creas; cancelar no crea nada. Solo en las notas creadas en segundo plano (por ejemplo, en la sincronización de tareas) nunca se pregunta nada: allí las respuestas quedan vacías. Un marcador de posición que Plainva no conoce permanece visible — así, una errata parece una errata.

**En el teléfono** funciona el mismo motor: los marcadores de posición se rellenan, las preguntas de una plantilla llegan juntas en una sola hoja (cancelarla no crea nada), y las reglas **carpeta → plantilla** y **tipo de nota → plantilla** también se aplican ahí — de modo que una nota en `Projekte/` empieza igual en ambos dispositivos. Dos diferencias: las reglas se definen en el escritorio (el teléfono solo las aplica), y `{{weekday:…}}` siempre cuenta desde el lunes allí, porque el ajuste de inicio de semana todavía no existe en el móvil.

**Ajustes propios de la plantilla**: una plantilla puede llevar ajustes que solo valen para ella misma — que sus tareas queden fuera de la vista **Tareas**, o a qué bases de datos pertenece. Una nota creada a partir de ella no los hereda. Las notas diarias antiguas todavía pueden llevarlos: **Configuración → Vault → Mantenimiento → Revisar notas diarias** los encuentra y muestra cada nota antes de cambiar nada.

**Plantillas por carpeta**: en **Configuración → Vault → Contenido y estructura → Plantillas** asignas una plantilla a una carpeta — cada nota nueva creada allí parte entonces de ella, sin que tengas que elegir nada. La asignación también cubre las subcarpetas; cuando coinciden varias, gana la ruta más larga (`Proyectos/Clientes` le gana a `Proyectos`). Asignas una plantilla a un **tipo de nota** de la misma manera; se aplica cuando ninguna regla de carpeta cubre la nota — la carpeta le gana al tipo. **Nueva nota desde plantilla …** (clic derecho en el árbol de archivos, la paleta de comandos o el selector rápido) te permite elegir una explícitamente — eso le gana a cualquier asignación. Las asignaciones viven en la configuración, no en las notas, y viajan a tus otros dispositivos mediante la sincronización de la configuración.

Crear plantillas funciona desde cualquier lugar: la paleta de comandos (`Ctrl+P`) ofrece **Crear nueva plantilla** (se abre una plantilla nueva para editarla) y **Guardar la nota actual como plantilla** (copia la nota abierta en la carpeta de plantillas). Las plantillas son archivos Markdown normales — edítalas, renómbralas o elimínalas directamente en el árbol de archivos.

## Notas diarias

**Abrir nota diaria** (barra lateral) o un clic en el **Calendario** crea la nota de hoy usando tu formato de fecha en la carpeta de notas diarias configurada, opcionalmente a partir de una plantilla.

## Tareas, fórmulas, diagramas y notas al pie

- **Casillas de tareas**: `- [ ] tarea` se renderiza como una casilla de verificación en todas partes — y en el **modo lectura** puedes hacer clic en ella: Plainva escribe `[x]` o `[ ]` de vuelta en el archivo.
- **Matemáticas (LaTeX)**: `$E = mc^2$` en línea y `$$…$$` como bloque se renderizan como fórmulas en modo lectura Y en la vista previa en vivo (KaTeX). Con el cursor dentro de una fórmula ves la sintaxis; al hacer clic en una fórmula renderizada se abre para editarla. Solo el modo fuente muestra siempre la sintaxis sin procesar. No necesitas memorizar el bloque `$$…$$` — el comando de barra oblicua **Fórmula (LaTeX)** (`/katex`) lo inserta y coloca el cursor dentro.
- **Diagramas Mermaid**: un bloque de código con el lenguaje `mermaid` (la forma más rápida es el comando de barra oblicua **Diagrama Mermaid**, `/mermaid`) se dibuja como diagrama en modo lectura y en la vista previa en vivo — al hacer clic en el diagrama se muestra el código para editarlo:

  ````markdown
  ```mermaid
  graph TD
    Idea --> Note --> Knowledge
  ```
  ````

- **Notas al pie**: `Texto[^1]` más `[^1]: La nota al pie.` al final — el modo lectura renderiza la referencia y el aparato de notas al pie con marcas de salto. La forma más rápida es el comando de barra oblicua **Nota al pie** (`/footnote`): inserta la siguiente referencia libre y salta directamente a la definición al final de la nota.

## Imprimir y guardar como PDF

El menú **⋮** del editor y la paleta de comandos (`Ctrl+P`) tienen **Imprimir / Guardar como PDF…**: la impresión siempre usa la vista de lectura (desde vista previa en vivo/fuente, Plainva cambia primero a ella). En el diálogo del sistema puedes elegir "Guardar como PDF" en lugar de una impresora.

## Exportar una nota

- **Exportar como Markdown…** (menú **⋮** del editor o paleta de comandos): guarda una copia de la nota donde quieras mediante el diálogo del sistema — por ejemplo, para pasarla a otro programa. Los adjuntos vinculados (imágenes) no se copian junto con ella; Plainva muestra un aviso breve cuando la nota hace referencia a alguno.
- **PDF**: usa **Imprimir / Guardar como PDF…** (arriba) y elige "Guardar como PDF" en el diálogo del sistema.

## Abrir una nota en otro editor

Tus notas son archivos `.md` normales, así que cualquier editor Markdown puede abrirlas. El menú **⋮** del editor tiene **Abrir en la aplicación predeterminada**, que entrega la nota actual a la aplicación que tu sistema usa para archivos Markdown (Byword, MacDown, VS Code, entre otras). Plainva sigue vigilando el archivo, así que los cambios que hagas ahí aparecen aquí automáticamente.

## Imágenes y adjuntos

- **Insertar**: comandos de barra oblicua **Imagen interna** (buscar e incrustar desde el vault) o **Imagen (web)** (mediante una URL). También: simplemente **pega** una imagen desde el portapapeles (Ctrl+V). Y puedes **arrastrar archivos desde el explorador de archivos al editor**: las imágenes se incrustan (`![[…]]`), otros archivos se copian y se enlazan (`[[…]]`). Dónde aterrizan estos archivos es un ajuste: **Ajustes → Tu bóveda → Contenido y estructura → Carpeta de adjuntos** (predeterminado `Attachments`, con explorador de carpetas). Déjalo vacío para mantenerlos junto a la nota, como hacía Plainva antes de este ajuste. La carpeta viaja con la sincronización de ajustes, así que el ordenador y el teléfono archivan los adjuntos en el mismo sitio.
- **Ver**: los archivos de imagen (PNG, JPG, GIF, WebP, SVG, BMP, AVIF) se abren en el visor de imágenes integrado con **Acercar**/**Alejar**, **Ajustar** y **Tamaño real (1:1)**.
- **Editar**: el botón **Editar** abre el editor de imágenes con **Recortar**, girar/voltear, **Cambiar tamaño**, herramientas de dibujo (**Lápiz**, **Flecha**, **Rectángulo**, **Texto**) además de **Deshacer**/**Rehacer**. Guarda en el propio archivo o **Guardar como copia…**. Los formatos editables son PNG, JPG y WebP; otros formatos se abren solo para ver.
- Otros adjuntos se abren con un clic en el programa predeterminado del sistema: en el árbol de archivos igual que mediante un `[[enlace]]`, un marcador o la búsqueda.

## ¿Y Obsidian?

Todo permanece como Markdown estándar con frontmatter estándar. Obsidian abre los archivos por completo; muestra la clave agrupada `plainva:` como un objeto no editable en su panel de propiedades — eso es intencional e inofensivo.

## Ver también

- [Bases de datos (.base)](Databases_Base.md) — notas como tabla, tablero o calendario
- [OKF](OKF.md) — qué significan `type` y `okf_version`
- [Buscar](Search.md) y [Atajos de teclado](Keyboard_Shortcuts.md)

## Formato de una selección

Cuando una selección abarca varias líneas, **negrita**, *cursiva*, tachado, resaltado y código en línea se aplican por separado a cada línea no vacía. Los prefijos de lista, cita, encabezado y tarea quedan fuera de las marcas. Los enlaces siguen siendo de una sola línea porque una etiqueta multilínea no es Markdown portátil.

Un encabezado ATX y una tarea GFM son tipos de bloque alternativos. Plainva no escribe combinaciones inválidas. El formato en línea funciona en ambos bloques; usa `- [ ] **Tarea importante**` para destacar el título.
