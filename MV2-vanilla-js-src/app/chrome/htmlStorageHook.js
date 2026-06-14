/**
 * htmlStorageHook.js — declared content script (runs automatically on all pages).
 *
 * Waits for a {action:"devtools_connect"} message from the background before
 * creating the port. This avoids spurious connections on pages that are never
 * inspected, and — critically — fixes the MV3 race condition where the old
 * executeScript callback fired before the service worker had processed the
 * hook's onConnect event, causing a ~30-second disconnect/reload loop.
 */
(function (chrome) {
    if (!chrome.runtime) { return; }

    // ── Web-storage wrapper ───────────────────────────────────────────────────

    function StorageArea(storage) { this.storage = storage; }

    function applyFunctorPerItem(items, functor) {
        if (typeof items === 'string') {
            functor(items);
        } else if (typeof items === 'object') {
            if (Object.prototype.toString.call(items) === '[object Array]') {
                items.forEach(function (val) { functor(val); });
            } else {
                for (var key in items) {
                    if (items.hasOwnProperty(key)) { functor(key, items[key]); }
                }
            }
        }
    }

    StorageArea.prototype.get = function (items, callback) {
        if (typeof items === 'function') { callback = items; items = null; }
        var returnItems = {}, storage = this.storage;
        if (items === null || items === undefined) {
            for (var i = 0; i < storage.length; i++) {
                var k = storage.key(i);
                returnItems[k] = storage.getItem(k);
            }
        } else {
            applyFunctorPerItem(items, function (key, def) {
                var v = storage.getItem(key);
                returnItems[key] = (v === null && def !== undefined) ? def : v;
            });
        }
        callback && callback(returnItems);
    };
    StorageArea.prototype.set = function (items, callback) {
        if (typeof items === 'function') { callback = items; items = null; }
        var storage = this.storage;
        applyFunctorPerItem(items, function (key, value) { storage.setItem(key, value); });
        callback && callback();
    };
    StorageArea.prototype.remove = function (items, callback) {
        if (typeof items === 'function') { callback = items; items = null; }
        var storage = this.storage;
        applyFunctorPerItem(items, function (key) { storage.removeItem(key); });
        callback && callback();
    };
    StorageArea.prototype.clear = function (callback) {
        this.storage.clear();
        callback && callback();
    };
    StorageArea.prototype.getBytesInUse = function (items, callback) {
        if (typeof items === 'function') { callback = items; }
        callback && callback(0);
    };

    var storages = {};
    // Safely attempt to hook web storage; ignores sandboxed environments
    try {
        if (window.localStorage) {
            storages.localStorage = new StorageArea(window.localStorage);
        }
    } catch (e) {}

    try {
        if (window.sessionStorage) {
            storages.sessionStorage = new StorageArea(window.sessionStorage);
        }
    } catch (e) {}

    // ── Message handler (storage API calls from the panel) ────────────────────

    function handleMessage(message, storage) {
        var method = storage[message.method];
        var args = (message.args || []).slice();
        args.push(function () {
            message.results = Array.prototype.slice.call(arguments);
            port.postMessage(message);
        });
        message.meta = {};
        Object.keys(storage).forEach(function (key) {
            if (typeof storage[key] !== 'function') { message.meta[key] = storage[key]; }
        });
        method.apply(storage, args);
    }

    // ── Connect to background (called only when DevTools signals us) ──────────

    var port = null;

    function connect() {
        if (port) { return; }   // already connected for this DevTools session

        port = chrome.runtime.connect({name: "inspected_tab_"});

        // Iframe trick: lets us observe cross-tab web-storage change events
        var frame = document.createElement("iframe");
        frame.style.display = "none";
        document.documentElement.appendChild(frame);

        frame.contentWindow.addEventListener("storage", function (event) {
            var type = "";
            if (event.storageArea === event.currentTarget.localStorage)       type = "localStorage";
            else if (event.storageArea === event.currentTarget.sessionStorage) type = "sessionStorage";
            else return;
            var changes = event.key ? {} : "clear";
            if (event.key) { changes[event.key] = {newValue: event.newValue}; }
            port.postMessage({change: true, type: type, changes: changes});
        });

        port.onDisconnect.addListener(function () {
            port = null;
            try { document.documentElement.removeChild(frame); } catch (e) {}
        });

        port.onMessage.addListener(function (message) {
            if (!message.type || !storages[message.type]) { return; }
            handleMessage(message, storages[message.type]);
        });
    }

    // ── Wait for the background's signal ─────────────────────────────────────
    //
    // The background sends {action:"devtools_connect"} via chrome.tabs.sendMessage
    // when the DevTools panel opens for this tab. This is orders of magnitude
    // faster than the previous on-demand executeScript injection.

    chrome.runtime.onMessage.addListener(function (message) {
        if (message && message.action === "devtools_connect") {
            connect();
        }
    });

})(chrome);
