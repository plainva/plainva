# Asistente de IA (Beta)

Última actualización: 2026-10-06

Plainva puede responder preguntas sobre tus notas con un modelo de IA de tu elección. Lee tu vault, cita las notas que usó, abre notas y vistas por ti y propone cambios en un fragmento seleccionado como sugerencias — nunca cambia una nota por sí mismo. El asistente es **experimental** y está desactivado hasta que lo actives, por separado en cada dispositivo.

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

La nota que tienes abierta se incluye automáticamente; quítala del contexto con su ✕ si quieres. **Fijar una nota…** añade más notas. El asistente también puede buscar por su cuenta: busca en el vault, lee notas y sus secciones, bases de datos, retroenlaces y notas enlazadas, enumera tareas, citas y las notas abiertas o cambiadas hace poco, y abre notas y vistas. No puede cambiar, crear ni eliminar nada.

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

Las habilidades son instrucciones para trabajo recurrente. Diez vienen con Plainva —entre ellas **Orientación del día**, **Repaso semanal** y **Estado del proyecto** como chips en una conversación vacía— y puedes escribir o importar las tuyas. Inicia una con un clic o simplemente pregunta: la IA carga por sí misma una habilidad que encaje. Tus propias habilidades solo se ejecutan después de que las apruebes en este dispositivo. Todo sobre ellas: [Habilidades](AI_Skills.md).

## Transcribir una nota de voz

En cada nota de voz —en el editor, en el modo de lectura, en el diario y en las tarjetas— **Transcribir** convierte la grabación en texto. Va tal cual al modelo del perfil **Audio**, a través del mismo resumen que una pregunta; una grabación es un tipo de datos propio, por eso el resumen pregunta la primera vez. La transcripción vuelve como sugerencia debajo de la grabación, con el autor **Plainva IA · ⟨modelo⟩**: acéptala o recházala en **Sugerencias**.

**Audio** necesita un proveedor con ruta de audio: OpenAI (por ejemplo `gpt-4o-transcribe` o `whisper-1`), Gemini o un servidor compatible propio; uno en este equipo mantiene la grabación en el dispositivo. Se pueden transcribir grabaciones de hasta 11 MB. Una grabación en una nota que tus reglas mantienen fuera de la nube no va a ningún modelo en la nube, y los espacios cifrados aún no lo ofrecen.

## Reglas de privacidad

Algunas notas nunca deben llegar a un proveedor en la nube. Una regla puede ir en el frontmatter de una nota:

```yaml
plainva:
  ai:
    cloud: deny
```

o, para toda una carpeta, en **Configuración → IA y automatización** (la parte del vault), que escribe las reglas en `.agent/policy.yml`. Una nota que se mantiene fuera de la nube no aporta nada — ni texto ni título —, y los enlaces hacia ella en otras notas se retienen. Los modelos en este dispositivo siguen permitidos. Los espacios cifrados mantienen la nube desactivada, salvo que la permitas allí. El formato exacto está en la [Referencia del formato de archivo](File_Format_Reference.md).

## Historial y uso

Las conversaciones se quedan en este dispositivo, por vault — nunca en el vault ni sincronizadas. **Conservar conversaciones** decide durante cuánto tiempo; puedes eliminar conversaciones sueltas en la lista, o todas las de un vault a la vez. **Uso este mes** suma los tokens por proveedor y modelo.

## Límites de la beta

- En el escritorio, la IA solo se ejecuta en la ventana principal.
- En el teléfono, una respuesta solo llega mientras la aplicación está abierta.
- El asistente no cambia ninguna nota por sí mismo: propone cambios en un fragmento seleccionado y transcripciones de notas de voz, como sugerencias que aceptas o rechazas; en un hilo de comentarios escribe una respuesta junto a la nota, nunca texto dentro de ella.

Los comentarios sobre la beta van a las discusiones del proyecto en GitHub: **Comentarios sobre la IA (beta)** en los ajustes abre una.
