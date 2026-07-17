# FAQ y solución de problemas

Última actualización: 2026-07-11

Respuestas a las preguntas más frecuentes — desde la compatibilidad con Obsidian hasta los archivos en conflicto y las copias de seguridad.

## Fundamentos

### ¿Dónde viven mis datos?

Exclusivamente contigo: un vault es una carpeta normal de archivos Markdown en tu equipo. Plainva no gestiona ningún servidor propio y no guarda copias en ningún sitio. Si sincronizas, va directamente entre tu equipo y *tu* almacenamiento (tu Nextcloud, tu OneDrive, tu bucket…). Las credenciales viven en el llavero del sistema operativo.

### ¿Puedo usar Plainva y Obsidian en paralelo?

Sí — es una promesa central, con una salvedad honesta. Plainva escribe Markdown puro con frontmatter estándar; todo lo específico de Plainva se agrupa bajo claves `plainva:` (en notas y archivos `.base`), que Obsidian simplemente ignora al abrir los archivos. Obsidian muestra la clave `plainva` como un objeto no editable en sus propiedades — eso es inofensivo. Las vistas exclusivas de Plainva como Tablero o Calendario aparecen en Obsidian como una tabla normal.

La salvedad: **abrir siempre es seguro, editar no siempre.** Un vault de Obsidian existente se puede abrir y editar en Plainva sin riesgo — nada se migra ni se reformatea. Pero en cuanto un vault usa funciones de Plainva (extensiones de base de datos como tableros, relaciones o columnas inversas, archivos `index.md` gestionados), editar esos archivos concretos en Obsidian puede romper la funcionalidad de Plainva, porque Obsidian no conoce las extensiones `plainva:`. Las notas sin extensiones de Plainva se pueden editar en cualquier lugar y en cualquier momento. La primera vez que usas una de estas extensiones, un diálogo recordatorio (**Extensión de Plainva**) lo señala; se puede desactivar en **Configuración → App → Inicio y comportamiento**.

### ¿Plainva modifica mi vault existente?

No sin preguntar. Los archivos existentes solo se tocan cuando inicias una acción explícitamente (p. ej. la [conversión OKF](OKF.md) — con vista previa y copias de seguridad). Solo los archivos recién creados reciben automáticamente el pequeño encabezado frontmatter OKF.

## Archivos y edición

### He eliminado algo — ¿ha desaparecido?

No, por partida doble: antes de cada eliminación, Plainva guarda el archivo como un snapshot — clic derecho en el nombre del vault → **Restaurar archivos eliminados…** lo recupera dentro de la app. Además, los archivos y carpetas eliminados van a la papelera del sistema operativo (para carpetas enteras, la papelera es la vía principal de recuperación). Detalles: [Copias de seguridad e historial de versiones](Backups_and_Versioning.md).

### ¿Hay versiones más antiguas de mis notas?

Sí: Plainva crea automáticamente versiones de archivo mientras editas. Clic derecho en un archivo → **Historial de versiones…** muestra todos los snapshots con una vista de comparación y **Restaurar**. Además, Plainva respalda todo el vault diariamente como un ZIP fuera de la carpeta del vault. Detalles: [Copias de seguridad e historial de versiones](Backups_and_Versioning.md).

### ¿Por qué mi index.md es de solo lectura?

Lo generó Plainva y se mantiene actualizado automáticamente (reconocible por el banner "Este index.md lo gestiona Plainva…"). **Editar de todos modos** lo pasa de forma permanente a tu cuidado manual — dejará de actualizarse automáticamente. Detalles: [OKF](OKF.md).

### ¿Qué pasa al renombrar una propiedad en una base de datos?

El nuevo nombre se escribe en el frontmatter de **todas las notas coincidentes** (tras confirmación, con indicador de progreso). El mismo principio se aplica al eliminar: la casilla **Quitarla también del frontmatter de las notas** limpia igualmente las notas de origen. Ambas acciones actúan sobre tus archivos — exactamente para eso están.

### ¿Puedo deshacer la conversión OKF?

Antes de cualquier cambio, el asistente respalda el archivo en `.plainva/backups/okf-conversion-<marca-de-tiempo>/`. El informe final indica la carpeta exacta; desde ahí puedes copiar archivos individuales de vuelta. Usa también **Vista previa (sin cambios)** antes de convertir.

