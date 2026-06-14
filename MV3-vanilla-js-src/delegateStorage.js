function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
        .toString(16)
        .substring(1);
}

function guid() {
    return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
        s4() + '-' + s4() + s4() + s4();
}

class DelegatedStorageArea {
    constructor(connectionPromise, type, onStorageChanged) {
        this.type = type;
        this.methodCallbacks = {};
        this.meta = null;
        this.metaResolvers = [];
        this.onStorageChanged = onStorageChanged;

        connectionPromise.then((connection) => {
            this.connection = connection;
            connection.port.onMessage.addListener((message) => {
                if (message.from.tab != connection.tabId || message.from.app != connection.appId) {
                    return;
                }

                var result = message.obj;
                if (!result.id && !result.change) {
                    return;
                }

                if (result.change) {
                    if (result.type === this.type) {
                        this.onStorageChanged(result);
                    }
                    return;
                }

                if (result.type != this.type) {
                    return;
                }

                if (result.meta) {
                    this.meta = result.meta;
                    this.metaResolvers.forEach(resolve => resolve(this.meta));
                    this.metaResolvers = [];
                }

                var callback = this.methodCallbacks[result.id];
                if (!callback) {
                    return;
                }
                delete this.methodCallbacks[result.id];
                callback.apply(null, result.results);
            });
        });

        ["get", "set", "remove", "clear", "getBytesInUse"].forEach((method) => {
            this[method] = this.createMethodDelegate(method, connectionPromise);
        });
    }

    createMethodDelegate(name, connectionPromise) {
        return (...args) => {
            var callback = null;
            var finalArgs = [];

            args.forEach(arg => {
                if (typeof arg === 'function') {
                    callback = arg;
                } else {
                    finalArgs.push(arg);
                }
            });

            var message = {type: this.type, args: finalArgs, method: name};
            if (callback) {
                message.id = guid();
                this.methodCallbacks[message.id] = callback;
            }

            connectionPromise.then((connection) => {
                message.target = connection.appId;
                connection.port.postMessage(message);
            });
        };
    }

    getMeta() {
        if (this.meta) {
            return Promise.resolve(this.meta);
        }
        return new Promise(resolve => {
            this.metaResolvers.push(resolve);
        });
    }
}
