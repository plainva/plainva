# Captura de correo

Última actualización: 2026-07-18

Plainva puede leer tu buzón — y solo leerlo — para sacar conocimiento del correo y llevarlo a tu vault. Deliberadamente **no** es un cliente de correo: se conecta por IMAP en modo de solo lectura, nunca cambia nada en el buzón (ni siquiera las marcas de no leído) y nunca envía correo por sí mismo.

## Conectar un buzón

**Ajustes → tu vault → Calendario y cuentas → Correo (IMAP, solo lectura) → Añadir cuenta…**: servidor, puerto y una **contraseña de aplicación**. Para Gmail eso es `imap.gmail.com`, puerto `993`, con una contraseña de aplicación de [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (requiere autenticación de dos factores) — sin OAuth, sin verificación. Al conectar se valida el inicio de sesión antes de guardar nada; la contraseña va al llavero de tu sistema operativo. El ajuste **Carpeta de correo** elige dónde se guardan los correos capturados (por defecto `Mail`).

## Leer correo

Abre la pestaña de correo desde la barra de acciones de la izquierda (icono de correo) o la paleta de comandos (**Abrir correo**). La lista muestra tu bandeja de entrada empezando por lo más reciente (los no leídos en negrita; **Cargar más** carga páginas adicionales). Seleccionar un mensaje lo abre en un **visor aislado**:

- **Se bloquea el contenido remoto** — los píxeles de rastreo, las imágenes remotas y los cargadores de estilos se eliminan y se cuentan ("Contenido remoto bloqueado (n)"). Solo se muestran las imágenes insertadas autocontenidas.
- Los enlaces se muestran como texto sin formato y no son clicables dentro del visor.
- Los scripts y los formularios nunca se ejecutan. El mensaje se renderiza en un marco aislado con una política de contenido estricta.

Los adjuntos se listan con nombre y tamaño; el `.eml` original (más abajo) los incluye completos.

## Llevar un mensaje al vault

Tres botones en cada mensaje:

- **Guardar como nota** — crea una nota en tu carpeta de correo (`AAAA-MM-DD Asunto.md`) con el remitente y la fecha en el frontmatter y el cuerpo en texto sin formato debajo del encabezado del asunto. Capturar el mismo mensaje dos veces abre la nota existente en lugar de duplicarla.
- **+ .eml** — además guarda el original en bruto junto a la nota y lo enlaza. El `.eml` contiene todo, incluidos los adjuntos, y se abre en cualquier programa de correo.
- **→ Tarea** — crea una entrada en tu [base de datos de tareas predeterminada](Tasks.md) con el asunto como título, la fecha de hoy como fecha límite y el estado abierto prerrellenado.

## Sacar contenido — sin enviar

Plainva nunca habla SMTP. En su lugar:

- **Responder como nota** (en un mensaje): crea una nota dirigida al remitente (`to:` en el frontmatter) con el original citado — escribe tu respuesta en Plainva.
- **Guardar la nota como borrador en el buzón** (paleta de comandos, en cualquier nota abierta): guarda la nota como un **borrador en tu propio buzón** por IMAP — elige la cuenta, el destinatario y la carpeta de borradores, luego abre tu programa de correo habitual, revisa y envía desde ahí. El formato se conserva.
- **Enviar la nota por correo (mailto)** (paleta de comandos): abre tu programa de correo predeterminado con la nota como texto sin formato (las notas largas se acortan).
- **Copiar la nota como texto de correo** (paleta de comandos): pone la nota en el portapapeles con formato — pégala en cualquier editor de correo.
