// run.js — the three ways a program starts: the file in the editor, the selection inside
// it, and a REPL terminal of one's own. All three are terminals, so a program keeps its
// input, its colours and the keyboard. A selection runs in the REPL, so a name one
// selection defines is there for the next one.

const path = require("path");
const vscode = require("vscode");

const SETTING = "miniscript2.interpreterPath";

function quote(value) {
	return `"${value}"`;
}

// The command line the terminal's shell runs: the interpreter and the file, then whatever
// arguments were typed, exactly as typed — the shell is the one that splits them.
function commandLine(command, file, args) {
	const parts = [quote(command), quote(file)];
	if (args && args.trim()) parts.push(args.trim());
	return parts.join(" ");
}

function register(context, { resolveInterpreter, projectDirFor, readEnvValue }) {
	// The terminal a selection runs in. The next selection shares it, so the REPL is worth
	// keeping until the user closes it.
	let repl;

	function projectFolder() {
		const editor = vscode.window.activeTextEditor;
		if (editor) return projectDirFor(editor.document.uri);
		const folders = vscode.workspace.workspaceFolders;
		return folders && folders.length ? folders[0].uri.fsPath : process.cwd();
	}

	// A program with no file of its own imports the way a notebook cell does: this
	// project's `src` and the project folder, unless `.env` says otherwise.
	function terminalEnv(dir) {
		const configured = readEnvValue(dir, "MS_IMPORT_PATH");
		return {
			...process.env,
			MS_IMPORT_PATH:
				configured || [...new Set([path.join(dir, "src"), dir])].join(path.delimiter),
		};
	}

	async function interpreterFor(dir) {
		const interpreter = resolveInterpreter(dir);
		if (!interpreter.problem) return interpreter;
		const openSettings = "Open Settings";
		const choice = await vscode.window.showErrorMessage(interpreter.problem, openSettings);
		if (choice === openSettings) {
			await vscode.commands.executeCommand("workbench.action.openSettings", SETTING);
		}
		return undefined;
	}

	async function runFile(args) {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== "miniscript") {
			vscode.window.showWarningMessage("Open a MiniScript file to run it.");
			return;
		}

		const document = editor.document;
		if (document.isDirty && !(await document.save())) {
			vscode.window.showWarningMessage(
				`Could not save ${path.basename(document.uri.fsPath)}; not running it.`
			);
			return;
		}

		const dir = projectDirFor(document.uri);
		const interpreter = await interpreterFor(dir);
		if (!interpreter) return;

		const terminal = vscode.window.createTerminal({
			name: `MiniScript: ${path.basename(document.uri.fsPath)}`,
			cwd: dir,
		});
		terminal.show();
		terminal.sendText(commandLine(interpreter.command, document.uri.fsPath, args));
	}

	async function runFileWithArguments() {
		const args = await vscode.window.showInputBox({
			title: "Run MiniScript File with Arguments",
			prompt: "Arguments after the file; the program reads them from shellArgs.",
			placeHolder: "for example: --fast one",
		});
		if (args === undefined) return; // cancelled
		await runFile(args);
	}

	function replFor(dir, interpreter) {
		if (repl) return repl;
		repl = vscode.window.createTerminal({
			name: "MiniScript REPL",
			shellPath: interpreter.command,
			cwd: dir,
			env: terminalEnv(dir),
		});
		repl.show();
		return repl;
	}

	async function startRepl() {
		const dir = projectFolder();
		const interpreter = await interpreterFor(dir);
		if (!interpreter) return;
		replFor(dir, interpreter);
	}

	async function runSelection() {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== "miniscript") {
			vscode.window.showWarningMessage("Open a MiniScript file to run part of it.");
			return;
		}

		const source = editor.selection.isEmpty
			? ""
			: editor.document.getText(editor.selection);
		if (!source.trim()) {
			vscode.window.showWarningMessage("Select the MiniScript code to run.");
			return;
		}

		const dir = projectDirFor(editor.document.uri);
		const interpreter = await interpreterFor(dir);
		if (!interpreter) return;

		const terminal = replFor(dir, interpreter);
		terminal.show();
		// The REPL reads blocks a line at a time, so a multi-line selection is handed to it
		// as it stands; no shell sees the quotes inside it.
		terminal.sendText(source.trimEnd());
	}

	context.subscriptions.push(
		vscode.window.onDidCloseTerminal((terminal) => {
			if (terminal === repl) repl = undefined;
		}),
		vscode.commands.registerCommand("miniscript2.runFile", () => runFile("")),
		vscode.commands.registerCommand(
			"miniscript2.runFileWithArguments",
			runFileWithArguments
		),
		vscode.commands.registerCommand("miniscript2.runSelection", runSelection),
		vscode.commands.registerCommand("miniscript2.startRepl", startRepl)
	);
}

module.exports = { register, commandLine };
