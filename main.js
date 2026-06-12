let currentType = null;
let currentDescriptor = null;
let storageDescriptors = [];
let stats = {};
let meta = {};
let results = [];
let rawData = {};
let mode = 'list';
let editObject = { key: '', value: '' };

const descriptors = {
    "local": {title: "chrome.storage.local"},
    "sync": {title: "chrome.storage.sync"},
    "session": {title: "chrome.storage.session"},
    "managed": {title: "chrome.storage.managed", readonly: true},
    "localStorage": {title: "window.localStorage", stringOnly: true},
    "sessionStorage": {title: "window.sessionStorage", stringOnly: true}
};

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (!bytes) return '';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function renderTabs() {
    const tabsContainer = document.getElementById('tabs');
    if (!tabsContainer) return;

    tabsContainer.innerHTML = '';
    storageDescriptors.forEach(desc => {
        if (desc.readonly && stats[desc.name] && stats[desc.name].count === 0) return;

        const li = document.createElement('li');
        li.className = currentType === desc.name ? 'active' : '';
        li.addEventListener('click', () => setType(desc));

        const a = document.createElement('a');
        a.style.height = '40px';

        let usageHtml = '';
        const s = stats[desc.name] || { bytesInUse: 0, count: 0 };
        const m = meta[desc.name];

        if (desc.name === 'local' || desc.name === 'session') {
            usageHtml = s.count > 0 ? `${formatBytes(s.bytesInUse)} / ${formatBytes(m ? m.QUOTA_BYTES : 0)}` : 'area is empty';
        } else if (desc.name === 'sync') {
            usageHtml = s.count > 0 ? `${formatBytes(s.bytesInUse)} / ${formatBytes(m ? m.QUOTA_BYTES : 0)}, ${s.count} / ${m ? m.MAX_ITEMS : 0} items` : 'area is empty';
        } else if (desc.stringOnly || desc.readonly) {
            usageHtml = s.count > 0 ? `${s.count} items` : 'area is empty';
        }

        const titleDiv = document.createElement('div');
        titleDiv.textContent = desc.title;
        const usageDiv = document.createElement('div');
        usageDiv.className = 'usage';
        usageDiv.textContent = usageHtml;

        a.appendChild(titleDiv);
        a.appendChild(usageDiv);
        li.appendChild(a);
        tabsContainer.appendChild(li);
    });
}

