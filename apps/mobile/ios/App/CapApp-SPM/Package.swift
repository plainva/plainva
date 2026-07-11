// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.4.1"),
        .package(name: "CapacitorCommunitySqlite", path: "..\..\..\..\..\node_modules\.pnpm\@capacitor-community+sqlite@8.1.0_@capacitor+core@8.4.1\node_modules\@capacitor-community\sqlite"),
        .package(name: "CapacitorApp", path: "..\..\..\..\..\node_modules\.pnpm\@capacitor+app@8.1.0_@capacitor+core@8.4.1\node_modules\@capacitor\app"),
        .package(name: "CapacitorBrowser", path: "..\..\..\..\..\node_modules\.pnpm\@capacitor+browser@8.0.3_@capacitor+core@8.4.1\node_modules\@capacitor\browser"),
        .package(name: "CapacitorCamera", path: "..\..\..\..\..\node_modules\.pnpm\@capacitor+camera@8.2.1_@capacitor+core@8.4.1\node_modules\@capacitor\camera"),
        .package(name: "CapacitorDialog", path: "..\..\..\..\..\node_modules\.pnpm\@capacitor+dialog@8.0.1_@capacitor+core@8.4.1\node_modules\@capacitor\dialog"),
        .package(name: "CapacitorFilesystem", path: "..\..\..\..\..\node_modules\.pnpm\@capacitor+filesystem@8.1.2_@capacitor+core@8.4.1\node_modules\@capacitor\filesystem"),
        .package(name: "CapacitorKeyboard", path: "..\..\..\..\..\node_modules\.pnpm\@capacitor+keyboard@8.0.5_@capacitor+core@8.4.1\node_modules\@capacitor\keyboard"),
        .package(name: "CapacitorPreferences", path: "..\..\..\..\..\node_modules\.pnpm\@capacitor+preferences@8.0.1_@capacitor+core@8.4.1\node_modules\@capacitor\preferences")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorCommunitySqlite", package: "CapacitorCommunitySqlite"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorBrowser", package: "CapacitorBrowser"),
                .product(name: "CapacitorCamera", package: "CapacitorCamera"),
                .product(name: "CapacitorDialog", package: "CapacitorDialog"),
                .product(name: "CapacitorFilesystem", package: "CapacitorFilesystem"),
                .product(name: "CapacitorKeyboard", package: "CapacitorKeyboard"),
                .product(name: "CapacitorPreferences", package: "CapacitorPreferences")
            ]
        )
    ]
)
