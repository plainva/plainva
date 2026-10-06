//! The assistant's page fetch (plan KI-Harness P4, threat T2).
//!
//! The internet is off until the user switches it on for a vault, and even
//! then a page is only ever READ: one GET over https, without credentials,
//! cookies or a body, to a public address, following redirects inside the
//! site only. The web view decides nothing of this — it names an address, and
//! every rule is applied here again.
//!
//! The rule functions mirror `packages/core/src/ai/web/rules.ts`, and the
//! tests below run the same vectors (`WEB_URL_CASES`, `ADDRESS_CASES`): a
//! case added there is added here.

use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use serde::Serialize;
use tauri::State;

use crate::ai_egress::{only_main, AiEgress};

const URL_MAX: usize = 2048;
const MAX_REDIRECTS: usize = 5;
const MAX_BYTES: usize = 2_000_000;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// The whole fetch, redirects included.
const DEADLINE: Duration = Duration::from_secs(20);

/// What is accepted as a page: text a reader can take down.
const CONTENT_TYPES: [&str; 7] = ["text/html", "application/xhtml+xml", "text/plain", "text/markdown", "application/json", "application/xml", "text/xml"];

/// Names that never leave the local network or are reserved for it.
const LOCAL_SUFFIXES: [&str; 15] = [
    "localhost", "local", "localdomain", "internal", "intranet", "lan", "home", "corp", "private", "home.arpa", "test", "example", "invalid", "onion", "arpa",
];

/// Says who is asking, as the app that it is — the same words in every shell, without a version to tell devices apart by.
const USER_AGENT: &str = "Mozilla/5.0 (compatible; Plainva; +https://plainva.com)";

#[derive(Debug, Clone, PartialEq)]
pub struct WebTarget {
    pub url: reqwest::Url,
    pub host: String,
}

fn host_problem(host: &str) -> bool {
    if host.is_empty() || host.len() > 253 {
        return true;
    }
    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() < 2 {
        return true;
    }
    let bad_label = |label: &&str| {
        label.is_empty()
            || label.len() > 63
            || !label.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            || label.starts_with('-')
            || label.ends_with('-')
    };
    if labels.iter().any(bad_label) {
        return true;
    }
    // A top-level name is letters or punycode — never digits, which would be an address in disguise.
    let tld = labels[labels.len() - 1];
    let letters = tld.len() >= 2 && tld.bytes().all(|b| b.is_ascii_lowercase());
    if !letters && !tld.starts_with("xn--") {
        return true;
    }
    LOCAL_SUFFIXES.iter().any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

/// Whether a request may go to this address at all. The problem names are those of the TypeScript side.
pub fn check_web_url(raw: &str) -> Result<WebTarget, &'static str> {
    let text = raw.trim();
    // Control characters and whitespace inside an address are how a parser is made to disagree with a reader.
    if text.is_empty() || text.chars().any(|c| (c as u32) <= 32 || (c as u32) == 127) {
        return Err("not-a-url");
    }
    if text.chars().count() > URL_MAX {
        return Err("too-long");
    }
    let mut url = reqwest::Url::parse(text).map_err(|_| "not-a-url")?;
    if url.scheme() != "https" {
        return Err("scheme");
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("credentials");
    }
    // The parser already drops an explicit default port.
    if url.port().is_some() {
        return Err("port");
    }
    // An IP address in any spelling is no domain: the parser has normalised it to one by now.
    let Some(domain) = url.domain() else {
        return Err("host");
    };
    let host = domain.to_ascii_lowercase().trim_end_matches('.').to_string();
    if host_problem(&host) {
        return Err("host");
    }
    url.set_host(Some(&host)).map_err(|_| "host")?;
    url.set_fragment(None);
    if url.as_str().chars().count() > URL_MAX {
        return Err("too-long");
    }
    Ok(WebTarget { url, host })
}