function renderResults() {
    const listContent = document.getElementById('list-content');
    if (!listContent || mode !== 'list') return;

    listContent.innerHTML = '';

    if (results.length === 0) {
        const noItems = document.createElement('div');
        noItems.style.paddingTop = '20px';
        const h3 = document.createElement('h3');
        h3.textContent = 'No Items in this area';
        noItems.appendChild(h3);
        if (currentDescriptor && currentDescriptor.readonly) {
            const h4 = document.createElement('h4');
            h4.textContent = 'Managed area is always readonly.';
            noItems.appendChild(h4);
        }
        listContent.appendChild(noItems);
        return;
    }

    const table = document.createElement('table');
    table.className = 'table table-striped table-hover';
    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    trHead.className = 'list-row';
    ['Key', 'Value', ''].forEach((text, i) => {
        const th = document.createElement('th');
        if (i === 1) th.width = '100%';
        th.textContent = text;
        trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    results.forEach(result => {
        const tr = document.createElement('tr');
        tr.className = 'list-row';

        const tdKey = document.createElement('td');
        const spanKey = document.createElement('span');
        spanKey.className = 'valueKey';
        spanKey.textContent = result.name;
        tdKey.appendChild(spanKey);
        if (!currentDescriptor.stringOnly) {
            const divUsage = document.createElement('div');
            divUsage.className = 'usage';
            let usageText = formatBytes(result.bytesInUse);
            if (currentType === 'sync') {
                usageText += ' / ' + formatBytes(meta.sync ? meta.sync.QUOTA_BYTES_PER_ITEM : 0);
            }
            divUsage.textContent = usageText;
            tdKey.appendChild(divUsage);
        }

        const tdValue = document.createElement('td');
        const divValue = document.createElement('div');
        divValue.className = 'displayedValue';
        const displayValue = currentDescriptor.stringOnly ? result.value : JSON.stringify(result.value, null, 2);
        divValue.textContent = displayValue;
        divValue.title = displayValue;
        tdValue.appendChild(divValue);

        const tdActions = document.createElement('td');
        tdActions.style.whiteSpace = 'nowrap';
        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-default btn-xs';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => editItem(result.name));
        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-danger btn-xs';
        delBtn.textContent = 'Del';
        delBtn.addEventListener('click', () => deleteItem(result.name));
        tdActions.appendChild(editBtn);
        tdActions.appendChild(delBtn);

        tr.appendChild(tdKey);
        tr.appendChild(tdValue);
        tr.appendChild(tdActions);
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    listContent.appendChild(table);
}

let renderTimeout = null;
function throttledRenderResults() {
    if (renderTimeout) return;
    renderTimeout = setTimeout(() => {
        renderResults();
        renderTimeout = null;
    }, 100);
}

function renderEditPanel() {
    const keyInput = document.getElementById('key-input');
    const valueInput = document.getElementById('value-input');
    const validationMsg = document.getElementById('validation-msg');

    keyInput.value = editObject.key;
    valueInput.value = editObject.value;
    validationMsg.textContent = '';
}

function refreshView() {
    const listPanel = document.getElementById('list-panel');
    const editPanel = document.getElementById('edit-panel');

    if (mode === 'list') {
        listPanel.style.display = 'block';
        editPanel.style.display = 'none';
        renderResults();
    } else {
        listPanel.style.display = 'none';
        editPanel.style.display = 'block';
        renderEditPanel();
    }
    renderTabs();
}

function setType(descriptor) {
    currentType = descriptor.name;
    currentDescriptor = descriptor;
    mode = 'list';
    refreshView();
    loadStorageData();
}

function loadStorageData() {
    const storage = getStorage();
    if (!storage || !currentType) return;

    storage[currentType].get(function (res) {
        rawData = res;
        adaptRawData();
        refreshStats();
        renderResults();
    });
}

function adaptRawData() {
    results = Object.keys(rawData).map(key => ({
        name: key,
        value: rawData[key],
        bytesInUse: 0
    }));

    results.sort((a, b) => a.name.localeCompare(b.name));
}

function calculateSize(obj) {
    return new Blob([JSON.stringify(obj)]).size;
}

function refreshStats() {
    const storage = getStorage();
    if (!storage) return;

    results.slice(0, 40).forEach(result => {
        storage[currentType].getBytesInUse(result.name, function (amount) {
            // Fallback for session storage or if API returns 0
            if (amount === 0 && rawData[result.name] !== undefined) {
                amount = calculateSize(rawData[result.name]);
            }
            result.bytesInUse = amount;
            throttledRenderResults();
        });
    });

    storageDescriptors.forEach(desc => {
        const type = desc.name;
        storage[type].get(function(obj){
            if (!stats[type]) stats[type] = {};
            const keys = Object.keys(obj);
            stats[type].count = keys.length;

            storage[type].getBytesInUse(function (bytes) {
                if (bytes === 0 && stats[type].count > 0) {
                    stats[type].bytesInUse = calculateSize(obj);
                } else {
                    stats[type].bytesInUse = bytes;
                }
                renderTabs();
            });
        });
    });
}

function onStorageChanged(change) {
    if (currentType === change.type) {
        const specialStorages = ["localStorage", "sessionStorage"];
        if (change.changes === "clear" && specialStorages.includes(change.type)) {
            rawData = {};
        } else {
            Object.keys(change.changes).forEach(key => {
                const val = change.changes[key];
                if (specialStorages.includes(change.type)) {
                    if (key === "") {
                        rawData = {};
                    } else {
                        if (val.newValue === null) {
                            delete rawData[key];
                        } else {
                            rawData[key] = val.newValue;
                        }
                    }
                } else {
                    if (val.hasOwnProperty('newValue')) {
                        rawData[key] = val.newValue;
                    } else {
                        delete rawData[key];
                    }
                }
            });
        }
        adaptRawData();
        refreshStats();
        renderResults();
    }
}

function addItem() {
    mode = 'add';
    editObject = { key: '', value: '' };
    refreshView();
}

function editItem(key) {
    mode = 'edit';
    editObject.key = key;
    let value = rawData[key];
    if (!currentDescriptor.stringOnly) {
        editObject.value = typeof value === 'object' ? JSON.stringify(value, null, 2) : JSON.stringify(value);
    } else {
        editObject.value = value;
    }
    refreshView();
}

function deleteItem(key) {
    if (confirm("Are you sure?")) {
        getStorage()[currentType].remove(key);
    }
}

function clearAll() {
    if (confirm("Are you sure you want to clear all data in this area?")) {
        getStorage()[currentType].clear();
    }
}

function saveItem() {
    const key = document.getElementById('key-input').value;
    const valueStr = document.getElementById('value-input').value;
    const validationMsg = document.getElementById('validation-msg');

    let value;
    if (!currentDescriptor.stringOnly) {
        try {
            value = JSON.parse(valueStr);
        } catch (e) {
            validationMsg.textContent = "Invalid JSON: " + e.message;
            return;
        }
    } else {
        value = valueStr;
    }

    const update = {};
    update[key] = value;
    getStorage()[currentType].set(update, function() {
        mode = 'list';
        refreshView();
    });
}

function cancelEdit() {
    mode = 'list';
    refreshView();
}

function reloadPage() {
    chrome.devtools.inspectedWindow.reload();
    window.location.reload();
}

function exportToFile() {
    fileService.download(currentType + ".json", JSON.stringify(rawData, null, 2));
}

function exportToClipboard() {
    clipboard.copy(JSON.stringify(rawData, null, 2));
}

function importFromFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = e => {
        const file = e.target.files[0];
        fileService.read(file).then(content => {
            try {
                const data = JSON.parse(content);
                getStorage()[currentType].clear(() => {
                    getStorage()[currentType].set(data);
                });
            } catch (err) {
                alert("Failed to parse JSON file");
            }
        });
    };
    input.click();
}

function importFromClipboard() {
    clipboard.paste().then(content => {
        try {
            const data = JSON.parse(content);
            getStorage()[currentType].clear(() => {
                getStorage()[currentType].set(data);
            });
        } catch (err) {
            alert("Failed to parse JSON from clipboard");
        }
    });
}

function initApp() {
    initStorage(onStorageChanged);

    // Add event listeners for static elements
    document.getElementById('add-btn').addEventListener('click', addItem);
    document.getElementById('clear-btn').addEventListener('click', clearAll);
    document.getElementById('refresh-btn').addEventListener('click', reloadPage);
    document.getElementById('export-file-btn').addEventListener('click', exportToFile);
    document.getElementById('export-clip-btn').addEventListener('click', exportToClipboard);
    document.getElementById('import-file-btn').addEventListener('click', importFromFile);
    document.getElementById('import-clip-btn').addEventListener('click', importFromClipboard);
    document.getElementById('save-btn').addEventListener('click', saveItem);
    document.getElementById('cancel-btn').addEventListener('click', cancelEdit);

    appContext().then(appInfo => {
        storageDescriptors = [];
        stats = {};
        meta = {};

        const storage = getStorage();
        appInfo.storageTypes.forEach(type => {
            stats[type] = { bytesInUse: 0, count: 0 };
            if (["sync", "local", "session"].includes(type)) {
                storage[type].getMeta().then(m => {
                    meta[type] = m;
                    renderTabs();
                });
            }

            const descriptor = Object.assign({ name: type }, descriptors[type]);
            storageDescriptors.push(descriptor);

            if (!currentType) {
                currentType = type;
                currentDescriptor = descriptor;
            }
        });

        refreshView();
        loadStorageData();
    }).catch(err => {
        console.error("initApp error", err);
        document.body.innerHTML = '<h3>Explorer is disabled on normal web pages or extensions without storage permission</h3>';
    });
}

document.addEventListener('DOMContentLoaded', initApp);
