# Captura de correo

Última actualización: 2026-07-20

Plainva puede leer tu buzón para sacar conocimiento del correo y llevarlo a tu vault, y — desde la 0.4.0 — también redactar y enviar correo. El foco sigue en la **captura** de mensajes como notas; un buzón conectado por **IMAP** solo se lee para la captura (nada en él cambia, ni siquiera las marcas de no leído) mientras no configures el envío.

> **Experimental.** El cliente de correo se comunica con cuentas externas reales (IMAP/SMTP y Microsoft) que no se pueden ejercitar en las pruebas automatizadas de Plainva. Funciona y se usa a diario, pero trátalo como una vista previa: conserva una copia de seguridad y, por favor, informa de cualquier cosa que parezca rara.

## Conectar un buzón

**Ajustes → tu vault → Cuentas en la nube → Conectar cuenta…** y elige el proveedor:

- **Microsoft** — para Outlook.com y Microsoft 365: marca **Correo** en el paso de servicios (si quieres, junto con **Archivos** y **Calendario y tareas** — una cuenta, un inicio de sesión) e inicia sesión directamente en el navegador, sin contraseña de aplicación ni IMAP. Plainva usa el registro de aplicación central de Plainva (opcionalmente puedes indicar tu propio ID de aplicación en los detalles de la cuenta). Leer, capturar y **enviar directamente** pasan todos por el inicio de sesión de Microsoft.
- **Servidor de correo (IMAP)** — para cualquier otro proveedor: host, puerto y una **contraseña de aplicación**. Para Gmail eso es `imap.gmail.com`, puerto `993`, con una contraseña de aplicación de [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (requiere autenticación de dos factores) — sin OAuth, sin verificación; el asistente lo indica por sí mismo para las direcciones de Gmail. Hay ajustes preconfigurados disponibles para **web.de** y **GMX**. Añade un host SMTP para enviar directamente.

Al conectar se valida el inicio de sesión antes de guardar nada; las credenciales van al llavero de tu sistema operativo. Los buzones conectados y los ajustes de captura viven después en la zona **Correo**: el ajuste **Carpeta de correo** elige dónde se guardan los correos capturados (por defecto `Mail`).

## Leer correo

Abre la pestaña de correo desde la barra de acciones de la izquierda (icono de correo) o la paleta de comandos (**Abrir correo**). La lista muestra tu bandeja de entrada empezando por lo más reciente (los no leídos en negrita; **Cargar más** carga páginas adicionales). Seleccionar un mensaje lo abre en un **visor aislado**:

- **Se bloquea el contenido remoto** — los píxeles de rastreo, las imágenes remotas y los cargadores de estilos se eliminan y se cuentan ("Contenido remoto bloqueado (n)"). Solo se muestran las imágenes insertadas autocontenidas. **Mostrar imágenes**, junto al contador, revela una vez las imágenes https de un mensaje; **Cargar siempre las imágenes remotas** en los ajustes de correo lo convierte en una opción permanente. Ten en cuenta: cargar imágenes remotas permite que el remitente vea tu dirección IP y cuándo abriste el correo — por eso el bloqueo es la opción predeterminada.
- Los enlaces se muestran como texto sin formato y no son clicables dentro del visor.
- Los scripts y los formularios nunca se ejecutan. El mensaje se renderiza en un marco aislado con una política de contenido estricta.

Los adjuntos se listan con nombre y tamaño; el `.eml` original (más abajo) los incluye completos.

## Llevar un mensaje al vault

Tres botones en cada mensaje:

- **Guardar como nota** — crea una nota en tu carpeta de correo (`AAAA-MM-DD Asunto.md`) con el remitente y la fecha en el frontmatter y el cuerpo en texto sin formato debajo del encabezado del asunto. Capturar el mismo mensaje dos veces abre la nota existente en lugar de duplicarla.
- **+ .eml** — además guarda el original en bruto junto a la nota y lo enlaza. El `.eml` contiene todo, incluidos los adjuntos, y se abre en cualquier programa de correo.
- **→ Tarea** — crea una entrada en tu [base de datos de tareas predeterminada](Tasks.md) con el asunto como título, la fecha de hoy como fecha límite y el estado abierto prerrellenado.

## Redactar y enviar

En cuanto una cuenta puede enviar — una cuenta de **Microsoft**, o una cuenta **IMAP** con un **host SMTP** configurado —, puedes escribir y enviar correo desde Plainva:

- **Redactar** (en la pestaña de correo) abre una ventana flotante con filas etiquetadas **De / Para / Cc / Cco**. Escribe una dirección y pulsa Intro o coma para convertirla en un chip; **Cc/Cco** se despliegan bajo demanda. El cuerpo es un editor de Markdown con una barra de herramientas de formato y un menú de comandos "/".
- **Responder**, **Responder a todos** y **Reenviar** en cualquier mensaje abren la misma ventana con el original citado y los destinatarios prerrellenados; un reenvío lleva consigo los adjuntos.
- **Enviar** sale por SMTP (cuentas IMAP) o Microsoft Graph (cuentas de Microsoft).
- **Esta nota por correo** (menú `⋮` de una nota, o la paleta de comandos) inicia un mensaje con la nota actual adjunta, o incrustada como texto.

## Entregar una nota sin el cliente de correo

No tienes que enviar desde dentro de Plainva. Esto funciona con cualquier nota y no necesita SMTP:

- **Responder como nota** (en un mensaje): crea una nota dirigida al remitente (`to:` en el frontmatter) con el original citado — escribe tu respuesta en Plainva.
- **Guardar la nota como borrador en el buzón** (paleta de comandos, en cualquier nota abierta): guarda la nota como un **borrador en tu propio buzón** por IMAP — elige la cuenta, el destinatario y la carpeta de borradores, luego abre tu programa de correo habitual, revisa y envía desde ahí. El formato se conserva.
- **Enviar la nota por correo (mailto)** (paleta de comandos): abre tu programa de correo predeterminado con la nota como texto sin formato (las notas largas se acortan).
- **Copiar la nota como texto de correo** (paleta de comandos): pone la nota en el portapapeles con formato — pégala en cualquier editor de correo.
