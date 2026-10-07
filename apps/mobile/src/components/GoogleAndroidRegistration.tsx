import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Row, toast } from "@plainva/ui";
import { nativeGoogleAppIdentity, usesNativeGoogleAuthorization, type NativeGoogleAppIdentity } from "../services/googleNativeAuthorization";

/**
 * What a Google sign-in on Android depends on — said BEFORE the button is
 * tapped, with the two values to register.
 *
 * Since the phone signs in through Play services, Google recognises the app by
 * its package name and the signing certificate of the installed build; a client
 * ID plays no part in it. The forms went on presenting "Client ID taken from
 * this device · Edit" as if that were what mattered, and a Google project
 * without an Android client then failed with "cancelled" (finding 2026-10-07).
 *
 * The fingerprint is read from the installed build itself, so it is the right
 * one whether the build came from Play (app-signing certificate), from a
 * release file or from a local build. It is public: it is what one types into
 * the Google console.
 *
 * Renders nothing on iOS and in the browser, where a client ID is what counts.
 */
export function GoogleAndroidRegistration() {
  const { t } = useTranslation();
  const [identity, setIdentity] = useState<NativeGoogleAppIdentity | null>(null);
  useEffect(() => {
    let alive = true;
    void nativeGoogleAppIdentity().then((value) => {
      if (alive) setIdentity(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!usesNativeGoogleAuthorization()) return null;
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(t("editor.copied")),
      () => toast.error(t("contextMenu.copyFailed")),
    );
  };
  const copyButton = (text: string) => (
    <Button onClick={() => copy(text)} size="sm" variant="ghost">
      {t("common.copy")}
    </Button>
  );
  return (
    <div data-testid="google-android-registration">
      <p className="m-hint">{t("connection.googleAndroidRegistration")}</p>
      {identity && (
        <>
          <Row wrap title={t("connection.googleAndroidPackage")} subtitle={identity.packageName} end={copyButton(identity.packageName)} />
          {identity.sha1.map((fingerprint) => (
            <Row key={fingerprint} wrap title={t("connection.googleAndroidFingerprint")} subtitle={fingerprint} end={copyButton(fingerprint)} />
          ))}
        </>
      )}
    </div>
  );
}
