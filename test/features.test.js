// The diagnostics features.js publishes, through a stub `vscode`. The checks themselves
// are lint.js's and are tested there; what is under test here is the wiring - which
// documents are linted, where an import's answer comes from, and what a record becomes.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

function disposable() {
	return { dispose() {} };
}

const opened = {
	collection: undefined,
	events: {},
	files: new Set(),
};

function remember(name, handler) {
	opened.events[name] = handler;
	return disposable();
}

const vscode = {
	DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
	Diagnostic: class {
		constructor(range, message, severity) {
			Object.assign(this, { range, message, severity });
		}
	},
	Range: class {
		constructor(startLine, startCharacter, endLine, endCharacter) {
			this.start = { line: startLine, character: startCharacter };
			this.end = { line: endLine, character: endCharacter };
		}
	},
	SymbolKind: { Function: 11, Method: 5, Class: 4, Variable: 12 },
	MarkdownString: class {
		appendCodeblock() {
			return this;
		}
		appendMarkdown() {
			return this;
		}
	},
	Hover: class {
		constructor(contents, range) {
			Object.assign(this, { contents, range });
		}
	},
	Location: class {
		constructor(uri, range) {
			Object.assign(this, { uri, range });
		}
	},
	DocumentSymbol: class {
		constructor(name, detail, kind, range, selectionRange) {
			Object.assign(this, { name, detail, kind, range, selectionRange });
			this.children = [];
		}
	},
	languages: {
		createDiagnosticCollection: (name) => {
			opened.collection = {
				name,
				entries: new Map(),
				set(uri, found) {
					this.entries.set(uri.toString(), found);
				},
				delete(uri) {
					this.entries.delete(uri.toString());
				},
				clear() {
					this.entries.clear();
				},
				dispose() {
					this.entries.clear();
				},
			};
			return opened.collection;
		},
		registerHoverProvider: () => disposable(),
		registerDefinitionProvider: () => disposable(),
		registerDocumentSymbolProvider: () => disposable(),
	},
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/work" } }],
		textDocuments: [],
		findFiles: async (pattern) => {
			const match = /^\*\*\/(.+)\.ms$/.exec(pattern);
			const name = match ? match[1] : undefined;
			return opened.files.has(name)
				? [{ fsPath: `/work/${name}.ms`, toString: () => `file:///work/${name}.ms` }]
				: [];
		},
		fs: { readFile: async () => Buffer.from("") },
		onDidOpenTextDocument: (handler) => remember("onDidOpenTextDocument", handler),
		onDidChangeTextDocument: (handler) => remember("onDidChangeTextDocument", handler),
		onDidSaveTextDocument: (handler) => remember("onDidSaveTextDocument", handler),
		onDidCloseTextDocument: (handler) => remember("onDidCloseTextDocument", handler),
		onDidCreateFiles: (handler) => remember("onDidCreateFiles", handler),
		onDidDeleteFiles: (handler) => remember("onDidDeleteFiles", handler),
	},
};

const load = Module._load;
Module._load = function (request, ...rest) {
	if (request === "vscode") return vscode;
	return load.call(this, request, ...rest);
};

const features = require("../features.js");

function activate() {
	opened.events = {};
	features.register({ subscriptions: [] });
	return opened.collection;
}

function document(text, name = "demo") {
	let value = text;
	return {
		languageId: "miniscript",
		version: 1,
		uri: {
			scheme: "file",
			fsPath: `/work/${name}.ms`,
			toString: () => `file:///work/${name}.ms`,
		},
		getText: () => value,
		set(next) {
			value = next;
			this.version += 1;
		},
	};
}

function published(collection, doc) {
	return collection.entries.get(doc.uri.toString()) || [];
}

test("a misspelt member is published on the word", async () => {
	const collection = activate();
	const doc = document('s = "hi"\nprint s.lengh');
	await opened.events.onDidOpenTextDocument(doc);

	const [found] = published(collection, doc);
	assert.equal(found.severity, vscode.DiagnosticSeverity.Warning);
	assert.equal(found.code, "unknown-member");
	assert.equal(found.source, "miniscript2");
	assert.deepEqual(found.range.start, { line: 1, character: 8 });
	assert.deepEqual(found.range.end, { line: 1, character: 13 });
});

test("an unclosed block is an error at the line that opened it", async () => {
	const collection = activate();
	const doc = document("if true then\n\tprint 1");
	await opened.events.onDidOpenTextDocument(doc);

	const [found] = published(collection, doc);
	assert.equal(found.severity, vscode.DiagnosticSeverity.Error);
	assert.deepEqual(found.range.start, { line: 0, character: 0 });
});

test("an import is checked against the workspace's files", async () => {
	opened.files.add("found");
	const collection = activate();
	const doc = document('import "found"\nimport "missing"');
	await opened.events.onDidOpenTextDocument(doc);

	const found = published(collection, doc);
	assert.equal(found.length, 1);
	assert.equal(found[0].code, "missing-import");
	assert.deepEqual(found[0].range.start, { line: 1, character: 7 });
});

test("a relative import is looked for beside the file", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miniscript-lint-"));
	const sub = path.join(dir, "sub");
	fs.mkdirSync(sub);
	fs.writeFileSync(path.join(dir, "found.ms"), "// a module\n");

	const collection = activate();
	const doc = document('import "../found"\nimport "../missing"', "rel");
	doc.uri.fsPath = path.join(sub, "rel.ms");
	await opened.events.onDidOpenTextDocument(doc);

	const found = published(collection, doc);
	assert.deepEqual(found.map((problem) => problem.code), ["missing-import"]);
	assert.equal(found[0].message, '`import "../missing"` finds no ../missing.ms.');
	fs.rmSync(dir, { recursive: true, force: true });
});

test("a document that is not MiniScript is left alone", async () => {
	const collection = activate();
	const doc = document("s.lengh", "notes");
	doc.languageId = "markdown";
	await opened.events.onDidOpenTextDocument(doc);

	assert.equal(collection.entries.has(doc.uri.toString()), false);
});

test("a change is linted once the typing settles", async () => {
	const collection = activate();
	const doc = document('s = "hi"');
	await opened.events.onDidOpenTextDocument(doc);
	assert.deepEqual(published(collection, doc), []);

	doc.set('s = "hi"\nprint s.lengh');
	opened.events.onDidChangeTextDocument({ document: doc });
	await new Promise((resolve) => setTimeout(resolve, 400));

	assert.equal(published(collection, doc).length, 1);
});

test("closing a document takes its squiggles with it", async () => {
	const collection = activate();
	const doc = document('s = "hi"\nprint s.lengh');
	await opened.events.onDidOpenTextDocument(doc);
	await opened.events.onDidCloseTextDocument(doc);

	assert.equal(collection.entries.has(doc.uri.toString()), false);
});
