// notebook-session.js — one MiniScript REPL process, driven a cell at a time.
//
// MiniScript 2 starts a REPL when it is given no script, so a notebook keeps one process
// for its cells to share: a name one cell defines is there for the next one. A cell of
// several lines is written as one block, `if true then ... end if`, so the cell's own
// prints come out together; a single line is written as it is, so the REPL's echo of a
// bare expression (`_out[3]: 2`) is read as the cell's value. A `print` of a random
// marker follows, and the session reads stdout until that line arrives: that is how a
// cell ends, whether it succeeded or failed.
//
// Nothing here uses vscode, so the protocol is checked against the real interpreter in
// test/notebook-session.test.js; notebook.js is the VS Code side.

const { spawn } = require("child_process");
const crypto = require("crypto");

// What the interpreter says when a cell cannot run, on stdout. Whatever follows is the
// interpreter's own confusion about the lines after it - the `end if` of the block a
// broken cell left open - so the cell's output stops at the first one.
const ERROR = /^(?:Runtime|Compiler) Error:/;

// The REPL echoes a line's value as `_out[<line>]: <value>`.
const ECHO = /^_out\[\d+\]: /;

// `notebook.draw(...)` - what `notebook.mermaid` and `notebook.svg` are made of - writes
// its output between these two lines, naming the type in the first one. What is between
// them is handed to VS Code as an output of that type rather than shown as text.
const DRAW_START = "<<miniscript-notebook:draw:";
const DRAW_END = "<<miniscript-notebook:end-draw>>";

// A line that opens a block needs the lines after it: written at the REPL on its own it
// would wait for an `end` that never comes, so it is written inside the block instead.
// `then`, `function` and the loop headers are the three ways a MiniScript line can.
const OPENS_A_BLOCK = [
	/\bthen\s*$/,
	/\bfunction\b\s*(?:\([^)]*\))?\s*$/,
	/^\s*(?:for|while)\b/,
];

function opensABlock(line) {
	return OPENS_A_BLOCK.some((pattern) => pattern.test(line));
}

// What to write to the REPL for one cell, and whether it was written as it stands (so a
// bare expression's echoed value is the cell's value) or inside the block.
function scriptFor(source, marker) {
	const code = String(source).replace(/\r\n/g, "\n").replace(/\s+$/, "");
	const bare = !code.includes("\n") && !opensABlock(code);
	const lines = [];
	if (bare) {
		if (code) lines.push(code);
	} else {
		lines.push("if true then", code, "end if");
	}
	lines.push(`print "${marker}"`);
	return { text: `${lines.join("\n")}\n`, bare };
}

// A MiniScript list literal for the notebook's shellArgs. A string in MiniScript has no
// backslash escapes: a quote inside one is doubled.
function listText(items) {
	return `[${items.map((item) => `"${String(item).replace(/"/g, '""')}"`).join(", ")}]`;
}

// The code the interpreter runs before the REPL starts: the notebook's shellArgs, and the
// `notebook` helpers a cell can call. `notebook.mermaid` draws through VS Code's own
// Mermaid renderer, and `notebook.svg` draws a picture VS Code shows as it is, so it needs
// nothing from the version.
function preamble(shellArgs) {
	const lines = [];
	if (shellArgs) lines.push(`shellArgs = ${listText(shellArgs)}`);
	lines.push(
		'notebook = {"draw": function(mime, content)',
		"\tif content isa list then content = content.join(char(10))",
		`\tprint "${DRAW_START}" + mime + ">>"`,
		"\tprint content",
		`\tprint "${DRAW_END}"`,
		"end function,",
		'"mermaid": function(diagram)',
		"\tif diagram isa list then diagram = diagram.join(char(10))",
		'\tnotebook.draw("text/markdown", "```mermaid" + char(10) + diagram + char(10) + "```")',
		"end function,",
		'"svg": function(diagram)',
		'\tnotebook.draw("image/svg+xml", diagram)',
		"end function}"
	);
	return lines.join("\n");
}

class NotebookSession {
	constructor({ command, cwd, env, shellArgs }) {
		this.command = command;
		this.cwd = cwd;
		this.env = env;
		// The notebook has no script, but a loader may still ask where the entry script
		// was. The interpreter's own `-c` sets it before the REPL starts, so a cell sees
		// the notebook's path there and no cell has to.
		this.shellArgs = Array.isArray(shellArgs) ? shellArgs : undefined;
		this.child = undefined;
		this.stderr = "";
		this.buffer = "";
		this.pending = undefined;
		this.framing = true;
		this.disposed = false;
	}

	// Runs one cell in the session, handing every piece of output to onOutput as it
	// arrives. Resolves when the cell ends, with the failure the interpreter reported for
	// it, if any.
	run(source, onOutput) {
		if (this.disposed) {
			return Promise.resolve({ success: false, error: "This notebook's session has ended." });
		}
		if (this.pending) {
			return Promise.resolve({ success: false, error: "A cell is already running in this notebook." });
		}
		if (!this.child) this.start();

		const marker = `<<miniscript-notebook:${crypto.randomUUID()}>>`;
		const script = scriptFor(source, marker);
		return new Promise((resolve) => {
			this.pending = {
				marker,
				resolve,
				onOutput: typeof onOutput === "function" ? onOutput : () => {},
				bare: script.bare,
				started: false,
				failed: false,
				error: undefined,
				cancelled: false,
				draw: undefined,
				draws: [],
			};
			this.buffer = "";
			this.child.stdin.write(script.text);
		});
	}

