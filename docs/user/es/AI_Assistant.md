# Asistente de IA (Beta)

Última actualización: 2026-10-08

Plainva puede responder preguntas sobre tus notas con un modelo de IA de tu elección. Lee tu vault, cita las notas que usó, abre notas y vistas por ti y propone cambios — como sugerencias en una nota, como borradores de algo nuevo o como un plan que tú confirmas. Nunca cambia una nota por sí mismo. El asistente es **experimental** y está desactivado hasta que lo actives, por separado en cada dispositivo.

## Activar la IA

Abre **Configuración → IA y automatización** (la parte de la aplicación) y activa **Usar la IA en este dispositivo**. Sin el interruptor no hay botón de IA, ni pestaña de IA ni compañero. No se envía nada a ningún sitio hasta que preguntes algo.

## Elegir un proveedor

Plainva no trae su propio servicio de IA: usas un proveedor que tú eliges, con tu propia clave. Puedes elegir cualquier proveedor; Plainva indica sus condiciones y la conservación de datos para que decidas tú — no excluye ninguno.

| Tipo | Proveedores |
|---|---|
| Proveedores en la nube | Anthropic, OpenAI, Google Gemini |
| Intermediarios y servidores propios | OpenRouter, cualquier **Servidor compatible con OpenAI** |
| En este ordenador (escritorio) | Ollama, LM Studio |
| En este teléfono | Apple (iPhone), Gemini Nano (Android) |

1. En **IA y automatización**, elige **Añadir proveedor** y selecciona uno. Cada entrada lleva una breve nota sobre sus condiciones — por ejemplo, que el acceso gratuito de Google puede dejar que otras personas lean tus entradas.
2. Introduce la clave con **Introducir clave**. La clave va al almacén seguro de este dispositivo; Plainva no vuelve a mostrarla — ni a la IA ni en la pantalla.
3. **Probar conexión** carga la propia lista de modelos del proveedor. Si falla, el mensaje explica por qué (una clave rechazada, sin conexión, un modelo desconocido).

Un **Servidor compatible con OpenAI** se añade mediante su dirección. Plainva pregunta una vez más antes de añadirlo, en una ventana del sistema operativo, y solo envía a la dirección que confirmaste. El `http` sin cifrar solo funciona para un servidor en este dispositivo; todo lo demás necesita `https`.

Si todavía no tienes una clave: un modelo en este ordenador (Ollama, LM Studio) no cuesta nada, y la consola de cada proveedor emite claves.

**El modelo del sistema en el teléfono.** En un iPhone con Apple Intelligence (desde el iPhone 15 Pro), **Añadir proveedor** ofrece primero **Apple**; en algunos teléfonos Android, **Gemini Nano**. No necesita clave, no cuesta nada y nada sale del dispositivo, así que ningún resumen pregunta antes de enviar. Su ventana es pequeña, unos 4000 tokens para las notas, la pregunta y la respuesta juntas: van menos notas, los turnos anteriores se acortan y no usa herramientas. La fila indica si está listo y, si no, por qué: Apple Intelligence desactivado, un dispositivo que no puede ejecutarlo, un modelo que el sistema aún prepara; en Android, **Cargar modelo** pide al sistema que lo descargue. El modelo de Apple no habla todos los idiomas (no polaco). Si el perfil **Local** lo nombra, también escribe los resúmenes en el teléfono.

## Modelos y perfiles

Cuatro perfiles — **Rápido**, **Equilibrado**, **Potente** y **Local** — son tu asignación de modelos. Elige un proveedor y un modelo para cada uno, de la lista del proveedor o escribiendo el id del modelo exactamente como lo llama el proveedor. **Predeterminado para conversaciones nuevas** decide con qué perfil empieza una conversación nueva. Plainva no llama a ningún modelo «el mejor».

Un quinto espacio, **Audio**, guarda el modelo que transcribe las notas de voz; nunca es el predeterminado para una conversación.

Un sexto espacio, **Embeddings**, guarda el modelo con el que calcula la búsqueda por significado cuando eliges **Proveedor propio** en **Búsqueda semántica** — consulta [Búsqueda](Search.md).

## Preguntar

- **Escritorio:** el botón de IA en la barra de acciones, **Ctrl+J** (⌘J en macOS) o **Preguntar a la IA** en la paleta de comandos abre el compañero — una pequeña ventana sobre tu trabajo. **Abrir como pestaña** lleva esa misma conversación a la pestaña de IA, donde están listadas tus conversaciones.
- **Teléfono:** **Preguntar a la IA** en el menú ⋮ de una nota abre la hoja de IA sobre esa nota. El área **IA** (en la hoja de áreas, o en la barra de navegación si la colocas ahí) muestra la conversación a pantalla completa; **Conversaciones** enumera las anteriores.
- **Junto a la nota:** en el escritorio, la misma conversación es la última sección de la barra lateral derecha, **IA**. En un teléfono o una tableta es la pestaña **IA** del contexto de la nota —junto a **Propiedades** y **Retroenlaces**—, que una tableta muestra al lado de la nota.

La nota que tienes abierta se incluye automáticamente; quítala del contexto con su ✕ si quieres. **Fijar una nota…** añade más notas. El asistente también puede buscar por su cuenta: busca en el vault, lee notas y sus secciones, bases de datos, retroenlaces y notas enlazadas, enumera tareas, citas y las notas abiertas o cambiadas hace poco, y abre notas y vistas. Por sí mismo no puede cambiar, crear ni eliminar nada; lo que puede proponer en su lugar se describe más abajo, en «Proponer cambios».

