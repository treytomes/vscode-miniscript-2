// The Run commands through a stub `vscode`: which terminal each opens, in which folder,
// and what it is told to run. Nothing here starts an interpreter.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Module = require("module");

const root = "/work/project";
const file = path.join(root, "app.ms");

let terminals;
let commands;
let warnings;
let errors;
let answer;

function reset() {
	terminals = [];
	commands = new Map();
	warnings = [];
	errors = [];
	answer = undefined;
}

const vscode = {
	window: {
		activeTextEditor: undefined,
		createTerminal: (options) => {
			const terminal = {
				options,
				sent: [],
				shown: 0,
				show() {
					this.shown += 1;
				},
				sendText(text) {
					this.sent.push(text);
				},
			};
			terminals.push(terminal);
			return terminal;
		},
		showWarningMessage: (message) => {
			warnings.push(message);
		},
		showErrorMessage: async (message) => {
			errors.push(message);
			return undefined;
		},
		showInputBox: async () => answer,
		onDidCloseTerminal: () => ({ dispose() {} }),
	},
	workspace: {
		workspaceFolders: [{ name: "project", uri: { fsPath: root } }],
		getWorkspaceFolder: () => ({ uri: { fsPath: root } }),
	},
	commands: {
		registerCommand: (id, handler) => {
			commands.set(id, handler);
			return { dispose() {} };
		},
		executeCommand: async () => {},
	},
};

const load = Module._load;
Module._load = function (request, ...rest) {
	if (request === "vscode") return vscode;
	return load.call(this, request, ...rest);
};

const run = require("../run.js");

function editing(held, { dirty = false } = {}) {
	const document = {
		languageId: "miniscript",
		uri: { fsPath: file },
		isDirty: dirty,
		save: async () => true,
		getText: () => held,
	};
	vscode.window.activeTextEditor = {
		document,
		selection: { isEmpty: held === "" },
	};
	return document;
}

function activate({ command = "/opt/miniscript/miniscript" } = {}) {
	reset();
	run.register(
		{ subscriptions: [] },
		{
			resolveInterpreter: () => (command ? { command } : { problem: "no interpreter" }),
			projectDirFor: () => root,
			readEnvValue: () => undefined,
		}
	);
	return commands;
}

function commandLine(args) {
	return `"/opt/miniscript/miniscript" "${file}"${args ? ` ${args}` : ""}`;
}

test("running a file opens a terminal on it in the project", async () => {
	const registered = activate();
	editing("print 1");

	await registered.get("miniscript2.runFile")();

	assert.equal(terminals.length, 1);
	assert.equal(terminals[0].options.name, "MiniScript: app.ms");
	assert.equal(terminals[0].options.cwd, root);
	assert.equal(terminals[0].sent[0], commandLine());
	assert.equal(terminals[0].shown, 1);
});

test("arguments are passed after the file, as typed", async () => {
	const registered = activate();
	answer = "--fast one";
	editing("print 1");

	await registered.get("miniscript2.runFileWithArguments")();

	assert.equal(terminals[0].sent[0], commandLine("--fast one"));
});

test("cancelling the arguments runs nothing", async () => {
	const registered = activate();
	editing("print 1");

	await registered.get("miniscript2.runFileWithArguments")();

	assert.equal(answer, undefined);
	assert.equal(terminals.length, 0);
});

test("a selection runs in one REPL that the next selection shares", async () => {
	const registered = activate();
	editing("x = 41");
	await registered.get("miniscript2.runSelection")();
	editing("print x");
	await registered.get("miniscript2.runSelection")();

	assert.equal(terminals.length, 1, "one REPL, not one per selection");
	assert.equal(terminals[0].options.name, "MiniScript REPL");
	assert.equal(terminals[0].options.shellPath, "/opt/miniscript/miniscript");
	assert.equal(terminals[0].options.cwd, root);
	assert.ok(
		terminals[0].options.env.MS_IMPORT_PATH.includes(path.join(root, "src")),
		`MS_IMPORT_PATH was ${terminals[0].options.env.MS_IMPORT_PATH}`
	);
	assert.deepEqual(terminals[0].sent, ["x = 41", "print x"]);
});

test("the REPL command opens the interpreter itself, in the project folder", async () => {
	const registered = activate();
	vscode.window.activeTextEditor = undefined;

	await registered.get("miniscript2.startRepl")();

	assert.equal(terminals[0].options.shellPath, "/opt/miniscript/miniscript");
	assert.equal(terminals[0].options.cwd, root);
});

test("nothing selected says so instead of running", async () => {
	const registered = activate();
	editing("");

	await registered.get("miniscript2.runSelection")();

	assert.equal(terminals.length, 0);
	assert.match(warnings[0], /Select the MiniScript code/);
});

test("a missing interpreter says so instead of opening a terminal", async () => {
	const registered = activate({ command: "" });
	editing("print 1");

	await registered.get("miniscript2.runFile")();

	assert.equal(terminals.length, 0);
	assert.match(errors[0], /no interpreter/);
});
