# Primeros pasos

Última actualización: 2026-09-04

Esta página te lleva desde la instalación hasta tu primer trabajo real: abrir o crear un vault, conocer la interfaz y entender los tres modos del editor.

## Requisitos del sistema

Plainva dibuja su ventana con el motor web del sistema: es el motor, no el procesador, quien marca el mínimo:

- **Windows** 10 o posterior con el entorno de ejecución WebView2 (Windows 11 ya lo incluye; en 10 lo añade el instalador)
- **macOS 13.3 (Ventura)** o posterior, Apple Silicon o Intel
- **Linux** con WebKitGTK 2.40 o posterior (compruébalo con `pkg-config --modversion webkit2gtk-4.1`)

El límite del motor es **Safari 16.4**, y en macOS lo decide la versión del sistema: una app dibuja su ventana con la WebView del sistema, que llega con las actualizaciones de macOS y no con Safari. En un Mac que Apple ya no actualiza, Safari puede por tanto ser mucho más reciente que el motor que recibe cualquier otra app: Monterey se queda en Safari 15.6.1 por muy actualizado que esté su Safari. Ventura alcanzó la 16.4 en la versión 13.3, que es donde se sitúa el mínimo; instalar un Safari más reciente no lo desplaza.

En un sistema por debajo de ese mínimo, Plainva te lo dice al arrancar en lugar de abrir una ventana en blanco.

## ¿Qué es un vault?

Un vault es una carpeta normal en tu equipo que contiene tus notas en Markdown. Plainva añade una subcarpeta oculta `.plainva/` para el índice de búsqueda y la configuración — tus notas en sí siguen siendo archivos `.md` sin tocar. Puedes tener varios vaults (p. ej. "Personal" y "Trabajo") y cambiar entre ellos.

## Abrir o crear un vault

En el **primerísimo** arranque — antes de que hayas abierto nunca un vault — Plainva muestra, una sola vez, un breve mensaje de bienvenida. En tres líneas explica en qué se basa Plainva, muestra junto a él una pequeña vista previa de la interfaz y ofrece directamente las tres formas de entrar: **Abrir vault**, **Nuevo vault** e **Importar de otra aplicación**. **Más tarde** lo omite y te deja en la pantalla de bienvenida habitual; no vuelve a aparecer — a menos que vuelvas a mostrarlo en **Configuración → Inicio y comportamiento → Pantalla de bienvenida**.

Después de una actualización, el mismo lugar muestra qué ha cambiado: el cambio más importante de esa versión con un título propio, y el resto en una línea cada uno. Esto aparece una vez por versión — puedes volver a mostrarlo en cualquier momento en **Configuración → Inicio y comportamiento → Mostrar lo nuevo de la versión de nuevo**.

Al iniciar, la pantalla de bienvenida te saluda:

- **Abrir vault** — Plainva pregunta primero **"¿Dónde está tu vault?"**: **Carpeta local** abre una carpeta existente con archivos Markdown en este equipo (los vaults de Obsidian funcionan sin más); **Vault en línea** sincroniza un vault existente desde la nube en una carpeta local — los mismos tres pasos para cualquier proveedor (**Conectar**, **elegir la carpeta en la nube**, **elegir la carpeta local**; ver [Configurar la sincronización](Sync_Setup.md)).
- **Nuevo vault** — la primera pregunta es **"¿Dónde debería estar tu vault?"** (**En este equipo** o **En un servicio en línea**), luego eliges la estructura inicial: empieza vacío o desde una estructura de carpetas preparada; ambos se pueden ajustar en cualquier momento. El **Vault vacío** contiene solo un resumen `index.md`. Plantillas disponibles: **Plainva Tour**, **PARA**, **Zettelkasten**, **ACE (Linking Your Thinking)**, **Johnny.Decimal**, **GTD**, **Journal** y **Proyecto** — cada una crea carpetas, una nota de bienvenida con una guía rápida y resúmenes `index.md` mantenidos automáticamente en el [formato OKF](OKF.md) (los nombres de carpetas y archivos siguen el idioma de la aplicación). La plantilla **Plainva Tour** es el punto de partida recomendado: llena nueve carpetas y siete bases de datos con ejemplos, así que ves cada vista en acción una vez — tablón, calendario, galería, tablero, cronología, tabla y la vista de árbol con subelementos — además de plantillas de nota, reglas de carpetas y una referencia rápida de Markdown. Aquí nada es intocable: borra lo que no necesites y renombra el resto. La plantilla **Journal** además configura las notas diarias del vault. Las plantillas **Plainva Tour**, **PARA**, **GTD**, **Zettelkasten**, **Journal** y **Proyecto** también incluyen [bases de datos](Databases_Base.md) ya enlazadas con sus correspondientes plantillas de nota — por ejemplo, proyectos con un tablero de estado y un enlace a su área, o tareas que apuntan a su proyecto. La plantilla **Proyecto** muestra las herramientas de proyecto en acción: cuatro bases de datos conectadas, una columna que cuenta las tareas abiertas de un proyecto, un pie de columna que suma el esfuerzo planificado, dependencias entre tareas e hitos que aparecen como un rombo en la cronología. En la ruta en línea, la conexión sigue los mismos pasos: eliges el proveedor, te conectas, eliges la carpeta en la nube o creas una nueva mediante **Nueva carpeta**, eliges la carpeta local — la estructura elegida se crea en la carpeta local y se sube a la nube en la primera sincronización.

