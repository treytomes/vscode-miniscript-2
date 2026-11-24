// notebook.js — the VS Code side of a MiniScript notebook: the `.msnb` file format, the
// controller that runs a cell, and the commands that open and restart one notebook's
// session. notebook-session.js holds the interpreter process and the protocol; this file
// only turns cells and their output into what VS Code asks for.

const path = require("path");
const vscode = require("vscode");
const { NotebookSession } = require("./notebook-session");

const NOTEBOOK_TYPE = "miniscript-notebook";
const LANGUAGE = "miniscript";
const STARTER = '// Shift+Enter runs this cell.\nprint "Hello, MiniScript!"';

function codeCell(source) {
	return new vscode.NotebookCellData(vscode.NotebookCellKind.Code, source, LANGUAGE);
}

// Something a cell drew with `notebook.mermaid(...)` or `notebook.svg(...)`: the helper
// names the type and the session hands over the text, so one output item carries either.
function drawnOutput(draw) {
	return new vscode.NotebookCellOutput([
		vscode.NotebookCellOutputItem.text(draw.text, draw.mime),
	]);
}

// The file is JSON: a list of cells, each one a kind and its source. Markdown cells are
// kept as themselves, so a notebook can explain the code between its cells.
function deserialize(bytes) {
	const text = Buffer.from(bytes).toString("utf8").trim();
	if (!text) return new vscode.NotebookData([codeCell("")]);

	let raw;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		throw new Error(`Not a MiniScript notebook: ${error.message}`);
	}
	if (!raw || !Array.isArray(raw.cells)) {
		throw new Error("Not a MiniScript notebook: it has no cells.");
	}

	const cells = raw.cells.map((cell) => {
		const source = Array.isArray(cell && cell.source)
			? cell.source.join("")
			: String((cell && cell.source) || "");
		return cell && (cell.kind === "markdown" || cell.cell_type === "markdown")
			? new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, source, "markdown")
			: codeCell(source);
	});
	if (!cells.length) cells.push(codeCell(""));
	return new vscode.NotebookData(cells);
}

function serialize(data) {
	const cells = data.cells.map((cell) => ({
		kind: cell.kind === vscode.NotebookCellKind.Markup ? "markdown" : "code",
		language: cell.languageId,
		source: cell.value,
	}));
	return Buffer.from(`${JSON.stringify({ version: 1, cells }, null, "\t")}\n`, "utf8");
}

