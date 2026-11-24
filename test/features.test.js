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
	hover: undefined,
	definition: undefined,
	outline: undefined,
	completion: undefined,
	signature: undefined,
	triggers: {},
	events: {},
	files: new Set(),
	modules: new Map(),
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
		constructor(value) {
			this.value = value || "";
		}
		appendCodeblock(code) {
			this.value += `${code}\n`;
			return this;
		}
		appendMarkdown(text) {
			this.value += text;
			return this;
		}
	},
	CompletionItemKind: { Method: 0, Function: 1, Property: 2, Variable: 5, Class: 6, Module: 7 },
	CompletionItem: class {
		constructor(label, kind) {
			Object.assign(this, { label, kind });
		}
	},
	SignatureHelp: class {
		constructor() {
			Object.assign(this, { signatures: [], activeSignature: 0, activeParameter: 0 });
		}
	},
	SignatureInformation: class {
		constructor(label, documentation) {
			Object.assign(this, { label, documentation, parameters: [] });
		}
	},
	ParameterInformation: class {
		constructor(label) {
			Object.assign(this, { label });
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
		registerHoverProvider: (selector, provider) => {
			opened.hover = provider;
			return disposable();
		},
		registerDefinitionProvider: (selector, provider) => {
			opened.definition = provider;
			return disposable();
		},
		registerDocumentSymbolProvider: (selector, provider) => {
			opened.outline = provider;
			return disposable();
		},
		registerCompletionItemProvider: (selector, provider, ...triggers) => {
			opened.completion = provider;
			opened.triggers.completion = triggers;
			return disposable();
		},
		registerSignatureHelpProvider: (selector, provider, ...triggers) => {
			opened.signature = provider;
			opened.triggers.signature = triggers;
			return disposable();
		},
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
		fs: { readFile: async (uri) => Buffer.from(opened.modules.get(uri.fsPath) || "") },
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
	opened.triggers = {};
	features.register({ subscriptions: [] });
	return opened.collection;
}

function document(text, name = "demo", scheme = "file") {
	let value = text;
	const extension = scheme === "file" ? "ms" : "msnb";
	const line = (number) => value.split(/\r?\n/)[number] || "";
	return {
		languageId: "miniscript",
		version: 1,
		get lineCount() {
			return value.split(/\r?\n/).length;
		},
		uri: {
			scheme,
			fsPath: `/work/${name}.${extension}`,
			toString: () => `${scheme}:/work/${name}.${extension}`,
		},
		getText: (range) =>
			range ? line(range.start.line).slice(range.start.character, range.end.character) : value,
		lineAt: (number) => ({ text: line(number) }),
		offsetAt: (position) => {
			let offset = 0;
			for (let number = 0; number < position.line; number += 1) offset += line(number).length + 1;
			return offset + position.character;
		},
		getWordRangeAtPosition: (position, pattern) => {
			for (const match of line(position.line).matchAll(new RegExp(pattern.source, "g"))) {
				const start = match.index;
				const end = start + match[0].length;
				if (position.character >= start && position.character <= end) {
					return {
						start: { line: position.line, character: start },
						end: { line: position.line, character: end },
					};
				}
			}
			return undefined;
		},
		set(next) {
			value = next;
			this.version += 1;
		},
	};
}

// A notebook cell is a document under the scheme VS Code gives one, with the language the
// notebook's own cells are made with.
function cell(text) {
	return document(text, "cell", "vscode-notebook-cell");
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

function labels(items) {
	return items.map((item) => item.label);
}

function completionAt(doc, line, character) {
	return opened.completion.provideCompletionItems(doc, { line, character });
}

function helpAt(doc, line, character) {
	return opened.signature.provideSignatureHelp(doc, { line, character });
}

test("completion offers the names in scope, the enclosing function's own first", async () => {
	activate();
	const doc = document(
		[
			"count = 0",
			"outer = function(thing)",
			"\tlocal = 1",
			"\treturn local",
			"end function",
			"other = function()",
			"\tsecond = 2",
			"\treturn second",
			"end function",
		].join("\n")
	);

	const inside = labels(await completionAt(doc, 3, 13));
	assert.ok(inside.includes("local"), "the function's own name");
	assert.ok(inside.includes("thing"), "a parameter is a name here");
	assert.ok(inside.includes("count"), "the file's top level is in scope too");
	assert.ok(!inside.includes("second"), "another function's local is not");

	const outside = labels(await completionAt(doc, 0, 5));
	assert.ok(outside.includes("count"));
	assert.ok(!outside.includes("local"));
});

test("a member is completed from the receiver's type", async () => {
	activate();
	const string = document(['s = "hi"', "xs = [1]", "print s."].join("\n"));
	const members = labels(await completionAt(string, 2, 8));
	assert.ok(members.includes("upper"));
	assert.ok(members.includes("split"));
	assert.ok(!members.includes("push"), "push belongs to a list");

	const list = document(['s = "hi"', "xs = [1]", "print xs."].join("\n"));
	const listMembers = labels(await completionAt(list, 2, 9));
	assert.ok(listMembers.includes("push"));
	assert.ok(listMembers.includes("len"));
	assert.ok(!listMembers.includes("upper"));
});

test("a receiver the language ships completes from its own members", async () => {
	activate();
	const doc = document("print file.");
	const members = labels(await completionAt(doc, 0, 11));
	assert.ok(members.includes("readLines"));
	assert.ok(members.includes("exists"));
});

test("a class completes the methods the file gave it", async () => {
	activate();
	const doc = document(
		[
			'Shape = {"sides": 0}',
			"Shape.degrees = function",
			"\treturn 1",
			"end function",
			"print Shape.",
		].join("\n")
	);
	const members = labels(await completionAt(doc, 4, 12));
	assert.ok(members.includes("degrees"));
});

test("an imported module completes through its alias", async () => {
	opened.files.add("lib");
	opened.modules.set(
		"/work/lib.ms",
		["helper = function(x)", "\treturn x", "end function", "value = 1"].join("\n")
	);
	activate();
	const doc = document('import "lib"\nprint lib.');
	const items = await completionAt(doc, 1, 10);
	assert.deepEqual(labels(items).sort(), ["helper", "value"]);
	assert.equal(items.find((item) => item.label === "helper").detail, "helper(x)");
});

test("a name in a string or a comment is not completed", async () => {
	activate();
	assert.equal(await completionAt(document('print "xs."'), 0, 10), undefined);
	assert.equal(await completionAt(document("// xs."), 0, 6), undefined);
});

test("the providers ask to be told about a dot and a call's characters", () => {
	activate();
	assert.deepEqual(opened.triggers.completion, ["."]);
	assert.deepEqual(opened.triggers.signature, ["(", ","]);
});

test("a call's parameters are shown, with the one being written active", async () => {
	activate();
	const doc = document(
		["add = function(a, b=2)", "\treturn a + b", "end function", "add(1, "].join("\n")
	);
	const help = await helpAt(doc, 3, 7);
	assert.equal(help.signatures.length, 1);
	assert.equal(help.signatures[0].label, "add(a, b=2)");
	assert.deepEqual(
		help.signatures[0].parameters.map((parameter) => parameter.label),
		["a", "b=2"]
	);
	assert.equal(help.activeParameter, 1);
});

test("an intrinsic's parameters come from the language's own signature", async () => {
	activate();
	const doc = document(['s = "hi"', "print s.split("].join("\n"));
	const help = await helpAt(doc, 1, 14);
	assert.equal(help.signatures[0].label, 's.split(delimiter=" ", maxCount=null)');
	assert.deepEqual(
		help.signatures[0].parameters.map((parameter) => parameter.label),
		['delimiter=" "', "maxCount=null"]
	);
	assert.equal(help.activeParameter, 0);

	const next = document(['s = "hi"', 'print s.split(",", '].join("\n"));
	const second = await helpAt(next, 1, 19);
	assert.equal(second.activeParameter, 1);
});

test("an argument's own call does not move the outer call's parameter", async () => {
	activate();
	const help = await helpAt(document("print(abs(-1), "), 0, 16);
	assert.ok(help.signatures[0].label.startsWith("print("));
	assert.equal(help.signatures[0].parameters.length, 2);
	assert.equal(help.activeParameter, 1);
});

test("no parameters are shown outside a call", async () => {
	activate();
	assert.equal(await helpAt(document("print 1"), 0, 7), undefined);
});

test("a call whose arguments wrap keeps its parameters", async () => {
	activate();
	const doc = document(
		[
			"box = function(width, height, depth=1)",
			"\treturn width * height * depth",
			"end function",
			"box(1,",
			"\t2,",
			"\t",
		].join("\n")
	);
	const help = await helpAt(doc, 5, 1);
	assert.equal(help.signatures[0].label, "box(width, height, depth=1)");
	assert.deepEqual(
		help.signatures[0].parameters.map((parameter) => parameter.label),
		["width", "height", "depth=1"]
	);
	assert.equal(help.activeParameter, 2, "the comma on the line above counts");
});

test("a wrapped argument's own call does not move the outer parameter", async () => {
	activate();
	const doc = document(["print(", "\tabs(-1),", "\t"].join("\n"));
	const help = await helpAt(doc, 2, 1);
	assert.ok(help.signatures[0].label.startsWith("print("));
	assert.equal(help.activeParameter, 1);
});

test("the call is the innermost one still open, across lines", async () => {
	activate();
	const doc = document(
		[
			"add = function(a, b=2)",
			"\treturn a + b",
			"end function",
			"add(1)",
			"// add(2,",
			"add(",
			"\t",
		].join("\n")
	);
	const help = await helpAt(doc, 6, 1);
	assert.equal(help.signatures[0].label, "add(a, b=2)");
	assert.equal(help.activeParameter, 0);
});

test("a parenthesis inside a string does not close the call", async () => {
	activate();
	const doc = document(
		["add = function(a, b=2)", "\treturn a", "end function", 'add(")",', "\t"].join("\n")
	);
	const help = await helpAt(doc, 4, 1);
	assert.equal(help.signatures[0].label, "add(a, b=2)");
	assert.equal(help.activeParameter, 1);
});

// A notebook cell is a document under a scheme of its own, so each provider is asked for
// one, the same way it is asked for a file.
test("hover works inside a notebook cell", async () => {
	activate();
	const doc = cell(
		[
			"// Adds two numbers.",
			"add = function(a, b=2)",
			"\treturn a + b",
			"end function",
			"print add(1)",
		].join("\n")
	);

	const hover = await opened.hover.provideHover(doc, { line: 4, character: 7 });
	assert.match(hover.contents.value, /add\(a, b=2\)/);
	assert.match(hover.contents.value, /Adds two numbers\./);
	assert.deepEqual(hover.range.start, { line: 4, character: 6 });
});

test("Ctrl-click works inside a notebook cell", async () => {
	activate();
	const doc = cell(
		["add = function(a)", "\treturn a", "end function", "print add(1)"].join("\n")
	);

	const locations = await opened.definition.provideDefinition(doc, { line: 3, character: 7 });
	assert.equal(locations.length, 1);
	assert.equal(locations[0].uri, doc.uri);
	assert.deepEqual(locations[0].range.start, { line: 0, character: 0 });
});

test("the Outline lists a notebook cell's symbols", async () => {
	activate();
	const doc = cell(
		[
			'Shape = {"sides": 0}',
			"Shape.degrees = function",
			"\treturn 1",
			"end function",
			"count = 0",
		].join("\n")
	);

	const symbols = opened.outline.provideDocumentSymbols(doc);
	assert.deepEqual(
		symbols.map((symbol) => symbol.name),
		["Shape", "count"]
	);
	assert.equal(symbols[0].kind, vscode.SymbolKind.Class);
	assert.deepEqual(
		symbols[0].children.map((child) => child.name),
		["degrees"]
	);
});

test("diagnostics are published for a notebook cell", async () => {
	const collection = activate();
	const doc = cell('s = "hi"\nprint s.lengh');
	await opened.events.onDidOpenTextDocument(doc);

	const [found] = published(collection, doc);
	assert.equal(found.code, "unknown-member");
	assert.equal(found.severity, vscode.DiagnosticSeverity.Warning);
	assert.deepEqual(found.range.start, { line: 1, character: 8 });
});

test("completion works inside a notebook cell", async () => {
	activate();
	const doc = cell(['s = "hi"', "print s."].join("\n"));
	const members = labels(await completionAt(doc, 1, 8));
	assert.ok(members.includes("upper"));
});

test("signature help works inside a notebook cell", async () => {
	activate();
	const doc = cell(
		["add = function(a, b=2)", "\treturn a + b", "end function", "add(1,"].join("\n")
	);
	const help = await helpAt(doc, 3, 6);
	assert.equal(help.signatures[0].label, "add(a, b=2)");
	assert.equal(help.activeParameter, 1);
});

test("a markdown cell is left alone", async () => {
	const collection = activate();
	const doc = cell("s.lengh");
	doc.languageId = "markdown";
	await opened.events.onDidOpenTextDocument(doc);

	assert.equal(collection.entries.has(doc.uri.toString()), false);
});
