import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every file a desktop release uploads, per build leg, as the Tauri CLI leaves
 * it under apps/desktop/src-tauri/target before tauri-action renames and
 * uploads it. The names are the assets of the 0.8.7 release (latest.json
 * aside, which the action writes itself), so the list is measured, not
 * assumed.
 *
 * Why the check exists: tauri-action v1.0.0 treats a build that a signal ended
 * (`execCommand`, exit code null) as a success and uploads whatever is already
 * there — a DMG without the updater archive, an installer without its .sig.
 * The step after "Build Tauri App" fails the run in that case, before it ends
 * green; the draft stays unpublished. The rehearsal runs the same check and
 * builds its record from the same list.
 */
export const LEGS = ['macos-latest', 'windows-latest', 'ubuntu-22.04'];

export function expectedBundles(leg, version) {
  const v = version;
  switch (leg) {
    case 'macos-latest':
      return [
        `universal-apple-darwin/release/bundle/dmg/Plainva_${v}_universal.dmg`,
        'universal-apple-darwin/release/bundle/macos/Plainva.app.tar.gz',
        'universal-apple-darwin/release/bundle/macos/Plainva.app.tar.gz.sig',
      ];
    case 'windows-latest':
      return [
        `release/bundle/msi/Plainva_${v}_x64_en-US.msi`,
        `release/bundle/msi/Plainva_${v}_x64_en-US.msi.sig`,
        `release/bundle/nsis/Plainva_${v}_x64-setup.exe`,
        `release/bundle/nsis/Plainva_${v}_x64-setup.exe.sig`,
      ];
    case 'ubuntu-22.04':
      return [
        `release/bundle/deb/Plainva_${v}_amd64.deb`,
        `release/bundle/deb/Plainva_${v}_amd64.deb.sig`,
        `release/bundle/rpm/Plainva-${v}-1.x86_64.rpm`,
        `release/bundle/rpm/Plainva-${v}-1.x86_64.rpm.sig`,
        `release/bundle/appimage/Plainva_${v}_amd64.AppImage`,
        `release/bundle/appimage/Plainva_${v}_amd64.AppImage.sig`,
      ];
    default:
      throw new Error(`expected-bundles: unknown build leg ${leg}`);
  }
}

/** The version the bundles carry: the one of the Tauri configuration. */
export function appVersion(tauriDir) {
  return JSON.parse(readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8')).version;
}
