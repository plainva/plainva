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
# A static framework is linked into the app, never shipped in it: App Store
# Connect rejects the bundle (ITMS-90208, first met with ONNX Runtime's static
# framework from a Swift package binary target). The app target strips them;
# this catches one that slips through before it reaches the store.
def is_static(binary):
    data = binary.read_bytes()
    if data[:8] == b"!<arch>\n":
        return True
    if data[:4] == b"\xca\xfe\xba\xbe":
        for i in range(struct.unpack(">I", data[4:8])[0]):
            offset = struct.unpack(">I", data[8 + i * 20 + 8:8 + i * 20 + 12])[0]
            if data[offset:offset + 8] == b"!<arch>\n":
                return True
    return False
frameworks = app / "Frameworks"
for framework in sorted(frameworks.glob("*.framework")) if frameworks.is_dir() else []:
    framework_info = plistlib.loads((framework / "Info.plist").read_bytes())
    binary = framework / framework_info.get("CFBundleExecutable", framework.stem)
    assert not is_static(binary), "%s is a static framework inside the bundle; it must only be linked (ITMS-90208)" % framework.name
# One version for the whole bundle: App Store Connect rejects an
# extension whose version differs from the app that carries it.
assert len(set(versions)) == 1, "App and extensions must carry the same version"
assert len(set(profiles.values())) == len(profiles), "Every bundle needs its own matching profile"
destination.write_bytes(plistlib.dumps({"method": "app-store-connect", "destination": "upload", "teamID": "M3FGXPBLFZ", "signingStyle": "manual", "provisioningProfiles": profiles}))
print("App and %d embedded extension(s) verified; versions and separate App Group profiles match." % (len(profiles) - 1))
