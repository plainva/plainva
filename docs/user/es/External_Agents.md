# Agentes externos (Beta)

Última actualización: 2026-10-07

Un agente externo es un programa de IA de otro fabricante: un agente que instalaste en tu ordenador y en el que iniciaste sesión tú mismo, con tu propia suscripción o clave. Plainva puede iniciar un agente así en la carpeta de un vault y mostrar su sesión en la pestaña de IA. Forma parte de las funciones experimentales de IA y solo funciona en el escritorio.

Un agente externo no es el asistente de Plainva. El [Asistente de IA](AI_Assistant.md) envía solo lo que su resumen te mostró, y nunca lo que tus reglas de privacidad retienen. Un agente lee y envía por su cuenta. Esta página dice qué controla Plainva en una sesión así — y qué no.

## Lo que Plainva no controla

- **El programa.** Un agente es el programa de otro. Se ejecuta en este ordenador con tus permisos, en la carpeta del vault, y no está cercado: puede leer y cambiar todo lo que tú puedes.
- **Lo que lee y envía.** Lee archivos por su cuenta — también notas que mantienes fuera de la nube — y envía lo que elige a su propio servicio. Tus reglas de privacidad y el resumen previo al envío no lo alcanzan, y nada te pregunta antes de que envíe.
- **Lo que escribe por su cuenta.** Un cambio que el agente hace por su cuenta está en el vault de inmediato, sin sugerencia. La sesión te lo dice cuando el agente informa de un cambio así; un cambio del que no informa, Plainva no lo ve.
- **Su inicio de sesión.** El agente inicia sesión por sí mismo. Plainva nunca ve sus credenciales y no guarda ninguna.

Inicia un agente solo en un vault cuyo contenido pueda llegar al servicio del agente.

## Lo que Plainva controla

- **Sus propias herramientas.** Donde **Permitir que las apps de IA de este ordenador lean este vault** está activado, las herramientas de Plainva se ofrecen al agente — las mismas que a cualquier app de [Conectar apps de IA](Connect_AI_Apps.md): solo las carpetas que concedes, nunca una nota que se mantiene fuera de la nube, y solo lectura.
- **Lo que el agente pide a Plainva que lea.** Una nota que se mantiene fuera de la nube y las carpetas propias de Plainva no se entregan. El agente se entera, y tú también.
- **Lo que el agente pide a Plainva que escriba.** No se escribe nada. Un cambio en una nota se convierte en una ronda de sugerencias con el nombre del agente, y una nota nueva espera hasta que la creas.
- **Sin terminal.** Plainva no ofrece a un agente una terminal propia.

## Añadir un agente

1. Instala el agente tú mismo, como describe su fabricante, e inicia sesión en él en su propio programa.
2. Abre **Configuración → IA y automatización** (la parte de la aplicación). En **Agentes externos**, **Encontrado en este ordenador** señala los agentes que Plainva conoce por su nombre y encuentra instalados; **Añadir** añade uno. Para cualquier otro programa que hable el Agent Client Protocol, elige **Añadir agente…** en **Otro agente** y rellena **Nombre**, **Programa** y **Argumentos, uno por línea**.
3. Tu sistema muestra el comando completo una vez más antes de recordarlo.

Plainva no instala ningún agente ni descarga ninguno. Inicia exactamente el programa que confirmaste, directamente y sin shell. El comando se recuerda en este dispositivo, nunca en el vault. **Quitar** hace que Plainva olvide cómo iniciar un agente; el programa en sí y su inicio de sesión quedan como están.

## Iniciar una sesión

Abre la pestaña de IA y elige **Agente**. Antes de que nada se inicie, **Antes de iniciar ⟨agente⟩** enumera lo que el agente hace por su cuenta y lo que Plainva controla, y dice si se ofrecerán las herramientas de Plainva. **Empezar la sesión** inicia el programa del agente en la carpeta del vault. La primera vez que inicias un agente en un vault desde que se abrió Plainva, tu sistema pregunta una vez más y muestra la carpeta y el comando completo.

Hay una sola sesión a la vez, y pertenece al vault en el que se inició: **Terminar la sesión** detiene el programa del agente, y cerrar el vault o Plainva también. Mientras está en marcha, la primera línea de la sesión dice quién es el agente y que tus reglas de privacidad no se le aplican. No se inicia ningún agente dentro de un espacio cifrado.

