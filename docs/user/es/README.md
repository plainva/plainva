# Guía de usuario de Plainva

Última actualización: 2026-07-06

Esta traducción se generó automáticamente — las correcciones son bienvenidas.

Plainva es un editor de vaults en Markdown: tus notas son archivos Markdown normales en una carpeta (un "vault") en tu equipo — sin silo de base de datos, sin obligación de una cuenta en la nube. Esta guía explica cómo trabajar con Plainva y cómo funcionan los formatos de archivo.

## Contenido

| Página | De qué trata |
|---|---|
| [Primeros pasos](Getting_Started.md) | Abrir o crear un vault, la interfaz, los modos del editor, pestañas y vista dividida |
| [Notas y Markdown](Notes_and_Markdown.md) | Cómo funcionan los archivos Markdown: escribir, formatear, propiedades (frontmatter), iconos, enlaces, plantillas, imágenes |
| [Bases de datos (.base)](Databases_Base.md) | Ver notas como una base de datos — vistas, filtros, propiedades, relaciones, nuevos elementos (similar a Notion, pero basado en archivos) |
| [OKF](OKF.md) | El Open Knowledge Format: `type`, `okf_version`, la gestión de index.md y la conversión opcional del vault |
| [Referencia del formato de archivo](File_Format_Reference.md) | El formato exacto en disco de cada archivo del vault — para herramientas, scripts o una IA que edite notas y archivos `.base` directamente |
| [Automatización y scripts](Automation_and_Scripts.md) | Ampliar Plainva sin plugins: cómo los scripts, las herramientas CLI y los agentes de IA leen y escriben un vault de forma segura |
| [Copias de seguridad e historial de versiones](Backups_and_Versioning.md) | Versiones automáticas de archivo, restauración (incluidos archivos eliminados) y copias de seguridad ZIP diarias del vault |
| [La aplicación móvil](Mobile_App.md) | Plainva en Android e iOS: estructura, edición, bases de datos, sincronización y red de seguridad |
| [Configurar la sincronización](Sync_Setup.md) | Paso a paso por proveedor: WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3 |
| [Seguridad y uso compartido](Security_and_Sharing.md) | Workspace personal cifrado, recuperación, migración y bloqueo |
| [Compatibilidad de sincronización](Sync_Compatibility.md) | Qué servicios funcionan hoy — directamente, mediante WebDAV o mediante el cliente de escritorio del proveedor |
| [Google Drive (BYO)](Google_Drive_BYO_Guide.md) | Configurar la sincronización con Google Drive usando tus propias credenciales |
| [OneDrive y Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md) | Configurar la sincronización con OneDrive y Dropbox usando tu propio registro de app |
| [Buscar](Search.md) | Búsqueda de texto completo, selector rápido, buscar y reemplazar, etiquetas |
| [Tareas](Tasks.md) | La vista de tareas de todo el vault: todas las casillas de tus notas, con filtros de estado, etiqueta, carpeta y fecha límite, y cambio de estado con un clic |
| [Calendario y tareas externas](Calendar_and_Tasks.md) | Conectar calendarios CalDAV/Google/Microsoft, la pestaña de calendario, notas de reunión y la sincronización de listas de tareas externas con la base de datos de tareas |
| [Captura de correo](Email_Capture.md) | IMAP de solo lectura: el visor aislado, guardar correos como notas/.eml/tareas, y sacar contenido sin enviar |
| [Grafo](Graph.md) | Grafo de contexto, mapa del vault con modo de limpieza y viaje en el tiempo, grafo como vista de base de datos |
| [Atajos de teclado](Keyboard_Shortcuts.md) | Todos los atajos de teclado de un vistazo |
| [FAQ y solución de problemas](FAQ.md) | Preguntas frecuentes: compatibilidad con Obsidian, archivos en conflicto, copias de seguridad y más |

## Principios fundamentales

- **Tus archivos te pertenecen.** Un vault es una carpeta normal de archivos Markdown. Puedes abrirlo, copiarlo o respaldarlo con cualquier otro programa en cualquier momento.
- **El Markdown puro es el formato canónico.** Incluso las funciones adicionales (propiedades, iconos, bases de datos) se guardan en formatos de texto abiertos y legibles.
- **Compatible con Obsidian.** Los vaults de Obsidian existentes nunca se dañan ni se reformatean; Obsidian puede abrir todos los archivos que crea Plainva.
