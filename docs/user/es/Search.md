# Buscar

Última actualización: 2026-09-30

Plainva ofrece tres formas de buscar: búsqueda de texto completo en todo el vault, el selector rápido para abrir archivos, y buscar y reemplazar dentro de una nota.

## Búsqueda de texto completo en el vault

El campo superior de la barra lateral busca títulos y contenidos en todo el vault. El índice local de texto completo (SQLite FTS5) se construye al abrir el vault y se actualiza cuando cambian los archivos. La búsqueda funciona sin conexión.

La búsqueda reacciona mientras escribes: los prefijos de palabra ya coinciden ("Proy" encuentra "Proyecto plan") — no hace falta pulsar Enter. La **X** a la derecha del campo borra la búsqueda actual (o pulsa `Esc`); la barra lateral vuelve entonces a mostrar el árbol de archivos normal.

En chino, japonés, tailandés y otras escrituras sin espacios entre palabras, la búsqueda encuentra un término en cualquier parte del texto: `議事録` encuentra "今日は会議の議事録を書いた", `搜索` encuentra "全文搜索". También se encuentran palabras latinas dentro de ese texto ("Plainva" en "…でPlainvaを使った").

La búsqueda muestra cada aparición con un fragmento, la ruta de encabezados y el número de línea. Al abrir una fila se selecciona esa aparición concreta; varias coincidencias de una misma nota aparecen por separado. El contador incluye solo los resultados ya cargados. Puedes cargar más apariciones. Las flechas cambian la selección y Enter la abre. Se indican la carga, los resultados vacíos y los errores; una nueva consulta descarta respuestas anteriores. Si una edición impide identificar la aparición de forma inequívoca, se muestra un aviso. Estas apariciones también están disponibles en el selector rápido y la búsqueda móvil. Al volver a la búsqueda en el teléfono se recuperan la consulta, los resultados cargados y la posición de la lista. Los resultados llegan por **Relevancia**, salvo que elijas **Última modificación**, **Título** o **Ruta** con el botón de ordenar junto al campo de búsqueda (en el teléfono: en la barra de la búsqueda); al cargar más se mantiene el orden elegido. En el teléfono la hoja de orden sigue abierta hasta que tocas **Listo**: tocar otra vez el orden elegido invierte la dirección.

El campo de búsqueda también se aplica a las demás vistas de la barra lateral: en **Etiquetas** filtra la lista de etiquetas, en **Marcadores** los marcadores.

### Operadores de búsqueda

- `"frase exacta"` — las comillas hacen coincidir la secuencia de palabras exactamente. Esto también sirve como búsqueda de palabra completa para un solo término: `"plan"` encuentra "plan" pero no "planificación". En las escrituras sin espacios, las comillas no cambian nada: ese texto no tiene límites de palabra.
- `-término` — excluye las notas que contienen el término (también funciona con frases: `-"versión antigua"`).
- `path:carpeta` — solo archivos cuya ruta contiene el texto (p. ej. `path:Proyectos`; con espacios: `path:"Mi Carpeta"`).
- `tag:nombre` — solo notas con esa etiqueta, incluidas las etiquetas anidadas: `tag:proyecto` también encuentra `#proyecto/interno`. `tag:#proyecto` también funciona.
- Los operadores pueden negarse (`-path:Archivo`, `-tag:hecho`) y combinarse libremente con términos de búsqueda: `plan tag:proyecto -borrador`.
- Varios términos se combinan con AND. Los caracteres especiales como `- ( ) : *` dentro de los términos son inofensivos — Plainva trata la entrada de forma literal.

## Búsqueda por significado

Con un modelo local, la búsqueda también encuentra notas por lo que significan — no solo por sus palabras, y entre idiomas: una pregunta en español encuentra una nota en inglés que dice lo mismo. El modelo calcula en este dispositivo; tus notas y los vectores calculados a partir de ellas nunca salen de él.

Actívala en **Configuración → IA y automatización → Búsqueda semántica** (la IA debe estar activada). Elige un modelo — el recomendado es **Granite Embedding Multilingual R2 (97M)** — y Plainva muestra su tamaño, fuente, licencia y una duración estimada antes de descargar nada. Cada archivo procede de una versión fija en huggingface.co y se verifica por su SHA-256; no hace falta iniciar sesión. Antes de procesar la primera nota, Plainva comprueba que el modelo calcula correctamente en este dispositivo.

En lugar de un paquete puedes elegir **Proveedor propio**: entonces el modelo del perfil **Embeddings** calcula los vectores — cualquier modelo de embeddings que ofrezca tu proveedor, por ejemplo `text-embedding-3-small` en OpenAI, `gemini-embedding-001` en Gemini o `nomic-embed-text` en Ollama. Con Ollama o LM Studio nada sale de tu ordenador. Con una nube, el resumen muestra una vez lo que va allí —cada nota que tus reglas de privacidad dejan pasar, ahora y cada vez que cambie, y tus preguntas de búsqueda— y **Aprobar de forma permanente** lo inicia; **Retirar la aprobación** en la configuración lo detiene. Las notas que tus reglas mantienen fuera de la nube se quedan fuera, y en un espacio cifrado solo calcula un paquete o un servidor en este ordenador. Si otro modelo responde con el mismo nombre —un nuevo `ollama pull`, un servidor que se movió—, Plainva lo nota antes de la siguiente nota y vuelve a calcular los vectores en lugar de mezclar dos modelos. Si no se puede contactar con el proveedor, la búsqueda responde por palabras y lo indica. **Sin usar en este dispositivo** lista paquetes y vectores de modelos que ya no usas; **Quitar** los elimina.

