This development component includes modified algorithms from:

- Puppeteer 25.4.0, `ExtensionTransport.js`, copyright Google Inc., Apache-2.0.
  <https://github.com/puppeteer/puppeteer>
- Nanobrowser, `src/browser-control/core/geometry.ts`, Apache-2.0.
  <https://github.com/nanobrowser/nanobrowser>

`PROVENANCE.json` records the inspected source hashes and changed responsibilities.
`LICENSE.Apache-2.0` preserves the applicable license. The transport adapts the
browser/tab roots to Electron; geometry uses Puppeteer's live frame ancestry.
This is a limited control spike, not the complete Nanobrowser browser-control layer.
Original checkouts remain unchanged.

Electron/Chromium and all packaged dependencies need their release-specific
license notices before distribution. Memory Node redistribution rights remain
unconfirmed. These files do not establish distribution clearance.
