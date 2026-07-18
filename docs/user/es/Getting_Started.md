# Primeros pasos

Última actualización: 2026-07-18

Esta página te lleva desde la instalación hasta tu primer trabajo real: abrir o crear un vault, conocer la interfaz y entender los tres modos del editor.

## ¿Qué es un vault?

Un vault es una carpeta normal en tu equipo que contiene tus notas en Markdown. Plainva añade una subcarpeta oculta `.plainva/` para el índice de búsqueda y la configuración — tus notas en sí siguen siendo archivos `.md` sin tocar. Puedes tener varios vaults (p. ej. "Personal" y "Trabajo") y cambiar entre ellos.

## Abrir o crear un vault

Al iniciar, la pantalla de bienvenida te saluda:

- **Abrir vault** — Plainva pregunta primero **"¿Dónde está tu vault?"**: **Carpeta local** abre una carpeta existente con archivos Markdown en este equipo (los vaults de Obsidian funcionan sin más); **Vault en línea** sincroniza un vault existente desde la nube en una carpeta local — los mismos tres pasos para cualquier proveedor (**Conectar**, **elegir la carpeta en la nube**, **elegir la carpeta local**; ver [Configurar la sincronización](Sync_Setup.md)).
- **Nuevo vault** — la primera pregunta es **"¿Dónde debería estar tu vault?"** (**En este equipo** o **En un servicio en línea**), luego eliges la estructura inicial: empieza vacío o desde una estructura de carpetas preparada; ambos se pueden ajustar en cualquier momento. El **Vault vacío** contiene solo un resumen `index.md`. Plantillas disponibles: **PARA**, **Zettelkasten**, **ACE (Linking Your Thinking)**, **Johnny.Decimal**, **GTD** y **Journal** — cada una crea carpetas, una nota de bienvenida con una guía rápida y resúmenes `index.md` mantenidos automáticamente en el [formato OKF](OKF.md) (los nombres de carpetas y archivos siguen el idioma de la aplicación). La plantilla **Journal** además configura las notas diarias del vault. Las plantillas **PARA**, **GTD**, **Zettelkasten** y **Journal** también incluyen [bases de datos](Databases_Base.md) ya enlazadas con sus correspondientes plantillas de nota — por ejemplo, proyectos con un tablero de estado y un enlace a su área, o tareas que apuntan a su proyecto. En la ruta en línea, la conexión sigue los mismos pasos: eliges el proveedor, te conectas, eliges la carpeta en la nube o creas una nueva mediante **Nueva carpeta**, eliges la carpeta local — la estructura elegida se crea en la carpeta local y se sube a la nube en la primera sincronización.

**Vaults recientes** lista todo lo que has abierto antes. **Quitar de la lista** elimina una entrada solo de Plainva — los archivos permanecen en el disco. Activa **Abrir automáticamente el último vault al iniciar** para saltarte la pantalla de bienvenida en el futuro. Al quitarlo, Plainva pregunta si además quieres olvidar todos los datos de la aplicación del vault (índice de búsqueda, ajustes, disposición de la ventana, credenciales de sincronización; las copias ZIP automáticas solo mediante la casilla adicional); tu carpeta del vault queda intacta en cualquier caso.

## La interfaz

- **Barra lateral izquierda** — cuatro vistas: **Archivos** (el árbol de archivos), **Etiquetas** (todas las `#etiquetas` del vault), **Marcadores** y **Bases de datos** (cada `.base` del vault, agrupada por carpeta — haz clic para abrirla). Arriba está el gran botón **Nuevo** (Nueva nota, además de **Más opciones** para Nueva carpeta, Nueva base, Nota diaria). Abajo: el selector de vaults, **Abrir nota diaria** y **Configuración**. El botón de doble flecha junto a las cuatro vistas contrae o expande todas las carpetas de una vez, y **Mostrar en el árbol de archivos** en el menú ⋮ del editor muestra la nota abierta directamente en el árbol. En la vista **Archivos**, un encabezado muestra el nombre y el icono del vault actual, y una franja **Abiertos recientemente** sobre el árbol da acceso con un clic a las notas que tenías abiertas más recientemente.
- **Barra de título** — tus pestañas abiertas. Las pestañas se pueden reordenar arrastrándolas y mover entre paneles del editor.
- **Área del editor** — donde lees y escribes. A través del menú de la pestaña (**Dividir a la derecha** / **Dividir abajo**) o los atajos `Ctrl+Alt+V` / `Ctrl+Alt+S` divides el editor en dos paneles, por ejemplo una nota junto a una base de datos.
- **Barra lateral derecha** — cuatro secciones, reordenables por arrastre: **Calendario** (notas diarias), **Esquema** (encabezados de la nota activa), **Retroenlaces** (quién enlaza aquí) y **Propiedades** (el frontmatter de la nota).
- **Barra de estado** — recuento de palabras/caracteres, estado de sincronización (Local/En línea/Sin conexión) y estado de guardado (**Guardando...** / **Guardado**).

