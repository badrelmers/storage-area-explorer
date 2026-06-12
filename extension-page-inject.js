function extensionPageInject(chrome) {
    var from = "APP_ID";
    var port = chrome.runtime.connect(from);
    var storages = {};

    function StorageArea(storage) {
        this.storage = storage;
    }

    StorageArea.prototype.get = function (items, callback) {
        if (typeof items === 'function') {
            callback = items;
            items = null;
        }
        var returnItems = {};
        var storage = this.storage;
        if (items === null || items === undefined) {
            for (var i = 0; i < storage.length; i++) {
                var key2 = storage.key(i);
                returnItems[key2] = storage.getItem(key2);
            }
        } else {
            if (typeof items === 'string') {
                returnItems[items] = storage.getItem(items);
            } else if (Array.isArray(items)) {
                items.forEach(function (key) {
                    returnItems[key] = storage.getItem(key);
                });
            } else {
                for (var key in items) {
                    var val = storage.getItem(key);
                    returnItems[key] = val !== null ? val : items[key];
                }
            }
        }
        callback && callback(returnItems);
    };

    StorageArea.prototype.set = function (items, callback) {
        var storage = this.storage;
        for (var key in items) {
            storage.setItem(key, items[key]);
        }
        callback && callback();
    };

    StorageArea.prototype.remove = function (items, callback) {
        var storage = this.storage;
        if (typeof items === 'string') {
            storage.removeItem(items);
        } else if (Array.isArray(items)) {
            items.forEach(function (key) {
                storage.removeItem(key);
            });
        }
        callback && callback();
    };

    StorageArea.prototype.clear = function (callback) {
        this.storage.clear();
        callback && callback();
    };

    StorageArea.prototype.getBytesInUse = function(items, callback){
        callback && callback(0);
    };

    try {
        if (chrome.storage) {
            port.onDisconnect.addListener(function () {
                chrome.storage.onChanged.removeListener(storageListener);
            });

            var storageListener = function (changes, name) {
                port.postMessage({change: true, changes: changes, type: name});
            };
            chrome.storage.onChanged.addListener(storageListener);
            storages['sync'] = chrome.storage.sync;
            storages['local'] = chrome.storage.local;
            storages['managed'] = chrome.storage.managed;
            if (chrome.storage.session) {
                storages['session'] = chrome.storage.session;
            }
        }
    } catch (e) {}

    try {
        storages['localStorage'] = new StorageArea(window.localStorage);
        storages['sessionStorage'] = new StorageArea(window.sessionStorage);

        var frame = document.createElement("iframe");
        frame.style.display = 'none';
        document.documentElement.appendChild(frame);
        frame.contentWindow.addEventListener("storage", function (event) {
            var type = "";
            if (event.storageArea === event.currentTarget.localStorage) {
                type = "localStorage";
            } else if (event.storageArea === event.currentTarget.sessionStorage) {
                type = "sessionStorage"
            } else {
                return;
            }
            var changes = {};
            if (event.key) {
                changes[event.key] = {newValue: event.newValue};
            } else {
                changes = "clear";
            }
            port.postMessage({change: true, type: type, changes: changes});
        });
        port.onDisconnect.addListener(function () {
            if (frame.parentNode) {
                document.documentElement.removeChild(frame);
            }
        });
    } catch (e) {}

    port.onMessage.addListener(function (message) {
        if (message.target !== chrome.runtime.id || !message.type) {
            return;
        }
        var storage = storages[message.type];
        if (!storage) return;
        var method = storage[message.method];
        var args = message.args || [];

        args.push(function () {
            var results = Array.prototype.slice.call(arguments);
            message.results = results;
            port.postMessage(message);
        });

        message.meta = {};
        // Explicitly copy non-enumerable quota constants
        const constants = ['QUOTA_BYTES', 'QUOTA_BYTES_PER_ITEM', 'MAX_ITEMS', 'MAX_WRITE_OPERATIONS_PER_HOUR', 'MAX_WRITE_OPERATIONS_PER_MINUTE', 'MAX_SUSTAINED_WRITE_OPERATIONS_PER_MINUTE'];
        constants.forEach(c => {
            if (storage[c] !== undefined) {
                message.meta[c] = storage[c];
            }
        });

        Object.keys(storage).forEach(function (key) {
            if (typeof storage[key] !== 'function') {
                message.meta[key] = storage[key];
            }
        });
        method.apply(storage, args);
    });
}
