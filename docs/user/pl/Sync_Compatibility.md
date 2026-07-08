# Zgodność synchronizacji Plainva

Stan na: 2026-07-04 (zaktualizowano po integracji OneDrive, Dropbox i S3)

Plainva synchronizuje vaulty przez wymienne adaptery synchronizacji. Ta strona pokazuje, które usługi możesz już dziś wykorzystać — bezpośrednio zintegrowane, przez protokół WebDAV lub przez własnego klienta desktopowego danego dostawcy.

## Bezpośrednio zintegrowane

| Dostawca | Status | Uwagi |
|---|---|---|
| Folder lokalny | Dostępny | Nie wymaga konfiguracji; zmiany zewnętrzne (np. przez inne narzędzia synchronizacji) są wykrywane automatycznie. |
| WebDAV / Nextcloud | Dostępny, zweryfikowany z Nextcloud | Adres URL serwera, nazwa użytkownika i (zalecane) hasło aplikacji. |
| Google Drive | Dostępny (dane dostępowe BYO) | Wymaga własnego projektu Google Cloud, patrz [przewodnik Google Drive BYO](Google_Drive_BYO_Guide.md). |
| OneDrive | Dostępny (nowość 2026-07-04, natywna weryfikacja w toku) | Logowanie przez przeglądarkę (PKCE, bez secretu). Zanim Plainva dostarczy własną rejestrację aplikacji, potrzebujesz własnej (darmowej) rejestracji aplikacji Entra: typ „Mobile and desktop applications”, identyfikator URI przekierowania `http://localhost`. |
| Dropbox | Dostępny (nowość 2026-07-04, natywna weryfikacja w toku) | Logowanie przez przeglądarkę (PKCE, bez secretu). Zanim Plainva dostarczy własną aplikację, potrzebujesz własnej (darmowej) aplikacji Dropbox: dostęp full-Dropbox, identyfikator URI przekierowania dokładnie `http://127.0.0.1:41953`. |
| Magazyn obiektowy zgodny z S3 | Dostępny (nowość 2026-07-04, natywna weryfikacja w toku) | AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner i inne — wystarczy endpoint, bucket, region i para kluczy API; bez logowania w przeglądarce. |

## Usługi dostępne przez WebDAV

Adapter WebDAV obsługuje standardowy WebDAV, więc powinny działać m.in. następujące usługi. Nie zostały jeszcze zweryfikowane indywidualnie — informacje zwrotne są mile widziane. Adresy to typowe wzorce; w razie wątpliwości sprawdź je w dokumentacji swojego dostawcy i używaj w miarę możliwości hasła aplikacji zamiast głównego hasła.

| Usługa | Typowy adres WebDAV |
|---|---|
| Nextcloud (samodzielnie hostowany lub u dostawcy) | `https://<serwer>/remote.php/dav/files/<użytkownik>/` |
| ownCloud | `https://<serwer>/remote.php/dav/files/<użytkownik>/` |
| Koofr | `https://app.koofr.net/dav/Koofr` |
| Strato HiDrive | `https://webdav.hidrive.strato.com` |
| MagentaCLOUD (Telekom) | `https://magentacloud.de/remote.php/dav/files/<użytkownik>/` |
| GMX Mediacenter | `https://webdav.mc.gmx.net` |
| WEB.DE online storage | `https://webdav.smartdrive.web.de` |
| Hetzner Storage Box | `https://<użytkownik>.your-storagebox.de` |
| Synology NAS | Włącz pakiet WebDAV Server, następnie `https://<nas>:5006` |
| QNAP NAS | Włącz WebDAV w systemie; adres według dokumentacji QNAP |
| Seafile | Włącz SeafDAV, następnie `https://<serwer>/seafdav` |

## Przez klienta desktopowego dostawcy (folder lokalny)

Do czasu pojawienia się natywnych integracji możesz używać dowolnej usługi, której klient desktopowy utrzymuje synchronizację lokalnego folderu. Plainva traktuje wtedy vault jako folder lokalny i automatycznie wykrywa zmiany zewnętrzne.

**Ważne:** Ustaw folder vaultu na „zawsze przechowuj na tym urządzeniu” / „dostępny offline”. Pliki zastępcze typu online-only (Files On-Demand, tryb online-only, tryb strumieniowania) mogą zakłócać indeksowanie i synchronizację.

- **OneDrive** (integracja z Eksploratorem; wyłącz Files On-Demand dla folderu vaultu)
- **Dropbox** (klient desktopowy; unikaj trybu „online-only” dla folderu vaultu)
- **Google Drive for Desktop** (tryb „Mirror” zamiast „Stream” dla folderu vaultu)
- **iCloud Drive** (iCloud dla Windows lub macOS; ustaw folder na „Zawsze pobrany”)
- **Syncthing / Resilio Sync** (P2P, bez żadnego dostawcy chmury)

## Uwaga o nowych integracjach (2026-07-04)

OneDrive, Dropbox i magazyn zgodny z S3 są bezpośrednio zintegrowane od 2026-07-04 (patrz tabela powyżej) — wcześniej niż planowano w etapowaniu masterplanu (§13.3). Gdy Plainva dostarczy centralne rejestracje aplikacji dla OneDrive i Dropbox, krok z własnym client ID lub app key zniknie; pola będą wtedy wstępnie wypełnione. Droga przez klienta synchronizacji desktopowej (patrz wyżej) pozostaje dostępna jako alternatywa.

## Świadomie nieplanowane

- **iCloud jako integracja API:** Apple nie oferuje oficjalnego API dla iCloud Drive dla firm trzecich. Zamiast tego użyj lokalnego folderu iCloud (patrz wyżej).
- **Proton Drive / Mega:** brak oficjalnego lub tylko trudno integrowalne API (szyfrowanie E2E, SDK w C++). Pozostaje obserwowane.
- **Lista obserwowana** (na życzenie): pCloud, Box, Filen, SFTP.
