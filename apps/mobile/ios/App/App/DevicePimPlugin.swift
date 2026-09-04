import Foundation
import Capacitor
import EventKit
import UIKit

/**
 * The device's calendars and reminders for the JS shell (plan EventKit K2).
 *
 * One store, held for the plugin's life: EventKit hands out identifiers that
 * are only stable within a store, and the change notification is posted per
 * store. The JSON shapes are the core's `DevicePimPort` records one to one
 * (see `apps/mobile/src/platform/devicePim.ts`), so this file translates and
 * nothing else — the mapping to the PIM contract is in TypeScript, where a
 * fake port can test it.
 *
 * Versions: EventKit has no etags, it has `lastModifiedDate`. Every record
 * carries `m<ms>` of that date; the target refuses a write when it moved.
 *
 * Occurrences: `eventIdentifier` is the SAME for every occurrence of a
 * series, so an occurrence is addressed by identifier plus its own start
 * (`occurrenceStartTs`) and found through a one-day predicate around it.
 */
@objc(DevicePimPlugin)
public class DevicePimPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DevicePimPlugin"
    public let jsName = "DevicePim"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorizationStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listCollections", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "events", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "event", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reminders", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reminder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createReminder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateReminder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteReminder", returnType: CAPPluginReturnPromise),
    ]

    private let store = EKEventStore()

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(storeChanged), name: .EKEventStoreChanged, object: store)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func storeChanged() {
        notifyListeners("changed", data: [:])
    }

    // MARK: - Permission

    /** If-chains rather than a switch: the iOS 17 SDK knows `.fullAccess` and
     *  `.writeOnly`, older SDKs do not, and a switch cannot be exhaustive for both. */
    private func statusName(_ s: EKAuthorizationStatus) -> String {
        if s == .notDetermined { return "notDetermined" }
        if s == .denied { return "denied" }
        if s == .restricted { return "restricted" }
        if #available(iOS 17.0, *) {
            if s == .fullAccess { return "fullAccess" }
            if s == .writeOnly { return "writeOnly" }
        }
        if s.rawValue == 3 { return "fullAccess" } // .authorized before iOS 17
        return "denied"
    }

    private func status() -> [String: Any] {
        return [
            "events": statusName(EKEventStore.authorizationStatus(for: .event)),
            "reminders": statusName(EKEventStore.authorizationStatus(for: .reminder)),
        ]
    }

    @objc func authorizationStatus(_ call: CAPPluginCall) {
        call.resolve(status())
    }

    /** Full access (plan E6): write-only could not show a calendar. */
    @objc func requestAccess(_ call: CAPPluginCall) {
        let wantEvents = call.getBool("events") ?? true
        let wantReminders = call.getBool("reminders") ?? false
        let group = DispatchGroup()
        if wantEvents {
            group.enter()
            if #available(iOS 17.0, *) {
                store.requestFullAccessToEvents { _, _ in group.leave() }
            } else {
                store.requestAccess(to: .event) { _, _ in group.leave() }
            }
        }
        if wantReminders {
            group.enter()
            if #available(iOS 17.0, *) {
                store.requestFullAccessToReminders { _, _ in group.leave() }
            } else {
                store.requestAccess(to: .reminder) { _, _ in group.leave() }
            }
        }
        group.notify(queue: .main) { [weak self] in
            guard let self = self else { return }
            call.resolve(self.status())
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
            call.resolve()
        }
    }

    // MARK: - Collections

    private func hex(_ color: CGColor?) -> String? {
        guard let c = color, let comps = c.components, comps.count >= 3 else { return nil }
        let r = Int(round(comps[0] * 255)), g = Int(round(comps[1] * 255)), b = Int(round(comps[2] * 255))
        return String(format: "#%02x%02x%02x", r, g, b)
    }

    private func collectionJSON(_ cal: EKCalendar, kind: String) -> [String: Any] {
        var o: [String: Any] = [
            "id": cal.calendarIdentifier,
            "title": cal.title,
            "writable": cal.allowsContentModifications,
            "kind": kind,
        ]
        if let color = hex(cal.cgColor) { o["color"] = color }
        o["source"] = cal.source.title
        return o
    }

    @objc func listCollections(_ call: CAPPluginCall) {
        var out: [[String: Any]] = []
        for cal in store.calendars(for: .event) { out.append(collectionJSON(cal, kind: "event")) }
        for cal in store.calendars(for: .reminder) { out.append(collectionJSON(cal, kind: "reminder")) }
        call.resolve(["collections": out])
    }

    // MARK: - Events

    private func ms(_ date: Date?) -> Int64 {
        guard let d = date else { return 0 }
        return Int64((d.timeIntervalSince1970 * 1000).rounded())
    }

    private func version(_ item: EKCalendarItem) -> String {
        return "m\(ms(item.lastModifiedDate))"
    }

    private func eventJSON(_ ev: EKEvent) -> [String: Any] {
        var o: [String: Any] = [
            "id": ev.eventIdentifier ?? "",
            "title": ev.title ?? "",
            "startTs": ms(ev.startDate),
            "endTs": ms(ev.endDate),
            "allDay": ev.isAllDay,
            "version": version(ev),
        ]
        if let loc = ev.location, !loc.isEmpty { o["location"] = loc }
        if let notes = ev.notes, !notes.isEmpty { o["notes"] = notes }
        if let url = ev.url?.absoluteString { o["url"] = url }
        if ev.hasRecurrenceRules, let rule = ev.recurrenceRules?.first {
            o["seriesId"] = ev.eventIdentifier ?? ""
            o["rrule"] = rruleString(rule)
        }
        switch ev.status {
        case .confirmed: o["status"] = "confirmed"
        case .tentative: o["status"] = "tentative"
        case .canceled: o["status"] = "cancelled"
        default: break
        }
        return o
    }

    private func calendar(_ id: String) -> EKCalendar? {
        return store.calendar(withIdentifier: id)
    }

    /** One occurrence among many: the identifier plus the occurrence's own start. */
    private func findEvent(id: String, occurrenceStartTs: Int64?) -> EKEvent? {
        guard let ts = occurrenceStartTs else { return store.event(withIdentifier: id) }
        let start = Date(timeIntervalSince1970: TimeInterval(ts) / 1000)
        let pred = store.predicateForEvents(withStart: start.addingTimeInterval(-86400), end: start.addingTimeInterval(86400), calendars: nil)
        return store.events(matching: pred).first { $0.eventIdentifier == id && abs(ms($0.startDate) - ts) < 60_000 }
    }

    @objc func events(_ call: CAPPluginCall) {
        guard let calId = call.getString("calendarId"), let cal = calendar(calId) else {
            call.resolve(["events": []])
            return
        }
        let from = Date(timeIntervalSince1970: TimeInterval(call.getDouble("fromTs") ?? 0) / 1000)
        let to = Date(timeIntervalSince1970: TimeInterval(call.getDouble("toTs") ?? 0) / 1000)
        let pred = store.predicateForEvents(withStart: from, end: to, calendars: [cal])
        call.resolve(["events": store.events(matching: pred).map { eventJSON($0) }])
    }

    @objc func event(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("id missing"); return }
        let ts = call.getDouble("occurrenceStartTs").map { Int64($0) }
        if let ev = findEvent(id: id, occurrenceStartTs: ts) {
            call.resolve(["event": eventJSON(ev)])
        } else {
            call.resolve(["event": NSNull()])
        }
    }

    private func apply(_ draft: JSObject, to ev: EKEvent) -> Bool {
        ev.title = draft["title"] as? String ?? ""
        ev.isAllDay = draft["allDay"] as? Bool ?? false
        if let s = draft["startTs"] as? Double { ev.startDate = Date(timeIntervalSince1970: s / 1000) }
        if let e = draft["endTs"] as? Double { ev.endDate = Date(timeIntervalSince1970: e / 1000) }
        ev.location = draft["location"] as? String
        ev.notes = draft["notes"] as? String
        // `rrule` absent → leave the rule alone; null → remove; string → set.
        var ruleTouched = false
        if draft.keys.contains("rrule") {
            ruleTouched = true
            if let text = draft["rrule"] as? String, let rule = parseRRule(text) {
                ev.recurrenceRules = [rule]
            } else {
                ev.recurrenceRules = nil
            }
        }
        return ruleTouched
    }

    @objc func createEvent(_ call: CAPPluginCall) {
        guard let calId = call.getString("calendarId"), let cal = calendar(calId), let draft = call.getObject("draft") else {
            call.reject("calendarId or draft missing"); return
        }
        let ev = EKEvent(eventStore: store)
        ev.calendar = cal
        _ = apply(draft, to: ev)
        do {
            try store.save(ev, span: .futureEvents, commit: true)
            call.resolve(["event": eventJSON(ev)])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func updateEvent(_ call: CAPPluginCall) {
        guard let handle = call.getObject("handle"), let id = handle["id"] as? String, let draft = call.getObject("draft") else {
            call.reject("handle or draft missing"); return
        }
        let ts = (handle["occurrenceStartTs"] as? Double).map { Int64($0) }
        guard let ev = findEvent(id: id, occurrenceStartTs: ts) else { call.reject("event not found"); return }
        let ruleTouched = apply(draft, to: ev)
        do {
            // Editing the rule means the series; everything else means this occurrence.
            try store.save(ev, span: ruleTouched ? .futureEvents : .thisEvent, commit: true)
            call.resolve(["event": eventJSON(ev)])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func deleteEvent(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("id missing"); return }
        let ts = call.getDouble("occurrenceStartTs").map { Int64($0) }
        // Already gone is the goal reached.
        guard let ev = findEvent(id: id, occurrenceStartTs: ts) else { call.resolve(); return }
        do {
            try store.remove(ev, span: .thisEvent, commit: true)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    // MARK: - Reminders

    private func dueString(_ comps: DateComponents?) -> String? {
        guard let c = comps, let y = c.year, let m = c.month, let d = c.day else { return nil }
        if let h = c.hour, let mi = c.minute {
            return String(format: "%04d-%02d-%02dT%02d:%02d", y, m, d, h, mi)
        }
        return String(format: "%04d-%02d-%02d", y, m, d)
    }

    private func dueComponents(_ text: String?) -> DateComponents? {
        guard let t = text, t.count >= 10 else { return nil }
        var c = DateComponents()
        c.year = Int(t.prefix(4)); c.month = Int(t.dropFirst(5).prefix(2)); c.day = Int(t.dropFirst(8).prefix(2))
        if t.count >= 16 {
            c.hour = Int(t.dropFirst(11).prefix(2)); c.minute = Int(t.dropFirst(14).prefix(2))
        }
        return c
    }

    private func reminderJSON(_ r: EKReminder) -> [String: Any] {
        var o: [String: Any] = [
            "id": r.calendarItemIdentifier,
            "listId": r.calendar.calendarIdentifier,
            "title": r.title ?? "",
            "completed": r.isCompleted,
            "version": version(r),
        ]
        if let notes = r.notes, !notes.isEmpty { o["notes"] = notes }
        if let due = dueString(r.dueDateComponents) { o["due"] = due }
        return o
    }

    /** Open reminders plus the ones completed in the last 30 days — a window,
     *  because `fetchReminders` is slow on a long list. */
    @objc func reminders(_ call: CAPPluginCall) {
        guard let listId = call.getString("listId"), let cal = calendar(listId) else { call.resolve(["reminders": []]); return }
        let open = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: [cal])
        let done = store.predicateForCompletedReminders(withCompletionDateStarting: Date().addingTimeInterval(-30 * 86400), ending: nil, calendars: [cal])
        var out: [[String: Any]] = []
        let group = DispatchGroup()
        for pred in [open, done] {
            group.enter()
            store.fetchReminders(matching: pred) { list in
                for r in list ?? [] { out.append(self.reminderJSON(r)) }
                group.leave()
            }
        }
        group.notify(queue: .main) { call.resolve(["reminders": out]) }
    }

    @objc func reminder(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("id missing"); return }
        if let r = store.calendarItem(withIdentifier: id) as? EKReminder {
            call.resolve(["reminder": reminderJSON(r)])
        } else {
            call.resolve(["reminder": NSNull()])
        }
    }

    private func apply(_ draft: JSObject, to r: EKReminder) {
        r.title = draft["title"] as? String ?? ""
        r.notes = draft["notes"] as? String
        r.dueDateComponents = dueComponents(draft["due"] as? String)
        let completed = draft["completed"] as? Bool ?? false
        r.isCompleted = completed
    }

    @objc func createReminder(_ call: CAPPluginCall) {
        guard let listId = call.getString("listId"), let cal = calendar(listId), let draft = call.getObject("draft") else {
            call.reject("listId or draft missing"); return
        }
        let r = EKReminder(eventStore: store)
        r.calendar = cal
        apply(draft, to: r)
        do {
            try store.save(r, commit: true)
            call.resolve(["reminder": reminderJSON(r)])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func updateReminder(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let draft = call.getObject("draft") else { call.reject("id or draft missing"); return }
        guard let r = store.calendarItem(withIdentifier: id) as? EKReminder else { call.reject("reminder not found"); return }
        apply(draft, to: r)
        do {
            try store.save(r, commit: true)
            call.resolve(["reminder": reminderJSON(r)])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func deleteReminder(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("id missing"); return }
        guard let r = store.calendarItem(withIdentifier: id) as? EKReminder else { call.resolve(); return }
        do {
            try store.remove(r, commit: true)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    // MARK: - RRULE

    private static let weekdays: [EKWeekday: String] = [
        .sunday: "SU", .monday: "MO", .tuesday: "TU", .wednesday: "WE", .thursday: "TH", .friday: "FR", .saturday: "SA",
    ]

    /** The subset both shells speak: FREQ, INTERVAL, BYDAY, UNTIL, COUNT. */
    private func rruleString(_ rule: EKRecurrenceRule) -> String {
        var parts: [String] = []
        switch rule.frequency {
        case .daily: parts.append("FREQ=DAILY")
        case .weekly: parts.append("FREQ=WEEKLY")
        case .monthly: parts.append("FREQ=MONTHLY")
        case .yearly: parts.append("FREQ=YEARLY")
        @unknown default: parts.append("FREQ=DAILY")
        }
        if rule.interval > 1 { parts.append("INTERVAL=\(rule.interval)") }
        if let days = rule.daysOfTheWeek, !days.isEmpty {
            parts.append("BYDAY=" + days.compactMap { DevicePimPlugin.weekdays[$0.dayOfTheWeek] }.joined(separator: ","))
        }
        if let end = rule.recurrenceEnd {
            if let date = end.endDate {
                let f = DateFormatter()
                f.dateFormat = "yyyyMMdd"
                f.timeZone = TimeZone.current
                parts.append("UNTIL=" + f.string(from: date))
            } else if end.occurrenceCount > 0 {
                parts.append("COUNT=\(end.occurrenceCount)")
            }
        }
        return parts.joined(separator: ";")
    }

    private func parseRRule(_ text: String) -> EKRecurrenceRule? {
        var freq: EKRecurrenceFrequency = .daily
        var interval = 1
        var days: [EKRecurrenceDayOfWeek]? = nil
        var end: EKRecurrenceEnd? = nil
        let body = text.uppercased().hasPrefix("RRULE:") ? String(text.dropFirst(6)) : text
        for pair in body.split(separator: ";") {
            let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
            guard kv.count == 2 else { continue }
            switch kv[0].uppercased() {
            case "FREQ":
                switch kv[1].uppercased() {
                case "WEEKLY": freq = .weekly
                case "MONTHLY": freq = .monthly
                case "YEARLY": freq = .yearly
                default: freq = .daily
                }
            case "INTERVAL": interval = max(1, Int(kv[1]) ?? 1)
            case "BYDAY":
                let map: [String: EKWeekday] = ["SU": .sunday, "MO": .monday, "TU": .tuesday, "WE": .wednesday, "TH": .thursday, "FR": .friday, "SA": .saturday]
                days = kv[1].split(separator: ",").compactMap { map[String($0).uppercased()] }.map { EKRecurrenceDayOfWeek($0) }
            case "UNTIL":
                let digits = kv[1].prefix(8)
                let f = DateFormatter()
                f.dateFormat = "yyyyMMdd"
                f.timeZone = TimeZone.current
                if let d = f.date(from: String(digits)) {
                    // Inclusive civil date: the end of that day.
                    end = EKRecurrenceEnd(end: d.addingTimeInterval(86399))
                }
            case "COUNT":
                if let n = Int(kv[1]), n > 0 { end = EKRecurrenceEnd(occurrenceCount: n) }
            default: break
            }
        }
        return EKRecurrenceRule(recurrenceWith: freq, interval: interval, daysOfTheWeek: days, daysOfTheMonth: nil, monthsOfTheYear: nil, weeksOfTheYear: nil, daysOfTheYear: nil, setPositions: nil, end: end)
    }
}
