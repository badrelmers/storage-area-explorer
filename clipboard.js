const clipboard = {
    tabId: null,
    copy: function (text) {
        chrome.runtime.sendMessage({
            action: 'copy',
            params: [text],
            tabId: this.tabId
        });
    },
    paste: function () {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'paste',
                tabId: this.tabId
            }, function (result) {
                resolve(result);
            });
        });
    }
};
