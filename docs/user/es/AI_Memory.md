# Memoria (Beta)

Última actualización: 2026-10-09

La memoria guarda lo que la IA debe saber sobre ti y tu trabajo sin que tengas que repetírselo: a qué te dedicas, cómo quieres las respuestas, quiénes son tus clientes. Son dos archivos en tu vault. Nada entra en la memoria sin tu sí, y puedes leer, cambiar y eliminar cada entrada.

## Dos lugares

**Siempre incluido** va en cada conversación nueva. Mantenlo breve: tiene espacio para 2.000 caracteres, y una barra muestra cuánto se ha llenado. Una entrada que ya no cabe se marca como **Sin espacio: no se incluye** —se guarda, pero no se envía—. Las entradas se incluyen en el orden en que están, así que lo más importante debe ir arriba; el orden se cambia en el archivo.

Lo que está en **Para consultar** no se envía. Cuando una pregunta puede depender de algo que le dijiste a la IA antes, esta busca ahí, y la conversación muestra **Buscando en la memoria**. Es el lugar para lo que solo importa a veces: las condiciones de un cliente, una decisión y su motivo.

## Abrir la memoria

En el escritorio, elige **Memoria** en la pestaña de IA, junto a **Habilidades**. En el teléfono es **Conversaciones → Memoria**. **Configuración → IA y automatización** (la parte del vault) también lleva allí: **Abrir la memoria** bajo **Habilidades y memoria**.

## Añadir una entrada por tu cuenta

**Nueva entrada** pide tres cosas: el texto —una sola cosa por entrada, en una única línea de 500 caracteres como máximo—, el lugar (**Siempre incluido** o **Para consultar**) y si es para **Solo modelos en este dispositivo**. Márcalo para todo lo que ningún modelo en la nube deba saber.

El botón ⋯ de una entrada —en el teléfono, un toque en la entrada— ofrece **Editar**, moverla al otro lugar (**Incluir siempre** o **Solo para consultar**) y **Eliminar**.

## Dejar que la IA recuerde algo

Dilo en una conversación: «Recuerda que facturo por día, no por hora». La IA redacta una entrada; nunca escribe una por sí misma. Bajo su respuesta, una tarjeta **Borrador · Entrada de la memoria** muestra el texto completo. Elige el lugar y luego **Recordar**, o **Descartar**. Un borrador sobre el que aún no has decidido espera en **Pendiente**, y la memoria indica cuántos esperan.

«Olvida que …» funciona igual: la tarjeta dice **Borrador · Quitar de la memoria**, y **Quitar** retira la entrada. Cuando le dices a la IA que algo ha cambiado, la tarjeta muestra, bajo **Sustituye a**, qué entrada reemplaza la nueva redacción.

Una conversación terminada también puede sugerir entradas: **Aprender de esta conversación** la lee una vez más y deja borradores, cada uno con su evidencia. Cómo funciona esto, y qué puede llegar a sugerir una revisión así, se describe en [Habilidades](AI_Skills.md).

## Una regla no es un recuerdo

«Responde siempre en alemán» no es algo que saber, sino algo que hacer. Una regla así no entra en la memoria: se convierte en una línea de las **Instrucciones del vault** (`AGENTS.md`), que todo modelo recibe como instrucción. Añade una con **Añadir una regla** bajo **Reglas para la IA**, o pídeselo a la IA; su tarjeta dice entonces **Borrador · Regla para la IA**, con el botón **Añadir como regla**.

Como todas las instrucciones, el archivo debe aprobarse en cada dispositivo antes de que tenga efecto allí (consulta [Habilidades](AI_Skills.md)). Una regla que añades en un dispositivo donde el archivo ya estaba aprobado tiene efecto allí de inmediato; tus otros dispositivos te preguntan antes.

## Poner en orden

Una memoria que ha crecido se repite. En **Poner en orden**, la vista de la memoria indica lo que este dispositivo ha detectado por sí mismo, sin consultar a un modelo: dos entradas que dicen casi lo mismo, una entrada de hace más de un año y entradas de **Siempre incluido** que ya no caben. **Comparar** muestra las dos entradas juntas, cada una con todo lo que ofrece su menú.

Para verlo con más detalle hay una habilidad. **Cuidar la memoria** lee las entradas con el modelo de una conversación y prepara borradores de lo que va junto y de lo que puede quitarse; la fila **Pedir una revisión de la memoria** la inicia. Lo que sugiere son borradores como todos los demás: nada cambia hasta que lo aceptes, y si dos entradas se contradicen, pregunta en lugar de decidir.

## Privacidad

- Una entrada puede llevar una regla propia: **No a modelos en la nube**, **No en conversaciones con Internet**. Un modelo en este dispositivo recibe todas las entradas.
- Una entrada que la IA redactó en una conversación que leyó notas con una regla de privacidad recibe las mismas reglas: la tarjeta dice **La entrada recibe las reglas de privacidad de las notas en las que se basó esta conversación.** Lo que procede de una nota que debe quedarse en este dispositivo no llega a una nube a través de la memoria.
- Tus [reglas de privacidad](AI_Assistant.md) valen también para los dos archivos: una regla de carpeta para `.agent/` mantiene toda la memoria fuera de la nube.
- La vista de envío tiene una fila **Memoria** —cuántas entradas van incluidas— y cuenta las entradas que tus reglas retienen en **Retenido**. Nunca nombra una entrada.
- Para la IA, una entrada es información, no una instrucción: una frase de la memoria no le da ningún permiso.
- Una conversación conserva la memoria con la que empezó. Una entrada que eliminas no va a ninguna conversación nueva; las conversaciones que ya han empezado conservan lo que recibieron.

## Desactivar la memoria

**Usar la memoria en este dispositivo** está activado hasta que lo desactives. Desactivado, una conversación en este dispositivo no recibe nada de la memoria ni añade nada a ella. Los archivos se quedan como están, y cada dispositivo decide por sí mismo.

## Los dos archivos

`.agent/active_memory.md` (siempre incluido) y `.agent/MEMORY.md` (para consultar) son Markdown puro. Cada entrada es un elemento de lista, y los encabezados agrupan entradas. Lo que Plainva sabe de una entrada está en un comentario que la sigue:

```markdown
## Clients

- Harbour Studio pays within 14 days.
- I bill per day, not per hour. <!-- plainva: added=2026-10-09; by=assistant; source=Offer for Harbour Studio; deny=cloud -->
```

`added` y `by` indican cuándo se añadió la entrada y si la escribiste tú o aceptaste un borrador, `source` nombra la conversación de la que viene un borrador, y `deny` contiene sus reglas (`cloud`, `web`). Puedes editar los archivos en cualquier editor. En Plainva, **Abrir archivo** abre cualquiera de los dos.

Plainva no adivina. Una entrada cuyo comentario está dañado se marca como **Reglas ilegibles: no va a ningún modelo** hasta que repares el comentario o vuelvas a añadir la entrada. El texto oculto en un comentario o en caracteres invisibles nunca se envía; la entrada muestra entonces cuántas partes ocultas se dejaron fuera. Un archivo puede contener como máximo 2.000 entradas y 256 KB.
