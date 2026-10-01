"""Check embedded extension/signing evidence and create the exact export map.

Two extensions can be embedded: the share extension, always, and the
widgets (plan Widgets, W7), once its target exists. A widget bundle that
is simply absent is not an error while W4 is unbuilt - but when the
workflow says to expect it (PLAINVA_EXPECT_WIDGETS, set whenever the
widgets profile secret is configured), a missing one IS, because a target
that quietly failed to build would otherwise ship as a green upload.

The identity comes from the environment, as in install-ios-profiles.py: the
store app by default, Plainva Labs under labs-mobile.yml.
"""
import datetime
import os
import pathlib
import plistlib
import struct
import subprocess
import sys

archive = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2])
app = archive / "Products/Applications/App.app"
extension = app / "PlugIns/ShareExtension.appex"
widgets = app / "PlugIns/PlainvaWidgets.appex"
base = os.environ.get("PLAINVA_BUNDLE_BASE") or "com.plainva.app"
group = os.environ.get("PLAINVA_APP_GROUP") or "group.com.plainva.app"
profiles = {}
versions = []
products = [(app, base, "APPL"), (extension, base + ".share", "XPC!")]
expect_widgets = os.environ.get("PLAINVA_EXPECT_WIDGETS") == "1"
if widgets.is_dir():
    products.append((widgets, base + ".widgets", "XPC!"))
elif expect_widgets:
    raise AssertionError("PlainvaWidgets.appex is missing from the archive although the widgets profile is configured")
for product, bundle_id, package_type in products:
    info = plistlib.loads((product / "Info.plist").read_bytes())
    assert info["CFBundleIdentifier"] == bundle_id, "Unexpected bundle identifier"
    assert info.get("CFBundlePackageType") == package_type, "Unexpected bundle package type"
    executable = info.get("CFBundleExecutable")
    assert isinstance(executable, str) and executable and pathlib.Path(executable).name == executable, "Missing or invalid CFBundleExecutable"
    assert (product / executable).is_file(), "Declared bundle executable is missing"
    versions.append((info["CFBundleShortVersionString"], info["CFBundleVersion"]))
    subprocess.run(["codesign", "--verify", "--strict", str(product)], check=True)
    raw = subprocess.check_output(["security", "cms", "-D", "-i", str(product / "embedded.mobileprovision")])
    profile = plistlib.loads(raw)
    entitlements = profile["Entitlements"]
    assert entitlements["application-identifier"] == "M3FGXPBLFZ." + bundle_id, "Profile does not match bundle"
    assert group in entitlements.get("com.apple.security.application-groups", []), "Profile lacks the shared App Group"
    assert profile["ExpirationDate"] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None), "Expired profile"
    signed = plistlib.loads(subprocess.check_output(["codesign", "-d", "--entitlements", ":-", str(product)], stderr=subprocess.DEVNULL))
    assert group in signed.get("com.apple.security.application-groups", []), "Signed binary lacks the App Group"
    profiles[bundle_id] = profile["UUID"]
# Every framework in the bundle must carry code and agree with its own
# Info.plist: App Store Connect rejects a binary that needs a newer system than
# the framework's MinimumOSVersion says (ITMS-90208). Xcode produced exactly
# that from ONNX Runtime's static framework (a Swift package binary target):
# it dropped the static code and injected an empty stub built for the app's
# deployment target. The app target removes frameworks without code; this
# catches one that slips through, before the upload instead of after it.
def macho_slices(data):
    if data[:4] == b"\xca\xfe\xba\xbe":
        for i in range(struct.unpack(">I", data[4:8])[0]):
            offset, size = struct.unpack(">II", data[8 + i * 20 + 8:8 + i * 20 + 16])
            yield data[offset:offset + size]
    else:
        yield data

def slice_facts(macho):
    """(is_static, minimum OS as a tuple or None, bytes of code) of one Mach-O slice."""
    if macho[:8] == b"!<arch>\n":
        return True, None, 1
    if macho[:4] != b"\xcf\xfa\xed\xfe":
        return False, None, 0
    ncmds = struct.unpack("<I", macho[16:20])[0]
    offset, minimum, code = 32, None, 0
    for _ in range(ncmds):
        cmd, size = struct.unpack("<II", macho[offset:offset + 8])
        if cmd == 0x32:  # LC_BUILD_VERSION
            version = struct.unpack("<I", macho[offset + 12:offset + 16])[0]
            minimum = (version >> 16, (version >> 8) & 0xFF, version & 0xFF)
        elif cmd == 0x19:  # LC_SEGMENT_64: count the bytes of __TEXT,__text
            nsects = struct.unpack("<I", macho[offset + 64:offset + 68])[0]
            for j in range(nsects):
                section = offset + 72 + j * 80
                if macho[section:section + 16].rstrip(b"\0") == b"__text":
                    code += struct.unpack("<Q", macho[section + 40:section + 48])[0]
        offset += size
    return False, minimum, code

def os_tuple(text):
    parts = [int(p) for p in str(text).split(".")]
    return tuple(parts + [0] * (3 - len(parts)))[:3]

frameworks = app / "Frameworks"
for framework in sorted(frameworks.glob("*.framework")) if frameworks.is_dir() else []:
    framework_info = plistlib.loads((framework / "Info.plist").read_bytes())
    binary = (framework / framework_info.get("CFBundleExecutable", framework.stem)).read_bytes()
    declared = os_tuple(framework_info.get("MinimumOSVersion", "0"))
    code = 0
    for macho in macho_slices(binary):
        static, minimum, text = slice_facts(macho)
        assert not static, "%s is a static framework inside the bundle; it must only be linked (ITMS-90208)" % framework.name
        assert minimum is None or minimum <= declared, "%s needs iOS %s but its Info.plist says %s (ITMS-90208)" % (framework.name, ".".join(map(str, minimum)), framework_info.get("MinimumOSVersion"))
        code += text
    assert code > 0, "%s carries no code; the app target should have removed it (ITMS-90208)" % framework.name
# One version for the whole bundle: App Store Connect rejects an
# extension whose version differs from the app that carries it.
assert len(set(versions)) == 1, "App and extensions must carry the same version"
assert len(set(profiles.values())) == len(profiles), "Every bundle needs its own matching profile"
destination.write_bytes(plistlib.dumps({"method": "app-store-connect", "destination": "upload", "teamID": "M3FGXPBLFZ", "signingStyle": "manual", "provisioningProfiles": profiles}))
print("App and %d embedded extension(s) verified; versions and separate App Group profiles match." % (len(profiles) - 1))
