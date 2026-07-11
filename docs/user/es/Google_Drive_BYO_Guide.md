# Configurar la sincronización con Google Drive (credenciales propias, BYO)

Stand: 2026-07-11

Para sincronizar un vault local con tu Google Drive en Plainva, puedes usar tus propias credenciales de la API de Google. Dado que Plainva (todavía) no ha pasado la verificación central CASA de Google, este enfoque de **credenciales propias (Bring Your Own, BYO)** ofrece una forma segura de sincronizar tus archivos privados.

En esencia, configuras tu propio pequeño "proyecto de desarrollador" en Google, que te pertenece solo a ti y al que solo tú puedes acceder.

## Guía paso a paso

### 1. Crear un proyecto en Google Cloud Console
1. Ve a la [Google Cloud Console](https://console.cloud.google.com/).
2. Inicia sesión con tu cuenta de Google.
3. Arriba a la izquierda (junto al logo de Google Cloud), abre el desplegable de proyectos y elige **New Project**.
4. Introduce un nombre (p. ej. "Plainva Sync") y haz clic en **Create**.

### 2. Activar la API de Google Drive
1. Selecciona tu proyecto recién creado en el desplegable de arriba.
2. Busca **Google Drive API** en la barra de búsqueda superior y elige la entrada bajo "Marketplace".
3. Haz clic en **Enable**.

### 3. Configurar la pantalla de consentimiento OAuth
Para que Plainva use tus credenciales, hay que configurar una pantalla de consentimiento ("OAuth Consent Screen"). Como solo tú usas la app, se queda en modo "testing".

1. En el menú lateral izquierdo, bajo **APIs & Services**, abre **OAuth consent screen**.
2. En "User Type" elige **External** (a menos que uses Google Workspace) y haz clic en **Create**.
3. **App information:**
   - App name: p. ej. "Plainva"
   - User support email: tu propio correo electrónico
   - Developer contact information: tu propio correo electrónico
   - Haz clic en **Save and Continue**.
4. **Scopes:**
   - Haz clic en **Add or Remove Scopes**.
   - Busca `.../auth/drive` (Google Drive API, acceso completo) y marca la casilla.
   - *Contexto: se necesita acceso completo para que Plainva también pueda sincronizar archivos que colocas en tu carpeta de sincronización mediante la interfaz web de Google Drive.*
   - Haz clic en Update, luego en **Save and Continue**.
5. **Test users:**
   - Haz clic en **Add Users**.
   - Introduce exactamente la dirección de correo de Google que usarás más adelante para la sincronización en Plainva.
   - Haz clic en **Save and Continue** y vuelve al panel.

*Importante: deja el estado en "Testing". NO necesitas publicar la app. En modo de prueba, los tokens caducan a los 7 días — Plainva los renueva automáticamente en segundo plano, pero tras cambios importantes o cambios de scope puede que tengas que volver a iniciar sesión.*

### 4. Crear credenciales (Client ID y Secret)
1. Abre **Credentials** en el menú de la izquierda.
2. Haz clic en **Create Credentials** arriba y elige **OAuth client ID**.
3. Como "Application type" elige **Desktop app** (o "Other UI").
4. Nombre: p. ej. "Plainva Desktop Client".
5. Haz clic en **Create**.
6. Aparece una ventana emergente con tu **Client ID** y **Client Secret**.

### 5. Introducirlos en Plainva
1. Abre Plainva y ve a la configuración del vault (icono de engranaje del vault en cuestión).
2. Abre la sección **Sincronización**.
3. Elige **Google Drive** como proveedor.
4. Pega el **Client ID** y el **Client Secret** copiados en los campos correspondientes.
5. Haz clic en **Conectar con Google**.
6. Se abre una ventana del navegador de Google. Inicia sesión con la cuenta que añadiste en "Test users".
7. Google puede avisar de que la app no está verificada. Haz clic en **Advanced** y luego en **Continue to Plainva (unsafe)**.
8. Confirma los permisos solicitados.

Tu vault ahora se sincroniza de forma segura con Google Drive a través de tus propias credenciales.