**Vaults recientes** lista todo lo que has abierto antes. **Quitar de la lista** elimina una entrada solo de Plainva — los archivos permanecen en el disco. Activa **Abrir automáticamente el último vault al iniciar** para saltarte la pantalla de bienvenida en el futuro. Al quitarlo, Plainva pregunta si además quieres olvidar todos los datos de la aplicación del vault (índice de búsqueda, ajustes, disposición de la ventana, credenciales de sincronización, calendario y buzones; las copias ZIP automáticas solo mediante la casilla adicional); tu carpeta del vault queda intacta en cualquier caso.

## La interfaz

- **Barra lateral izquierda** — tres vistas: **Archivos** (el árbol de archivos), **Etiquetas** (todas las `#etiquetas` del vault) y **Bases de datos** (cada `.base` del vault, agrupada por carpeta — haz clic para abrirla); **Abiertos recientemente** y **Marcadores** son secciones encima del selector de vistas, así que permanecen visibles en las tres vistas. En la parte superior está el campo de búsqueda, con un **+** al lado para Nueva nota, Nueva carpeta, Nueva base y Nota diaria. El texto de ejemplo del campo de búsqueda indica qué se está buscando, y las pestañas muestran su nombre mientras el panel sea suficientemente ancho — a medida que se estrecha, primero solo la pestaña activa conserva su nombre, y después solo quedan los iconos. Abajo: el selector de vaults, **Abrir nota diaria** y **Configuración**. El botón de doble flecha junto a las tres vistas contrae o expande todas las carpetas de una vez, y **Mostrar en el árbol de archivos** en el menú ⋮ del editor muestra la nota abierta directamente en el árbol. En la vista **Archivos**, un encabezado muestra el nombre y el icono del vault actual.
- **Ordenar**: el botón junto al campo de búsqueda ordena el árbol de archivos por **Título**, **Última modificación** o **Creación**; elegir la misma opción otra vez invierte la dirección. Las subcarpetas y el `index.md` de una carpeta siempre van delante; la elección se recuerda en este dispositivo.
- **Barra de título** — tus pestañas abiertas. Las pestañas se pueden reordenar arrastrándolas y mover entre paneles del editor.
- **Área del editor** — donde lees y escribes. A través del menú de la pestaña (**Dividir a la derecha** / **Dividir abajo**) o los atajos `Ctrl+Alt+V` / `Ctrl+Alt+S` divides el editor en dos paneles, por ejemplo una nota junto a una base de datos.
- **Más ventanas**: una nota en su propia ventana muestra a la derecha la misma barra lateral de contexto (esquema, grafo, bases de datos, backlinks, propiedades; el calendario se queda en la ventana principal), que se pliega y despliega desde la barra de título.
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
- **Mover a…** en el menú contextual mueve una nota, una carpeta o toda la selección múltiple a la carpeta que elijas: el mismo camino que arrastrar y soltar, pero sin arrastrar; las pestañas abiertas, las referencias del tablero y el índice lo siguen.
- **Las mismas acciones en las secciones encima del árbol:** hacer clic derecho en una entrada de **Abiertos recientemente** o **Marcadores** abre el mismo menú — sin las entradas de carpeta, y con **Quitar de la lista** añadido (eso solo quita la entrada de la lista, nunca el archivo). Renombrar ahí se hace mediante un diálogo en lugar de un campo en la fila. Las vistas de calendario y tareas también pueden estar en **Abiertos recientemente**; se pueden abrir y quitar de la lista, pero no renombrar ni eliminar — son vistas, no archivos.
- **Selección múltiple:** eliminar pregunta una sola vez por todos los elementos, duplicar y mover por arrastre funcionan sobre toda la selección. Los elementos eliminados van a la papelera del sistema operativo.
- Las notas nuevas empiezan automáticamente con un `# Encabezado` derivado del nombre del archivo.
- El propio `index.md` de una carpeta (su resumen) se ordena en el árbol al **principio** de esa carpeta, por encima de sus subcarpetas y archivos — no alfabéticamente entre las demás notas.
- **Volver a leer:** la flecha circular en el encabezado del árbol (o **F5**) vuelve a leer el vault — Plainva concilia el índice con la carpeta y, en vaults en línea, también obtiene los archivos de la nube. Un breve informe indica luego qué fue nuevo, modificado, eliminado u omitido. Para una sola carpeta está **Volver a leer esta carpeta** en el menú contextual.

