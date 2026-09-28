# Asistente de IA (Beta)

Última actualización: 2026-09-24

Plainva puede responder preguntas sobre tus notas con un modelo de IA de tu elección. Lee tu vault, cita las notas que usó y puede abrir notas y vistas por ti — no cambia nada. El asistente es **experimental** y está desactivado hasta que lo actives, por separado en cada dispositivo.

## Activar la IA

Abre **Configuración → IA y automatización** (la parte de la aplicación) y activa **Usar la IA en este dispositivo**. Sin el interruptor no hay botón de IA, ni pestaña de IA ni compañero. No se envía nada a ningún sitio hasta que preguntes algo.

## Elegir un proveedor

Plainva no trae su propio servicio de IA: usas un proveedor que tú eliges, con tu propia clave. Puedes elegir cualquier proveedor; Plainva indica sus condiciones y la conservación de datos para que decidas tú — no excluye ninguno.

| Tipo | Proveedores |
|---|---|
| Proveedores en la nube | Anthropic, OpenAI, Google Gemini |
| Intermediarios y servidores propios | OpenRouter, cualquier **Servidor compatible con OpenAI** |
| En este ordenador (escritorio) | Ollama, LM Studio |

1. En **IA y automatización**, elige **Añadir proveedor** y selecciona uno. Cada entrada lleva una breve nota sobre sus condiciones — por ejemplo, que el acceso gratuito de Google puede dejar que otras personas lean tus entradas.
2. Introduce la clave con **Introducir clave**. La clave va al almacén seguro de este dispositivo; Plainva no vuelve a mostrarla — ni a la IA ni en la pantalla.
3. **Probar conexión** carga la propia lista de modelos del proveedor. Si falla, el mensaje explica por qué (una clave rechazada, sin conexión, un modelo desconocido).

Un **Servidor compatible con OpenAI** se añade mediante su dirección. Plainva pregunta una vez más antes de añadirlo, en una ventana del sistema operativo, y solo envía a la dirección que confirmaste. El `http` sin cifrar solo funciona para un servidor en este dispositivo; todo lo demás necesita `https`.

Si todavía no tienes una clave: un modelo en este ordenador (Ollama, LM Studio) no cuesta nada, y la consola de cada proveedor emite claves.

## Modelos y perfiles

Cuatro perfiles — **Rápido**, **Equilibrado**, **Potente** y **Local** — son tu asignación de modelos. Elige un proveedor y un modelo para cada uno, de la lista del proveedor o escribiendo el id del modelo exactamente como lo llama el proveedor. **Predeterminado para conversaciones nuevas** decide con qué perfil empieza una conversación nueva. Plainva no llama a ningún modelo «el mejor».

## Preguntar

- **Escritorio:** el botón de IA en la barra de acciones, **Ctrl+J** (⌘J en macOS) o **Preguntar a la IA** en la paleta de comandos abre el compañero — una pequeña ventana sobre tu trabajo. **Abrir como pestaña** lleva esa misma conversación a la pestaña de IA, donde están listadas tus conversaciones.
- **Teléfono:** **Preguntar a la IA** en el menú ⋮ de una nota abre la hoja de IA sobre esa nota. El área **IA** (en la hoja de áreas, o en la barra de navegación si la colocas ahí) muestra la conversación a pantalla completa; **Conversaciones** enumera las anteriores.

La nota que tienes abierta se incluye automáticamente; quítala del contexto con su ✕ si quieres. **Fijar una nota…** añade más notas. El asistente también puede buscar por su cuenta: busca en el vault, lee notas y sus secciones, enumera tareas y abre notas y vistas. No puede cambiar, crear ni eliminar nada.

Cada conversación empieza con la línea «Las respuestas las escribe una IA — ⟨modelo⟩ a través de ⟨proveedor⟩». Debajo de cada respuesta, una línea indica qué se envió adónde: cuántas notas, aproximadamente cuántos tokens y — donde el proveedor publica precios — el coste aproximado. **Detener** termina una respuesta en cualquier momento.

Un enlace en una respuesta se abre solo después de que confirmes su dirección, y las imágenes en las respuestas nunca se cargan.

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
- El asistente lee; ofrecer cambios como sugerencias llegará en una versión posterior.
