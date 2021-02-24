import {
  builderContentToJsxLiteComponent,
  componentToBuilder,
  componentToJsxLite,
  parseJsx,
} from "@jsx-lite/core";
import * as vscode from "vscode";
import { BuilderJSXLiteEditorProvider } from "./builder-jsx-lite-editor";
import { useBeta, useDev } from "./config";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("builder.start", () => {
      BuilderPanel.createOrShow(context.extensionUri);
    })
  );

  function openPreviewToTheSide(uri?: vscode.Uri) {
    let resource = uri;
    if (!(resource instanceof vscode.Uri)) {
      if (vscode.window.activeTextEditor) {
        // we are relaxed and don't check for markdown files
        resource = vscode.window.activeTextEditor.document.uri;
      }
    }
    BuilderPanel.openEditor(resource!, vscode.window.activeTextEditor!, {
      viewColumn: vscode.ViewColumn.Two,
      preserveFocus: true,
    });
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "builder.openJsxLiteEditorToTheSide",
      openPreviewToTheSide
    )
  );

  context.subscriptions.push(BuilderJSXLiteEditorProvider.register(context));

  if (vscode.window.registerWebviewPanelSerializer) {
    // Make sure we register a serializer in activation event
    vscode.window.registerWebviewPanelSerializer(BuilderPanel.viewType, {
      async deserializeWebviewPanel(
        webviewPanel: vscode.WebviewPanel,
        state: any
      ) {
        BuilderPanel.revive(webviewPanel, context.extensionUri);
      },
    });
  }
}

class BuilderPanel {
  /**
   * Track the currently panel. Only allow a single panel to exist at a time.
   */
  public static currentPanel: BuilderPanel | undefined;

  public static readonly viewType = "catCoding";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static openEditor(
    sourceUri: vscode.Uri,
    editor: vscode.TextEditor,
    viewOptions: { viewColumn: vscode.ViewColumn; preserveFocus?: boolean }
  ) {
    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      BuilderPanel.viewType,
      "Builder.io",
      viewOptions,
      {
        // Enable javascript in the webview
        enableScripts: true,

        // And restrict the webview to only loading content from our extension's `media` directory.
        localResourceRoots: [vscode.Uri.joinPath(sourceUri, "media")],
      }
    );

