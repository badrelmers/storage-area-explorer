function PortManager() {
    this.uiPorts = {
        app: {
            tab: { ports: {} },
            ports: {}
        },
        tab: { ports: {} }
    };

    this.targetPorts = {
        app: {
            tab: { ports: {} },
            ports: {}
        },
        tab: { ports: {} }
    };
}

function findPort(ports, app, tab) {
    if (app && tab) return ports.app.tab.ports[app + "_" + tab];
    if (app) return ports.app.ports[app];
    if (tab) return ports.tab.ports[tab];
    return null;
}

function putPort(ports, app, tab, port) {
    const existing = findPort(ports, app, tab);
    if (existing) {
        try { existing.disconnect(); } catch (e) {}
        removePort(ports, app, tab);
    }

    if (app && tab) {
        ports.app.tab.ports[app + "_" + tab] = port;
    } else if (tab) {
        ports.tab.ports[tab] = port;
    } else if (app) {
        ports.app.ports[app] = port;
    }
}

function removePort(ports, app, tab) {
    const port = findPort(ports, app, tab);
    if (!port) return null;

    if (app && tab) {
        delete ports.app.tab.ports[app + "_" + tab];
    } else if (tab) {
        delete ports.tab.ports[tab];
    } else if (app) {
        delete ports.app.ports[app];
    }
    return port;
}

PortManager.prototype.onPortDisconnected = function (app, tab, disconnectedPort) {
    const p1 = removePort(this.uiPorts, app, tab);
    const p2 = removePort(this.targetPorts, app, tab);
    [p1, p2].forEach(p => {
        if (p && p !== disconnectedPort) {
            try { p.disconnect(); } catch (e) {}
        }
    });
};

PortManager.prototype.trackUiPort = function (app, tab, port) {
    putPort(this.uiPorts, app, tab, port);
    port.onDisconnect.addListener(() => {
        if (removePort(this.uiPorts, app, tab)) {
            const target = findPort(this.targetPorts, app, tab);
            if (target) this.onPortDisconnected(app, tab, target);
        }
    });
    port.onMessage.addListener(msg => {
        const target = findPort(this.targetPorts, app, tab);
        if (target) target.postMessage(msg);
    });
};

PortManager.prototype.trackTargetPort = function (app, tab, port) {
    putPort(this.targetPorts, app, tab, port);
    port.onDisconnect.addListener(() => {
        if (removePort(this.targetPorts, app, tab)) {
            const ui = findPort(this.uiPorts, app, tab);
            if (ui) this.onPortDisconnected(app, tab, ui);
        }
    });
    port.onMessage.addListener(msg => {
        const ui = findPort(this.uiPorts, app, tab);
        if (ui) ui.postMessage({ from: { tab, app }, obj: msg });
    });
};

const portManager = new PortManager();

chrome.runtime.onConnect.addListener(port => {
    if (port.name.startsWith("for_tab_")) {
        const tabId = parseInt(port.name.substring(8));
        chrome.scripting.executeScript({
            target: { tabId },
            files: ["htmlStorageHook.js"]
        }, () => {
            if (chrome.runtime.lastError) {
                console.warn("Script injection failed:", chrome.runtime.lastError.message);
            }
            port.postMessage("portConnected");
        });
        portManager.trackUiPort(undefined, tabId, port);
    } else if (port.name === "inspected_tab_") {
        portManager.trackTargetPort(undefined, port.sender.tab.id, port);
    } else {
        const parts = port.name.split("_");
        if (parts.length === 1) {
            portManager.trackUiPort(parts[0], undefined, port);
        } else {
            portManager.trackUiPort(parts[0], parts[1], port);
        }
        port.postMessage("portConnected");
    }
});

chrome.runtime.onConnectExternal.addListener(port => {
    const appName = port.sender.id;
    const tabId = port.sender.tab ? port.sender.tab.id : undefined;
    portManager.trackTargetPort(appName, tabId, port);
});

chrome.tabs.onRemoved.addListener(tabId => {
    // Port cleanup is handled by onDisconnect listeners on the ports themselves.
});
