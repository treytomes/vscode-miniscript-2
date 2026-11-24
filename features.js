// features.js — the VS Code side of symbols.js: the hover tooltip, Go to Definition
// (Ctrl-click) and the Outline view. The scan is in symbols.js, the language's own
// intrinsics in builtins.js, so this file only turns those records into what the providers
// return.

const path = require("path");
const vscode = require("vscode");
const builtins = require("./builtins");
const { KEYWORDS, SCOPES, inLiteral, innermost, locate, scan, typeOf } = require("./symbols");

const WORD = /[A-Za-z_][A-Za-z0-9_]*/;
const IMPORT = /^[ \t]*import[ \t]+"([^"]+)"/;
const SELECTOR = [
	{ language: "miniscript", scheme: "file" },
	{ language: "miniscript", scheme: "untitled" },
];

const KINDS = {
	function: vscode.SymbolKind.Function,
	method: vscode.SymbolKind.Method,
	class: vscode.SymbolKind.Class,
	variable: vscode.SymbolKind.Variable,
	parameter: vscode.SymbolKind.Variable,
};

// `globals.x` is this file's own x, and self/super/locals/outer name a map whose contents
// the scan cannot know; none of them is a receiver to look a method up on.
function qualifier(receiver) {
	return receiver === "globals" || SCOPES.has(receiver) ? undefined : receiver;
}

