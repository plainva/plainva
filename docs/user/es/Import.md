# Importar de otra aplicación

Última actualización: 2026-07-28

Plainva puede traer notas desde otras aplicaciones de notas. La importación siempre escribe en el vault que tienes abierto en ese momento, en una subcarpeta que tú nombras — así que nunca toca el resto de tu vault, y puedes mover o eliminar la carpeta importada después como cualquier otra carpeta.

**La importación se realiza en el escritorio.** La aplicación móvil no puede importar: trae las notas en el escritorio y llegarán a tu teléfono a través de la sincronización, como cualquier otro archivo.

## Iniciar una importación

Tres formas de empezar:

- **Pantalla de inicio** → **Importar de otra aplicación** — el camino a seguir si todavía no tienes ningún vault, el caso habitual cuando estás cambiando de aplicación.
- **Paleta de comandos** (`Mod+P`) → **Importar de otra aplicación...**
- **Clic derecho en una carpeta** del árbol de archivos → **Importar de otra aplicación...**

El primer paso te pide tu exportación — **Elegir archivos...** o **Elegir carpeta...**, lo que tengas. El asistente indica entonces la aplicación que reconoció y tú decides adónde escribe la importación. A continuación aparece una vista previa con los números de la ejecución, los límites de esta importación y las opciones para el origen. No se escribe nada hasta que pulsas **Iniciar importación**.

**No necesitas saber qué entrada corresponde a tu exportación.** Elige los archivos, y Plainva reconoce el origen — una exportación de Notion por los ID largos en sus rutas, un grafo de Logseq por sus carpetas `journals/` y `pages/`, una exportación de Keep o Simplenote por el contenido del JSON. El asistente indica qué ha reconocido; si se equivoca, cámbialo en la lista de arriba y tu elección se mantiene.

## Adónde escribe la importación

Exactamente uno de los dos por importación — nunca ambos:

- **Nuevo vault**: eliges una carpeta vacía, Plainva crea en ella un vault nuevo e importa ahí. Nada de lo que ya tienes puede verse afectado, y deshacer toda la importación consiste en eliminar esa carpeta. Es la opción adecuada si estás probando Plainva.
- **Subcarpeta del vault abierto**: todo termina en una única subcarpeta recién creada, que tú nombras. El resto de tu vault queda intacto.

La línea de destino bajo la elección siempre indica la carpeta exacta, de modo que dónde acabará algo nunca es una suposición.

## Opciones para esta importación

La vista previa muestra, debajo de los números, los interruptores **que corresponden al origen reconocido** — cada origen aporta los suyos, y lo que un origen no puede hacer nunca aparece ahí. Están ahí y no antes, porque las preguntas solo tienen sentido una vez que ves lo que se avecina; un interruptor que cambia los números hace que se recuenten al instante.

- **Mantener las fechas de la fuente** (activado) — las notas importadas conservan las fechas de creación y modificación del origen. Sin esta opción, todas quedan fechadas hoy.
- **Importar también las notas eliminadas** (desactivado) — para Google Keep y Simplenote, cuyas exportaciones incluyen la papelera. Por defecto, lo que hay ahí se queda ahí; el informe lo nombra.

## Lo que muestra la vista previa

La vista previa es la última parada antes de que se escriba nada, y menciona todo lo que después sería una sorpresa:

- los números de la ejecución — notas y bases de datos, además de **adjuntos** y **listas de tareas** donde el origen tenga alguno,
- la carpeta de destino exacta,
- lo que este importador **no puede** trasladar, y cada entrada del archivo que se omitió,
- para un vault con conexión a la nube, el aviso de que las notas importadas se **subirán** después,
- para orígenes muy grandes, el aviso de que el índice de búsqueda y la primera sincronización tardarán un rato.

## Detener una ejecución