El asistente también puede mostrarte cosas: abrir una nota en un encabezado, mostrar una nota en el grafo, llevar el calendario a un día, abrir vistas, mostrar y ocultar las barras laterales. Para ello usa los comandos de la paleta de comandos — y de ellos solo los que muestran algo: no puede activar los que crean, cambian, eliminan, exportan o abren una ventana.

Cada conversación empieza con la línea «Las respuestas las escribe una IA — ⟨modelo⟩ a través de ⟨proveedor⟩». Debajo de cada respuesta, una línea indica qué se envió adónde: cuántas notas, aproximadamente cuántos tokens y — donde el proveedor publica precios — el coste aproximado. **Detener** termina una respuesta en cualquier momento.

Un enlace en una respuesta se abre solo después de que confirmes su dirección, y las imágenes en las respuestas nunca se cargan.

## Lo que va con cada pregunta

Con cada pregunta, Plainva reúne lo que puede importar —en este dispositivo, antes de enviar nada—:

- **Dónde estás:** la fecha y la hora, la nota o la base de datos que tienes abierta y tu selección en ella, tus pestañas abiertas, las tareas que vencen en la próxima semana, las próximas citas y la nota diaria de hoy.
- **Notas que pueden importar:** encontradas a partir de tus palabras, de los enlaces de la nota abierta y de lo que abriste o cambiaste hace poco. Primero deciden tus reglas de privacidad; solo se evalúan las notas que ellas permiten. Unas pocas van como secciones —no como notas completas—, otras solo con su título y una ficha —la primera frase de su sección y cada frase con números, fechas, tareas, negaciones o enlaces, palabra por palabra— o solo con su nombre; el asistente lee más de ellas cuando lo necesita.

Una nota que la conversación ya lleva y que no ha cambiado desde entonces se nombra, no se envía de nuevo. Los lugares de tu diario y los valores de ánimo nunca se envían por sí solos.

## Antes de enviar nada

La primera solicitud de una sesión muestra un resumen: adónde va (proveedor y modelo), qué notas y qué parte de cada una, qué más va (tu selección, citas, tareas), qué se retuvo y aproximadamente cuántos tokens. **Enviar** lo envía; **Cancelar** no envía nada y te devuelve tus palabras al campo de entrada; el − junto a una nota la deja fuera. Dentro de lo que aprobaste, las siguientes solicitudes van sin preguntar. El resumen vuelve cada vez que el alcance crece: otro modelo u otro proveedor, un tipo de datos nuevo, notas de otra carpeta, herramientas nuevas o una solicitud mucho mayor. Un modelo en este dispositivo nunca pregunta.

Si quieres ver el resumen antes de cada solicitud, activa **Preguntar antes de cada solicitud**, en el propio resumen o en **Configuración → IA y automatización**, en **Envío**.

La línea bajo cada respuesta abre el resumen de lo que se envió con ella. Si una respuesta no cita ninguna de las notas enviadas, un aviso encima de esa línea lo dice; compruébala entonces con las notas. Si se enviaron notas, la línea indica también la cobertura: **cobertura alta** cuando casi cada afirmación de la respuesta nombra una nota, **cobertura parcial** o **cobertura baja** cuando son menos.

## Ver contexto

El ojo bajo el campo de entrada, **Ver contexto**, muestra lo que llevaría la próxima solicitud, antes de que salga, para el modelo elegido ahora. Para cada nota: por qué se eligió (abierta ahora, fijada, coincide con tus palabras, cercano en significado, enlazada, vence pronto…), qué parte va y aproximadamente cuántos tokens. Cada nota puedes

- dejarla fuera de la próxima solicitud (**Volver a incluir** la recupera),
- fijarla a la conversación,
- mantenerla en este dispositivo para siempre: eso escribe la regla `cloud: deny` en la nota (ver más abajo).

Las notas que tus reglas retienen también aparecen, para que sepas qué falta; nunca se evalúan ni se envían. **Enviar con este contexto** envía lo que escribiste. En una pestaña de IA ancha, la vista queda abierta como una columna junto a la conversación.

Encima de las notas, **Enviado** indica cuánto de estas notas va —por ejemplo ~870 de 3.460 tokens— y **Ahorrado** cuánto menos es que enviar enteras todas las notas propuestas; la primera vez también indica cuántos tokens habrían sido. **Mostrar como rastro en el grafo** abre el grafo con la nota abierta y las fuentes marcadas, y los enlaces entre ellas.

Cuando el texto que iría a una nube parece contener una contraseña o clave, un número de cuenta o de tarjeta, un número de identidad o fiscal, o datos de salud, una línea bajo la nota indica **Posiblemente sensible** y lo que se detectó —en **Ver contexto** y en el resumen antes de enviar—. **Mantener en este dispositivo** escribe la regla `cloud: deny` en la nota. Para números y secretos, **Ocultar en esta conversación** los sustituye por un marcador como `⟦withheld account⟧` en cada mensaje de esta conversación, también cuando el modelo lee la nota por sí mismo, hasta que elijas **Enviar sin ocultar**; el resumen los cuenta en **Retenido**. Las tareas y las citas tienen la misma opción en la línea **Tareas, citas y datos de la nota abierta**. La primera vez en una sesión que algo de ese tipo iría sin ocultar, el resumen pregunta antes de enviar. La comprobación se hace en este dispositivo; es una indicación, no un filtro: puede pasar cosas por alto y nunca detiene una solicitud. Un pasaje seleccionado va tal cual; con un modelo en este dispositivo no aparece ninguna indicación.

