// The Testing panel driven through a stub `vscode`, so it can be checked without
// launching VS Code. The suite itself is real MiniScript run by the real interpreter,
// because the thing under test is what the panel makes of the records it prints.

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

// The interpreter is a gitignored download in the repo above this one. Without it the
// suite cannot run at all, so the tests skip rather than fail.
const interpreter = [
	process.env.MINISCRIPT_EXE_PATH,
	path.resolve(__dirname, "../../3rd-party/miniscript-win/miniscript.exe"),
	path.resolve(__dirname, "../../3rd-party/miniscript-linux/miniscript"),
	path.resolve(__dirname, "../../3rd-party/miniscript-mac/miniscript"),
]
	.filter(Boolean)
	.find((candidate) => fs.existsSync(candidate));

const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "miniscript-testing-"));
const suitePath = path.join(workspaceDir, "shift.ms");

after(() => {
	fs.rmSync(workspaceDir, { recursive: true, force: true });
});

// A string in MiniScript has no backslash escapes: a quote inside one is doubled.
function record(name, line) {
	const text = `##TEST ${JSON.stringify({
		name,
		status: "pass",
		file: path.basename(suitePath),
		line,
	})}`;
	return `print "${text.replace(/"/g, '""')}"`;
}

// Writes a suite whose two checks report the given lines, so a test can edit the file
// above them and move both of them the way an edit in a case module does.
function writeSuite(first, second) {
	const lines = [];
	for (let n = 1; n <= second; n += 1) lines.push("// filler");
	lines[first - 1] = record("first", first);
	lines[second - 1] = record("second", second);
	lines.push(`print "##END {""passed"":2,""failed"":0,""skipped"":0}"`);
	fs.writeFileSync(suitePath, `${lines.join("\n")}\n`);
}

class Range {
	constructor(startLine, startChar, endLine, endChar) {
		Object.assign(this, { startLine, startChar, endLine, endChar });
	}
}

class TestMessage {
	constructor(message) {
		this.message = message;
	}
}

class Location {
	constructor(uri, range) {
		Object.assign(this, { uri, range });
	}
}

class Node {
	constructor(id, label, uri) {
		Object.assign(this, { id, label, uri });
		this.children = new Set();
	}
	add(child) {
		this.children.add(child);
	}
}

// A TestRun that keeps what it was told, in the shape the assertions below read.
function recorder() {
	return {
		passedItems: [],
		failedItems: [],
		erroredItems: [],
		skippedItems: [],
		output: [],
		passed(item) {
			this.passedItems.push(item);
		},
		failed(item, message) {
			this.failedItems.push(message);
		},
		errored(item, message) {
			this.erroredItems.push(message);
		},
		skipped(item) {
			this.skippedItems.push(item);
		},
		appendOutput(text) {
			this.output.push(text);
		},
		end() {},
	};
}

function controller() {
	const made = {
		items: new Node("root", "root"),
		createTestItem: (id, label, uri) => new Node(id, label, uri),
		createRunProfile: (label, kind, handler) => {
			made.profile = handler;
		},
		createTestRun: () => {
			made.lastRun = recorder();
			return made.lastRun;
		},
	};
	return made;
}

const vscode = {
	tests: { createTestController: () => controller() },
	workspace: {
		workspaceFolders: [
			{ name: "workspace", index: 0, uri: { fsPath: workspaceDir, scheme: "file" } },
		],
		getConfiguration: () => ({
			get: (key, fallback) => (key === "testSuite" ? path.basename(suitePath) : fallback),
		}),
		findFiles: async () => [],
	},
	Uri: { file: (fsPath) => ({ fsPath, scheme: "file" }) },
	Range,
	TestMessage,
	Location,
	RelativePattern: class {
		constructor(base, pattern) {
			Object.assign(this, { base, pattern });
		}
	},
	TestRunProfileKind: { Run: 2 },
};

const load = Module._load;
Module._load = function (request, ...rest) {
	if (request === "vscode") return vscode;
	return load.call(this, request, ...rest);
};

const { register } = require("../testing.js");

const token = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose() {} }),
};

function panel() {
	return register(
		{ subscriptions: [] },
		{ resolveInterpreter: () => ({ command: interpreter }) }
	);
}

async function discover(controller) {
	await controller.resolveHandler();
	const root = [...controller.items.children][0];
	return [...[...root.children][0].children];
}

function run(controller, include) {
	return controller.profile({ include }, token);
}

const skip = interpreter
	? false
	: "no MiniScript interpreter in ../3rd-party and no MINISCRIPT_EXE_PATH";

test("a check whose file gained lines still reports its result", { skip }, async () => {
	writeSuite(4, 5);
	const panelUnderTest = panel();
	const checks = await discover(panelUnderTest);
	assert.equal(checks.length, 2);

	const first = checks.find((check) => check.label === "first");
	assert.equal(first.range.startLine, 3, "discovered on line 4");

	// Seven lines inserted above both checks: every record now arrives at a new line,
	// which is exactly what turned the whole suite red.
	writeSuite(11, 12);
	await run(panelUnderTest, [first]);

	const results = panelUnderTest.lastRun;
	assert.deepEqual(
		results.erroredItems.map((message) => message.message),
		[]
	);
	assert.equal(results.passedItems.length, 1, "the check passed at its new line");
	assert.equal(first.range.startLine, 10, "the item followed the check to line 11");
});

test("a whole suite that moved is still reported as passes", { skip }, async () => {
	writeSuite(20, 21);
	const panelUnderTest = panel();
	await discover(panelUnderTest);
	writeSuite(30, 31);

	await run(panelUnderTest, undefined);

	const results = panelUnderTest.lastRun;
	assert.deepEqual(
		results.erroredItems.map((message) => message.message),
		[]
	);
	assert.equal(results.passedItems.length, 2);
	assert.equal(results.skippedItems.length, 0);
});
