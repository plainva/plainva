# Importar de otra aplicación

Última actualización: 2026-07-26

Plainva puede traer notas desde otras aplicaciones de notas. La importación siempre escribe en el vault que tienes abierto en ese momento, en una subcarpeta que tú nombras — así que nunca toca el resto de tu vault, y puedes mover o eliminar la carpeta importada después como cualquier otra carpeta.

**La importación se realiza en el escritorio.** La aplicación móvil no puede importar: trae las notas en el escritorio y llegarán a tu teléfono a través de la sincronización, como cualquier otro archivo.

## Iniciar una importación

Dos formas de empezar:

- **Paleta de comandos** (`Mod+P`) → **Importar de otra aplicación...**
- **Clic derecho en una carpeta** del árbol de archivos → **Importar de otra aplicación...**

El asistente tiene tres pasos: elige la aplicación de la que vienes, elige los archivos de exportación (o introduce un token de Notion), y nombra la carpeta de destino. Luego obtienes una vista previa con el número de notas y bases de datos y una lista de todo lo que el importador no puede trasladar. No se escribe nada hasta que pulsas **Iniciar importación**.

## Qué puedes importar

| Origen | Qué seleccionas | Qué se traslada |
|---|---|---|
| **Notion (API)** | Un token de integración | Páginas, jerarquía de carpetas, bases de datos con filas, relaciones, 21 tipos de propiedad |
| **Notion (exportación ZIP)** | El ZIP o la carpeta descomprimida | Páginas y estructura de carpetas. Las bases de datos se crean **vacías** |
| **Evernote (ENEX)** | Uno o más archivos `.enex` | Notas, etiquetas, listas de tareas, fechas de creación/actualización |
| **Google Keep (Takeout)** | El ZIP de Takeout o los archivos `.json` | Notas, listas de tareas, etiquetas como tags, color, fijadas/archivadas |
| **Simplenote** | El archivo `.json` exportado | Notas activas y sus etiquetas |
| **Logseq** | Tu carpeta del grafo | Los archivos, copiados sin cambios |
| **Carpeta / ZIP de Markdown** | Una carpeta, archivos o un ZIP | Los archivos `.md` y su estructura de carpetas |

No hay un importador de Obsidian — y no hace falta ninguno. Plainva abre un vault de Obsidian directamente: **Abrir vault** y elige la carpeta.

## Notion en detalle

Notion es la única fuente donde los dos caminos difieren mucho.

**Con un token de integración (recomendado).** Crea un token en `notion.so/my-integrations`. Luego abre cada página de Notion que quieras importar, elige **"..."** en la esquina superior derecha → **Conexiones**, y añade tu integración — Notion solo expone las páginas que has conectado explícitamente.

A través de la API, Plainva ve la estructura, no solo el texto:

- La jerarquía de páginas se convierte en una estructura de carpetas.
- Cada base de datos se convierte en un archivo `.base` más una carpeta con **una nota por fila**.
- **Las relaciones se convierten en enlaces wiki** entre esas notas, en ambas direcciones.
- Se traducen 21 tipos de propiedad — selección, estado, selección múltiple, fecha, número, casilla, URL, correo electrónico, teléfono, fórmula, rollup, relación, personas, ID único y más.
- Se generan vistas de tabla, tablero, calendario y lista a partir del esquema de la base de datos.
- Las bases de datos incrustadas dentro de una página se convierten en incrustaciones `![[Database.base]]` en vivo.

**Desde una exportación ZIP.** Esto funciona sin conexión y no necesita ningún token, pero la exportación de Notion no contiene el esquema de la base de datos ni los IDs de página. Las páginas y sus carpetas se trasladan; las bases de datos se crean como archivos `.base` **vacíos**, y el informe lo indica. Si tus bases de datos importan, usa la vía de la API.

## Lo que las importaciones no pueden trasladar

Cada importador indica sus límites en la vista previa y de nuevo en el informe. Los principales:

- **Los adjuntos y las imágenes no se importan.** Los archivos ZIP se leen solo en busca de archivos de texto; los adjuntos de Evernote y las imágenes de Keep se quedan atrás.
- **Las páginas muy largas de Notion** se leen por completo, pero el contenido anidado dentro de desplegables, columnas o sublistas no se sigue.
- **Los archivos de Logseq se copian sin cambios** — las propiedades `key:: value` y las referencias a bloques no se convierten en propiedades ni enlaces de Plainva.
- **La papelera de Simplenote** se omite.
- **Las exportaciones ZIP de Notion** crean bases de datos vacías (ver arriba).

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

## Ver también

- [Bases de datos (.base)](Databases_Base.md) — qué ocurre con las bases de datos de Notion importadas
- [OKF](OKF.md) — el frontmatter que reciben las notas importadas
- [Primeros pasos](Getting_Started.md) — crear un vault separado para una importación
