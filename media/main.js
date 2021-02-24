/* eslint-disable no-undef */

alert("main.js -1");

// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {
    console.log("main.js 0");

    /** @type {HTMLIFrameElement} */
    const frame = document.querySelector(".fiddle-frame");
    
    console.log("main.js load", frame);

  frame.addEventListener("message", (e) => {
    const data = e.data;

    // eslint-disable-next-line no-undef
    console.log("message", data);

    if (data) {
      if (data.type === "builder.editorLoaded") {
        // Loaded - message down the data
        vscode.postMessage({
          type: "builder.editorLoaded",
        });
      }

      if (data.type === "builder.editorDataUpdated") {
        // Loaded - data updated
        vscode.postMessage({
          type: "builder.editorDataUpdated",
          data: data.data,
        });
      }
    }
  });

  window.addEventListener("message", (e) => {
    const data = e.data;

    console.log("message", data, e);

    if (data) {
      if (data.type === "builder.textChanged") {
        frame.contentWindow.postMessage({
          type: "builder.updateEditorData",
          data: { data: data.data.builderJson },
        });
      }
    }
  });
})();
