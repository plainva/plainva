# Captura de correo

Última actualización: 2026-08-09

Plainva puede leer tu buzón para sacar conocimiento del correo y llevarlo a tu vault, y — desde la 0.4.0 — también redactar y enviar correo. El foco sigue en la **captura** de mensajes como notas; un buzón conectado por **IMAP** solo se lee para la captura (nada en él cambia, ni siquiera las marcas de no leído) mientras no configures el envío.

> **Experimental.** El cliente de correo se comunica con cuentas externas reales (IMAP/SMTP y Microsoft) que no se pueden ejercitar en las pruebas automatizadas de Plainva. Funciona y se usa a diario, pero trátalo como una vista previa: conserva una copia de seguridad y, por favor, informa de cualquier cosa que parezca rara.

## Conectar un buzón

**Ajustes → tu vault → Cuentas en la nube → Conectar cuenta…** y elige el proveedor:

- **Microsoft** — para Outlook.com y Microsoft 365: marca **Correo** en el paso de servicios (si quieres, junto con **Archivos** y **Calendario y tareas** — una cuenta, un inicio de sesión) e inicia sesión directamente en el navegador, sin contraseña de aplicación ni IMAP. Plainva usa el registro de aplicación central de Plainva (opcionalmente puedes indicar tu propio ID de aplicación en los detalles de la cuenta). Leer, capturar y **enviar directamente** pasan todos por el inicio de sesión de Microsoft.
- **Apple iCloud**, **Yahoo**, **AOL**, **Zoho**, **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru** — fichas dedicadas: dirección de correo más una **contraseña de aplicación**, los servidores ya están rellenados (la mayoría de estas fichas también permiten marcar **Calendario y tareas** en el mismo paso — una contraseña de aplicación para todos los servicios elegidos). El asistente enlaza en cada caso la guía oficial del proveedor para crear la contraseña de aplicación.
- **Servidor de correo (IMAP)** — para cualquier otro proveedor: host, puerto y una contraseña o **contraseña de aplicación**. Hay ajustes preconfigurados listos para proveedores de todo el mundo — desde **web.de**/**GMX** y **T-Online**, pasando por **Orange**, **Libero**, **WP**, **Seznam** y **Comcast**, hasta **QQ Mail**, **NetEase**, **Naver** y **Yahoo! JAPAN**; la lista **Proveedor** tiene para ello una línea de búsqueda, y al escribir tu dirección se elige automáticamente el ajuste correspondiente. Cuando un proveedor tiene particularidades, el asistente lo indica justo debajo del formulario: algunos exigen una **contraseña de aplicación** o un **código de autorización** en lugar de la contraseña de la cuenta, otros requieren activar antes IMAP en la configuración del proveedor — cada uno con un enlace a la guía oficial. Para Gmail eso es `imap.gmail.com`, puerto `993`, con una contraseña de aplicación de [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (requiere autenticación de dos factores) — sin OAuth, sin verificación; el asistente lo indica por sí mismo para las direcciones de Gmail. **Los buzones de Outlook.com** ya no pueden conectarse por IMAP con contraseña (Microsoft desactivó esa vía) — el ajuste preconfigurado apunta a la ficha **Microsoft**. **Proton Mail** solo funciona a través del Proton Mail Bridge local de pago (tiene su propio ajuste preconfigurado). Añade un host SMTP para enviar directamente.

Al conectar se valida el inicio de sesión antes de guardar nada; las credenciales van al llavero de tu sistema operativo. Los buzones conectados y los ajustes de captura viven después en la zona **Correo**: el ajuste **Carpeta de correo** elige dónde se guardan los correos capturados (por defecto `Mail`).

## Leer correo

Abre la pestaña de correo desde la barra de acciones de la izquierda (icono de correo) o la paleta de comandos (**Abrir correo**). La lista muestra tu bandeja de entrada empezando por lo más reciente (los no leídos en negrita; **Cargar más** carga páginas adicionales). Seleccionar un mensaje lo abre en un **visor aislado**:

- **Se bloquea el contenido remoto** — los píxeles de rastreo, las imágenes remotas y los cargadores de estilos se eliminan y se cuentan ("Contenido remoto bloqueado (n)"). Solo se muestran las imágenes insertadas autocontenidas. **Mostrar imágenes**, junto al contador, revela una vez las imágenes https de un mensaje; **Cargar siempre las imágenes remotas** en los ajustes de correo lo convierte en una opción permanente. Ten en cuenta: cargar imágenes remotas permite que el remitente vea tu dirección IP y cuándo abriste el correo — por eso el bloqueo es la opción predeterminada.
- **Leído significa leído** — un mensaje que abres cuenta como leído a los tres segundos. Si lo marcas **no leído a mano**, permanece no leído mientras esté abierto; la cuenta atrás solo se reinicia cuando lo cierras y vuelves a abrirlo. Igual en ambos dispositivos — antes, el temporizador de escritorio deshacía la marca tres segundos después, y el teléfono marcaba un mensaje como leído nada más abrirlo.
- Los enlaces se muestran como texto sin formato y no son clicables dentro del visor.
- Los scripts y los formularios nunca se ejecutan. El mensaje se renderiza en un marco aislado con una política de contenido estricta.
- **Conversaciones** — el interruptor sobre la lista (icono de bocadillo) agrupa los mensajes relacionados en una sola fila: participantes, cantidad y el asunto con el que empezó el intercambio. Al tocarla se despliega; cada mensaje conserva su carpeta y la indica cuando no es la abierta. Para ello Plainva lee también **Enviados**, de modo que tus propias respuestas formen parte de la conversación. Desactivado, todo queda como antes —una lista plana— y la elección se recuerda por bóveda, en ambos dispositivos. La agrupación sigue la cadena de respuestas de los mensajes (en Microsoft, la conversación que mantiene el propio proveedor); solo si una respuesta no lleva esa cadena entra en juego el asunto, y entonces solo con una respuesta reconocible («Re:», «RV:») y dentro de 30 días, para que dos mensajes que solo comparten el asunto no se fundan.
- **Todas las bandejas de entrada** — la primera entrada encima de la lista de carpetas muestra las bandejas de entrada de **todas** las cuentas en una sola lista, las más recientes primero, y cada fila indica la cuenta a la que pertenece. Leído/no leído y el marcado también funcionan aquí; mover y eliminar siguen siendo propios de cada buzón, porque cada cuenta tiene su propia carpeta de destino: abre el mensaje y actuarás en su buzón. Una cuenta cuyo inicio de sesión falta se nombra y no vacía la lista de las demás.
- **Seleccionar varios** — Ctrl+clic (macOS: ⌘+clic) selecciona mensajes sueltos, Mayús+clic un rango; en la vista de conversaciones, un Ctrl+clic sobre la conversación selecciona todo el intercambio, y cada mensaje conserva su propia carpeta.

Los adjuntos se listan con nombre y tamaño; el `.eml` original (más abajo) los incluye completos.

Cuando abres una carpeta que ya habías abierto, la lista aparece **de inmediato** desde la caché local mientras la actualización corre en segundo plano; hasta que llega, un aviso dice «actualizando»: solo lo que envió el servidor cuenta como confirmado. Lo mismo vale para un mensaje que ya has leído. En el teléfono, el mensaje **más reciente** de una carpeta se precarga en segundo plano: luego se abre sin espera, incluso si nunca lo habías abierto.

En el escritorio, las tres columnas (carpetas · lista · lector) se pueden arrastrar por sus separadores; los anchos se recuerdan **por bóveda** y sobreviven a un reinicio. Cada columna mantiene un ancho mínimo, así el lector nunca queda desplazado.

Cuando una actualización falla — sin red, o el proveedor está limitando las peticiones —, la lista sigue mostrando la última copia vista en este dispositivo, con un aviso que lo indica, en lugar de un panel vacío. Un mensaje que ya has leído sigue siendo legible del mismo modo. Esto es solo una caché: el servidor siempre manda, nada de esto es la única copia de nada, y al eliminar el vault desaparece con él.

## Llevar un mensaje al vault

Tres botones en cada mensaje:

- **Guardar como nota** — crea una nota en tu carpeta de correo (`AAAA-MM-DD Asunto.md`) con el remitente y la fecha en el frontmatter y el cuerpo en texto sin formato debajo del encabezado del asunto. Capturar el mismo mensaje dos veces abre la nota existente en lugar de duplicarla.
- **+ .eml** — además guarda el original en bruto junto a la nota y lo enlaza. El `.eml` contiene todo, incluidos los adjuntos, y se abre en cualquier programa de correo.
- **→ Tarea** — crea una entrada en tu [base de datos de tareas predeterminada](Tasks.md) con el asunto como título, la fecha de hoy como fecha límite y el estado abierto prerrellenado.

## Redactar y enviar

En cuanto una cuenta puede enviar — una cuenta de **Microsoft**, o una cuenta **IMAP** con un **host SMTP** configurado —, puedes escribir y enviar correo desde Plainva:

- **Redactar** (en la pestaña de correo) abre una ventana flotante con filas etiquetadas **De / Para / Cc / Cco**. Escribe una dirección y pulsa Intro o coma para convertirla en un chip; **Cc/Cco** se despliegan bajo demanda. El cuerpo es un editor de Markdown con una barra de herramientas de formato y un menú de comandos "/". Un enlace `[texto](https://…)` se muestra como un enlace terminado mientras escribes — los caracteres de Markdown vuelven a aparecer en cuanto el cursor entra en él, y un clic abre el destino en tu navegador. Al enviar, el cuerpo se convierte a HTML de todas formas: el destinatario siempre recibe un enlace real, sea cual sea su aspecto en la ventana.
- **Responder**, **Responder a todos** y **Reenviar** en cualquier mensaje abren la misma ventana con el original citado y los destinatarios prerrellenados; un reenvío lleva consigo los adjuntos.
- **Enviar** sale por SMTP (cuentas IMAP) o Microsoft Graph (cuentas de Microsoft).
- **Esta nota por correo** (menú `⋮` de una nota, o la paleta de comandos) inicia un mensaje con la nota actual adjunta, o incrustada como texto.

## Entregar una nota sin el cliente de correo

No tienes que enviar desde dentro de Plainva. Esto funciona con cualquier nota y no necesita SMTP:

- **Responder como nota** (en un mensaje): crea una nota dirigida al remitente (`to:` en el frontmatter) con el original citado — escribe tu respuesta en Plainva.
- **Guardar la nota como borrador en el buzón** (paleta de comandos, en cualquier nota abierta): guarda la nota como un **borrador en tu propio buzón** por IMAP — elige la cuenta, el destinatario y la carpeta de borradores, luego abre tu programa de correo habitual, revisa y envía desde ahí. El formato se conserva.
- **Enviar la nota por correo (mailto)** (paleta de comandos): abre tu programa de correo predeterminado con la nota como texto sin formato (las notas largas se acortan).
- **Copiar la nota como texto de correo** (paleta de comandos): pone la nota en el portapapeles con formato — pégala en cualquier editor de correo.

## Firma y direcciones de remitente

En **Ajustes → Correo → Envío**, cada buzón tiene dos ajustes propios:

- **Firma** — en Markdown, se añade debajo de tu texto al redactar (y encima de un original citado o reenviado, donde el lector la espera). Si cambias de remitente en la ventana de redacción, la firma se sustituye en lugar de acumularse una segunda. El campo usa el mismo editor que la ventana de redacción, así que ves la firma tal como se enviará.
- **Firma por dirección** — cuando tengas más direcciones de remitente, aparece el selector **Firma para** encima del campo. «Predeterminada (todas las direcciones)» es la firma de la cuenta; elige una dirección para escribir una solo para ella. Las direcciones sin firma propia siguen usando la predeterminada, y cambiar de remitente al redactar coloca la correcta, también entre dos direcciones de la misma cuenta. Si vacías el campo de una dirección, vuelve a la predeterminada.
- **Direcciones de remitente adicionales** — una por línea, p. ej. `Nombre <alias@example.org>`. El campo **De** muestra entonces direcciones en vez de cuentas: primero la propia del buzón y después sus alias. Que una dirección se acepte realmente lo decide tu proveedor: un servidor que rechaza enviar con un alias lo dice, y Plainva muestra ese error en lugar de enviar en silencio con otro nombre.

## Acciones del buzón

Las estrellas/marcas se sincronizan por IMAP y Microsoft; **Marcados** muestra la selección del servidor. Puedes mover mensajes de forma individual o en grupo. Fuera de la papelera, **Eliminar** siempre significa «mover a la papelera»; solo allí aparece **Eliminar permanentemente** tras una confirmación. En Gmail, mover cambia etiquetas y las acciones en **Todos** pueden afectar al mensaje en todas sus etiquetas; Plainva avisa antes.
