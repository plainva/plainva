# Notas y Markdown

Stand: 2026-07-07

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
- **Las listas se continúan solas** (Enter inserta el siguiente marcador de lista), los bloques de código reciben resaltado según el lenguaje, el contenido pegado se convierte a Markdown (pegado inteligente) y los encabezados se pueden plegar.
- **Buscar y reemplazar** dentro de la nota actual: `Ctrl+F` (ver [Buscar](Search.md)).

## Enlaces y retroenlaces

- **Enlaces internos**: `[[Nombre de la nota]]` (enlace interno) — mediante el menú de barra oblicua o `@` con búsqueda integrada de notas. Los enlaces clásicos de Markdown `[texto](ruta.md)` también funcionan.
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
- El selector de iconos tiene dos modos: **Emoji** e **Iconos** (el conjunto de iconos Lucide, con un color seleccionable).
- Ambos se guardan en el frontmatter bajo `plainva:` (`icon`, `icon_color`, `header_color`) — pura presentación que no afecta a otros programas.

## Plantillas

Configura una **Carpeta de plantillas** en **Configuración → Configuración del vault → Notas diarias y plantillas**. Después inserta plantillas con `Ctrl+Alt+T` o el comando de barra oblicua **Insertar plantilla**. Las plantillas definen por completo el contenido de los archivos nuevos — incluido el frontmatter: si una plantilla trae su propio `type`, gana la plantilla.

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

## Imágenes y adjuntos

- **Insertar**: comandos de barra oblicua **Imagen interna** (buscar e incrustar desde el vault) o **Imagen (web)** (mediante una URL). También: simplemente **pega** una imagen desde el portapapeles (Ctrl+V) — se guarda junto a la nota y se incrusta. Y puedes **arrastrar archivos desde el explorador de archivos al editor**: las imágenes se incrustan (`![[…]]`), otros archivos se copian y se enlazan (`[[…]]`).
- **Ver**: los archivos de imagen (PNG, JPG, GIF, WebP, SVG, BMP, AVIF) se abren en el visor de imágenes integrado con **Acercar**/**Alejar**, **Ajustar** y **Tamaño real (1:1)**.
- **Editar**: el botón **Editar** abre el editor de imágenes con **Recortar**, girar/voltear, **Cambiar tamaño**, herramientas de dibujo (**Lápiz**, **Flecha**, **Rectángulo**, **Texto**) además de **Deshacer**/**Rehacer**. Guarda en el propio archivo o **Guardar como copia…**. Los formatos editables son PNG, JPG y WebP; otros formatos se abren solo para ver.
- Otros adjuntos se abren en el programa predeterminado del sistema con doble clic.

## ¿Y Obsidian?

Todo permanece como Markdown estándar con frontmatter estándar. Obsidian abre los archivos por completo; muestra la clave agrupada `plainva:` como un objeto no editable en su panel de propiedades — eso es intencional e inofensivo.

## Ver también

- [Bases de datos (.base)](Databases_Base.md) — notas como tabla, tablero o calendario
- [OKF](OKF.md) — qué significan `type` y `okf_version`
- [Buscar](Search.md) y [Atajos de teclado](Keyboard_Shortcuts.md)
