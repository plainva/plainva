# La aplicación móvil

Última actualización: 2026-08-23

Plainva también está disponible como aplicación para Android e iOS. Funciona sobre los mismos archivos Markdown, el mismo formato **OKF** y el mismo motor de sincronización que la aplicación de escritorio — tu bóveda se mantiene idéntica en ambos mundos.

## Instalar la aplicación

La aplicación móvil está en **prueba abierta** en Google Play. En **Android** entras directamente: abre el enlace de prueba desde [plainva.com/android-beta](https://plainva.com/android-beta), toca **Convertirte en tester** e instala la aplicación desde Google Play — sin invitación y sin unirte a ningún grupo. Plainva también está publicada en la Play Store. En **iPhone**, la distribución va por TestFlight; la lista de espera está en [plainva.com](https://plainva.com).

**Requisitos del sistema:** en iPhone y iPad, Plainva necesita **iOS 16.4** o posterior — allí el motor que dibuja la interfaz forma parte del sistema, y un Safari más nuevo no lo cambia. En Android basta con Android 7, pero **Android System WebView** debe estar actualizado; si es demasiado antiguo, Plainva lo indica al arrancar y señala el camino por la Play Store.

Es una versión temprana: guarda una copia de seguridad de tu vault y cuéntame qué falla.

## Diseño

- **Barra inferior:** **de dos a cuatro** superficies de trabajo de tu elección, más el elemento fijo **Áreas** al final — en total, de tres a cinco destinos para una barra. **Notas** permanece siempre visible: es como accedes a tus archivos.
- **Cada área** (Notas, Hoy, Tareas, Calendario, Correo, Grafo) queda a un toque de distancia mediante la **hoja de áreas**: **Áreas** en la barra o un **toque prolongado en la barra**. La hoja marca el área actual y lleva directamente, al final, a **Personalizar la barra de navegación…**. Las etiquetas, los marcadores y los elementos abiertos recientemente ya no son áreas propias — viven bajo **Notas**.
- **Configurar la barra:** **Ajustes** → **Barra de navegación**. Usa **−**/**+** para definir cuántas superficies de trabajo muestra la barra (2–4, con vista previa en vivo) y el **tirador** para organizar la lista: las entradas de arriba forman la barra (marcadas con un recuadro), arrastrar una hacia arriba la incorpora a la barra. Arrastrar hasta el borde superior o inferior hace que la lista se desplace también, de modo que un solo movimiento cubre toda la lista. Nada se oculta nunca — lo que no está en la barra sigue siendo accesible mediante **Áreas**. Si el área en la que estás sale de la barra, la app pasa a la primera visible. También puedes organizar la misma barra **en el escritorio** (Ajustes → Vault → Barras y áreas); con la sincronización de ajustes activada, la disposición viaja entre tus dispositivos.
- **Una fila de carpeta cuenta todo lo que hay debajo**, no solo las notas que están directamente en ella: una carpeta que solo contiene subcarpetas ya no dice «0 notas» junto a una flecha que lleva a cientos.
- **＋** flota como un botón redondo sobre la barra y abre la creación rápida: nota, nota diaria, carpeta, base de datos, «Desde plantilla…».
- **Mantener pulsada una fila muestra lo que esa fila puede hacer**: nota, carpeta, base de datos y tarea responden igual, y **Seleccionar varios** es la primera entrada de esa hoja. Deslizar hacia la izquierda ejecuta directamente las dos acciones más frecuentes; la hoja y el deslizamiento ofrecen lo mismo en el mismo orden.
- **Encabezado:** el mismo en todas partes — a la izquierda, Atrás (no aparece en una superficie de trabajo), en el centro el título y una línea de contexto, a la derecha la búsqueda y ⋮. Cuando te desplazas, se despega del contenido y la barra de navegación se repliega a sus iconos; si te desplazas hacia arriba, vuelve a abrirse.
- **Un ⋮ siempre significa lo mismo:** acciones sobre el objeto que está abierto. Los ajustes de la aplicación no están detrás de él.
- **Ajustes:** en la parte inferior de **Notas**, igual que en el escritorio. Abren primero la lista de áreas (como el panel izquierdo de la configuración de escritorio) — un toque abre esa página. Arriba del todo, **Vault activo** lleva a la gestión de vaults: cambiar de vault (marca de verificación = activo), **Crear un vault** y **Conectar una bóveda en la nube**. La lista muestra **las mismas áreas que en el escritorio** — incluidas **Inicio y comportamiento** (volver a mostrar la bienvenida y las novedades), **Barras y áreas** (la barra de navegación) y **Mantenimiento** (Estadísticas del vault, reconstruir el índice, restaurar archivos eliminados). Solo falta **Actualizaciones**: la app no se actualiza sola, de eso se encargan Google Play y TestFlight. **Mantenimiento** incluye además la **importación desde otras apps**: en el teléfono siempre escribe en una subcarpeta del vault abierto, muestra antes lo que crearía, se puede detener mientras se ejecuta y deja un informe al final.

## Leer y editar notas

Las notas se abren **renderizadas y de solo lectura**; el lápiz de arriba a la derecha cambia al modo de edición (con una barra de herramientas sobre el teclado: formato, listas, enlace interno, comandos de barra oblicua, insertar foto). Las inclusiones `![[Nota]]` aparecen como tarjetas de vista previa que se pueden tocar.

El botón **Detalles de la nota** en la cabecera (entre el marcador y el menú ⋮) abre la ficha contextual de la nota: propiedades (editables directamente), retroenlaces, esquema, grafo y el **historial de versiones** — cada edición crea automáticamente snapshots que puedes revisar, comparar y restaurar. El código fuente Markdown y la búsqueda en la nota están en el menú ⋮.

En una pantalla ancha (una tableta a partir de 1024 px) esa ficha puede permanecer abierta como una **tercera columna** junto a la nota, en lugar de abrirse y cerrarse cada vez. El interruptor se llama **Anclar el panel de contexto** y vive en **Ajustes → Apariencia → Diseño**; se aplica a este dispositivo. Con él desactivado — o en una ventana más estrecha —, el mismo botón abre la ficha como antes.

## Plantillas

Las plantillas se comportan exactamente igual que en el escritorio: los marcadores de posición (`{{title}}`, `{{date}}`, `{{daily+1}}`, `{{weekday:monday}}` …) se rellenan al crear la nota, **todas** las preguntas de una plantilla llegan juntas en **una sola** hoja — cancelarla no crea nada — y `{{cursor}}` coloca el cursor al abrirse la nota.

Las reglas **carpeta → plantilla** y **tipo de nota → plantilla** se definen en el escritorio; viajan con la sincronización de ajustes y también se aplican aquí — de modo que una nota en `Projekte/` empieza igual en ambos dispositivos, incluida la captura con `＋` y **+ Entrada** en una base de datos. Dos detalles: `{{weekday:…}}` siempre cuenta desde el lunes en el teléfono (el inicio de semana viene de **Apariencia**), y `{{clipboard}}` pide el contenido del portapapeles en la misma hoja en lugar de leerlo sin preguntar. La lista completa de marcadores de posición está en [Notas y Markdown](Notes_and_Markdown.md).

## Bases de datos (`.base`)

Las bases de datos `.base` funcionan como en la aplicación de escritorio: cada vista (**Tabla**, **Lista**, **Galería**, **Tablero**, **Calendario**, **Cronología**), la edición tipada de celdas, las tarjetas del **Tablero** se mueven manteniendo pulsado. **Configurar** gestiona las vistas, las columnas, los filtros (incluidos los grupos), el orden y las propiedades.

La **vista de calendario** tiene tres periodos: **mes**, **semana**, **día**. El mes sigue siendo la entrada — es el único que aún muestra una forma en la pantalla de un teléfono; semana y día son listas, porque siete columnas de contenido dejan de ser legibles a ese ancho. Una entrada que abarca varios días aparece como **barra** en lugar de repetirse cada día, y las horas van antes del título. La **línea de tiempo** muestra una **fila por entrada** con una barra de principio a fin: ambos extremos se pueden **arrastrar con el dedo**, lo que escribe el campo de fecha de la nota. En **Configurar** eliges el campo de fecha y de fecha final y **color por** — el mismo ajuste, el mismo archivo que en el escritorio. Los esquemas de relación (destinos, cardinalidad) se siguen gestionando en la aplicación de escritorio.

**Varias entradas a la vez**: mantén pulsada una fila y elige **Seleccionar varios** — la primera entrada de la hoja. A partir de ahí, un toque selecciona en lugar de abrir, y una barra en la parte inferior indica cuántas hay. Desde allí puedes **eliminar** la selección (una sola pregunta, no doce, con el mismo resumen de conexiones que ofrece una eliminación individual) o usar **Definir valor…** para establecer una propiedad en todas a la vez: elige primero la propiedad y luego el valor. Donde una propiedad indica **actualmente mixto**, las entradas seleccionadas tienen valores distintos. Un valor vacío elimina la propiedad. Mientras se ejecuta, ves el progreso y puedes cancelar; lo que ya se escribió permanece. Las etiquetas, las listas, la selección múltiple y las relaciones no están incluidas a propósito — ahí, «ponerlas todas en X» significaría que cada valor existente desaparece.

Una vista **Tablón** muestra las notas como un tablero de dos columnas de tarjetas adhesivas: tocar abre la nota, mantener pulsado muestra las acciones (fijar, etiquetas, color, eliminar), arrastrar tras mantener pulsado reordena, y las casillas de verificación se marcan directamente en la tarjeta. El campo de entrada de arriba captura una nota nueva. Consejo: apunta la base de datos a tu carpeta de entrada (**Ajustes** → **Contenido y estructura**) y tanto las notas rápidas del ＋ como los textos compartidos desde otras apps caerán directamente en el tablón.

## Tareas

El área **Tareas** reúne todas las casillas de tu vault — todas las líneas `- [ ]` y `- [x]` de todas las notas, agrupadas por nota. Es el resumen basado en líneas que una base de datos no te puede dar, porque una base de datos trabaja con notas completas.

Tocar una tarea abre la nota **en esa línea**; la casilla la marca como hecha y reescribe exactamente el carácter `[ ]`/`[x]`. Las fechas límite (`📅`) y las `#tags` aparecen como chips para no repetirse dentro del texto.

Si tu vault tiene una **base de datos de tareas** (**Ajustes** → **Contenido y estructura**), el área la muestra arriba como su propia sección: marcar, cambiar estado, **+ Nueva tarea** y **Abrir como base de datos**. Si la base de datos nombra una lista de tareas de un proveedor (**Configurar** → **Fuente de datos** → **Crear también nuevas tareas en** — configurable aquí igual que en el escritorio), la hoja de creación también lleva un interruptor **Crear también en «…»**: activado, porque elegir la lista ya es la decisión, y desactivado para la única tarea que debe quedarse en el vault. Una casilla movida y un correo capturado como tarea siguen el mismo camino. Cada fila de casilla lleva entonces también **A la base de datos** en su línea meta — la línea se queda como enlace interno, y la tarea sigue viviendo como una nota propia.

Las **Listas de tareas** que seleccionaste para tus cuentas son reflejadas en esa base de datos por el propio teléfono — importa las tareas nuevas, reconoce una nota existente por su anclaje (en lugar de crear una segunda) y envía tus ediciones al proveedor. Elimina una nota de tarea deliberadamente y la tarea también se elimina en el proveedor — con ocho segundos de **Deshacer**; envía la app a segundo plano dentro de ese plazo y la tarea permanece. Un archivo simplemente ausente, en cambio, nunca elimina nada. Las reglas en detalle están bajo [Calendario y tareas](Calendar_and_Tasks.md).

Encima de la lista tienes los mismos filtros que en el escritorio: **Carpeta**, **Etiqueta**, **Con fecha límite** y **Mostrar ocultas**. Ocultar es una propiedad de la **nota**, no de la tarea individual — el icono de ojo en el encabezado de una nota escribe `plainva.tasks: false` en el frontmatter de esa nota y la saca del resumen; **Ocultar plantillas** hace lo mismo a la vez para toda la carpeta de plantillas. El archivo conserva sus tareas, solo dejan de contarse. Mantener pulsado **A la base de datos** elige la **base de datos de destino** cuando tu vault tiene más de una.

Una fila de tarea muestra su título a todo lo ancho; el estado, la fecha límite, la repetición y las etiquetas están debajo, y exactamente una acción está a la derecha. **Bloquear tiempo** (el icono de calendario a la derecha) crea un evento de calendario para la tarea cuando hay un calendario conectado (fecha, inicio, duración, más el selector de calendario cuando varios admiten escritura); la **Repetición** en la línea meta crea la siguiente tarea con una nueva fecha de vencimiento cuando marcas esta como hecha. Ambas se describen en [Tareas](Tasks.md).

## Hoy

**Hoy** es la superficie del día. La franja de arriba selecciona un día — se extiende **en ambas direcciones**, dos semanas hacia atrás y dos hacia delante, y un punto marca cada día que ya tiene una nota diaria. Debajo está la **nota diaria** del día seleccionado (con su plantilla y su carpeta, para abrirla o crearla), luego las **citas y vencimientos** de ese día, y por último lo que editaste ese día.

La sección central reúne lo que de otro modo estaría en dos áreas distintas: primero los eventos de todo el día, luego los que tienen hora, en orden cronológico, y por último las tareas que vencen ese día. Tocar una tarea abre su nota. Sin un calendario conectado y sin una base de datos de tareas, la sección simplemente no aparece.

## Etiquetas

La lista de etiquetas está bajo **Notas**. Tocar abre las notas de una etiqueta; la flecha despliega las etiquetas anidadas. **Mantener pulsada** una etiqueta ofrece **Renombrar etiqueta** — en todo el vault, como en el escritorio: Plainva reescribe cada nota que la lleva (en el frontmatter y como `#tag` en el texto, incluidas sus `tag/child` hijas) y luego te dice en cuántas notas se reemplazó. Una nota que no se puede leer o escribir se omite — las demás se renombran de todos modos.

## Buscar y reemplazar en todo el vault

El camino es la lupa de la cabecera y luego `>` y **Buscar y reemplazar en el vault**. La pantalla busca en todas las notas a la vez. Escribe un término, toca **Buscar** y las coincidencias aparecen agrupadas por nota con su recuento; un toque abre las líneas de una nota y solo una permanece abierta a la vez. Desmarca las notas que quieras excluir: es por nota, nunca por línea, porque una nota se reemplaza entera o no se reemplaza. **Reemplazar en N notas** reescribe el resto, con barra de progreso y un **Cancelar** que se detiene en la siguiente nota. Cada nota se vuelve a leer justo antes de escribirla, de modo que una vista previa desactualizada nunca sobrescriba contenido más nuevo; una nota que cambió entretanto se omite y se te informa. Mayús/minús, palabra completa y regex también funcionan aquí.
## Resúmenes (index.md)

En un almacén OKF, el `index.md` es el índice de una carpeta. El teléfono ofrece dos caminos, pensados para dos momentos distintos.

**Para el momento en que te llama la atención:** mantén pulsada una carpeta — la hoja ofrece **Crear resumen** si no hay ninguno y **Actualizar resumen** si Plainva mantiene el existente. La fila nombra su efecto en lugar de pedirte que elijas. Si escribiste tú mismo el `index.md` de esa carpeta, la fila no aparece: tu archivo es tuyo.

**Para la pasada de limpieza:** **Configuración → Vault → Mantenimiento → Resúmenes** enumera cada carpeta con su número de notas y su estado — ordenado por *dónde falta algo*, no alfabéticamente, para que las pocas carpetas que requieren atención no queden enterradas entre las que ya están listas. Arriba, **Generar index.md en las N carpetas que no lo tienen** crea las que faltan de una vez. Si una carpeta sin `index.md` ya contiene una nota de resumen (MOC, resumen, README…), puedes **adoptarla** aquí: eso renombra el archivo y arrastra los enlaces por todo el almacén, por eso se pregunta antes.

**Siempre al día.** Los resúmenes generados por Plainva llevan una marca invisible. Solo esos archivos se mantienen — y a partir de ahora también el teléfono los mantiene: crea, mueve o elimina notas allí y Plainva reescribirá poco después los resúmenes afectados. Antes solo lo hacía el escritorio, así que un almacén cuidado en el teléfono se quedaba anticuado en silencio.

**Solo lectura, con una salida.** Un resumen gestionado se abre en modo lectura con una franja encima: **Actualizar** lo reescribe, **Editar de todos modos** quita la marca — a partir de ahí el archivo es enteramente tuyo y ya no se sobrescribe automáticamente. Sin esa protección, la siguiente ejecución escribiría en silencio sobre lo que hubieras escrito.


## Convertir al formato OKF

Llevar un vault entero al [formato OKF](OKF.md) ahora también funciona desde el teléfono: **Ajustes → Vault → Mantenimiento → Convertir al formato OKF**. El asistente analiza, te deja elegir el `type` por defecto, **nombra las notas afectadas** y solo después escribe: cada archivo pasa por la carpeta de copia de seguridad antes de cambiarse.

Como un teléfono puede terminar una app en marcha en cualquier momento, aquí la ejecución se detiene además en el siguiente archivo cuando tocas **Pausa** o la app pasa a segundo plano. Que Plainva pregunte la próxima vez que abras el vault si una ejecución interrumpida debe **continuarse** o **revertirse** vale para ambos dispositivos; **Más tarde** es una respuesta válida, la pregunta vuelve y no se pierde.

Una ejecución interrumpida deja un vault convertido en parte, no roto: solo se añaden campos de frontmatter, cada nota sigue siendo Markdown válido y cualquier otro editor puede leerla.

### OKF 0.2 en el teléfono

Los campos de [OKF 0.2](OKF.md) — procedencia, revisión, estado, caducidad — se leen y se muestran en el teléfono exactamente igual que en el escritorio: la insignia **Borrador**/**Obsoleta** en la cabecera de la nota, el aviso **Marcada como caducada** encima de la nota, y la sección **Confianza y procedencia** en la hoja de contexto de la nota, con el nivel de confianza. **Marcar como revisada** también está ahí: añade `human:<tu nombre>` al final de la lista verified; Plainva pide el nombre una vez por vault, lo guarda en el dispositivo y te deja cambiarlo en **Ajustes → Vault → Contenido y estructura → Nombre del revisor**. La versión del bundle de un vault se actualiza a 0.2 en **Ajustes → Vault → Mantenimiento → Versión del bundle** — con una vista previa, una copia de seguridad y la casilla que elimina el campo heredado `okf_version` de las notas.

## Grafo

El **mapa del vault** muestra tu vault como nodos y aristas. Tocar una burbuja de carpeta la despliega, tocar una nota la abre; los chips de arriba filtran por tipo de nota, etiqueta y tipo de arista. Arrastra un nodo y **el mapa recuerda dónde lo colocaste** — la disposición recordada vive en `.plainva/graph.json` y permanece deliberadamente en este dispositivo, como el índice de búsqueda.

**Mantener pulsado** un nodo abre su menú: abrir (o desplegar/contraer para una carpeta), **Enfocar la selección** y, si el nodo está anclado, **Desanclar**. Mantener pulsada una **arista** indica ambos extremos y abre una u otra nota. Arrastra una nota **sobre otra** y Plainva ofrece **enlazarlas** — como un enlace de texto al final de la nota, o mediante una relación de la base de datos correspondiente; una relación que permite exactamente una entrada pregunta antes, porque reemplaza el valor actual. El chip **Seleccionar** convierte un arrastre sobre una zona vacía en un rectángulo de selección (un teléfono no tiene tecla modificadora); las notas seleccionadas se pueden eliminar juntas, con la misma confirmación que una sola. **Exportar como SVG…** entrega el mapa al menú para compartir de tu dispositivo.

Esa misma limpieza a pequeña escala es lo que hace el **grafo en la ficha contextual de una nota**: muestra el vecindario de la nota abierta y, debajo, sugerencias de qué más podría pertenecerle. **Enlazar** coloca el enlace en el pasaje del texto — no al final de la nota —, y una sugerencia descartada sigue descartada, incluso después de cerrar la nota.

El chip **Limpiar** abre la lista de limpieza: las **huérfanas** (notas a las que nada apunta), los **enlaces rotos** (referencias que no llevan a ningún sitio) y las **menciones** — lugares donde se nombra una nota pero no se enlaza. Eliminas una huérfana con la misma confirmación que en cualquier otro sitio, creas la nota que falta para un enlace roto, y enlazas una mención exactamente **en el pasaje** en lugar de al final de la nota. Lo que descartas sigue descartado: no vuelve a aparecer en la siguiente pasada. El escaneo de menciones lee todas las notas, así que solo empieza cuando tú lo pides — y se puede detener en cualquier momento.

El **Enfoque** también puede activarse desde el menú del nodo: el mapa entonces muestra solo su vecindario hasta la profundidad que elijas (1–3). El chip que muestra la profundidad borra el enfoque de nuevo. Dos chips más leen el mapa por antigüedad: el **Mapa de calor** tiñe cada nodo según lo reciente de su última modificación, y el **Viaje en el tiempo** oculta todo lo que sea más reciente que el deslizador — así puedes ver crecer tu vault.

## Calendario y eventos

El área **Calendario** muestra tus calendarios conectados en las vistas **Día**, **3 días** y **Agenda** — el mismo modelo de cuentas que en el escritorio. Llegas a ella desde la barra de navegación o mediante **Áreas**. Cada columna de día muestra arriba su **día de la semana y su fecha**, y debajo una franja para los **eventos de todo el día** de esa jornada; ambos se desplazan con la cuadrícula en lugar de ocupar espacio de forma permanente. Tocar un evento abre la **vista previa del evento** como hoja — la misma superficie que la ventana flotante del escritorio: franja horaria, lugar, descripción, asistentes con sus respuestas y, si pertenece a una serie, su ritmo junto con la próxima cita. Para una invitación ofrece **Aceptar**, **Provisional** y **Rechazar**, y debajo **Editar evento**, **Nota de reunión** y **Eliminar evento**. Deslizar hacia abajo cierra la hoja. Las notas diarias no están aquí: viven en **Hoy**.

Gestiona las cuentas desde el icono de engranaje en el calendario de eventos: conecta **CalDAV** en el dispositivo con una contraseña de aplicación (p. ej. Fastmail, Nextcloud, iCloud); Google y Microsoft se conectan mediante inicio de sesión en el navegador. Por cuenta puedes mostrar u ocultar calendarios individuales.

Desde un evento, **Nota de reunión** crea la nota que le corresponde — la misma nota que también encuentra el escritorio: queda vinculada al evento, así que volver a invocarla la reabre en lugar de crear una segunda, y termina en la **Carpeta de reuniones**. Eliges esa carpeta en la zona de cuentas, bajo **Ajustes del calendario**, con un **explorador de carpetas** en lugar de escribir su ruta; ahí mismo está también el **Calendario predeterminado** (aquel en el que empieza un evento nuevo); ambos pertenecen a la bóveda y viajan con la sincronización de ajustes. El mismo lugar te permite elegir, por cuenta, qué **Listas de tareas** se reflejan en tu base de datos de tareas.

**El inicio de sesión es por dispositivo.** Lo que se sincroniza son los *ajustes* de tu cuenta, nunca el inicio de sesión en sí — es intencionado: las credenciales no deben salir del dispositivo. Por eso, una cuenta que llegó mediante la sincronización de ajustes aparece en la lista, pero lleva la marca **iniciar sesión**, con una línea debajo que indica qué hacer. Mientras ninguna cuenta haya iniciado sesión en este dispositivo, el calendario y el buzón lo explican ahí mismo en lugar de quedarse vacíos sin más, y **Iniciar sesión en este dispositivo** te lleva a las cuentas. Las cuentas con la sesión iniciada muestran **activa**. Si más tarde una sesión caduca o se revoca, la fila indica **sesión caducada** junto con el motivo, y **Volver a iniciar sesión** la pone en marcha sin eliminar la cuenta: la misma cuenta, los mismos calendarios. En Google y Microsoft, Plainva busca primero en el propio dispositivo el registro de aplicación que necesita — en la cuenta, en la sincronización de archivos de esa misma cuenta o en otra cuenta del mismo proveedor. Esto vale tanto para **Volver a iniciar sesión** como para **añadir** una cuenta: si Plainva encuentra uno, el formulario muestra **ID de cliente tomado de este dispositivo** con **Editar** al lado. Solo cuando realmente no encuentra ninguno se abre el formulario y lo pide.

**Un inicio de sesión para todos los servicios — también aquí.** Si una cuenta de Microsoft o Google lleva varios servicios (por ejemplo, archivos y calendario), la vista general de **Cuentas en la nube** ofrece fusionarlos en un único inicio de sesión. Después, un inicio de sesión mantiene activos todos los servicios y no solo uno — antes, un servicio podía seguir funcionando mientras otro de la misma cuenta había caducado en silencio. Un buzón de Gmail queda al margen: funciona por IMAP con contraseña de aplicación y no necesita consentimiento. La oferta se mantiene mientras el inicio de sesión compartido no cubra todos los servicios de la cuenta. Si le falta uno, los detalles de la cuenta ofrecen dos salidas: **Restablecer el inicio de sesión compartido** deja que cada servicio vuelva a usar el suyo, y **Salir del asistente** descarta un intento de conexión que nunca terminó.

**Recordatorios.** En **Ajustes del calendario → Recordatorios** activas **Recordar las citas**; el teléfono pide entonces una vez el permiso de notificaciones. Manda el recordatorio que trae la propia cita: solo cuando no dice nada, Plainva avisa 15 minutos antes, y las citas de todo el día la tarde anterior a las 19:00. Una cita que expresamente no quiere recordatorio no recibe ninguno. Se planifican los próximos 14 días, con un máximo de 64 recordatorios por adelantado: es lo que permite iOS; Plainva rellena esa ventana cada vez que abres la aplicación y tras cada actualización del calendario, y te dice a partir de cuándo un periodo ya no cabe, en lugar de tragarse citas en silencio. **El límite que queda:** el teléfono solo puede anunciar lo que vio en la última sincronización; una invitación que llega diez minutos antes del comienzo ya no alcanza ninguna notificación.

**Lo que ajustas junto a ello.** La **Antelación** se aplica a las citas sin recordatorio propio; **Citas de todo el día** decide en qué tarde o mañana avisan. **Tareas vencidas** incorpora además las tareas de tu base de datos de tareas: con hora, como una cita; sin hora, según la fila **Tareas sin hora** justo debajo, que por defecto recuerda **el día de vencimiento a las 09:00**. **Solo estos calendarios** limita de dónde llegan los recordatorios; si no seleccionas nada, pone **Todos**, y un calendario añadido más tarde entra por sí solo; la hoja permanece abierta hasta que termines, así que puedes marcar varios calendarios de una sentada. La notificación lleva dos acciones: en una cita **Nota de reunión** (la crea o abre la existente), en una tarea **Marcar** — que la completa allí mismo y, en una tarea periódica, crea la siguiente sin que abras la aplicación. Bajo los ajustes, una línea dice además **qué se planificó realmente** — por ejemplo «Programado: 12 citas · 3 tareas» — o por qué no se planificó nada, por ejemplo porque en este dispositivo no hay ninguna base de datos de tareas configurada.

## Correo electrónico

En **Ajustes → Correo electrónico** conectas un **buzón de Microsoft** (Outlook.com, Microsoft 365) directamente mediante el inicio de sesión en el navegador, sin contraseña de aplicación. Igual que con el calendario, el inicio de sesión es por dispositivo.

Después puedes abrir **Correo electrónico** como área propia desde la **hoja de áreas** y colocarla en la barra de navegación. La línea bajo el título muestra carpeta, mensajes sin leer y cuenta, y abre el selector de carpetas. Toca un mensaje para leerlo; **Guardar como nota** lo archiva en la carpeta **Mail** de tu bóveda (capturarlo dos veces abre la misma nota). Las imágenes remotas siguen bloqueadas hasta que las permitas para ese mensaje: una imagen cargada le indica al remitente cuándo y dónde lo leíste. Las cuatro acciones — **Responder**, **Responder a todos**, **Reenviar** y **Guardar como nota** — están en una fila anclada al borde inferior; mientras un mensaje está abierto, la barra de navegación se retira y le deja el sitio.

**Los buzones IMAP también funcionan en el teléfono.** Añade uno en **Ajustes → Correo electrónico**: elige el proveedor, introduce la dirección y la contraseña de aplicación, y Plainva rellena los servidores. Si tu proveedor no está en la lista, **Avanzado** te permite escribir tú mismo los servidores IMAP y SMTP, los puertos y un nombre de usuario distinto, y una cuenta existente se puede editar más tarde. Para seleccionar varios mensajes, basta con mantener pulsado uno de ellos; después, un toque añade más. En la vista de conversaciones, mantener pulsada o tocar la fila de la conversación selecciona todo el intercambio, y cada mensaje conserva su propia carpeta: una respuesta de **Enviados** se marca allí.

Un mensaje abierto ofrece **Responder**, **Responder a todos** y **Reenviar**. Una respuesta cita el original debajo de tu texto; «Responder a todos» añade además a los demás destinatarios y omite tu propia dirección. Al **redactar**, **Adjuntar archivo** añade un archivo desde la bóveda — en el teléfono la bóveda es el almacenamiento al que puedes acceder, y todo lo que llega al dispositivo (un adjunto guardado, una foto insertada) ya está ahí. Cada adjunto tiene su propia fila con **Quitar adjunto**, mientras el mensaje no se haya enviado.

Un mensaje que has empezado no tiene por qué enviarse: **Guardar borrador** lo archiva en la carpeta de borradores de tu cuenta — donde cualquier programa de correo de ese buzón lo encontrará, no en un lugar exclusivo del teléfono. El servidor indica cuál es esa carpeta; solo cuando guarda silencio se adivina el nombre. En la lista, junto a la línea de la carpeta hay dos interruptores: **No leídos** reduce lo que está cargado en ese momento (así el contador y **Cargar más** siguen accesibles), mientras que **Marcados** le pide al servidor todos los mensajes marcados de la carpeta — incluidos los que están muy por debajo de la página cargada. En **Todas las bandejas de entrada** el interruptor de marcados falta a propósito: esa consulta nombra exactamente un buzón.

Desde un mensaje abierto hay tres caminos hacia la bóveda: **Guardar como nota**, **→ Tarea** en el menú ⋮ (crea una entrada en tu base de datos de tareas predeterminada — con su plantilla, su estado y la fecha del mensaje) y **+ .eml**, que además guarda el mensaje original y enlaza a él desde la nota. Los tres quedan anclados: capturar el mismo correo dos veces abre lo que ya existe. **Eliminar** vive ahora también en el menú ⋮ en lugar de junto a la flecha de retroceso; en la lista basta con deslizar. Mover a la papelera ofrece **Deshacer**, porque se puede revertir — eliminar definitivamente desde la papelera sigue preguntando, porque eso no se puede. Y en lugar de varios avisos apilados unos sobre otros, ahora hay **una** sola línea: el error; si no, las cuentas inalcanzables (a partir de dos, como número); si no, el aviso sobre la copia guardada.

Una nota se puede enviar desde su propio menú ⋮: **Enviar la nota por correo (mailto)** la entrega a la aplicación de correo del teléfono — Plainva no necesita cuenta propia para eso —, mientras que **Enviar por correo** abre el propio compositor de Plainva con asunto y texto.

## Importar de otra aplicación

En **Ajustes → Mantenimiento → Importar de otra aplicación** traes notas de otra aplicación a este dispositivo, con las mismas fuentes que en el escritorio.

Primero eliges dónde escribe: en una **subcarpeta** del vault abierto o en un **vault nuevo** en este dispositivo. El vault nuevo es la opción correcta cuando aquí todavía no hay nada; solo le pones un nombre, y deshacer toda la importación consiste en eliminarlo en **Más → Vaults**.

Las fuentes que necesitan acceso —Notion a través de su API— piden un token en el asistente. Vale para esa única ejecución y no se guarda.

Los detalles de cada fuente están en [Importar de otra aplicación](Import.md).

## Sincronización

Los **Ajustes** (en la parte inferior de **Notas**) llevan, a través de **Vault activo**, a la gestión de vaults; ahí conectas el almacenamiento en la nube (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Conectar una bóveda en la nube** trae al dispositivo un vault en la nube ya existente; **Crear un vault** pregunta primero **En este dispositivo** o **En un servicio en línea** y después por la estructura inicial (vacía o una plantilla como PARA) — en la ruta en línea sigue el proceso de conexión, la carpeta de destino en la nube se puede crear nueva ahí mismo mediante **Nueva carpeta** en la hoja de selección, y la estructura se sube en la primera sincronización. El primer inicio ofrece la misma elección entre un vault existente y uno nuevo en la nube («Conectar una bóveda en la nube»). Cada conexión obtiene su propia bóveda separada en el dispositivo. La página de la bóveda muestra el estado, el progreso, las transferencias pendientes y ofrece **Exportar el vault** (ZIP a través del menú para compartir).

La página de la bóveda está ordenada según para qué sirven sus controles: arriba, una **tarjeta de estado** responde a la única pregunta con la que se abre esta página — ¿está funcionando? (estado, última ejecución, transferencias pendientes e intervalo en una sola línea). Debajo, grupos con nombre — **Conexión**, **Contenido** — y al final, separada por su propio borde, la **Zona de peligro** con **Desconectar sincronización** y **Eliminar bóveda**. Antes había hasta nueve botones de aspecto idéntico en una sola fila, con **Restaurar archivos eliminados** justo al lado de **Eliminar bóveda**.

Bajo **Contenido**, junto a **Exportar el vault**, ahora también está la **copia de seguridad automática del vault**: un ZIP diario de toda la bóveda, del que se conservan las últimas **siete** (**Copias a conservar**); **Crear copia de seguridad ahora** genera una al instante. Los archivos se guardan en los documentos del dispositivo, no en la caché — algo que el sistema operativo puede vaciar en cualquier momento no es un archivo. Un teléfono no recibe una alarma en segundo plano: la comprobación ocurre al abrir la app y cada vez que se vuelve a ella, así que la copia se pone al día en lugar de ejecutarse a una hora fija. La línea bajo el interruptor indica, por eso, cuándo se ejecutó por última vez — así es como se hace visible una copia de seguridad que en silencio nunca llega a producirse. Hasta ahora, en el móvil solo existía la exportación manual, así que una bóveda de la que nadie se acordaba de exportar se quedaba sin ningún archivo.

La frecuencia con la que esta bóveda busca cambios remotos se ajusta en la misma página (**intervalo de sincronización**, mínimo 5 segundos); los guardados locales se suben de inmediato en cualquier caso. En Google Drive, OneDrive, Dropbox y S3 la **carpeta en la nube** también puede cambiarse después; en WebDAV la carpeta forma parte de la dirección del servidor, así que allí se vuelve a conectar. Si la sincronización de ajustes está cifrada, puedes activar además **Pedir la frase de contraseña en cada inicio**: la clave no se guarda en el dispositivo. Y **Seguridad y uso compartido** indica ahora abiertamente que los espacios cifrados son experimentales y no han sido auditados de forma independiente: guarda el archivo y el código de recuperación en un lugar seguro.

La página de la bóveda también indica si tu **configuración** te acompaña — como una tarjeta con un estado claro en lugar de un simple botón:

- **No se está sincronizando**: la sincronización de ajustes está desactivada para este vault. Actívala desde el escritorio.
- **Aún no cifrado**: esta bóveda todavía no tiene frase de contraseña de sincronización. Ahora puedes establecer una **en el teléfono**: el asistente muestra el código de recuperación y te pide que vuelvas a escribir dos grupos elegidos al azar antes de que se escriba absolutamente nada. Si ya existe una frase de contraseña en la nube, el teléfono te lo indica y nunca crea una segunda — eso dejaría fuera a todos los demás dispositivos.
- **Aún no desbloqueado en este dispositivo**: tu configuración está almacenada cifrada en la nube. Introduce la frase de contraseña elegida al configurarlo — en el escritorio o aquí, en el teléfono; este dispositivo la desbloquea una vez con ella.
- **Se está sincronizando**: este dispositivo está desbloqueado; las carpetas, las vistas y las reglas de copia de seguridad se mantienen al día con tus otros dispositivos.

Cada tarjeta también indica qué *no* viaja: los inicios de sesión siempre permanecen en el dispositivo (ver [Calendario y eventos](#calendario-y-eventos)).

**Ajustes** → **Seguridad y compartir** indica qué es realmente la conexión y, en un vault de nube normal, configura el espacio de trabajo cifrado directamente en el teléfono (identidad → archivo de recuperación y código → activación). Sin conexión de nube no hay nada que cifrar, y la sección lo dice.

Ambas configuraciones — el espacio de trabajo cifrado y la frase de contraseña de sincronización — ahora funcionan como **un flujo propio, sin barra de navegación**: mientras una de las dos está en marcha, solo hay una salida, y esta pregunta primero. Eso no es un adorno. Hasta el último paso, tu clave solo existe en la memoria, y salir la descarta; antes, un toque en la barra podía hacerlo sin decir nada. El último paso muestra una barra de progreso cuando hay algo que contar — el espacio de trabajo vuelve a cifrar cada archivo, mientras que la frase de contraseña de sincronización son dos escrituras, e inventar un porcentaje para esta última sería una mentira con forma de barra.

**Los recursos compartidos se gestionan ahora aquí**, no solo en el escritorio: en **Personas y permisos** invitas a un miembro con un rol (**Invitar** lo crea — su dispositivo lo vinculas después), creas un grupo y cambias el rol de un grupo directamente en su fila. En **Slices** creas un recurso compartido para una **Carpeta**. Deliberadamente no en el teléfono: los slices a partir de una selección libre o de una regla dinámica —ambos necesitarían superficies que aquí no existen.

## Red de seguridad

Los snapshots (historial de versiones), un diario de borradores (tras un fallo, la nota ofrece tu último estado sin guardar) y las copias en conflicto con una vista de comparación protegen tus datos. La retención se configura en **Ajustes** → **Copias de seguridad y versionado**.

**Si alguien cambia la misma nota en otro lugar** mientras escribes aquí, Plainva conserva tu versión como copia junto a ella y adopta la que ha llegado. Eso ahora está **en la nota** y permanece hasta que lo resuelvas: un aviso sobre el texto indica la ruta de la copia, la abre y muestra las **diferencias** si lo pides. Antes era un mensaje que desaparecía en segundos — y el guardado seguía reintentando, así que cada ronda escribía otra copia. Ahora se escribe exactamente una.

**Al eliminar una carpeta**, el diálogo indica cuántos archivos contiene — el número también aparece en el botón. Plainva crea antes un snapshot de cada archivo que hay dentro, que puedes recuperar en **Ajustes** → **Mantenimiento** → **Restaurar archivos eliminados**. También declara un límite abiertamente: **solo puede conservarse lo que este teléfono haya escrito al menos una vez.** Una nota que solo llegó por sincronización y nunca se editó aquí no existe en ningún snapshot. A diferencia del escritorio, un teléfono no tiene papelera del sistema operativo que lo recoja. Si la eliminación afecta a más de diez archivos, o a más de una quinta parte del vault, Plainva pregunta una segunda vez — exactamente igual que en el escritorio.

## Compartir y accesos directos

En Android e iOS, el texto y las URL compartidos se convierten en una nota nueva en la carpeta de entrada; las imágenes y los archivos compartidos se importan como adjuntos (hasta 25 MB por archivo). En Android, mantener pulsado el icono de la app ofrece además los accesos directos **Nueva nota** y **Hoy**.

## Carpetas, fotos y calendario

El botón flotante **Más** sigue disponible dentro de carpetas anidadas, y toda acción de creación rápida crea en la carpeta que tienes abierta — carpetas nuevas incluidas. El ⋮ del encabezado pertenece en cambio al objeto que está abierto: muestra las acciones de ese objeto, nunca los ajustes de la aplicación.

El botón de foto del editor ofrece **Hacer una foto** o **Elegir de la fototeca**, conserva la posición de inserción y muestra los errores de permisos o de archivo de forma visible. Las fotos van a la carpeta de adjuntos de la bóveda — la misma que usa tu ordenador.

Los eventos y las notas diarias están deliberadamente separados: **Calendario** muestra los calendarios conectados (ver [Calendario y eventos](#calendario-y-eventos)), **Hoy** muestra la nota diaria de un día elegido. No hay una vista mensual local de las notas diarias — de eso se encarga la franja en **Hoy**.

## Adjuntos e imágenes

Además de notas y bases de datos, el navegador muestra ahora los **adjuntos**: imágenes, PDF y cualquier otro archivo de la carpeta. Una imagen se abre dentro de Plainva; el resto se entrega al sistema, que sabe qué es un PDF y Plainva no. **Compartir** pasa un archivo a cualquier otra app.

El menú ⋮ de una nota incluye **Exportar como Markdown…**: entrega el archivo al panel de compartir del sistema, donde encuentras Imprimir, «Guardar en Archivos» y todos los editores instalados. **Compartir**, encima, envía solo el texto de la nota.

## Deslizar

**Desliza una fila hacia la izquierda** para revelar sus acciones: **Marcador** y **Eliminar** en una nota, **Cambiar nombre** y **Eliminar carpeta** en una carpeta, **Eliminar** en una base de datos y en el buzón. Son las mismas acciones que la fila ofrece en su menú (mantener pulsado) — el deslizamiento es solo el camino más corto hasta ahí, nunca el único. La primera vez, una franja encima de la lista te lo indica; la descartas con un toque, y aparece exactamente una vez por vault.

Eliminar pregunta mediante el mismo diálogo que en cualquier otro sitio. Mientras seleccionas varias filas, deslizar está desactivado — un gesto que apunta a exactamente una fila no tiene un significado claro junto a una selección que todavía estás formando. Con las **conversaciones** activadas en el buzón, deslizar sobre una conversación afecta a **toda** la conversación (en lugar de un deshacer, después te dice cuántos mensajes eran); un mensaje individual desplegado se desliza igualmente por su cuenta. Las filas de tarea no tienen acciones de deslizamiento — llevan sus controles visibles en la propia fila.

## En pantallas anchas

La app se adapta al ancho de la ventana, no al nombre del dispositivo:

- **por debajo de 600 px** — una superficie tras otra, como en el teléfono.
- **de 600 a 839 px** — la barra de navegación se convierte en una **barra lateral**; sigue siendo una sola superficie.
- **a partir de 840 px** — el navegador y la superficie de trabajo se colocan **uno junto al otro**. Es el mismo navegador que el área **Notas**, solo que junto a tu trabajo en lugar de delante de él.

**La barra lateral muestra todas las áreas.** En un teléfono, la barra inferior tiene de tres a cinco destinos — más de los que un pulgar alcanza con fiabilidad, por eso el resto vive detrás de **Áreas**. En el borde de una superficie ancha ese límite no se aplica: la lista **completa** está ahí en tu orden (**Ajustes → Barra de navegación**), el rodeo por **Áreas** desaparece, y **Ajustes** queda hasta abajo del todo. La barra lateral empieza debajo de la barra de estado — en una tableta con un recorte de cámara, su primer icono solía quedar debajo de él.

**El navegador se puede plegar.** Mientras buscas una nota, la columna izquierda le pertenece a ella; mientras escribes una, le pertenece a la nota. El icono en la parte inferior de la barra lateral — justo encima de **Ajustes** — lo pliega y lo despliega de nuevo, y entonces la superficie de trabajo ocupa todo el ancho. El interruptor solo aparece donde hay una segunda columna (a partir de 840 px), se aplica a este dispositivo y se mantiene como lo dejaste tras un reinicio. En el escritorio es el mismo gesto — allí se llama **Alternar barra lateral izquierda**.

En una tableta, o en un teléfono grande girado, obtienes el mismo modelo espacial que en el escritorio — navegar a la izquierda, trabajar en el medio — en lugar de un teléfono agrandado.


## Bases de datos en el calendario

Sobre las vistas del calendario hay una fila de chips: cualquier vista `.base` de tipo **calendario** o **línea de tiempo** que indique una columna de fecha puede mostrarse ahí. Las entradas mostradas aparecen entre las citas en las listas de día y agenda —con un **rombo y borde discontinuo**, para que una nota nunca parezca una cita—; en la rejilla mensual, como **punto hueco**. Un toque abre la nota.

**La selección pertenece al vault**, no al dispositivo: lo que muestres en el ordenador está aquí en cuanto se sincronicen los ajustes. En el teléfono se planifica desde la hoja de la entrada; arrastrar queda para el ordenador.

Al revés, la vista de calendario de una base de datos puede mostrar el **número de citas reales** del día en la esquina de la celda: ves frente a qué estás planificando.