## Notas diarias

El botón **Nota diaria** en la barra de acciones de la izquierda abre o crea la nota de hoy. Configura la carpeta base, el formato de fecha y una plantilla opcional en **Configuración → Vault → Contenido y estructura** (**Elegir carpeta…** junto al campo permite elegir la carpeta directamente en el vault).

El formato de fecha usa los mismos tokens que Obsidian: `YYYY` año, `MM` mes, `DD` día, `dddd` nombre del día — `YYYY-MM-DD dddd` da `2026-07-29 Wednesday`. El texto que debe quedar tal cual va entre corchetes: `[Diario] YYYY-MM-DD`. Los nombres de meses y días siempre están en inglés, así cambiar el idioma de la aplicación nunca hace que tus notas diarias existentes queden ilocalizables.

El **Calendario** de la derecha es una vista general por días: **hacer clic** en una fecha abre la [pestaña de calendario](Calendar_and_Tasks.md) en ese día; un **clic derecho** abre un menú que nombra el día en la parte superior y ofrece **Abrir calendario**, **Nota diaria** y los eventos y las tareas con fecha límite de ese día. Los días con una nota diaria llevan un pequeño **icono de sol**, los días con eventos llevan puntos de color por calendario. El botón **Hoy** te devuelve al mes actual; al hacer clic en el nombre del mes se abre un selector rápido de mes y año. Ahí también puedes activar **Mostrar números de semana** para añadir una columna de semana ISO — el ajuste se recuerda.

## Configuración

**Configuración** (icono de engranaje abajo en la barra de acciones del extremo izquierdo, o `Ctrl+,`) se cierra con la **X** de arriba a la derecha, `Esc` o un clic fuera de la ventana. Los cambios se guardan de inmediato y automáticamente — solo las credenciales en la nube se aplican deliberadamente mediante **Iniciar sesión** en la zona **Cuentas en la nube** (ver [Configurar la sincronización](Sync_Setup.md)). La configuración tiene dos partes; cada área del panel izquierdo abre su propia página, donde los ajustes se organizan en tarjetas de grupo con nombre:

