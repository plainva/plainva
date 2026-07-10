# Grafo

Stand: 2026-07-10

El grafo de Plainva es una herramienta de trabajo, no un póster: te muestra dónde estás, qué está conectado, qué falta — y puedes actuar directamente sobre ello. Hay UN único motor de grafo con tres caras.

## Grafo de contexto (barra lateral derecha)

Abre la sección **Grafo** en la barra lateral derecha. Muestra la nota activa en el centro, la estructura de carpetas arriba, para resúmenes de carpeta (index.md) las notas contenidas abajo, las referencias entrantes a la izquierda y las salientes a la derecha. Las relaciones de las bases de datos llevan el nombre de su propiedad como etiqueta.

- Al hacer clic en un nodo se abre la nota (el foco gira contigo).
- Ctrl/Cmd+clic abre en un panel dividido, el clic central en una pestaña nueva.
- Arrastra un nodo a otro lugar y queda anclado (punto pequeño), guardado por nota — al volver a abrir esa nota, tu disposición reaparece. La nota activa siempre permanece en el centro. El **icono de anclaje** de la esquina superior derecha activa y desactiva el recordado; al desactivarlo se descarta la disposición guardada de esta nota.
- Debajo aparecen hasta tres **sugerencias**: notas que mencionan tu nota activa (pero no la enlazan), que suelen enlazarse junto a ella, que comparten un vecindario similar o que comparten una etiqueta rara. Donde el título aparece como texto en la nota que estás editando, la sugerencia muestra una **vista previa del pasaje** que se enlazaría; **Enlazar** convierte exactamente ese pasaje en un enlace wiki (como `[[Destino|texto]]` cuando el texto visible difiere del destino). Si no hay ningún pasaje coincidente, el enlace se añade al final de la nota (la vista previa lo indica). **Descartar sugerencia** recuerda tu decisión.

## Mapa del vault (su propia pestaña)

Abre el mapa con **Ctrl/Cmd+Shift+G**, mediante el icono de grafo en la **barra de acciones** en el extremo izquierdo, o desde la paleta de comandos (**Abrir grafo**). Se abre en su propia pestaña. En lugar de una maraña, ves tu estructura real de carpetas como burbujas — haz doble clic en una burbuja para desplegar sus notas, **Contraer todas las carpetas** vuelve atrás. La disposición es determinista: el mismo mapa se ve igual cada vez que lo abres. **Desplaza el mapa** con el botón central del ratón o Ctrl/Cmd+arrastrar, y haz **zoom** con la rueda del ratón. Arrastra un nodo y queda anclado (punto pequeño). En la esquina superior derecha, el **icono de anclaje** activa y desactiva el recordado: desactívalo y se descarta la disposición guardada de esta vista, y vuelve la disposición automática (lo mismo que **Restablecer disposición** en el menú del clic derecho). Los anclajes se guardan por dispositivo.

Herramientas en la barra de encabezado:

- Estilos de arista de un vistazo (leyenda, abajo a la izquierda): las **relaciones** son líneas de acento continuas con una etiqueta, los **enlaces** son discontinuos, las **incrustaciones** son punteadas.
- **Buscar** atenúa todo lo que no coincide. Filtra por **tipo** (OKF) y **etiqueta**; los tipos de arista (**Enlaces**, **Relaciones**, **Incrustaciones**) se activan individualmente.
- **Enfocar la selección** reduce el mapa a una nota seleccionada más 1–3 saltos de vecindario.
- **Mapa de calor** ilumina las notas editadas recientemente (7/30/90 días) — "¿en qué estaba trabajando?".
- **Viaje en el tiempo** muestra las notas por su fecha de creación; el deslizador reproduce el crecimiento de tu vault. La fecha proviene de una propiedad `date`/`datum`, si no, de la fecha de creación del archivo (una aproximación para vaults solo en la nube).

Trabajando en el mapa:

- Arrastra un nodo **sobre** otro: Plainva ofrece escribir un enlace de texto — o directamente una **relación** coincidente de tus bases de datos (si la relación permite exactamente una entrada, Plainva pregunta antes de reemplazarla).
- Clic derecho en un nodo: Abrir, Vista rápida, Abrir en división, **Nueva nota conectada**, Renombrar (con actualización de enlaces en todo el vault), Marcador, Eliminar.
- Clic derecho en un espacio vacío: **Nueva nota**, Restablecer disposición, **Exportar como PNG/SVG**.
- Al hacer clic en un haz de aristas entre carpetas se listan los enlaces individuales; al pasar el cursor sobre una arista se muestra la frase en la que vive el enlace.
- **Arrastrar sobre un espacio vacío** dibuja un rectángulo de selección y marca varias notas (Mayús+arrastrar amplía una selección existente); arrastra después uno de los nodos marcados y todos se moverán juntos. El pie de página ofrece marcador/eliminar para la selección.

## Limpieza

El botón **Limpiar** abre una lista de trabajo con tres pestañas: **Huérfanas** (notas sin conexiones), **Enlaces rotos** (destinos que no existen — **Crear nota** los crea) y **Menciones** (**Escanear el vault** encuentra lugares donde se nombra una nota pero no se enlaza; **Enlazar** convierte la aparición en un enlace wiki). El pie de página del mapa muestra el número de huérfanas — al hacer clic se abre el panel.

## Grafo como vista de base de datos

Toda base de datos `.base` puede tener una vista **Grafo** (añadir vista → **Grafo**): las filas de la base de datos se convierten en nodos, tus **relaciones** se convierten en aristas etiquetadas. En la barra de encabezado eliges las propiedades de arista, **Color según** una propiedad de selección, **Tamaño según** un número y si aparecen los **destinos externos** (relaciones que apuntan fuera de la base de datos) o las **relaciones entrantes** (relaciones de otras bases de datos que apuntan a estas entradas — p. ej. las tareas de un proyecto). La vista se guarda de forma compatible con Obsidian — Obsidian muestra el mismo archivo como una tabla.

## Límites

- El grafo muestra notas (archivos), no párrafos individuales.
- Los anclajes y las sugerencias descartadas viven bajo `.plainva/` y no viajan con la sincronización — la disposición base es idéntica en cada dispositivo.
- Las sugerencias son puros análisis del vault; nada sale de tu equipo.
