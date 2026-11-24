// The notebook's cell protocol against the real interpreter: what a cell's output is, the
// state one cell leaves for the next, the value a bare line echoes, and the two ways a
// cell can fail.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

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

const { NotebookSession, scriptFor } = require("../notebook-session");

function open(t) {
	const session = new NotebookSession({
		command: interpreter,
		cwd: root,
		env: { ...process.env, MS_IMPORT_PATH: path.join(root, "src"), NO_COLOR: "1" },
	});
	t.after(() => session.dispose());
	return session;
}

async function run(session, source) {
	const chunks = [];
	const result = await session.run(source, (text) => chunks.push(text));
	return { ...result, output: chunks.join(""), chunks };
}

// A stopped cell waits for the killed process to close, which a broken stop() would never
// let happen: bound it so the suite fails instead of hanging.
function bounded(promise, ms) {
	return Promise.race([
		promise,
		new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("the cell never ended")), ms);
			timer.unref();
		}),
	]);
}

test("a cell of several lines goes inside one block; a single line stands alone", () => {
	const block = scriptFor("for i in [1, 2]\n\tprint i\nend for", "MARK");
	assert.equal(block.bare, false);
	assert.equal(
		block.text,
		'if true then\nfor i in [1, 2]\n\tprint i\nend for\nend if\nprint "MARK"\n'
	);

	const line = scriptFor("1 + 1", "MARK");
	assert.equal(line.bare, true);
	assert.equal(line.text, '1 + 1\nprint "MARK"\n');

	// A single line that opens a block would wait for an `end if` that never comes.
	assert.equal(scriptFor("if x then", "MARK").bare, false);
	assert.equal(scriptFor("f = function(a)", "MARK").bare, false);
	assert.equal(scriptFor("if x then print 1", "MARK").bare, true);
});

test("a cell's prints are the cell's output", { skip }, async (t) => {
	const session = open(t);
	const result = await run(session, 'print "a"\nprint "b"');
	assert.equal(result.success, true);
	assert.equal(result.output, "a\nb\n");
});

test("a name a cell defines is there for the next cell", { skip }, async (t) => {
	const session = open(t);
	await run(session, "x = 41");
	const result = await run(session, "print x + 1");
	assert.equal(result.output, "42\n");
});

test("a single line shows the value it has", { skip }, async (t) => {
	const session = open(t);
	assert.equal((await run(session, "1 + 1")).output, "2\n");
	assert.equal((await run(session, '"abc".len')).output, "3\n");
	assert.equal((await run(session, "x = 5")).output, "");
});

test("the session names the notebook it stands in for", { skip }, async (t) => {
	const notebookPath = path.join(root, "examples/explore.msnb");
	const session = new NotebookSession({
		command: interpreter,
		cwd: root,
		env: { ...process.env, NO_COLOR: "1" },
		shellArgs: [notebookPath],
	});
	t.after(() => session.dispose());
	// The lines the interpreter writes before the first cell - its own and the `-c`
	// statement's - are not the cell's output.
	assert.equal((await run(session, "print shellArgs[0]")).output, `${notebookPath}\n`);
});

test("a cell imports the project's modules", { skip }, async (t) => {
	const session = open(t);
	const result = await run(session, 'import "triples"\nprint "imported"');
	assert.equal(result.success, true, result.error);
	assert.equal(result.output, "imported\n");
});

test("a cell can draw a picture as well as print", { skip }, async (t) => {
	const session = open(t);
	const result = await run(
		session,
		'print "source:"\nnotebook.mermaid(["flowchart TD", "  a --> b"])'
	);
	assert.equal(result.success, true, result.error);
	// The picture is not text: neither its lines nor the markers show.
	assert.equal(result.output, "source:\n");
	assert.deepEqual(result.draws, [
		{ mime: "text/markdown", text: "```mermaid\nflowchart TD\n  a --> b\n```" },
	]);

	// One string draws the same diagram, and an SVG is handed over as it stands.
	const joined = await run(
		session,
		'notebook.mermaid(["graph LR", "  x --> y"].join(char(10)))'
	);
	assert.deepEqual(joined.draws, [
		{ mime: "text/markdown", text: "```mermaid\ngraph LR\n  x --> y\n```" },
	]);

	const drawn = await run(session, 'notebook.svg(["<svg>", "  <rect/>", "</svg>"])');
	assert.equal(drawn.output, "");
	assert.deepEqual(drawn.draws, [
		{ mime: "image/svg+xml", text: "<svg>\n  <rect/>\n</svg>" },
	]);
});