// resolveInterpreter, projectDirFor and readEnvValue come from extension.js, so a
// notebook finds the interpreter and the project the same way Run MiniScript File and
// the Testing panel do.
function register(context, { resolveInterpreter, projectDirFor, readEnvValue }) {
	const controller = vscode.notebooks.createNotebookController(
		"miniscript2-notebook",
		NOTEBOOK_TYPE,
		"MiniScript 2",
		(cells, notebook, control) => execute(cells, notebook, control)
	);
	controller.supportedLanguages = [LANGUAGE];
	controller.supportsExecutionOrder = true;
	context.subscriptions.push(controller);

	context.subscriptions.push(
		vscode.workspace.registerNotebookSerializer(
			NOTEBOOK_TYPE,
			{ deserializeNotebook: deserialize, serializeNotebook: serialize },
			{ transientOutputs: true }
		)
	);

	// notebook uri -> the interpreter process its cells share.
	const sessions = new Map();
	let order = 0;

	function environment(dir, notebookDir) {
		// A cell imports the way the project's own programs do. The REPL has no script of
		// its own, so the folder next to it is the project folder, and `src` is where this
		// project keeps its modules; MS_IMPORT_PATH in .env overrides both.
		const configured = readEnvValue(dir, "MS_IMPORT_PATH");
		const importPath =
			configured ||
			[...new Set([notebookDir, path.join(dir, "src"), dir])].join(path.delimiter);
		return { ...process.env, MS_IMPORT_PATH: importPath, NO_COLOR: "1" };
	}

	function sessionFor(notebook, dir, interpreter) {
		const key = notebook.uri.toString();
		let session = sessions.get(key);
		if (!session) {
			const file =
				notebook.uri.scheme === "file"
					? notebook.uri.fsPath
					: path.join(dir, "untitled.msnb");
			session = new NotebookSession({
				command: interpreter.command,
				cwd: dir,
				env: environment(dir, path.dirname(file)),
				// The notebook stands in for the entry script a program would have, so
				// a loader that asks `shellArgs` where it was started finds an answer.
				shellArgs: [file],
			});
			sessions.set(key, session);
		}
		return session;
	}

	async function execute(cells, notebook, control) {
		const dir = projectDirFor(notebook.uri);
		const interpreter = resolveInterpreter(dir);

		for (const cell of cells) {
			if (cell.kind !== vscode.NotebookCellKind.Code) continue;

			const execution = control.createNotebookCellExecution(cell);
			execution.executionOrder = ++order;
			execution.start(Date.now());

			if (interpreter.problem) {
				await execution.replaceOutput([
					new vscode.NotebookCellOutput([
						vscode.NotebookCellOutputItem.error(new Error(interpreter.problem)),
					]),
				]);
				execution.end(false, Date.now());
				continue;
			}

			const session = sessionFor(notebook, dir, interpreter);
			const cancellation = execution.token.onCancellationRequested(() => session.stop());
			let printed = "";
			const result = await session.run(cell.document.getText(), (text) => {
				printed += text;
				// The whole of what the cell has printed so far: replaceOutput replaces, so
				// handing over only the newest piece would hide the pieces before it.
				execution.replaceOutput([
					new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stdout(printed)]),
				]);
			});
			cancellation.dispose();

			if (result.success) {
				for (const draw of result.draws || []) await execution.appendOutput(drawnOutput(draw));
				execution.end(true, Date.now());
				continue;
			}
			const outputs = [];
			if (printed) {
				outputs.push(
					new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stdout(printed)])
				);
			}
			for (const draw of result.draws || []) outputs.push(drawnOutput(draw));
			outputs.push(
				new vscode.NotebookCellOutput([
					vscode.NotebookCellOutputItem.error(new Error(result.error)),
				])
			);
			await execution.replaceOutput(outputs);
			execution.end(false, Date.now());
		}
	}

	async function newNotebook() {
		const data = new vscode.NotebookData([codeCell(STARTER)]);
		const notebook = await vscode.workspace.openNotebookDocument(NOTEBOOK_TYPE, data);
		await vscode.window.showNotebookDocument(notebook);
	}

	function restartNotebook() {
		const editor = vscode.window.activeNotebookEditor;
		const notebook = editor ? editor.notebook : undefined;
		if (!notebook || notebook.notebookType !== NOTEBOOK_TYPE) {
			vscode.window.showWarningMessage("Open a MiniScript notebook to restart its session.");
			return;
		}
		const key = notebook.uri.toString();
		const session = sessions.get(key);
		if (session) {
			session.dispose();
			sessions.delete(key);
		}
		vscode.window.showInformationMessage(
			"MiniScript session restarted. The next cell starts with a clean slate."
		);
	}

	context.subscriptions.push(
		vscode.commands.registerCommand("miniscript2.newNotebook", newNotebook),
		vscode.commands.registerCommand("miniscript2.restartNotebook", restartNotebook),
		vscode.workspace.onDidCloseNotebookDocument((notebook) => {
			const key = notebook.uri.toString();
			const session = sessions.get(key);
			if (!session) return;
			session.dispose();
			sessions.delete(key);
		}),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration("miniscript2.interpreterPath")) return;
			for (const session of sessions.values()) session.dispose();
			sessions.clear();
		})
	);

	return { controller, sessions };
}

module.exports = { register, deserialize, serialize };
