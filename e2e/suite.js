// e2e/suite.js — what @vscode/test-electron calls inside the extension host. Mocha runs
// e2e/smoke.js there, where `require("vscode")` is the real editor.
const path = require("node:path");
const Mocha = require("mocha");

exports.run = function run() {
	const mocha = new Mocha({ ui: "tdd", timeout: 20000, color: false });
	mocha.addFile(path.resolve(__dirname, "smoke.js"));
	return new Promise((resolve, reject) => {
		mocha.run((failures) =>
			failures
				? reject(new Error(`${failures} editor check${failures === 1 ? "" : "s"} failed`))
				: resolve()
		);
	});
};
