function initializeDevtoolsPage(panels) {
    panels.create(
        "Storage Explorer",
        "screenshots/localStorage.png",
        "panel.html");

}
if (chrome.devtools && chrome.devtools.panels) {
    initializeDevtoolsPage(chrome.devtools.panels);
}