## Iniciar sesión

Un agente que no ha iniciado sesión lo dice, y la sesión muestra **⟨agente⟩ pide iniciar sesión** con las formas que el agente nombra. Según el agente, elegir una abre una ventana de terminal con el propio programa del agente, o el agente te lleva él mismo a su inicio de sesión. Plainva espera y después inicia el agente de nuevo. Donde no se puede abrir una terminal, Plainva muestra el comando que debes ejecutar en una terminal tuya; después elige **Reintentar**. Plainva no ve nada del inicio de sesión.

## En una sesión

Escribe lo que el agente debe hacer. La nota que tienes abierta se le nombra al agente — su nombre y dónde está, no su texto —, salvo que la quites encima del campo de entrada; una nota que mantienes fuera de la nube nunca se nombra. La sesión muestra lo que dice el agente, su plan y cada uno de sus pasos, con los archivos del vault que nombra.

Cuando el agente quiere tu permiso para un paso, **⟨agente⟩ pregunta** lo muestra. Las palabras son del agente, y las opciones son las que el agente ofrece — **Permitir**, **Permitir siempre**, **Rechazar**, **Rechazar siempre**. Tu respuesta va solo al agente: lo que haga tras un sí es cosa suya, y un «siempre» es una promesa que cumple el agente, no Plainva.

**Detener** termina la respuesta en la que el agente está trabajando.

## Lo que escribe el agente

**A través de Plainva.** Un cambio que el agente entrega a Plainva nunca se escribe en la nota. Cuando la respuesta del agente termina, cada nota que cambió lleva una ronda de sugerencias, firmada **⟨nombre⟩ (agente externo)**: en **Sugerencias** aceptas o rechazas cada cambio o la ronda entera, igual que con la ronda de una persona. Una nota que aún no existe aparece en **Notas nuevas del agente**. **Crear** la escribe — marcada con `generated`, con el agente como autor —, y **Descartar** la desecha. Las direcciones web que el agente trajo se escriben de modo que nada las abra ni las cargue (`https[://]…`).

Plainva no lo acepta todo: solo notas Markdown, solo su texto y no sus propiedades, ninguna nota que lleve reglas de IA o campos de confianza, nada que se mantenga fuera de la nube, y no más de 150 cambios en una nota a la vez. Lo que no aceptó lo dice la sesión, y el agente se entera.

**Por su cuenta.** Un agente también puede escribir archivos por su cuenta, como cualquier programa. Cuando informa de un cambio así, la sesión dice **El agente cambió ⟨nota⟩ por su cuenta: está en el vault sin sugerencia.** Qué camino toma un agente no lo puede prometer Plainva: depende del agente y de cómo esté configurado. En la configuración, cada agente muestra lo que se vio por última vez en este ordenador — cuántos cambios llegaron a través de Plainva y cuántos escribió por su cuenta.

## Lo que Plainva conserva

- **En este dispositivo:** el comando que confirmaste, tu nombre para el agente y lo que se vio por última vez de sus cambios — en los datos propios de Plainva, nunca en el vault.
- **Por vault:** **Últimas sesiones en este vault** indica cuándo hubo una sesión, con qué agente, y cuántos mensajes, cambios a través de Plainva y cambios propios hubo — nunca lo que se dijo.
- **No la sesión en sí:** lo que tú y el agente dijisteis desaparece cuando la sesión se cierra. Lo que el agente conserve por su lado es asunto del agente.

Si el programa del agente termina por sí solo, la sesión lo dice, y **Mostrar sus últimas líneas** muestra el final de lo que el programa escribió.

## Límites

- Solo en el escritorio y solo en la ventana principal. En el teléfono está el asistente propio de Plainva.
- No en un espacio cifrado.
- Una sesión a la vez, y sin historial: una sesión terminada no se puede volver a abrir.
- Los modos, modelos y comandos propios de un agente no se pueden elegir desde Plainva, y no se le pueden enviar imágenes.
- Hasta ahora esto se ha probado solo con un agente de prueba propio de Plainva. Qué agentes funcionan aquí, y cuáles entregan sus cambios a Plainva, se ve al probarlos — los comentarios son bienvenidos.