## Resúmenes

Con **Resúmenes con el modelo local** (en **Configuración → IA y automatización**, desactivado hasta que lo actives), un modelo en tu ordenador escribe resúmenes breves de las secciones largas de tus notas, de notas completas, de las carpetas de primer nivel y del vault. Solo funciona cuando el perfil **Local** nombra un servidor en este ordenador (Ollama, LM Studio; en el teléfono, el modelo del sistema) —nunca una nube en segundo plano— y solo mientras Plainva está inactivo; en el teléfono, solo mientras está abierto. Cada resumen se comprueba: el resumen de una sección debe conservar palabra por palabra cada número, fecha, importe, enlace, etiqueta y cada negación; si no, se envían las frases de la propia sección. Un resumen está ligado al texto exacto que representa; si cambias la sección, no se usa hasta que se vuelve a escribir. Los resúmenes de carpetas y del vault solo se escriben a partir de notas que tus reglas dejan ir a una nube. En **Ver contexto**, una fuente enviada como resumen lo indica, y **Original** envía sus propias frases con el siguiente mensaje.

## Con una selección

Selecciona texto en una nota y la IA trabaja solo con ese fragmento.

- **Escritorio:** mientras editas, **IA** en la barra de selección ofrece **Como sugerencia** — **Reescribir**, **Acortar**, **Traducir…**, **Convertir en tareas** — y **En el compañero** — **Explicar** y **Preguntar sobre la selección…** (**Ctrl+J**, ⌘J en macOS).
- **Teléfono:** **IA** en la barra sobre una selección — al leer como al editar — abre la hoja de IA.
- **En cada conversación:** mientras haya texto seleccionado en la nota abierta, la fila **Con la selección** sobre la entrada ofrece las mismas acciones.

Una acción de sugerencia envía solo el fragmento seleccionado — no el resto de la nota, ni notas fijadas, ni herramientas — y pregunta con el mismo resumen que una pregunta. La respuesta vuelve a la nota como una ronda de sugerencias, igual que la de una persona: en **Sugerencias** aceptas o rechazas cada cambio o la ronda entera, y nada cambia en la nota antes de que lo hagas. La línea de autor de la ronda dice **Plainva IA · ⟨modelo⟩**, para que siempre se vea qué fragmento escribió una IA. **Convertir en tareas** añade las tareas debajo del fragmento en lugar de reemplazarlo. Cada acción conserva su conversación en el historial.

Un fragmento de una nota que tus reglas mantienen fuera de la nube — o uno con enlaces a esas notas o con datos de lugar — no va a ningún modelo en la nube. En un espacio cifrado las acciones de sugerencia aún no están disponibles: sus sugerencias todavía no pueden indicar a la IA como autora.

## En un hilo de comentarios

Dirígete al asistente en un comentario y responde en el hilo. Escribe una **@** en el campo de comentario y elige **IA** — la entrada con el símbolo de la IA — o escribe el nombre tú mismo: **@IA**, **@AI** y **@KI** llegan todos a él, sea cual sea el idioma de la app. En cuanto se envía tu comentario, el hilo muestra bajo **IA** la línea **está escribiendo una respuesta…**; **Detener** lo interrumpe. La respuesta aparece como respuesta en el mismo hilo, con la línea de autor **Plainva IA · ⟨modelo⟩**. A diferencia de una sugerencia, no espera a ser aceptada — es una anotación junto a la nota, nunca texto dentro de ella — y en el dispositivo que preguntó la eliminas como una tuya.

El hilo va al modelo como una pregunta: sus comentarios, el pasaje al que está anclado y la propia nota, a través del mismo resumen. Un hilo de comentarios es un tipo de datos propio, por eso el resumen pregunta la primera vez. Donde tus reglas mantienen la nota lejos de la nube, sus comentarios tampoco van allí, y los enlaces que contienen a esas notas se retienen. Solo un comentario que envías en este dispositivo llama al asistente; uno que llega por la sincronización nunca lo hace, diga lo que diga. Las direcciones web que la IA aporta por su cuenta — en una respuesta, una sugerencia o una transcripción — se escriben de modo que nada las abra ni las cargue (`https[://]…`); las direcciones que tu propio texto ya contenía se quedan como están. En un espacio cifrado todavía no se puede hablar al asistente: sus comentarios aún no pueden indicar a la IA como autora.

## Habilidades

Las habilidades son instrucciones para trabajo recurrente. Doce vienen con Plainva —entre ellas **Orientación del día**, **Repaso semanal** y **Estado del proyecto** como chips en una conversación vacía— y puedes escribir o importar las tuyas. Inicia una con un clic o simplemente pregunta: la IA carga por sí misma una habilidad que encaje. Tus propias habilidades solo se ejecutan después de que las apruebes en este dispositivo. Todo sobre ellas: [Habilidades](AI_Skills.md).

Los scripts son programas pequeños que escribes para lo que un modelo hace mal —contar, ordenar, sumar—. Se ejecutan en un entorno aislado, leen tu vault con las mismas herramientas que la IA y solo lo hacen después de que los apruebes en este dispositivo. Todo sobre ellos: [Scripts](AI_Scripts.md).

## Transcribir una nota de voz

