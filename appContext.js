const appContext = function () {
    return evalService.evalFunction(function (chrome) {
        var storageTypes = [];
        var returnValue = {storageTypes: storageTypes};

        try {
            const location = document.location;
            if(location == null || (location.protocol!= "https:" && location.protocol!="http:")) {
                returnValue.id = chrome.runtime.id;

                var manifest = chrome.runtime.getManifest();
                returnValue.manifest = manifest;
                if (manifest.permissions.indexOf("storage") > -1 || (manifest["optional_permissions"] && manifest["optional_permissions"].indexOf("storage") > -1)) {
                    storageTypes.push('local');
                    storageTypes.push('sync');
                    storageTypes.push('managed');
                    if (chrome.storage.session) {
                        storageTypes.push('session');
                    }
                }
            }

        } catch (e) {
        }
        try {
            if (window.localStorage) {
                storageTypes.push('localStorage');
            }
            if (window.sessionStorage) {
                storageTypes.push('sessionStorage')
            }

        } catch (e) {
        }
        return returnValue;
    }).then(function (result) {
        var info = {
            id: result.id,
            manifest: result.manifest,
            tabId: (typeof chrome !== 'undefined' && chrome.devtools && chrome.devtools.inspectedWindow) ? chrome.devtools.inspectedWindow.tabId : null,
            storageTypes: result.storageTypes
        };
        if (result.manifest) {
            info.name = result.manifest.name;
        }

        return info;
    });
};
