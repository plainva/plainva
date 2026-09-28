# Asystent AI (Beta)

Stan na: 2026-09-24

Plainva potrafi odpowiadać na pytania o notatki za pomocą wybranego modelu AI. Czyta vault, przywołuje notatki, z których korzystała, i może otwierać notatki oraz widoki — niczego nie zmienia. Asystent jest **eksperymentalny** i wyłączony, dopóki nie zostanie włączony, osobno na każdym urządzeniu.

## Włączanie

Otwórz **Ustawienia → AI & automatyzacja** (część aplikacji) i włącz **Używaj AI na tym urządzeniu**. Bez tego przełącznika nie ma przycisku AI, karty AI ani asystenta. Nic nie zostanie nigdzie wysłane, dopóki o coś nie zapytasz.

## Wybór dostawcy

Plainva nie ma własnej usługi AI: korzysta się z wybranego dostawcy, z własnym kluczem. Każdego dostawcę można wybrać; Plainva podaje ich warunki i czas przechowywania, aby decyzja należała do użytkownika — sama nikogo nie wyklucza.

| Rodzaj | Dostawcy |
|---|---|
| Dostawcy w chmurze | Anthropic, OpenAI, Google Gemini |
| Pośrednicy i własne serwery | OpenRouter, dowolny **serwer kompatybilny z OpenAI** |
| Na tym komputerze (desktop) | Ollama, LM Studio |

1. W **AI & automatyzacja** wybierz **Dodaj dostawcę** i wskaż jednego z nich. Każdy wpis niesie krótką uwagę o swoich warunkach — na przykład, że w bezpłatnym dostępie Google dane wejściowe mogą czytać ludzie.
2. Wpisz klucz przyciskiem **Wpisz klucz**. Klucz trafia do bezpiecznego magazynu tego urządzenia; Plainva nigdy nie pokazuje go ponownie — ani AI, ani na ekranie.
3. **Przetestuj połączenie** wczytuje własną listę modeli dostawcy. Jeśli się nie powiedzie, komunikat mówi dlaczego (odrzucony klucz, brak połączenia, nieznany model).

Taki **serwer kompatybilny z OpenAI** dodaje się, podając jego adres. Plainva pyta jeszcze raz przed dodaniem, w oknie systemu operacyjnego, i wysyła tylko na potwierdzony adres. Zwykłe `http` działa tylko dla serwera na tym urządzeniu; wszystko inne wymaga `https`.

Jeśli nie masz jeszcze klucza: model na tym komputerze (Ollama, LM Studio) nic nie kosztuje, a konsola każdego dostawcy wydaje klucze.

## Modele i profile

Cztery profile — **Szybki**, **Zrównoważony**, **Silny** i **Lokalny** — służą do przypisania modeli. Dla każdego wybierz dostawcę i model, z listy dostawcy albo wpisując identyfikator modelu dokładnie tak, jak nazywa go dostawca. **Domyślny dla nowych rozmów** decyduje, którym profilem zaczyna się nowa rozmowa. Plainva nie ogłasza żadnego modelu „najlepszym”.

## Zadawanie pytań

- **Desktop:** przycisk AI na pasku akcji, **Ctrl+J** (⌘J w macOS) lub **Zapytaj AI** w palecie poleceń otwiera asystenta — małe okno nad bieżącą pracą. **Otwórz jako kartę** przenosi tę samą rozmowę do karty AI, gdzie wyświetlana jest lista rozmów.
- **Telefon:** **Zapytaj AI** w menu ⋮ notatki otwiera arkusz AI nad tą notatką. Obszar **AI** (w arkuszu obszarów albo na pasku nawigacji, jeśli zostanie tam umieszczony) pokazuje rozmowę na pełnym ekranie; **Rozmowy** pokazują wcześniejsze.

Otwarta notatka jest dołączana automatycznie; można ją usunąć z kontekstu jej ✕, jeśli trzeba. **Przypnij notatkę…** dodaje kolejne notatki. Asystent potrafi też sam czegoś poszukać: przeszukuje vault, czyta notatki i ich sekcje, wyświetla listę zadań oraz otwiera notatki i widoki. Nie potrafi niczego zmienić, utworzyć ani usunąć.

Każda rozmowa zaczyna się od wiersza „Odpowiedzi pisze AI — ⟨model⟩ przez ⟨dostawca⟩”. Pod każdą odpowiedzią widnieje wiersz z informacją, co dokąd zostało wysłane: ile notatek, w przybliżeniu ile tokenów i — tam, gdzie dostawca publikuje ceny — przybliżony koszt. **Zatrzymaj** kończy odpowiedź w każdej chwili.

Link w odpowiedzi otwiera się dopiero po potwierdzeniu jego adresu, a obrazy w odpowiedziach nigdy nie są wczytywane.

## Zasady prywatności

Niektóre notatki nigdy nie powinny trafić do dostawcy w chmurze. Reguła może znajdować się we frontmatterze notatki:

```yaml
plainva:
  ai:
    cloud: deny
```

albo, dla całego folderu, w **Ustawienia → AI & automatyzacja** (część vaultu), skąd reguły trafiają do `.agent/policy.yml`. Notatka trzymana z dala od chmury nie wnosi niczego — ani tekstu, ani tytułu — a linki do niej w innych notatkach są wstrzymywane. Modele na tym urządzeniu pozostają dozwolone. Zaszyfrowane obszary robocze trzymają chmurę z dala, chyba że zostanie tam dopuszczona. Dokładny format znajduje się w [Dokumentacji formatu plików](File_Format_Reference.md).

## Historia i zużycie

Rozmowy zostają na tym urządzeniu, dla każdego vaultu — nigdy w vaulcie i nigdy niesynchronizowane. **Przechowuj rozmowy** decyduje, jak długo; pojedyncze rozmowy można usuwać na liście, a wszystkie rozmowy danego vaultu naraz. **Zużycie w tym miesiącu** sumuje tokeny według dostawcy i modelu.

## Ograniczenia wersji beta

- Na komputerze AI działa tylko w głównym oknie.
- Na telefonie odpowiedź pojawia się tylko, gdy aplikacja jest otwarta.
- Asystent czyta; proponowanie zmian w formie sugestii pojawi się w kolejnej wersji.
