# Public ingestion transport

Text ingestion and the five public ATS adapters use one direct GET/HEAD transport.
There is no private-network exception, proxy path, custom fetch option, cookie jar,
or caller-controlled socket/TLS override. Offline mode stops before resolution.
The static application server gains no ingestion endpoint.

## Admission and socket ownership

`public-policy.js` canonicalizes HTTP(S) URLs, IDNA names, terminal dots, default
ports and numeric literals. Userinfo, zones, localhost names, special-purpose
addresses and unsupported methods/options fail closed. Paths and opaque query
values retain their URL semantics; fragments are removed. Error messages omit
queries, credentials, response content and job descriptions. Known credential
query keys and the conservative `credentialQuery` marker prevent cross-origin
redirects; this is not a generic query-secret detector.

`public-address-ranges.js` pins a conservative union of the
[IANA IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry) and
[IANA IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry) special-purpose
registries, reviewed 2026-10-13. Parent ranges include more-specific exceptions.
IPv4 multicast/reserved space is also denied. IPv6 must be in 2000::/3 and outside
every listed special range. Mapped input, translation and transition prefixes
are rejected, even if some special-purpose ranges are globally reachable.
The table is checked at module initialization; resolution never downloads policy.

Every hop and retry resolves afresh. An empty, malformed, excessive or partly
forbidden answer set is rejected as a whole. Validated records are copied and
frozen. The connector dials only numeric members with a fixed family and disabled
implicit family selection. The selected address and port must match the connected
peer before HTTP receives the socket. Mapped OS peer notation can compare equal
to an approved IPv4 endpoint; it does not authorize mapped input URLs.

HTTPS wraps that TCP socket with normal certificate-chain verification, explicit
logical-host certificate identity, SNI for DNS names and HTTP/1.1 ALPN only.
IP literals omit SNI and require IP identity. The URL and Host remain the logical
origin. A single-use internal Agent callback receives only the connected, verified
socket; no pooled socket crosses requests. An alternate approved address starts
after 250 ms, preferring the other family. At most two candidates participate;
losers are cancelled and destroyed. There is no implicit re-resolution.

## Redirects, bodies and cancellation

301, 302, 303, 307 and 308 are handled explicitly. Each Location re-enters admission
before another connection. Missing/invalid locations, loops, excess redirects and
HTTPS downgrade fail. Credentialless public redirects, including HTTP upgrades and
CDNs, remain supported. Authorization, Cookie, proxy credentials and unclassified
headers prevent cross-origin redirects. Only User-Agent, Accept, Accept-Language
and transport-owned Accept-Encoding are safe across origins. Conditional headers
are removed whenever the canonical resource URL changes, including same-origin
redirects. The previous query is never appended to a Location.

A request owner starts before queue admission. Its timer and cancellation remain
active through queue/rate waits, DNS, TCP/TLS, headers, redirects, retries, backoff,
body collection and decoding. The earliest run/request deadline wins. Cancellation
ignores late resolver answers; OS resolution itself is not physically cancelled,
and a bounded resolver slot remains occupied until it settles.

Encoded bytes are counted as chunks arrive, with an idle timer around every read.
The bounded encoded buffer is then decoded through a bounded streaming decoder.
Supported encodings are identity, gzip, Brotli and wrapped or legacy raw deflate;
stacked/unknown encodings and corrupt/truncated bodies fail. Decoded bytes and
aggregate run bytes are independently counted. A decoder branch never resets
counters. Content-Length cannot waive actual byte limits. HEAD/204/304 use null
bodies and ignore representation length/encoding.

All owned sockets, requests, responses and decoders are destroyed on completion or
failure. Only a genuine `node-fetch` Response constructed from a Buffer (or null)
escapes. It retains status, headers, final URL, redirect counter and ordinary
text/json/bodyUsed behavior. The locked library's clone does not preserve its
redirect counter. Request/get now settle after the complete bounded body, rather
than at headers. Later synchronous parsing is size-bounded, not CPU-preemptible.

