package com.plainva.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import okhttp3.HttpUrl;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The phone's rules for signing in to a remote MCP server (plan KI-Harness
 * P4.5). The lists are those of packages/core/src/ai/mcp/oauthRules.test.ts
 * ({@code MCP_OAUTH_*_CASES}), which the desktop's {@code oauth.rs} and iOS
 * run too: a case added there is added here.
 */
public class AiMcpOAuthRulesTest {

    private static final String ISSUER = "https://auth.example.org";
    private static final String SERVER = "https://mcp.example.com/mcp";

    /** JSON is written with single quotes here, so that it can be read. */
    private static String q(String json) {
        return json.replace('\'', '"');
    }

    /** [the server's registered address, an address it names, whether that may be asked] */
    private static final Object[][] ADDRESS_CASES = {
        { "https://mcp.example.com/mcp", "https://auth.example.org/.well-known/oauth-authorization-server", true },
        { "https://mcp.example.com/mcp", "https://mcp.example.com:8443/token", true },
        { "https://mcp.example.com/mcp", "https://auth.example.org:8443/token", false },
        { "https://mcp.example.com/mcp", "http://auth.example.org/token", false },
        { "https://mcp.example.com/mcp", "https://192.168.1.1/token", false },
        { "https://mcp.example.com/mcp", "https://router.lan/token", false },
        { "https://mcp.example.com/mcp", "https://localhost/token", false },
        { "https://mcp.example.com/mcp", "https://user:pw@auth.example.org/token", false },
        { "https://mcp.example.com/mcp", "https://auth.example.org/token#x", false },
        { "https://mcp.example.com/mcp", "javascript:alert(1)", false },
        { "https://mcp.example.com/mcp", "", false },
        { "https://192.168.1.20/mcp", "https://192.168.1.20/oauth/token", true },
        { "https://192.168.1.20/mcp", "https://192.168.1.21/oauth/token", false },
        { "http://localhost:3000/mcp", "http://localhost:9000/token", true },
        { "http://localhost:3000/mcp", "http://127.0.0.1:9000/token", false },
        { "http://localhost:3000/mcp", "https://auth.example.org/token", true },
    };

    private static final Object[][] ISSUER_URL_CASES = {
        { "https://auth.example.org", "https://auth.example.org/.well-known/oauth-authorization-server", true },
        { "https://auth.example.org/tenant1", "https://auth.example.org/.well-known/oauth-authorization-server/tenant1", true },
        { "https://auth.example.org/tenant1", "https://auth.example.org/tenant1/.well-known/openid-configuration", true },
        { "http://localhost:9000", "http://localhost:9000/.well-known/oauth-authorization-server", true },
        { "https://auth.example.org", "https://auth.example.org/metadata.json", false },
        { "https://auth.example.org", "https://evil.example.net/.well-known/oauth-authorization-server", false },
        { "https://auth.example.org", "https://auth.example.org:8443/.well-known/oauth-authorization-server", false },
        { "https://auth.example.org", "http://auth.example.org/.well-known/oauth-authorization-server", false },
        { "https://auth.example.org?x=1", "https://auth.example.org/.well-known/oauth-authorization-server", false },
        { "https://auth.example.org#x", "https://auth.example.org/.well-known/oauth-authorization-server", false },
    };

    private static final String COMPLETE = q(
        "{'issuer':'https://auth.example.org','authorization_endpoint':'https://auth.example.org/authorize','token_endpoint':'https://auth.example.org/token','response_types_supported':['code'],"
            + "'code_challenge_methods_supported':['S256','plain'],'registration_endpoint':'https://auth.example.org/register','client_id_metadata_document_supported':true,"
            + "'authorization_response_iss_parameter_supported':true,'scopes_supported':['read','write']}");

