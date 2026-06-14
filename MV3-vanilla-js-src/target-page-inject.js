function targetPageInject(chrome) {
    var from = "APP_ID";
    var port = chrome.runtime.connect(from);
    port.onMessage.addListener(function (message) {
        if (message.target !== chrome.runtime.id || !message.type) {
            return;
        }
        var storage = chrome.storage[message.type];
        if (!storage) {
            console.error("Storage not found", message.type);
            return;
        }
        var method = storage[message.method];
        var args = message.args || [];

        args.push(function () {
            var results = Array.prototype.slice.call(arguments);
            message.results = results;

            message.meta = {};
            const constants = ['QUOTA_BYTES', 'QUOTA_BYTES_PER_ITEM', 'MAX_ITEMS', 'MAX_WRITE_OPERATIONS_PER_HOUR', 'MAX_WRITE_OPERATIONS_PER_MINUTE', 'MAX_SUSTAINED_WRITE_OPERATIONS_PER_MINUTE'];
            constants.forEach(c => {
                if (storage[c] !== undefined) {
                    message.meta[c] = storage[c];
                }
            });
            Object.keys(storage).forEach(function (key) {
                if (typeof storage[key] === 'function') {
                    return;
                }
                message.meta[key] = storage[key];
            });

            port.postMessage(message);
        });
        method.apply(storage, args);
    });

    port.onDisconnect.addListener(function () {
        chrome.storage.onChanged.removeListener(storageListener);
    });

    var storageListener = function (changes, name) {
        port.postMessage({change: true, changes: changes, type: name});
    };
    chrome.storage.onChanged.addListener(storageListener);
}
