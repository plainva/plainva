import AppIntents
import Foundation

/**
 * Plainva as a tool of the system's assistant (AI harness P4.7): what Siri,
 * Shortcuts and Apple Intelligence can ask of the app.
 *
 * Four intents, and every one of them does the same two things and nothing
 * else: it READS the directory the app wrote (`IntentStore`, the titles the
 * system may know), and it LEAVES AN ORDER the app redeems when it next comes
 * to the front. No intent reads a note, and no intent writes into the vault:
 * no JavaScript runs while Plainva is closed, and what writing a journal
 * entry or a task means — the daily note, the task database, the sync — lives
 * there. Rebuilding it in Swift would be a second truth about it.
 *
 * So "Open ⟨note⟩" and "Search" bring the app to the front, where it finds the
 * order at once. "Add a journal entry" and "Add a task" do not: what was said
 * is kept with the moment it was said, and the answer says honestly that
 * Plainva writes it down when it is next opened.
 *
 * What is found is only what the directory holds: no note the privacy rules
 * keep from the cloud or from web access, nothing of an encrypted workspace,
 * and nothing at all until the device's switch is on.
 */

private func words(_ key: String.LocalizationValue) -> LocalizedStringResource {
    LocalizedStringResource(key, table: "PlainvaIntents")
}

/// A note of the open vault, as the system may know it: a title and the name of its folder.
struct PlainvaNoteEntity: AppEntity {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: LocalizedStringResource("Note", table: "PlainvaIntents"))
    static var defaultQuery = PlainvaNoteQuery()

    /// The note's key in the directory. Never a path; the app alone knows which note it means.
    var id: String
    var title: String
    var folder: String?

    var displayRepresentation: DisplayRepresentation {
        if let folder = folder {
            return DisplayRepresentation(title: "\(title)", subtitle: "\(folder)")
        }
        return DisplayRepresentation(title: "\(title)")
    }

    init(_ note: IntentNote) {
        id = note.key
        title = note.title
        folder = note.folder
    }
}

struct PlainvaNoteQuery: EntityStringQuery {
    private func directory() -> IntentDirectoryFile? {
        (try? IntentStore())?.readDirectory()
    }

    /// A note somebody chose before — in a saved shortcut, say. It is still found while it is still in the directory.
    func entities(for identifiers: [String]) async throws -> [PlainvaNoteEntity] {
        guard let directory = directory() else { return [] }
        let wanted = Set(identifiers)
        return directory.notes.filter { wanted.contains($0.key) }.map(PlainvaNoteEntity.init)
    }

    /// What somebody said, matched against the titles the system may know.
    func entities(matching string: String) async throws -> [PlainvaNoteEntity] {
        guard let directory = directory() else { return [] }
        return IntentSearch.matches(string, in: directory.notes).map(PlainvaNoteEntity.init)
    }

    /// The notes changed last: what a picker shows before anything is typed.
    func suggestedEntities() async throws -> [PlainvaNoteEntity] {
        guard let directory = directory() else { return [] }
        return directory.notes.prefix(12).map(PlainvaNoteEntity.init)
    }
}

/// Leaves an order and tells the running app, if there is one, that it did.
private func record(kind: String, text: String, key: String? = nil) -> Bool {
    guard let store = try? IntentStore() else { return false }
    let id = store.enqueue(kind: kind, text: text, key: key, at: Int64(Date().timeIntervalSince1970 * 1000))
    guard id != 0 else { return false }
    NotificationCenter.default.post(name: IntentBridgePlugin.orderRecorded, object: nil)
    return true
}

struct OpenNoteIntent: AppIntent {
    static var title: LocalizedStringResource = LocalizedStringResource("Open Note", table: "PlainvaIntents")
    static var description = IntentDescription(LocalizedStringResource("Opens a note of the open vault in Plainva.", table: "PlainvaIntents"))
    /// The note is shown in the app: it comes to the front and finds the order there.
    static var openAppWhenRun: Bool = true
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: LocalizedStringResource("Note", table: "PlainvaIntents"), requestValueDialog: IntentDialog(LocalizedStringResource("Which note?", table: "PlainvaIntents")))
    var note: PlainvaNoteEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$note)", table: "PlainvaIntents")
    }

    func perform() async throws -> some IntentResult {
        _ = record(kind: "open", text: note.title, key: note.id)
        return .result()
    }
}

