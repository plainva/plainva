# Diario

Última actualización: 2026-09-22

El diario es la forma rápida de anotar algo sin abrir una nota: un pensamiento, una llamada, una línea sobre el día. Cada entrada es una línea de lista normal con una hora — `- 14:05 El router está en el sótano` — bajo un encabezado de la **nota diaria de hoy**. No hay ningún formato de archivo nuevo ni una base de datos: las entradas viven en tus notas diarias, legibles en cualquier editor y compatibles con los plugins de diario de Obsidian (Thino, Knomo).

## Escribir una entrada

Un campo, un **Enter**. Plainva pone la hora; tú solo escribes el texto. Las etiquetas, los enlaces y una segunda línea se escriben sin más — el texto es Markdown normal.

- **En el escritorio:** `Ctrl+Shift+J` abre el campo **Entrada de diario** desde cualquier lugar de Plainva. El mismo campo está en el menú **＋** de la barra lateral, en la paleta de comandos y en el menú de la bandeja del sistema (**Entrada de diario**). `Enter` guarda, `Shift+Enter` empieza una nueva línea, `Esc` descarta.
- **En el teléfono:** el botón **＋** ofrece **Entrada de diario**; la pantalla del diario tiene su propio botón de lápiz. Un toque largo sobre el icono de la app también ofrece **Entrada de diario** — como acceso directo de la app en Android, como acción rápida en iOS. Ahí, `Enter` sigue siendo un salto de línea; **Guardar entrada** guarda.
- **Desde el panel para compartir (teléfono):** elige Plainva y marca **Al diario** — el texto y el enlace se convierten en la entrada, los archivos compartidos van a la carpeta de adjuntos y se incrustan.
- **Con una imagen:** el campo del teléfono tiene **Añadir foto**; en el escritorio pegas una imagen desde el portapapeles en el campo. La imagen va a donde van los adjuntos y se incrusta en la entrada.

Si la nota diaria de hoy todavía no existe, se crea sobre la marcha — a partir de tu plantilla de nota diaria, sin hacer sus preguntas. Después de guardar, un aviso dice **Entrada guardada** y ofrece **Deshacer**.

El campo hace una sola cosa: una entrada de diario. Debajo, **Crear una tarea en su lugar** pasa lo que escribiste a la [vista de tareas](Tasks.md), donde la tarea se crea como siempre, y cierra el campo. El chip **Como tarea** es otra cosa: deja la entrada en el diario y le da una casilla (`- [ ] 14:05 pedir el repuesto`), de modo que también aparece en la vista de tareas bajo **Desde notas**. La casilla del chip queda vacía hasta que lo eliges.

## La vista del diario

**Abrir diario** (barra de acciones en el escritorio, **Áreas** en el teléfono, o la paleta de comandos) muestra todos los días como un único flujo: el día más nuevo arriba, y dentro de un día, la entrada más nueva primero. Los enlaces se abren, las etiquetas son píldoras, una imagen incrustada aparece como vista previa, y una entrada larga queda plegada — **Más** la abre.

- **Buscar y filtrar:** el campo de búsqueda examina los días cargados; los chips **Todas**, **Solo tareas** y las etiquetas más frecuentes reducen el flujo. Un clic en una etiqueta de una entrada filtra por ella.
- **Días anteriores:** Plainva carga los últimos 14 días que tienen entradas. **Cargar anteriores** trae el siguiente tramo; **Ir a un día** abre el selector de fecha, en el que los días con entradas están marcados, y carga hacia atrás hasta el día que elijas.
- **Abrir nota** en el encabezado de un día abre esa nota diaria; un clic en una entrada abre la nota en esa línea.
- **Las casillas** de las entradas de tarea se pueden marcar directamente en el flujo. Se comportan como en la vista de tareas, incluida la fecha de finalización y la siguiente aparición de una tarea repetitiva.

Cada entrada tiene un menú (clic derecho o **⋯** en el escritorio; **⋯**, una pulsación larga o un deslizamiento en el teléfono): **Editar** cambia el texto en su sitio y conserva la hora, **Copiar** copia el texto, **Convertir en tarea** añade la casilla y **Volver a convertir en entrada** la quita, **Mostrar en la nota** salta a la línea, **Eliminar** quita la entrada — con **Deshacer** en el aviso que sigue.