- **App** — todo lo que se aplica a toda la app, en cinco áreas. **Apariencia**: el selector de **Tema** como tarjetas de vista previa — además de **Petrol** (el predeterminado) tienes **Nord**, **Solarized**, **Gruvbox**, **Catppuccin**, **Papel** (parecido a E-Ink, máximamente tranquilo), **Sepia** (papel cálido), **Bosque**, **Medianoche** (negro OLED), **Alto contraste** y **Fósforo verde**/**Fósforo ámbar** (terminal retro con líneas de escaneo sutiles); además el **Modo** (**Claro**/**Oscuro**/**Predeterminado del sistema**; los temas de un solo modo como **Medianoche** fijan el modo, y el interruptor claro/oscuro de la barra de título se desactiva mientras están activos), **Idioma**, **Inicio de semana**, **Densidad** y **Zoom de la interfaz**. **Editor y notas**: **Vista predeterminada**, **Tamaño de fuente del contenido** y **Fuente del contenido**: una lista en la que cada tipografía se muestra en su propia forma e indica si este dispositivo la tiene; una fuente no instalada no se puede elegir, y debajo queda un campo de texto libre para todo lo demás. **Inicio y comportamiento**: abrir automáticamente el último vault, avisos de compatibilidad. **Actualizaciones**: Plainva comprueba silenciosamente si hay versiones nuevas al iniciar y muestra un aviso si las encuentra — haz clic en él para descargar e instalar la actualización de inmediato (permanece visible hasta que Plainva se reinicie). Desactivable mediante **Buscar actualizaciones al iniciar**. **Acerca de y diagnóstico**: datos de versión, el estado del **Llavero del sistema**, **Métricas de rendimiento**, **Exportar diagnóstico…** (sin contenido de notas) e **Informar de un problema**. Los atajos de teclado están siempre accesibles con `F1` o **Mostrar atajos de teclado** abajo a la izquierda.
- **Vault** — el vault seleccionado aparece como una pequeña tarjeta en el panel (el vault activo lleva un punto); con varios vaults, **Cambiar** debajo de ella abre una lista de selección. Debajo, las áreas por vault: **Cuentas en la nube** es el único lugar para todos los inicios de sesión en la nube — **Conectar cuenta…** elige el proveedor (Microsoft, Google, Nextcloud, Dropbox, S3, WebDAV o un buzón de correo) y los servicios (**Archivos**, **Calendario y tareas**, **Correo**) que esa cuenta debe llevar. Las áreas de servicio **Sincronización** (ver [Configurar la sincronización](Sync_Setup.md)), **Calendario** (ver [Calendario y tareas](Calendar_and_Tasks.md)) y **Correo** (ver [Captura de correo](Email_Capture.md)) solo aparecen cuando una cuenta conectada lleva ese servicio. Siempre presentes: **Contenido y estructura** (**Notas diarias**, **Plantillas y tareas** incluida la **Carpeta de plantillas** además de las reglas **carpeta → plantilla** y **tipo de nota → plantilla**, que también se aplican en el teléfono, la **Carpeta de entrada**, la **Carpeta de adjuntos**, **OKF (Open Knowledge Format)** — ver [OKF](OKF.md) — y **Bases de datos extendidas**), **Copias de seguridad y versionado** y **Mantenimiento** (**Reconstruir índice**, restaurar archivos eliminados, estadísticas del vault).

## Tabs

- **Clic derecho en una pestaña** para abrir su menú: **Fijar**, **Recargar**, **Abrir en panel dividido (derecha)**, **Copiar ruta**, **Mostrar en el administrador de archivos** y el grupo de cierre.
- **Fijar** mantiene una pestaña en su lugar: se mueve al principio de la barra de pestañas, muestra un pin en lugar de la cruz de cierre y sobrevive a cada **Cerrar las demás** / **Cerrar a la izquierda** / **Cerrar a la derecha** / **Cerrar todo**. Para cerrarla, primero elige **Dejar de fijar**.
- **Recargar** descarta la vista actual y vuelve a leer el archivo desde el disco — útil cuando otro programa lo ha modificado. Si la pestaña tiene cambios sin guardar, Plainva se niega a recargar en lugar de sobrescribir tu trabajo.

## Varias ventanas

Plainva no tiene por qué quedarse en una sola ventana. Lo que necesites ahora mismo puede colocarse junto a tu trabajo:

- **Clic derecho en una pestaña → Abrir en una ventana nueva.** La pestaña deja esta ventana y sigue viva en la nueva; no queda ninguna copia atrás.
- **Clic derecho en la barra de acciones** sobre **Grafo**, **Tareas**, **Calendario** o **Correo** ofrece la misma opción. Si después vuelves a hacer clic en la entrada, Plainva trae esa ventana al frente en lugar de abrir la vista por segunda vez.
- **Paleta de comandos → Abrir ventana de comunicación** inicia una ventana ya dividida: correo a la izquierda, calendario a la derecha.
- **Paleta de comandos → Abrir una segunda ventana** abre de nuevo toda la interfaz — barras laterales, barra de acciones, pestañas, barra de estado. Esa es la opción para un segundo monitor.
- Mientras **redactas un mensaje**, el icono de Abrir en su propia ventana saca la redacción a una ventana propia — con todo lo que ya has escrito.

Una ventana independiente es un Plainva completo: tiene **pestañas**, se puede **dividir** y guarda a través de la misma cadena que la ventana principal. Lo que deliberadamente no tiene son las barras laterales y la barra de acciones — está pensada para mostrar una sola cosa.

Una **segunda ventana** sí las tiene — y tiene su **propio vault**. Se abre con el vault de la ventana principal; el selector de vaults, abajo a la izquierda, la cambia a otro sin arrastrar la ventana principal consigo. La configuración, el asistente de importación y **crear** un vault se quedan en la ventana principal — los botones están ahí, y al pulsar uno traes la ventana principal al frente y la abres **allí**. Todo lo relacionado con tu trabajo es igual en ambas: editar, guardar, buscar y el estado de sincronización en la barra de estado. El ancho de las barras laterales y lo que hayas colapsado pertenecen a cada ventana por separado.

**Un mismo contenido solo está abierto en UNA ventana a la vez.** Si abres una nota que ya se muestra en otro lugar, esa ventana pasa al frente. Esto es intencionado: dos editores sobre el mismo archivo son la forma más segura de perder trabajo. Redactar es la excepción — escribir dos mensajes a la vez es algo normal.

El botón **Siempre visible** en el título de la ventana la mantiene en primer plano mientras trabajas en la otra.

Al iniciar de nuevo, todos los vaults que tenían una ventana regresan, y sus ventanas auxiliares vuelven a aparecer donde estaban. Si prefieres que no sea así: **Configuración → Inicio y comportamiento → Ventanas**. Un **mensaje sin enviar** nunca se restaura — lo que hay en una ventana de redacción vive en memoria, y una ventana que afirmara haberlo conservado sería peor que ninguna ventana.

## Varios vaults a la vez

Dos vaults uno junto al otro — trabajo y privado, proyecto y archivo — necesitan dos ventanas: **una ventana muestra exactamente un vault**. Abre una segunda ventana (paleta de comandos → **Abrir una segunda ventana**) y cambia su vault abajo a la izquierda. A partir de ahí ambas funcionan por su cuenta: su propia búsqueda, su propia sincronización, sus propios recordatorios.

- **Cada vault sincroniza por su cuenta.** El estado en la barra de estado siempre pertenece al vault de la ventana en la que estás.
- **La misma cuenta en ambos vaults no es un problema.** Plainva renueva el inicio de sesión una sola vez y se lo pasa al otro vault en lugar de dejar que se invaliden mutuamente.
- **Un vault dentro de otro vault se rechaza.** Si la carpeta está **dentro** de un vault que ya está abierto — o al revés — Plainva te lo dice y explica por qué: ambos vigilarían y sincronizarían los mismos archivos.
- **El mismo vault en dos ventanas** está permitido; las ventanas lo comparten, y una nota sigue abriéndose solo en una de ellas.
- **La última mirada lo cierra.** En cuanto ninguna ventana vuelve a mirar un vault, Plainva lo guarda — antes termina lo que se esté escribiendo.

## Barras y áreas

La barra de acciones del extremo izquierdo, las pestañas de la barra lateral izquierda, las secciones sobre el árbol de archivos y las secciones de la barra lateral derecha funcionan todas de la misma manera.

La barra de acciones ofrece **Nueva nota**, **Nueva carpeta** y **Nueva base de datos (.base)**. Las tres crean el elemento dentro de la **carpeta seleccionada** del árbol de archivos; con un archivo seleccionado, en la carpeta de ese archivo; sin nada seleccionado, en la raíz. La **Nota diaria** no sigue esa regla — siempre va a la carpeta que hayas configurado para ella en los ajustes. Si no necesitas una de las tres, ocúltala.

**Justo donde están:** **mantén pulsado** un botón o un encabezado de sección y arrástralo a su nuevo lugar — un simple clic sigue solo activándolo, y si te desplazas mientras mantienes pulsado, te desplazas (el arrastre se cancela). `Esc` cancela un arrastre en curso. Un **clic derecho** ofrece las mismas acciones sin mantener pulsado: **Subir**, **Ocultar** y **Personalizar barras…**.

**En un solo lugar:** en **Configuración → Vault → Barras y áreas** las cinco barras están una debajo de otra, incluida la barra de navegación del teléfono, que así puedes organizar en la pantalla grande. Cada una es **una única** lista con una línea divisoria: todo lo que está por encima es visible, todo lo que está por debajo está oculto. Aquí mueves las entradas con el asa de arrastre — en esta página se está organizando una lista, que es exactamente para lo que sirve un asa. Arrastrar hasta el borde superior o inferior hace que la página se desplace también, de modo que una entrada puede pasar de la parte más baja a la más alta en un solo movimiento.

Dos cosas no se pueden ocultar a propósito: **Mostrar atajos de teclado** y **Configuración** en la parte inferior de la barra de acciones, y la pestaña **Archivos** de la barra lateral izquierda. Todo lo demás puedes ocultarlo; las acciones ocultas de la barra siguen siendo accesibles desde la **paleta de comandos** (`Ctrl+P`). Las secciones de la barra lateral derecha que no tienen nada que mostrar para la nota abierta nunca llegan a aparecer.

Esta disposición pertenece al vault y viaja a tus otros dispositivos mediante [Configurar la sincronización](Sync_Setup.md). Un vault que no has adaptado sigue tu **valor predeterminado** — configúralo con **Guardar como predeterminado**, y **Restablecer el valor predeterminado** devuelve un vault adaptado a ese valor.

## Personalizar la interfaz

- **Alternar las barras laterales** con los dos botones de la barra de título o con `Ctrl+Alt+B` (izquierda) / `Ctrl+Alt+R` (derecha) — ideal para escribir concentrado. Plainva recuerda el estado.
- **Paleta de comandos**: `Ctrl+P` abre **Comandos** — escribe y pulsa `Intro` para ejecutar (nueva nota, nota diaria, dividir, barras laterales, **Crear copia de seguridad ahora** y mucho más).
- **Densidad**: en **Configuración → App → Apariencia**, elige entre **Cómodo** y **Compacto** — Compacto reduce listas, menús y filas de tabla; el contenido de las notas no se ve afectado.
- **Tema personalizado**: la tarjeta **Mi tema** en **Configuración → App → Apariencia** selecciona el tema y el lápiz sobre ella abre su página: tono base (claro/oscuro), un fondo dentro de un rango de luminosidad, cualquier acento, la fuente de la interfaz y las esquinas. Plainva deriva los colores del texto para que nunca se pierda en el fondo; un acento demasiado pálido se corrige a al menos 3:1 y el editor lo indica. En el teléfono, los mismos controles están en la pantalla **Apariencia**.
- **Fuente del contenido**: en **Configuración → App → Editor y notas**, ajusta el **Tamaño de fuente del contenido** (12–24 px) y la **Fuente del contenido** (**Predeterminada del tema**, **Serif**, **Sans-serif**, **Monoespaciada** o **Personalizada…** con el nombre de cualquier fuente instalada) — esto solo escala el editor y la vista de lectura; la interfaz permanece igual.
- **Lista de fuentes**: bajo **Personalizada…** aparece una lista con las fuentes de tu sistema, cada fila en su propia fuente; la que no está instalada lo indica y no se puede elegir. El campo de nombre de abajo acepta cualquier otra fuente instalada.
- **Zoom de la interfaz**: escala TODA la interfaz entre el 80 % y el 150 % — en **Configuración → App → Apariencia** o con `Ctrl+Plus`/`Ctrl+Minus` (`Ctrl+0` restablece el zoom).
- **Diálogos y avisos sin ventanas nativas**: las confirmaciones aparecen como diálogos de Plainva con el estilo de tu tema (las acciones destructivas tienen un botón rojo), los avisos breves como notificaciones discretas abajo a la derecha — se acabaron las ventanas emergentes del sistema.

## El grafo

A través de **Ctrl/Cmd+Shift+G** (o la sección **Grafo** en la barra lateral derecha) ves tu vault como un mapa: carpetas como burbujas, notas como nodos, relaciones como aristas etiquetadas — incluyendo un modo de limpieza y viaje en el tiempo. Más detalles: [Grafo](Graph.md).

## Memoria de la barra lateral derecha

Las secciones que no tienen nada que mostrar para la nota abierta — **Esquema**, **Retroenlaces**, **Propiedades**, **Bases de datos** — no aparecen en absoluto, en lugar de quedarse ahí atenuadas. Toda la barra lateral derecha recuerda una única preferencia global para las notas; las vistas de pantalla completa sin contexto de nota solo la cierran temporalmente.

**Cuando arrastras el panel para estrecharlo** cambia en tres pasos, para que nada se rompa:

- **280 px o más** — como siempre.
- **232–280 px** — las propiedades ponen el nombre encima del valor en lugar de al lado, los valores largos pasan a la línea siguiente, las secciones se comprimen.
- **por debajo de 232 px** — el calendario muestra **una semana en lugar del mes** (siete días, número de semana abajo a la derecha); una cuadrícula mensual tendría aquí celdas de 14 píxeles y dejaría de ser un calendario. El grafo se vuelve más corto, y los retroenlaces muestran el nombre del archivo sin la línea de ruta.

La barra lateral derecha no puede bajar de **200 px** — ninguna sección es utilizable por debajo de eso. La izquierda sigue bajando hasta 150 px, porque los nombres de archivo simplemente se truncan.

## Ver también

- [Notas y Markdown](Notes_and_Markdown.md) — todo sobre cómo escribir
- [Atajos de teclado](Keyboard_Shortcuts.md)
- [FAQ y solución de problemas](FAQ.md)