En cada nota de voz —en el editor, en el modo de lectura, en el diario y en las tarjetas— **Transcribir** convierte la grabación en texto. Va tal cual al modelo del perfil **Audio**, a través del mismo resumen que una pregunta; una grabación es un tipo de datos propio, por eso el resumen pregunta la primera vez. La transcripción vuelve como sugerencia debajo de la grabación, con el autor **Plainva IA · ⟨modelo⟩**: acéptala o recházala en **Sugerencias**.

**Audio** necesita un proveedor con ruta de audio: OpenAI (por ejemplo `gpt-4o-transcribe` o `whisper-1`), Gemini o un servidor compatible propio; uno en este equipo mantiene la grabación en el dispositivo. Se pueden transcribir grabaciones de hasta 11 MB. Una grabación en una nota que tus reglas mantienen fuera de la nube no va a ningún modelo en la nube, y los espacios cifrados aún no lo ofrecen.

## Explicar una imagen

En cada imagen del vault, **Explicar imagen** pregunta a la IA qué muestra la imagen.

- **Escritorio:** en la barra de herramientas de una imagen abierta y en el menú que abre un clic derecho sobre una imagen en una nota — al editar y en el modo de lectura.
- **Teléfono:** debajo de una imagen abierta (en una imagen de una nota, **Abrir imagen** te lleva hasta allí).

La imagen va, con la pregunta, al modelo con el que empiezan las conversaciones nuevas — en una conversación propia, donde puedes seguir preguntando: qué dice una tabla, qué hay en la segunda columna, qué significa un diagrama. El resumen muestra la imagen antes de enviarla; una imagen es un tipo de datos propio, por eso el resumen pregunta la primera vez.

**Lo que se envía no es el archivo.** Plainva dibuja la imagen, la reduce a un máximo de 1.568 píxeles en su lado más largo y la guarda de nuevo para enviarla. Así se envía sin lo que el archivo registra sobre ella: el lugar donde se tomó una foto, la fecha, la cámara. El resumen muestra exactamente la imagen que se envía, con su tamaño. Esa copia se queda con la conversación en este dispositivo, así que más tarde aún puedes ver lo que recibió el proveedor; si eliminas la conversación, desaparece.

**Reglas.** Una imagen en una carpeta que tus reglas mantienen fuera de la nube no va a ningún modelo en la nube. Tampoco una imagen que se muestra en una nota con la regla `cloud: deny` — da igual dónde pulses **Explicar imagen**, también en la imagen abierta: antes de enviar, Plainva busca qué notas incrustan la imagen y, si no puede averiguarlo, la imagen se queda en este dispositivo. Un modelo en este dispositivo sigue permitido. Lo que está escrito en una imagen es contenido, como el texto de una nota, nunca una instrucción: la conversación de **Explicar imagen** puede buscar en tu vault, pero no puede usar Internet y no activa nada en la aplicación.

**Qué modelos leen imágenes.** La mayoría de los modelos en la nube, sí. El modelo del sistema en el teléfono no, y **Explicar imagen** lo indica. Cuando la lista de un proveedor dice que un modelo no lee imágenes, el resumen te lo dice antes de enviar. Si un proveedor rechaza la solicitud, elige otro modelo debajo de la conversación y vuelve a preguntar — la imagen sigue en ella.

## En Internet

El asistente no puede usar Internet hasta que lo permitas — tres veces:

1. **Para el vault.** En **Configuración → IA y automatización** (la parte del vault), activa **La IA puede usar Internet en este vault**. Está desactivado en todos los vaults hasta que decidas, y se aplica solo en este dispositivo.
2. **Para una conversación.** Antes del primer mensaje de una conversación nueva, pulsa el globo terráqueo bajo el campo de entrada — **Dejar que esta conversación use Internet**. Que una conversación pueda usar Internet se decide cuando empieza; para cambiarlo, empieza una conversación nueva. Una conversación que puede usarlo lo dice en su primera línea. Iniciar la habilidad **Investigación** es la misma elección: su conversación puede usar Internet — ver [Habilidades](AI_Skills.md).
3. **Para cada solicitud.** Mientras tus notas estén en la conversación, cada página que el asistente quiere leer y cada búsqueda que quiere hacer preguntan antes, con la dirección completa o las palabras de búsqueda — es todo lo que sale de tu dispositivo para ello. **Leer página** o **Buscar** deja pasar esta única solicitud; **No leer** o **No buscar** la omite, y el asistente sigue sin ella.

**Qué es una solicitud.** Leer una página es una solicitud de este dispositivo al sitio, como abrir la página en un navegador — sin cookies, sin inicio de sesión y sin nada de tus notas; como en cualquier visita, el sitio ve tu dirección IP. Solo se leen páginas públicas mediante `https`; las direcciones de tu red doméstica o de empresa se rechazan. Una búsqueda va al proveedor de tu modelo — Anthropic, OpenAI, Google Gemini u OpenRouter —, que busca exactamente con las palabras que se te mostraron; los proveedores pueden cobrar las búsquedas por separado. Un modelo en este dispositivo puede leer páginas pero no puede buscar, y el modelo del sistema en el teléfono no puede usar Internet en absoluto.

**De dónde viene una dirección.** La pregunta dice si nombraste tú la dirección, si la nombró una nota o un resultado — o si el modelo la compuso por sí mismo. Una dirección que compuso el modelo podría llevar algo de tus notas: léela antes de dejarla pasar.

