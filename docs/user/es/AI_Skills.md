# Habilidades (Beta)

Última actualización: 2026-10-01

Una habilidad es un conjunto de instrucciones para un trabajo que se repite: preparar una reunión, ordenar tus tareas, un repaso semanal. Plainva incluye diez y puedes escribir las tuyas. Las habilidades usan el formato abierto Agent Skills —una carpeta con un `SKILL.md`—, así que también funcionan en otras apps de IA que leen ese formato.

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
| **Escribir y revisar** | Resume, acorta o reescribe una nota, como texto que copias tú. |
| **Cuidar el conocimiento** | Encuentra notas que dicen lo mismo, están desactualizadas o no están conectadas con nada. |
| **Revisar enlaces** | Revisa los enlaces de una nota: que no llevan a ninguna parte, que faltan, de un solo sentido. |
| **Revisar privacidad** | Encuentra lo que de una nota debería quedarse en este dispositivo y propone una regla. |
| **Reflexión** | Repasa contigo las notas de un día o una semana, con amabilidad y nunca con un diagnóstico. |

Todas solo leen: ninguna cambia una nota, envía nada ni va a internet. Revisar privacidad y Reflexión están pensadas para un modelo en este dispositivo; con un modelo en la nube lo indica la vista de envío. Desactiva cualquier habilidad en **Habilidades**: el interruptor vale para este vault en este dispositivo. **Crear tu propia versión** copia una a tu vault, donde puedes cambiarla.

## Tus propias habilidades

**Nueva habilidad** pide un nombre, una descripción —con ella la IA elige la habilidad— y las instrucciones. Plainva las escribe como `.agent/skills/<nombre>/SKILL.md` en tu vault, donde viajan con él como cualquier nota. **Editar** abre el archivo como una nota.

**Importar…** acepta una habilidad como archivo `.zip` o `.skill`. Antes de escribir nada, Plainva la revisa: exactamente una habilidad en el formato, ninguna ruta fuera de su carpeta, los límites de tamaño. Indica la licencia, los scripts que no ejecutará y las herramientas que no tiene.

## Nada se ejecuta antes de que lo apruebes

Una habilidad de tu vault que es nueva o cambió —por sincronización, una importación o una edición en este u otro dispositivo— no se ejecuta hasta que la apruebes **en este dispositivo**. Esas habilidades esperan arriba en **Habilidades**, en **Esperan tu aprobación**, y en **Configuración → IA y automatización** (la parte del vault). **Revisar y aprobar** muestra qué puede hacer la habilidad, qué cambió desde tu última aprobación, sus instrucciones, sus archivos y dónde está. La aprobación vale exactamente para esta versión; cualquier cambio la anula. Las aprobaciones se guardan en este dispositivo, nunca en el vault.

Lo mismo vale para un `AGENTS.md` en la raíz de tu vault: una vez aprobado, sus instrucciones permanentes van en cada conversación nueva. Ni una habilidad ni `AGENTS.md` pueden levantar tus reglas de privacidad, y una habilidad nunca obtiene más de lo que tiene una conversación: solo puede restringirlo.

## Qué se envía al proveedor

La vista de envío muestra en **Instrucciones** lo que va incluido: la habilidad de la conversación, la lista de habilidades que la IA puede cargar y `AGENTS.md`. Si instrucciones de tu vault van por primera vez a una nube, la vista vuelve a aparecer. Los caracteres invisibles de una habilidad nunca llegan a un modelo.

## Límites de la beta

Las habilidades no ejecutan scripts, y las que necesitan la web o tu correo llegarán más adelante. Tus propias habilidades no se ofrecen a las apps de IA conectadas mediante el servidor MCP; solo las incluidas en Plainva.