Un espacio de trabajo grande puede tardar, así que una importación se puede detener: **Detener importación** durante la ejecución. Lo que ya ha llegado al vault permanece ahí, y el informe lo describe — una importación parcial no es una importación rota. Igual que con una importación completa, deshacerlo es eliminar la carpeta.

## Qué puedes importar

| Origen | Qué seleccionas | Qué se traslada |
|---|---|---|
| **Notion (API)** | Un token de integración | Páginas, jerarquía de carpetas, bases de datos con filas, relaciones, 21 tipos de propiedad |
| **Notion (exportación ZIP)** | El ZIP o la carpeta descomprimida | Páginas y estructura de carpetas. Las bases de datos se crean **vacías** |
| **Evernote (ENEX)** | Uno o más archivos `.enex` | Notas, etiquetas, listas de tareas (marcadas y sin marcar), fechas de creación/actualización |
| **Google Keep (Takeout)** | El ZIP de Takeout o los archivos `.json` | Notas, listas de tareas, etiquetas como tags, color, fijadas/archivadas |
| **Simplenote** | El archivo `.json` exportado | Notas activas y sus etiquetas |
| **Logseq** | Tu carpeta del grafo | Los archivos, copiados sin cambios |
| **Carpeta / ZIP de Markdown** | Una carpeta, archivos o un ZIP | Los archivos `.md` y su estructura de carpetas |

**Obsidian** también está en la lista, pero no inicia ninguna importación — y tampoco la necesita. Plainva trabaja con los mismos archivos Markdown: la entrada lo explica y te ofrece **Abrir vault**. Los enlaces wiki, las etiquetas, el frontmatter y los archivos `.base` siguen funcionando, y tu vault sigue siendo utilizable en Obsidian. Siendo honestos: no hay ecosistema de plugins, ni Canvas ni Dataview — en su lugar tienes filtros en `.base`, y la sintaxis de los plugins en tus notas se queda ahí como texto plano.

## Notion en detalle

Notion es la única fuente donde los dos caminos difieren mucho.

**Con un token de integración (recomendado).** Crea un token en `notion.so/my-integrations` — el asistente detalla los tres pasos y te abre la página. Luego abre cada página de Notion que quieras importar, elige **"..."** en la esquina superior derecha → **Conexiones**, y añade tu integración — Notion solo expone las páginas que has conectado explícitamente.

**Plainva no guarda el token.** Se usa para esa única ejecución y desaparece después; no se crea ninguna cuenta conectada. Para la siguiente importación tendrás que volver a pegarlo.

A través de la API, Plainva ve la estructura, no solo el texto:

- La jerarquía de páginas se convierte en una estructura de carpetas.
- Cada base de datos se convierte en un archivo `.base` más una carpeta con **una nota por fila**.
- **Las relaciones se convierten en enlaces wiki** entre esas notas, en ambas direcciones.
- Se traducen 21 tipos de propiedad — selección, estado, selección múltiple, fecha, número, casilla, URL, correo electrónico, teléfono, fórmula, rollup, relación, personas, ID único y más.
- Se generan vistas de tabla, tablero, calendario y lista a partir del esquema de la base de datos.
- Las bases de datos incrustadas dentro de una página se convierten en incrustaciones `![[Database.base]]` en vivo.

**Desde una exportación ZIP.** Esto funciona sin conexión y no necesita ningún token, pero la exportación de Notion no contiene el esquema de la base de datos ni los IDs de página. Las páginas y sus carpetas se trasladan, y **los enlaces entre las páginas importadas siguen funcionando** — Notion los escribe con un ID largo en cada segmento de la ruta, y Plainva los dirige a las notas que realmente escribió. Las bases de datos se crean como archivos `.base` **vacíos**, y el informe lo indica. Si tus bases de datos importan, usa la vía de la API.

## Lo que las importaciones no pueden trasladar

Cada importador indica sus límites en la vista previa y de nuevo en el informe. Los principales:

- **Los adjuntos y las imágenes no se importan.** El informe los enumera uno por uno para que sepas qué permanece en tu exportación; los adjuntos de Evernote y las imágenes de Keep también se quedan allí.
- **Algunas entradas del ZIP se omiten a propósito:** archivos muy grandes, enlaces simbólicos y entradas con una ruta insegura. Aparecen con un motivo en la vista previa, antes de que inicies la importación.
- **Las páginas muy largas de Notion** se leen por completo, pero el contenido anidado dentro de desplegables, columnas o sublistas no se sigue.
- **Los archivos de Logseq se copian sin cambios** — las propiedades `key:: value` y las referencias a bloques no se convierten en propiedades ni enlaces de Plainva.
- **Las notas eliminadas siguen eliminadas.** La papelera de Simplenote y de Google Keep se omite — en su día decidiste prescindir de esas notas, y una importación no debería devolvértelas en silencio. Aparecen mencionadas por su nombre en el informe, para que veas qué quedó atrás.
- **Las exportaciones ZIP de Notion** crean bases de datos vacías (ver arriba).

## Las fechas también se trasladan

Una colección acumulada a lo largo de los años pierde su eje temporal si todo aparece fechado hoy después de una importación. Por eso Plainva traslada las fechas de origen:

- Aparecen como `created` y `updated` en el frontmatter de la nota importada, que es también donde el eje temporal del grafo las lee.
- El propio archivo también recibe la fecha de modificación de origen, de modo que el orden por fecha y **Abiertos recientemente** sean correctos. La fecha de creación del archivo solo se puede establecer en Windows; en los demás sistemas, el frontmatter es quien la transporta.
- Si un origen no aporta fechas, Plainva usa la fecha del archivo de exportación. Nunca inventa una: si no hay ninguna indicación, el campo queda vacío.

## Un fallo no termina toda la importación

Si una sola nota no se puede escribir, la importación continúa y el informe la menciona con el motivo. El informe se escribe incluso cuando la ejecución se detiene antes de tiempo — así que siempre ves lo que ya ha llegado a tu vault.

## Nada se sobrescribe

La importación escribe en el vault que tienes abierto, así que está diseñada para no ser destructiva:

- Si el nombre de una nota ya está en uso, la nota importada se **numera** (`Meeting (2).md`) en lugar de reemplazar la existente. Esto también se aplica cuando dos notas de origen comparten un nombre.
- Las notas importadas reciben el frontmatter OKF habitual (`type`, `okf_version`), así que se comportan como cualquier otra nota de Plainva en los filtros y vistas de `.base`.
- No se modifica nada fuera de la subcarpeta de destino.

Si prefieres mantener la importación completamente separada, crea primero un nuevo vault (**Nuevo vault** en la pantalla de inicio) e importa en él.

## El informe de importación

Cada ejecución escribe un **informe de importación** en la carpeta de destino. En él se detalla:

- cuántas notas y bases de datos se importaron,
- qué es lo que este importador no puede trasladar en absoluto,
- todo lo que llegó **de forma incompleta** o se **omitió**, con el motivo,
- y cada archivo, con su estado.

El informe es el registro honesto de la ejecución — si algo se truncó o se descartó, aparece ahí en lugar de contarse silenciosamente como un éxito. Vale la pena leerlo antes de eliminar la exportación.

Al final se explica cómo **deshacer** la importación: todo lo de una ejecución vive en una única carpeta — eliminarla hace desaparecer la importación. Con el destino **Nuevo vault**, esa es la propia carpeta del nuevo vault. No hace falta ningún comando de deshacer aparte para esto. El propio informe es una nota normal y puede eliminarse en cuanto lo hayas leído.

## Ver también

- [Bases de datos (.base)](Databases_Base.md) — qué ocurre con las bases de datos de Notion importadas
- [OKF](OKF.md) — el frontmatter que reciben las notas importadas
- [Primeros pasos](Getting_Started.md) — crear un vault separado para una importación