Mientras un modelo está activo, la cabecera de los resultados ofrece **Palabras**, **Significado** y **Ambos**:

- **Palabras** es la búsqueda de texto completo descrita arriba.
- **Significado** lista las notas cuyas secciones más se acercan a tu pregunta; abrir un resultado lleva a esa sección.
- **Ambos** (predeterminado) ordena juntos los resultados de palabras y significado.

En **Significado** y **Ambos** cada nota aparece una vez, y una pequeña etiqueta indica qué la encontró: **Palabras**, **Significado** o **Palabras y significado**. Los operadores de búsqueda (`path:`, `tag:`, `-término`) también limitan los resultados por significado. La elección se aplica a este dispositivo.

Plainva procesa las notas en segundo plano, las modificadas más recientemente primero; una nota que estás editando sigue unos segundos después de que dejes de escribir. Hasta entonces solo se encuentra por sus palabras — un resultado por significado nunca procede del texto antiguo de una nota. Una línea bajo los resultados muestra el avance y ofrece **Pausar**. En el teléfono solo se procesa mientras Plainva está abierto. **Quitar (con sus vectores)** en la configuración borra el modelo y todo lo que calculó.

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

Cada coincidencia muestra dos líneas: **antes** con el hallazgo y **después** con el resultado; con una expresión regular se resuelven las referencias `$1`, para comprobar el cambio antes de escribir nada. Una expresión no válida se indica junto al campo en lugar de devolver una lista vacía; si no hay coincidencias, el estado vacío dice qué revisar. Durante el reemplazo ves el progreso y puedes **Cancelar**: las notas ya escritas se quedan escritas y se nombran. En el teléfono cada coincidencia muestra las mismas dos líneas.

**En el teléfono** lo mismo está en la lupa de la cabecera y luego `>` y **Buscar y reemplazar en el vault**: las coincidencias se agrupan por nota y aparecen plegadas, para que un término con cuarenta coincidencias no entierre la acción; toca una nota para verla por dentro, desmarca las que quieras dejar fuera y el botón indica su propio alcance (**Reemplazar en 2 notas**). Si sales de la app, un reemplazo en curso se detiene en la siguiente nota: las notas ya escritas se conservan y se nombran.

## Etiquetas

La vista **Etiquetas** de la barra lateral lista todas las `#etiquetas` del vault con un recuento de coincidencias; un clic muestra los **Archivos con #etiqueta**. Las etiquetas funcionan en el texto (`#proyecto`) y en el frontmatter (`tags: [proyecto]`). El campo de búsqueda de la barra lateral también filtra la lista de etiquetas.

En la nota, una etiqueta se dibuja como una pequeña píldora, tanto al escribir como al leer; el texto sigue siendo `#proyecto/web`. Un clic en la píldora (en el teléfono: un toque en modo lectura) abre las notas que llevan la etiqueta. Lo que cuenta como etiqueta es lo mismo en todas partes — en la lista de etiquetas, en una tarea y al renombrar: un `#` al inicio de la línea o tras un espacio, seguido de letras, dígitos, `_`, `-` o `/`. Solo dígitos no es una etiqueta (`#42` sigue siendo un número), y tampoco lo es nada dentro de código o de un enlace. **Colorear etiquetas** en **Configuración → App → Apariencia** da a cada etiqueta un color que se deriva de su nombre; las etiquetas anidadas comparten el color de su etiqueta superior. El ajuste pertenece a este dispositivo y no guarda nada en tus notas.

**Renombrar una etiqueta** en todo el vault: haz clic derecho en una etiqueta de la vista **Etiquetas** e introduce un nuevo nombre. Plainva reescribe la etiqueta en todas partes — en el cuerpo de las notas (`#tag` y sus etiquetas anidadas `#tag/child`) y en el frontmatter (`tags:`) — guardando cada nota afectada por la misma vía segura. Las etiquetas no relacionadas que simplemente contienen ese nombre (por ejemplo, `#area/tag`) permanecen intactas.

## Navegar dentro de una nota

El **Esquema** de la barra lateral derecha lista todos los encabezados de la nota activa — un clic salta al punto correspondiente. Para saltar entre notas, también ayudan **Retroenlaces** (quién enlaza aquí) y los botones **Atrás**/**Adelante** del editor.

## Ver también

- [Atajos de teclado](Keyboard_Shortcuts.md)
- [Bases de datos (.base)](Databases_Base.md) — consultas estructuradas sobre propiedades en lugar de texto completo
