# OKF — Open Knowledge Format

Última actualización: 2026-08-21

OKF (Open Knowledge Format) es una convención abierta para colecciones de conocimiento en Markdown: archivos Markdown puros con un pequeño encabezado frontmatter uniforme. Esta página explica qué es OKF, qué hace Plainva automáticamente por él — y por qué no *tienes* que usar nada de esto.

## ¿Qué es OKF?

La idea: cada documento del vault dice por sí mismo qué es. Basta con un encabezado mínimo en el frontmatter:

```markdown
---
type: Note
---
# Mi nota
```

- **`type`** — qué clase de documento es (p. ej. `Note`, `Daily Note`, `Project`). El único campo obligatorio de la convención.
- **`okf_version`** — la versión de la convención que sigue el vault. Vive **una sola vez**, en el `index.md` raíz (actualmente `"0.2"`), no en cada nota.
- **`index.md`** — cada carpeta puede contener un `index.md` como su índice de contenidos; los nombres `index.md` y `log.md` están reservados para esto y no deberían usarse para notas normales.

> ¿Escribes archivos con una herramienta o un script? El contrato exacto de campos — valores permitidos, cómo se serializa cada tipo de propiedad y las reglas de nombres reservados — está en la [Referencia del formato de archivo](File_Format_Reference.md).

**De dónde viene OKF:** OKF es una especificación abierta de Google Cloud ([`GoogleCloudPlatform/knowledge-catalog`](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md), licencia Apache-2.0). Plainva sigue **OKF 0.2** (publicada el 25 de julio de 2026). Lo nuevo en 0.2 son cinco campos opcionales con los que una nota dice de dónde viene, si alguien la ha revisado y si sigue siendo válida — `generated`, `verified`, `sources`, `stale_after` y `status`. Lo que Plainva muestra y escribe de ellos se describe más abajo, en «Procedencia, revisión y ciclo de vida».

## ¿Por qué usa Plainva OKF?

El Markdown puro es maravillosamente portátil — pero por sí solo no tiene una estructura fiable. OKF añade justo la necesaria, y todo sigue siendo Markdown normal con frontmatter estándar:

- **Las bases de datos, los filtros y las plantillas pueden confiar en la estructura.** Cada nota lleva un `type`, así que las vistas de `.base` sobre archivos planos siguen siendo robustas.
- **Las carpetas siguen siendo navegables.** Un `index.md` como índice de contenidos por carpeta funciona tanto para personas como para herramientas.
- **Los scripts y los asistentes de IA pueden trabajar con tu vault de forma segura**, porque el formato en disco es uniforme y está documentado.
- **Sin lock-in.** OKF es una convención abierta sobre Markdown puro — otras herramientas OKF entienden tus archivos, hoy y dentro de diez años.

## Qué hace Plainva automáticamente

**Los archivos nuevos** reciben el encabezado OKF automáticamente: cada nota creada en Plainva recibe `type` en su frontmatter — desde OKF 0.2 la marca de versión `okf_version` vive una sola vez en el `index.md` raíz, ya no en cada nota. Configuras los valores por vault: **Configuración → Vault → Contenido y estructura → OKF (Open Knowledge Format)** → **type para notas nuevas** (por defecto `Note`) y **type para notas diarias** (por defecto `Daily Note`). Si una plantilla trae su propio `type`, gana la plantilla.

**Los archivos existentes nunca se cambian sin preguntar.** Plainva solo añade campos OKF al crear archivos nuevos o cuando inicias explícitamente la conversión.

**Campos de sistema protegidos:** En el panel de **Propiedades**, `type` y — cuando una nota antigua todavía lo lleva — `okf_version` están marcados como campos de sistema OKF ("Campo de sistema OKF: lo gestiona Plainva"): el valor de `type` se puede elegir en un desplegable de tipos conocidos, `okf_version` es solo de visualización; renombrar, cambiar el tipo y eliminar están bloqueados para que la convención no pueda romperse por accidente.

**El explicador:** **¿Qué es OKF?** en la configuración te da la versión corta en tres frases y un enlace a esta página. Ya no se abre solo; si un vault contiene archivos que no cumplen el formato OKF, Plainva lo indica una vez en un pequeño mensaje con un botón que te lleva directo a la conversión.

## Procedencia, revisión y ciclo de vida (OKF 0.2)

Desde OKF 0.2 una nota puede decir de dónde viene, quién la ha revisado y si sigue siendo válida. Plainva convierte eso en tres cosas:

**Lo que Plainva muestra.**

- Una nota con `status: draft` o `status: deprecated` lleva una insignia en la cabecera del documento — **Borrador** u **Obsoleta**. `stable` se mantiene silenciosa; una columna `status` propia con otros valores (por ejemplo `Abierta` en una base de datos de tareas) no es un estado de ciclo de vida y no recibe insignia.
- Una vez que `stale_after` ha pasado, el aviso **Marcada como caducada (desde …)** aparece encima de la nota con un enlace a las propiedades. El aviso es solo de visualización — Plainva no cambia nada en la nota.
- La sección **Confianza y procedencia** del panel de propiedades (en el teléfono: en la hoja de contexto de la nota) resume los campos y deriva de ellos un nivel de confianza: **Sin verificar**, **Confirmada por la máquina** o **Revisada por una persona** — además de quién la generó, la lista de verificaciones, las fuentes como enlaces en los que se puede hacer clic, el estado y la fecha de caducidad.

**Lo que Plainva escribe.**

- `generated` (y, cuando se conoce una fuente, `sources`) lo establecen exactamente tres caminos de escritura automática: el **importador** (`plainva-import/<versión>`, un instante por ejecución — el informe de importación también lo lleva), la **captura de correo** (`plainva-mail-capture/<versión>`, con el Message-ID del mensaje como fuente) y la **sincronización de tareas** (`plainva-task-sync/<versión>`, solo cuando crea una nota).
- `verified` solo lo escribe **Marcar como revisada** en la sección **Confianza y procedencia**: Plainva añade `human:<tu nombre>` con el instante actual al final de la lista — una segunda revisión nunca sobrescribe la primera. Tu nombre se pide una vez por vault; se queda en este dispositivo y se puede cambiar en **Configuración → Vault → Contenido y estructura → Nombre del revisor**.
- El editor nunca toca estos campos por su cuenta, y las notas existentes nunca se sellan a posteriori. `status` y `stale_after` los defines tú, como propiedad o en el frontmatter.

**Actualizar la versión del bundle.** La versión de la convención vive una sola vez en el `index.md` raíz. Un vault que todavía declara `"0.1"` sigue funcionando sin cambios — en **Configuración → Vault → Contenido y estructura → Versión del bundle** (en el teléfono: **Ajustes → Vault → Mantenimiento → Versión del bundle**) la elevas a 0.2 con **Actualizar…**. El diálogo muestra de antemano qué va a cambiar: la línea del `index.md` raíz y, como casilla (activada por defecto), eliminar el campo heredado `okf_version` de las notas que todavía lo llevan. Cada archivo se respalda antes de cambiarlo; **Limpiar…** hace solo la segunda parte. La tabla de campos y las reglas de escritura en detalle están en la [Referencia del formato de archivo](File_Format_Reference.md).

## index.md: el índice de contenidos por carpeta

Un `index.md` es el índice de contenidos de una carpeta: una lista de las notas y subcarpetas que contiene, con descripciones y enlaces relativos.

- **Generarlo** — siempre por tu acción, nunca de la nada: clic derecho en una carpeta → **Generar/actualizar index.md**, o en bloque mediante el **gestor de index.md** (**Configuración → Vault → Contenido y estructura**).
- **Adoptar en lugar de generar** — si ya tienes notas de resumen (MOC, Overview, folder note, README …), el gestor las sugiere como candidatas. **Adoptar** renombra el archivo a `index.md` (los enlaces se actualizan en todo el vault) y opcionalmente puede prepararlo para OKF.
- **Mantenimiento automático** — los listados *generados* por Plainva llevan una marca invisible al final del archivo (un comentario HTML). Solo esos archivos marcados se mantienen actualizados automáticamente cada vez que cambia la carpeta — y solo en vaults OKF (reconocibles por `okf_version` en el `index.md` de la raíz).
- **Solo lectura con salida** — los archivos index.md gestionados se abren en modo lectura con el banner "Este index.md lo gestiona Plainva y se actualiza automáticamente." Ahí puedes **Actualizar** — o elegir **Editar de todos modos**: eso quita la marca y el archivo vuelve a ser completamente tuyo (ya no hay actualizaciones automáticas).
- **Todo a la vez** — **Actualizar todos los archivos index.md** está disponible en el menú contextual de la raíz del vault y en la configuración; los archivos sin la marca se omiten.
- **Rellenar los huecos** — dentro del gestor de index.md, el botón **Generar index.md en las carpetas que no lo tienen** preselecciona todas las carpetas que todavía no tienen una, para que puedas crearlas todas de una vez.
- **En el teléfono** — lo mismo, por dos puertas: mantener pulsada una carpeta ofrece **Crear resumen** o **Actualizar resumen**, según lo que esa carpeta necesite. Para la pasada ocasional sobre todo el almacén está **Configuración → Vault → Mantenimiento → Resúmenes**: las carpetas sin resumen aparecen primero, y **Generar index.md en las N carpetas que no lo tienen** los crea de una vez. Una carpeta cuyo `index.md` escribiste tú aparece en la lista y se deja en paz: adoptar es una decisión con nombre en esa lista, nunca el efecto secundario de un toque. El mantenimiento automático también funciona ya en el teléfono: un almacén editado allí deja de quedarse anticuado hasta que lo abra un escritorio.
- En modo lectura, los listados gestionados se muestran como tarjetas con iconos de archivo/carpeta; los enlaces se abren directamente dentro de Plainva.

