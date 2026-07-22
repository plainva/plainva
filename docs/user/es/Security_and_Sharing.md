# Seguridad y uso compartido

Revisado: 2026-07-22

Plainva mantiene el vault como archivos legibles en el dispositivo y guarda la copia en la nube como objetos cifrados opacos. Tras conectar una cuenta, abre **Ajustes → tu vault → Seguridad y uso compartido**.

## Configuración

1. Elige nombres para propietario y dispositivo. Las claves quedan en el llavero del sistema o, si no está disponible, bajo una frase local.
2. Guarda el archivo `.pvrecovery`, conserva el código por separado e introduce los dos grupos solicitados. Se necesitan ambas partes; ninguna incluye credenciales de nube.
3. Activa el workspace. Plainva publica la política firmada y cifra todos los archivos en `.pvws/`. El vault local sigue legible y la migración se reanuda tras interrupciones.

El texto sin cifrar existente permanece junto a `.pvws/` durante la migración. Solo con estado **Protegido** puedes eliminarlo explícitamente; nunca se borran archivos locales.

Los cambios sin conexión permanecen en una cola duradera. Las eliminaciones requieren tombstones firmados y los cambios paralelos se conservan como copias `.CONFLICT-…`. Dispositivos adicionales, restauración, equipos y slices llegan en fases posteriores.