fn public_ipv4(octets: [u8; 4]) -> bool {
    let [a, b, c, _] = octets;
    if a == 0 || a == 10 || a == 127 {
        return false; // "this" network, private, loopback
    }
    if a == 100 && (64..=127).contains(&b) {
        return false; // carrier-grade NAT
    }
    if a == 169 && b == 254 {
        return false; // link-local, cloud metadata
    }
    if a == 172 && (16..=31).contains(&b) {
        return false; // private
    }
    if a == 192 && b == 0 && (c == 0 || c == 2) {
        return false; // protocol assignments, documentation
    }
    if a == 192 && b == 88 && c == 99 {
        return false; // 6to4 relay
    }
    if a == 192 && b == 168 {
        return false; // private
    }
    if a == 198 && (b == 18 || b == 19) {
        return false; // benchmarking
    }
    if a == 198 && b == 51 && c == 100 {
        return false; // documentation
    }
    if a == 203 && b == 0 && c == 113 {
        return false; // documentation
    }
    a < 224 // multicast, reserved, broadcast
}

fn public_ipv6(g: [u16; 8]) -> bool {
    let embedded = |hi: u16, lo: u16| public_ipv4([(hi >> 8) as u8, (hi & 0xff) as u8, (lo >> 8) as u8, (lo & 0xff) as u8]);
    if g[0] == 0 && g[1] == 0 && g[2] == 0 && g[3] == 0 && g[4] == 0 {
        // IPv4-mapped is only as public as the address inside; `::`, `::1` and the IPv4-compatible form are not public.
        return g[5] == 0xffff && embedded(g[6], g[7]);
    }
    if g[0] == 0x64 && g[1] == 0xff9b && g[2] == 0 && g[3] == 0 && g[4] == 0 && g[5] == 0 {
        return embedded(g[6], g[7]); // NAT64
    }
    if g[0] == 0x2002 {
        return embedded(g[1], g[2]); // 6to4
    }
    if g[0] == 0x2001 && g[1] == 0x0db8 {
        return false; // documentation
    }
    if g[0] == 0x2001 && g[1] == 0 {
        return false; // Teredo
    }
    if (g[0] & 0xfe00) == 0xfc00 {
        return false; // unique local
    }
    if (g[0] & 0xffc0) == 0xfe80 {
        return false; // link-local
    }
    if (g[0] & 0xffc0) == 0xfec0 {
        return false; // site-local (deprecated)
    }
    if (g[0] & 0xff00) == 0xff00 {
        return false; // multicast
    }
    (g[0] & 0xe000) == 0x2000 // global unicast is 2000::/3
}

/// Whether an address a host name resolved to lies on the public internet.
pub fn is_public_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(v4) => public_ipv4(v4.octets()),
        IpAddr::V6(v6) => public_ipv6(v6.segments()),
    }
}

fn without_www(host: &str) -> &str {
    host.strip_prefix("www.").unwrap_or(host)
}

/// One site for a redirect: the same host, `www.` or not, or one name below the other.
pub fn same_site(a: &str, b: &str) -> bool {
    let (x, y) = (without_www(a), without_www(b));
    x == y || x.ends_with(&format!(".{y}")) || y.ends_with(&format!(".{x}"))
}