	start() {
		this.stderr = "";
		this.buffer = "";
		this.framing = true;
		const child = spawn(this.command, ["-q", "-i", "-c", preamble(this.shellArgs)], {
			cwd: this.cwd,
			env: this.env,
			windowsHide: true,
		});
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => this.read(chunk));
		child.stderr.on("data", (chunk) => this.notes(chunk));
		child.on("error", (error) => this.died(undefined, error));
		child.on("close", (code) => this.died(code));
		// A process that exits while a cell is being written to it must not throw.
		child.stdin.on("error", () => {});
		this.child = child;
	}

	// Kills the interpreter. A cell that is running ends as stopped, and the next cell
	// starts a new process: the values cells defined before are gone with it.
	stop() {
		if (this.pending) this.pending.cancelled = true;
		const child = this.child;
		this.child = undefined;
		if (child) child.kill();
	}

	dispose() {
		this.disposed = true;
		this.stop();
	}

	read(chunk) {
		if (!this.pending) return; // the REPL's own noise, or the tail of a finished cell
		this.buffer += chunk.replace(/\r\n/g, "\n");

		// The interpreter writes a newline around each statement of its own: before the
		// first cell's output, and after the marker that ends a cell. They are framing, not
		// output, and counting them would tie this to how the preamble is written - so
		// after the marker and at the start, every leading newline goes.
		if (this.framing) {
			this.buffer = this.buffer.replace(/^\n+/, "");
			this.framing = this.buffer.length === 0;
		}

		const { marker } = this.pending;
		const at = this.buffer.indexOf(marker);
		if (at >= 0) {
			const before = this.buffer.slice(0, at);
			this.buffer = "";
			// The newline the REPL writes after the cell's own statement.
			this.emit(before.endsWith("\n") ? before.slice(0, -1) : before);
			this.finish();
			return;
		}

		// Emit the lines that are certainly output. The last line is held back, since it
		// may be the newline that closes the cell, which the marker then follows.
		const last = this.buffer.lastIndexOf("\n");
		if (last < 0) return;
		const from = last > 0 ? this.buffer.lastIndexOf("\n", last - 1) + 1 : 0;
		if (from <= 0) return;
		const ready = this.buffer.slice(0, from);
		this.buffer = this.buffer.slice(from);
		this.emit(ready);
	}

	// stderr says why a process died; MiniScript itself reports errors on stdout, so this
	// is kept for the exit message rather than mixed into a cell's output.
	notes(chunk) {
		this.stderr = (this.stderr + chunk).slice(-4000);
	}

	// One piece of a cell's output: split into lines, because an error line ends the cell
	// there and the value a bare expression echoes is shown as the value alone.
	emit(text) {
		const pending = this.pending;
		if (!pending || !text || pending.failed) return;
		const lines = text.split("\n");
		const complete = text.endsWith("\n");
		let out = "";
		for (let i = 0; i < lines.length; i += 1) {
			if (complete && i === lines.length - 1) break;
			let line = lines[i].replace(/\r$/, "");

			// A drawn output is held aside, between its markers, and never shown as text.
			if (pending.draw) {
				if (line === DRAW_END) {
					if (pending.draw.mime) {
						pending.draws.push({ mime: pending.draw.mime, text: pending.draw.lines.join("\n") });
					}
					pending.draw = undefined;
				} else {
					pending.draw.lines.push(line);
				}
				continue;
			}
			if (line.startsWith(DRAW_START) && line.endsWith(">>")) {
				pending.draw = { mime: line.slice(DRAW_START.length, -2).trim(), lines: [] };
				continue;
			}

			if (ERROR.test(line)) {
				pending.failed = true;
				pending.error = line.trim();
				break;
			}
			if (!pending.started) {
				pending.started = true;
				if (pending.bare) line = line.replace(ECHO, "");
			}
			out += line + (complete || i < lines.length - 1 ? "\n" : "");
		}
		if (out) pending.onOutput(out);
	}

	finish() {
		const pending = this.pending;
		this.pending = undefined;
		this.framing = true;
		if (!pending) return;
		const result = pending.failed
			? { success: false, error: pending.error }
			: { success: true };
		if (pending.draws.length) result.draws = pending.draws;
		pending.resolve(result);
	}

	died(code, error) {
		this.child = undefined;
		const pending = this.pending;
		this.pending = undefined;
		if (!pending) return;
		let message;
		if (pending.cancelled) {
			message = "Stopped. The next cell starts a new session, so values defined before are gone.";
		} else if (error) {
			message = `Could not start ${this.command}: ${error.message}`;
		} else {
			message = `The interpreter exited (code ${code}).`;
			const tail = this.stderr.trim();
			if (tail) message += `\n${tail}`;
		}
		const result = { success: false, error: message };
		if (pending.draws.length) result.draws = pending.draws;
		pending.resolve(result);
	}
}

module.exports = { NotebookSession, scriptFor };