## Sincronización

### ¿Qué es un archivo .CONFLICT?

Si el mismo archivo se cambió aquí y en otro dispositivo al mismo tiempo, Plainva primero intenta combinar automáticamente ambas versiones. Si eso no es posible, **tu** versión se guarda de forma segura como un archivo `.CONFLICT` junto al original — nunca se pierde nada. Los archivos en conflicto están marcados en el árbol de archivos; con clic derecho eliges **Conservar esta versión** (la versión en conflicto sustituye al original) o **Descartar conflicto**.

### Mi inicio de sesión de Google caduca constantemente

Con la configuración "Bring Your Own", tu proyecto de Google permanece en modo de prueba; Google entonces termina la sesión a los 7 días. Plainva renueva los tokens automáticamente en segundo plano, pero una vez caducados, usa **Volver a conectar** en la configuración de sincronización. Detalles: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

### Mi vault vive en una carpeta de OneDrive/Dropbox/iCloud y Plainva se comporta de forma extraña

Configura la carpeta del vault como "mantener siempre en este dispositivo" / "disponible sin conexión" en el cliente de sincronización del proveedor. Los archivos marcador de posición solo en línea (Files On-Demand, "solo en línea") interfieren con la indexación y la sincronización. Detalles: [Compatibilidad de sincronización](Sync_Compatibility.md).

### Estoy sin conexión — ¿qué pasa con mis cambios?

Se guardan localmente como de costumbre y se acumulan en una cola; en cuanto vuelve la conexión, Plainva los transfiere automáticamente. La barra de estado muestra **En línea**/**Sin conexión**.

### La barra de estado dice Sin conexión aunque tengo internet

Entonces la propia conexión de sincronización está rota — a menudo porque el inicio de sesión ha caducado o las credenciales han cambiado (p. ej. con Google Drive). Haz clic en **Sin conexión** en la barra de estado o en el triángulo de advertencia junto al nombre del vault: el diálogo muestra el mensaje de error exacto, y **Abrir configuración de sincronización** te lleva directamente al formulario del proveedor correspondiente, donde restableces la conexión (p. ej. **Volver a conectar**). Cada clic también dispara de inmediato un nuevo intento de sincronización.

## Aplicación

### ¿Por qué F5 no recarga y dónde está el menú contextual del navegador?

Plainva es una aplicación de escritorio, no una página web. Las teclas de recarga (F5, Ctrl+R) están desactivadas a propósito: una recarga descartaría tus pestañas abiertas y los cambios sin guardar. El menú contextual integrado de la WebView también está oculto; al hacer clic derecho sobre texto seleccionado sigue apareciendo **Copiar**, y el árbol de archivos, las pestañas y las tablas conservan sus propios menús contextuales.

### ¿Por qué no veo animaciones?

Plainva respeta el ajuste "reducir movimiento" de tu sistema. Si faltan las transiciones y los efectos (los botones, menús y resaltados no se mueven), las animaciones están desactivadas en tu sistema operativo. En **Windows**: Configuración → Accesibilidad → Efectos visuales → activa **Efectos de animación**. En **macOS**: Ajustes del Sistema → Accesibilidad → Pantalla → desactiva **Reducir movimiento**.

### ¿Cómo cambio el idioma?

**Configuración → App → Apariencia → Idioma** (actualmente alemán e inglés).

### "Buscar actualizaciones" no encuentra nada

Mientras no haya releases públicas todavía, la búsqueda de actualizaciones informa: "Aún no hay actualizaciones públicas (releases) disponibles." Eso no es un error.

### ¿Hay funciones ocultas?

La Flota Estelar, por principio, no comenta rumores. Pero se dice que el logo de la barra de título responde a llamadas persistentes — y quien conozca después las palabras adecuadas verá Plainva bajo una luz completamente nueva. Algunos dicen: en cuatro.

## Ver también

- [Configurar la sincronización](Sync_Setup.md) y [Compatibilidad de sincronización](Sync_Compatibility.md)
- [OKF](OKF.md) — conversión, index.md, campos de sistema