#[derive(Debug, PartialEq)]
pub enum Redirect {
    Follow(WebTarget),
    /// Another site: the request stops and says where it wanted to go.
    Elsewhere(WebTarget),
    Refused(&'static str),
}

pub fn redirect_decision(from: &WebTarget, location: Option<&str>, hops: usize) -> Redirect {
    if hops >= MAX_REDIRECTS {
        return Redirect::Refused("too-many");
    }
    let Some(location) = location.map(str::trim).filter(|value| !value.is_empty()) else {
        return Redirect::Refused("no-location");
    };
    let Ok(next) = from.url.join(location) else {
        return Redirect::Refused("not-a-url");
    };
    match check_web_url(next.as_str()) {
        Err(problem) => Redirect::Refused(problem),
        Ok(target) if same_site(&from.host, &target.host) => Redirect::Follow(target),
        Ok(target) => Redirect::Elsewhere(target),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WebFetchResult {
    #[serde(rename_all = "camelCase")]
    Page { url: String, status: u16, content_type: String, body: String, truncated: bool },
    Elsewhere { url: String },
    Refused { problem: String },
    Failed { code: String, message: Option<String> },
}

fn refused(problem: &str) -> WebFetchResult {
    WebFetchResult::Refused { problem: problem.into() }
}

fn failed(code: &str) -> WebFetchResult {
    WebFetchResult::Failed { code: code.into(), message: None }
}

/// The media type of a Content-Type header, lowercase, without its parameters.
fn media_type(header: &str) -> String {
    header.split(';').next().unwrap_or("").trim().to_ascii_lowercase()
}

/// The charset a Content-Type header names, if any.
fn header_charset(header: &str) -> Option<String> {
    header.split(';').skip(1).find_map(|part| {
        let (name, value) = part.split_once('=')?;
        name.trim().eq_ignore_ascii_case("charset").then(|| value.trim().trim_matches('"').to_string())
    })
}

/// The charset an HTML document declares in its first bytes (`<meta charset=…>` or the http-equiv form).
fn meta_charset(bytes: &[u8]) -> Option<String> {
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(2048)]).to_ascii_lowercase();
    let at = head.find("charset=")? + "charset=".len();
    let name: String = head[at..].trim_start_matches(['"', '\'', ' ']).chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    (!name.is_empty()).then_some(name)
}

/// Bytes as text: the charset the server named, else the one the page declares, else UTF-8. A byte order mark decides before all of them.
fn decode(bytes: &[u8], content_type: &str) -> String {
    let label = header_charset(content_type).or_else(|| meta_charset(bytes));
    let encoding = label.and_then(|name| encoding_rs::Encoding::for_label(name.as_bytes())).unwrap_or(encoding_rs::UTF_8);
    encoding.decode(bytes).0.into_owned()
}

/// Resolves the host and returns its addresses only when EVERY one of them is public: a name that answers with a
/// public address first and a private one second is the rebinding trick.
async fn resolve_public(host: &str) -> Result<Vec<SocketAddr>, WebFetchResult> {
    let addresses: Vec<SocketAddr> = match tokio::net::lookup_host((host, 443)).await {
        Ok(found) => found.collect(),
        Err(_) => return Err(failed("offline")),
    };
    if addresses.is_empty() {
        return Err(failed("offline"));
    }
    if addresses.iter().any(|address| !is_public_address(address.ip())) {
        return Err(refused("private-address"));
    }
    Ok(addresses)
}

fn request_failure(error: &reqwest::Error) -> WebFetchResult {
    if error.is_timeout() {
        return failed("timeout");
    }
    // A certificate that was not accepted surfaces as a connect error whose source names it.
    let text = format!("{error:?}").to_ascii_lowercase();
    if text.contains("certificate") || text.contains("tls") || text.contains("handshake") {
        return failed("tls");
    }
    if error.is_connect() {
        return failed("offline");
    }
    failed("error")
}

async fn fetch(start: WebTarget) -> WebFetchResult {
    let mut target = start;
    for hops in 0..=MAX_REDIRECTS {
        let addresses = match resolve_public(&target.host).await {
            Ok(addresses) => addresses,
            Err(result) => return result,
        };
        // The connection goes to exactly the addresses that were checked: no second lookup that could answer differently.
        // No redirect is followed by the client; each hop is decided here.
        let client = match reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(CONNECT_TIMEOUT)
            .https_only(true)
            .resolve_to_addrs(&target.host, &addresses)
            .user_agent(USER_AGENT)
            .build()
        {
            Ok(client) => client,
            Err(_) => return failed("error"),
        };
        let request = client
            .get(target.url.clone())
            .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.1");
        let mut response = match request.send().await {
            Ok(response) => response,
            Err(error) => return request_failure(&error),
        };
        let status = response.status().as_u16();
        if (300..400).contains(&status) {
            let location = response.headers().get(reqwest::header::LOCATION).and_then(|value| value.to_str().ok()).map(str::to_owned);
            match redirect_decision(&target, location.as_deref(), hops) {
                Redirect::Follow(next) => {
                    target = next;
                    continue;
                }
                Redirect::Elsewhere(next) => return WebFetchResult::Elsewhere { url: next.url.into() },
                Redirect::Refused(problem) => return refused(problem),
            }
        }
        let content_type = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|value| value.to_str().ok()).unwrap_or("").chars().take(200).collect::<String>();
        if !(200..300).contains(&status) {
            // An error page is not read: the status is the answer.
            return WebFetchResult::Page { url: target.url.into(), status, content_type, body: String::new(), truncated: false };
        }
        let media = media_type(&content_type);
        if !media.is_empty() && !CONTENT_TYPES.contains(&media.as_str()) {
            return refused("content-type");
        }
        let mut bytes: Vec<u8> = Vec::new();
        let mut truncated = false;
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    let room = MAX_BYTES - bytes.len();
                    if chunk.len() > room {
                        bytes.extend_from_slice(&chunk[..room]);
                        truncated = true;
                        break;
                    }
                    bytes.extend_from_slice(&chunk);
                }
                Ok(None) => break,
                Err(error) => return request_failure(&error),
            }
        }
        return WebFetchResult::Page { url: target.url.into(), status, body: decode(&bytes, &content_type), content_type, truncated };
    }
    refused("too-many")
}

