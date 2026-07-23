# Seguridad y uso compartido

## Centro de seguridad, recifrado y slices publicados

**Seguridad y uso compartido** tiene dos niveles. El **Resumen** (primer nivel) muestra el estado de protección, **Finalizar migración** cuando quedan restos de texto sin cifrar, **Quitar la conexión con la nube cifrada**, y dos tarjetas que abren el segundo nivel — **Dispositivos y recuperación** y **Compartir con otros**. En el segundo nivel, la navegación por áreas reemplaza la columna izquierda de ajustes, agrupada en **Tu acceso** (Dispositivos, recuperación) y **Compartir** (Miembros, grupos, slices, publicaciones); **‹ Resumen** vuelve al primer nivel. Las acciones visibles siguen disponibles: si falta un requisito, una acción abre el vault, la conexión, la configuración o el desbloqueo. La revocación puede iniciar un recifrado completo reanudable. Crea un Vault Slice con **Detalles → Contenido → Permisos → Revisión**. Las publicaciones externas viven en un workspace cifrado separado; la proyección saneada elimina propiedades privadas, enlaces excluidos e incrustaciones. La publicación pública espera la revisión criptográfica independiente y pruebas reales en Android/iOS.

Revisado: 2026-07-23

Plainva mantiene el vault como archivos legibles en el dispositivo y guarda la copia en la nube como objetos cifrados opacos. Tras conectar una cuenta, abre **Ajustes → tu vault → Seguridad y uso compartido**.

## Configuración

1. Elige nombres para propietario y dispositivo. Las claves quedan en el llavero del sistema o, si no está disponible, bajo una frase local.
2. Guarda el archivo `.pvrecovery` y conserva el código mostrado por separado. Cada bloque tiene un número de grupo visible; introduce los valores de los dos grupos resaltados para confirmar que la copia es legible. Se necesitan ambas partes; ninguna incluye credenciales de nube.
3. Activa el workspace. Plainva publica la política firmada y cifra todos los archivos en `.pvws/`. El vault local sigue legible y la migración se reanuda tras interrupciones.

El texto sin cifrar existente permanece junto a `.pvws/` durante la migración. Solo con estado **Protegido** puedes eliminarlo explícitamente; nunca se borran archivos locales.

Los cambios sin conexión permanecen en una cola duradera. Las eliminaciones requieren tombstones firmados y los cambios paralelos se conservan como copias `.CONFLICT-…`.

## Dispositivos y recuperación

Para añadir **tu propio** segundo dispositivo, abre **Dispositivos y recuperación → Dispositivos → Añadir otro dispositivo**: Plainva muestra un código de invitación vinculado a tu propia pertenencia — **no** crea un nuevo miembro. Pégalo en el segundo dispositivo (**Seguridad y uso compartido → unirse**) y apruébalo en un dispositivo que ya esté dentro; compara antes la huella en ambos dispositivos. Para incorporar en cambio a otra persona, usa **Compartir con otros → Miembros → Invitar a una persona** (más abajo). Un dispositivo eliminado no puede firmar cambios nuevos válidos. La invitación y la solicitud de emparejamiento de un dispositivo que se une también se muestran como códigos QR escaneables — en el móvil, **Escanear invitación** lee un código con la cámara en lugar de pegar texto.

La recuperación está en **Dispositivos y recuperación → Recuperación**, dividida en **Estado actual** (si hay un paquete de recuperación guardado, y la huella del espacio) y el **Flujo de recuperación**. Si se pierden todos los dispositivos, elige allí **Restaurar acceso** y abre el archivo `.pvrecovery` con su código guardado por separado; Plainva crea un nuevo dispositivo propietario, puede revocar los dispositivos perdidos y no reescribe los objetos de contenido. **Renovar recuperación** sustituye el conjunto de recuperación anterior mediante una cadena de anclaje con doble firma. Guarda de nuevo el nuevo archivo y el código por separado; el conjunto anterior queda inválido.

## Miembros, roles y slices

Propietarios y administradores pueden invitar miembros, crear grupos y limitar un rol a todo el espacio, un slice o un objeto. Editor puede editar, Commenter comentar, Reader solo leer y Contributor solo crear dentro de su ámbito. La comprobación se hace antes de escribir en disco y antes de firmar, incluidos importaciones, restauraciones, automatizaciones y acciones de IA.

Un slice contiene una carpeta, una selección o una regla dinámica por ruta, tipo, etiquetas y propiedades. Usa siempre **Vista previa** antes de publicar. Los objetos no autorizados no se materializan ni aparecen en búsqueda, grafo o vistas previas.

## Comentarios, versiones y cuarentena

Los comentarios y sus marcas de resolución están cifrados y firmados. **Historial de versiones** lee revisiones cifradas y restaura una versión como cambio firmado nuevo o copia. Un artefacto remoto inválido se aísla en **Integridad y bifurcaciones locales**: puedes reintentarlo, exportar el texto cifrado, marcarlo reparado o ignorarlo. No bloquea el resto de la sincronización y la ausencia remota nunca implica eliminación.

## Eliminar correctamente un vault cifrado

Cuando ya no necesites un vault cifrado, retíralo en Plainva **antes** de borrar la carpeta en la nube. El orden importa: la protección fail-closed mantiene la sincronización detenida si la copia en la nube desaparece mientras Plainva todavía espera que la conexión esté cifrada — así te protege de que un atacante retire el cifrado para forzar texto sin cifrar.

1. Abre **Ajustes → tu vault → Security & Sharing**.
2. En el resumen, en la tarjeta **Cifrado**, elige **Quitar la conexión con la nube cifrada**. Plainva borra las claves locales y los datos del workspace en este dispositivo y vuelve a abrir el vault como un vault normal. (Esto es local del dispositivo; una acción global de «anular el cifrado» que además reescriba la copia en la nube a texto sin cifrar es una acción aparte que se añadirá más adelante.)
3. Solo entonces borra la carpeta en la nube (los objetos `.pvws/`) en tu proveedor si quieres deshacerte de ella. Plainva no borra por ti los objetos cifrados de la nube.

Si ya borraste la copia en la nube y la sincronización ahora falla con un error de "falta el espacio de trabajo" o "falta el manifiesto", la solución es el mismo restablecimiento, ofrecido donde aparece el error:

- Para un **workspace** cifrado, abre **Security & Sharing**. El estado muestra un error con una nota de recuperación; en la tarjeta **Cifrado** elige **Quitar la conexión con la nube cifrada** para restablecer el workspace en este dispositivo y que la sincronización vuelva a funcionar.
- Para una **conexión de sincronización** con contenido cifrado, haz clic en el estado de sincronización para abrir el diálogo de error de sincronización y elige **Restablecer cifrado**. Este botón solo aparece cuando faltan los datos de cifrado remotos o no son válidos.

Ambas acciones son explícitas y se confirman. Plainva nunca degrada de forma silenciosa una conexión cifrada a texto sin cifrar, y ninguna de las acciones borra archivos locales. Si la nube todavía contiene contenido cifrado que realmente quieres, cancela en su lugar — restablecer reanudaría la sincronización en texto sin cifrar.

Eliminar un vault con **Olvidar los datos de la aplicación** (Splash → quitar un vault → olvidar también los datos de la aplicación) también borra estos marcadores de cifrado, de modo que un vault eliminado así no deja nada que pueda bloquear una reconexión posterior.