struct SearchNotesIntent: AppIntent {
    static var title: LocalizedStringResource = LocalizedStringResource("Search Notes", table: "PlainvaIntents")
    static var description = IntentDescription(LocalizedStringResource("Opens Plainva's search with the words you say.", table: "PlainvaIntents"))
    static var openAppWhenRun: Bool = true
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: LocalizedStringResource("Search for", table: "PlainvaIntents"), requestValueDialog: IntentDialog(LocalizedStringResource("What should Plainva search for?", table: "PlainvaIntents")))
    var query: String

    static var parameterSummary: some ParameterSummary {
        Summary("Search for \(\.$query)", table: "PlainvaIntents")
    }

    func perform() async throws -> some IntentResult {
        _ = record(kind: "search", text: query)
        return .result()
    }
}

struct AddJournalEntryIntent: AppIntent {
    static var title: LocalizedStringResource = LocalizedStringResource("Add Journal Entry", table: "PlainvaIntents")
    static var description = IntentDescription(LocalizedStringResource("Notes what you say as an entry of today's journal. Plainva writes it down when it is next opened.", table: "PlainvaIntents"))
    /// The app stays closed: what was said waits, with the moment it was said.
    static var openAppWhenRun: Bool = false
    /// What is said here ends up in the vault as the person's own words. So it is taken from somebody the
    /// device knows — unlocked, or vouched for by a watch or a car — and not from any voice near a locked phone.
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: LocalizedStringResource("Entry", table: "PlainvaIntents"), requestValueDialog: IntentDialog(LocalizedStringResource("What should the entry say?", table: "PlainvaIntents")))
    var entry: String

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$entry) to the journal", table: "PlainvaIntents")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        if record(kind: "journal", text: entry) {
            return .result(dialog: IntentDialog(words("Noted. Plainva writes it into the journal when it is next opened.")))
        }
        return .result(dialog: IntentDialog(words("Plainva could not take this right now.")))
    }
}

struct AddTaskIntent: AppIntent {
    static var title: LocalizedStringResource = LocalizedStringResource("Add Task", table: "PlainvaIntents")
    static var description = IntentDescription(LocalizedStringResource("Notes what you say as a task. Plainva creates it when it is next opened.", table: "PlainvaIntents"))
    static var openAppWhenRun: Bool = false
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: LocalizedStringResource("Task", table: "PlainvaIntents"), requestValueDialog: IntentDialog(LocalizedStringResource("What is the task?", table: "PlainvaIntents")))
    var task: String

    static var parameterSummary: some ParameterSummary {
        Summary("Add the task \(\.$task)", table: "PlainvaIntents")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        if record(kind: "task", text: task) {
            return .result(dialog: IntentDialog(words("Noted. Plainva creates the task when it is next opened.")))
        }
        return .result(dialog: IntentDialog(words("Plainva could not take this right now.")))
    }
}

/// What can be said to Siri without setting anything up. Every phrase names the app, as the system demands.
struct PlainvaShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddJournalEntryIntent(),
            phrases: [
                "Add a journal entry in \(.applicationName)",
                "New journal entry in \(.applicationName)"
            ],
            shortTitle: LocalizedStringResource("Journal entry", table: "PlainvaIntents"),
            systemImageName: "book"
        )
        AppShortcut(
            intent: AddTaskIntent(),
            phrases: [
                "Add a task in \(.applicationName)",
                "New task in \(.applicationName)"
            ],
            shortTitle: LocalizedStringResource("New task", table: "PlainvaIntents"),
            systemImageName: "checkmark.circle"
        )
        AppShortcut(
            intent: OpenNoteIntent(),
            phrases: [
                "Open a note in \(.applicationName)",
                "Open \(\.$note) in \(.applicationName)"
            ],
            shortTitle: LocalizedStringResource("Open note", table: "PlainvaIntents"),
            systemImageName: "doc.text"
        )
        AppShortcut(
            intent: SearchNotesIntent(),
            phrases: [
                "Search in \(.applicationName)",
                "Search \(.applicationName)"
            ],
            shortTitle: LocalizedStringResource("Search", table: "PlainvaIntents"),
            systemImageName: "magnifyingglass"
        )
    }
}