/// Reads one page for the assistant. `ai_http_cancel` with the same id stops it.
#[tauri::command]
pub async fn ai_web_fetch(window: tauri::Window, state: State<'_, AiEgress>, url: String, request_id: String) -> Result<WebFetchResult, String> {
    only_main(&window)?;
    let target = match check_web_url(&url) {
        Ok(target) => target,
        Err(problem) => return Ok(refused(problem)),
    };
    let cancel = state.track(&request_id)?;
    let result = tokio::select! {
        _ = cancel => failed("cancelled"),
        outcome = tokio::time::timeout(DEADLINE, fetch(target)) => outcome.unwrap_or_else(|_| failed("timeout")),
    };
    state.untrack(&request_id);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// [address, the normalised request or the problem] — the same list as `WEB_URL_CASES` in web.test.ts.
    const WEB_URL_CASES: &[(&str, &str)] = &[
        ("https://example.org/a?b=c#frag", "https://example.org/a?b=c"),
        ("https://EXAMPLE.org:443/Path", "https://example.org/Path"),
        ("https://example.org./", "https://example.org/"),
        ("https://b\u{fc}cher.de/", "https://xn--bcher-kva.de/"),
        ("  https://sub.example.co.uk/x  ", "https://sub.example.co.uk/x"),
        ("http://example.org/", "scheme"),
        ("ftp://example.org/", "scheme"),
        ("javascript:alert(1)", "scheme"),
        ("file:///etc/passwd", "scheme"),
        ("https://user:secret@example.org/", "credentials"),
        ("https://example.org:8443/", "port"),
        ("https://localhost/", "host"),
        ("https://intranet/", "host"),
        ("https://router.local/", "host"),
        ("https://nas.home.arpa/", "host"),
        ("https://build.internal/", "host"),
        ("https://hidden.onion/", "host"),
        ("https://127.0.0.1/", "host"),
        ("https://0x7f.0.0.1/", "host"),
        ("https://2130706433/", "host"),
        ("https://169.254.169.254/latest/meta-data/", "host"),
        ("https://[::1]/", "host"),
        ("https://[fd00::1]/", "host"),
        ("https://exa mple.org/", "not-a-url"),
        ("https://example.org/a\nb", "not-a-url"),
        ("example.org", "not-a-url"),
        ("", "not-a-url"),
    ];

    /// [address a name resolved to, whether a request may go there] — the parsable part of `ADDRESS_CASES`.
    const ADDRESS_CASES: &[(&str, bool)] = &[
        ("93.184.216.34", true),
        ("8.8.8.8", true),
        ("172.15.0.1", true),
        ("172.32.0.1", true),
        ("100.63.255.255", true),
        ("100.128.0.1", true),
        ("2606:4700:4700::1111", true),
        ("2001:4860:4860::8888", true),
        ("::ffff:8.8.8.8", true),
        ("64:ff9b::808:808", true),
        ("2002:808:808::1", true),
        ("0.0.0.0", false),
        ("10.0.0.1", false),
        ("100.64.0.1", false),
        ("127.0.0.1", false),
        ("169.254.169.254", false),
        ("172.16.0.1", false),
        ("172.31.255.255", false),
        ("192.0.2.1", false),
        ("192.168.1.1", false),
        ("198.18.0.1", false),
        ("198.51.100.7", false),
        ("203.0.113.7", false),
        ("224.0.0.1", false),
        ("255.255.255.255", false),
        ("::", false),
        ("::1", false),
        ("::127.0.0.1", false),
        ("::ffff:127.0.0.1", false),
        ("::ffff:10.0.0.1", false),
        ("64:ff9b::a00:1", false),
        ("2002:7f00:1::1", false),
        ("2001:db8::1", false),
        ("2001:0:4136:e378:8000:63bf:3fff:fdd2", false),
        ("fe80::1", false),
        ("fec0::1", false),
        ("fc00::1", false),
        ("fd12:3456:789a::1", false),
        ("ff02::1", false),
        ("4000::1", false),
    ];

    fn target(url: &str) -> WebTarget {
        check_web_url(url).expect("a valid address")
    }

    #[test]
    fn accepts_a_public_https_address_and_nothing_else() {
        for (raw, expected) in WEB_URL_CASES {
            let outcome = match check_web_url(raw) {
                Ok(target) => target.url.to_string(),
                Err(problem) => problem.to_string(),
            };
            assert_eq!(&outcome, expected, "{raw}");
        }
        let long = format!("https://example.org/{}", "a".repeat(URL_MAX));
        assert_eq!(check_web_url(&long), Err("too-long"));
        assert_eq!(target("https://Docs.Example.org/guide").host, "docs.example.org");
    }

    #[test]
    fn tells_a_public_address_from_one_behind_the_users_own_door() {
        for (address, expected) in ADDRESS_CASES {
            let parsed: IpAddr = address.parse().unwrap_or_else(|_| panic!("{address} parses"));
            assert_eq!(is_public_address(parsed), *expected, "{address}");
        }
    }

    #[test]
    fn follows_a_redirect_inside_the_site_and_stops_at_another_one() {
        let from = target("https://example.org/a/b");
        assert_eq!(redirect_decision(&from, Some("/c"), 0), Redirect::Follow(target("https://example.org/c")));
        assert_eq!(redirect_decision(&from, Some("d?x=1"), 1), Redirect::Follow(target("https://example.org/a/d?x=1")));
        assert!(matches!(redirect_decision(&from, Some("https://www.example.org/"), 0), Redirect::Follow(_)));
        assert!(matches!(redirect_decision(&from, Some("https://docs.example.org/"), 0), Redirect::Follow(_)));
        assert_eq!(
            redirect_decision(&from, Some("https://other.example.net/landing?from=example"), 0),
            Redirect::Elsewhere(target("https://other.example.net/landing?from=example"))
        );
        assert!(matches!(redirect_decision(&from, Some("//other.example.net/x"), 0), Redirect::Elsewhere(_)));
        // A redirect cannot lead where a request could not start.
        assert_eq!(redirect_decision(&from, Some("http://example.org/c"), 0), Redirect::Refused("scheme"));
        assert_eq!(redirect_decision(&from, Some("https://10.0.0.1/"), 0), Redirect::Refused("host"));
        assert_eq!(redirect_decision(&from, Some("https://localhost/admin"), 0), Redirect::Refused("host"));
        assert_eq!(redirect_decision(&from, None, 0), Redirect::Refused("no-location"));
        assert_eq!(redirect_decision(&from, Some("  "), 0), Redirect::Refused("no-location"));
        assert_eq!(redirect_decision(&from, Some("/c"), MAX_REDIRECTS), Redirect::Refused("too-many"));
    }

    #[test]
    fn counts_www_and_names_below_each_other_as_one_site() {
        assert!(same_site("example.org", "www.example.org"));
        assert!(same_site("docs.example.org", "example.org"));
        assert!(!same_site("example.org", "example.net"));
        assert!(!same_site("badexample.org", "example.org"));
    }

    #[test]
    fn reads_a_body_in_the_charset_it_names() {
        assert_eq!(media_type("Text/HTML; charset=UTF-8"), "text/html");
        assert_eq!(header_charset("text/html; charset=\"ISO-8859-1\""), Some("ISO-8859-1".into()));
        assert_eq!(header_charset("text/html"), None);
        // The server names it.
        assert_eq!(decode(&[0x47, 0x72, 0xfc, 0xdf, 0x65], "text/html; charset=iso-8859-1"), "Gr\u{fc}\u{df}e");
        // The page names it.
        let mut page = b"<html><head><meta charset=\"windows-1252\"></head><body>".to_vec();
        page.extend_from_slice(&[0x80, 0x31]);
        assert!(decode(&page, "text/html").ends_with("\u{20ac}1"));
        let equiv = b"<meta http-equiv=\"Content-Type\" content=\"text/html; charset=iso-8859-1\">\xe9";
        assert!(decode(equiv, "").ends_with("\u{e9}"));
        // Nobody names it: UTF-8, and what is not UTF-8 becomes the replacement character rather than an error.
        assert_eq!(decode("Gr\u{fc}\u{df}e".as_bytes(), "text/plain"), "Gr\u{fc}\u{df}e");
        assert_eq!(decode(&[0x41, 0xff, 0x42], ""), "A\u{fffd}B");
    }

    #[test]
    fn answers_in_the_shape_the_web_view_reads() {
        let page = WebFetchResult::Page { url: "https://example.org/".into(), status: 200, content_type: "text/html".into(), body: "x".into(), truncated: false };
        assert_eq!(
            serde_json::to_value(&page).unwrap(),
            serde_json::json!({ "kind": "page", "url": "https://example.org/", "status": 200, "contentType": "text/html", "body": "x", "truncated": false })
        );
        assert_eq!(serde_json::to_value(refused("private-address")).unwrap(), serde_json::json!({ "kind": "refused", "problem": "private-address" }));
        assert_eq!(serde_json::to_value(WebFetchResult::Elsewhere { url: "https://b.example.net/".into() }).unwrap(), serde_json::json!({ "kind": "elsewhere", "url": "https://b.example.net/" }));
        assert_eq!(serde_json::to_value(failed("timeout")).unwrap(), serde_json::json!({ "kind": "failed", "code": "timeout", "message": null }));
    }

    #[tokio::test]
    async fn refuses_a_name_that_resolves_to_this_machine() {
        // `localhost` is refused by name before any lookup; a name that merely RESOLVES to the loopback is what this
        // check is for. The lookup of an IP literal is the lookup that needs no network.
        assert_eq!(resolve_public("127.0.0.1").await, Err(refused("private-address")));
        assert_eq!(resolve_public("::1").await, Err(refused("private-address")));
    }
}
