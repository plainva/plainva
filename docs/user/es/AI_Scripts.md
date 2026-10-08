# Scripts (Beta)

Última actualización: 2026-10-08

Un script es un programa pequeño para lo que un modelo hace mal y un programa hace siempre igual: contar, ordenar, comparar, sumar. Lo escribes en JavaScript. Se ejecuta en un entorno aislado dentro de Plainva: no puede abrir un archivo, llegar a la red ni esperar hasta más tarde. Solo llama a las herramientas que marcaste para él: estas leen tu vault igual que las herramientas de la IA o dejan una sugerencia sobre la que decides tú. Un script no cambia nada por sí solo.

## Ejecutar un script

Tus scripts están en **Habilidades**, en la pestaña de IA —en el teléfono, en **Conversaciones → Habilidades**—, dentro del grupo **Scripts**. **Ejecutar** abre el script: rellena lo que pide y pulsa **Ejecutar**. Mientras se ejecuta ves cada herramienta a la que llama, y con **Detener** lo terminas. Después, el diálogo muestra las **Llamadas**, el **Resultado** —que puedes copiar— y el **Registro**, y también cuánto de sus límites usó la ejecución.

Una ejecución que inicias aquí se queda en este dispositivo: nada de ello va a un modelo, así que también lee las notas que mantienes fuera de la nube. **Ejecución de prueba** llama a las herramientas que leen y solo anota las llamadas que mostrarían algo en la app o dejarían una sugerencia.

## En una conversación

En una conversación normal, la IA puede encontrar tus scripts activos y ejecutar uno cuando encaja; el paso dice entonces **Ejecutando el script «word-count»**. El script lee solo lo que esa conversación puede leer: una nota que mantienes fuera de la nube sigue sin salir de este dispositivo, y cada nota que lee el script cuenta entre lo que leyó la ejecución. Lo que devuelve va al modelo como datos, nunca como instrucciones. A una conversación iniciada con una habilidad no se le ofrece ningún script, y tampoco a una app de IA conectada mediante el servidor MCP.

## Sugerir cambios

A un script también se le pueden dar herramientas que sugieren. Las herramientas **Sugiriendo cambios en una nota** y **Sugiriendo un valor de propiedad** dejan una sugerencia en el margen de una nota; las herramientas **Redactando el borrador de una nota**, **Redactando el borrador de una entrada de base de datos**, **Redactando el borrador de una tarea** y **Redactando el borrador de una entrada de diario** dejan un borrador. Ambos van firmados con el nombre del script, y nada cambia en tu vault antes de que aceptes una sugerencia o crees un borrador, exactamente como con una sugerencia de la IA. Después de una ejecución, el diálogo los enumera bajo **Sugerencias y borradores**; una ejecución iniciada con **Ejecución de prueba** no deja nada.

Lo que un script ha leído decide dónde puede escribir: una sugerencia o un borrador que se apoya en una nota que mantienes fuera de la nube solo puede quedar en un lugar sujeto a la misma regla. En una conversación, a la IA se le ofrece un script que sugiere solo donde la propia conversación puede sugerir, y lo que el script deja allí lleva el nombre del modelo de la conversación.

## Escribir un script

**Nuevo script** pide:

- **Nombre** — letras minúsculas, cifras y guiones; pasa a ser el nombre de la carpeta.
- **Descripción** — para qué sirve el script; así lo reconoces tú, y también la IA.
- **Herramientas** — marca a qué puede llamar el script: bajo **Leer** lo que lee, bajo **Sugerir** lo que deja una sugerencia o un borrador. Para él no existe nada más.
- **Entradas** — lo que el script pide al empezar: un nombre, si es texto, un número o sí o no, y si es obligatorio.
- **Límites** — segundos de cálculo, llamadas a herramientas y memoria.
- **Código** — el programa.

**Crear y aprobar** escribe el script en tu vault como `.agent/scripts/<name>/` —un `manifest.json` y un `main.js`— y lo aprueba en este dispositivo. **Editar** en el menú de un script abre el mismo formulario; **Guardar y aprobar** sustituye los archivos.

El código es el cuerpo de una función. `input` contiene las entradas por su nombre, `tools.<name>(…)` llama a una herramienta y se espera con `await`, `return` devuelve el resultado y `console.log(…)` escribe una línea en el registro:

```js
const found = await tools.search_vault({ query: "#" + input.tag, limit: 25 });
const notes = [];
for (const hit of found.results) {
  const note = await tools.read_note({ path: hit.path });
  if (note.text.includes("#" + input.tag)) notes.push(hit.path);
}
return { tag: input.tag, count: notes.length, notes };
```

El lenguaje es JavaScript en su versión ES2020. No hay `fetch`, temporizador, `import` ni acceso a archivos, y lo que devuelve un script tiene que ser algo que pueda escribirse como JSON. Una herramienta que rechaza la llamada —por ejemplo, una nota que no existe o una nota que la conversación no puede leer— lanza un error que el script puede capturar.

## Qué devuelve una herramienta

**Qué devuelve una herramienta** en el formulario abre esta página. Cada herramienta recibe un objeto y devuelve uno; `cursor` toma el `next` de la llamada anterior y continúa su lista.

