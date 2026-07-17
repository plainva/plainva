# Configurar OneDrive y Dropbox (registro de app propio)

Última actualización: 2026-07-11

**Normalmente no necesitas esta página:** Plainva incluye sus propios IDs de app para OneDrive y Dropbox — eliges el proveedor, haces clic en **Conectar** e inicias sesión. Esta guía es solo para el caso **opcional** en el que quieras usar tu propio registro de app (gratuito) (p. ej. por restricciones corporativas). En la configuración de sincronización, revela los campos de ID mediante **Usar tu propio ID de aplicación** y luego introduce un único valor público:

- **OneDrive** → un **Client ID** (formato `00000000-0000-0000-0000-000000000000`)
- **Dropbox** → una **App Key** (una cadena corta)

Ambos registros son gratuitos, no necesitan tarjeta de crédito ni ninguna suscripción de pago. **No** necesitas una contraseña secreta (client secret) — los valores anteriores son públicos y se pueden guardar sin riesgo.

Esta página es el complemento detallado de las versiones cortas en [Configurar la sincronización](Sync_Setup.md).

> Los IDs incluidos con Plainva ya vienen precargados — las Partes A/B siguientes solo las necesitas para tu **propio** registro.

---

## Parte A — OneDrive (Microsoft Entra)

**Requisito previo:** una cuenta de Microsoft (la misma cuyo OneDrive quieres sincronizar). Al iniciar sesión por primera vez, Microsoft crea automáticamente un directorio gratuito para ti — no se necesita ninguna suscripción de Azure.

### 1. Abrir el portal

1. Ve a **[entra.microsoft.com](https://entra.microsoft.com)** (`portal.azure.com` también funciona).
2. Inicia sesión con tu cuenta de Microsoft.

### 2. Crear un nuevo registro de app

1. Menú **Identidad → Aplicaciones → Registros de aplicaciones**, luego **+ Nuevo registro**.
2. **Nombre:** libre elección, p. ej. `Plainva` (solo a efectos de visualización).
3. **Tipos de cuenta admitidos:** elige **"Cuentas en cualquier directorio organizativo … y cuentas personales de Microsoft"**. Solo esta opción coincide con el endpoint de inicio de sesión de Plainva; "solo este directorio" hace que las cuentas personales de OneDrive fallen.
4. **URI de redirección** — resuélvelo aquí mismo:
   - Plataforma: **"Cliente público/nativo (móvil y escritorio)"**.
   - Valor: `http://localhost` (exactamente así — sin puerto, sin barra al final).

   > ⚠️ No elijas "Web" ni "SPA". "Web" requiere un client secret y el inicio de sesión fallará.
5. **Registrar**.

### 3. Copiar el Client ID

En la **Información general** de la app, copia el **"ID de aplicación (cliente)"** — ese es tu valor para Plainva. (No necesitas el "ID de directorio (inquilino)").

### 4. Permitir flujos de cliente público

1. Menú **Autenticación**.
2. Al final de todo, pon **"Permitir flujos de cliente público"** en **Sí**.
3. **Guardar**.

### 5. Establecer los permisos

1. Menú **Permisos de API → + Agregar un permiso → Microsoft Graph → Permisos delegados**.
2. Marca ambos:
   - `Files.ReadWrite`
   - `offline_access` (proporciona el token de inicio de sesión de larga duración — **sin él** Plainva se niega a conectarse)
3. **Agregar**. No se necesita consentimiento del administrador para cuentas personales; das tu propio consentimiento al iniciar sesión.

### Introducirlo en Plainva

1. **Configuración → Vault → Sincronización**.
2. Establece el **Proveedor de sincronización** en **OneDrive**.
3. Pega el ID de aplicación copiado en el campo **Client ID**; opcionalmente define la **Carpeta de OneDrive (nombre)** (por defecto `Plainva`).
4. **Conectar con Microsoft** → inicia sesión en el navegador y confirma el acceso. El navegador te indicará después que puedes cerrar la ventana.

---

## Parte B — Dropbox

**Requisito previo:** una cuenta de Dropbox.

### 1. Abrir la consola de apps

1. Ve a **[dropbox.com/developers/apps](https://www.dropbox.com/developers/apps)** e inicia sesión.
2. Haz clic en **Create app**.

### 2. Elegir el tipo de app

1. **Choose an API:** **Scoped access**.
2. **Type of access:** **Full Dropbox** — no "App folder".

   > ⚠️ **Full Dropbox** es obligatorio: "App folder" solo ve una subcarpeta aislada y no encontrará los vaults existentes en el resto de tu Dropbox.
3. **Name:** un nombre único a nivel mundial, p. ej. `Plainva-Sync-<tunombre>` (solo técnico, nadie más lo verá).
4. **Create app**.

### 3. Registrar el URI de redirección

Pestaña **Settings → OAuth 2 → Redirect URIs**: introduce **exactamente** `http://127.0.0.1:41953` y haz clic en **Add**.

> ⚠️ Debe coincidir carácter por carácter: `127.0.0.1` (no `localhost`), puerto `41953`, sin barra al final. Plainva se vincula exactamente a este puerto; cualquier desviación cancela el inicio de sesión.

### 4. Establecer los permisos

Pestaña **Permissions** — marca lo siguiente y haz clic en **Submit** al final:

- `files.metadata.read`
- `files.content.read`
- `files.content.write`

> ⚠️ Si cambias los permisos más adelante, debes pulsar **Reconnect** en Plainva; de lo contrario, seguirán aplicándose los derechos antiguos.

### 5. Copiar la App key

Pestaña **Settings**: copia el valor **App key** — ese es tu valor para Plainva. (No necesitas el "App secret").

> Tu app permanece en estado "Development". Eso es suficiente para uso privado; "Apply for production" solo es necesario si muchas otras personas van a usar la misma App key.

### Introducirlo en Plainva

1. **Configuración → Vault → Sincronización**.
2. Establece el **Proveedor de sincronización** en **Dropbox**.
3. Pega la App key copiada en el campo **App Key**; opcionalmente define la **Carpeta de Dropbox (ruta)** (por defecto `/Plainva`).
4. **Conectar con Dropbox** → inicia sesión en el navegador y confirma el acceso.

---

## Si algo falla

| Síntoma | Causa | Solución |
|---|---|---|
| OneDrive: "Microsoft returned no refresh_token" | falta `offline_access` | Paso A5: añade `offline_access`, luego **Volver a conectar** |
| OneDrive: el inicio de sesión pide un secreto / falla | Plataforma "Web" en lugar de "Móvil y escritorio" | Paso A2: plataforma **Cliente público/nativo**, redirect `http://localhost` |
| OneDrive: se rechaza la cuenta personal | Tipo de cuenta incorrecto | Paso A2: elige "… y cuentas personales de Microsoft" |
| Dropbox: el inicio de sesión se queda colgado / "redirect_uri mismatch" | El redirect no es exacto | Paso B3: exactamente `http://127.0.0.1:41953` |
| Dropbox: "Port 41953 is in use" | Otro programa bloquea el puerto | Cierra la aplicación que lo bloquea e inténtalo de nuevo |
| Dropbox: no encuentra el vault / faltan permisos | "App folder" en lugar de "Full Dropbox", o no se pulsó **Submit** en los permisos | Revisa el paso B2 / B4, luego **Volver a conectar** |

## Ver también

- [Configurar la sincronización](Sync_Setup.md) — versión corta y los demás proveedores
- [Compatibilidad de sincronización](Sync_Compatibility.md) — qué servicios funcionan y cómo
- [FAQ y solución de problemas](FAQ.md)
