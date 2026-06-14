function PortManager() {
    this.uiPorts = {
        app: { tab: { ports: {} }, ports: {} },
        tab: { ports: {} }
    };
    this.targetPorts = {
        app: { tab: { ports: {} }, ports: {} },
        tab: { ports: {} }
    };
}

function findPort(ports, app, tab) {
    if (app && tab) { return ports.app.tab.ports[app + "_" + tab]; }
    if (app)        { return ports.app.ports[app]; }
    if (tab)        { return ports.tab.ports[tab]; }
    return null;
}

function putPort(ports, app, tab, port) {
    if (findPort(ports, app, tab)) {
        removePort(ports, app, tab);
    }
    if (app && tab) { ports.app.tab.ports[app + "_" + tab] = port; return; }
    if (tab)        { ports.tab.ports[tab] = port; return; }
    if (app)        { ports.app.ports[app] = port; return; }
    throw new Error("Can't put port without app or tab");
}

function removePort(ports, app, tab) {
    if (!findPort(ports, app, tab)) { return; }
    if (app && tab) { delete ports.app.tab.ports[app + "_" + tab]; return; }
    if (tab)        { delete ports.tab.ports[tab]; return; }
    if (app)        { delete ports.app.ports[app]; }
}

PortManager.prototype.getUiPort = function (app, tab) {
    return findPort(this.uiPorts, app, tab);
};

PortManager.prototype.getTargetPort = function (app, tab) {
    return findPort(this.targetPorts, app, tab);
};

PortManager.prototype.onPortDisconnected = function (app, tab, disconnectedPort) {
    console.log("Disconnecting ports for " + app + ":" + tab);
    var removePort2 = removePort(this.uiPorts, app, tab);
    var removePort1 = removePort(this.targetPorts, app, tab);
    [removePort1, removePort2].forEach(function (port) {
        if (!port || port === disconnectedPort) { return; }
        port.disconnect();
    });
};

PortManager.prototype.trackUiPort = function (app, tab, port) {
    var self = this;
    console.log("Trying to track ui port for app " + app + " and tab " + tab);
    putPort(this.uiPorts, app, tab, port);
    port.onDisconnect.addListener(function () {
        removePort(self.uiPorts, app, tab);
        var targetPort = findPort(self.targetPorts, app, tab);
        if (targetPort) {
            targetPort.disconnect();
            self.onPortDisconnected(app, tab, targetPort);
        }
    });
    port.onMessage.addListener(function (message) {
        console.log("Received message from ui port,  app:tab " + app + ":" + tab, message);
        var targetPort = self.getTargetPort(app, tab);
        if (targetPort) {
            targetPort.postMessage(message);
        } else {
            port.disconnect();
            self.onPortDisconnected(app, tab, port);
            console.error("Target port not found for  app id " + app + " and tab id " + tab);
        }
    });
};

PortManager.prototype.trackTargetPort = function (app, tab, port) {
    if (this.getTargetPort(app, tab)) {
        this.getTargetPort(app, tab).disconnect();
        removePort(this.targetPorts, app, tab);
    }
    if (!this.getUiPort(app, tab)) {
        port.disconnect();
        throw new Error("Target port cannot be tracked before ui port exist. Id " + app + ":" + tab);
    }
    var self = this;
    console.log("Trying to track target port for app " + app + " and tab " + tab);
    putPort(this.targetPorts, app, tab, port);
    port.onDisconnect.addListener(function () {
        removePort(self.targetPorts, app, tab);
        var uiPort = findPort(self.uiPorts, app, tab);
        if (uiPort) {
            uiPort.disconnect();
            self.onPortDisconnected(app, tab, uiPort);
        }
    });
    port.onMessage.addListener(function (message) {
        var uiPort = self.getUiPort(app, tab);
        if (uiPort) {
            uiPort.postMessage({from: {tab: tab, app: app}, obj: message});
        } else {
            port.disconnect();
            self.onPortDisconnected(app, tab, port);
            console.error("Can't find ui port for appId " + app + " and tab Id" + tab);
        }
    });
};

function initializeExtension() {
    var portManager = new PortManager();

    chrome.runtime.onConnect.addListener(function (port) {
        if (port.name.indexOf("for_tab_") === 0) {
            console.log("Devtools listening for tab ", port.name);
            var tabId = parseInt(port.name.substring("for_tab_".length));
            // Track the UI port first so trackTargetPort succeeds when the hook
            // connects back via the inspected_tab_ name.
            portManager.trackUiPort(undefined, tabId, port);

            // Fast path: htmlStorageHook.js is declared as a content script and
            // is already running. A sendMessage is a single IPC round-trip (<5 ms)
            // vs executeScript which could take seconds in MV3 service workers.
            chrome.tabs.sendMessage(tabId, {action: "devtools_connect"}, function () {
                if (chrome.runtime.lastError) {
                    // Fallback: content script not running (page loaded before the
                    // extension was active). Inject it, then signal it to connect.
                    chrome.tabs.executeScript(tabId, {file: "app/chrome/htmlStorageHook.js"}, function () {
                        if (!chrome.runtime.lastError) {
                            chrome.tabs.sendMessage(tabId, {action: "devtools_connect"});
                        }
                    });
                }
                // "portConnected" is sent from the inspected_tab_ handler below,
                // only after the target port is confirmed registered — no race.
            });

        } else if (port.name === "inspected_tab_") {
            console.log("Inspected tab connected", port.name);
            var hookTabId = port.sender.tab.id;
            portManager.trackTargetPort(undefined, hookTabId, port);
            // Both ports are now registered — safe to tell the panel to proceed.
            var uiPort = portManager.getUiPort(undefined, hookTabId);
            if (uiPort) {
                uiPort.postMessage("portConnected");
                console.log("Connecting devtools port");
            }

        } else {
            // Extension-page inspection (chrome.storage bridge)
            console.log("Another port connected", port);
            if (port.name.indexOf("_") < 0) {
                portManager.trackUiPort(port.name, undefined, port);
            } else {
                var names = port.name.split("_");
                portManager.trackUiPort(names[0], names[1], port);
            }
            port.postMessage("portConnected");
        }
    });

    // Only invoked by chrome apps / extension pages
    chrome.runtime.onConnectExternal.addListener(function (externalPort) {
        var appName = externalPort.sender.id;
        var tabId = externalPort.sender.tab ? externalPort.sender.tab.id : undefined;
        if (portManager.getUiPort(appName, tabId)) {
            portManager.trackTargetPort(appName, tabId, externalPort);
        } else {
            externalPort.disconnect();
        }
    });
}

// MV2: background page always has `document`; guard prevents running in
// non-page contexts if the file is ever loaded elsewhere.
if (typeof document !== "undefined") {
    initializeExtension();
}