    /** [what the case is about, the metadata as it was served, "ok" or why it does not count] */
    private static final String[][] ISSUER_DOC_CASES = {
        { "complete", COMPLETE, "ok" },
        { "the token endpoint on another public host",
            q("{'issuer':'https://auth.example.org','authorization_endpoint':'https://auth.example.org/authorize','token_endpoint':'https://tokens.example.net/token','code_challenge_methods_supported':['S256']}"), "ok" },
        { "another issuer, by one character",
            q("{'issuer':'https://auth.example.org/','authorization_endpoint':'https://auth.example.org/authorize','token_endpoint':'https://auth.example.org/token','code_challenge_methods_supported':['S256']}"), "oauth-issuer" },
        { "no issuer", q("{'authorization_endpoint':'https://auth.example.org/authorize','token_endpoint':'https://auth.example.org/token','code_challenge_methods_supported':['S256']}"), "oauth-issuer" },
        { "it does not say it does PKCE", q("{'issuer':'https://auth.example.org','authorization_endpoint':'https://auth.example.org/authorize','token_endpoint':'https://auth.example.org/token'}"), "oauth-no-pkce" },
        { "PKCE without SHA-256",
            q("{'issuer':'https://auth.example.org','authorization_endpoint':'https://auth.example.org/authorize','token_endpoint':'https://auth.example.org/token','code_challenge_methods_supported':['plain']}"), "oauth-no-pkce" },
        { "the token endpoint in the local network",
            q("{'issuer':'https://auth.example.org','authorization_endpoint':'https://auth.example.org/authorize','token_endpoint':'https://router.lan/token','code_challenge_methods_supported':['S256']}"), "oauth-endpoints" },
        { "no authorization endpoint", q("{'issuer':'https://auth.example.org','token_endpoint':'https://auth.example.org/token','code_challenge_methods_supported':['S256']}"), "oauth-endpoints" },
        { "no code flow",
            q("{'issuer':'https://auth.example.org','authorization_endpoint':'https://auth.example.org/authorize','token_endpoint':'https://auth.example.org/token','response_types_supported':['token'],'code_challenge_methods_supported':['S256']}"),
            "oauth-endpoints" },
        { "a page, not a document", "<html><body>Not found</body></html>", "oauth-no-metadata" },
        { "a list, not a document", "[]", "oauth-no-metadata" },
    };

    private static final Object[][] RESOURCE_CASES = {
        { "https://mcp.example.com/mcp", "https://mcp.example.com/mcp", true },
        { "https://mcp.example.com", "https://mcp.example.com/mcp", true },
        { "https://mcp.example.com/", "https://mcp.example.com/mcp", true },
        { "https://mcp.example.com/mcp", "https://mcp.example.com/mcp/v1?x=1", true },
        { "https://MCP.Example.com/mcp", "https://mcp.example.com/mcp", true },
        { "http://localhost:3000/mcp", "http://localhost:3000/mcp", true },
        { "https://mcp.example.com/mc", "https://mcp.example.com/mcp", false },
        { "https://mcp.example.com/mcp/v1", "https://mcp.example.com/mcp", false },
        { "https://other.example.com/mcp", "https://mcp.example.com/mcp", false },
        { "https://mcp.example.com:8443/mcp", "https://mcp.example.com/mcp", false },
        { "http://mcp.example.com/mcp", "https://mcp.example.com/mcp", false },
        { "https://mcp.example.com/mcp?x=1", "https://mcp.example.com/mcp", false },
        { "https://mcp.example.com/mcp#x", "https://mcp.example.com/mcp", false },
        { "", "https://mcp.example.com/mcp", false },
    };

    /** [the issuer promised to name itself, state, code, iss, error, "ok" or the problem] — begun with state "s1" at ISSUER. */
    private static final Object[][] REDIRECT_CASES = {
        { false, "s1", "c", null, null, "ok" },
        { true, "s1", "c", "https://auth.example.org", null, "ok" },
        { false, "s1", "c", "https://auth.example.org", null, "ok" },
        { true, "s1", "c", null, null, "oauth-issuer" },
        { false, "s1", "c", "https://auth.example.org/", null, "oauth-issuer" },
        { true, "s1", null, "https://evil.example.net", "access_denied", "oauth-issuer" },
        { false, "s2", "c", null, null, "oauth-no-flow" },
        { false, "", "c", null, null, "oauth-no-flow" },
        { false, "s1", null, null, "access_denied", "oauth-denied" },
        { false, "s1", null, null, "server_error", "oauth-failed" },
        { false, "s1", null, null, null, "oauth-failed" },
        { false, "s1", "", null, null, "oauth-failed" },
    };

