# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

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
