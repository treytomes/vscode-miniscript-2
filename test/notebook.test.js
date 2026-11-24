// The notebook's VS Code side through a stub `vscode`: the `.msnb` file format, and the
// controller running cells in one session, which is real MiniScript run by the real
// interpreter because the thing under test is what the controller makes of its output.

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const root = path.resolve(__dirname, "../..");

const interpreter = [
	process.env.MINISCRIPT_EXE_PATH,
	path.join(root, "3rd-party/miniscript-win/miniscript.exe"),
	path.join(root, "3rd-party/miniscript-linux/miniscript"),
	path.join(root, "3rd-party/miniscript-mac/miniscript"),
]
	.filter(Boolean)
	.find((candidate) => fs.existsSync(candidate));

const skip = interpreter
	? false
	: "no MiniScript interpreter in ../3rd-party and no MINISCRIPT_EXE_PATH";

const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "miniscript-notebook-"));
after(() => {
	fs.rmSync(workspaceDir, { recursive: true, force: true });
});

class NotebookCellData {
	constructor(kind, value, languageId) {
		Object.assign(this, { kind, value, languageId });
	}
}

class NotebookData {
	constructor(cells) {
		this.cells = cells;
	}
}

class NotebookCellOutput {
	constructor(items) {
		this.items = items;
	}
}

const STDOUT = "application/vnd.code.notebook.stdout";
const ERROR = "application/vnd.code.notebook.error";

const vscode = {
	NotebookCellKind: { Markup: 1, Code: 2 },
	NotebookCellData,
	NotebookData,
	NotebookCellOutput,
	NotebookCellOutputItem: {
		stdout: (value) => ({ mime: STDOUT, value }),
		error: (error) => ({ mime: ERROR, error }),
		text: (value, mime) => ({ mime, value }),
	},
	notebooks: {
		createNotebookController: (id, notebookType, label, handler) => {
			const controller = {
				id,
				notebookType,
				label,
				handler,
				createNotebookCellExecution(cell) {
					const execution = {
						cell,
						executionOrder: undefined,
						outputs: [],
						ended: undefined,
						token: {
							isCancellationRequested: false,
							onCancellationRequested: () => ({ dispose() {} }),
						},
						start() {
							this.started = true;
						},
						end(success) {
							this.ended = success;
						},
						async replaceOutput(out) {
							this.outputs = Array.isArray(out) ? out : [out];
						},
						async appendOutput(out) {
							this.outputs.push(...(Array.isArray(out) ? out : [out]));
						},
					};
					cell.execution = execution;
					return execution;
				},
			};
			opened.controller = controller;
			return controller;
		},
	},
	workspace: {
		registerNotebookSerializer: (type, serializer, options) => {
			opened.serializer = serializer;
			opened.options = options;
			return { dispose() {} };
		},
		onDidCloseNotebookDocument: () => ({ dispose() {} }),
		onDidChangeConfiguration: () => ({ dispose() {} }),
		openNotebookDocument: async (type, data) => {
			opened.notebook = { type, data };
			return opened.notebook;
		},
		getConfiguration: () => ({ get: (key, fallback) => fallback }),
	},
	window: {
		activeNotebookEditor: undefined,
		showNotebookDocument: async () => undefined,
		showWarningMessage: () => undefined,
		showInformationMessage: () => undefined,
	},
	commands: {
		registerCommand: (name, run) => {
			opened.commands.set(name, run);
			return { dispose() {} };
		},
	},
};

const opened = {
	commands: new Map(),
	controller: undefined,
	serializer: undefined,
	options: undefined,
	notebook: undefined,
};

const load = Module._load;
Module._load = function (request, ...rest) {
	if (request === "vscode") return vscode;
	return load.call(this, request, ...rest);
};

const { register, deserialize, serialize } = require("../notebook.js");

// Every controller's sessions, so a process started by a test is stopped with it.
const started = [];

after(() => {
	for (const sessions of started) {
		for (const session of sessions.values()) session.dispose();
	}
});

function notebookUnderTest() {
	const made = register(
		{ subscriptions: [] },
		{
			resolveInterpreter: () => ({ command: interpreter }),
			projectDirFor: () => workspaceDir,
			readEnvValue: () => undefined,
		}
	);
	started.push(made.sessions);
	return made;
}

function notebook() {
	return {
		uri: {
			scheme: "file",
			fsPath: path.join(workspaceDir, "demo.msnb"),
			toString: () => "file:///demo.msnb",
		},
		notebookType: "miniscript-notebook",
	};
}

function codeCell(source) {
	return { kind: vscode.NotebookCellKind.Code, document: { getText: () => source } };
}

function textOf(execution) {
	return execution.outputs
		.flatMap((output) => output.items)
		.filter((item) => item.mime === STDOUT)
		.map((item) => item.value)
		.join("");
}

function errorOf(execution) {
	const item = execution.outputs
		.flatMap((output) => output.items)
		.find((found) => found.mime === ERROR);
	return item ? item.error : undefined;
}

