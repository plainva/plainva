# Automatización y scripts

Última actualización: 2026-07-15

Plainva no tiene ningún sistema de plugins que ejecute código de terceros. En su lugar, el propio vault es la interfaz de extensión: tus notas son Markdown puro, las bases de datos son YAML puro (`.base`), y las [convenciones OKF](OKF.md) dan a cada archivo una estructura predecible. Cualquier cosa que pueda leer y escribir archivos — un script de shell, un programa Python, una herramienta CLI, una tarea programada o un agente de IA — puede ampliar, generar o reorganizar tu vault sin una sola API específica de Plainva.

Esta página explica cómo hacerlo de forma **segura**. El formato exacto a nivel de bytes de cada archivo está documentado por separado en la [Referencia del formato de archivo](File_Format_Reference.md); esta página es el complemento práctico: las reglas, el flujo de trabajo y qué entregarle a un asistente de IA.

## Por qué archivos en vez de un sandbox de plugins

- **Seguridad.** Un sistema de plugins de código ejecuta el programa de otra persona dentro de tu editor con acceso a tus notas. Los archivos planos no necesitan esa confianza: un script solo toca la carpeta a la que apuntas, con los permisos normales de tu sistema operativo.
- **Longevidad.** El formato sobrevive a la aplicación. Un archivo Markdown que generaste con un script hace cinco años se sigue abriendo hoy — en Plainva, en Obsidian, en cualquier editor de texto. No hay ninguna API de plugins que quede obsoleta.
- **El formato es el contrato.** Como el formato en disco es abierto y está documentado, la "API" es estable e inspeccionable. Puedes compararla con diff, versionarla en Git y razonar sobre ella.

Si quieres algo que Plainva no hace de fábrica, no esperas a un plugin — escribes un pequeño script contra los archivos.

## Leer un vault de forma segura

Todo es texto UTF-8:

- **Notas (`.md`)** — un bloque opcional de frontmatter YAML (entre dos líneas `---` justo al principio) contiene las propiedades; a continuación sigue el cuerpo Markdown. Analiza el frontmatter con cualquier biblioteca YAML.
- **Bases de datos (`.base`)** — YAML puro que describe vistas sobre notas. Los *valores* nunca están en la `.base`; viven en el frontmatter de las notas.
- **Estructura** — las etiquetas son `#tag` en el cuerpo o `tags:` en el frontmatter; los enlaces son `[[Note]]` (enlaces wiki) o `[text](path.md)`. Las tareas son elementos de lista `- [ ]` / `- [x]`.

Leer nunca requiere cuidado especial — los archivos de texto no se pueden "corromper" con solo leerlos. Las reglas de abajo son todas sobre *escribir*.

## Escribir en un vault de forma segura

Sigue estas reglas y Plainva (y Obsidian) aceptarán tus cambios sin problemas. Plainva vigila la carpeta del vault: una escritura externa se detecta y se reindexa automáticamente, normalmente en menos de un segundo.

1. **Escribe UTF-8 sin BOM, con finales de línea LF.** Las herramientas de Windows que usan UTF-16 o CRLF por defecto producen archivos que Plainva trata como modificados en cada sincronización.
2. **Escribe de forma atómica.** Escribe en un archivo temporal en la misma carpeta y luego renómbralo sobre el archivo de destino. Una nota escrita a medias (por ejemplo, tras un fallo) es peor que ningún cambio. El propio Plainva escribe cada nota así.
3. **Conserva el frontmatter OKF y las claves desconocidas.** Mantén `type` y `okf_version` al reescribir una nota, y nunca elimines claves de frontmatter que no reconozcas — arrástralas sin cambios. No "limpies" claves que no entiendas.
4. **Nunca toques `.plainva/`.** Esa carpeta contiene el índice local del dispositivo de Plainva, las copias de seguridad, los pines del grafo y el estado de sincronización. No forma parte de tu contenido y tus scripts nunca deben escribirla, sincronizarla ni subirla a Git.
5. **Respeta las reglas de `.base`.** Una `.base` usa solo las cuatro claves de nivel superior de Obsidian (`filters`, `formulas`, `properties`, `views`); cada vista necesita un `name`; los filtros tienen una única raíz. Todos los datos específicos de Plainva van bajo subclaves anidadas `plainva:`. La [Referencia del formato de archivo](File_Format_Reference.md#databases-base) tiene el contrato completo, incluido un ejemplo de relaciones en ambos sentidos.
6. **No pelees con el editor.** Si una nota está abierta *y* tiene cambios sin guardar en Plainva, mejor evita reescribirla desde un script en ese mismo momento. Plainva tiene un resolutor de conflictos como red de seguridad, pero el camino más limpio es dejar que la aplicación guarde primero (o editar notas que no están abiertas en ese momento).

## Patrones

Algunas tareas habituales, todas simples operaciones de archivo:

- **Crear notas en masa** — genera archivos `.md` con un bloque de frontmatter OKF (`type`, `okf_version`, más tus propias propiedades) y un cuerpo Markdown. Plainva las indexa a medida que aparecen.
- **Generadores de notas diarias o informes** — un script programado que escribe una nota fechada en tu carpeta de notas diarias, rellenada desde otra fuente.
- **Barridos de propiedades** — lee el frontmatter de cada nota, transforma un campo y vuelve a escribirlo (de forma atómica, conservando las claves desconocidas).
- **Exportar / publicar** — lee el vault y renderízalo a HTML, un sitio estático o un PDF. Solo lectura — sin reglas de las que preocuparse.
- **Mantenimiento de enlaces** — vuelve a escanear los enlaces `[[Note]]` y las `tags:` y genera un informe, o corrígelos in situ.

Mantén los scripts idempotentes cuando puedas: ejecutarlos dos veces no debería duplicar contenido.

## Entregar el vault a un asistente de IA

Un agente de IA con acceso de lectura/escritura a una carpeta de vault es exactamente el caso para el que está pensado este diseño. Para que funcione correctamente:

1. **Dale la [Referencia del formato de archivo](File_Format_Reference.md).** Está escrita para un lector automático: el contrato del frontmatter OKF, la serialización propiedad→YAML, el esquema completo de `.base` con sus reglas estrictas de Obsidian, el contrato de `index.md` y las reglas de seguridad — todo lo que un agente necesita para editar archivos sin romperlos.
2. **Apúntalo a la carpeta del vault, no a la carpeta `.plainva/`.** Deja claro que `.plainva/` está fuera de los límites.
3. **Pide ediciones atómicas y mínimas.** Un agente que reescribe una nota entera para cambiar una sola propiedad debería conservar el resto del frontmatter y el cuerpo tal cual.

Como el contrato es un documento, no una API en vivo, las mismas instrucciones funcionan con cualquier asistente, sin conexión o en línea.

## Resumen de seguridad

- UTF-8, sin BOM, LF.
- Escribe de forma atómica (archivo temporal + renombrar).
- Conserva `type`, `okf_version` y las claves desconocidas.
- Nunca escribas en `.plainva/`.
- `.base`: cuatro claves de nivel superior, vistas con nombre, filtros de raíz única, subclaves `plainva:` para todo lo demás.
- El vault está vigilado — los cambios externos aparecen en Plainva automáticamente.

## Ver también

- [Referencia del formato de archivo](File_Format_Reference.md) — el formato exacto en disco de cada archivo
- [OKF](OKF.md) — el Open Knowledge Format que da a los archivos su estructura predecible
- [Bases de datos (.base)](Databases_Base.md) — cómo funcionan las vistas `.base`
