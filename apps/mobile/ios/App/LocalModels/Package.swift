// swift-tools-version: 5.9
import PackageDescription

// Microsoft's ONNX Runtime for the app's local model packages (plan KI-Harness
// P2a-3, ADR 0021): the official CocoaPods archive of the C library — the same
// file Microsoft's own Swift package points at — pinned by its SHA-256, and a
// small C layer (`PlainvaOrt`) the app's `LocalModelPlugin` calls. Kept apart
// from CapApp-SPM, which the Capacitor CLI rewrites.
let package = Package(
    name: "LocalModels",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "PlainvaOrt", targets: ["PlainvaOrt"])
    ],
    targets: [
        .binaryTarget(
            name: "onnxruntime",
            url: "https://download.onnxruntime.ai/pod-archive-onnxruntime-c-1.30.0.zip",
            checksum: "e6f1670c14406fd9f082bb400ab197a9b0a9646058ca6366e440642e2b54a2ea"
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