**Sitios sin confirmación.** Con **Siempre para ⟨sitio⟩** en una pregunta, o en **Sitios sin confirmación** en la configuración del vault, las páginas de un sitio se leen sin preguntar — siempre que la dirección haya sido nombrada por ti, por una nota o por un resultado. Una dirección compuesta por el modelo siempre pregunta.

**Lo que lee el asistente.** Nunca la página en sí. Una segunda solicitud al mismo modelo, una que no tiene herramientas, lee la página y escribe un informe breve: un resumen, afirmaciones con el pasaje en el que se basan y enlaces que realmente están en la página. Una página que intenta dar instrucciones al asistente le llega, por tanto, como un informe sobre una página — nunca como una página con la que trabaja. Bajo la respuesta, **Leído en la web** enumera las páginas que se leyeron, y la línea de debajo abre todo lo que se solicitó.

**Notas que se quedan fuera.** Una nota o carpeta con **Acceso web: nunca** (ver Reglas de privacidad más abajo) no existe para una conversación que puede usar Internet: ni en su contexto, ni para sus herramientas, y los enlaces hacia ella se retienen.

Un enlace en una respuesta cuya dirección compuso el propio modelo está marcado, y la pregunta antes de abrirlo lo dice. Si no llega ninguna respuesta — sin conexión, el proveedor no responde —, la conversación enumera en su lugar las notas que mejor encajan con tu pregunta.

## Correo y citas

**Citas.** El asistente enumera las citas de tus calendarios conectados — día, hora y título, si lo pides también el lugar y quiénes participan — y lee una cita concreta en detalle: el organizador, los asistentes con sus respuestas y la tuya. Nunca recibe el enlace de una reunión en línea; ese se queda en el calendario.

**Correo.** Si hay cuentas de correo conectadas en este vault, el asistente puede buscar y leer mensajes. El correo no es una de las herramientas con las que empieza una conversación: el asistente lo busca solo cuando tu pregunta lo necesita, y en el primer acceso Plainva pregunta — **¿Leer tu correo?** **Permitir** vale para este proveedor hasta que cierres Plainva; otro modelo u otro proveedor vuelve a preguntar. **No permitir** deja el acceso fuera, y el asistente continúa sin él. Un modelo en este dispositivo no pregunta, porque para él no sale nada del dispositivo.

**Lo que el asistente lee del correo.** De una búsqueda ve la fecha, el remitente y el asunto de los mensajes — nunca su texto. El texto de un mensaje y la descripción de una cita no los lee nunca por sí mismo: los escribieron otras personas, y quien escribe un correo o una invitación puede escribirlo justo para este lector. Un segundo lector sin ninguna herramienta los lee y escribe un informe breve — un resumen, afirmaciones con el pasaje en el que se basan y enlaces que realmente están ahí. Si un modelo de este dispositivo está configurado como **Local** en **Modelos y perfiles**, ese modelo es el lector, y el texto en sí no sale del dispositivo; al proveedor solo va el informe. En caso contrario, lo lee el proveedor de la conversación, en una solicitud aparte y sin herramientas. La pregunta te dice de antemano quién lee.

**Lo que no cambia.** El asistente solo lee: un mensaje que ha leído sigue sin leer, no mueve, responde ni elimina nada, y no abre archivos adjuntos — solo los nombra. Bajo la respuesta ves cuántos mensajes se leyeron, y la línea de debajo dice quién leyó el texto. Un correo o una cita que escriba para ti es siempre solo un borrador que envías o guardas tú — consulta **Proponer cambios** más abajo.

## Herramientas externas (MCP)

El asistente puede usar herramientas de servidores que conectas tú mismo, mediante el Model Context Protocol (MCP) — un sistema de tickets, un wiki, una base de datos de tu equipo. Es el sentido contrario de [Conectar apps de IA](Connect_AI_Apps.md): allí, otras apps leen tu vault a través de Plainva; aquí, el asistente de Plainva pregunta a otros servidores. No se usa nada de un servidor antes de que hayas mirado lo que ofrece, y cada llamada se te muestra antes de que salga.

**Añadir un servidor.** En **Configuración → IA y automatización** (la parte del vault), bajo **Herramientas externas (MCP)**, elige **Añadir un servidor…**. Dale un nombre tuyo y su dirección (`https://…`), y un token de acceso si el servidor lo pide — va al almacén seguro de este dispositivo y no vuelve a mostrarse. En el escritorio, un servidor también puede ser un **Programa en este ordenador**: el archivo que se inicia, sus argumentos y los valores para su entorno. Plainva lo inicia directamente, sin shell, y en un entorno aislado cuando tu ordenador tiene uno que Plainva pueda usar. Tu sistema muestra la dirección o el comando completo una vez más antes de que se recuerde. En el teléfono, un servidor es siempre una dirección.

**Iniciar sesión.** Algunos servidores piden iniciar sesión en lugar de un token. Su revisión dice entonces **El servidor pide iniciar sesión.** Elige **Iniciar sesión…**: Plainva pregunta al servidor dónde está su inicio de sesión, abre esa página en tu navegador y espera a que vuelvas. Lo que recibe queda en el almacén seguro de este dispositivo y solo va a este servidor; ni tú ni la IA lo veis nunca. Se renueva sin ti mientras el servidor lo permita y, cuando ha terminado, la revisión te pide que inicies sesión de nuevo. Si el servicio de inicio de sesión no deja que las aplicaciones se registren por sí mismas, Plainva pide el **ID de cliente** que te dio el responsable del servidor. **Cerrar sesión** olvida el inicio de sesión; un inicio de sesión y un token de acceso guardado se sustituyen entre sí.

