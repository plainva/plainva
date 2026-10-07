# Conectar apps de IA (Beta)

Última actualización: 2026-10-07

Las apps de IA de tu ordenador —Claude Code, Claude Desktop, Cursor, VS Code y otras que hablan el Model Context Protocol (MCP)— pueden leer tu vault a través de Plainva: buscar en ella, leer notas y sus secciones, esquemas, retroenlaces, bases de datos, tareas y notas recientes, y abrir una nota en Plainva. Por sí solas no cambian nada: una app a la que se lo permitas puede sugerir cambios, y esos esperan hasta que decidas (ver más abajo). Forma parte de las funciones experimentales de IA y solo funciona en el escritorio.

El sentido contrario — el asistente de Plainva usando herramientas de servidores que conectas tú mismo — se describe bajo **Herramientas externas (MCP)** en [Asistente de IA](AI_Assistant.md).

Una tercera vía — Plainva inicia un agente de IA de otro fabricante en la carpeta del vault, con su sesión en la pestaña de IA — se describe en [Agentes externos](External_Agents.md).

## Cómo funciona

Plainva incluye junto a la app un pequeño programa auxiliar, `plainva-mcp`. Una app de IA lo inicia, y el programa auxiliar se conecta con Plainva en marcha por un canal privado de este ordenador: una tubería con nombre en Windows, un socket en una carpeta privada en macOS y Linux. Nunca se abre un puerto de red. Plainva debe estar abierto con el vault; si no, la app recibe un mensaje claro.

## Activarlo

1. Abre **Configuración → IA y automatización** y activa **Usar la IA en este dispositivo**.
2. Activa **Permitir que las apps de IA de este ordenador lean este vault**.
3. Configura la app (ver más abajo). La primera vez que se conecta, Plainva pregunta qué app es, qué programa la inició y qué carpetas puede leer. No hay nada marcado: elige carpetas o **Todo el vault** y luego **Permitir**. **Rechazar** aparta la app, y Plainva no vuelve a preguntar por ella durante diez minutos. Debajo de las carpetas está **Puede sugerir cambios**, desactivado mientras no lo marques; lo que permite se describe más abajo.

La app guarda un secreto en el llavero del sistema para la próxima vez. Las carpetas se conceden por app y por vault: en otro vault, la app vuelve a preguntar.

## Configurar una app

- **Claude Code:** copia el **Comando para Claude Code** de la configuración y ejecútalo en una terminal.
- **Claude Desktop:** **Crear paquete…** escribe un archivo `plainva.mcpb`; ábrelo y Claude Desktop instala Plainva.
- **Otras apps (JSON):** copia la configuración y añádela a los ajustes MCP de la app, por ejemplo al `mcp.json` de Cursor.

## Lo que ve una app

Solo las carpetas que permitiste, y solo lo que tus reglas de privacidad dejan ir a un modelo en la nube que puede llegar a Internet —una app cuenta como tal, porque Plainva no ve qué hace con lo que lee—: las notas con `cloud: deny` o `web: deny`, o en una carpeta con una de esas reglas, no existen para una app —ni su texto ni sus títulos—, los enlaces a ellas se retienen y los lugares del diario nunca se envían. Las carpetas propias de Plainva (`.plainva`, `.agent`) y las propias reglas nunca se pueden leer. Cada ruta de una solicitud y de una respuesta se comprueba dos veces: en la ventana de la app y en la parte nativa de Plainva.

La configuración muestra las apps permitidas con sus carpetas y las últimas solicitudes. **Quitar** retira el permiso de una app en todos los vaults. Eso vale al instante, también para una app que esté conectada en ese momento.

Además de las herramientas, Plainva ofrece sus tres habilidades como prompts, en el idioma de la app: `daily-orientation`, `weekly-review` y `project-status`, que pide el nombre del proyecto. Una app que admite prompts los muestra entre sus comandos.

## Dejar que una app sugiera cambios

Leer nunca es un permiso para escribir. Que una app pueda además sugerir cambios es una respuesta aparte: **Puede sugerir cambios** en la pregunta de su primera conexión, o más tarde el interruptor **… puede sugerir cambios** en la configuración; por app y por vault, y desactivado hasta que lo actives. Vale desde la siguiente solicitud de la app; las herramientas adicionales aparecen en la app cuando vuelve a conectarse.

Una app a la que se lo permitiste recibe seis herramientas más, y ninguna cambia el vault:

- **Un cambio en una nota** —en su texto o en una de sus propiedades— se convierte en una sugerencia en el margen de la nota, firmada con el nombre de la app y «(app de IA)». Allí aceptas o rechazas cada cambio, como con cualquier sugerencia (consulta [Comentarios y sugerencias](Comments_and_Suggestions.md)).
- **Una nota nueva** se convierte en un borrador en **Pendiente**, en la pestaña de IA. Existe cuando eliges allí **Crear**.
- **Renombrar, mover y eliminar** preguntan primero. Plainva muestra en su propia ventana qué pasaría —al renombrar, también las notas cuyos enlaces seguirían el cambio— y la app muestra un aviso de que Plainva está esperando. Solo después de **Permitir** en Plainva, y cuando la app continúa, Plainva lo hace como cuando lo haces a mano; la app solo sabe si se hizo. Para eliminar, Plainva abre entonces su propio diálogo de eliminación, y nada desaparece antes de que confirmes allí. A una app que no puede mostrar ese aviso no se le ofrecen estas tres herramientas.

Una dirección web que traiga una app se escribe de modo que nada la abra ni la cargue (`https[://]…`), igual que con el asistente. Las reglas de privacidad propias de una nota (`plainva.ai`) no las establece ninguna app, y dentro de un espacio de trabajo cifrado no se sugiere, redacta ni planifica nada. **Solicitudes recientes** en la configuración dice de cada solicitud qué fue de ella, también que Plainva te preguntó o que dijiste que no.

## Límites

- Solo en el escritorio: los teléfonos no ejecutan esas apps, y ni iOS ni Android dejan que una app ofrezca a otra un canal privado.
- ChatGPT y claude.ai en el navegador no llegan a él: solo se conectan a servidores en internet, y Plainva no mantiene ninguno.
- Una app nunca cambia el vault por sí sola: lo que escribe espera como sugerencia o borrador, y renombrar, mover o eliminar necesita tu sí en Plainva.
