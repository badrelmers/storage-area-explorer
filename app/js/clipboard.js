const clipboard = {
    copy: function (text) {
        chrome.runtime.sendMessage({
            action: 'copy',
            params: [text]
        });
    },
    paste: function () {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'paste'
            }, function (result) {
                resolve(result);
            });
        });
    }
};
