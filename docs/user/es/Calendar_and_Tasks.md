# Calendario y tareas externas

Última actualización: 2026-07-18

Plainva puede conectar tus cuentas de calendario y tareas existentes — **CalDAV** (Nextcloud, Fastmail, mailbox.org …), **Google** (Calendario + Tareas) y **Microsoft** (Calendario de Outlook + To Do) — y trabajar con ellas en ambas direcciones. Tus notas siguen siendo el centro: los eventos pueden convertirse en notas de reunión, y las listas de tareas externas se reflejan en tu [base de datos de tareas predeterminada](Tasks.md) como notas normales.

## Conectar una cuenta

Abre **Ajustes → tu vault → Calendario y cuentas → Añadir cuenta…** y elige un proveedor:

- **CalDAV**: URL del servidor, nombre de usuario y una **contraseña de aplicación** (en Nextcloud: Ajustes → Seguridad → Dispositivos y sesiones). Sin registro, sin claves.
- **Google**: necesita tu propio ID de cliente OAuth (el mismo modelo BYO que la sincronización con Google Drive — ver la [guía de Drive](Google_Drive_BYO_Guide.md)). En tu proyecto de Google Cloud, activa además la *Google Calendar API* y la *Google Tasks API* y añade sus ámbitos a la pantalla de consentimiento. El navegador se abre para pedir consentimiento; al conectar se valida la cuenta antes de guardar nada.
- **Microsoft**: solo haz clic en **Conectar** y confirma en el navegador — no hace falta ninguna configuración.

Cada cuenta lista sus **Calendarios** (los marcados aparecen en la pestaña de calendario) y sus **Listas de tareas** (deliberadamente sin marcar por defecto — marcar una inicia la sincronización de tareas descrita más abajo). Las contraseñas y los tokens viven en el llavero de tu sistema operativo. El ajuste **Carpeta de reuniones** debajo de las cuentas elige dónde se crean las notas de reunión.

## La pestaña de calendario

Ábrela desde la barra de acciones de la izquierda (icono de calendario) o la paleta de comandos (**Abrir calendario**). Hay cinco vistas disponibles con el selector de la cabecera: **Día**, **3 días** y **Semana** muestran una **cuadrícula horaria** con una columna de horas a la izquierda; los eventos aparecen como bloques en su hora de inicio, su altura corresponde a la duración, los eventos superpuestos se colocan uno junto a otro, y una línea roja marca "ahora". Los eventos de todo el día y (con la superposición de tareas activada) las tareas con fecha límite aparecen en la franja situada encima de la cuadrícula. **Mes** muestra la cuadrícula mensual (un punto de color por calendario) más una cuadrícula horaria de un solo día para el día seleccionado, a la derecha. **Agenda** lista las próximas semanas agrupadas por día. **Hoy** vuelve al día actual; las flechas avanzan o retroceden según el período actual (un día, tres días, una semana o un mes). El primer día de la semana sigue el ajuste **Inicio de semana** (Configuración → App → Apariencia: Lunes, Sábado o Domingo) — también se aplica al calendario de la barra lateral. La vista se actualiza automáticamente cada pocos minutos; el botón de actualizar la fuerza.

- **Crear un evento**: **hacer clic en un espacio vacío de la cuadrícula horaria** abre una pequeña ventana emergente de creación rápida (título, hora, calendario, lugar) — **Guardar** lo crea al momento, **Más opciones** abre el diálogo completo del evento. **Arrastrar** por la cuadrícula fija la duración. El **+** en la cabecera abre el diálogo completo: título, calendario, fecha/hora o un rango de todo el día, lugar, descripción y, opcionalmente, una **Repetición** simple (diaria/semanal/mensual/anual).
- **Editar / eliminar**: **hacer clic en un evento** de la cuadrícula horaria abre el diálogo prerrellenado con sus valores y con las acciones **Nota de reunión** y **Eliminar**. Los cambios se escriben al proveedor con una comprobación de seguridad: si el evento cambió de forma remota mientras tanto, Plainva actualiza la vista en lugar de sobrescribir.
- **Mover / redimensionar**: puedes **arrastrar** un evento directamente en la cuadrícula horaria — arrastrar el cuerpo lo reprograma (también a otro día, en las vistas de semana y de 3 días), arrastrar su **borde inferior** cambia su duración. La nueva hora se escribe al proveedor de inmediato (por ahora, los eventos periódicos solo se pueden editar mediante el diálogo).
- Los **eventos periódicos** llevan una insignia de repetición. Editar o eliminar una instancia pregunta **"Solo este evento"** (crea una excepción o simplemente omite esa ocurrencia) o **"Todos los eventos"** (cambia toda la serie). Plainva nunca reescribe una regla de repetición existente.
- **Mostrar tareas** (junto al botón de actualizar, cuando hay una base de datos de tareas predeterminada configurada): superpone las entradas con fecha límite de tu [base de datos de tareas predeterminada](Tasks.md) sobre la franja de la cuadrícula horaria y la cuadrícula mensual; las tareas completadas aparecen tachadas. Desactivado por defecto, la elección se recuerda por dispositivo.

## Evento → nota de reunión

El icono de nota en cualquier evento crea (o vuelve a abrir) su **nota de reunión** — una nota normal en tu carpeta de reuniones llamada `AAAA-MM-DD Título.md`, prerrellenada con la fecha, el lugar y los asistentes, más una pequeña marca `plainva.pim` en el frontmatter que la vincula al evento. Hacer clic en el mismo evento otra vez siempre abre la misma nota; una nota tuya que casualmente comparta el nombre nunca se toca.

## Listas de tareas externas en tu base de datos de tareas

Marca una **Lista de tareas** en una cuenta conectada y sus tareas aparecen como notas en tu [base de datos de tareas predeterminada](Tasks.md): el título se convierte en la nota (H1), la fecha límite llega a la columna de fecha de la base de datos, y el estado completado se refleja en la **propiedad de casilla de hecho** de la base de datos (la columna de estado la sigue; una base de datos sin columna de casilla usa la convención de estado — la primera opción = abierta, la última = hecha). La sincronización es bidireccional y campo a campo:

- Edita la nota (título, fecha límite, estado) → el cambio se envía al proveedor.
- Cambia la tarea de forma remota → la nota lo sigue.
- Si ambos lados cambiaron, tu edición local gana para ese campo; el resto sigue al lado remoto.

Dos reglas de seguridad protegen tus datos: **eliminar la nota nunca elimina la tarea remota** (simplemente deja de sincronizarse y no se vuelve a importar), y **una tarea eliminada de forma remota nunca elimina tu nota** (simplemente se convierte en una nota normal). Renombrar o mover una nota de tarea no es ningún problema — la marca en el frontmatter mantiene el enlace.

Límites actuales: las tareas creadas como notas normales no se envían al proveedor (créalas de forma remota o mediante la base de datos de tareas), y todo lo de esta página es por ahora desktop-first.