    private static final Object[][] TOKEN_CASES = {
        { 200, q("{'access_token':'at','token_type':'Bearer','expires_in':3600,'refresh_token':'rt','scope':'read write'}"), "ok" },
        { 200, q("{'access_token':'at','token_type':'bearer'}"), "ok" },
        { 200, q("{'access_token':'at','token_type':'mac'}"), "oauth-token" },
        { 200, q("{'access_token':'','token_type':'Bearer'}"), "oauth-token" },
        { 200, q("{'access_token':'a b','token_type':'Bearer'}"), "oauth-token" },
        { 200, q("{'token_type':'Bearer'}"), "oauth-token" },
        { 200, q("{'access_token':'at','token_type':'Bearer','refresh_token':7}"), "oauth-token" },
        { 200, "not json", "oauth-token" },
        { 400, q("{'error':'invalid_grant'}"), "oauth-grant" },
        { 400, q("{'error':'invalid_client'}"), "oauth-token" },
        { 401, q("{'error':'invalid_grant'}"), "oauth-token" },
        { 500, "", "oauth-token" },
    };

    /** [HTTP status, a registration's answer, how the client proves itself — or null where the answer is none] */
    private static final Object[][] REGISTRATION_CASES = {
        { 201, q("{'client_id':'abc','token_endpoint_auth_method':'none'}"), "none" },
        { 200, q("{'client_id':'abc'}"), "none" },
        { 201, q("{'client_id':'abc','client_secret':'s3','token_endpoint_auth_method':'client_secret_post'}"), "post" },
        { 201, q("{'client_id':'abc','client_secret':'s3','token_endpoint_auth_method':'client_secret_basic'}"), "basic" },
        { 201, q("{'client_id':'abc','client_secret':'s3'}"), "basic" },
        { 201, q("{'client_id':'abc','client_secret':'s3','token_endpoint_auth_method':'none'}"), "none" },
        { 201, q("{'client_id':'abc','token_endpoint_auth_method':'client_secret_post'}"), null },
        { 201, q("{'client_id':'abc','client_secret':'s3','token_endpoint_auth_method':'private_key_jwt'}"), null },
        { 201, q("{'client_secret':'s3'}"), null },
        { 400, q("{'error':'invalid_redirect_uri'}"), null },
        { 201, "nope", null },
    };

    @Test
    public void anAddressAServerNamesIsOnItsOwnHostOrPublicLikeAPage() {
        for (Object[] row : ADDRESS_CASES) {
            assertEquals(row[0] + " -> " + row[1], row[2], AiMcpOAuthRules.oauthAddress((String) row[1], (String) row[0]) != null);
        }
        assertEquals("https://auth.example.org/token", AiMcpOAuthRules.oauthAddress(" https://AUTH.example.org/token ", SERVER));
        assertEquals("https://mcp.example.com:8443/token", AiMcpOAuthRules.oauthAddress("https://mcp.example.com:8443/token", SERVER));
        assertNull(AiMcpOAuthRules.oauthAddress(null, SERVER));
    }

    @Test
    public void metadataIsReadFromTheIssuersOwnOriginUnderWellKnown() {
        for (Object[] row : ISSUER_URL_CASES) {
            assertEquals(row[0] + " at " + row[1], row[2], AiMcpOAuthRules.issuerDocumentUrlOk((String) row[0], (String) row[1]));
        }
    }

    @Test
    public void metadataCountsWhenItNamesTheIssuerUsableEndpointsAndPkce() throws Exception {
        for (String[] row : ISSUER_DOC_CASES) {
            String outcome;
            try {
                AiMcpOAuthRules.readIssuerDocument(row[1], ISSUER, SERVER);
                outcome = "ok";
            } catch (AiMcpOAuthRules.Problem problem) {
                outcome = problem.word;
            }
            assertEquals(row[0], row[2], outcome);
        }
        AiMcpOAuthRules.Endpoints found = AiMcpOAuthRules.readIssuerDocument(COMPLETE, ISSUER, SERVER);
        assertEquals(ISSUER, found.issuer);
        assertEquals("https://auth.example.org/authorize", found.authorization);
        assertEquals("https://auth.example.org/token", found.token);
        assertEquals("https://auth.example.org/register", found.registration);
        assertTrue(found.document);
        assertTrue(found.iss);
        assertEquals(Arrays.asList("read", "write"), found.scopes);
        // A registration endpoint that may not be asked is none; the rest still counts.
        AiMcpOAuthRules.Endpoints plain = AiMcpOAuthRules.readIssuerDocument(
            q("{'issuer':'https://auth.example.org','authorization_endpoint':'https://auth.example.org/authorize','token_endpoint':'https://auth.example.org/token','code_challenge_methods_supported':['S256'],'registration_endpoint':'http://auth.example.org/register'}"),
            ISSUER, SERVER);
        assertNull(plain.registration);
        assertFalse(plain.document);
        assertFalse(plain.iss);
        assertTrue(plain.scopes.isEmpty());
    }

