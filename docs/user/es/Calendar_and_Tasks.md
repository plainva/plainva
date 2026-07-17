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

Ábrela desde la barra de acciones de la izquierda (icono de calendario) o la paleta de comandos (**Abrir calendario**). Obtienes una cuadrícula mensual con tus eventos (un punto de color por calendario) y un panel del día que lista el día seleccionado — primero los eventos de todo el día, luego los que tienen hora, con hora, nombre del calendario y lugar. La vista se actualiza automáticamente cada pocos minutos; el botón de actualizar la fuerza.

- **Nuevo evento**: el **+** en el panel del día — título, calendario, fecha/hora o un rango de todo el día, lugar y, opcionalmente, una **Repetición** simple (diaria/semanal/mensual/anual).
- **Editar / eliminar**: los iconos de lápiz y papelera en un evento. Los cambios se escriben al proveedor con una comprobación de seguridad: si el evento cambió de forma remota mientras tanto, Plainva actualiza la vista en lugar de sobrescribir.
- Los **eventos periódicos** llevan una insignia de repetición. Editar o eliminar una instancia pregunta **"Solo este evento"** (crea una excepción o simplemente omite esa ocurrencia) o **"Todos los eventos"** (cambia toda la serie). Plainva nunca reescribe una regla de repetición existente.
- **Mostrar tareas** (junto al botón de actualizar, cuando hay una base de datos de tareas predeterminada configurada): superpone las entradas con fecha límite de tu [base de datos de tareas predeterminada](Tasks.md) sobre la cuadrícula mensual y el panel del día; las tareas completadas aparecen tachadas. Desactivado por defecto, la elección se recuerda por dispositivo.

## Evento → nota de reunión

El icono de nota en cualquier evento crea (o vuelve a abrir) su **nota de reunión** — una nota normal en tu carpeta de reuniones llamada `AAAA-MM-DD Título.md`, prerrellenada con la fecha, el lugar y los asistentes, más una pequeña marca `plainva.pim` en el frontmatter que la vincula al evento. Hacer clic en el mismo evento otra vez siempre abre la misma nota; una nota tuya que casualmente comparta el nombre nunca se toca.

## Listas de tareas externas en tu base de datos de tareas

Marca una **Lista de tareas** en una cuenta conectada y sus tareas aparecen como notas en tu [base de datos de tareas predeterminada](Tasks.md): el título se convierte en la nota (H1), la fecha límite llega a la columna de fecha de la base de datos, y "completado" se refleja en la columna de estado (primera opción = abierta, última opción = hecha). La sincronización es bidireccional y campo a campo:

- Edita la nota (título, fecha límite, estado) → el cambio se envía al proveedor.
- Cambia la tarea de forma remota → la nota lo sigue.
- Si ambos lados cambiaron, tu edición local gana para ese campo; el resto sigue al lado remoto.

Dos reglas de seguridad protegen tus datos: **eliminar la nota nunca elimina la tarea remota** (simplemente deja de sincronizarse y no se vuelve a importar), y **una tarea eliminada de forma remota nunca elimina tu nota** (simplemente se convierte en una nota normal). Renombrar o mover una nota de tarea no es ningún problema — la marca en el frontmatter mantiene el enlace.

Límites actuales: las tareas creadas como notas normales no se envían al proveedor (créalas de forma remota o mediante la base de datos de tareas), y todo lo de esta página es por ahora desktop-first.