## Convertir un vault existente (opcional)

Si hay archivos en el vault que no cumplen el formato OKF (falta el campo `type`, o se usan nombres reservados como notas normales), Plainva ofrece la conversión — una vez al abrir el vault, y de forma permanente en **Configuración → Vault → Contenido y estructura** (la entrada solo aparece mientras haya algo que hacer).

El asistente **Convertir al formato OKF** funciona en pasos claros:

1. **Análisis** — muestra cuántos archivos están afectados (las carpetas de plantillas y de sistema quedan excluidas; los archivos con frontmatter ilegible se omiten, nunca se "reparan").
2. **Decisiones** — un `type` predeterminado para los archivos que no tienen uno; los valores de `type` existentes se pueden **conservar** (recomendado — ya son tipos OKF válidos) o renombrar a otro campo.
3. **Vista previa (sin cambios)** — un ensayo en seco muestra de antemano qué cambiaría.
4. **Convertir** — cada archivo se respalda en `.plainva/backups/` antes de cambiarlo; un informe resume qué cambió, qué se omitió y la carpeta de la copia de seguridad. Después puedes opcionalmente **continuar con el gestor de index.md**.

Un consejo del asistente: los cambios pasan por la sincronización como de costumbre — en vaults con git, haz commit primero.

### En el teléfono

El mismo camino existe en el móvil: **Ajustes → Vault → Mantenimiento → Convertir al formato OKF**. Los pasos son los mismos — análisis, decisiones, vista previa, conversión — y la vista previa nombra las notas afectadas antes de que se escriba nada.

Se añaden dos cosas, porque un teléfono puede sacar una app de la memoria en cualquier momento:

- **Pausar y continuar.** La ejecución se detiene en el siguiente archivo cuando tocas **Pausa** o la app pasa a segundo plano. Al continuar se escribe en la misma carpeta de copia de seguridad: no aparece una segunda.
- **Se pregunta al inicio.** Si una ejecución queda sin terminar, Plainva lo dice la próxima vez que abres el vault y ofrece **Continuar** o **Revertir**; **Más tarde** es una respuesta válida. Una ejecución interrumpida deja un vault convertido en parte, no roto: solo se añaden campos de frontmatter y cada nota sigue siendo Markdown válido.

**Revertir** restaura los archivos desde la carpeta de copia de seguridad — también en el escritorio, desde el informe al final de la ejecución. La carpeta de copia se queda después; es la única copia del estado anterior a la conversión.

## ¿Tengo que usar OKF?

No. OKF es un estándar suave:

- Los archivos nuevos reciben el encabezado automáticamente — nunca estorba y no cuesta nada.
- Los vaults existentes (p. ej. de Obsidian) siguen funcionando sin cambios; la conversión es estrictamente opcional.
- Que falte `okf_version` — o que una nota antigua todavía lo lleve — no cuenta como una infracción; puedes usar Plainva y Obsidian en paralelo de forma permanente, sin avisos molestos.
- Obsidian y cualquier otro editor pueden seguir abriendo todos los archivos: es y sigue siendo Markdown puro.

## Ver también

- [Referencia del formato de archivo](File_Format_Reference.md) — el contrato exacto en disco de cada archivo del vault
- [Notas y Markdown](Notes_and_Markdown.md) — frontmatter y propiedades
- [Bases de datos (.base)](Databases_Base.md) — qué aporta en la práctica un `type` uniforme
- [FAQ y solución de problemas](FAQ.md) — copias de seguridad e index.md de solo lectura, entre otros
