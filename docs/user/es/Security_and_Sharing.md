# Seguridad y uso compartido

Revisado: 2026-07-22

Plainva mantiene el vault como archivos legibles en el dispositivo y guarda la copia en la nube como objetos cifrados opacos. Tras conectar una cuenta, abre **Ajustes → tu vault → Seguridad y uso compartido**.

## Configuración

1. Elige nombres para propietario y dispositivo. Las claves quedan en el llavero del sistema o, si no está disponible, bajo una frase local.
2. Guarda el archivo `.pvrecovery`, conserva el código por separado e introduce los dos grupos solicitados. Se necesitan ambas partes; ninguna incluye credenciales de nube.
3. Activa el workspace. Plainva publica la política firmada y cifra todos los archivos en `.pvws/`. El vault local sigue legible y la migración se reanuda tras interrupciones.

El texto sin cifrar existente permanece junto a `.pvws/` durante la migración. Solo con estado **Protegido** puedes eliminarlo explícitamente; nunca se borran archivos locales.

Los cambios sin conexión permanecen en una cola duradera. Las eliminaciones requieren tombstones firmados y los cambios paralelos se conservan como copias `.CONFLICT-…`.

## Dispositivos y recuperación

Un dispositivo móvil nuevo crea una solicitud QR/código. Introduce el código corto en un escritorio ya aprobado y compara las huellas antes de confirmar. Un dispositivo eliminado ya no puede firmar cambios nuevos. Si se pierden todos, **Restaurar acceso** crea un dispositivo propietario nuevo con el archivo `.pvrecovery` y su código separado, sin reescribir contenido. **Renovar recuperación** ancla una identidad nueva con doble firma e invalida el conjunto anterior.

## Miembros, roles y slices

Propietarios y administradores pueden invitar miembros, crear grupos y limitar un rol a todo el espacio, un slice o un objeto. Editor puede editar, Commenter comentar, Reader solo leer y Contributor solo crear dentro de su ámbito. La comprobación se hace antes de escribir en disco y antes de firmar, incluidos importaciones, restauraciones, automatizaciones y acciones de IA.

Un slice contiene una carpeta, una selección o una regla dinámica por ruta, tipo, etiquetas y propiedades. Usa siempre **Vista previa** antes de publicar. Los objetos no autorizados no se materializan ni aparecen en búsqueda, grafo o vistas previas.

## Comentarios, versiones y cuarentena

Los comentarios y sus marcas de resolución están cifrados y firmados. **Historial de versiones** lee revisiones cifradas y restaura una versión como cambio firmado nuevo o copia. Un artefacto remoto inválido se aísla en **Integridad y bifurcaciones locales**: puedes reintentarlo, exportar el texto cifrado, marcarlo reparado o ignorarlo. No bloquea el resto de la sincronización y la ausencia remota nunca implica eliminación.