**Revisarlo.** Un servidor recién añadido todavía no ofrece nada. Su revisión muestra lo que está registrado y lo que el servidor enumera: su propia descripción, sus herramientas con sus descripciones — palabras del propio servidor — y sus prompts. **Aprobar** permite exactamente estos textos, en este dispositivo. Antes de usar un servidor, Plainva vuelve a cargar lo que enumera y lo compara con lo que aprobaste; si algo difiere, el servidor queda bloqueado hasta que vuelvas a mirarlo, y la revisión dice qué cambió.

**Lo que permite un vault.** Cada vault decide por sí mismo: si usa el servidor (**Usar ⟨servidor⟩ en este vault**), cuáles de sus herramientas puede llamar el asistente — ninguna está marcada —, y bajo **Notas que pueden acompañar a una llamada**, si **Ninguna**, **Carpetas elegidas** o **Todo el vault**. También se puede marcar una herramienta que no dice que solo lee; su fila indica lo que una llamada puede hacer entonces en el servidor: cambiar algo, o cambiar, sobrescribir o eliminar algo. Una marca vale para lo que la herramienta decía cuando la pusiste: si más tarde dice que puede hacer más, no vuelve a ofrecerse hasta que la marques de nuevo.

**En una conversación.** Las herramientas de tus servidores no están entre las herramientas con las que empieza una conversación: el asistente las busca solo cuando tu pregunta las necesita, y el resumen previo al envío nombra los servidores a los que pertenecen. Cada llamada pregunta antes — **¿Llamar a ⟨servidor⟩?** — con la herramienta y exactamente lo que se enviaría. **Llamar** deja pasar esta única llamada, **No llamar** la omite, y no existe un «siempre». Una herramienta que puede cambiar algo pregunta con otras palabras — **¿Dejar que ⟨servidor⟩ cambie algo?** —, añade que Plainva no puede deshacerlo, y su botón dice **Ejecutar**. Una llamada no sale en absoluto si la conversación ha leído una nota que queda fuera de lo que el vault permite a este servidor, o una que mantienes fuera de la nube. Lo que vuelve se trata como el texto de un desconocido: el asistente lo lee y no acepta instrucciones de él.

**Prompts.** Un servidor puede ofrecer prompts — solicitudes ya preparadas. Están bajo una conversación vacía, y solo tú los inicias. La primera vez, Plainva muestra en qué se convierte un prompt antes de que se envíe como tu mensaje; desde entonces, exactamente ese texto sale sin preguntar, y otro texto bloquea el servidor.

**Lo que Plainva conserva.** La dirección o el comando se recuerda en este dispositivo, los valores guardados en su almacén seguro; tu aprobación está en los datos de Plainva, nunca en el vault — así, quien pueda escribir en el vault no puede aprobar un servidor. Bajo **Llamadas recientes en este vault**, la revisión indica cuándo se llamó a una herramienta, a cuál y cómo terminó — nunca lo que se dijo. **Quitar servidor** elimina el servidor de este dispositivo, para todos los vaults.

Una conversación iniciada por una habilidad, una acción sobre una selección y una respuesta en un hilo de comentarios no llegan a las herramientas externas, y tampoco el modelo del sistema en el teléfono.

## Agentes externos

En el escritorio, Plainva también puede iniciar un agente de IA de otro fabricante en la carpeta del vault — un programa que instalaste y en el que iniciaste sesión tú mismo. Un agente así no es el asistente: lee y envía por su cuenta, y tus reglas de privacidad y el resumen previo al envío no lo alcanzan. Qué controla Plainva en su sesión y qué no: [Agentes externos](External_Agents.md).

## Proponer cambios

El asistente puede proponer algo más que una respuesta, y nada de lo que propone está en tu vault hasta que tú lo digas. Hay tres formas, y cada una espera allí donde decides sobre ella.

