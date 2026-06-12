const clipboard = {
    copy: function (text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(err => {
                this.fallbackCopy(text);
            });
        } else {
            this.fallbackCopy(text);
        }
    },
    fallbackCopy: function (text) {
        const area = document.createElement('textarea');
        area.value = text;
        document.body.appendChild(area);
        area.select();
        try {
            document.execCommand('copy');
        } catch (err) {
            console.error('Fallback copy failed', err);
        }
        document.body.removeChild(area);
    },
    paste: function () {
        if (navigator.clipboard && navigator.clipboard.readText) {
            return navigator.clipboard.readText().catch(err => {
                console.error('Clipboard paste failed', err);
                return "";
            });
        }
        return Promise.resolve("");
    }
};