function receiverBefore(before) {
	const match = /([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*$/.exec(before);
	return match ? match[1] : undefined;
}

// `import "api/client"` makes `client` a name for that file's globals. The string's span is
// kept so that a position inside it can be told from one on the line.
function importOf(text) {
	const match = IMPORT.exec(text);
	if (!match) return undefined;
	const start = text.indexOf('"') + 1;
	return {
		path: match[1],
		alias: match[1].split("/").pop(),
		start,
		end: start + match[1].length,
	};
}

function importsOf(text) {
	const imports = new Map();
	for (const line of text.split(/\r?\n/)) {
		const found = importOf(line);
		if (found) imports.set(found.alias, found.path);
	}
	return imports;
}

// Symbols of open documents, of files read from disk, the module name -> file lookup, and
// what the workspace search found, so a hover or a Ctrl-click does not re-read the project
// each time.
function createIndex() {
	const documents = new WeakMap();
	const files = new Map();
	const modules = new Map();
	const searches = new Map();

	function forDocument(document) {
		const seen = documents.get(document);
		if (seen && seen.version === document.version) return seen.symbols;
		const found = scan(document.getText());
		documents.set(document, { version: document.version, symbols: found });
		return found;
	}

	async function forUri(uri) {
		const key = uri.toString();
		if (files.has(key)) return files.get(key);
		let found = [];
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			found = scan(Buffer.from(bytes).toString("utf8"));
		} catch {
			// A file that cannot be read has no definitions; remember that and move on.
		}
		files.set(key, found);
		return found;
	}

	async function moduleUri(target) {
		if (modules.has(target)) return modules.get(target);
		const matches = await vscode.workspace.findFiles(
			`**/${target}.ms`,
			"**/node_modules/**",
			5
		);
		const uri = matches.length ? matches[0] : undefined;
		modules.set(target, uri);
		return uri;
	}

	async function search(name, receiver, skip) {
		const key = `${receiver || ""}.${name}@${skip ? skip.toString() : ""}`;
		if (searches.has(key)) return searches.get(key);
		const results = [];
		const uris = await vscode.workspace.findFiles("**/*.ms", "**/node_modules/**", 200);
		for (const uri of uris) {
			if (skip && skip.toString() === uri.toString()) continue;
			const found = await forUri(uri);
			const hit = found.find(
				(symbol) =>
					symbol.name === name &&
					!symbol.container &&
					(receiver === undefined ? !symbol.receiver : symbol.receiver === receiver)
			);
			if (hit) results.push({ uri, symbol: hit });
			if (results.length >= 20) break;
		}
		searches.set(key, results);
		return results;
	}

	function forget(uri) {
		files.delete(uri.toString());
	}

	function forgetWorkspace() {
		files.clear();
		modules.clear();
		searches.clear();
	}

	return { forDocument, forUri, moduleUri, search, forget, forgetWorkspace };
}

function moduleSymbol(name, target) {
	return {
		name,
		kind: "module",
		line: 0,
		character: 0,
		signature: `import "${target}"`,
		comment: `Imports ${target}.ms.`,
	};
}

function nameRange(symbol) {
	const line = symbol.line || 0;
	const character = symbol.character || 0;
	return new vscode.Range(line, character, line, character + symbol.name.length);
}

// The tooltip for an intrinsic. It has no file, so it carries no line: Ctrl-click on one
// finds nothing to open, which is right, since the file does not define it.
function builtinMember(name, receiver, variants) {
	let signature;
	let doc;
	if (variants.length === 1) {
		signature = `${receiver}.${variants[0].call}`;
		doc = variants[0].note;
	} else {
		// The value's type could not be read, so every type that has the member is shown.
		signature = variants.map((variant) => `${variant.type}.${variant.call}`).join("\n");
		doc = variants.map((variant) => `- \`${variant.type}\`: ${variant.note}`).join("\n");
	}
	return { name, kind: "intrinsic", signature, doc };
}

// What `receiver.name` is: a method of that receiver in this file, then one in the module
// the receiver is an import of, then an intrinsic of the receiver's type, then a method of
// that name anywhere in the workspace.
async function method(document, index, here, imports, { name, receiver, line }) {
	const known = qualifier(receiver);

	const own =
		locate(here, { name, receiver: known, line }) ||
		(known === undefined && receiver !== "globals"
			? here.find((candidate) => candidate.name === name && candidate.receiver)
			: undefined);
	if (own) return [{ uri: document.uri, symbol: own }];

	if (known) {
		const target = imports.get(known);
		if (target) {
			const uri = await index.moduleUri(target);
			const found = uri && locate(await index.forUri(uri), { name, line: 0 });
			if (found) return [{ uri, symbol: found }];
		}
	}

	// globals, locals, outer, self and super are all maps: a name on one that this file
	// does not define can only be the map's own member.
	const variants = builtins.member(
		name,
		known === undefined ? "map" : typeOf(here, { name: known, line })
	);
	if (variants.length) return [{ symbol: builtinMember(name, known || receiver, variants) }];

	return known ? index.search(name, known, document.uri) : [];
}

// Every place the name under the cursor could mean, best first: this file (a local or
// parameter before a top-level name), the module an import names, an intrinsic, then the
// rest of the workspace. A match with no `uri` is an intrinsic, which has no file. Empty
// when the position is not on a name that has a definition.
async function find(document, position, index) {
	const text = document.getText();

	if (inLiteral(text, position.line, position.character)) {
		const target = importOf(document.lineAt(position.line).text);
		if (!target) return [];
		const uri = await index.moduleUri(target.path);
		return uri ? [{ uri, symbol: moduleSymbol(target.alias, target.path) }] : [];
	}

	const range = document.getWordRangeAtPosition(position, WORD);
	if (!range) return [];
	const name = document.getText(range);
	if (KEYWORDS.has(name)) return [];

	const before = document.lineAt(position.line).text.slice(0, range.start.character);
	const receiver = receiverBefore(before);
	const here = index.forDocument(document);
	const imports = importsOf(text);

	if (receiver) return method(document, index, here, imports, { name, receiver, line: position.line });

	const symbol = locate(here, { name, line: position.line });
	if (symbol) return [{ uri: document.uri, symbol }];

	if (imports.has(name)) {
		const uri = await index.moduleUri(imports.get(name));
		if (uri) return [{ uri, symbol: moduleSymbol(name, imports.get(name)) }];
	}

	const intrinsic = builtins.global(name);
	if (intrinsic) return [{ symbol: intrinsic }];

	return index.search(name, undefined, document.uri);
}

function definition(document, position, index) {
	return find(document, position, index).then((matches) =>
		matches
			.filter((match) => match.uri)
			.map(({ uri, symbol }) => new vscode.Location(uri, nameRange(symbol)))
	);
}

function hover(document, position, index) {
	return find(document, position, index).then((matches) => {
		if (!matches.length) return undefined;
		const { uri, symbol } = matches[0];
		const markdown = new vscode.MarkdownString();
		markdown.appendCodeblock(symbol.signature || symbol.name, "miniscript");
		const note = symbol.doc || symbol.comment;
		if (note) markdown.appendMarkdown(`\n${note}\n`);
		if (symbol.kind === "parameter") {
			markdown.appendMarkdown(`\n*parameter of \`${symbol.container}\`*`);
		}
		const where = uri ? `${path.basename(uri.fsPath)}:${symbol.line + 1}` : "MiniScript 2";
		markdown.appendMarkdown(`\n<sub>${symbol.kind} · ${where}</sub>`);
		return new vscode.Hover(markdown, document.getWordRangeAtPosition(position, WORD));
	});
}

function rangeOf(document, symbol) {
	const last = Math.min(
		symbol.endLine === undefined ? symbol.line : symbol.endLine,
		document.lineCount - 1
	);
	return new vscode.Range(symbol.line, 0, last, document.lineAt(last).text.length);
}

// The class or function a symbol belongs to, for nesting the Outline tree. A method sits
// under its class even though the class's own line does not hold it.
function parentOf(symbol, symbols) {
	const parent = innermost(symbols, symbol.line, { skip: symbol });
	if (parent) return parent;
	if (symbol.receiver) {
		return symbols.find(
			(candidate) => candidate.name === symbol.receiver && candidate.kind === "class"
		);
	}
	return undefined;
}

function outline(document, index) {
	const found = index.forDocument(document);
	// Parameters and locals would bury the functions in the tree, so only what a file
	// offers the rest of the project is listed.
	const listed = found.filter(
		(symbol) => symbol.kind !== "parameter" && !(symbol.kind === "variable" && symbol.container)
	);
	const items = new Map();
	for (const symbol of listed) {
		items.set(
			symbol,
			new vscode.DocumentSymbol(
				symbol.name,
				symbol.kind,
				KINDS[symbol.kind] || vscode.SymbolKind.Variable,
				rangeOf(document, symbol),
				nameRange(symbol)
			)
		);
	}
	const roots = [];
	for (const symbol of listed) {
		const parent = parentOf(symbol, listed);
		if (parent && items.has(parent)) items.get(parent).children.push(items.get(symbol));
		else roots.push(items.get(symbol));
	}
	return roots;
}

function register(context) {
	const index = createIndex();

	context.subscriptions.push(
		vscode.languages.registerHoverProvider(SELECTOR, {
			provideHover: (document, position) => hover(document, position, index),
		}),
		vscode.languages.registerDefinitionProvider(SELECTOR, {
			provideDefinition: (document, position) => definition(document, position, index),
		}),
		vscode.languages.registerDocumentSymbolProvider(SELECTOR, {
			provideDocumentSymbols: (document) => outline(document, index),
		}),
		vscode.workspace.onDidChangeTextDocument((event) => index.forget(event.document.uri)),
		vscode.workspace.onDidSaveTextDocument(() => index.forgetWorkspace()),
		vscode.workspace.onDidCreateFiles(() => index.forgetWorkspace()),
		vscode.workspace.onDidDeleteFiles(() => index.forgetWorkspace())
	);

	return index;
}

module.exports = { register };