| Herramienta | Lo que pasas | Lo que obtienes |
|---|---|---|
| `search_vault` — **Buscando en el vault** | `query`; opcionalmente `folder`, `limit` (hasta 25), `cursor` | `results`: una lista de `{ title, path, snippet }`; `next` |
| `read_note` — **Leyendo una nota** | `path`; opcionalmente `section`, `maxChars` (de 200 a 20.000), `cursor` | `path`, `text`, `next` |
| `get_outline` — **Leyendo el esquema** | `path` | `path`; `properties`: nombre y valor; `sections`: una lista de `{ level, text, section }` |
| `query_base` — **Leyendo una base de datos** | `base`, la ruta del archivo `.base`; opcionalmente `view`, `limit` (hasta 50), `cursor` | `base`, `view`, `views`; `rows`: una lista de `{ title, path, properties }`; `next` |
| `get_tasks` — **Leyendo tareas** | opcionalmente `range` (`today`, `upcoming`, `overdue`, `inbox`, `all`, `done`), `limit` (hasta 50), `cursor` | `tasks`: una lista de `{ state, title, due, priority, path, note, source }`; `next` |
| `get_backlinks` — **Leyendo retroenlaces** | `path`; opcionalmente `limit` (hasta 50), `cursor` | `path`; `notes`: una lista de `{ title, path, links, places }`; `next` |
| `graph_neighborhood` — **Siguiendo enlaces** | `path`; opcionalmente `depth` (1 o 2), `limit` (hasta 50) | `path`; `notes`: una lista de `{ title, path, fromHere, toHere, via }` |
| `get_recent` — **Mirando notas recientes** | opcionalmente `kind` (`opened` o `edited`), `limit` (hasta 20) | `kind`; `notes`: una lista de `{ title, path, at }` |
| `get_calendar` — **Leyendo citas** | `from` y `to` como `YYYY-MM-DD`; opcionalmente `details`, `limit` (hasta 100) | `events`: una lista de `{ day, start, end, allDay, title, cancelled, place, with, others, online, event }`; `more` |
| `run_command` — **Usando la aplicación** | `id`, un comando de la app como `open-note`, `show-in-graph` u `open-calendar`; opcionalmente `args` con `path`, `section` o `date` | `done`, `command` |
| `propose_edit` — **Sugiriendo cambios en una nota** | `path`; `edits`, una lista de `{ find, replace }`, o `append`; opcionalmente `section`, `note` | `proposed`, `path`, `passages` |
| `set_property` — **Sugiriendo un valor de propiedad** | `path`, `key`, `value`; opcionalmente `note` | `proposed`, `path`, `property` |
| `create_note` — **Redactando el borrador de una nota** | `title`, `content`; opcionalmente `folder` | `drafted`, `kind`, `title` |
| `create_entry` — **Redactando el borrador de una entrada de base de datos** | `base`, `title`; opcionalmente `properties`, `content` | `drafted`, `kind`, `title`, `base` |
| `create_task` — **Redactando el borrador de una tarea** | `text` | `drafted`, `kind`, `title` |
| `add_journal_entry` — **Redactando el borrador de una entrada de diario** | `text`; opcionalmente `task` | `drafted`, `kind` |

## Límites

Un script lleva sus límites en su manifiesto. El formulario fija tres de ellos:

| Límite | Por defecto | Rango |
|---|---|---|
| **Segundos de cálculo** | 5 | de 1 a 30 |
| **Llamadas a herramientas** | 20 | de 0 a 50 |
| **Memoria en MB** | 32 | de 8 a 128 |

Solo cuenta el tiempo que un script pasa calculando, no el que tarda una herramienta. Un script que supera un límite se termina, el diálogo dice cuál fue el límite y un script terminado no devuelve nada. Los argumentos de una llamada y el resultado pueden ocupar, cada uno, 64 KB como máximo.

## Nada se ejecuta antes de que lo apruebes

Un script nuevo o cambiado —por sincronización o escrito por otro programa— no se ejecuta hasta que lo apruebes **en este dispositivo**. Espera arriba en **Habilidades**, en **Esperan tu aprobación**. **Revisar y aprobar** muestra **Qué puede hacer**, sus **Límites**, su **Entrada** y todo el **Código**, e indica si el código se puede leer como JavaScript; un código que no se puede leer no se aprueba.

Con **Aprobar**, este dispositivo firma exactamente estos archivos. La clave para ello se crea en este dispositivo y se guarda en su llavero. Cualquier cambio en un archivo anula la aprobación, y en cada uno de tus otros dispositivos el script espera su propia aprobación: una aprobación no se puede llevar de un dispositivo a otro. **Retirar la aprobación** en el menú de un script la quita, y **Ver el código** muestra la revisión otra vez.

## Límites de la beta

Un script sugiere y deja borradores; nunca renombra, mueve ni elimina una nota, y no redacta ningún correo ni ninguna cita. Una habilidad no puede iniciar un script, y la carpeta `scripts/` propia de una habilidad no se ejecuta. El correo, Internet y las herramientas de servidores externos no están disponibles para los scripts.