## Los tres modos del editor

Cambia de modo en la parte superior derecha del editor:

| Modo | Para qué sirve |
|---|---|
| **Modo lectura** | Vista totalmente renderizada para leer y navegar. Los enlaces se abren directamente dentro de Plainva. |
| **Vista previa en vivo** | El modo predeterminado para escribir: el Markdown se renderiza mientras escribes; los caracteres de formato solo aparecen donde estás trabajando. |
| **Código fuente Markdown** | El texto sin procesar y sin renderizar — para un control total. |

En qué modo se abren tus notas depende de ti: elige la **Vista predeterminada** en **Configuración → App → Editor y notas** (lectura, en vivo o código fuente). Cambiar el modo en el editor se aplica a ese archivo durante la sesión actual.

También puedes alternar entre **Ancho de lectura** y **Ancho completo**.

## Fundamentos del árbol de archivos

- **Crear:** clic derecho en una carpeta → **Nueva nota aquí**, **Nueva carpeta** o **Nueva base de datos (.base)**. El gran botón **Nuevo** crea dentro de la carpeta seleccionada actualmente (o la carpeta padre de un archivo seleccionado).
- **Seleccionar:** un clic selecciona, `Ctrl`+clic añade o quita elementos individualmente, `Shift`+clic selecciona un rango, el clic central abre en una nueva pestaña.
- **Menú contextual:** incluye **Renombrar** (actualiza los enlaces en todo el vault), **Duplicar**, **Abrir en panel dividido (derecha)** / **Abrir en panel dividido (abajo)**, **Añadir marcador**, **Copiar ruta**, **Mostrar en el administrador de archivos**, **Eliminar**.
- **Selección múltiple:** eliminar pregunta una sola vez por todos los elementos, duplicar y mover por arrastre funcionan sobre toda la selección. Los elementos eliminados van a la papelera del sistema operativo.
- Las notas nuevas empiezan automáticamente con un `# Encabezado` derivado del nombre del archivo.
- El propio `index.md` de una carpeta (su resumen) se ordena en el árbol al **principio** de esa carpeta, por encima de sus subcarpetas y archivos — no alfabéticamente entre las demás notas.

## Notas diarias

El botón **Nota diaria** en la barra de acciones de la izquierda abre o crea la nota de hoy. Configura la carpeta base, el formato de fecha y una plantilla opcional en **Configuración → Vault → Contenido y estructura** (**Elegir carpeta…** junto al campo permite elegir la carpeta directamente en el vault).

El **Calendario** de la derecha es una vista general por días: al hacer clic en una fecha se abre una pequeña vista previa con los eventos y las tareas con fecha límite de ese día, además de la acción **Nota diaria**; un clic derecho ofrece lo mismo como menú. Los días con una nota diaria llevan un pequeño icono de amanecer, los días con eventos llevan puntos de color por calendario. El botón **Hoy** te devuelve al mes actual; al hacer clic en el nombre del mes se abre un selector rápido de mes y año. Ahí también puedes activar **Mostrar números de semana** para añadir una columna de semana ISO — el ajuste se recuerda.

## Configuración

