# Habilidades (Beta)

Última actualización: 2026-10-06

Una habilidad es un conjunto de instrucciones para un trabajo que se repite: preparar una reunión, ordenar tus tareas, un repaso semanal. Plainva incluye doce y puedes escribir las tuyas. Las habilidades usan el formato abierto Agent Skills —una carpeta con un `SKILL.md`—, así que también funcionan en otras apps de IA que leen ese formato.

## Usar una habilidad

Inicia una habilidad con un clic: como chip en una conversación vacía (las tres más usadas), en **Habilidades** en la pestaña de IA, en el teléfono en **Conversaciones → Habilidades** o desde la paleta de comandos. La conversación funciona entonces con la habilidad: sus instrucciones van incluidas y solo usa las herramientas y carpetas que la habilidad nombra.

También puedes simplemente preguntar. En cada conversación la IA conoce los nombres y las descripciones de tus habilidades activas y carga una cuando tu pregunta encaja: basta con «prepara mi próxima reunión».

## Las habilidades incluidas en Plainva

| Habilidad | Qué hace |
|---|---|
| **Orientación del día** | Lo que importa hoy: tareas pendientes, citas y en qué trabajaste últimamente. |
| **Repaso semanal** | Los últimos siete días y la semana que viene, con tres propuestas. |
| **Estado del proyecto** | Objetivo, avances, puntos abiertos y el siguiente paso de un proyecto. |
| **Preparar reunión** | Prepara una reunión a partir de notas anteriores y puntos abiertos, o la resume después. |
| **Revisar tareas** | Ordena tus tareas abiertas: qué ahora, qué puede esperar, qué sobra. |
| **Investigación** | Investiga una pregunta en la web y en tus notas, con cada fuente citada. |
| **Correo y calendario** | Repasa el correo reciente y las próximas citas: qué necesita respuesta, qué preparar, qué tareas se derivan. |
| **Escribir y revisar** | Resume, acorta o reescribe una nota, como texto que copias tú. |
| **Cuidar el conocimiento** | Encuentra notas que dicen lo mismo, están desactualizadas o no están conectadas con nada. |
| **Revisar enlaces** | Revisa los enlaces de una nota: que no llevan a ninguna parte, que faltan, de un solo sentido. |
| **Revisar privacidad** | Encuentra lo que de una nota debería quedarse en este dispositivo y propone una regla. |
| **Reflexión** | Repasa contigo las notas de un día o una semana, con amabilidad y nunca con un diagnóstico. |

Todas solo leen: ninguna cambia una nota ni envía nada. Solo **Investigación** usa Internet, y solo **Correo y calendario** lee tu correo — ver más abajo. Revisar privacidad y Reflexión están pensadas para un modelo en este dispositivo; con un modelo en la nube lo indica la vista de envío. Desactiva cualquier habilidad en **Habilidades**: el interruptor vale para este vault en este dispositivo. **Crear tu propia versión** copia una a tu vault, donde puedes cambiarla.

## En Internet y en tu correo

**Investigación** es la única habilidad incluida en Plainva que usa Internet. Iniciarla es tu elección para su conversación, igual que el globo terráqueo bajo el campo de entrada: donde activaste **La IA puede usar Internet en este vault**, busca y lee páginas — y mientras tus notas estén en la conversación, cada página y cada búsqueda sigue preguntando antes, como se describe en **En Internet**, en [Asistente de IA](AI_Assistant.md). Donde el interruptor está desactivado, investiga solo en tus notas y lo dice. Lo mismo vale cuando la IA carga la habilidad por sí misma en una conversación que empezaste sin Internet.

**Correo y calendario** lee el correo mediante la misma pregunta que cualquier conversación: **¿Leer tu correo?** la primera vez. Nunca lee por sí misma el texto de un mensaje; un segundo lector sin herramientas escribe un informe sobre él. Ambas cosas se describen en [Asistente de IA](AI_Assistant.md).

Una habilidad propia usa Internet solo cuando su línea `allowed-tools` nombra `web_search` o `fetch_url`. **Revisar y aprobar** dice entonces **Usa Internet donde lo permitiste para este vault.** antes de que la apruebes. Una habilidad que no nombra herramientas nunca lleva Internet consigo.

Una ejecución de prueba nunca usa Internet y nunca pregunta: el correo que no tenía permiso para leer en esta sesión sigue sin leerse.

