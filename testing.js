// The suite in VS Code's Testing panel.
//
// The suite is a MiniScript program, so it is discovered by running it once: with
// --json, the suite's harness prints a `##TEST {...}` line per check (its name, status,
// file and line) and a closing `##END {...}` line. Those records become the items in the
// Test Explorer, and a run is the same program narrowed by --filter (a substring of a
// check's name) and --file (a case module).

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

const DEFAULT_SUITE = "test/run.ms";
// How long after the last save the panel asks the suite for its checks again.
const REFRESH = 300;

function parseRecord(text) {
	try {
		const value = JSON.parse(text);
		return value && typeof value === "object" ? value : undefined;
	} catch {
		return undefined;
	}
}

// Runs `suite` in `folder`, handing every line to `onLine` with its parsed record for a
// ##TEST line and undefined for anything else. Resolves with the ##END totals (absent
// when the run stopped early), the exit code, any spawn error and whatever went to
// stderr.
function spawnSuite({ command, suite, folder, args, token, onLine }) {
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn(command, [suite, ...args], { cwd: folder, windowsHide: true });
		} catch (error) {
			resolve({ error });
			return;
		}

		let end;
		let buffer = "";
		let stderr = "";
		let settled = false;

		const handle = (line) => {
			if (line.startsWith("##TEST ")) {
				onLine(line, parseRecord(line.slice(7)));
				return;
			}
			if (line.startsWith("##END ")) {
				end = parseRecord(line.slice(6)) || {};
				return;
			}
			onLine(line, undefined);
		};

		const read = (chunk) => {
			buffer += chunk;
			let at;
			while ((at = buffer.indexOf("\n")) >= 0) {
				handle(buffer.slice(0, at).replace(/\r$/, ""));
				buffer = buffer.slice(at + 1);
			}
		};

		const cancellation = token
			? token.onCancellationRequested(() => child.kill())
			: undefined;

		const finish = (code, error) => {
			if (settled) return;
			settled = true;
			if (cancellation) cancellation.dispose();
			if (buffer) {
				handle(buffer.replace(/\r$/, ""));
				buffer = "";
			}
			resolve({ end, code, error, stderr });
		};

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", read);
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => finish(undefined, error));
		child.on("close", (code) => finish(code));
	});
}