    @Test
    public void aTokenIsForTheServersAddressOrAPartOfIt() {
        for (Object[] row : RESOURCE_CASES) {
            assertEquals(row[0] + " for " + row[1], row[2], AiMcpOAuthRules.resourceCovers((String) row[0], (String) row[1]));
        }
    }

    @Test
    public void theWayBackIsTheAppsOwnAddress() {
        assertEquals("com.plainva.app://mcp/oauth", AiMcpOAuthRules.redirectUri("com.plainva.app"));
        assertEquals("com.plainva.app.labs://mcp/oauth", AiMcpOAuthRules.redirectUri("com.plainva.app.labs"));
        assertNull(AiMcpOAuthRules.redirectUri("https"));
        assertNull(AiMcpOAuthRules.redirectUri(""));
        assertNull(AiMcpOAuthRules.redirectUri(null));
    }

    @Test
    public void whatCameBackIsCheckedAgainstWhatWasBegun() throws Exception {
        for (Object[] row : REDIRECT_CASES) {
            String outcome;
            try {
                AiMcpOAuthRules.checkRedirect("s1", ISSUER, (Boolean) row[0], (String) row[1], (String) row[2], (String) row[3], (String) row[4]);
                outcome = "ok";
            } catch (AiMcpOAuthRules.Problem problem) {
                outcome = problem.word;
            }
            assertEquals(Arrays.toString(row), row[5], outcome);
        }
        try {
            AiMcpOAuthRules.checkRedirect(null, ISSUER, false, "s1", "c", null, null);
            throw new AssertionError("nothing was begun");
        } catch (AiMcpOAuthRules.Problem problem) {
            assertEquals("oauth-no-flow", problem.word);
        }
        assertEquals("c", AiMcpOAuthRules.checkRedirect("s1", ISSUER, false, "s1", "c", null, null));
    }

    @Test
    public void theRequestForASignInNamesEverythingAndKeepsTheEndpointsOwnQuery() {
        String url = AiMcpOAuthRules.authorizationUrl(
            "https://auth.example.org/authorize?tenant=a",
            "https://plainva.com/oauth/client.json",
            "http://127.0.0.1:43117/callback",
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            "s1",
            Arrays.asList("read", "write"),
            "https://mcp.example.com/mcp");
        assertTrue(url.startsWith("https://auth.example.org/authorize?"));
        HttpUrl parsed = HttpUrl.parse(url);
        List<String> pairs = new ArrayList<>();
        for (int i = 0; i < parsed.querySize(); i++) pairs.add(parsed.queryParameterName(i) + "=" + parsed.queryParameterValue(i));
        assertEquals(
            Arrays.asList(
                "tenant=a",
                "response_type=code",
                "client_id=https://plainva.com/oauth/client.json",
                "redirect_uri=http://127.0.0.1:43117/callback",
                "code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
                "code_challenge_method=S256",
                "state=s1",
                "resource=https://mcp.example.com/mcp",
                "scope=read write"),
            pairs);
        // The address itself has no blank in it: a scope list travels encoded.
        assertFalse(url.contains(" "));
        String bare = AiMcpOAuthRules.authorizationUrl("https://auth.example.org/authorize", "c", "r", "x", "s", Collections.<String>emptyList(), "q");
        assertFalse(bare.contains("scope="));
        assertNull(AiMcpOAuthRules.authorizationUrl("not an address", "c", "r", "x", "s", Collections.<String>emptyList(), "q"));
    }

