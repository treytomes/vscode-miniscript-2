// e2e/run.js — the editor half of the suite. `npm test` checks the same providers against a
// stub `vscode`; this launches a real VS Code with this folder as the development extension
// and e2e/fixtures as the workspace, so the wiring those tests cannot see is exercised too:
// that activate() registers the providers it claims, that a `.ms` file is treated as
// MiniScript, and that each answer arrives through the editor's own command for it.
//
// It is a separate script because it needs an editor, a display (or xvfb-run) and a VS Code
// download, none of which `node --test` should require.
const path = require("node:path");
const { runTests } = require("@vscode/test-electron");

async function main() {
	await runTests({
		extensionDevelopmentPath: path.resolve(__dirname, ".."),
		extensionTestsPath: path.resolve(__dirname, "suite.js"),
		launchArgs: [
			path.resolve(__dirname, "fixtures"),
			// Only this extension is loaded, and no sandbox or GPU is needed to answer questions.
			"--disable-extensions",
			"--no-sandbox",
			"--disable-gpu",
		],
	});
}

main().catch((error) => {
	console.error("The editor smoke test failed:", error);
	process.exit(1);
});