test("a runtime error ends the cell and the session carries on", { skip }, async (t) => {
	const session = open(t);
	const failed = await run(session, 'x = 7\nprint "before"\nnoSuch');
	assert.equal(failed.success, false);
	assert.match(failed.error, /Undefined Identifier/);
	assert.equal(failed.output, "before\n");

	const after = await run(session, "print x");
	assert.equal(after.success, true);
	assert.equal(after.output, "7\n");
});

test("a compiler error is reported once, not once per leftover line", { skip }, async (t) => {
	const session = open(t);
	const failed = await run(session, "if true then\nx = = 2\nend if");
	assert.equal(failed.success, false);
	assert.match(failed.error, /^Compiler Error:/);
	assert.equal(failed.output, "");
	assert.doesNotMatch(failed.error, /Keyword\(end\)/);
});

test("a cell's lines arrive in order, however they are split", { skip }, async (t) => {
	const session = open(t);
	const result = await run(
		session,
		'print "a"\nwait 0.2\nfor i in range(1, 200)\n\tprint i\nend for\nprint "b"'
	);
	const lines = ["a", ...Array.from({ length: 200 }, (_, i) => String(i + 1)), "b"];
	assert.equal(result.success, true);
	assert.equal(result.output, `${lines.join("\n")}\n`);
});

// The repository above this one ships the sample notebook, so its cells are the worked
// example of the pictures: run them in order and see that it draws both kinds.
const sample = path.join(root, "examples/explore.msnb");
const noSample = fs.existsSync(sample)
	? false
	: "no examples/explore.msnb beside this checkout";

test("the sample notebook draws both a Mermaid diagram and an SVG", { skip: skip || noSample }, async (t) => {
	const session = new NotebookSession({
		command: interpreter,
		cwd: root,
		env: {
			...process.env,
			MS_IMPORT_PATH: [path.dirname(sample), path.join(root, "src"), root].join(
				path.delimiter
			),
			NO_COLOR: "1",
		},
		shellArgs: [sample],
	});
	t.after(() => session.dispose());

	const draws = [];
	for (const cell of JSON.parse(fs.readFileSync(sample, "utf8")).cells) {
		if (cell.kind !== "code") continue;
		const result = await session.run(cell.source, () => {});
		assert.equal(result.success, true, `cell ${JSON.stringify(cell.source)}: ${result.error}`);
		draws.push(...(result.draws || []));
	}

	const mermaid = draws.find((draw) => draw.mime === "text/markdown");
	assert.ok(mermaid, "the sample draws a Mermaid diagram");
	assert.match(mermaid.text, /^```mermaid\nflowchart TD\n/);

	const svg = draws.find((draw) => draw.mime === "image/svg+xml");
	assert.ok(svg, "the sample draws an SVG");
	assert.match(svg.text, /^<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg'/);
});

test("stopping a cell ends the session, and the next cell starts a new one", { skip }, async (t) => {
	const session = open(t);
	await run(session, "x = 1");

	const hanging = session.run("while true\nend while", () => {});
	setTimeout(() => session.stop(), 300);
	const stopped = await bounded(hanging, 10000);
	assert.equal(stopped.success, false);
	assert.match(stopped.error, /Stopped/);

	const fresh = await run(session, "print 1");
	assert.equal(fresh.success, true);
	assert.equal(fresh.output, "1\n");

	// The killed process took the value with it.
	assert.equal((await run(session, "x")).success, false);
});
