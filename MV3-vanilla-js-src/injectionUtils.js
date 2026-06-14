const evalService = {
    evalFunction: function (closure, parameters) {
        return new Promise((resolve, reject) => {
            let closureString = closure.toString();
            if (parameters) {
                Object.keys(parameters).forEach(function (key) {
                    closureString = closureString.replace(key, parameters[key]);
                });
            }
            if (typeof chrome !== 'undefined' && chrome.devtools && chrome.devtools.inspectedWindow) {
                chrome.devtools.inspectedWindow.eval("(" + closureString + ")(chrome)", function (value, isError) {
                    if (isError) {
                        reject(value);
                    } else {
                        resolve(value);
                    }
                });
            } else {
                reject("chrome.devtools.inspectedWindow not available");
            }
        });
    }
};
