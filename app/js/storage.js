let storage = null;
let currentConnection = null;

function initStorage(onStorageChanged) {
    const connectionDeferred = {};
    const connectionPromise = new Promise((resolve, reject) => {
        connectionDeferred.resolve = resolve;
        connectionDeferred.reject = reject;
    });

    const types = ["sync", "local", "managed", "session", "localStorage", "sessionStorage"];
    storage = {};
    types.forEach(type => {
        storage[type] = new DelegatedStorageArea(connectionPromise, type, onStorageChanged);
    });

    appContext().then(function (appInfo) {
        var connection = {};
        var remoteId;
        if (appInfo.id) {
            connection.appId = appInfo.id;
            remoteId = appInfo.id;
        }
        if (appInfo.tabId) {
            connection.tabId = appInfo.tabId;
        }
        if (!appInfo.id && appInfo.tabId) {
            remoteId = "for_tab_" + appInfo.tabId;
        }
        if(appInfo.id && appInfo.tabId){
            remoteId = appInfo.id + "_" + appInfo.tabId;
        }

        const port = chrome.runtime.connect({name: remoteId});
        connection.port = port;
        currentConnection = connection;

        port.onMessage.addListener(function (message) {
            if (message == "portConnected") {
                if (appInfo.id) {
                    evalService.evalFunction(extensionPageInject, {'APP_ID': chrome.runtime.id}).then(function () {
                        connectionDeferred.resolve(connection);
                    });
                } else {
                    evalService.evalFunction(targetPageInject, {'APP_ID': chrome.runtime.id}).then(function () {
                        connectionDeferred.resolve(connection);
                    });
                }
            }
        });
        port.onDisconnect.addListener(function () {
            window.location.reload();
        });
    }).catch(err => {
        console.error("AppContext failed", err);
    });

    return storage;
}

function getStorage() {
    return storage;
}
