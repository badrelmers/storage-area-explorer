function PortManager() {
    this.uiPorts = {
        app: {
            tab: {
                ports: {}
            },
            ports: {}
        },
        tab: {
            ports: {}
        }
    };

    this.targetPorts = {
        app: {
            tab: {
                ports: {}
            },
            ports: {}

        },
        tab: {
            ports: {}
        }
    }
}


function findPort(ports, app, tab) {
    if (app && tab) {
        return ports.app.tab.ports[app + "_" + tab];
    }
    if (app) {
        return ports.app.ports[app];
    }
    if (tab) {
        return ports.tab.ports[tab];
    }
    return null;
}

function putPort(ports, app, tab, port) {
    const existingPort = findPort(ports, app, tab);
    if (existingPort) {
        try { existingPort.disconnect(); } catch(e) {}
        removePort(ports, app, tab);
    }

    if (app && tab) {
        ports.app.tab.ports[app + "_" + tab] = port;
        return;
    }
    if (tab) {
        ports.tab.ports[tab] = port;
        return;
    }
    if (app) {
        ports.app.ports[app] = port;
        return;
    }
}

function removePort(ports, app, tab) {
    const port = findPort(ports, app, tab);
    if (!port) {
        return null;
    }
    if (app && tab) {
        delete ports.app.tab.ports[app + "_" + tab];
    } else if (tab) {
        delete ports.tab.ports[tab];
    } else if (app) {
        delete ports.app.ports[app];
    }
    return port;
}

PortManager.prototype.getUiPort = function (app, tab) {
    return findPort(this.uiPorts, app, tab);
};

PortManager.prototype.getTargetPort = function (app, tab) {
    return findPort(this.targetPorts, app, tab);
};


PortManager.prototype.onPortDisconnected = function (app, tab, disconnectedPort) {
    console.log("Disconnecting ports for " + app + ":" + tab);
    var p1 = removePort(this.uiPorts, app, tab);
    var p2 = removePort(this.targetPorts, app, tab);
    [p1, p2].forEach(function (port) {
        if (port && port !== disconnectedPort) {
            try { port.disconnect(); } catch(e) {}
        }
    });
};

PortManager.prototype.trackUiPort = function (app, tab, port) {
    var self = this;
    console.log("Trying to track ui port for app " + app + " and tab " + tab);
    putPort(this.uiPorts, app, tab, port);
    port.onDisconnect.addListener(function () {
        const removed = removePort(self.uiPorts, app, tab);
        if (removed) {
            var targetPort = findPort(self.targetPorts, app, tab);
            if (targetPort) {
                self.onPortDisconnected(app, tab, targetPort);
            }
        }
    });
    port.onMessage.addListener(function (message) {
        var targetPort = self.getTargetPort(app, tab);
        if (targetPort) {
            targetPort.postMessage(message);
        } else {
            console.error("Target port not found for app id " + app + " and tab id " + tab);
            // Don't disconnect here immediately, target might still connect
        }
    });
};

PortManager.prototype.trackTargetPort = function (app, tab, port) {
    var self = this;
    console.log("Trying to track target port for app " + app + " and tab " + tab);
    putPort(this.targetPorts, app, tab, port);
    port.onDisconnect.addListener(function () {
        const removed = removePort(self.targetPorts, app, tab);
        if (removed) {
            var uiPort = findPort(self.uiPorts, app, tab);
            if (uiPort) {
                self.onPortDisconnected(app, tab, uiPort);
            }
        }
    });
    port.onMessage.addListener(function (message) {
        var uiPort = self.getUiPort(app, tab);
        if (uiPort) {
            uiPort.postMessage({from: {tab: tab, app: app}, obj: message});
        } else {
            console.error("Can't find ui port for appId " + app + " and tab Id" + tab);
        }
    })
};


function initializeExtension() {

    var portManager = new PortManager();
    chrome.runtime.onConnect.addListener(function (port) {
        if (port.name.indexOf("for_tab_") === 0) {
            var tabId = parseInt(port.name.substring("for_tab_".length));
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ["htmlStorageHook.js"]
            }, function () {
                if (chrome.runtime.lastError) {
                    console.warn("Script injection failed:", chrome.runtime.lastError.message);
                }
                port.postMessage("portConnected");
            });
            portManager.trackUiPort(undefined, tabId, port);
        } else if (port.name == "inspected_tab_") {
            portManager.trackTargetPort(undefined, port.sender.tab.id, port);
        } else {
            if(port.name.indexOf("_") < 0) {
                portManager.trackUiPort(port.name, undefined, port);
            } else {
               var names = port.name.split("_");
                portManager.trackUiPort(names[0], names[1], port);
            }
            port.postMessage("portConnected");
        }
    });


    chrome.runtime.onConnectExternal.addListener(function (externalPort) {
        var appName = externalPort.sender.id;
        var tabId = externalPort.sender.tab ? externalPort.sender.tab.id : undefined;
        portManager.trackTargetPort(appName, tabId, externalPort);
    });
}

initializeExtension();