test("a notebook file is its cells and nothing else", () => {
	const bytes = serialize(
		new NotebookData([
			new NotebookCellData(vscode.NotebookCellKind.Code, "print 1", "miniscript"),
			new NotebookCellData(vscode.NotebookCellKind.Markup, "# Notes", "markdown"),
		])
	);
	const raw = JSON.parse(bytes.toString("utf8"));
	assert.deepEqual(raw.cells, [
		{ kind: "code", language: "miniscript", source: "print 1" },
		{ kind: "markdown", language: "markdown", source: "# Notes" },
	]);

	const data = deserialize(bytes);
	assert.deepEqual(
		data.cells.map((cell) => [cell.kind, cell.languageId, cell.value]),
		[
			[vscode.NotebookCellKind.Code, "miniscript", "print 1"],
			[vscode.NotebookCellKind.Markup, "markdown", "# Notes"],
		]
	);
});

test("a cell's source may be a list of lines", () => {
	const data = deserialize(
		Buffer.from('{"cells":[{"kind":"markdown","source":["# Hi","\\n"]}]}', "utf8")
	);
	assert.equal(data.cells[0].kind, vscode.NotebookCellKind.Markup);
	assert.equal(data.cells[0].value, "# Hi\n");
});

test("an empty file is one empty code cell", () => {
	const data = deserialize(Buffer.from("", "utf8"));
	assert.equal(data.cells.length, 1);
	assert.equal(data.cells[0].kind, vscode.NotebookCellKind.Code);
	assert.equal(data.cells[0].value, "");
});

test("a file that is not a notebook says so", () => {
	assert.throws(() => deserialize(Buffer.from("{", "utf8")), /Not a MiniScript notebook/);
	assert.throws(() => deserialize(Buffer.from('{"x":1}', "utf8")), /no cells/);
});

test("the serializer keeps outputs out of the file", () => {
	notebookUnderTest();
	assert.deepEqual(opened.options, { transientOutputs: true });
});

test("cells run in order in one session", { skip }, async () => {
	notebookUnderTest();
	const cells = [codeCell("x = 41"), codeCell("print x + 1")];
	await opened.controller.handler(cells, notebook(), opened.controller);

	assert.equal(cells[0].execution.ended, true);
	assert.deepEqual(cells[0].execution.outputs, []);
	assert.equal(cells[1].execution.ended, true);
	assert.equal(textOf(cells[1].execution), "42\n");
	assert.equal(cells[1].execution.executionOrder, 2);
});

test("a failing cell is marked failed and the reason is shown", { skip }, async () => {
	notebookUnderTest();
	const cell = codeCell("noSuchName");
	await opened.controller.handler([cell], notebook(), opened.controller);

	assert.equal(cell.execution.ended, false);
	assert.match(errorOf(cell.execution).message, /Undefined Identifier/);
});

test("a drawn picture is an output of its own", { skip }, async () => {
	notebookUnderTest();
	const cell = codeCell(
		'notebook.mermaid(["flowchart TD", "  a --> b"])\nnotebook.svg(["<svg>", "</svg>"])'
	);
	await opened.controller.handler([cell], notebook(), opened.controller);

	assert.equal(cell.execution.ended, true);
	assert.deepEqual(
		cell.execution.outputs.map((output) => output.items.map((item) => [item.mime, item.value])),
		[
			[["text/markdown", "```mermaid\nflowchart TD\n  a --> b\n```"]],
			[["image/svg+xml", "<svg>\n</svg>"]],
		]
	);
	assert.equal(textOf(cell.execution), "");
});

test("the session is given the project's import path and plain output", { skip }, async () => {
	notebookUnderTest();
	const cell = codeCell('print env["NO_COLOR"]\nprint env["MS_IMPORT_PATH"]');
	await opened.controller.handler([cell], notebook(), opened.controller);

	const [plain, imports] = textOf(cell.execution).split("\n");
	assert.equal(plain, "1");
	assert.ok(imports.includes(workspaceDir), `MS_IMPORT_PATH was ${imports}`);
});

test("New MiniScript Notebook opens one cell of MiniScript", async () => {
	notebookUnderTest();
	await opened.commands.get("miniscript2.newNotebook")();
	assert.equal(opened.notebook.type, "miniscript-notebook");
	assert.equal(opened.notebook.data.cells.length, 1);
	assert.equal(opened.notebook.data.cells[0].languageId, "miniscript");
});

test("Restart MiniScript Session forgets the notebook's session", { skip }, async () => {
	const notebookUnderTested = notebookUnderTest();
	await opened.controller.handler([codeCell("x = 1")], notebook(), opened.controller);
	assert.equal(notebookUnderTested.sessions.size, 1);

	vscode.window.activeNotebookEditor = { notebook: notebook() };
	opened.commands.get("miniscript2.restartNotebook")();
	assert.equal(notebookUnderTested.sessions.size, 0);
});
