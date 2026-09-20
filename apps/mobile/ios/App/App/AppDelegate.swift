import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        installQuickActions(application)
        // `true` on purpose: a quick action that launched the app is then delivered to
        // `performActionFor` below, the one place that handles it.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // MARK: - Home Screen quick actions (plan Journal, J4)
    //
    // The same four entries as the Android launcher shortcuts (res/xml/shortcuts.xml),
    // and they travel the same way: as `com.plainva.app://shortcut/<id>` through the
    // App plugin, so the web layer needs no second route. The titles are set at run
    // time from this table instead of InfoPlist.strings - they are the Android labels,
    // and `launcherShortcuts.test.ts` fails when the two platforms drift apart.
    private static let quickActionOrder = ["new-note", "new-task", "journal", "today"]
    private static let quickActionSymbols = ["new-note": "square.and.pencil", "new-task": "checkmark.circle", "journal": "book", "today": "sun.max"]
    private static let quickActionTitles: [String: [String: String]] = [
        "en": ["new-note": "New note", "new-task": "New task", "journal": "Journal entry", "today": "Today"],
        "de": ["new-note": "Neue Notiz", "new-task": "Neue Aufgabe", "journal": "Journal-Eintrag", "today": "Heute"],
        "es": ["new-note": "Nueva nota", "new-task": "Nueva tarea", "journal": "Entrada de diario", "today": "Hoy"],
        "fr": ["new-note": "Nouvelle note", "new-task": "Nouvelle tâche", "journal": "Entrée de journal", "today": "Aujourd'hui"],
        "it": ["new-note": "Nuova nota", "new-task": "Nuova attività", "journal": "Voce di diario", "today": "Oggi"],
        "ja": ["new-note": "新規ノート", "new-task": "新規タスク", "journal": "ジャーナルに記入", "today": "今日"],
        "nl": ["new-note": "Nieuwe notitie", "new-task": "Nieuwe taak", "journal": "Journaalitem", "today": "Vandaag"],
        "pl": ["new-note": "Nowa notatka", "new-task": "Nowe zadanie", "journal": "Wpis do dziennika", "today": "Dzisiaj"],
        "pt": ["new-note": "Nova nota", "new-task": "Nova tarefa", "journal": "Entrada do diário", "today": "Hoje"],
        "zh": ["new-note": "新建笔记", "new-task": "新建任务", "journal": "写日志", "today": "今天"],
    ]

    private func installQuickActions(_ application: UIApplication) {
        let language = Locale.preferredLanguages.first.map { String($0.prefix(2)) } ?? "en"
        let titles = AppDelegate.quickActionTitles[language] ?? AppDelegate.quickActionTitles["en"]!
        application.shortcutItems = AppDelegate.quickActionOrder.compactMap { id in
            guard let title = titles[id] else { return nil }
            let icon = AppDelegate.quickActionSymbols[id].map { UIApplicationShortcutIcon(systemImageName: $0) }
            return UIApplicationShortcutItem(type: "com.plainva.app.shortcut." + id, localizedTitle: title, localizedSubtitle: nil, icon: icon, userInfo: nil)
        }
    }

    func application(_ application: UIApplication, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        let prefix = "com.plainva.app.shortcut."
        guard shortcutItem.type.hasPrefix(prefix), let url = URL(string: "com.plainva.app://shortcut/" + shortcutItem.type.dropFirst(prefix.count)) else {
            completionHandler(false)
            return
        }
        // The App plugin keeps the URL until the web layer listens (warm start) and
        // hands it out as the launch URL (cold start).
        completionHandler(ApplicationDelegateProxy.shared.application(application, open: url, options: [:]))
    }

}