## Budgets and integration

Defaults and trusted ceilings use MiB = 1,048,576 bytes. Caller request limits may
only reduce a constructed run context's limits. Invalid, fractional, nonfinite,
negative or excessive limits fail. Zero retries/redirects and zero rate intervals
are supported.

| Limit                                              |        Default |        Ceiling |
| -------------------------------------------------- | -------------: | -------------: |
| Text/detail encoded and decoded bytes              |          1 MiB |          4 MiB |
| List/page encoded and decoded bytes                |          8 MiB |         16 MiB |
| Run encoded and decoded bytes, independently       |         64 MiB |        256 MiB |
| Complete logical request                           |           10 s |           60 s |
| DNS wait                                           |            3 s |            5 s |
| Candidate TCP + TLS setup                          |            5 s |           10 s |
| Body inactivity                                    |            5 s |           15 s |
| Provider run                                       |          600 s |        1,800 s |
| Jobs / pages                                       |     1,000 / 20 |     5,000 / 50 |
| HTTP attempts, including redirects/retries         |          3,500 |         18,000 |
| Retries after first attempt                        |              2 |              2 |
| Redirect follows across retries                    |              5 |             10 |
| DNS answer records                                 |             32 |             64 |
| Response headers / URL                             | 16 KiB / 8 KiB | 32 KiB / 8 KiB |
| Active logical operations / requests per origin    |          4 / 1 |          4 / 1 |
| Total queued waits / simultaneous candidate setups |         64 / 2 |         64 / 2 |

Only bounded 429/5xx responses and transport failures retry, with default 250 ms
exponential backoff. Policy, TLS identity, cancellation, deadline and resource-limit
failures are terminal. Retries consume the original deadline and run counters.
Origin serialization spans the complete body regardless of custom rate-limit key.
Redirects release the previous origin before acquiring another, retaining exactly
one global slot. Circuit availability state excludes policy failures and records
complete response outcomes. Rate-limit waits remain subject to request deadlines.

Every provider list/detail operation shares a run context. Direct helpers create
one if omitted. List pages and jobs are admitted before subsequent details or
snapshot writes. Repeated/non-progressing pagination fails explicitly. Metadata
posting/application URLs are stored without causing DNS queries.

Greenhouse preserves direct 304 handling. A 200 can update validators only after
bounded JSON parsing and job admission. Successful redirects clear old validators
and retain only fetchedAt; future requests use ordinary redirected fetching.
Workable retains same-origin Bearer authorization and removes it from snapshots.
SmartRecruiters detail refs must match the fixed HTTPS company/posting path and ID,
without userinfo, query, fragment or nondefault port. A validated ref may supply a
missing ID. An admitted provider HTTP response may still use safe redirects.

Listings propagate terminal ingestion errors while retaining ordinary malformed-job
skips. Snapshot persistence remains incremental: errors carry completed/saved
counts and retained jobIds through the local error channel. There is no rollback
or all-or-nothing claim. These caps are engineering bounds, not measurements of
provider payloads or guarantees of completing a board of a particular size.

## Synthetic qualification

The focused fixtures use reserved example hostnames, injected public address sets,
fake resolver/socket/stream primitives and fake clocks. They do not resolve names,
open sockets or bind listeners. A deny-by-default connector guard covers the new
transport suite. One case exercises the installed Node Agent using a Duplex
in-memory socket; it does not create a real network connection.

The tests cover URL/address admission, invalid/mixed DNS, pinned check/use, peer and
TLS identity, dual-stack fallback, redirect and credential matrices, validator
isolation, idle/absolute deadlines, byte/decoder bounds, genuine Response and null
bodies, cache failure, retries, cancellation races, bounded queues and reciprocal
redirects, provider payload shapes, exact detail refs, pagination/run limits,
terminal error propagation, incremental saves, offline mode and removal of provider
raw-fetch defaults. Existing server/browser regressions remain separate from these
network-free fixtures. No live provider or private-network qualification is implied.
