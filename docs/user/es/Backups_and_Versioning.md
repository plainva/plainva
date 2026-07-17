# Copias de seguridad y versionado

Última actualización: 2026-07-11

Plainva protege tu trabajo en dos niveles: **versiones de archivo** (snapshots automáticos de cada archivo individual al editar y eliminar) y **copias de seguridad del vault** (archivos ZIP periódicos de todo el vault, guardados fuera de la carpeta del vault). Ambos funcionan en segundo plano sin ninguna configuración y se pueden ajustar en la configuración bajo **Copias de seguridad y versionado**.

## Versiones de archivo (snapshots)

Antes de cada guardado, Plainva almacena un snapshot del estado anterior — como una copia de texto plano bajo `.plainva/backups/` dentro del vault (esta carpeta está oculta en el árbol de archivos, en la búsqueda y en la sincronización). Para evitar cientos de copias mientras escribes, se aplica un **Intervalo de snapshots** (predeterminado: como máximo una versión nueva cada 2 minutos). **Eliminar siempre crea un snapshot**, independientemente del intervalo.

Retención (configurable por vault):

- **Intervalo de snapshots**: En cada cambio / 30 s / 2 min / 5 min / 10 min
- **Versiones por archivo**: predeterminado 100 — por encima de esa cifra se eliminan las más antiguas
- **Antigüedad máxima**: predeterminado 90 días — las versiones más antiguas se eliminan **permanentemente** en una limpieza diaria ("Ilimitado" desactiva esto)

Al renombrar o mover un archivo, su historial de versiones se traslada con él.

## Ver y restaurar versiones

Haz clic derecho en un archivo del árbol de archivos (o en su pestaña), o usa el menú **⋮** arriba a la derecha del editor → **Historial de versiones…** abre la lista de versiones:

- El lado izquierdo lista todos los snapshots agrupados por día, con hora y tamaño.
- El lado derecho muestra una vista previa; para archivos de texto, **Comparar con la versión actual** muestra la versión seleccionada junto al contenido actual (la versión antigua a la izquierda, el estado actual a la derecha).
- **Restaurar** reemplaza el contenido actual con la versión seleccionada. No te preocupes: el estado actual se guarda primero como un snapshot — así que una restauración siempre se puede deshacer.
- **Restaurar como copia** crea la versión como un archivo nuevo junto al original (`Name (Version 2026-07-05 14-30).md`) sin tocarlo.

Las imágenes también tienen versiones (con vista previa); otros archivos binarios se pueden restaurar sin vista previa.

## Restaurar archivos eliminados

Como cada eliminación crea antes un snapshot del archivo, Plainva puede recuperar archivos eliminados: haz clic derecho en el nombre del vault en la parte superior del árbol de archivos → **Restaurar archivos eliminados…** (también accesible desde la configuración). La lista muestra todos los archivos cuyos snapshots todavía existen mientras el original ha desaparecido — **Restaurar** recrea el estado más reciente en la ubicación original (las carpetas se recrean según sea necesario), **Versiones…** abre el historial completo del archivo eliminado.

Nota: eliminar una **carpeta entera** la traslada a la papelera del sistema operativo — en ese caso la papelera del sistema es la vía principal de recuperación; en Plainva es posible que solo encuentres snapshots más antiguos de los archivos que contenía.

## Copias de seguridad automáticas del vault (ZIP)

Además, Plainva respalda todo el vault como un archivo ZIP — de forma predeterminada **diariamente** en segundo plano (al abrir el vault, si la última copia de seguridad tiene más de 24 horas). Esto te protege incluso si la propia carpeta del vault se pierde o se daña, porque los ZIP viven **fuera** del vault:

- El destino predeterminado es la carpeta de datos de la aplicación (mostrada bajo **Carpeta de destino** en la configuración; **Abrir carpeta** te lleva directamente allí).
- Mediante **Elegir carpeta…** puedes elegir en su lugar una unidad externa o un NAS; **Predeterminada** vuelve a la carpeta de datos de la aplicación. Si el destino no está disponible en ese momento (NAS apagado), la barra de estado lo indica discretamente y Plainva vuelve a intentarlo más tarde.
- **Copias a conservar** (predeterminado: 7) limita la cantidad; los ZIP más antiguos del mismo vault se eliminan automáticamente. Los archivos ajenos en la carpeta de destino nunca se tocan.
- **Crear copia de seguridad ahora** inicia una copia de seguridad manualmente en cualquier momento; la barra de estado muestra el proceso y su resultado.

Los archivos ZIP se nombran `VaultName_2026-07-05_14-30-00.zip` y contienen todas las notas, archivos adjuntos y tu configuración de `.obsidian` — **no** contienen la carpeta interna `.plainva` (el índice de búsqueda se reconstruye la próxima vez que se abre; las versiones de archivo deliberadamente no forman parte del ZIP).

**Restaurar desde un ZIP:** el ZIP es un archivo completamente normal. Extráelo donde quieras y abre la carpeta extraída en Plainva como un vault — listo.

## Configuración de un vistazo

Configuración → **Vault** → **Copias de seguridad y versionado**:

| Ajuste | Predeterminado | Significado |
|---|---|---|
| **Copia de seguridad automática del vault (ZIP)** | Activado | ZIP diario en segundo plano |
| **Carpeta de destino** | Carpeta de datos de la aplicación | Dónde se guardan los ZIP, libremente elegible |
| **Copias a conservar** | 7 | Este número de ZIP se conservan |
| **Intervalo de snapshots** | 2 min | Como máximo con esta frecuencia se crea una nueva versión de archivo mientras escribes |
| **Versiones por archivo** | 100 | Límite superior por archivo |
| **Antigüedad máxima** | 90 días | Las versiones más antiguas se eliminan permanentemente |

## Bueno saberlo

- Las versiones de archivo son copias normales bajo `.plainva/backups/` — si hace falta, puedes abrirlas sin Plainva en cualquier gestor de archivos.
- La propia sincronización de Plainva nunca transfiere `.plainva`. Si sincronizas la carpeta del vault con un cliente de terceros (p. ej. la app de Nextcloud), los snapshots viajan también — eso cuesta algo de espacio, pero no hace daño.
- Los conflictos de sincronización están protegidos adicionalmente mediante archivos `.CONFLICT` (ver [FAQ](FAQ.md)); el historial de versiones complementa eso con la línea temporal de cada archivo.