- **Una sugerencia en una nota.** Si pides un cambio en una nota que ya existe, el asistente lo deja en la nota como sugerencias: en el margen, firmadas «Plainva IA · ⟨modelo⟩», cada cambio para aceptarlo o rechazarlo por separado — como las sugerencias de una persona, consulta [Comentarios y sugerencias](Comments_and_Suggestions.md). Al aceptar, antes se guarda la nota tal como estaba como una versión: el historial de versiones siempre tiene el camino de vuelta. Bajo la respuesta, una línea nombra la nota; al pulsarla se abre. Un valor para una propiedad de la nota se propone del mismo modo: la tarjeta muestra la propiedad con lo que dice ahora tachado y lo que diría, y marca como nueva una propiedad que la nota aún no tiene. Si la propiedad dice otra cosa cuando decides, la tarjeta indica que la sugerencia ya no encaja. El asistente no puede proponer quién creó una nota ni quién responde de ella (consulta [OKF](OKF.md)), ni tampoco las propiedades que Plainva lleva para sí. En una base de datos, un valor propuesto para una entrada aparece además en la celda de esa entrada, donde lo aceptas o lo rechazas sin abrir la nota — consulta [Bases de datos (.base)](Databases_Base.md).
- **Un borrador.** Una nota nueva, una tarea o una entrada de diario queda como borrador: una tarjeta bajo la respuesta dice en qué se convertiría y adónde iría. **Crear** lo hace — la nota en la carpeta que nombra la tarjeta (la **Carpeta de entrada**, si el asistente no nombró otra), la tarea leída de sus palabras como si las hubieras escrito en el campo de captura, la entrada en el diario del día que figura en la tarjeta. **Mostrar** despliega antes el texto de una nota; **Descartar** tira el borrador. Una nota creada a partir de un borrador dice quién la escribió (`generated`, consulta [OKF](OKF.md)) y nombra las notas en las que se apoyó la conversación. Donde tus tareas nuevas van también a una lista de tareas de tu proveedor, la tarjeta de una tarea lleva el interruptor del campo de captura, **Crear también en «…»**: está activado, y la tarea se crea también allí salvo que lo desactives. Una entrada de una base de datos se redacta del mismo modo: su tarjeta nombra la base de datos y las propiedades que tendría la entrada, y **Crear** la escribe como nota en la carpeta donde esa base de datos guarda sus entradas — con esas propiedades y con todo lo que allí convierte una nota en entrada. Una base de datos que aún no tiene carpeta de almacenamiento para nuevas entradas solo acepta un borrador así cuando tú mismo hayas creado su primera entrada.
- **Un plan.** Renombrar, mover o eliminar una nota no se puede revisar parte por parte, así que el asistente pregunta: una pregunta sobre el campo de entrada muestra qué ocurriría — el nombre nuevo y cuántos enlaces en cuántas notas lo siguen, o la carpeta de destino, con un aviso si la nota perdiera así una regla de privacidad de su carpeta. Tras tu sí, Plainva lo hace como cuando lo haces tú; el asistente solo sabe si se hizo. Para eliminar, la pregunta únicamente abre el diálogo de eliminación de Plainva: nada desaparece antes de que confirmes allí. Una de las reglas de privacidad propias de una nota se pregunta del mismo modo y nunca se deja como sugerencia: la pregunta nombra la regla y si se escribiría en la nota o se quitaría de ella, con una advertencia si después la nota pudiera volver a ir a modelos en la nube o a conversaciones con Internet. Tras tu sí, Plainva la escribe; la regla vale desde entonces y no deshace lo que una conversación ya haya enviado.

**Un correo y una cita.** Donde en este vault hay conectada una cuenta de correo o un calendario que admite citas, el asistente también puede redactar un correo o una cita. No envía ni guarda ninguno de los dos. La tarjeta nombra a todos los destinatarios — **Para**, **Cc** y **Cco**, o los **Asistentes** — y señala cada dirección que no escribiste tú en esta conversación: el asistente puede tenerla de una nota, de un correo o de una página web, así que compruébala. **Abrir en Correo** abre el correo como mensaje nuevo con todo ya rellenado, **Abrir en Calendario** abre la cita en el editor de eventos del calendario; allí cambias lo que quieras, y **Enviar** o **Guardar** es tu propio paso. Los asistentes reciben una invitación de tu proveedor de calendario al guardar, como con cualquier cita que anotas tú. El borrador se queda en la lista hasta que el correo ha salido de verdad o el calendario ha aceptado la cita: cerrar el mensaje, deshacer un envío en sus pocos segundos o un calendario que rechaza lo dejan donde estaba. Un correo que guardas con **Guardar borrador** queda desde entonces en los borradores de tu buzón y también sale de la lista; en el escritorio ocurre lo mismo con un mensaje que mueves a una ventana propia.

En una base de datos el asistente también trabaja sin conversación: **Rellenar «…» con IA…** lee la nota de cada entrada que no tiene valor en una columna y sugiere uno para cada una, y en los ajustes de filtro una frase se convierte en reglas de filtro que ves antes de que se apliquen. Antes de enviar nada, el resumen muestra como siempre lo que sale: en una columna, las notas de esas entradas, cada una en su propia solicitud; en un filtro, solo las columnas de la base de datos con sus nombres, tipos y opciones, y tu frase, nunca una entrada. Ambas cosas se describen en [Bases de datos (.base)](Databases_Base.md).

Todo lo que espera está en una lista: **Pendiente**, un segmento de la pestaña de IA en el escritorio y de **Conversaciones** en el teléfono. Nombra las notas que llevan sugerencias de una IA y los borradores de este dispositivo, cada uno con quién lo dejó. Los borradores se guardan en el dispositivo en el que se hicieron, como las conversaciones; las sugerencias pertenecen a los comentarios de la nota y llegan con ellos a tus otros dispositivos.

Tres límites valen pida lo que se le pida al asistente. Una dirección web que traiga a una sugerencia o a un borrador se escribe de modo que nada la abra ni la cargue (`https[://]…`); una dirección que tú mismo escribiste se queda como está. Una conversación que ha leído una nota que se mantiene fuera de la nube o de Internet deja una sugerencia, una tarea o una entrada de diario solo donde vale la misma regla — una nota o una entrada de base de datos en borrador se lleva la regla consigo, y un correo o una cita no se redactan en absoluto. Y en un espacio cifrado no se propone, redacta ni planifica nada.

Al asistente se le pide que nombre una nota como enlace, así que un enlace es la única afirmación de su texto que Plainva puede comprobar: si una sugerencia o un borrador enlaza una nota que tu vault no tiene, lo dicen la línea bajo la respuesta y la tarjeta del borrador — **Enlazado, pero no está en este vault:** y los nombres. No se retiene nada por ello; quizá quieras primero el enlace y después la nota. Un enlace a una nota que sí está en tu vault pero que la IA no puede leer aquí — una regla de privacidad la mantiene fuera de la conversación — recibe su propia línea: **Enlaza a notas que la IA no puede leer aquí:** y los nombres. A la propia IA se le dice lo mismo en ambos casos, así que no puede averiguar un nombre probándolo. Plainva no comprueba si una afirmación es cierta.

