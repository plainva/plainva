# Plainva Mobile

The Capacitor mobile shell shares Plainva's TypeScript domain and UI packages and
provides native Android/iOS adapters for vault storage, SQLite, secure credentials,
cloud sync, OAuth, calendar access and share targets.

## Local checks

From the repository root:

```sh
pnpm --filter mobile typecheck
pnpm --filter mobile lint
pnpm --filter mobile test
```

`pnpm --filter mobile build` builds the web bundle. `pnpm --filter mobile sync`
copies it into both native projects; native signing and store delivery are handled
by the mobile GitHub workflows.

## iOS: ONNX Runtime

Search by meaning runs Microsoft's ONNX Runtime. The local Swift package
`ios/App/LocalModels` links it from `ios/App/LocalModels/Frameworks/`, which is not
in git. Before opening the project in Xcode or running `xcodebuild`, run

```bash
node apps/mobile/scripts/fetch-onnxruntime-ios.mjs
```

It takes `onnxruntime.xcframework` out of Microsoft's NuGet package
`Microsoft.ML.OnnxRuntime` (api.nuget.org), checks the package and the framework
archive against their pinned size and SHA-256, and keeps a framework that is already
there. Without it Xcode cannot resolve the package `LocalModels`. A new ONNX Runtime
version means new pins in that script (and in `apps/desktop/scripts/fetch-onnxruntime.mjs`
for the package) and the same version in `android/app/build.gradle`; a test holds
the three together.

## iOS Share Extension

The app and `ShareExtension` target use the App Group
`group.com.plainva.app`. The Apple Developer configuration must enable that group
for both bundle IDs, `com.plainva.app` and `com.plainva.app.share`, and the signing
profiles must contain the matching entitlement. The extension accepts text, URLs,
images and files, caps each attachment at 25 MiB, atomically hands a one-shot JSON
payload to the container, and opens the `com.plainva.app://shared` URL.

Do not run `cap sync ios` casually after manual Xcode project changes: inspect the
resulting project diff and confirm that the Share Extension target, embed phase and
entitlements remain present.
