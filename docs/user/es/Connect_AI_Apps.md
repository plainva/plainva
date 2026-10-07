# Conectar apps de IA (Beta)

Última actualización: 2026-10-07

Las apps de IA de tu ordenador —Claude Code, Claude Desktop, Cursor, VS Code y otras que hablan el Model Context Protocol (MCP)— pueden leer tu bóveda a través de Plainva: buscar en ella, leer notas y sus secciones, esquemas, retroenlaces, bases de datos, tareas y notas recientes, y abrir una nota en Plainva. No pueden cambiar nada. Forma parte de las funciones experimentales de IA y solo funciona en el escritorio.

El sentido contrario — el asistente de Plainva usando herramientas de servidores que conectas tú mismo — se describe bajo **Herramientas externas (MCP)** en [Asistente de IA](AI_Assistant.md).

## Cómo funciona

Plainva incluye junto a la app un pequeño programa auxiliar, `plainva-mcp`. Una app de IA lo inicia, y el programa auxiliar se conecta con Plainva en marcha por un canal privado de este ordenador: una tubería con nombre en Windows, un socket en una carpeta privada en macOS y Linux. Nunca se abre un puerto de red. Plainva debe estar abierto con la bóveda; si no, la app recibe un mensaje claro.

## Activarlo

1. Abre **Configuración → IA y automatización** y activa **Usar la IA en este dispositivo**.
2. Activa **Permitir que las apps de IA de este ordenador lean esta bóveda**.
3. Configura la app (ver más abajo). La primera vez que se conecta, Plainva pregunta qué app es, qué programa la inició y qué carpetas puede leer. No hay nada marcado: elige carpetas o **Toda la bóveda** y luego **Permitir**. **Rechazar** aparta la app, y Plainva no vuelve a preguntar por ella durante diez minutos.

La app guarda un secreto en el llavero del sistema para la próxima vez. Las carpetas se conceden por app y por bóveda: en otra bóveda, la app vuelve a preguntar.

## Configurar una app

- **Claude Code:** copia el **Comando para Claude Code** de la configuración y ejecútalo en una terminal.
- **Claude Desktop:** **Crear paquete…** escribe un archivo `plainva.mcpb`; ábrelo y Claude Desktop instala Plainva.
- **Otras apps (JSON):** copia la configuración y añádela a los ajustes MCP de la app, por ejemplo al `mcp.json` de Cursor.

## Lo que ve una app

Solo las carpetas que permitiste, y solo lo que tus reglas de privacidad dejan ir a un modelo en la nube: las notas con `cloud: deny`, o en una carpeta con esa regla, no existen para una app —ni su texto ni sus títulos—, los enlaces a ellas se retienen y los lugares del diario nunca se envían. Las carpetas propias de Plainva (`.plainva`, `.agent`) y las propias reglas nunca se pueden leer. Cada ruta de una solicitud y de una respuesta se comprueba dos veces: en la ventana de la app y en la parte nativa de Plainva.

La configuración muestra las apps permitidas con sus carpetas y las últimas solicitudes. **Quitar** retira el permiso de una app en todas las bóvedas.

Además de las herramientas, Plainva ofrece sus tres habilidades como prompts, en el idioma de la app: `daily-orientation`, `weekly-review` y `project-status`, que pide el nombre del proyecto. Una app que admite prompts los muestra entre sus comandos.

## Límites

- Solo en el escritorio: los teléfonos no ejecutan esas apps, y ni iOS ni Android dejan que una app ofrezca a otra un canal privado.
- ChatGPT y claude.ai en el navegador no llegan a él: solo se conectan a servidores en internet, y Plainva no mantiene ninguno.
- Solo lectura; que una app proponga cambios llegará en una versión posterior.
