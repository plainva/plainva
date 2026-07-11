# OKF — Open Knowledge Format

Stand: 2026-07-11

OKF (Open Knowledge Format) es una convención abierta para colecciones de conocimiento en Markdown: archivos Markdown puros con un pequeño encabezado frontmatter uniforme. Esta página explica qué es OKF, qué hace Plainva automáticamente por él — y por qué no *tienes* que usar nada de esto.

## ¿Qué es OKF?

La idea: cada documento del vault dice por sí mismo qué es. Basta con un encabezado mínimo en el frontmatter:

```markdown
---
type: Note
okf_version: "0.1"
---
# Mi nota
```

- **`type`** — qué clase de documento es (p. ej. `Note`, `Daily Note`, `Project`). El único campo obligatorio de la convención.
- **`okf_version`** — la versión de la convención con la que se escribió el archivo.
- **`index.md`** — cada carpeta puede contener un `index.md` como su índice de contenidos; los nombres `index.md` y `log.md` están reservados para esto y no deberían usarse para notas normales.

> ¿Escribes archivos con una herramienta o un script? El contrato exacto de campos — valores permitidos, cómo se serializa cada tipo de propiedad y las reglas de nombres reservados — está en la [Referencia del formato de archivo](File_Format_Reference.md).

## ¿Por qué usa Plainva OKF?

El Markdown puro es maravillosamente portátil — pero por sí solo no tiene una estructura fiable. OKF añade justo la necesaria, y todo sigue siendo Markdown normal con frontmatter estándar:

- **Las bases de datos, los filtros y las plantillas pueden confiar en la estructura.** Cada nota lleva un `type`, así que las vistas de `.base` sobre archivos planos siguen siendo robustas.
- **Las carpetas siguen siendo navegables.** Un `index.md` como índice de contenidos por carpeta funciona tanto para personas como para herramientas.
- **Los scripts y los asistentes de IA pueden trabajar con tu vault de forma segura**, porque el formato en disco es uniforme y está documentado.
- **Sin lock-in.** OKF es una convención abierta sobre Markdown puro — otras herramientas OKF entienden tus archivos, hoy y dentro de diez años.

## Qué hace Plainva automáticamente

**Los archivos nuevos** reciben el encabezado OKF automáticamente: cada nota creada en Plainva recibe `type` y `okf_version` en su frontmatter. Configuras los valores por vault: **Configuración → Vault → Contenido y estructura → OKF (Open Knowledge Format)** → **type para notas nuevas** (por defecto `Note`) y **type para notas diarias** (por defecto `Daily Note`). Si una plantilla trae su propio `type`, gana la plantilla.

**Los archivos existentes nunca se cambian sin preguntar.** Plainva solo añade campos OKF al crear archivos nuevos o cuando inicias explícitamente la conversión.

**Campos de sistema protegidos:** En el panel de **Propiedades**, `type` y `okf_version` están marcados como campos de sistema OKF ("Campo de sistema OKF: lo gestiona Plainva"): el valor de `type` se puede elegir en un desplegable de tipos conocidos, `okf_version` es solo de visualización; renombrar, cambiar el tipo y eliminar están bloqueados para que la convención no pueda romperse por accidente.

**El explicador:** Al abrir un vault por primera vez, Plainva muestra una vez **¿Qué es OKF?** — el mismo resumen siempre está disponible en la configuración.

## index.md: el índice de contenidos por carpeta

Un `index.md` es el índice de contenidos de una carpeta: una lista de las notas y subcarpetas que contiene, con descripciones y enlaces relativos.

- **Generarlo** — siempre por tu acción, nunca de la nada: clic derecho en una carpeta → **Generar/actualizar index.md**, o en bloque mediante el **gestor de index.md** (**Configuración → Vault → Contenido y estructura**).
- **Adoptar en lugar de generar** — si ya tienes notas de resumen (MOC, Overview, folder note, README …), el gestor las sugiere como candidatas. **Adoptar** renombra el archivo a `index.md` (los enlaces se actualizan en todo el vault) y opcionalmente puede prepararlo para OKF.
- **Mantenimiento automático** — los listados *generados* por Plainva llevan una marca invisible al final del archivo (un comentario HTML). Solo esos archivos marcados se mantienen actualizados automáticamente cada vez que cambia la carpeta — y solo en vaults OKF (reconocibles por `okf_version` en el `index.md` de la raíz).
- **Solo lectura con salida** — los archivos index.md gestionados se abren en modo lectura con el banner "Este index.md lo gestiona Plainva y se actualiza automáticamente." Ahí puedes **Actualizar** — o elegir **Editar de todos modos**: eso quita la marca y el archivo vuelve a ser completamente tuyo (ya no hay actualizaciones automáticas).
- **Todo a la vez** — **Actualizar todos los archivos index.md** está disponible en el menú contextual de la raíz del vault y en la configuración; los archivos sin la marca se omiten.
- **Rellenar los huecos** — dentro del gestor de index.md, el botón **Generar index.md en las carpetas que no lo tienen** preselecciona todas las carpetas que todavía no tienen una, para que puedas crearlas todas de una vez.
- En modo lectura, los listados gestionados se muestran como tarjetas con iconos de archivo/carpeta; los enlaces se abren directamente dentro de Plainva.

## Convertir un vault existente (opcional)

Si hay archivos en el vault que no cumplen el formato OKF (falta el campo `type`, o se usan nombres reservados como notas normales), Plainva ofrece la conversión — una vez al abrir el vault, y de forma permanente en **Configuración → Vault → Contenido y estructura** (la entrada solo aparece mientras haya algo que hacer).

El asistente **Convertir al formato OKF** funciona en pasos claros:

1. **Análisis** — muestra cuántos archivos están afectados (las carpetas de plantillas y de sistema quedan excluidas; los archivos con frontmatter ilegible se omiten, nunca se "reparan").
2. **Decisiones** — un `type` predeterminado para los archivos que no tienen uno; los valores de `type` existentes se pueden **conservar** (recomendado — ya son tipos OKF válidos) o renombrar a otro campo.
3. **Vista previa (sin cambios)** — un ensayo en seco muestra de antemano qué cambiaría.
4. **Convertir** — cada archivo se respalda en `.plainva/backups/` antes de cambiarlo; un informe resume qué cambió, qué se omitió y la carpeta de la copia de seguridad. Después puedes opcionalmente **continuar con el gestor de index.md**.

Un consejo del asistente: los cambios pasan por la sincronización como de costumbre — en vaults con git, haz commit primero.

## ¿Tengo que usar OKF?

No. OKF es un estándar suave:

- Los archivos nuevos reciben el encabezado automáticamente — nunca estorba y no cuesta nada.
- Los vaults existentes (p. ej. de Obsidian) siguen funcionando sin cambios; la conversión es estrictamente opcional.
- Que falte `okf_version` por sí solo no cuenta como una infracción — puedes usar Plainva y Obsidian en paralelo de forma permanente, sin avisos molestos.
- Obsidian y cualquier otro editor pueden seguir abriendo todos los archivos: es y sigue siendo Markdown puro.

## Ver también

- [Referencia del formato de archivo](File_Format_Reference.md) — el contrato exacto en disco de cada archivo del vault
- [Notas y Markdown](Notes_and_Markdown.md) — frontmatter y propiedades
- [Bases de datos (.base)](Databases_Base.md) — qué aporta en la práctica un `type` uniforme
- [FAQ y solución de problemas](FAQ.md) — copias de seguridad e index.md de solo lectura, entre otros
