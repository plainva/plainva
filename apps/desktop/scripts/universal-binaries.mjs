import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The `beforeBundleCommand` of the desktop app: on a universal macOS build,
 * every extra program joins its two architectures before the bundler copies it.
 *
 * With `--target universal-apple-darwin` the Tauri CLI (2.12) builds the app
 * once for aarch64 and once for x86_64 and then joins with `lipo` only the MAIN
 * program into `target/universal-apple-darwin/<profile>/`
 * (crates/tauri-cli/src/interface/rust/desktop.rs, `build`). The bundler then
 * copies EVERY program of the crate — `src/bin/*.rs` included, which is how
 * `plainva-mcp` gets into the app — from that same folder
 * (tauri-bundler, macos/app.rs `copy_binaries_to_bundle`, settings.rs
 * `binary_path`). Nothing put `plainva-mcp` there, so the bundle failed with
 * "Failed to copy binary". The hook runs after the build and before the
 * bundler (crates/tauri-cli/src/bundle.rs, `bundle`) and learns the target
 * from `TAURI_ENV_TARGET_TRIPLE` (interface/rust.rs, `env`).
 *
 * Every other target needs nothing: `cargo build` without `--bin` builds every
 * program of the crate into the one folder the bundler reads
 * (`target/[<triple>/]<profile>/`), so the helper is already there.
 */
export const UNIVERSAL_TRIPLE = 'universal-apple-darwin';
export const UNIVERSAL_PARTS = ['aarch64-apple-darwin', 'x86_64-apple-darwin'];

/** The programs the bundler adds beside the main one: `src/bin/<name>.rs`. */
export function extraBinaries(fileNames) {
  return fileNames
    .filter((name) => name.endsWith('.rs'))
    .map((name) => name.slice(0, -'.rs'.length))
    .sort();
}

/**
 * What to join, or null when the target is not universal. Each entry names the
 * output and its two inputs.
 */
export function universalPlan({ triple, debug, targetDir, binaries }) {
  if (triple !== UNIVERSAL_TRIPLE) return null;
  const profile = debug ? 'debug' : 'release';
  return binaries.map((name) => ({
    name,
    output: join(targetDir, UNIVERSAL_TRIPLE, profile, name),
    inputs: UNIVERSAL_PARTS.map((part) => join(targetDir, part, profile, name)),
  }));
}

function cargoTargetDir(tauriDir, env) {
  if (env.CARGO_TARGET_DIR) return resolve(env.CARGO_TARGET_DIR);
  const metadata = execFileSync(
    'cargo',
    ['metadata', '--format-version', '1', '--no-deps', '--manifest-path', join(tauriDir, 'Cargo.toml')],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env },
  );
  return JSON.parse(metadata).target_directory;
}

/**
 * The hook itself. `scripts/universal-binaries-run.mjs` is its entry point, so
 * nothing here depends on how the file was started (a "was I started
 * directly" check against argv misses behind a symlink, and the hook would
 * silently do nothing).
 */
export function main(env = process.env) {
  const triple = env.TAURI_ENV_TARGET_TRIPLE;
  if (triple !== UNIVERSAL_TRIPLE) {
    console.log(`universal-binaries: target ${triple ?? '(none)'} is not universal, nothing to join`);
    return;
  }
  const tauriDir = fileURLToPath(new URL('../src-tauri/', import.meta.url));
  const plan = universalPlan({
    triple,
    debug: env.TAURI_ENV_DEBUG === 'true',
    targetDir: cargoTargetDir(tauriDir, env),
    binaries: extraBinaries(readdirSync(join(tauriDir, 'src', 'bin'))),
  });
  for (const { name, output, inputs } of plan) {
    const missing = inputs.filter((input) => !existsSync(input));
    if (missing.length) throw new Error(`universal-binaries: ${name} was not built for ${missing.join(', ')}`);
    mkdirSync(join(output, '..'), { recursive: true });
    execFileSync('lipo', ['-create', '-output', output, ...inputs], { stdio: 'inherit', env });
    const archs = execFileSync('lipo', ['-archs', output], { encoding: 'utf8', env }).trim().split(/\s+/);
    if (!archs.includes('arm64') || !archs.includes('x86_64')) {
      throw new Error(`universal-binaries: ${name} carries ${archs.join(' ')}, expected arm64 and x86_64`);
    }
    console.log(`universal-binaries: ${name} joined (${archs.join(' ')}) at ${output}`);
  }
}