Una habilidad tiene estas capacidades solo cuando las nombra, y su revisión lo dice — consulta [Habilidades](AI_Skills.md).

## Conservar una respuesta como nota

Bajo cada respuesta terminada, **Conservar como nota** convierte la respuesta en una nota de tu vault. Tú lo pulsas y Plainva escribe la nota — el asistente en sí sigue sin cambiar nada.

- **Adónde va.** A la **Carpeta de entrada** del vault (**Configuración → Contenido y estructura**), con un nombre tomado de tu pregunta — en una conversación iniciada por una habilidad, de la habilidad y de la nota que estaba abierta, o del día. Una nota que ya está allí nunca se toca: la nueva recibe el siguiente nombre libre. Plainva la abre enseguida.
- **Quién la escribió.** La primera línea lo dice con palabras — una respuesta de Plainva IA, con el modelo, la hora y tu pregunta. Las propiedades de la nota dicen lo mismo para otras herramientas: `generated`, con el modelo y la hora. Nada marca la nota como revisada; eso sigue siendo cosa tuya — ver [OKF](OKF.md).
- **En qué se basa.** Bajo la respuesta, **Fuentes** enumera lo que la ejecución usó de verdad. Plainva escribe esta lista a partir de su propio registro, no el modelo: las páginas que se leyeron y cuándo, las búsquedas y a través de qué proveedor, y tus notas que iban incluidas o se leyeron. Las propiedades llevan la misma lista como `sources`.
- **Direcciones.** Cada dirección web que el modelo escribió en su respuesta se escribe de modo que nada la abra ni la cargue (`https[://]…`), y una imagen de la web nunca es una imagen en la nota. Solo las páginas bajo **Fuentes** son enlaces reales: direcciones que la ejecución leyó con tu permiso. Los enlaces a tus propias notas siguen siendo enlaces.
- **Reglas.** Una respuesta conservada hereda las reglas de privacidad de aquello en lo que se basa. Si una nota que estaba en la conversación, o una que el asistente leyó, se mantiene fuera de la nube o de Internet, la nueva nota lleva la misma regla — escrita en la propia nota donde su carpeta permitiría más. Así, una respuesta que un modelo en este dispositivo hizo a partir de una nota privada tampoco llega a una nube como nota.

En un espacio de trabajo compartido, sus miembros pueden leer una nota — y también los lectores de una publicación que abarque la carpeta. Allí Plainva pregunta cada vez, con el nombre de la nota y la carpeta: **Conservar como nota** la escribe, **No conservar** no escribe nada.

## Reglas de privacidad

Algunas notas nunca deben llegar a un proveedor en la nube. Una regla puede ir en el frontmatter de una nota:

```yaml
plainva:
  ai:
    cloud: deny
```

o, para toda una carpeta, en **Configuración → IA y automatización** (la parte del vault), que escribe las reglas en `.agent/policy.yml`. Una nota que se mantiene fuera de la nube no aporta nada — ni texto ni título —, y los enlaces hacia ella en otras notas se retienen. Esto vale escriba como escriba el enlace la nota — por el nombre de su archivo, por su título o por una ruta —; y si dos notas comparten nombre y una de ellas se mantiene fuera, también se retiene un enlace con solo ese nombre. Escribe la carpeta en el enlace para nombrar la que quieres decir. Los modelos en este dispositivo siguen permitidos. Los espacios cifrados mantienen la nube desactivada, salvo que la permitas allí. El formato exacto está en la [Referencia del formato de archivo](File_Format_Reference.md).

Una imagen pertenece a las notas que la muestran: la que está incrustada en una nota mantenida fuera de la nube tampoco va a ningún modelo en la nube (ver Explicar una imagen más arriba).

Una segunda regla, `web: deny` — **Acceso web: nunca** en la configuración —, mantiene una nota o una carpeta fuera de toda conversación que pueda usar Internet.

En un iPhone o iPad, las mismas dos reglas deciden qué títulos de notas pueden encontrar Siri y Atajos, una vez que lo has activado: una nota mantenida fuera de la nube o del acceso web nunca se les nombra. Consulta «Siri y Atajos» en [La aplicación móvil](Mobile_App.md).

## Historial y uso

Las conversaciones se quedan en este dispositivo, por vault — nunca en el vault ni sincronizadas. **Conservar conversaciones** decide durante cuánto tiempo; puedes eliminar conversaciones sueltas en la lista, o todas las de un vault a la vez. **Uso este mes** suma los tokens por proveedor y modelo.

## Límites de la beta

- En el escritorio, la IA solo se ejecuta en la ventana principal.
- En el teléfono, una respuesta solo llega mientras la aplicación está abierta.
- El asistente no cambia ninguna nota por sí mismo: un cambio en una nota y la transcripción de una nota de voz son sugerencias que aceptas o rechazas, lo nuevo es un borrador hasta que pulsas **Crear**, un correo o una cita un borrador hasta que tú mismo envías o guardas, y renombrar, mover o eliminar esperan tu sí; en un hilo de comentarios escribe una respuesta junto a la nota, nunca texto dentro de ella. Una respuesta se convierte en nota solo cuando pulsas **Conservar como nota**; entonces la escribe Plainva, no el asistente.

Los comentarios sobre la beta van a las discusiones del proyecto en GitHub: **Comentarios sobre la IA (beta)** en los ajustes abre una.
