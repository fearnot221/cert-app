# Bundled Noto Sans TC font

Additional bundled fonts: cwTeX Q KaiZH Medium and cwTeX Q FangsongZH Medium, pinned to upstream v0.42. See `cwTeX-SOURCE.txt` and `cwTeX-OFL.txt`; these Chinese-only fonts use the existing Noto font for ASCII. The Kai font is an alternative Kai style, not Microsoft DFKai-SB. See `docs/FONT_LICENSING.md` for provenance and the upstream copyright-history notice.

The unmodified variable TTF is bundled so the editor and server use identical bytes. It supports Latin and Traditional Chinese. The template schema currently exposes verified weights 400 and 700; it does not advertise a Canva font connection or user font uploads.

- Source: Google Fonts' official `google/fonts` repository, `ofl/notosanstc/NotoSansTC[wght].ttf`.
- Font project provenance in upstream metadata: https://github.com/notofonts/noto-cjk/tree/523d033d6cb47f4a80c58a35753646f5c3608a78
- Download URL: https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf
- Retrieved: 2026-10-15.
- SHA-256: `864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f`.
- License: SIL Open Font License 1.1, preserved in `OFL.txt` with original copyright statement. The license permits bundling and embedding; retain the license and copyright when redistributing.
- Upstream metadata is preserved in `METADATA.upstream.pb`; the hash, rather than the mutable download URL, identifies the version used in this release.

Do not replace this file in place. A font change requires a new immutable asset version, an updated hash and renderer version, and renewed layout/visual tests. The renderer verifies the hash and rejects missing glyphs before starting Chromium.

Official references reviewed on 2026-10-15:

- https://developers.google.com/fonts
- https://github.com/google/fonts/tree/main/ofl/notosanstc
- https://playwright.dev/docs/api/class-page#page-pdf

The PDF is selectable HTML text rendered by pinned Playwright Chromium. Font and background bytes are embedded as data URLs. CSP and request interception block network and file loading. The application must enforce tenant authorization before loading asset bytes and cap PDF job concurrency. Deployment-level process/memory/network isolation remains the operator's responsibility.