**Configuración** (icono de engranaje abajo en la barra de acciones del extremo izquierdo, o `Ctrl+,`) se cierra con la **X** de arriba a la derecha, `Esc` o un clic fuera de la ventana. Los cambios se guardan de inmediato y automáticamente — solo las credenciales de sincronización se aplican deliberadamente mediante **Guardar**/**Conectar** (ver [Configurar la sincronización](Sync_Setup.md)). La configuración tiene dos partes; cada área del panel izquierdo abre su propia página, donde los ajustes se organizan en tarjetas de grupo con nombre:

- **App** — todo lo que se aplica a toda la app, en cinco áreas. **Apariencia**: el selector de **Tema** como tarjetas de vista previa — además de **Petrol** (el predeterminado) tienes **Nord**, **Solarized**, **Gruvbox**, **Catppuccin**, **Papel** (parecido a E-Ink, máximamente tranquilo), **Sepia** (papel cálido), **Bosque**, **Medianoche** (negro OLED), **Alto contraste** y **Fósforo verde**/**Fósforo ámbar** (terminal retro con líneas de escaneo sutiles); además el **Modo** (**Claro**/**Oscuro**/**Predeterminado del sistema**; los temas de un solo modo como **Medianoche** fijan el modo, y el interruptor claro/oscuro de la barra de título se desactiva mientras están activos), **Idioma**, **Inicio de semana**, **Densidad** y **Zoom de la interfaz**. **Editor y notas**: **Vista predeterminada**, **Tamaño de fuente del contenido** y **Fuente del contenido**. **Inicio y comportamiento**: abrir automáticamente el último vault, avisos de compatibilidad. **Actualizaciones**: Plainva comprueba silenciosamente si hay versiones nuevas al iniciar y muestra un aviso si las encuentra — haz clic en él para descargar e instalar la actualización de inmediato (permanece visible hasta que Plainva se reinicie). Desactivable mediante **Buscar actualizaciones al iniciar**. **Acerca de y diagnóstico**: datos de versión, el estado del **Llavero del sistema**, **Métricas de rendimiento**, **Exportar diagnóstico…** (sin contenido de notas) e **Informar de un problema**. Los atajos de teclado están siempre accesibles con `F1` o **Mostrar atajos de teclado** abajo a la izquierda.
- **Vault** — el vault seleccionado aparece como una pequeña tarjeta en el panel (el vault activo lleva un punto); con varios vaults, **Cambiar** debajo de ella abre una lista de selección. Debajo, cinco áreas por vault: **Sincronización** (ver [Configurar la sincronización](Sync_Setup.md)), **Calendario y cuentas** (calendario y cuentas de correo, ver [Calendario y tareas](Calendar_and_Tasks.md) y [Captura de correo](Email_Capture.md)), **Contenido y estructura** (**Notas diarias**, **Plantillas y tareas** incluida la **Carpeta de plantillas**, **OKF (Open Knowledge Format)** — ver [OKF](OKF.md) — y **Bases de datos extendidas**), **Copias de seguridad y versionado** y **Mantenimiento** (**Reconstruir índice**, restaurar archivos eliminados, estadísticas del vault).

## Personalizar la interfaz

- **Alternar las barras laterales** con los dos botones de la barra de título o con `Ctrl+Alt+B` (izquierda) / `Ctrl+Alt+R` (derecha) — ideal para escribir concentrado. Plainva recuerda el estado.
- **Paleta de comandos**: `Ctrl+P` abre **Comandos** — escribe y pulsa `Intro` para ejecutar (nueva nota, nota diaria, dividir, barras laterales, **Crear copia de seguridad ahora** y mucho más).
- **Densidad**: en **Configuración → App → Apariencia**, elige entre **Cómodo** y **Compacto** — Compacto reduce listas, menús y filas de tabla; el contenido de las notas no se ve afectado.
- **Fuente del contenido**: en **Configuración → App → Editor y notas**, ajusta el **Tamaño de fuente del contenido** (12–24 px) y la **Fuente del contenido** (**Predeterminada del tema**, **Serif**, **Sans-serif**, **Monoespaciada** o **Personalizada…** con el nombre de cualquier fuente instalada) — esto solo escala el editor y la vista de lectura; la interfaz permanece igual.
- **Zoom de la interfaz**: escala TODA la interfaz entre el 80 % y el 150 % — en **Configuración → App → Apariencia** o con `Ctrl+Plus`/`Ctrl+Minus` (`Ctrl+0` restablece el zoom).
- **Diálogos y avisos sin ventanas nativas**: las confirmaciones aparecen como diálogos de Plainva con el estilo de tu tema (las acciones destructivas tienen un botón rojo), los avisos breves como notificaciones discretas abajo a la derecha — se acabaron las ventanas emergentes del sistema.

## Ver también

- [Notas y Markdown](Notes_and_Markdown.md) — todo sobre cómo escribir
- [Atajos de teclado](Keyboard_Shortcuts.md)
- [FAQ y solución de problemas](FAQ.md)

## El grafo

A través de **Ctrl/Cmd+Shift+G** (o la sección **Grafo** en la barra lateral derecha) ves tu vault como un mapa: carpetas como burbujas, notas como nodos, relaciones como aristas etiquetadas — incluyendo un modo de limpieza y viaje en el tiempo. Más detalles: [Grafo](Graph.md).
