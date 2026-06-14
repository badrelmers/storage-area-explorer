/**
 * Storage Area Explorer — vanilla JS panel
 * No Angular, no jQuery, no Bootstrap.
 */
(function () {
    'use strict';

    // ─── Utilities ────────────────────────────────────────────────────────────

    function guid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    function prettyJson(obj) {
        return JSON.stringify(obj, null, '\t');
    }

    function prettyBytes(input) {
        var kbSize = 1024, mbSize = 1024 * 1024;
        if (input < kbSize / 10) {
            return input === 1 ? '1byte' : input + 'bytes';
        }
        if (input < mbSize) {
            return +(input / kbSize).toFixed(2) + 'kb';
        }
        return +(input / mbSize).toFixed(2) + 'mb';
    }

    function el(id) { return document.getElementById(id); }
    function show(e) { (typeof e === 'string' ? el(e) : e).classList.remove('hidden'); }
    function hide(e) { (typeof e === 'string' ? el(e) : e).classList.add('hidden'); }

    // ─── App state ────────────────────────────────────────────────────────────

    var state = {
        mode: 'list',
        currentType: null,
        currentDescriptor: null,
        storageDescriptors: [],
        stats: {},
        meta: {},
        rawData: {},
        results: []
    };

    var _editOriginalKey = null;  // tracks the key name before a rename

    var descriptors = {
        'local':         { name: 'local',         title: 'chrome.storage.local' },
        'sync':          { name: 'sync',           title: 'chrome.storage.sync' },
        'session':       { name: 'session',        title: 'chrome.storage.session' },
        'managed':       { name: 'managed',        title: 'chrome.storage.managed',    readonly: true },
        'localStorage':  { name: 'localStorage',   title: 'window.localStorage',       stringOnly: true },
        'sessionStorage':{ name: 'sessionStorage',  title: 'window.sessionStorage',    stringOnly: true }
    };

    // ─── Port / connection layer ───────────────────────────────────────────────

    var connectionResolve;
    var connectionPromise = new Promise(function (res) { connectionResolve = res; });
    var pendingCallbacks = {};  // id → callback
    var metaResolvers = {};     // type → { promise, resolve, resolved }

    // ─── Extension page bridge (inlined — eval'd into the inspected page) ─────
    //
    // This function is stringified and eval'd via chrome.devtools.inspectedWindow.eval()
    // in the context of the inspected extension page. It must be entirely self-contained:
    // no closures over panel.js variables. The Storage Explorer extension ID is passed
    // as the `connectToExtId` parameter at eval time.
    //
    function _extensionBridgeFn(chrome, connectToExtId) {
        var port = chrome.runtime.connect(connectToExtId);
        var storages = {};

        // ── chrome.storage areas ──────────────────────────────────────────────
        try {
            if (chrome.storage) {
                var storageListener = function (changes, name) {
                    port.postMessage({ change: true, changes: changes, type: name });
                };
                chrome.storage.onChanged.addListener(storageListener);
                port.onDisconnect.addListener(function () {
                    chrome.storage.onChanged.removeListener(storageListener);
                });
                storages['sync']    = chrome.storage.sync;
                storages['local']   = chrome.storage.local;
                storages['managed'] = chrome.storage.managed;
                if (chrome.storage.session) {
                    storages['session'] = chrome.storage.session;
                }
            }
        } catch (e) {}

        // ── web storage wrappers ──────────────────────────────────────────────
        try {
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
                var returnItems = {};
                var storage = this.storage;
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

            storages['localStorage']  = new StorageArea(window.localStorage);
            storages['sessionStorage'] = new StorageArea(window.sessionStorage);

            // Use an invisible iframe to observe cross-tab web storage events
            var frame = document.createElement('iframe');
            frame.style.display = 'none';
            document.documentElement.appendChild(frame);
            frame.contentWindow.addEventListener('storage', function (event) {
                var type = '';
                if (event.storageArea === event.currentTarget.localStorage)       type = 'localStorage';
                else if (event.storageArea === event.currentTarget.sessionStorage) type = 'sessionStorage';
                else return;
                var changes = event.key ? {} : 'clear';
                if (event.key) changes[event.key] = { newValue: event.newValue };
                port.postMessage({ change: true, type: type, changes: changes });
            });
            port.onDisconnect.addListener(function () {
                document.documentElement.removeChild(frame);
            });
        } catch (e) {}

        // ── message handler ───────────────────────────────────────────────────
        port.onMessage.addListener(function (message) {
            // Only handle messages addressed to this extension
            if (message.target !== chrome.runtime.id || !message.type) { return; }
            var storage = storages[message.type];
            if (!storage) { return; }
            var method = storage[message.method];
            if (!method) { return; }

            var args = (message.args || []).slice();
            args.push(function () {
                var results = Array.prototype.slice.call(arguments);
                message.results = results;
                port.postMessage(message);
            });

            // Attach storage-area metadata (QUOTA_BYTES etc.) to every response
            message.meta = {};
            Object.keys(storage).forEach(function (key) {
                if (typeof storage[key] !== 'function') { message.meta[key] = storage[key]; }
            });

            method.apply(storage, args);
        });
    }

    // ─── Inject the bridge into the inspected extension page ──────────────────

    function injectExtensionBridge(done) {
        // BUG FIXED (was): JSON.stringify(appInfo.id)
        //   - wrong ID: appInfo.id is the *inspected* extension; we need *our own* id
        //   - double-quoting: JSON.stringify wraps in quotes, but "APP_ID" already had quotes
        //     → resulted in  var from = ""id""  (syntax error, inject silently failed)
        //
        // FIX: pass our own chrome.runtime.id as a plain JSON string argument.
        var ourExtId = chrome.runtime.id;  // Storage Explorer extension id
        var code = '(' + _extensionBridgeFn.toString() + ')(chrome, ' + JSON.stringify(ourExtId) + ')';
        chrome.devtools.inspectedWindow.eval(code, function (result, isError) {
            if (isError) {
                console.error('[StorageExplorer] Extension bridge inject failed:', isError);
            }
            done();
        });
    }

    // ─── Port connection ───────────────────────────────────────────────────────

    function openPort(appInfo) {
        var remoteId;
        var connection = {};

        if (appInfo.id) {
            connection.appId = appInfo.id;
            remoteId = appInfo.id;
        }
        if (appInfo.tabId) {
            connection.tabId = appInfo.tabId;
        }
        if (!appInfo.id && appInfo.tabId) {
            remoteId = 'for_tab_' + appInfo.tabId;
        }
        if (appInfo.id && appInfo.tabId) {
            remoteId = appInfo.id + '_' + appInfo.tabId;
        }

        var port = chrome.runtime.connect({ name: remoteId });
        connection.port = port;

        port.onMessage.addListener(function (message) {
            if (message === 'portConnected') {
                if (appInfo.id) {
                    // Eval the bridge in the inspected extension page, THEN resolve.
                    // By the time the eval callback fires, chrome.runtime.connect() inside
                    // the bridge has already sent its IPC to the background, so the target
                    // port will be tracked before our first storage message arrives.
                    injectExtensionBridge(function () {
                        connectionResolve(connection);
                    });
                } else {
                    // Tab-only inspection: background already injected htmlStorageHook.js
                    connectionResolve(connection);
                }
                return;
            }

            if (!message.from || !message.obj) { return; }

            // BUG FIXED (was): === strict equality
            //   background splits port name by "_" and stores tab as a STRING,
            //   but appInfo.tabId from chrome.devtools.inspectedWindow.tabId is a NUMBER
            //   → strict === always false for extension pages → storage changes silently dropped
            //
            // FIX: use == (loose equality) to match original Angular code behaviour.
            if (message.from.app == appInfo.id &&       // eslint-disable-line eqeqeq
                message.from.tab == appInfo.tabId &&     // eslint-disable-line eqeqeq
                message.obj.change) {
                handleStorageChanged(message.obj);
                return;
            }

            // Storage method callback response
            var obj = message.obj;
            if (!obj.id) { return; }

            // Resolve metadata promise on first response per type
            if (obj.meta && obj.type) {
                var mr = metaResolvers[obj.type];
                if (mr && !mr.resolved) {
                    mr.resolved = true;
                    mr.resolve(obj.meta);
                }
            }

            var cb = pendingCallbacks[obj.id];
            if (cb) {
                delete pendingCallbacks[obj.id];
                try { cb.apply(null, obj.results || []); } catch (e) {}
            }
        });

        port.onDisconnect.addListener(function () {
            window.location.reload();
        });
    }

    // ─── App context (what extension/page are we inspecting?) ─────────────────

    function getAppContext() {
        // The eval code — kept minimal so serialisation is fast.
        var evalCode = '(' + (function (chrome) {
            var types = [];
            var id, manifest;
            try {
                var loc = document.location;
                if (loc == null || (loc.protocol !== 'https:' && loc.protocol !== 'http:')) {
                    id = chrome.runtime.id;
                    manifest = chrome.runtime.getManifest();
                    var perms = (manifest.permissions || []).concat(manifest.optional_permissions || []);
                    if (perms.indexOf('storage') > -1) {
                        types.push('local', 'sync', 'managed');
                        try { if (chrome.storage.session) { types.push('session'); } } catch (e) {}
                    }
                }
            } catch (e) {}
            try { if (window.localStorage)   { types.push('localStorage');   } } catch (e) {}
            try { if (window.sessionStorage) { types.push('sessionStorage'); } } catch (e) {}
            // Return only what we need — keep the serialised payload small.
            return { id: id, types: types, name: manifest ? manifest.name : undefined };
        }).toString() + ')(chrome)';

        // Retry wrapper — inspectedWindow.eval is called immediately when the panel
        // loads (~5ms), but Chrome's DevTools debugger attachment to the inspected
        // page can take much longer on a fresh window.  If eval does not respond
        // within TIMEOUT_MS we fire another attempt so the panel does not hang.
        // Multiple in-flight evals are harmless: we honour only the first response
        // that succeeds (tracked via the `resolved` flag).
        var TIMEOUT_MS = 2000;
        var MAX_ATTEMPTS = 10;

        return new Promise(function (resolve, reject) {
            var resolved = false;
            var attempt = 0;

            function tryEval() {
                if (resolved) { return; }
                attempt++;

                var stale = false;
                var timer = setTimeout(function () {
                    stale = true;
                    if (resolved) { return; }
                    if (attempt < MAX_ATTEMPTS) {
                        tryEval();
                    } else {
                        reject(new Error('inspectedWindow.eval timed out after ' + MAX_ATTEMPTS + ' attempts'));
                    }
                }, TIMEOUT_MS);


                chrome.devtools.inspectedWindow.eval(evalCode, function (value, isError) {
                    clearTimeout(timer);
                    if (resolved || stale) { return; }   // already succeeded or superseded

                    if (isError) {
                        // If Chrome explicitly denies permission, stop retrying immediately
                        var isPermissionDenied = isError.details && isError.details.indexOf('Permission denied') > -1;
                        
                        if (attempt < MAX_ATTEMPTS && !isPermissionDenied) {
                            setTimeout(tryEval, 150);
                        } else {
                            reject(isError);
                        }
                        return;
                    }

                    resolved = true;
                    resolve({
                        id:           value.id,
                        name:         value.name,
                        tabId:        chrome.devtools.inspectedWindow.tabId,
                        storageTypes: value.types || []
                    });
                });
            }

            tryEval();
        });
    }

    // ─── Delegate storage calls ───────────────────────────────────────────────

    function callStorage(type, method, args, callback) {
        connectionPromise.then(function (connection) {
            var message = { type: type, method: method, args: args || [], target: connection.appId };
            if (callback) {
                message.id = guid();
                pendingCallbacks[message.id] = callback;
            }
            connection.port.postMessage(message);
        });
    }

    function storageGet(type, callback)               { callStorage(type, 'get',    [],    callback); }
    function storageSet(type, obj, callback)          { callStorage(type, 'set',    [obj], callback); }
    function storageRemove(type, key, callback)       { callStorage(type, 'remove', [key], callback); }
    function storageClear(type, callback)             { callStorage(type, 'clear',  [],    callback); }

    function storageGetBytesInUse(type, key, callback) {
        if (typeof key === 'function') { callback = key; key = undefined; }
        callStorage(type, 'getBytesInUse', key !== undefined ? [key] : [], callback);
    }

    function storageGetMeta(type) {
        if (!metaResolvers[type]) {
            var res;
            var p = new Promise(function (r) { res = r; });
            metaResolvers[type] = { promise: p, resolve: res, resolved: false };
        }
        return metaResolvers[type].promise;
    }

    // ─── UI setup ─────────────────────────────────────────────────────────────

    function setupTabs(appInfo) {
        state.storageDescriptors = appInfo.storageTypes.map(function (t) {
            return descriptors[t] || { name: t, title: t };
        });

        if (state.storageDescriptors.length === 0) {
            show('error-view');
            return;
        }

        show('main-view');

        state.storageDescriptors.forEach(function (desc) {
            state.stats[desc.name] = { bytesInUse: 0, count: 0 };
            if (['sync', 'local', 'session'].indexOf(desc.name) > -1) {
                storageGetMeta(desc.name).then(function (meta) {
                    state.meta[desc.name] = meta;
                    renderTabs();
                });
            }
        });

        renderTabs();
        setCurrentType(state.storageDescriptors[0]);
        bindEvents();
        // Load counts and byte usage for every tab up-front so the tab headers
        // show accurate info immediately. All calls are queued via connectionPromise
        // and fire once the port is established — no UI blocking.
        // (This was removed when we were on MV3 to avoid flooding the service-worker
        // port on startup; MV2 event pages don't have that cold-start problem.)
        refreshAllTabCounts();
    }

    // Fetch count + bytesInUse for every storage area so all tab headers are
    // populated immediately without the user having to click each tab.
    function refreshAllTabCounts() {
        state.storageDescriptors.forEach(function (desc) {
            storageGet(desc.name, function (obj) {
                state.stats[desc.name].count = Object.keys(obj || {}).length;

                if (!desc.stringOnly && !desc.readonly) {
                    storageGetBytesInUse(desc.name, function (bytes) {
                        // chrome.storage.session may return 0 even with data —
                        // estimateBytes() fallback (already used per-item in
                        // refreshStats) keeps the tab header consistent.
                        //
                        // NOTE: chrome.storage.local and chrome.storage.session report
                        // different byte counts for the same data because they use
                        // different internal serializations:
                        //   local   → LevelDB + compact JSON text (UTF-8)
                        //   session → in-memory V8 structured-clone wire format
                        // The structured-clone format stores per-value type tags and
                        // can use wider string encodings, so the session count is
                        // typically ~2× the JSON-equivalent size.  Both numbers are
                        // accurate for their respective backends.
                        if (bytes === 0 && state.stats[desc.name].count > 0) {
                            var items = obj || {};
                            bytes = Object.keys(items).reduce(function (sum, k) {
                                return sum + estimateBytes(k, items[k]);
                            }, 0);
                        }
                        state.stats[desc.name].bytesInUse = bytes;
                        renderTabs();
                        updateToolbar();
                    });
                } else if (desc.stringOnly) {
                    // window.localStorage / window.sessionStorage: values are always
                    // plain strings — do NOT pass through JSON.stringify (which would
                    // add wrapping quotes and inflate the count).
                    var enc = new TextEncoder();
                    var items = obj || {};
                    var bytes = Object.keys(items).reduce(function (sum, k) {
                        return sum + enc.encode(k + (items[k] != null ? items[k] : '')).length;
                    }, 0);
                    state.stats[desc.name].bytesInUse = bytes;
                    renderTabs();
                    updateToolbar();
                } else {
                    // readonly (e.g. managed): skip byte counting
                    renderTabs();
                    updateToolbar();
                }
            });
        });
    }

    function renderTabs() {
        var list = el('tab-list');
        list.innerHTML = '';
        state.storageDescriptors.forEach(function (desc) {
            var stats = state.stats[desc.name] || {};
            if (desc.readonly && stats.count === 0) { return; }

            var li = document.createElement('li');
            li.dataset.type = desc.name;
            if (state.currentType === desc.name) { li.classList.add('active'); }

            var a = document.createElement('a');
            a.href = '#';

            var titleSpan = document.createElement('span');
            titleSpan.textContent = desc.title;
            a.appendChild(titleSpan);

            var usageDiv = document.createElement('div');
            usageDiv.className = 'usage';

            if (!desc.stringOnly && !desc.readonly) {
                var bytesInUse = stats.bytesInUse || 0;
                var count = stats.count || 0;
                var meta = state.meta[desc.name];
                if (bytesInUse > 0) {
                    var usageText = prettyBytes(bytesInUse);
                    if (meta && meta.QUOTA_BYTES) {
                        usageText += ' / ' + prettyBytes(meta.QUOTA_BYTES);
                    }
                    if (desc.name === 'sync' && meta && meta.MAX_ITEMS) {
                        usageText += ', ' + count + ' / ' + meta.MAX_ITEMS + ' items';
                    }
                    usageDiv.textContent = usageText;
                } else if (count > 0) {
                    // chrome.storage.session may return 0 from getBytesInUse even when
                    // items exist — fall back to showing item count so the tab isn't
                    // misleadingly labelled "area is empty"
                    usageDiv.textContent = count + ' item' + (count === 1 ? '' : 's');
                } else {
                    usageDiv.textContent = 'area is empty';
                }
            } else if (desc.stringOnly) {
                // window.localStorage / window.sessionStorage: show estimated byte size
                // (computed from raw string lengths, not JSON-serialised lengths).
                var cnt = stats.count || 0;
                var bytesInUse = stats.bytesInUse || 0;
                if (bytesInUse > 0) {
                    usageDiv.textContent = prettyBytes(bytesInUse) + ', ' + cnt + ' item' + (cnt !== 1 ? 's' : '');
                } else if (cnt > 0) {
                    usageDiv.textContent = cnt + ' item' + (cnt !== 1 ? 's' : '');
                } else {
                    usageDiv.textContent = 'area is empty';
                }
            } else {
                // readonly (e.g. managed): show item count only
                var cnt = stats.count || 0;
                usageDiv.textContent = cnt > 0 ? cnt + ' items' : 'area is empty';
            }

            a.appendChild(usageDiv);
            li.appendChild(a);
            li.addEventListener('click', function (e) {
                e.preventDefault();
                setCurrentType(desc);
            });
            list.appendChild(li);
        });
    }

    function setCurrentType(desc) {
        state.currentType = desc.name;
        state.currentDescriptor = desc;
        setMode('list');
        renderTabs();
        loadCurrentStorage();
        updateToolbar();
    }

    function setMode(mode) {
        state.mode = mode;
        hide('list-view');
        hide('edit-view');
        if (mode === 'list') {
            show('list-view');
        } else {
            show('edit-view');
            var desc = state.currentDescriptor;
            if (desc && !desc.stringOnly) {
                el('edit-hint').textContent = 'Value must be valid JSON — strings need double quotes: "example"';
                show('edit-hint');
            } else {
                el('edit-hint').textContent = '';
                hide('edit-hint');
            }
        }
    }

    function updateToolbar() {
        var desc = state.currentDescriptor;
        if (!desc) { return; }
        var count = (state.stats[desc.name] || {}).count || 0;

        if (desc.readonly) {
            hide('btn-add'); hide('btn-clear'); hide('import-dropdown');
        } else {
            show('btn-add');
            count > 0 ? show('btn-clear') : hide('btn-clear');
            show('import-dropdown');
        }
        count > 0 ? show('export-dropdown') : hide('export-dropdown');
    }

    // ─── Load & render storage data ───────────────────────────────────────────

    function loadCurrentStorage() {
        storageGet(state.currentType, function (results) {
            state.rawData = results || {};
            adaptRawData();
        });
    }

    function adaptRawData() {
        var raw = state.rawData;
        var keys = Object.keys(raw);

        // Remove stale entries
        state.results = state.results.filter(function (r) { return keys.indexOf(r.name) > -1; });

        // Update existing, add new
        keys.forEach(function (k) {
            var val = deepCopy(raw[k]);
            var found = null;
            for (var i = 0; i < state.results.length; i++) {
                if (state.results[i].name === k) { found = state.results[i]; break; }
            }
            if (found) {
                found.value = val;
            } else {
                state.results.push({ name: k, value: val });
            }
        });

        state.results.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });

        renderTable();
        refreshStats();
    }

    function deepCopy(v) {
        try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
    }

    function estimateBytes(key, value) {
        // Fallback byte estimate via UTF-8 encoding of the serialized key+value.
        // Used when chrome.storage.session.getBytesInUse() returns 0 despite having data.
        try {
            return new TextEncoder().encode(key + JSON.stringify(value)).length;
        } catch (e) { return 0; }
    }

    function refreshStats() {
        var desc = state.currentDescriptor;
        if (!desc) { return; }
        var type = desc.name;
        state.stats[type].count = state.results.length;

        if (!desc.stringOnly) {
            storageGetBytesInUse(type, function (bytes) {
                // If total comes back as 0 but we have items, sum up per-item estimates
                // so the tab header isn't misleadingly blank for chrome.storage.session
                if (bytes === 0 && state.results.length > 0) {
                    bytes = state.results.reduce(function (sum, r) {
                        return sum + estimateBytes(r.name, r.value);
                    }, 0);
                }
                state.stats[type].bytesInUse = bytes;
                renderTabs();
                updateToolbar();
            });
            state.results.slice(0, 40).forEach(function (result) {
                storageGetBytesInUse(type, result.name, function (amount) {
                    // chrome.storage.session returns 0 per-key even when data exists;
                    // fall back to JSON estimate for any non-null/non-empty value
                    if (amount === 0 && result.value !== undefined && result.value !== null && result.value !== '') {
                        amount = estimateBytes(result.name, result.value);
                    }
                    result.bytesInUse = amount;
                    refreshTableRowBytes(result);
                });
            });
        } else if (desc.stringOnly) {
            // window.localStorage / window.sessionStorage: all values are plain strings.
            // Do NOT pass through JSON.stringify (adds wrapping quotes → inflated count).
            var enc = new TextEncoder();
            var bytes = state.results.reduce(function (sum, r) {
                var v = r.value != null ? r.value : '';
                return sum + enc.encode(r.name + v).length;
            }, 0);
            state.stats[type].bytesInUse = bytes;
            renderTabs();
            updateToolbar();
        } else {
            // readonly (e.g. managed): no byte counting
            state.stats[type].bytesInUse = 0;
            renderTabs();
            updateToolbar();
        }
    }

    // ─── Table rendering ──────────────────────────────────────────────────────

    function renderTable() {
        var tbody = el('storage-tbody');
        tbody.innerHTML = '';

        if (state.results.length === 0) {
            hide('storage-table');
            show('empty-message');
            var desc = state.currentDescriptor;
            desc && desc.readonly ? show('readonly-note') : hide('readonly-note');
        } else {
            show('storage-table');
            hide('empty-message');
            state.results.forEach(function (result) {
                tbody.appendChild(buildRow(result));
            });
        }
    }

    function refreshTableRowBytes(result) {
        var row = el('row-' + CSS.escape(result.name));
        if (!row) { return; }
        var cell = row.querySelector('.bytes-info');
        if (cell && result.bytesInUse !== undefined) {
            cell.textContent = prettyBytes(result.bytesInUse);
        }
    }

    function buildRow(result) {
        var desc = state.currentDescriptor;
        var tr = document.createElement('tr');
        tr.classList.add('list-row');
        tr.id = 'row-' + result.name;

        // Key cell
        var tdKey = document.createElement('td');
        var keySpan = document.createElement('span');
        keySpan.className = 'valueKey';
        keySpan.textContent = result.name;
        tdKey.appendChild(keySpan);
        if (!desc.stringOnly) {
            var bytesDiv = document.createElement('div');
            bytesDiv.className = 'usage bytes-info';
            if (result.bytesInUse !== undefined) { bytesDiv.textContent = prettyBytes(result.bytesInUse); }
            tdKey.appendChild(bytesDiv);
        }
        tr.appendChild(tdKey);

        // Value cell
        var tdVal = document.createElement('td');
        var valueEl = document.createElement('span');
        valueEl.className = 'displayedValue';
        setValueDisplay(valueEl, result.value, desc);
        valueEl.addEventListener('dblclick', function () { startInlineEdit(valueEl, result, desc); });
        tdVal.appendChild(valueEl);
        tr.appendChild(tdVal);

        // Actions cell
        var tdAct = document.createElement('td');
        tdAct.style.whiteSpace = 'nowrap';
        if (!desc.readonly) {
            var actions = document.createElement('div');
            actions.className = 'row-actions';

            var editBtn = document.createElement('button');
            editBtn.className = 'btn-icon';
            editBtn.title = 'Edit';
            editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M9.5 1.5l2 2-7 7-2.5.5.5-2.5 7-7z"/></svg>';
            editBtn.addEventListener('click', function () { openEditMode(result.name); });

            var delBtn = document.createElement('button');
            delBtn.className = 'btn-icon danger';
            delBtn.title = 'Delete';
            delBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 3.5h9M5 3.5V2.5h3v1M9.5 3.5l-.5 7h-5l-.5-7"/></svg>';
            delBtn.addEventListener('click', function () {
                storageRemove(state.currentType, result.name);
            });

            actions.appendChild(editBtn);
            actions.appendChild(delBtn);
            tdAct.appendChild(actions);
        }
        tr.appendChild(tdAct);
        return tr;
    }

    // ─── Value display ────────────────────────────────────────────────────────

    function setValueDisplay(el, value, desc) {
        if (desc.stringOnly) {
            el.textContent = value;
        } else {
            el.innerHTML = renderValue(value);
        }
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/\$/g, '&#36;');
    }

    function truncate(s) { return s.length > 50 ? s.substring(0, 49) + '…' : s; }

    function renderValue(val) {
        if (val === null)      { return '<span class="boolean">null</span>'; }
        if (val === undefined) { return '<span class="boolean">undefined</span>'; }
        if (typeof val === 'boolean') { return '<span class="boolean">' + val + '</span>'; }
        if (typeof val === 'number')  { return '<span class="number">' + val + '</span>'; }
        if (typeof val === 'string') {
            return '<span class="string">' + truncate(escapeHtml(JSON.stringify(val))) + '</span>';
        }
        if (Array.isArray(val)) {
            return '<span class="bracket">[</span>' +
                   val.map(renderValue).join(', ') +
                   '<span class="bracket">]</span>';
        }
        if (typeof val === 'object') {
            var pairs = Object.keys(val).map(function (k) {
                return renderValue(k) + ': ' + renderValue(val[k]);
            }).join(', ');
            return '<span class="bracket">{</span>' + pairs + '<span class="bracket">}</span>';
        }
        return escapeHtml(String(val));
    }

    // ─── Inline cell edit ─────────────────────────────────────────────────────

    function startInlineEdit(container, result, desc) {
        var input = document.createElement('input');
        input.type = 'text';
        input.style.cssText = 'width:100%;height:100%;box-sizing:border-box';
        input.value = desc.stringOnly ? result.value : JSON.stringify(result.value);
        container.innerHTML = '';
        container.appendChild(input);
        input.focus();
        input.select();

        input.addEventListener('blur', function () {
            setValueDisplay(container, result.value, desc);
        });
        input.addEventListener('keydown', function (e) {
            input.style.backgroundColor = '';
            if (e.keyCode === 13) {
                var raw = input.value;
                try {
                    var transmitted = desc.stringOnly ? raw : JSON.parse(raw);
                    var update = {};
                    update[result.name] = transmitted;
                    storageSet(state.currentType, update);
                } catch (err) {
                    input.style.backgroundColor = '#faa';
                }
            }
            if (e.keyCode === 27) { input.blur(); }
        });
    }

    // ─── Edit / Add panel ─────────────────────────────────────────────────────

    function openEditMode(name) {
        var desc = state.currentDescriptor;
        var value = state.rawData[name];
        _editOriginalKey = name;              // remember for rename detection in saveEdit
        el('edit-key').value = name;
        el('edit-key').readOnly = false;      // key is editable; save handles rename
        el('edit-value').value = desc.stringOnly
            ? value
            : (typeof value === 'object' ? prettyJson(value) : JSON.stringify(value));
        hide('edit-validation');
        setMode('edit');
    }

    function openAddMode() {
        _editOriginalKey = null;
        el('edit-key').value = '';
        el('edit-key').readOnly = false;
        el('edit-value').value = '';
        hide('edit-validation');
        setMode('add');
    }

    function validateEditValue() {
        var desc = state.currentDescriptor;
        if (!desc || desc.stringOnly) { hide('edit-validation'); return true; }
        var v = el('edit-value').value.trim();
        if (!v) { hide('edit-validation'); return true; }
        try {
            JSON.parse(v);
            hide('edit-validation');
            return true;
        } catch (e) {
            el('edit-validation').textContent = 'Invalid JSON: ' + e.message;
            show('edit-validation');
            return false;
        }
    }

    function saveEdit() {
        if (!validateEditValue()) { return; }
        var desc = state.currentDescriptor;
        var key = el('edit-key').value.trim();
        var raw = el('edit-value').value;
        if (!key) { return; }
        var update = {};
        update[key] = desc.stringOnly ? raw : JSON.parse(raw);

        var originalKey = _editOriginalKey;
        _editOriginalKey = null;

        if (originalKey && originalKey !== key) {
            // Key was renamed: remove old key first, then write under new key
            storageRemove(state.currentType, originalKey, function () {
                storageSet(state.currentType, update, function () { setMode('list'); });
            });
        } else {
            storageSet(state.currentType, update, function () { setMode('list'); });
        }
    }

    // ─── Storage change events ────────────────────────────────────────────────

    function handleStorageChanged(obj) {
        if (state.currentType !== obj.type) { return; }
        var isSpecial = (obj.type === 'localStorage' || obj.type === 'sessionStorage');

        if (obj.changes === 'clear') {
            state.rawData = {};
        } else if (typeof obj.changes === 'object') {
            Object.keys(obj.changes).forEach(function (key) {
                var change = obj.changes[key];
                if (isSpecial) {
                    if (!key) {
                        state.rawData = {};
                    } else if (change.newValue === null) {
                        delete state.rawData[key];
                    } else {
                        state.rawData[key] = change.newValue;
                    }
                } else {
                    // chrome.storage: undefined newValue means key was removed
                    if (change.newValue !== undefined) {
                        state.rawData[key] = change.newValue;
                    } else {
                        delete state.rawData[key];
                    }
                }
            });
        }
        adaptRawData();
    }

    // ─── Export / Import ──────────────────────────────────────────────────────

    // navigator.clipboard.writeText() requires document focus, which devtools panels
    // don't always have. The execCommand approach works reliably in this context.
    function copyTextToClipboard(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { document.execCommand('copy'); } catch (e) {
            console.error('[StorageExplorer] execCommand copy failed:', e);
        }
        document.body.removeChild(ta);
    }

    function exportToFile() {
        storageGet(state.currentType, function (items) {
            var blob = new Blob([prettyJson(items)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.download = state.currentType + '_storage.json';
            a.href = url;
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    function exportToClipboard() {
        storageGet(state.currentType, function (items) {
            copyTextToClipboard(prettyJson(items));
        });
    }

    function importFromFile() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', function () {
            var file = input.files[0];
            if (!file) { return; }
            var reader = new FileReader();
            reader.onload = function () {
                try {
                    var parsed = JSON.parse(reader.result);
                    storageClear(state.currentType, function () { storageSet(state.currentType, parsed); });
                    hide('import-error');
                } catch (e) {
                    showImportError(file.name, e.message, reader.result);
                }
            };
            reader.readAsText(file);
        });
        input.click();
    }

    function importFromClipboard() {
        // navigator.clipboard.readText() is blocked by permissions policy in devtools
        // panels even when clipboardRead is declared in the manifest.
        // execCommand('paste') into a focused textarea is the correct approach for
        // Chrome extensions — it honours the clipboardRead permission without the
        // Permissions API / focus restrictions that block the modern Clipboard API.
        var ta = document.createElement('textarea');
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.focus();
        var ok = document.execCommand('paste');
        var text = ta.value;
        document.body.removeChild(ta);

        if (!ok && !text) {
            showImportError(null, 'Clipboard paste not available — try "Import from File" instead.', '');
            return;
        }

        try {
            var parsed = JSON.parse(text);
            storageClear(state.currentType, function () { storageSet(state.currentType, parsed); });
            hide('import-error');
        } catch (e) {
            showImportError(null, e.message, text);
        }
    }

    function showImportError(filename, message, content) {
        el('import-error-title').textContent = filename
            ? 'Import from file "' + filename + '" failed'
            : 'Import from clipboard failed';
        el('import-error-message').textContent = message;
        el('import-error-content').textContent = content;
        show('import-error');
    }

    // ─── Dropdown toggle ──────────────────────────────────────────────────────

    function closeAllDropdowns() {
        document.querySelectorAll('.dropdown.open').forEach(function (d) {
            d.classList.remove('open');
        });
    }

    document.addEventListener('click', function (e) {
        // Close the dropdown when a menu item inside it is clicked
        var menuItem = e.target.closest && e.target.closest('.dropdown-menu a');
        if (menuItem) {
            var dd = menuItem.closest('.dropdown');
            if (dd) { dd.classList.remove('open'); }
            return;  // item's own handler already ran (bubbling order: element → document)
        }

        // Close any open dropdown when clicking outside it
        document.querySelectorAll('.dropdown.open').forEach(function (d) {
            if (!d.contains(e.target)) { d.classList.remove('open'); }
        });

        // Toggle dropdown on its toggle button
        var toggle = e.target.closest && e.target.closest('.dropdown-toggle');
        if (toggle) {
            e.preventDefault();
            toggle.closest('.dropdown').classList.toggle('open');
        }
    });

    // ─── Event bindings ───────────────────────────────────────────────────────

    function bindEvents() {
        el('reload-link').addEventListener('click', function (e) {
            e.preventDefault();
            chrome.devtools.inspectedWindow.reload();
            window.location.reload();
        });
        el('import-error-close').addEventListener('click', function () { hide('import-error'); });
        el('btn-add').addEventListener('click', openAddMode);
        el('btn-clear').addEventListener('click', function () {
            if (!confirm('Clear all items in ' + state.currentType + '?')) { return; }
            storageClear(state.currentType);
        });
        el('btn-save').addEventListener('click', saveEdit);
        el('btn-cancel').addEventListener('click', function () { setMode('list'); });
        el('edit-value').addEventListener('input', validateEditValue);
        el('export-file').addEventListener('click',      function (e) { e.preventDefault(); exportToFile(); });
        el('export-clipboard').addEventListener('click', function (e) { e.preventDefault(); exportToClipboard(); });
        el('import-file').addEventListener('click',      function (e) { e.preventDefault(); importFromFile(); });
        el('import-clipboard').addEventListener('click', function (e) { e.preventDefault(); importFromClipboard(); });
    }

    // ─── Boot ─────────────────────────────────────────────────────────────────

    function init() {
        // Show connecting state immediately so the panel is never blank.
        show('connecting-view');

        // Reload the panel whenever the inspected page navigates — storage types
        // can change (e.g. navigating away from an extension page to a web page).
        chrome.devtools.network.onNavigated.addListener(function () {
            window.location.reload();
        });

        getAppContext().then(function (appInfo) {
            hide('connecting-view');
            openPort(appInfo);
            setupTabs(appInfo);
        }, function (err) {
            // Log as a warning instead of an error. This is expected behavior for restricted pages.
            console.log('[StorageExplorer] Disabled for this page. Reason:', err.description || 'Permission denied');
            hide('connecting-view');
            show('error-view');
        });
    }

    init();

})();
