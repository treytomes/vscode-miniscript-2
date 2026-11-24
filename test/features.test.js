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
		actions: undefined,
		tokens: undefined,
		legend: undefined,
		references: undefined,
		rename: undefined,
		workspaceSymbols: undefined,
		links: undefined,
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
	CodeActionKind: { QuickFix: "quickfix" },
	CodeAction: class {
		constructor(title, kind) {
			Object.assign(this, { title, kind });
			this.edit = undefined;
			this.diagnostics = [];
		}
	},
	WorkspaceEdit: class {
		constructor() {
			this.edits = [];
		}
		replace(uri, range, text) {
			this.edits.push({ uri, range, text });
		}
	},
	SemanticTokensLegend: class {
		constructor(tokenTypes, tokenModifiers) {
			Object.assign(this, { tokenTypes, tokenModifiers });
		}
	},
	SemanticTokensBuilder: class {
		constructor(legend) {
			this.legend = legend;
			this.pushed = [];
		}
		push(line, character, length, tokenType, tokenModifiers) {
			this.pushed.push({ line, character, length, tokenType, tokenModifiers });
		}
		build() {
			return { legend: this.legend, pushed: this.pushed };
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
	SymbolInformation: class {
		constructor(name, kind, containerName, location) {
			Object.assign(this, { name, kind, containerName, location });
		}
	},
	DocumentLink: class {
		constructor(range, target) {
			Object.assign(this, { range, target });
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
		registerCodeActionsProvider: (selector, provider) => {
			opened.actions = provider;
			return disposable();
		},
		registerReferenceProvider: (selector, provider) => {
			opened.references = provider;
			return disposable();
		},
		registerRenameProvider: (selector, provider) => {
			opened.rename = provider;
			return disposable();
		},
		registerWorkspaceSymbolProvider: (provider) => {
			opened.workspaceSymbols = provider;
			return disposable();
		},
		registerDocumentLinkProvider: (selector, provider) => {
			opened.links = provider;
			return disposable();
		},
		registerDocumentSemanticTokensProvider: (selector, provider, legend) => {
			opened.tokens = provider;
			opened.legend = legend;
			return disposable();
		},
	},
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/work" } }],
		textDocuments: [],
		findFiles: async (pattern) => {
			// Either one module by name (`**/lib.ms`) or every file (`**/*.ms`).
			const every = /^\*\*\/\*\.ms$/.test(pattern);
			const match = /^\*\*\/(.+)\.ms$/.exec(pattern);
			const name = match ? match[1] : undefined;
			const wanted = every
				? [...opened.files]
				: name && opened.files.has(name)
					? [name]
					: [];
			return wanted.map((found) => ({
				fsPath: `/work/${found}.ms`,
				toString: () => `file:///work/${found}.ms`,
			}));
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
const { lint } = require("../lint.js");

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

// The text a code action would leave behind, applied by hand: the edit replaces one range
// with its text, which is all any of these actions do.
function applyFix(doc, action) {
	const [edit] = action.edit.edits;
	const lines = doc.getText().split(/\r?\n/);
	const line = lines[edit.range.start.line];
	lines[edit.range.start.line] =
		line.slice(0, edit.range.start.character) + edit.text + line.slice(edit.range.end.character);
	return lines.join("\n");
}

function actionsFor(doc, found) {
	return opened.actions.provideCodeActions(doc, found.range, { diagnostics: [found] });
}

function tokenAt(tokens, line, character) {
	return tokens.pushed.find((token) => token.line === line && token.character === character);
}

function kindOf(tokens, line, character) {
	const token = tokenAt(tokens, line, character);
	return token ? opened.legend.tokenTypes[token.tokenType] : undefined;
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

// Each repair is checked by applying it: the text an action leaves behind must lint clean.
test("a misspelt member's squiggle offers its suggestion", async () => {
	const collection = activate();
	const doc = document('s = "hi"\nprint s.lengh');
	await opened.events.onDidOpenTextDocument(doc);

	const found = published(collection, doc).find((problem) => problem.code === "unknown-member");
	const [action] = await actionsFor(doc, found);
	assert.equal(action.title, "Replace with `len`");
	assert.equal(action.kind, vscode.CodeActionKind.QuickFix);
	assert.equal(action.isPreferred, true);
	assert.deepEqual(action.diagnostics, [found]);

	const [edit] = action.edit.edits;
	assert.deepEqual(edit.range.start, { line: 1, character: 8 });
	assert.deepEqual(edit.range.end, { line: 1, character: 13 });
	assert.equal(edit.text, "len");

	const fixed = applyFix(doc, action);
	assert.equal(fixed, 's = "hi"\nprint s.len');
	assert.deepEqual(lint(fixed), []);
});

test("an unclosed block offers to insert its end", async () => {
	const collection = activate();
	const doc = document(["f = function(a)", "\treturn a"].join("\n"));
	await opened.events.onDidOpenTextDocument(doc);

	const found = published(collection, doc).find((problem) => problem.code === "unclosed-block");
	const [action] = await actionsFor(doc, found);
	assert.equal(action.title, "Insert `end function`");

	const fixed = applyFix(doc, action);
	assert.equal(fixed, "f = function(a)\n\treturn a\nend function");
	assert.deepEqual(lint(fixed), []);
});

test("a block left open inside another is closed above the outer end", async () => {
	const collection = activate();
	const doc = document(["if a then", "\tfor x", "\t\tprint x", "\tend if"].join("\n"));
	await opened.events.onDidOpenTextDocument(doc);

	const found = published(collection, doc).find((problem) => problem.code === "unclosed-block");
	const [action] = await actionsFor(doc, found);
	assert.equal(action.title, "Insert `end for`");

	const fixed = applyFix(doc, action);
	assert.equal(fixed, ["if a then", "\tfor x", "\t\tprint x", "\tend for", "\tend if"].join("\n"));
	assert.deepEqual(lint(fixed), []);
});

test("the fix for an outer block brings the ends still open inside it", async () => {
	const collection = activate();
	const doc = document(["if a then", "\tfor x", "\t\tprint x"].join("\n"));
	await opened.events.onDidOpenTextDocument(doc);

	const broken = published(collection, doc);
	assert.deepEqual(broken.map((problem) => problem.code), ["unclosed-block", "unclosed-block"]);
	const outer = broken.find((problem) => problem.message.startsWith("`if`"));
	const [action] = await actionsFor(doc, outer);
	assert.equal(action.title, "Insert `end if`");

	const fixed = applyFix(doc, action);
	assert.equal(fixed, ["if a then", "\tfor x", "\t\tprint x", "\tend for", "end if"].join("\n"));
	assert.deepEqual(lint(fixed), []);
});

test("a mismatched end offers the end that should come before it", async () => {
	const collection = activate();
	const doc = document(["if a then", "\tprint 1", "end function"].join("\n"));
	await opened.events.onDidOpenTextDocument(doc);

	const found = published(collection, doc).find((problem) => problem.code === "mismatched-end");
	const [action] = await actionsFor(doc, found);
	assert.equal(action.title, "Insert `end if`");

	const fixed = applyFix(doc, action);
	assert.equal(fixed, ["if a then", "\tprint 1", "end if", "end function"].join("\n"));
	assert.deepEqual(
		lint(fixed).map((problem) => problem.code),
		["stray-end"],
		"the wrong end is now the one to correct"
	);
});

// Semantic tokens say what each name is, so the theme can color it for what it is rather
// than for its shape. The tests read the pushed tokens through the legend's own names.
test("semantic tokens tell intrinsics, functions, parameters and classes apart", async () => {
	activate();
	const doc = document(
		[
			'Shape = {"sides": 0}',
			"Shape.degrees = function",
			"\treturn self.sides",
			"end function",
			"add = function(a, b=2)",
			"\treturn a + b",
			"end function",
			"print add(1)",
			's = "hi"',
			"print s.upper",
		].join("\n")
	);

	const tokens = await opened.tokens.provideDocumentSemanticTokens(doc);
	assert.equal(kindOf(tokens, 0, 0), "class");
	assert.equal(tokenAt(tokens, 0, 0).tokenModifiers, 1, "a declaration");
	assert.equal(kindOf(tokens, 1, 0), "class");
	assert.equal(kindOf(tokens, 1, 6), "method");
	assert.equal(tokenAt(tokens, 1, 6).tokenModifiers, 1);
	assert.equal(kindOf(tokens, 4, 0), "function");
	assert.equal(kindOf(tokens, 4, 15), "parameter");
	assert.equal(kindOf(tokens, 4, 18), "parameter");
	assert.equal(kindOf(tokens, 5, 8), "parameter");
	assert.equal(kindOf(tokens, 5, 12), "parameter");
	assert.equal(kindOf(tokens, 7, 0), "intrinsic");
	assert.equal(tokenAt(tokens, 7, 0).tokenModifiers, 2, "the language's own library");
	assert.equal(kindOf(tokens, 7, 6), "function");
	assert.equal(tokenAt(tokens, 7, 6).tokenModifiers, 0);
	assert.equal(kindOf(tokens, 8, 0), "variable");
	assert.equal(kindOf(tokens, 9, 6), "variable");
	assert.equal(kindOf(tokens, 9, 8), "intrinsic");
	assert.equal(kindOf(tokens, 2, 8), undefined, "self is not a name the scan knows");
	assert.equal(kindOf(tokens, 2, 13), undefined, "a map's key is not a symbol");
	assert.equal(tokens.pushed.length, 14);
});

test("the legend says what the token types and modifiers mean", () => {
	activate();
	assert.deepEqual(opened.legend.tokenTypes, [
		"class",
		"function",
		"method",
		"parameter",
		"variable",
		"intrinsic",
	]);
	assert.deepEqual(opened.legend.tokenModifiers, ["declaration", "defaultLibrary"]);
});

test("a notebook cell is colored the same way", async () => {
	activate();
	const doc = cell(["add = function(a)", "\treturn a", "end function", "print add(1)"].join("\n"));
	const tokens = await opened.tokens.provideDocumentSemanticTokens(doc);
	assert.equal(kindOf(tokens, 0, 0), "function");
	assert.equal(kindOf(tokens, 1, 8), "parameter");
	assert.equal(kindOf(tokens, 3, 0), "intrinsic");
	assert.equal(kindOf(tokens, 3, 6), "function");
});

// An instance made with `new` carries its class, so `sq.` and `sq.method` reach the same
// members `Shape.` and `Shape.method` do, with the map's own members still there.
test("completion on an instance offers its class's methods", async () => {
	activate();
	const doc = document(
		[
			'Shape = {"sides": 4}',
			"Shape.degrees = function(times=1)",
			"\treturn times * 45",
			"end function",
			"sq = new Shape",
			"print sq.",
		].join("\n")
	);

	const members = labels(await completionAt(doc, 5, 9));
	assert.ok(members.includes("degrees"), "the class's method");
	assert.ok(members.includes("len"), "an instance is a map too");
});

test("an instance's method has its class's tooltip and jump", async () => {
	activate();
	const doc = document(
		[
			'Shape = {"sides": 4}',
			"Shape.degrees = function(times=1)",
			"\treturn times * 45",
			"end function",
			"sq = new Shape",
			"print sq.degrees(2)",
		].join("\n")
	);

	const hover = await opened.hover.provideHover(doc, { line: 5, character: 10 });
	assert.match(hover.contents.value, /Shape\.degrees\(times=1\)/);
	assert.match(hover.contents.value, /method/);

	const locations = await opened.definition.provideDefinition(doc, { line: 5, character: 10 });
	assert.equal(locations.length, 1);
	assert.deepEqual(locations[0].range.start, { line: 1, character: 6 });

	const tokens = await opened.tokens.provideDocumentSemanticTokens(doc);
	assert.equal(kindOf(tokens, 5, 9), "method", "the call is coloured as the method it is");
});

// `self` and `super` name the class the enclosing method was defined on, not a map, so a
// method called through one resolves like any other method of that class.
test("a method called through self has a tooltip and a jump", async () => {
	activate();
	const doc = document(
		[
			'Shape = {"sides": 4}',
			"Shape.degrees = function(times=1)",
			"\treturn times * 45",
			"end function",
			"Shape.show = function",
			"\tprint self.degrees(2)",
			"end function",
		].join("\n")
	);

	const hover = await opened.hover.provideHover(doc, { line: 5, character: 13 });
	assert.match(hover.contents.value, /Shape\.degrees\(times=1\)/);
	assert.match(hover.contents.value, /method/);

	const locations = await opened.definition.provideDefinition(doc, { line: 5, character: 13 });
	assert.equal(locations.length, 1);
	assert.deepEqual(locations[0].range.start, { line: 1, character: 6 });
});

test("a method called through self keeps its parameters", async () => {
	activate();
	const doc = document(
		[
			'Shape = {"sides": 4}',
			"Shape.degrees = function(times=1)",
			"\treturn times * 45",
			"end function",
			"Shape.show = function",
			"\tprint self.degrees(",
			"end function",
		].join("\n")
	);

	const help = await helpAt(doc, 5, 20);
	assert.equal(help.signatures[0].label, "Shape.degrees(times=1)");
	assert.deepEqual(
		help.signatures[0].parameters.map((parameter) => parameter.label),
		["times=1"]
	);
	assert.equal(help.activeParameter, 0);
});

test("self reaches its class even when a top-level name is spelled the same", async () => {
	activate();
	const doc = document(
		[
			"degrees = 0",
			'Shape = {"sides": 4}',
			"Shape.degrees = function(times=1)",
			"\treturn times * 45",
			"end function",
			"Shape.show = function",
			"\treturn self.degrees(2)",
			"end function",
		].join("\n")
	);

	const hover = await opened.hover.provideHover(doc, { line: 6, character: 13 });
	assert.match(hover.contents.value, /Shape\.degrees\(times=1\)/);
	assert.doesNotMatch(hover.contents.value, /degrees = 0/);

	const locations = await opened.definition.provideDefinition(doc, { line: 6, character: 13 });
	assert.deepEqual(locations[0].range.start, { line: 2, character: 6 });
});

test("Find All References finds the uses of a name in the file", async () => {
	activate();
	const doc = document(
		[
			"add = function(a, b=2)",
			"\treturn a + b",
			"end function",
			"print add(1)",
			"other = function()",
			"\treturn add(2)",
			"end function",
		].join("\n")
	);

	const found = await opened.references.provideReferences(
		doc,
		{ line: 3, character: 6 },
		{ includeDeclaration: true }
	);
	assert.deepEqual(
		found.map((location) => [location.uri === doc.uri, location.range.start.line, location.range.start.character]),
		[
			[true, 0, 0],
			[true, 3, 6],
			[true, 5, 8],
		]
	);

	const uses = await opened.references.provideReferences(
		doc,
		{ line: 3, character: 6 },
		{ includeDeclaration: false }
	);
	assert.equal(uses.length, 2, "the declaration is left out when not asked for");
});

test("a local's uses are its own, not another function's", async () => {
	activate();
	const doc = document(
		[
			"f = function(x)",
			"\ty = x + 1",
			"\treturn x + y",
			"end function",
			"g = function(x)",
			"\treturn x",
			"end function",
		].join("\n")
	);

	const found = await opened.references.provideReferences(
		doc,
		{ line: 1, character: 5 },
		{ includeDeclaration: true }
	);
	assert.deepEqual(
		found.map((location) => [location.range.start.line, location.range.start.character]),
		[
			[0, 13],
			[1, 5],
			[2, 8],
		]
	);
});

test("a local can be renamed, and a top-level name cannot", async () => {
	activate();
	const doc = document(
		["f = function(x)", "\ty = x + 1", "\treturn x", "end function"].join("\n")
	);

	const prepared = opened.rename.prepareRename(doc, { line: 1, character: 5 });
	assert.equal(prepared.placeholder, "x");
	assert.deepEqual(prepared.range.start, { line: 1, character: 5 });

	const edit = await opened.rename.provideRenameEdits(doc, { line: 1, character: 5 }, "count");
	assert.deepEqual(
		edit.edits.map((entry) => [entry.range.start.line, entry.range.start.character, entry.text]),
		[
			[0, 13, "count"],
			[1, 5, "count"],
			[2, 8, "count"],
		]
	);

	assert.equal(
		opened.rename.prepareRename(doc, { line: 0, character: 0 }),
		undefined,
		"a top-level function is used from files this one has not read"
	);
});

test("Go to Symbol in Workspace finds a name in another file", async () => {
	opened.files.add("lib");
	opened.modules.set(
		"/work/lib.ms",
		["helper = function(x)", "\treturn x", "end function", "value = 1"].join("\n")
	);
	activate();

	const found = await opened.workspaceSymbols.provideWorkspaceSymbols("hel");
	assert.equal(found.length, 1);
	assert.equal(found[0].name, "helper");
	assert.equal(found[0].kind, vscode.SymbolKind.Function);
	assert.equal(found[0].location.uri.fsPath, "/work/lib.ms");
	assert.deepEqual(found[0].location.range.start, { line: 0, character: 0 });

	assert.deepEqual(await opened.workspaceSymbols.provideWorkspaceSymbols(""), []);
});

test("the path in an import is a link to the module", async () => {
	opened.files.add("found");
	activate();
	const doc = document('import "found"\nimport "missing"');

	const links = await opened.links.provideDocumentLinks(doc);
	assert.equal(links.length, 1);
	assert.deepEqual([links[0].range.start.line, links[0].range.start.character], [0, 8]);
	assert.equal(links[0].range.end.character, 13);
	assert.equal(links[0].target.fsPath, "/work/found.ms");
	assert.equal(links[0].tooltip, "Open found.ms");
});

test("a name in a string or a comment keeps the grammar's color", async () => {
	activate();
	const doc = document(['// print add', 's = "hi"', 'print "print add"'].join("\n"));
	const tokens = await opened.tokens.provideDocumentSemanticTokens(doc);
	assert.deepEqual(
		tokens.pushed.map((token) => [token.line, token.character]),
		[
			[1, 0],
			[2, 0],
		]
	);
});

test("a problem with no certain repair offers no fix", async () => {
	const collection = activate();
	const doc = document("end");
	await opened.events.onDidOpenTextDocument(doc);

	const [found] = published(collection, doc);
	assert.equal(found.code, "stray-end");
	assert.deepEqual(await actionsFor(doc, found), []);
});
