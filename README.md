# Storage Area Explorer

A Chrome Developer Tools extension designed to inspect and manage extension and web storage.

## Features

* Inspect the [Storage Area](http://developer.chrome.com/apps/storage.html) of Chrome Extensions and Packaged Apps.
* Inspect HTML5 `localStorage` and `sessionStorage`.
* Export/Import storage contents as JSON directly to your clipboard or a file.

---

## Fork History & Updates

This is a customized fork. The original project was created by [jusio](https://github.com/jusio/storage-area-explorer), which was later forked by [tamir-nakar](https://github.com/tamir-nakar/storage-area-explorer) to add Manifest V3 (MV3) support. 

**Key changes in this version:**
* Added support for **`chrome.storage.session`** (resolving [issue #45](https://github.com/jusio/storage-area-explorer/issues/45)).
* Completely redesigned the UI using vanilla JavaScript and CSS (removing the Angular dependency).
* **Downgraded to Manifest V2 (MV2).**

---

## Why Downgrade to MV2?

The MV3 version suffers from a severe performance and lifecycle bug. Opening a second instance of the DevTools panel takes an excessive amount of time, and occasionally, the tab fails to appear entirely. 

This bug triggers consistently when these three conditions are met simultaneously:
1. The DevTools panel is open somewhere else (e.g., on a standard web page like Wikipedia, or on another extension's popup). *Note: Opening DevTools specifically on a service worker does not trigger this.*
2. The **Update on reload** option is checked under `DevTools > Application > Service Workers`.
3. An offscreen document is running, or a long-lived native messaging port (e.g., `chrome.runtime.connectNative`) is held open.

---

## Compatibility & Target Audience

This version is **not** intended for the latest Chrome releases, as modern Chrome versions now include a built-in extension storage explorer. 

Instead, this tool is specifically maintained for developers operating on older, stable environments. If you are continuing to develop on **Windows 7** using older browsers like **Chrome v109** (to avoid the telemetry and forced updates of Windows 10+), this MV2 extension is built to work flawlessly for your setup.

---

## Available Versions & Branches

Depending on your framework preferences and target Chrome version, you can find different variations of this extension in the following branches, but they are unmaintained (I only added to them **`chrome.storage.session`**):

* **`MV3-vanilla-js`**: Manifest V3 version using Vanilla JavaScript.
* **`MV3-angular`**: Manifest V3 version using Angular.
* **`MV2-angular`**: The original Manifest V2 version using Angular.

---

## Screenshot

![General view](screenshots/general-view.jpg)