## Tus propias habilidades

**Nueva habilidad** pide un nombre, una descripción —con ella la IA elige la habilidad— y las instrucciones. Plainva las escribe como `.agent/skills/<nombre>/SKILL.md` en tu vault, donde viajan con él como cualquier nota. **Editar** abre el archivo como una nota.

**Importar…** acepta una habilidad como archivo `.zip` o `.skill`. Antes de escribir nada, Plainva la revisa: exactamente una habilidad en el formato, ninguna ruta fuera de su carpeta, los límites de tamaño. Indica la licencia, los scripts que no ejecutará y las herramientas que no tiene. Los archivos ocultos —nombres que empiezan por un punto— no forman parte de una habilidad y se dejan fuera.

## Nada se ejecuta antes de que lo apruebes

Una habilidad de tu vault que es nueva o cambió —por sincronización, una importación o una edición en este u otro dispositivo— no se ejecuta hasta que la apruebes **en este dispositivo**. Esas habilidades esperan arriba en **Habilidades**, en **Esperan tu aprobación**, y en **Configuración → IA y automatización** (la parte del vault). **Revisar y aprobar** muestra qué puede hacer la habilidad, qué cambió desde tu última aprobación, sus instrucciones, sus archivos y dónde está. La aprobación vale exactamente para esta versión; cualquier cambio la anula. Las aprobaciones se guardan en este dispositivo, nunca en el vault.

Lo mismo vale para un `AGENTS.md` en la raíz de tu vault: una vez aprobado, sus instrucciones permanentes van en cada conversación nueva. Ni una habilidad ni `AGENTS.md` pueden levantar tus reglas de privacidad, y una habilidad nunca obtiene más de lo que tiene una conversación: solo puede restringirlo.

## Probar habilidades con un modelo

Una habilidad puede traer escenarios de prueba: un mensaje que la inicia y lo que hace una buena ejecución. Las habilidades incluidas los tienen; para las tuyas, escríbelos en `tests/scenarios.json` dentro de la carpeta de la habilidad:

```json
{
  "version": 1,
  "scenarios": [
    {
      "id": "rates",
      "message": "Check the offer against last year's rates.",
      "tools": { "required": ["read_note"], "forbidden": ["run_command"] },
      "cites": ["Offer"],
      "never": ["internal margin"]
    }
  ]
}
```

`tools` nombra las herramientas que usa una buena ejecución y las que no debe tocar; `cites`, las notas que nombra su respuesta; `never`, texto que no debe aparecer en ella. Una habilidad tiene como máximo ocho escenarios.

**Probar con ⟨modelo⟩** — al final de **Habilidades** o en el menú de una habilidad — ejecuta los escenarios con el modelo que usaría una conversación nueva. Nada empieza solo: el diálogo dice primero cuántos escenarios se ejecutarían y con qué modelo, y tú fijas un **Límite** en dólares estadounidenses; la prueba termina entre dos escenarios en cuanto se alcanza. Si no se conoce el precio del modelo, la prueba termina tras un número fijo de tokens; un modelo en este dispositivo no necesita límite.

Cada escenario es una ejecución normal de su habilidad: lee tu vault como una ejecución a mano, pasa por el mismo resumen antes de enviar, cuenta para tu consumo y deja su conversación en el historial, donde su siguiente ejecución la sustituye. Después, cada escenario muestra su resultado en palabras, y la fila de la habilidad dice cómo fue su última ejecución. Un resultado vale para un modelo y una versión de la habilidad: si eliges otro modelo o cambias la habilidad, la fila lo dice en lugar de mostrar un resultado que ya no cuenta. Algunos escenarios incluidos preguntan por notas del vault de pruebas de Plainva; en tu vault no valen, y el diálogo los cuenta aparte en lugar de darlos por fallidos.

## Qué se envía al proveedor

La vista de envío muestra en **Instrucciones** lo que va incluido: la habilidad de la conversación, la lista de habilidades que la IA puede cargar y `AGENTS.md`. Si instrucciones de tu vault van por primera vez a una nube, la vista vuelve a aparecer. Los caracteres invisibles de una habilidad nunca llegan a un modelo.

## Límites de la beta

Las habilidades no ejecutan scripts. Tus propias habilidades no se ofrecen a las apps de IA conectadas mediante el servidor MCP; solo las incluidas en Plainva.