    @Test
    public void theChallengeIsTheHashOfTheVerifierAndSecretsAreLongEnough() {
        // RFC 7636, appendix B.
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", AiMcpOAuthRules.pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
        String verifier = AiMcpOAuthRules.random(32);
        assertTrue(verifier, verifier.matches("^[A-Za-z0-9_-]{43}$"));
        assertNotEquals(verifier, AiMcpOAuthRules.random(32));
        assertTrue(AiMcpOAuthRules.random(16).matches("^[A-Za-z0-9_-]{22}$"));
        // The three lengths a group of bytes can end in.
        assertEquals("", AiMcpOAuthRules.base64Url(new byte[0]));
        assertEquals("Zg", AiMcpOAuthRules.base64Url("f".getBytes()));
        assertEquals("Zm8", AiMcpOAuthRules.base64Url("fo".getBytes()));
        assertEquals("Zm9v", AiMcpOAuthRules.base64Url("foo".getBytes()));
        assertEquals("-_8", AiMcpOAuthRules.base64Url(new byte[] { (byte) 0xfb, (byte) 0xff }));
    }

    @Test
    public void aClientIdIsPrintableAndAsADescriptionAPublicAddressWithAPath() {
        assertEquals("my-client 1", AiMcpOAuthRules.clientId(false, " my-client 1 "));
        assertNull(AiMcpOAuthRules.clientId(false, ""));
        assertNull(AiMcpOAuthRules.clientId(false, "a\nb"));
        StringBuilder longId = new StringBuilder();
        for (int i = 0; i < 513; i++) longId.append('a');
        assertNull(AiMcpOAuthRules.clientId(false, longId.toString()));
        assertEquals("https://plainva.com/oauth/client.json", AiMcpOAuthRules.clientId(true, "https://plainva.com/oauth/client.json"));
        for (String bad : new String[] { "https://plainva.com/", "https://plainva.com", "http://plainva.com/oauth/client.json", "https://192.168.1.2/client.json", "https://plainva.com/oauth/client.json#x", "my-client" }) {
            assertNull(bad, AiMcpOAuthRules.clientId(true, bad));
        }
    }

    private static List<String> flat(List<String[]> fields) {
        List<String> out = new ArrayList<>();
        for (String[] field : fields) out.add(field[0] + "=" + field[1]);
        return out;
    }

    @Test
    public void theTokenEndpointIsAskedWithTheGrantTheClientAndWhoTheTokenIsFor() {
        AiMcpOAuthRules.Client open = new AiMcpOAuthRules.Client("abc", "none", null);
        List<String[]> code = AiMcpOAuthRules.codeForm("c1", "v1", "http://127.0.0.1:43117/callback", open, "https://mcp.example.com/mcp");
        assertEquals(
            Arrays.asList("grant_type=authorization_code", "code=c1", "redirect_uri=http://127.0.0.1:43117/callback", "code_verifier=v1", "client_id=abc", "resource=https://mcp.example.com/mcp"),
            flat(code));
        assertEquals(
            "grant_type=authorization_code&code=c1&redirect_uri=http%3A%2F%2F127.0.0.1%3A43117%2Fcallback&code_verifier=v1&client_id=abc&resource=https%3A%2F%2Fmcp.example.com%2Fmcp",
            AiMcpOAuthRules.formBody(code));
        AiMcpOAuthRules.Client post = new AiMcpOAuthRules.Client("abc", "post", "s3");
        assertEquals(
            Arrays.asList("grant_type=refresh_token", "refresh_token=rt", "client_id=abc", "resource=https://mcp.example.com", "client_secret=s3"),
            flat(AiMcpOAuthRules.refreshForm("rt", post, "https://mcp.example.com")));
        // A secret that is the request's own credential is not in the body as well.
        AiMcpOAuthRules.Client basic = new AiMcpOAuthRules.Client("abc", "basic", "s3");
        for (String field : flat(AiMcpOAuthRules.refreshForm("rt", basic, "r"))) assertFalse(field, field.startsWith("client_secret="));
        assertEquals("a+b%2Bc%2Fd%3De%26f%7E", AiMcpOAuthRules.formEncode("a b+c/d=e&f~"));
    }