Las entradas de un día concreto también aparecen donde miras ese día: como sección **Diario** en la barra lateral derecha del escritorio (para el día de la nota diaria abierta, si no, hoy) y en el móvil en la pantalla **Hoy** para el día elegido. En la barra lateral es una sección como cualquier otra: se pliega, lo recuerda, se puede ocultar y empieza cerrada. Sus filas ocupan una línea: allí no se maneja nada, todas empiezan en el mismo borde y una tarea lleva una marca discreta a la derecha en lugar de una casilla (márcala en el flujo o en la nota). El lápiz del encabezado abre el campo habitual **Entrada de diario** para ese mismo día, y **Todos los días** lleva al flujo.

## Cómo se guarda una entrada

```markdown
## Journal

- 09:12 Llamé al taller #cliente
- [ ] 10:30 Pedir el recambio
- 14:05 El router está en el sótano
  La llave la tiene la señora Berger.
```

- Las entradas se añaden al final de la sección, así que el archivo se lee de forma cronológica; la vista muestra la más nueva arriba.
- El encabezado es **Journal** de forma predeterminada y se puede cambiar por vault en **Configuración → Vault → Contenido y estructura** (**Encabezado del diario**; en el teléfono en **Ajustes → Contenido y estructura**). Su nivel no importa. Si falta el encabezado, Plainva añade `## Journal` al final de la nota. Cambiar el ajuste no renombra los encabezados existentes.
- **El día termina a las** (en el mismo lugar de los ajustes) mueve el borde del día más tarde: con **04:00**, todo lo que escribas entre medianoche y las cuatro sigue perteneciendo al día anterior — la entrada va a la nota diaria de ayer y conserva su hora real (`- 01:30 …`). El encabezado del día en el diario dice entonces **hasta las 04:00**. El límite se aplica a la nota diaria y al diario, **no** al calendario ni al vencimiento de las tareas: una cita a la 01:30 del miércoles sigue siendo del miércoles. El valor predeterminado es **Medianoche**; el ajuste pertenece a la bóveda y rige en todos los dispositivos.
- **Nota de voz**: el icono del micrófono en el campo de captura graba. Mientras corre ves el tiempo transcurrido y tienes dos salidas: **Descartar** tira la toma, **Adjuntar** la escribe en la carpeta de adjuntos y la añade a la entrada. El nombre del archivo lleva la fecha y la hora (`Nota de voz 2026-09-22 1430.m4a`). Plainva pide acceso al micrófono en el **primer** toque, nunca al iniciar, y no graba nada mientras no empieces tú; la grabación se queda en tu bóveda y no va a ninguna parte.
- Plainva también lee `- 14:05:30 Texto` (con segundos) y entradas con casilla, y continúa la lista tal como la escribe tu nota (`-`, `*` o `+`, con o sin líneas en blanco entre las entradas). Las líneas existentes nunca se reformatean.
- Un cambio que no se puede colocar de forma segura — por ejemplo porque un bloque de código de la sección nunca se cerró — se rechaza con un mensaje, y el campo conserva tu texto.

El formato exacto está en la [Referencia del formato de archivo](File_Format_Reference.md).

## Dos dispositivos al mismo tiempo

Si dos dispositivos añaden entradas a la misma nota diaria antes de haberse sincronizado, eso **no es un conflicto**: Plainva une las entradas por hora, y se conserva cada línea de ambos dispositivos. Esto también vale cuando ambos dispositivos crearon la nota del día de forma independiente. Cualquier otro cambio simultáneo en la nota se trata con el mismo cuidado que antes (ver [Compatibilidad de sincronización](Sync_Compatibility.md)).

## Captura rápida global (escritorio, opcional)

En **Configuración → Inicio y comportamiento → Captura rápida global** puedes activar **Capturar desde cualquier lugar con un atajo de todo el sistema**. El atajo — de forma predeterminada `Ctrl+Alt+J` (`Cmd+Option+J` en macOS) — abre entonces una pequeña ventana con el campo de entrada, incluso mientras otra aplicación está delante, siempre que Plainva esté en ejecución (también en la bandeja del sistema). `Enter` escribe la entrada en la nota diaria de hoy del vault que está abierto en Plainva y cierra la ventana; `Esc` descarta.

- **Cambiar** graba un atajo nuevo: pulsa la combinación que quieras, con `Ctrl`, `Alt` o la tecla Windows/Comando. **Restablecer el predeterminado** trae de vuelta el predeterminado.
- Si otra aplicación ya usa el atajo, o el sistema no lo acepta, Plainva lo indica bajo el interruptor en lugar de dejar un atajo que no hace nada.
- Bajo **Wayland** (Linux), el sistema no da a las aplicaciones ningún atajo de todo el sistema; Plainva lo indica y no registra nada. La entrada de la bandeja del sistema y `Ctrl+Shift+J` llevan al mismo campo.
- El atajo pertenece al dispositivo y no forma parte del perfil de configuración.