    BuilderPanel.currentPanel = new BuilderPanel(panel, sourceUri, editor);
  }

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it.
    if (BuilderPanel.currentPanel) {
      BuilderPanel.currentPanel._panel.reveal(column);
      return;
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      BuilderPanel.viewType,
      "Builder.io",
      column || vscode.ViewColumn.One,
      {
        // Enable javascript in the webview
        enableScripts: true,

        // And restrict the webview to only loading content from our extension's `media` directory.
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      }
    );

    BuilderPanel.currentPanel = new BuilderPanel(panel, extensionUri);
  }

  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    BuilderPanel.currentPanel = new BuilderPanel(panel, extensionUri);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private editor?: vscode.TextEditor
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    // Set the webview's initial html content
    this._update();

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Update the content based on view changes
    this._panel.onDidChangeViewState(
      (e) => {
        if (this._panel.visible) {
          this._update();
        }
      },
      null,
      this._disposables
    );

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.type) {
          case "builder.editorLoaded": {
            const text = this.editor!.document.getText();

            const parsed = parseJsx(text);
            const builderContent = componentToBuilder(parsed);

            this._panel.webview.postMessage({
              type: "builder.textChanged",
              data: {
                builderJson: builderContent,
              },
            });
            // Get current text and post down
            return;
          }

          case "builder.saveContent": {
            const content = message.data.content;
            if (typeof content?.data?.blocksString === "string") {
              content.data.blocks = JSON.parse(content.data.blocksString);
              delete content.data.blocksString;
            }

            const jsxLiteJson = builderContentToJsxLiteComponent(content);
            const jsxLite = componentToJsxLite(jsxLiteJson);

            const edit = new vscode.WorkspaceEdit();
            const document = this.editor!.document;
            edit.replace(
              document.uri,
              new vscode.Range(0, 0, document.lineCount, 0),
              jsxLite
            );

            vscode.workspace.applyEdit(edit);
            document.save();
            return;
          }
        }
      },
      null,
      this._disposables
    );

    if (this.editor) {
      this._disposables.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
          // const text = event.document.getText();
          // const parsed = parseJsx(text);
          // const builderContent = componentToBuilder(parsed);
          // this._panel.webview.postMessage({
          //   type: "builder.textChanged",
          //   data: {
          //     builderJson: builderContent,
          //   },
          // });
        })
      );
      this._disposables.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
          const text = document.getText();

          const parsed = parseJsx(text);
          const builderContent = componentToBuilder(parsed);

          this._panel.webview.postMessage({
            type: "builder.textChanged",
            data: {
              builderJson: builderContent,
            },
          });
          console.info("save");
        })
      );
      this._disposables.push(
        vscode.window.onDidChangeTextEditorSelection((event) => {
          // TODO: sync text cursor/selection with builder scroll/selection
          console.info("selection change", event);
        })
      );
      this._disposables.push(
        vscode.window.onDidChangeActiveTextEditor((event) => {
          console.info("active editor change", event);
        })
      );
    }
  }

  public doRefactor() {
    // Send a message to the webview webview.
    // You can send any JSON serializable data.
    this._panel.webview.postMessage({ command: "refactor" });
  }

  public dispose() {
    BuilderPanel.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _update() {
    const webview = this._panel.webview;

    this._updateWebview(webview);
  }

  private _updateWebview(webview: vscode.Webview) {
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    // Local path to main script run in the webview
    const scriptPathOnDisk = vscode.Uri.joinPath(
      this._extensionUri,
      "media",
      "main.js"
    );

    // And the uri we use to load this script in the webview
    const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

    // Local path to css styles
    const styleResetPath = vscode.Uri.joinPath(
      this._extensionUri,
      "media",
      "reset.css"
    );
    const stylesPathMainPath = vscode.Uri.joinPath(
      this._extensionUri,
      "media",
      "vscode.css"
    );

    // Uri to load styles into webview
    const stylesResetUri = webview.asWebviewUri(styleResetPath);
    const stylesMainUri = webview.asWebviewUri(stylesPathMainPath);

    // Use a nonce to only allow specific scripts to be run
    const nonce = getNonce();

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${
          useDev ? "*" : "https://*"
        }; style-src https://* ${webview.cspSource} 'nonce-${nonce}'; img-src ${
      webview.cspSource
    } https:; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${stylesResetUri}" rel="stylesheet">
				<link href="${stylesMainUri}" rel="stylesheet">

				<title>Builder.io</title>
			</head>
			<body>
        <style nonce="${nonce}"> 
          .fiddle-frame {
            border: none;
            position: absolute;
            top: -10%;
            left: -10%;
            right: -10%;
            bottom: -10%;	
            width: 120%;
            height: 120%;
            transform: scale(0.8333);
          }
        </style>
				<iframe class="fiddle-frame" src="${
          useDev
            ? "http://localhost:1234"
            : useBeta
            ? "https://beta.builder.io"
            : "https://builder.io"
        }/fiddle"></iframe>

				<script nonce="${nonce}">
          /* eslint-disable no-undef */
          const vscode = acquireVsCodeApi();
          
          // This script will be run within the webview itself
          // It cannot access the main VS Code APIs directly.
          (function () {
            /** @type {HTMLIFrameElement} */
            const frame = document.querySelector(".fiddle-frame");
              
            window.addEventListener("message", (e) => {
              const data = e.data;
          
              if (data) {
                if (data.type === "builder.textChanged") {
                  frame.contentWindow.postMessage({
                    type: "builder.updateEditorData",
                    data: { data: data.data.builderJson }
                  }, '*');
                }

                if (data.type === "builder.editorLoaded") {
                  // Loaded - message down the data
                  vscode.postMessage({
                    type: "builder.editorLoaded"
                  });
                }
          
                if (data.type === "builder.saveContent") {
                  // Loaded - data updated
                  vscode.postMessage({
                    type: "builder.saveContent",
                    data: data.data
                  });
                }
              }
            });
          })();
        </script>
			</body>
		</html>`;
  }
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
