# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [2.1.0](https://github.com/Owaisshaikh11/DNS-Observatory/compare/v2.0.0...v2.1.0) (2026-06-29)

### Features
* **resolver cache:** hide cache flush and eviction buttons in production ([b07f19c](https://github.com/Owaisshaikh11/DNS-Observatory/commit/b07f19ccad57150f63c01475ce25750f1ff9aeb6))
* **visualizer:** improve resolution graph layout and parallel query paths for batched query ([9d3eaa9](https://github.com/Owaisshaikh11/DNS-Observatory/commit/9d3eaa925d9f2aeacdf91e3b82551f6e4168ccf7))
  - Implement a 5-parallel-line rendering logic for batch authoritative hops with staggered animated flow dots.
  - Expand segment spacing dimensions (`segWidth` to 1400px) to prevent card overlaps between CNAME redirects and Stub Resolvers.
### Bug Fixes
* **ui:** fix hop numbering and toast styles, add icons for resolvers(google,cloudflare) ([b23f66a](https://github.com/Owaisshaikh11/DNS-Observatory/commit/b23f66a8da6dcb1797a3f4bd5090dd872cf4d731))
  - Standardize sidebar waterfall badges to show sequential 1-based index numbers.
  - Redesign Cache Ready pop-up using translucent card styles, backdrop blur, and custom drop shadows.
  - Rename the "ALL" record type selection to "BATCH ALL" styled in bold gray.
  - Render official brand SVG logos (Cloudflare and Google) next to recursive resolver nodes.
  - Dynamically offset text query labels based on line counts to prevent text rendering below lines.
### Refactoring & Improvements
* **visualizer:** overhaul graph layout, arrow routing, and legends ([a7a5a97](https://github.com/Owaisshaikh11/DNS-Observatory/commit/a7a5a976f920257bb57e844a0349479b4a4cb886))
  - Re-route query and response coordinate lines to prevent overlapping path issues.
  - Standardize authoritative card layouts to display clear zones and nameserver hostnames.

## [2.0.0](https://github.com/Owaisshaikh11/DNS-Observatory/compare/v1.0.1...v2.0.0) (2026-06-28)


### ⚠ BREAKING CHANGES
* Deactivated the local custom DNS server on port 5354, removed the `/api/dns/inject` endpoint, and deleted local static zone records.
### Features
* **resolver:** Implement virtual caching engine and cache drawer UI.
  - Remove the 3-second UDP socket loopback lookup on port 5354 from `dns-iterative.js`.
  - Repurpose the local resolution step as a `Recursive Resolver` hop pointing to the selected public resolver.
  - Create an in-memory `DnsCache` module with normalized key matching, TTL-based eviction, and negative caching for NXDOMAIN errors.
  - Integrate cache check, hit, and save flows into the Express `/api/dns/trace` route, returning a mock 2-hop trace on cache hits.
  - Add cache management API routes (`GET /api/dns/cache`, `DELETE /api/dns/cache`, `POST /api/dns/cache/clear`).
  - Add `bypassCache` state and update `startTrace` payload in the Zustand store.
  - Create sliding `CacheDrawer` component featuring a cache mode toggle, ticking timers, shrinking progress bars, and record evictions.
  - Add RESOLVER CACHE header button, a pulsing Coach-Mark tooltip, and custom cache-hit log lines in `VisualizerPage.jsx`.
  - Adapt `CompactTree.jsx` to render green edges and center 2-hop graphs at a scale of 1.0 on cache hits.
* **ui:** Persist caching settings and polish cache drawer layout.
  - Persist the `bypassCache` user setting in `localStorage` under `dns_bypass_cache` to resolve cache-checking bypass on refresh.
  - Adjust the `RESOLVER CACHE` top-bar button closed style to have light margins (`border-ink/20`) consistent with other header buttons.
  - Convert the full-height cache panel to an inset floating card layout with 12px margins on all sides (`top-[52px] bottom-3 right-3`).
  - Add a slidable segmented toggle switch ("Bypass Cache" / "Active Cache").
  - Add an inline search input box to dynamically filter cached DNS records by domain name or record type.
  - Add individual collapsible record card states with chevrons, smooth height transitions, and bulk `[+] EXPAND ALL` / `[-] COLLAPSE ALL` controls.
  - Replace the empty state icon with a database icon and a status badge.
### Bug Fixes
* **resolver:** Resolve recursive payload inspector issues and correct response flags.
  - Generate authentic DNS query/response packets for the LOCAL recursive resolver hop on cache misses and cache hits, fixing the "Packet payload missing" error.
  - Remove hardcoded authoritative answer flag (AA) from the recursive resolver's response in dns-parser.js to ensure compliant headers (0x8180).
  - Prevent the recursive resolver node from showing final answers and timing details early in Resolution Lab playback by introducing `isCompleted` prop logic.
  - Implement dynamic cache TTL decay and a 500-entry LRU cache eviction limit.

* Refactor DNS server, implement caching engine, and enhance UI (#3) ([d80c538](https://github.com/Owaisshaikh11/DNS-Observatory/commit/d80c538dad1a182b6ccc64005c44c18b0e9cb40c)), closes [#3](https://github.com/Owaisshaikh11/DNS-Observatory/issues/3)

## [1.0.1](https://github.com/Owaisshaikh11/DNS-Observatory/compare/v1.0.0...v1.0.1) (2026-06-24)


### Bug Fixes

* **devops): fix(devops:** configure standard Vercel SPA routing and wildcard fallbacks ([fe1fd29](https://github.com/Owaisshaikh11/DNS-Observatory/commit/fe1fd294f7aa23f5d1e8df30c53643917a6da6a8))
* **devops:** route unmatched paths to index.html for SPA router fallback ([1773f94](https://github.com/Owaisshaikh11/DNS-Observatory/commit/1773f94e8c418aa353b7f1193bcbcbbb82013180))
* **devops:** use standard wildcard syntax for SPA rewrite fallback ([2dbf078](https://github.com/Owaisshaikh11/DNS-Observatory/commit/2dbf078295244eeffc1b628ece580c1f3e77ad76))
* **frontend:** resolve packet viewer tab and batch selector flickering ([2b94a82](https://github.com/Owaisshaikh11/DNS-Observatory/commit/2b94a829c3fc078b9e02ec218bad37651822e092))

## 1.0.0 (2026-06-24)


### Features

* **backend:** implement express server rate limiting, validation, and error screen ([957736b](https://github.com/Owaisshaikh11/DNS-Observatory/commit/957736b1642f29890b7f687c98d617bd08db1f90))
* **backend:** implement local GeoIP city lookup, DNS reflection protection, and port binding fallbacks ([6d3e281](https://github.com/Owaisshaikh11/DNS-Observatory/commit/6d3e2812dc07877ca67effc9c467e2cd09fb7ae2))
* **dns:** implement PTR/SRV parsing and EDNS0 OPT support ([4759c3a](https://github.com/Owaisshaikh11/DNS-Observatory/commit/4759c3a030680c44caf7b2d1246373f32a4017b2))
* **frontend:** add Landing (EntryPage), refine design system. ([6c557fd](https://github.com/Owaisshaikh11/DNS-Observatory/commit/6c557fd08e62fd68edb2b8e7c80139f435fb5de3))
* **frontend:** Add UI foundation and bruno API collection ([3c28d69](https://github.com/Owaisshaikh11/DNS-Observatory/commit/3c28d69bdca1d6af2f2e4fee8a4499628f6ab083))
* **frontend:** implement query history, keyboard controls, and copy helpers. ([219416a](https://github.com/Owaisshaikh11/DNS-Observatory/commit/219416abb16dbc0503ea89837630b23357635c01))
* **Frontend:** implement updated interactive footer, 404 error page, and local grid refactoring ([569e772](https://github.com/Owaisshaikh11/DNS-Observatory/commit/569e772ea24b0930a8863a1096a8c35a14af8295))
* **logging:** integrate pino for structured logging across the project ([16bfbad](https://github.com/Owaisshaikh11/DNS-Observatory/commit/16bfbad918c3536eabfda1dac95173922dd2a499))
* **Packet Viewer:** implement PCAP exporter and tweak Packet Viewer UI ([4cf03d6](https://github.com/Owaisshaikh11/DNS-Observatory/commit/4cf03d601c1b6eb4cfa9b938e73999637ecd32a5))
* **pcap exporter:** implement client-side TCP session synthesis ([3ae94b7](https://github.com/Owaisshaikh11/DNS-Observatory/commit/3ae94b71d58e30ff1df8b5bd27e7a90762a100b7))
* **resolver:** integrate homepage resolver selection with iterative trace loop ([4895cd8](https://github.com/Owaisshaikh11/DNS-Observatory/commit/4895cd8dd80a97ba3c6b506f89cfb1990676aac2))
* **Visualizer:** Add visualizer panel controls,loges for iterative trace ,canvas controls and fix minor protocol bugs ([7beecbc](https://github.com/Owaisshaikh11/DNS-Observatory/commit/7beecbcaf10ce5b9436d9f3e49a9dd86a922a177))
* **visualizer:** implement resolution lab visualizer and EDNS0/DNSSEC formatting ([b065cde](https://github.com/Owaisshaikh11/DNS-Observatory/commit/b065cde8b2030290b0876df12b927a3a81d88ab5))
* **VisualizerPage:** add floating lab notes overlay ([28f0194](https://github.com/Owaisshaikh11/DNS-Observatory/commit/28f0194b2470fa64d3a997d81f03719b7d40dbe3))


### Bug Fixes

* **docs:** correct typo in API server description and update geoip directory in .gitignore ([004a1a4](https://github.com/Owaisshaikh11/DNS-Observatory/commit/004a1a4151fbe50837871e8ee21fb0d044db6bc8))
* **ui/footer:** resolve chromium scroll rendering bugs on footer text ([001c2de](https://github.com/Owaisshaikh11/DNS-Observatory/commit/001c2de671896d69fe8fa86944671b18400f3312))
