// e2e/smoke.js — one check per answer the extension gives, asked of the editor instead of
// the providers' own functions: a hover, a completion after a dot, a diagnostic the file
// earns on open, and a semantic token. They read e2e/fixtures/smoke.ms.
const assert = require("node:assert/strict");
const path = require("node:path");
const vscode = require("vscode");

const FIXTURE = path.resolve(__dirname, "fixtures", "smoke.ms");
const WAIT = 10000;

let document;

// Answers the editor produces on its own schedule - a diagnostic after the file opens - are
// waited for rather than assumed to be there on the next line of the test.
async function until(answer, what) {
	const started = Date.now();
	while (Date.now() - started < WAIT) {
		const found = await answer();
		if (found) return found;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`waited ${WAIT}ms for ${what}`);
}

function textOf(hover) {
	return hover.contents
		.map((content) => (typeof content === "string" ? content : content.value))
		.join("\n");
}

// SemanticTokens are five numbers per token, each relative to the token before it.
function decode(tokens) {
	const found = [];
	let line = 0;
	let start = 0;
	for (let i = 0; i < tokens.data.length; i += 5) {
		const [deltaLine, deltaStart, length, type, modifiers] = tokens.data.slice(i, i + 5);
		line += deltaLine;
		start = deltaLine ? deltaStart : start + deltaStart;
		found.push({ line, start, length, type, modifiers });
	}
	return found;
}

function labelsOf(list) {
	const items = Array.isArray(list) ? list : list.items;
	return items.map((item) => (typeof item.label === "string" ? item.label : item.label.label));
}

suite("the extension in an editor", () => {
	suiteSetup(async () => {
		const extension = vscode.extensions.getExtension("micro-expert.miniscript2");
		assert.ok(extension, "the extension is installed under the id its package.json names");
		await extension.activate();
		document = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
		await vscode.window.showTextDocument(document);
		assert.equal(document.languageId, "miniscript", "a .ms file is MiniScript");
	});

	test("hover on a call shows the function", async () => {
		const hovers = await vscode.commands.executeCommand(
			"vscode.executeHoverProvider",
			document.uri,
			new vscode.Position(6, 6)
		);
		assert.ok(hovers && hovers.length, "the hover provider answered");
		assert.match(textOf(hovers[0]), /abs\(n\)/, "the signature");
		assert.match(textOf(hovers[0]), /The distance from zero\./, "the docstring");
	});

	test("completion after a dot offers the receiver's members", async () => {
		const list = await vscode.commands.executeCommand(
			"vscode.executeCompletionItemProvider",
			document.uri,
			new vscode.Position(8, 9)
		);
		const labels = labelsOf(list);
		assert.ok(labels.includes("len"), `the list's own member is offered; got ${labels.slice(0, 8)}`);
		assert.ok(labels.includes("push"), "and another");
	});

	test("a misspelt member is a diagnostic on its word", async () => {
		const diagnostic = await until(
			() =>
				vscode.languages
					.getDiagnostics(document.uri)
					.find((each) => /has no member/.test(each.message)),
			"the unknown-member diagnostic"
		);
		assert.equal(document.getText(diagnostic.range), "lengh", "marked on the member, not the line");
		assert.match(diagnostic.message, /`string` has no member `lengh`/);
	});

	test("a name is colored by the semantic tokens", async () => {
		const tokens = await vscode.commands.executeCommand(
			"vscode.provideDocumentSemanticTokens",
			document.uri
		);
		assert.ok(tokens && tokens.data.length, "the token provider answered");
		const declaration = decode(tokens).find((token) => token.line === 1 && token.start === 0);
		assert.ok(declaration, "`abs` is a token");
		assert.equal(declaration.type, 1, "of type function, the legend's second entry");
		assert.equal(declaration.modifiers & 1, 1, "and marked a declaration");
	});
});
