"""Validate every distribution profile without logging its contents.

Three bundles now: the app, the share extension and the widgets (plan
Widgets, W7). The widgets profile is OPTIONAL while its target does not
exist yet - passing no third argument keeps the build exactly as it was.
Once W4 brings the target, ios.yml passes it and a missing one fails
here, with a sentence, rather than as a signing error further down.

The identity comes from the environment, as in the Xcode project: the store
app by default, Plainva Labs when labs-mobile.yml sets PLAINVA_BUNDLE_BASE and
PLAINVA_APP_GROUP (docs/engineering/Labs_Channel.md).
"""
import datetime
import os
import pathlib
import plistlib
import subprocess
import sys

BASE = os.environ.get("PLAINVA_BUNDLE_BASE") or "com.plainva.app"
GROUP = os.environ.get("PLAINVA_APP_GROUP") or "group.com.plainva.app"
BUNDLES = [
    (1, BASE, "PLAINVA_APP_PROFILE"),
    (2, BASE + ".share", "PLAINVA_SHARE_PROFILE"),
    (3, BASE + ".widgets", "PLAINVA_WIDGETS_PROFILE"),
]

seen = {}
for position, bundle, variable in BUNDLES:
    if len(sys.argv) <= position or not sys.argv[position]:
        continue
    file = sys.argv[position]
    profile = plistlib.loads(subprocess.check_output(["security", "cms", "-D", "-i", file]))
    entitlements = profile["Entitlements"]
    assert entitlements["application-identifier"] == "M3FGXPBLFZ." + bundle, "Wrong bundle in signing profile: " + bundle
    assert GROUP in entitlements.get("com.apple.security.application-groups", []), "Profile lacks " + GROUP + ": " + bundle
    assert not entitlements.get("get-task-allow", False) and not profile.get("ProvisionedDevices") and not profile.get("ProvisionsAllDevices", False), "An App Store distribution profile is required: " + bundle
    assert profile["ExpirationDate"] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None), "Expired signing profile: " + bundle
    identifier = profile["UUID"]
    # Each bundle signs with its OWN profile. Two bundles sharing one is
    # the mistake that looks like it works until the upload is refused.
    assert identifier not in seen.values(), "Two bundles share one profile: " + bundle
    seen[bundle] = identifier
    with pathlib.Path(os.environ["GITHUB_ENV"]).open("a", encoding="utf-8") as output:
        output.write(variable + "=" + identifier + "\n")
print("%d App Store profiles match their bundle and App Group: %s" % (len(seen), ", ".join(sorted(seen))))