    @Test
    public void aTokenEndpointAnswersWithABearerTokenOrSaysTheSignInIsOver() throws Exception {
        for (Object[] row : TOKEN_CASES) {
            String outcome;
            try {
                AiMcpOAuthRules.readTokenResponse((Integer) row[0], (String) row[1]);
                outcome = "ok";
            } catch (AiMcpOAuthRules.Problem problem) {
                outcome = problem.word;
            }
            assertEquals(row[0] + " " + row[1], row[2], outcome);
        }
        AiMcpOAuthRules.Tokens full = AiMcpOAuthRules.readTokenResponse(200, (String) TOKEN_CASES[0][1]);
        assertEquals("at", full.access);
        assertEquals("rt", full.refresh);
        assertEquals(3600, full.expiresIn);
        assertEquals(Arrays.asList("read", "write"), full.scopes);
        AiMcpOAuthRules.Tokens bare = AiMcpOAuthRules.readTokenResponse(200, q("{'access_token':'at','token_type':'Bearer','expires_in':-5,'refresh_token':null}"));
        assertNull(bare.refresh);
        assertEquals(-1, bare.expiresIn);
        assertNull(bare.scopes);
        // A lifetime no whole number holds is capped, not believed.
        assertEquals(10L * 365 * 24 * 3600, AiMcpOAuthRules.readTokenResponse(200, q("{'access_token':'at','token_type':'Bearer','expires_in':1e300}")).expiresIn);
        StringBuilder longToken = new StringBuilder();
        for (int i = 0; i < AiMcpOAuthRules.MAX_TOKEN + 1; i++) longToken.append('a');
        try {
            AiMcpOAuthRules.readTokenResponse(200, q("{'access_token':'" + longToken + "','token_type':'Bearer'}"));
            throw new AssertionError("a token that long is none");
        } catch (AiMcpOAuthRules.Problem problem) {
            assertEquals("oauth-token", problem.word);
        }
    }

    @Test
    public void aRegistrationGivesAnIdAndASecretOnlyWhereTheServerInsists() throws Exception {
        JSONObject body = new JSONObject(AiMcpOAuthRules.registrationBody("Plainva", "com.plainva.app://mcp/oauth"));
        assertEquals("Plainva", body.getString("client_name"));
        assertEquals("com.plainva.app://mcp/oauth", body.getJSONArray("redirect_uris").getString(0));
        assertEquals(1, body.getJSONArray("redirect_uris").length());
        assertEquals(new JSONArray().put("authorization_code").put("refresh_token").toString(), body.getJSONArray("grant_types").toString());
        assertEquals(new JSONArray().put("code").toString(), body.getJSONArray("response_types").toString());
        assertEquals("none", body.getString("token_endpoint_auth_method"));
        assertEquals("native", body.getString("application_type"));
        assertEquals(6, body.length());
        for (Object[] row : REGISTRATION_CASES) {
            AiMcpOAuthRules.Client client = AiMcpOAuthRules.readRegistration((Integer) row[0], (String) row[1]);
            assertEquals(row[0] + " " + row[1], row[2], client == null ? null : client.auth);
        }
        AiMcpOAuthRules.Client post = AiMcpOAuthRules.readRegistration(201, (String) REGISTRATION_CASES[2][1]);
        assertEquals("abc", post.id);
        assertEquals("s3", post.secret);
        assertNull(AiMcpOAuthRules.readRegistration(201, (String) REGISTRATION_CASES[5][1]).secret);
    }

    @Test
    public void scopesAreVisibleAsciiEachOnce() {
        assertEquals(Arrays.asList("read", "ok"), AiMcpOAuthRules.readScopes("read  wri\"te read ok"));
        assertEquals(Arrays.asList("a", "b"), AiMcpOAuthRules.readScopes(new JSONArray().put("a").put(7).put("a").put("b")));
        StringBuilder many = new StringBuilder();
        for (int i = 0; i < 80; i++) many.append(i == 0 ? "" : " ").append("s").append(i);
        assertEquals(AiMcpOAuthRules.MAX_SCOPES, AiMcpOAuthRules.readScopes(many.toString()).size());
        assertTrue(AiMcpOAuthRules.readScopes(null).isEmpty());
        assertEquals("read write", AiMcpOAuthRules.joined(Arrays.asList("read", "write")));
    }

    @Test
    public void whatIsKeptOfASignInIsNobodyElsesEntry() {
        // An id has no `#`: the sign-in of a server can never be the token of another one.
        assertEquals("tracker#oauth", AiMcpAuthStore.linkName("tracker"));
        assertFalse(AiMcpRules.validId("tracker#oauth"));
        assertFalse(AiMcpRules.validId(AiMcpAuthStore.PENDING));
    }
}
