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
    if (findPort(ports, app, tab)) {
        throw new Error("Such port already exist");
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
    throw new Error("Can't put port without app or tab");
}

function removePort(ports, app, tab) {
    if (!findPort(ports, app, tab)) {
        return;
    }
    if (app && tab) {
        delete ports.app.tab.ports[app + "_" + tab];
        return;
    }
    if (tab) {
        delete ports.tab.ports[tab];
        return;
    }
    if (app) {
        delete ports.app.ports[app];
    }
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
        if (!port) {
            return;
        }
        if (port == disconnectedPort) {
            return;
        }
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
    if(this.getTargetPort(app, tab)){
        port.disconnect();
        throw new Error("port for " + app + ":" + tab + " already exist");

    }
    if(!this.getUiPort(app, tab)){
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
        console.log("Received message from ui port,  app:tab " + app + ":" + tab, message);
        var uiPort = self.getUiPort(app, tab);
        if (uiPort) {
            uiPort.postMessage({from: {tab: tab, app: app}, obj: message});
        } else {
            port.disconnect();
            self.onPortDisconnected(app, tab, port);
            console.error("Can't find ui port for appId " + app + " and tab Id" + tab);
        }
    })

};


function initializeExtension() {

    var portManager = new PortManager();
    chrome.runtime.onConnect.addListener(function (port) {
        if (port.name.indexOf("for_tab_") === 0) {
            console.log("Devtools listening for tab ", port.name);
            var tabId = parseInt(port.name.substring("for_tab_".length));
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ["htmlStorageHook.js"]
            }, function () {
                port.postMessage("portConnected");
                console.log("Connecting devtools port");
            });
            portManager.trackUiPort(undefined, tabId, port);
        } else if (port.name == "inspected_tab_") {
            console.log("Inspected tab connected", port.name);
            portManager.trackTargetPort(undefined, port.sender.tab.id, port);
        } else {
            console.log("Another port connected", port);
            if(port.name.indexOf("_")< 0) {
                portManager.trackUiPort(port.name, undefined, port);
            } else {
               var names = port.name.split("_");
                portManager.trackUiPort(names[0], names[1], port);
            }
            port.postMessage("portConnected");
        }
    });


    //only invoked by chrome apps
    chrome.runtime.onConnectExternal.addListener(function (externalPort) {
        var appName = externalPort.sender.id;
        var tabId = externalPort.sender.tab ? externalPort.sender.tab.id : undefined;

        if (portManager.getUiPort(appName, tabId)) {
            portManager.trackTargetPort(appName, tabId, externalPort)
        } else {
            externalPort.disconnect();
        }
    });

    chrome.runtime.onMessage.addListener(function (message, sender, response) {
        const tabId = (sender.tab && sender.tab.id) || message.tabId;
        if (!tabId) {
            console.error("No tabId available for clipboard operation");
            return;
        }

        if (message.action === 'copy') {
            // Use chrome.scripting API to handle clipboard operations in MV3
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: function(text) {
                    navigator.clipboard.writeText(text).then(function() {
                        console.log('Text copied to clipboard');
                    }).catch(function(err) {
                        console.error('Could not copy text: ', err);
                        // Fallback to legacy method
                        var area = document.createElement('textarea');
                        area.value = text;
                        document.body.appendChild(area);
                        area.select();
                        document.execCommand('copy');
                        document.body.removeChild(area);
                    });
                },
                args: [message.params[0]]
            });
            response && response();
            return;
        }
        if (message.action === 'paste') {
            // Use chrome.scripting API to handle clipboard operations in MV3
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: function() {
                    return navigator.clipboard.readText().catch(function(err) {
                        console.error('Could not read clipboard: ', err);
                        // Fallback to legacy method
                        var area = document.createElement('textarea');
                        document.body.appendChild(area);
                        area.select();
                        document.execCommand('paste');
                        var value = area.value;
                        document.body.removeChild(area);
                        return value;
                    });
                }
            }, function(results) {
                if (chrome.runtime.lastError) {
                    console.error("Paste error:", chrome.runtime.lastError);
                    response && response("");
                } else if (results && results[0]) {
                    response && response(results[0].result);
                } else {
                    response && response("");
                }
            });
            return true; // Indicates we will call response asynchronously
        }
    });
}

// Initialize the extension when the service worker starts
initializeExtension();



