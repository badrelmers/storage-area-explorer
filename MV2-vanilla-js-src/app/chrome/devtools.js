if (chrome.devtools && chrome.devtools.panels) {
    chrome.devtools.panels.create(
        "Storage Explorer",
        "",
        "/app/html/panel.html"
    );
}