// resolveInterpreter(dir) comes from extension.js, so the parser, the logger and the
// tests all find the interpreter the same way.
function register(context, { resolveInterpreter }) {
	const controller = vscode.tests.createTestController("miniscript2", "MiniScript 2");
	context.subscriptions.push(controller);

	// item -> { folder, suite, file, line, name }, and workspace folder -> its group.
	const details = new WeakMap();
	const groups = new Map();

	function suitePath(folder) {
		const configured = String(
			vscode.workspace
				.getConfiguration("miniscript2", folder.uri)
				.get("testSuite", DEFAULT_SUITE) || ""
		).trim();
		return path.resolve(folder.uri.fsPath, configured || DEFAULT_SUITE);
	}

	async function sourcePath(folder, suite, name, group) {
		if (!name) return undefined;
		if (group.paths.has(name)) return group.paths.get(name);
		const beside = path.join(path.dirname(suite), name);
		let found = beside;
		if (!fs.existsSync(beside)) {
			// Module names are basenames, so a case module away from the suite is looked
			// up by name; the first match wins.
			const matches = await vscode.workspace.findFiles(
				new vscode.RelativePattern(folder, `**/${name}`),
				"**/node_modules/**",
				1
			);
			found = matches.length ? matches[0].fsPath : undefined;
		}
		group.paths.set(name, found);
		return found;
	}

	async function discover(folder, suite) {
		const root = controller.createTestItem(
			`folder:${folder.uri.fsPath}`,
			folder.name,
			folder.uri
		);
		details.set(root, { folder, suite });
		controller.items.add(root);

		const group = {
			root,
			folder,
			suite,
			byName: new Map(),
			files: new Map(),
			paths: new Map(),
		};
		groups.set(folder.uri.fsPath, group);
		await fill(group);
	}

	// One discovery at a time per folder: a save during a discovery queues the next one
	// instead of starting a second run of the suite alongside it.
	function fill(group) {
		group.filling = (group.filling || Promise.resolve())
			.then(() => fillNow(group))
			.catch(() => {});
		return group.filling;
	}

	// The checks the suite reports, as the group's tree. A check still in the suite keeps
	// its item - and the last run's mark with it - so a save that changes nothing about the
	// checks does not empty the panel; one that moved keeps its item and its line moves; one
	// that is gone leaves. Nothing is replaced unless the suite answered, so a discovery
	// that fails leaves the last good tree in place.
	async function fillNow(group) {
		const { folder, suite } = group;
		const interpreter = resolveInterpreter(folder.uri.fsPath);
		if (interpreter.problem) return;

		const records = [];
		const result = await spawnSuite({
			command: interpreter.command,
			suite,
			folder: folder.uri.fsPath,
			args: ["--json"],
			onLine: (line, record) => {
				if (record && record.name) records.push(record);
			},
		});
		if (result.error) return;

		// A case module may have moved or appeared since the last discovery.
		group.paths.clear();

		const kept = new Set();
		const present = new Set();
		const byName = new Map();
		const used = new Set();

		for (const record of records) {
			const file = await sourcePath(folder, suite, record.file, group);
			const line = typeof record.line === "number" ? record.line : 0;
			const key = file || record.file || "";
			present.add(key);

			let fileItem = group.files.get(key);
			if (!fileItem) {
				fileItem = controller.createTestItem(
					`file:${key}`,
					file ? path.basename(file) : record.file || "suite",
					file ? vscode.Uri.file(file) : undefined
				);
				details.set(fileItem, { folder, suite, file });
				group.files.set(key, fileItem);
				group.root.children.add(fileItem);
			}

			// The same check, if one of this file's items already has its name.
			let test = [...fileItem.children].find(
				(child) => !kept.has(child) && (details.get(child) || {}).name === record.name
			);
			if (test) {
				const detail = details.get(test);
				if (line > 0 && detail.line !== line) {
					detail.line = line;
					test.range = new vscode.Range(line - 1, 0, line - 1, 0);
				}
				used.add(test.id);
			} else {
				const base = `test:${record.file}|${line}|${record.name}`;
				let id = base;
				for (let n = 2; used.has(id); n += 1) id = `${base}#${n}`;
				used.add(id);
				test = controller.createTestItem(
					id,
					record.name,
					file ? vscode.Uri.file(file) : undefined
				);
				if (line > 0) test.range = new vscode.Range(line - 1, 0, line - 1, 0);
				details.set(test, { folder, suite, file, line, name: record.name });
				fileItem.children.add(test);
			}

			kept.add(test);
			const named = byName.get(record.name) || [];
			named.push(test);
			byName.set(record.name, named);
		}

		// Whatever the suite no longer reports goes, file items with nothing left included.
		for (const [key, fileItem] of [...group.files]) {
			if (!present.has(key)) {
				group.root.children.delete(fileItem);
				group.files.delete(key);
				continue;
			}
			for (const child of [...fileItem.children]) {
				if (!kept.has(child)) fileItem.children.delete(child);
			}
		}
		group.byName = byName;
	}

	// The checks live in the suite and in the case modules it reports; a save to any other
	// program cannot change the list, so it is none of the panel's business. The panel asks
	// again once the editing settles, instead of waiting for the window to be reloaded.
	const waiting = new Map();

	function relevant(group, changed) {
		if (!changed) return false;
		const file = path.normalize(changed);
		if (file === path.normalize(group.suite)) return true;
		for (const key of group.files.keys()) {
			if (path.isAbsolute(key) && path.normalize(key) === file) return true;
		}
		return false;
	}

	function watch(folder) {
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(folder, "**/*.ms")
		);
		const touched = (uri) => {
			const key = folder.uri.fsPath;
			const group = groups.get(key);
			if (!group || !relevant(group, uri && uri.fsPath)) return;
			// A run owns the interpreter; a save during one is left for the next save.
			if (group.running) return;
			const timer = waiting.get(key);
			if (timer) clearTimeout(timer);
			waiting.set(
				key,
				setTimeout(() => {
					waiting.delete(key);
					const group = groups.get(key);
					if (group && !group.running) fill(group);
				}, REFRESH)
			);
		};
		watcher.onDidChange(touched);
		watcher.onDidCreate(touched);
		watcher.onDidDelete(touched);
		context.subscriptions.push(watcher);
	}

	controller.resolveHandler = async (item) => {
		if (item) return;
		for (const folder of vscode.workspace.workspaceFolders || []) {
			if (groups.has(folder.uri.fsPath)) continue;
			const suite = suitePath(folder);
			if (suite && fs.existsSync(suite)) {
				await discover(folder, suite);
				watch(folder);
			}
		}
	};

	function* everyItem(group) {
		for (const fileItem of group.files.values()) {
			for (const child of fileItem.children) yield child;
		}
	}

	function failMessage(item, record) {
		const message = new vscode.TestMessage(`FAIL  ${record.name}`);
		if (item.uri) {
			message.location = new vscode.Location(
				item.uri,
				item.range || new vscode.Range(0, 0, 0, 0)
			);
		}
		return message;
	}

	function collect(request) {
		const targets = new Map();
		const target = (folder, group) => {
			let found = targets.get(folder.uri.fsPath);
			if (!found) {
				found = {
					group,
					all: false,
					items: new Set(),
					filters: new Set(),
					files: new Set(),
				};
				targets.set(folder.uri.fsPath, found);
			}
			return found;
		};

		const included = request.include ? [...request.include] : [];
		for (const item of included) {
			const detail = details.get(item);
			if (!detail) continue;
			const group = groups.get(detail.folder.uri.fsPath);
			if (!group) continue;
			const found = target(detail.folder, group);
			if (item === group.root) {
				found.all = true;
			} else if (detail.name === undefined) {
				if (detail.file) found.files.add(path.basename(detail.file));
				for (const child of item.children) found.items.add(child);
			} else {
				found.filters.add(detail.name);
				found.items.add(item);
			}
		}

		if (included.length === 0) {
			for (const group of groups.values()) {
				targets.set(group.folder.uri.fsPath, {
					group,
					all: true,
					items: new Set(),
					filters: new Set(),
					files: new Set(),
				});
			}
		}
		return [...targets.values()];
	}

	// A discovered check's line is only as fresh as the last discovery, so editing a case
	// file shifts every record after the edit. Match on the name, preferring an item known
	// at the reported line and then in the reported file, so two checks that share a name
	// stay apart; then move that item to the line the check reported itself at, which keeps
	// the gutter on the check and the next run's match exact.
	function locate(group, record, taken) {
		const free = (group.byName.get(record.name) || []).filter((seen) => !taken.has(seen));
		if (!free.length) return undefined;

		const where = (item) => details.get(item) || {};
		const item =
			free.find((candidate) => where(candidate).line === record.line) ||
			free.find((candidate) => path.basename(where(candidate).file || "") === record.file) ||
			free[0];

		const detail = details.get(item);
		if (detail && typeof record.line === "number" && record.line !== detail.line) {
			detail.line = record.line;
			item.range =
				record.line > 0
					? new vscode.Range(record.line - 1, 0, record.line - 1, 0)
					: undefined;
		}
		return item;
	}

	async function runGroup(run, target, token) {
		const { group } = target;
		group.running = true;
		try {
			await runSuite(run, target, token);
		} finally {
			group.running = false;
		}
	}

	async function runSuite(run, target, token) {
		const { group } = target;
		const interpreter = resolveInterpreter(group.folder.uri.fsPath);
		if (interpreter.problem) {
			const message = new vscode.TestMessage(interpreter.problem);
			for (const item of everyItem(group)) run.errored(item, message);
			return;
		}

		const args = ["--json"];
		for (const file of target.files) args.push("--file", file);
		for (const filter of target.filters) args.push("--filter", filter);

		const seen = new Set();
		const wanted = target.all ? undefined : target.items;
		const result = await spawnSuite({
			command: interpreter.command,
			suite: group.suite,
			folder: group.folder.uri.fsPath,
			args,
			token,
			onLine: (text, record) => {
				const item = record ? locate(group, record, seen) : undefined;
				// A filter is a substring, so the suite runs the checks that merely hold
				// the name as well: only the ones asked for get a result.
				if (!item || (wanted && !wanted.has(item))) {
					run.appendOutput(`${text}\r\n`);
					return;
				}
				seen.add(item);
				if (record.status === "pass") {
					run.passed(item);
				} else {
					run.failed(item, failMessage(item, record));
				}
			},
		});

		if (result.stderr && result.stderr.trim()) {
			run.appendOutput(result.stderr.replace(/\r?\n/g, "\r\n"));
		}

		if (token.isCancellationRequested) return;

		if (!result.end) {
			// The interpreter exits 0 even when an uncaught error stops the program, so a
			// check with no record did not run: it is not a pass.
			const message = new vscode.TestMessage(
				result.error
					? `Could not run ${interpreter.command}: ${result.error.message}`
					: "The suite stopped before this check was recorded."
			);
			const affected = wanted ? [...wanted] : [...everyItem(group)];
			for (const item of affected) {
				if (!seen.has(item)) run.errored(item, message);
			}
			return;
		}

		// The panel counts items; the suite is the authority on what it ran, and its skipped
		// total has no item of its own to land on, so it is written where a run's text goes.
		run.appendOutput(
			`${group.folder.name}: ${result.end.passed ?? 0} passed, ` +
				`${result.end.failed ?? 0} failed, ${result.end.skipped ?? 0} skipped\r\n`
		);

		for (const item of target.items) {
			if (!seen.has(item)) run.skipped(item);
		}
	}

	async function execute(request, token) {
		const run = controller.createTestRun(request);
		try {
			for (const target of collect(request)) {
				if (token.isCancellationRequested) break;
				await runGroup(run, target, token);
			}
		} finally {
			run.end();
		}
	}

	controller.createRunProfile(
		"Run",
		vscode.TestRunProfileKind.Run,
		(request, token) => execute(request, token),
		true
	);

	return controller;
}

module.exports = { register };
