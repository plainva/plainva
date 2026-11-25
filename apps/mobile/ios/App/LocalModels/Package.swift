// swift-tools-version: 5.9
import PackageDescription

// Microsoft's ONNX Runtime for the app's local model packages (plan KI-Harness
// P2a-3, ADR 0021), and a small C layer (`PlainvaOrt`) the app's
// `LocalModelPlugin` calls. Kept apart from CapApp-SPM, which the Capacitor CLI
// rewrites.
//
// The framework is not in git: `node apps/mobile/scripts/fetch-onnxruntime-ios.mjs`
// puts it into `Frameworks/` from Microsoft's NuGet package, pinned by size and
// SHA-256, and has to run before Xcode resolves packages. Until 2026-11-21 this
// target named the CocoaPods archive on download.onnxruntime.ai by URL; that
// day the host could not deliver, and a binary target by URL has no second
// source.
let package = Package(
    name: "LocalModels",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "PlainvaOrt", targets: ["PlainvaOrt"])
    ],
    targets: [
        .binaryTarget(
            name: "onnxruntime",
            path: "Frameworks/onnxruntime.xcframework"
        ),
        .target(
            name: "PlainvaOrt",
            dependencies: ["onnxruntime"],
            path: "Sources/PlainvaOrt",
            linkerSettings: [
                .linkedLibrary("c++"),
                .linkedFramework("Foundation"),
                .linkedFramework("CoreML")
            ]
        )
    ]
)
