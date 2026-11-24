const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const testing = require("./testing");
const features = require("./features");
const notebook = require("./notebook");
const run = require("./run");

const SETTING = "miniscript2.interpreterPath";
const ENV_VAR = "MINISCRIPT_EXE_PATH";
const DEFAULT_INTERPRETER = "miniscript";

// The folder a file belongs to: its workspace folder, the folder it sits in, or the first
// workspace folder for a document that has no file yet, such as a new notebook.
function projectDirFor(uri) {
	const folder = vscode.workspace.getWorkspaceFolder(uri);
	if (folder) return folder.uri.fsPath;
	if (uri.scheme === "file") return path.dirname(uri.fsPath);
	const folders = vscode.workspace.workspaceFolders;
	return folders && folders.length ? folders[0].uri.fsPath : process.cwd();
}

// Reads KEY=value from the project's .env, the same file run.bat uses, so the
// interpreter path only has to be configured in one place.
function readEnvValue(dir, key) {
	let text;
	try {
		text = fs.readFileSync(path.join(dir, ".env"), "utf8");
	} catch {
		return undefined;
	}
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const equals = line.indexOf("=");
		if (equals < 0) continue;
		if (line.slice(0, equals).trim() !== key) continue;
		let value = line.slice(equals + 1).trim();
		if (
			value.length >= 2 &&
			((value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'")))
		) {
			value = value.slice(1, -1);
		}
		return value || undefined;
	}
	return undefined;
}

function findOnPath(name) {
	const dirs = String(process.env.PATH || "")
		.split(path.delimiter)
		.filter(Boolean);
	const candidates =
		process.platform === "win32"
			? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name]
			: [name];
	for (const dir of dirs) {
		for (const candidate of candidates) {
			const full = path.join(dir, candidate);
			try {
				if (fs.statSync(full).isFile()) return full;
			} catch {
				// Not in this directory; keep looking.
			}
		}
	}
	return undefined;
}

function resolveInterpreter(dir) {
	const configured = String(
		vscode.workspace.getConfiguration("miniscript2").get("interpreterPath", "") || ""
	).trim();
	if (configured) {
		const resolved = path.resolve(dir, configured);
		if (fs.existsSync(resolved)) return { command: resolved };
		return {
			problem: `${SETTING} points at ${configured}, which does not exist.`,
		};
	}

	const fromEnv = readEnvValue(dir, ENV_VAR);
	if (fromEnv) {
		const resolved = path.resolve(dir, fromEnv);
		if (fs.existsSync(resolved)) return { command: resolved };
		return {
			problem: `${ENV_VAR} in .env points at ${fromEnv}, which does not exist.`,
		};
	}

	const onPath = findOnPath(DEFAULT_INTERPRETER);
	if (onPath) return { command: onPath };

	return {
		problem:
			`No MiniScript interpreter configured. Set ${SETTING}, ` +
			`or add ${ENV_VAR}=<path to miniscript.exe> to ${path.join(dir, ".env")}.`,
	};
}

function activate(context) {
	run.register(context, { resolveInterpreter, projectDirFor, readEnvValue });
	testing.register(context, { resolveInterpreter });
	features.register(context);
	notebook.register(context, { resolveInterpreter, projectDirFor, readEnvValue });
}

function deactivate() {}

module.exports = { activate, deactivate };
