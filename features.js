// features.js — the VS Code side of symbols.js: the hover tooltip, Go to Definition
// (Ctrl-click), the Outline view, completion, the parameters of the call being written,
// and the squiggles lint.js finds shown in a DiagnosticCollection, with the quick fix for
// each one that has a certain repair. The scan is in symbols.js, the language's own
// intrinsics in builtins.js, so this file only turns those records into what the providers
// return.

const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const builtins = require("./builtins");
const { lint, importTargets } = require("./lint");
const {
	KEYWORDS,
	SCOPES,
	classOf,
	inLiteral,
	innermost,
	locate,
	scan,
	tokenize,
	typeOf,
} = require("./symbols");

const WORD = /[A-Za-z_][A-Za-z0-9_]*/;
const IMPORT = /^[ \t]*import[ \t]+"([^"]+)"/;
// A notebook cell is a MiniScript document too, under the scheme VS Code gives one, so
// everything these providers answer is answered in a cell as well as in a file.
const SELECTOR = [
	{ language: "miniscript", scheme: "file" },
	{ language: "miniscript", scheme: "untitled" },
	{ language: "miniscript", scheme: "vscode-notebook-cell" },
];

const KINDS = {
	function: vscode.SymbolKind.Function,
	method: vscode.SymbolKind.Method,
	class: vscode.SymbolKind.Class,
	variable: vscode.SymbolKind.Variable,
	parameter: vscode.SymbolKind.Variable,
};

const COMPLETION_KINDS = {
	function: vscode.CompletionItemKind.Function,
	method: vscode.CompletionItemKind.Method,
	class: vscode.CompletionItemKind.Class,
	variable: vscode.CompletionItemKind.Variable,
	parameter: vscode.CompletionItemKind.Variable,
};

// The kinds of symbol whose body spans lines, so a position can be read as inside one.
const FUNCTION_KINDS = new Set(["function", "method"]);

// What a receiver can have: its methods, and the fields a constructor sets on it.
const MEMBER_KINDS = new Set(["method", "field"]);

// What the editor colors, and what each one means: the kinds of name the file itself
// defines, plus the language's own names, which no file defines. The theme chooses the
// colors; the legend says which type each name is, and `defaultLibrary` marks an intrinsic
// for a theme that wants it told apart from the project's own functions.
const TOKEN_TYPES = ["class", "function", "method", "parameter", "variable", "intrinsic"];
const TOKEN_MODIFIERS = ["declaration", "defaultLibrary"];
const TOKEN_TYPE = new Map(TOKEN_TYPES.map((type, index) => [type, index]));
const TOKEN_LEGEND = new vscode.SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS);
const DECLARED = 1 << TOKEN_MODIFIERS.indexOf("declaration");
const DEFAULT_LIBRARY = 1 << TOKEN_MODIFIERS.indexOf("defaultLibrary");

// `globals.x` is this file's own x, and self/super/locals/outer name a map whose contents
// the scan cannot know; none of them is a receiver to look a method up on.
function qualifier(receiver) {
	return receiver === "globals" || SCOPES.has(receiver) ? undefined : receiver;
}

// The innermost method whose body holds this line: the class `self` and `super` reach from
// here. A plain function nested inside a method has no receiver, so it is skipped.
function enclosingMethod(symbols, line) {
	const owners = symbols.filter(
		(symbol) =>
			FUNCTION_KINDS.has(symbol.kind) &&
			symbol.receiver &&
			symbol.line <= line &&
			(symbol.endLine === undefined || symbol.endLine >= line)
	);
	return owners[owners.length - 1];
}

// The member a receiver's name means, read the way hover, completion and the scans all
// read it: the receiver's own member when the file gave one, `self`/`super` reaching the
// enclosing method's class, and `sq = new Shape` reaching the class that made `sq`.
function methodAt(symbols, receiver, name, line) {
	if (!receiver) return undefined;
	if (receiver === "self" || receiver === "super") {
		const owner = enclosingMethod(symbols, line);
		return owner && owner.receiver
			? locate(symbols, { name, receiver: owner.receiver, line })
			: undefined;
	}
	const own = locate(symbols, { name, receiver, line });
	if (own) return own;
	const made = classOf(symbols, { name: receiver, line });
	return made ? locate(symbols, { name, receiver: made, line }) : undefined;
}

// The receiver written in front of the word under the cursor, when the word is a member.
function receiverOf(document, position, range) {
	const before = document.lineAt(position.line).text.slice(0, range.start.character);
	const match = /([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*$/.exec(before);
	return match ? match[1] : undefined;
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
	let listing;

	function forDocument(document) {
		const seen = documents.get(document);
		if (seen && seen.version === document.version) return seen.symbols;
		const found = scan(document.getText());
		documents.set(document, { version: document.version, symbols: found });
		return found;
	}

	// A document the editor has open is read as it stands, unsaved edits included; a file it
	// has not opened is read from disk once and remembered.
	function editing(uri) {
		const key = uri.toString();
		return (vscode.workspace.textDocuments || []).find(
			(document) => document.uri.toString() === key
		);
	}

	async function sourceOf(uri) {
		const open = editing(uri);
		if (open) return { text: open.getText(), symbols: forDocument(open) };
		const key = uri.toString();
		if (files.has(key)) return files.get(key);
		let text = "";
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			text = Buffer.from(bytes).toString("utf8");
		} catch {
			// A file that cannot be read has no definitions; remember that and move on.
		}
		const found = { text, symbols: scan(text) };
		files.set(key, found);
		return found;
	}

	async function forUri(uri) {
		return (await sourceOf(uri)).symbols;
	}

	// Every `.ms` file in the workspace, asked for once and remembered until a save or a
	// file added or removed says the list may have changed.
	function workspaceUris() {
		if (!listing) listing = vscode.workspace.findFiles("**/*.ms", "**/node_modules/**", 500);
		return listing;
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

	// The file an import names: a module looked up by name for `"lib"`, and for a path
	// (`"../src/triples"`) the workspace file that path resolves to beside the importing
	// file, which is how the interpreter reads one.
	async function target(fromUri, spec) {
		if (!spec.startsWith(".")) return moduleUri(spec);
		const folder = fromUri && fromUri.scheme === "file" ? path.dirname(fromUri.fsPath) : undefined;
		if (!folder) return undefined;
		const file = path.resolve(folder, `${spec}.ms`);
		const uris = await workspaceUris();
		return uris.find((uri) => path.resolve(uri.fsPath) === file);
	}

	// Every file in the workspace that imports the one at `uri`, with the alias its import
	// gave the module, so the module's own name can be found where those files write it.
	async function importersOf(uri) {
		const importers = [];
		for (const other of await workspaceUris()) {
			if (other.fsPath === uri.fsPath) continue;
			const source = await sourceOf(other);
			for (const [alias, spec] of importsOf(source.text)) {
				const found = await target(other, spec);
				if (found && found.fsPath === uri.fsPath) importers.push({ uri: other, alias, source });
			}
		}
		return importers;
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
		listing = undefined;
	}

	return {
		forDocument,
		forUri,
		sourceOf,
		moduleUri,
		target,
		importersOf,
		search,
		forget,
		forgetWorkspace,
	};
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

const SEVERITY = {
	error: vscode.DiagnosticSeverity.Error,
	warning: vscode.DiagnosticSeverity.Warning,
};

// A lint record is one line of text; a Diagnostic wants a range and a severity.
function toDiagnostic(found) {
	const range = new vscode.Range(found.line, found.character, found.line, found.endCharacter);
	const diagnostic = new vscode.Diagnostic(
		range,
		found.message,
		SEVERITY[found.severity] ?? SEVERITY.warning
	);
	diagnostic.code = found.code;
	diagnostic.source = "miniscript2";
	// The repair travels on the diagnostic, so the action cannot drift from the problem.
	if (found.fix) diagnostic.data = found.fix;
	return diagnostic;
}

// What a squiggle can be repaired by, when lint.js was sure enough to say: the edit it
// described, applied to the range it marked. A replacement and an insertion are the same
// edit, so one shape covers both.
function quickFix(document, diagnostic) {
	const fix = diagnostic.data;
	if (!fix) return undefined;
	const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
	const edit = new vscode.WorkspaceEdit();
	edit.replace(
		document.uri,
		new vscode.Range(fix.line, fix.character, fix.line, fix.endCharacter),
		fix.text
	);
	action.edit = edit;
	action.diagnostics = [diagnostic];
	action.isPreferred = true;
	return action;
}

// Only the squiggles the editor is asking about are offered a repair; a problem with no
// certain one - a stray `end`, an import that names no file - is left as it is.
function codeActions(document, context) {
	const actions = [];
	for (const diagnostic of context?.diagnostics || []) {
		if (diagnostic.source !== "miniscript2") continue;
		const action = quickFix(document, diagnostic);
		if (action) actions.push(action);
	}
	return actions;
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
	// `self` and `super` name the class the enclosing method belongs to, so that class's
	// method is the answer - the same one completion gives, and the only one that can be
	// right when a top-level name is spelled the same as the method.
	if (receiver === "self" || receiver === "super") {
		const own = methodAt(here, receiver, name, line);
		if (own) return [{ uri: document.uri, symbol: own }];
	}

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

		// `sq = new Shape` makes `sq.method` the method this file gave that class.
		const inherited = methodAt(here, known, name, line);
		if (inherited) return [{ uri: document.uri, symbol: inherited }];
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
// What a name means where it is written: a local or parameter of the enclosing function,
// a method of its receiver, this file's top level, the module an import names, an
// intrinsic, then the rest of the workspace. Shared by Ctrl-click, hover and signature
// help, so the three never disagree about a call.
async function resolve(document, index, here, imports, { name, receiver, line }) {
	if (receiver) return method(document, index, here, imports, { name, receiver, line });

	const symbol = locate(here, { name, line });
	if (symbol) return [{ uri: document.uri, symbol }];

	if (imports.has(name)) {
		const uri = await index.moduleUri(imports.get(name));
		if (uri) return [{ uri, symbol: moduleSymbol(name, imports.get(name)) }];
	}

	const intrinsic = builtins.global(name);
	if (intrinsic) return [{ symbol: intrinsic }];

	return index.search(name, undefined, document.uri);
}

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
	return resolve(document, index, index.forDocument(document), importsOf(text), {
		name,
		receiver: receiverBefore(before),
		line: position.line,
	});
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
	// A field is seen through an instance, not listed where the file's own names are.
	const listed = found.filter(
		(symbol) =>
			symbol.kind !== "parameter" &&
			symbol.kind !== "field" &&
			!(symbol.kind === "variable" && symbol.container)
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

// Every place in the file a symbol is written: its own name where it is declared, when the
// editor asked for that, and every use the scan reads as the same symbol - a member only
// through the receiver the file gave it, so `x` in one function is not `x` in another.
function rangesForText(text, symbols, target, includeDeclaration) {
	const lines = text.split(/\r?\n/);
	const ranges = [];
	for (let line = 0; line < lines.length; line += 1) {
		const tokens = tokenize(lines[line], line);
		for (let i = 0; i < tokens.length; i += 1) {
			const token = tokens[i];
			if (token.type !== "word" || token.value !== target.name) continue;
			const declaration = line === target.line && token.start === target.character;
			if (declaration && !includeDeclaration) continue;
			if (i > 0 && tokens[i - 1].value === ".") {
				// A member belongs to whatever the receiver resolves to: `sq.degrees` is
				// `Shape.degrees`, and a local spelled the same does not take it away.
				if (!memberOf(symbols, tokens, i, line, target)) continue;
			} else if (locate(symbols, { name: target.name, line }) !== target) continue;
			ranges.push(new vscode.Range(line, token.start, line, token.end));
		}
	}
	return ranges;
}

function rangesOf(document, symbols, target, includeDeclaration) {
	return rangesForText(document.getText(), symbols, target, includeDeclaration);
}

// Every `alias.name` in a file: the only way a file that imports a module writes one of
// the module's own names, and never a bare local that happens to be spelled the same.
function memberRanges(text, alias, name) {
	const ranges = [];
	const lines = text.split(/\r?\n/);
	for (let line = 0; line < lines.length; line += 1) {
		const tokens = tokenize(lines[line], line);
		for (let i = 2; i < tokens.length; i += 1) {
			const token = tokens[i];
			if (token.type !== "word" || token.value !== name) continue;
			const dot = tokens[i - 1];
			const receiver = tokens[i - 2];
			if (dot.value !== "." || receiver.type !== "word" || receiver.value !== alias) continue;
			ranges.push(new vscode.Range(line, token.start, line, token.end));
		}
	}
	return ranges;
}

// Whether `receiver.name` is this method: the receiver it was defined on, `self` and
// `super` inside that class, or an instance `new` made from it.
function memberOf(symbols, tokens, index, line, target) {
	if (!MEMBER_KINDS.has(target.kind) || !target.receiver) return false;
	const receiver = tokens[index - 2];
	if (!receiver) return false;
	if (receiver.value === target.receiver) return true;
	return methodAt(symbols, receiver.value, target.name, line) === target;
}

// The name a module offers the files that import it: a top-level name, not a local and not
// a member of a class.
function exported(symbols, name) {
	return symbols.find(
		(symbol) => symbol.name === name && !symbol.container && !symbol.receiver
	);
}

function workspace() {
	return (vscode.workspace.workspaceFolders || []).length > 0;
}

// The files that import a module, with the one being edited counted once and read from the
// editor rather than from disk, since its unsaved import is the one the cursor is in.
async function importersFor(index, moduleUri, current) {
	const importers = await index.importersOf(moduleUri);
	const seen = new Set(importers.map((importer) => importer.uri.fsPath));
	if (current && !seen.has(current.document.uri.fsPath)) {
		importers.push({
			uri: current.document.uri,
			alias: current.alias,
			source: { text: current.document.getText() },
		});
	}
	return importers;
}

// Every place an imported name is written: in the module that defines it, its declaration
// and its bare uses, and in each file that imports it, as `alias.name`.
function moduleRanges(module, symbol, includeDeclaration, importers) {
	const found = rangesForText(module.text, module.symbols, symbol, includeDeclaration).map(
		(range) => ({ uri: module.uri, range })
	);
	for (const importer of importers) {
		for (const range of memberRanges(importer.source.text, importer.alias, symbol.name)) {
			found.push({ uri: importer.uri, range });
		}
	}
	return found;
}

// Every place the name under the cursor is written. A local or a parameter is this file's
// own, but a name an import brings in is the module's: finding it follows the name into the
// file that defines it and into every file that imports it.
async function references(document, position, index, includeDeclaration) {
	const text = document.getText();
	if (inLiteral(text, position.line, position.character)) return [];
	const range = document.getWordRangeAtPosition(position, WORD);
	if (!range) return [];
	const name = document.getText(range);
	if (KEYWORDS.has(name)) return [];

	const symbols = index.forDocument(document);
	const receiver = receiverOf(document, position, range);
	const local = (target) =>
		rangesOf(document, symbols, target, includeDeclaration).map(
			(found) => ({ uri: document.uri, range: found })
		);

	// `lib.name`: the module's own name when `lib` is what `import "lib"` made, or a
	// method of a receiver this file gave.
	if (receiver !== undefined) {
		const member = methodAt(symbols, receiver, name, position.line);
		if (member) return local(member).map(({ uri, range }) => new vscode.Location(uri, range));
		const imports = importsOf(text);
		if (!workspace() || !imports.has(receiver)) return [];
		const uri = await index.target(document.uri, imports.get(receiver));
		const source = uri && (await index.sourceOf(uri));
		const symbol = source && exported(source.symbols, name);
		if (!symbol) return [];
		const importers = await importersFor(index, uri, { document, alias: receiver });
		return moduleRanges({ uri, ...source }, symbol, includeDeclaration, importers).map(
			(found) => new vscode.Location(found.uri, found.range)
		);
	}

	const target = locate(symbols, { name, line: position.line });
	if (!target) return [];
	// A member reached without a dot (`self.sides` is written with one) and a local are the
	// file's own; a name at the top level can be reached through an import.
	if (target.container || target.receiver || !workspace()) {
		return local(target).map(({ uri, range }) => new vscode.Location(uri, range));
	}
	const importers = await importersFor(index, document.uri);
	return moduleRanges(
		{ uri: document.uri, text, symbols },
		target,
		includeDeclaration,
		importers
	).map((found) => new vscode.Location(found.uri, found.range));
}

// What the cursor names and whether renaming it is safe: a local or a parameter, which only
// this file can see, or a name a module offers - `lib.name` here, or the module's own
// top-level name where it is defined - whose every importer's `alias.name` is a use of it.
// A top-level name nothing in the workspace imports is still refused, since a file outside
// it could be one of its readers.
async function renameAt(document, position, index) {
	const text = document.getText();
	if (inLiteral(text, position.line, position.character)) return undefined;
	const range = document.getWordRangeAtPosition(position, WORD);
	if (!range) return undefined;
	const name = document.getText(range);
	if (KEYWORDS.has(name)) return undefined;

	const symbols = index.forDocument(document);
	const receiver = receiverOf(document, position, range);
	const imports = importsOf(text);

	if (receiver === undefined) {
		const symbol = locate(symbols, { name, line: position.line });
		if (!symbol) return undefined;
		if (symbol.container) return { name, range, symbol, imported: false };
		if (symbol.receiver || !workspace()) return undefined;
		const importers = await importersFor(index, document.uri);
		if (!importers.length) return undefined;
		return {
			name,
			range,
			symbol,
			imported: true,
			module: { uri: document.uri, text, symbols },
			importers,
		};
	}

	const member = methodAt(symbols, receiver, name, position.line);
	if (member && member.container) return { name, range, symbol: member, imported: false };
	if (!workspace() || !imports.has(receiver)) return undefined;
	const uri = await index.target(document.uri, imports.get(receiver));
	const source = uri && (await index.sourceOf(uri));
	const symbol = source && exported(source.symbols, name);
	if (!symbol) return undefined;
	return {
		name,
		range,
		symbol,
		imported: true,
		module: { uri, ...source },
		importers: await importersFor(index, uri, { document, alias: receiver }),
	};
}

async function prepareRename(document, position, index) {
	const target = await renameAt(document, position, index);
	return target ? { range: target.range, placeholder: target.name } : undefined;
}

async function rename(document, position, newName, index) {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) return undefined;
	const target = await renameAt(document, position, index);
	if (!target) return undefined;
	const found = target.imported
		? moduleRanges(target.module, target.symbol, true, target.importers)
		: rangesOf(document, index.forDocument(document), target.symbol, true).map((range) => ({
				uri: document.uri,
				range,
			}));
	const edit = new vscode.WorkspaceEdit();
	for (const { uri, range } of found) edit.replace(uri, range, newName);
	return edit;
}

// What Go to Symbol in Workspace searches: the names a file offers the rest of the
// project, not its locals. A query is matched against the name alone, as the panel's
// own search does.
const SYMBOL_LIMIT = 100;

async function workspaceSymbols(query, index) {
	const search = String(query || "").toLowerCase();
	if (!search) return [];
	const found = [];
	const uris = await vscode.workspace.findFiles("**/*.ms", "**/node_modules/**", 500);
	for (const uri of uris) {
		for (const symbol of await index.forUri(uri)) {
			if (symbol.kind === "parameter" || symbol.kind === "field" || symbol.container) continue;
			if (!symbol.name.toLowerCase().includes(search)) continue;
			found.push(
				new vscode.SymbolInformation(
					symbol.name,
					KINDS[symbol.kind] || vscode.SymbolKind.Variable,
					symbol.container || "",
					new vscode.Location(uri, nameRange(symbol))
				)
			);
			if (found.length >= SYMBOL_LIMIT) return found;
		}
	}
	return found;
}

// The path in `import "..."` opens the module it names, when the workspace has one.
async function documentLinks(document, index) {
	const links = [];
	const lines = document.getText().split(/\r?\n/);
	for (let line = 0; line < lines.length; line += 1) {
		const target = importOf(lines[line]);
		if (!target) continue;
		const uri = await index.moduleUri(target.path);
		if (!uri) continue;
		const link = new vscode.DocumentLink(
			new vscode.Range(line, target.start, line, target.end),
			uri
		);
		link.tooltip = `Open ${target.path}.ms`;
		links.push(link);
	}
	return links;
}

function symbolItem(symbol) {
	const item = new vscode.CompletionItem(
		symbol.name,
		COMPLETION_KINDS[symbol.kind] || vscode.CompletionItemKind.Variable
	);
	if (symbol.signature) item.detail = symbol.signature;
	const note = symbol.doc || symbol.comment;
	if (note) item.documentation = new vscode.MarkdownString(note);
	return item;
}

function intrinsicItem(name, variant) {
	const item = new vscode.CompletionItem(
		name,
		variant.call.includes("(")
			? vscode.CompletionItemKind.Method
			: vscode.CompletionItemKind.Property
	);
	item.detail = variant.call;
	item.documentation = new vscode.MarkdownString(variant.note);
	return item;
}

// What a name can be at this line: the enclosing function's own names first, then the
// file's top level, then the modules it imports, which are names too.
function scopeItems(here, line, imports) {
	const items = [];
	const seen = new Set();
	const add = (item) => {
		if (seen.has(item.label)) return;
		seen.add(item.label);
		items.push(item);
	};

	const owner = innermost(here, line, { kinds: FUNCTION_KINDS });
	if (owner) {
		for (const symbol of here) {
			if (symbol.container === owner.name) add(symbolItem(symbol));
		}
	}
	for (const symbol of here) {
		if (!symbol.container && !symbol.receiver) add(symbolItem(symbol));
	}
	for (const [alias, target] of imports) {
		const item = new vscode.CompletionItem(alias, vscode.CompletionItemKind.Module);
		item.detail = `import "${target}"`;
		add(item);
	}
	return items;
}

// Everything `receiver.` can be: this file's methods on that receiver, an imported module's
// own names, and the intrinsic table's members for the receiver's type. A receiver the
// file does not define may still name a module the language ships (`file`), which has
// members of its own.
async function memberItems(index, here, imports, receiver, line) {
	const items = [];
	const seen = new Set();
	const add = (item) => {
		if (seen.has(item.label)) return;
		seen.add(item.label);
		items.push(item);
	};

	if (receiver === "globals") {
		for (const symbol of here) {
			if (!symbol.container && !symbol.receiver) add(symbolItem(symbol));
		}
		return items;
	}

	// `self` is the instance of the class the enclosing method belongs to, and `super` is
	// the same instance's prototype: both reach that class's members.
	if (receiver === "self" || receiver === "super") {
		const owner = innermost(here, line, { kinds: FUNCTION_KINDS });
		const type = owner && owner.kind === "method" ? owner.receiver : undefined;
		for (const symbol of here) {
			if (!MEMBER_KINDS.has(symbol.kind) || (type && symbol.receiver !== type)) continue;
			add(symbolItem(symbol));
		}
		return items;
	}

	if (imports.has(receiver)) {
		const uri = await index.moduleUri(imports.get(receiver));
		if (!uri) return items;
		for (const symbol of await index.forUri(uri)) {
			if (!symbol.container && !symbol.receiver) add(symbolItem(symbol));
		}
		return items;
	}

	for (const symbol of here) {
		if (symbol.kind === "method" && symbol.receiver === receiver) add(symbolItem(symbol));
	}

	// `sq = new Shape` completes the class that made it - its methods and the fields a
	// constructor set - before the map's own members, which an instance has too.
	const made = classOf(here, { name: receiver, line });
	if (made) {
		for (const symbol of here) {
			if (MEMBER_KINDS.has(symbol.kind) && symbol.receiver === made) add(symbolItem(symbol));
		}
	}

	const type = typeOf(here, { name: receiver, line });
	const named = type === undefined && !locate(here, { name: receiver, line }) ? receiver : type;
	for (const name of builtins.membersOf(named)) {
		const [variant] = builtins.member(name, named);
		if (variant) add(intrinsicItem(name, variant));
	}
	return items;
}

// A `.` after a name asks what that receiver has; anywhere else asks for the names in
// scope. Neither is answered inside a string or a comment, where a name is text.
async function complete(document, position, index) {
	const text = document.getText();
	if (inLiteral(text, position.line, position.character)) return undefined;

	const before = document.lineAt(position.line).text.slice(0, position.character);
	const here = index.forDocument(document);
	const imports = importsOf(text);
	const member = /([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)?$/.exec(before);
	if (member) return memberItems(index, here, imports, member[1], position.line);
	return scopeItems(here, position.line, imports);
}

// The call the cursor is in, read from the text before it: the name in front of the
// innermost open parenthesis, the receiver when the name is a member of one, and which
// argument the cursor is in, counted by the commas at that call's own depth.
//
// The text runs from the start of the file, not from the start of the line, because an
// argument list is written wrapped as often as not. Reading forward is what makes that
// work: a quote and a `//` are opened by what comes before them, and only a forward pass
// knows which of them is open at the cursor.
function callAt(text) {
	const open = [];
	let quoted = false;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		if (quoted) {
			// A MiniScript string ends with its line, however it was written.
			if (ch === "\n") quoted = false;
			else if (ch === '"') {
				if (text[i + 1] === '"') i += 1;
				else quoted = false;
			}
			continue;
		}
		if (ch === '"') {
			quoted = true;
			continue;
		}
		if (ch === "/" && text[i + 1] === "/") {
			// A comment runs to the end of its line, whichever line the cursor is on.
			const end = text.indexOf("\n", i);
			if (end < 0) break;
			i = end;
			continue;
		}
		if (ch === "(" || ch === "[" || ch === "{") {
			open.push({ bracket: ch, at: i, commas: 0 });
			continue;
		}
		if (ch === ")" || ch === "]" || ch === "}") {
			open.pop();
			continue;
		}
		if (ch === "," && open.length) open[open.length - 1].commas += 1;
	}

	const paren = [...open].reverse().find((entry) => entry.bracket === "(");
	if (!paren) return undefined;
	const head = text.slice(0, paren.at);
	const member = /([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(head);
	if (member) return { name: member[2], receiver: member[1], active: paren.commas };
	const plain = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(head);
	return plain ? { name: plain[1], active: paren.commas } : undefined;
}

// The parts of an intrinsic's signature string, such as
// `split(self, delimiter=" ", maxCount=null)`.
function parametersOf(signature) {
	const open = signature.indexOf("(");
	const close = signature.lastIndexOf(")");
	if (open < 0 || close < open) return [];
	return signature
		.slice(open + 1, close)
		.split(",")
		.map((text) => text.trim())
		.filter(Boolean);
}

function signatureOf(symbol, active) {
	const parameters = symbol.params
		? symbol.params.map((param) => param.text)
		: parametersOf(symbol.signature || "");
	const label = symbol.signature || symbol.name;
	if (!parameters.length && !label.includes("(")) return undefined;

	const note = symbol.doc || symbol.comment;
	const info = new vscode.SignatureInformation(
		label,
		note ? new vscode.MarkdownString(note) : undefined
	);
	info.parameters = parameters.map((text) => new vscode.ParameterInformation(text));

	const help = new vscode.SignatureHelp();
	help.signatures = [info];
	help.activeSignature = 0;
	if (parameters.length) help.activeParameter = Math.max(0, Math.min(active, parameters.length - 1));
	return help;
}

// The call's own parameters: a project function's list, or an intrinsic's from the
// language's tables, found the same way hover and Ctrl-click find the name.
async function signatureHelp(document, position, index) {
	const text = document.getText();
	const call = callAt(text.slice(0, document.offsetAt(position)));
	if (!call) return undefined;

	const matches = await resolve(
		document,
		index,
		index.forDocument(document),
		importsOf(text),
		{ name: call.name, receiver: call.receiver, line: position.line }
	);
	return matches.length ? signatureOf(matches[0].symbol, call.active) : undefined;
}

// The member after a dot, read the way hover reads it: a method this file gives that
// receiver, or an intrinsic of the receiver's proven type. `self` and `super` reach the
// class the enclosing method belongs to.
// A field of a class is colored as a variable: it holds a value, it is not called.
function memberKindOf(symbol) {
	return symbol.kind === "field" ? "variable" : "method";
}

function memberKind(symbols, tokens, index, line) {
	const token = tokens[index];
	const receiver = tokens[index - 2];
	if (!receiver || receiver.type !== "word") return undefined;
	const found = locate(symbols, { name: token.value, line });
	const member = found && MEMBER_KINDS.has(found.kind) ? found : undefined;
	if (receiver.value === "self" || receiver.value === "super") {
		const owner = enclosingMethod(symbols, line);
		return member && owner && member.receiver === owner.receiver ? memberKindOf(member) : undefined;
	}
	if (member && member.receiver === receiver.value) return memberKindOf(member);
	const made = classOf(symbols, { name: receiver.value, line });
	if (made && member && member.receiver === made) return memberKindOf(member);
	const type = typeOf(symbols, { name: receiver.value, line });
	return type && builtins.member(token.value, type).length ? "intrinsic" : undefined;
}

// Every name in the document, colored by what it is: what the file defines, and what the
// language does. A name the scan cannot place - an imported module's, a key of a map -
// keeps the grammar's color rather than pretending to be something it is not.
function semanticTokens(document, index) {
	const text = document.getText();
	const symbols = index.forDocument(document);
	const builder = new vscode.SemanticTokensBuilder(TOKEN_LEGEND);
	const declarations = new Map();
	for (const symbol of symbols) {
		declarations.set(`${symbol.line}:${symbol.character}`, symbol);
	}

	const lines = text.split(/\r?\n/);
	for (let line = 0; line < lines.length; line += 1) {
		const tokens = tokenize(lines[line], line);
		for (let i = 0; i < tokens.length; i += 1) {
			const token = tokens[i];
			if (token.type !== "word" || KEYWORDS.has(token.value)) continue;

			const declaration = declarations.get(`${line}:${token.start}`);
			let kind;
			if (declaration) kind = declaration.kind;
			else if (tokens[i - 1] && tokens[i - 1].value === ".") {
				kind = memberKind(symbols, tokens, i, line);
			} else {
				const symbol = locate(symbols, { name: token.value, line });
				kind = symbol ? symbol.kind : builtins.global(token.value) ? "intrinsic" : undefined;
			}

			const type = TOKEN_TYPE.get(kind === "field" ? "variable" : kind);
			if (type === undefined) continue;
			builder.push(
				line,
				token.start,
				token.end - token.start,
				type,
				declaration ? DECLARED : kind === "intrinsic" ? DEFAULT_LIBRARY : 0
			);
		}
	}
	return builder.build();
}

// How long typing settles before a file is checked again.
const DEBOUNCE = 250;

function register(context) {
	const index = createIndex();
	const diagnostics = vscode.languages.createDiagnosticCollection("miniscript2");
	const timers = new Map();

	// The documents the providers serve are the ones worth linting.
	function watched(document) {
		return SELECTOR.some(
			(selector) => selector.language === document.languageId && selector.scheme === document.uri.scheme
		);
	}

	// Where an import's file would be, in the order the interpreter looks: a path relative
	// to the file itself (`"../src/triples"`), then the workspace's own files, which is the
	// lookup Ctrl-click uses too. Nothing is claimed where neither can look.
	function resolver(document) {
		const folder =
			document.uri.scheme === "file" ? path.dirname(document.uri.fsPath) : undefined;
		return async (target) => {
			if (target.startsWith(".")) {
				return folder ? fs.existsSync(path.resolve(folder, `${target}.ms`)) : undefined;
			}
			return Boolean(await index.moduleUri(target));
		};
	}

	// The scan and the checks are lint.js's; what this adds is the one thing a file cannot
	// answer alone - whether each import names a file.
	async function check(document) {
		if (!watched(document)) return;
		const text = document.getText();
		const version = document.version;

		let moduleExists;
		if ((vscode.workspace.workspaceFolders || []).length) {
			const exists = resolver(document);
			const known = new Map();
			for (const { target } of importTargets(text)) known.set(target, await exists(target));
			// The file changed while the workspace was being asked; the newer text is about
			// to be checked, so this answer is stale.
			if (document.version !== version) return;
			moduleExists = (target) => known.get(target);
		}

		diagnostics.set(document.uri, lint(text, { moduleExists }).map(toDiagnostic));
	}

	function later(document) {
		if (!watched(document)) return;
		const key = document.uri.toString();
		const timer = timers.get(key);
		if (timer) clearTimeout(timer);
		timers.set(
			key,
			setTimeout(() => {
				timers.delete(key);
				check(document).catch(() => {});
			}, DEBOUNCE)
		);
	}

	function forget(uri) {
		const key = uri.toString();
		const timer = timers.get(key);
		if (timer) clearTimeout(timer);
		timers.delete(key);
		diagnostics.delete(uri);
	}

	async function checkAll() {
		for (const document of vscode.workspace.textDocuments || []) await check(document);
	}

	context.subscriptions.push(
		diagnostics,
		vscode.languages.registerHoverProvider(SELECTOR, {
			provideHover: (document, position) => hover(document, position, index),
		}),
		vscode.languages.registerDefinitionProvider(SELECTOR, {
			provideDefinition: (document, position) => definition(document, position, index),
		}),
		vscode.languages.registerDocumentSymbolProvider(SELECTOR, {
			provideDocumentSymbols: (document) => outline(document, index),
		}),
		vscode.languages.registerReferenceProvider(SELECTOR, {
			provideReferences: (document, position, context) =>
				references(document, position, index, Boolean(context && context.includeDeclaration)),
		}),
		vscode.languages.registerRenameProvider(SELECTOR, {
			prepareRename: (document, position) => prepareRename(document, position, index),
			provideRenameEdits: (document, position, newName) =>
				rename(document, position, newName, index),
		}),
		vscode.languages.registerWorkspaceSymbolProvider({
			provideWorkspaceSymbols: (query) => workspaceSymbols(query, index),
		}),
		vscode.languages.registerDocumentLinkProvider(SELECTOR, {
			provideDocumentLinks: (document) => documentLinks(document, index),
		}),
		vscode.languages.registerCompletionItemProvider(
			SELECTOR,
			{ provideCompletionItems: (document, position) => complete(document, position, index) },
			"."
		),
		vscode.languages.registerSignatureHelpProvider(
			SELECTOR,
			{ provideSignatureHelp: (document, position) => signatureHelp(document, position, index) },
			"(",
			","
		),
		vscode.languages.registerCodeActionsProvider(
			SELECTOR,
			{ provideCodeActions: (document, range, context) => codeActions(document, context) },
			{ providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
		),
		vscode.languages.registerDocumentSemanticTokensProvider(
			SELECTOR,
			{ provideDocumentSemanticTokens: (document) => semanticTokens(document, index) },
			TOKEN_LEGEND
		),
		vscode.workspace.onDidChangeTextDocument((event) => index.forget(event.document.uri)),
		vscode.workspace.onDidSaveTextDocument(() => index.forgetWorkspace()),
		vscode.workspace.onDidCreateFiles(() => index.forgetWorkspace()),
		vscode.workspace.onDidDeleteFiles(() => index.forgetWorkspace()),
		// The index is cleared above before anything here asks it a question.
		vscode.workspace.onDidOpenTextDocument((document) => check(document).catch(() => {})),
		vscode.workspace.onDidChangeTextDocument((event) => later(event.document)),
		vscode.workspace.onDidCloseTextDocument((document) => forget(document.uri)),
		// An import lives or dies with the files around it, so a save, a creation or a
		// deletion rechecks every open file - the saved one included, since it is in
		// textDocuments like the rest.
		vscode.workspace.onDidSaveTextDocument(() => checkAll().catch(() => {})),
		vscode.workspace.onDidCreateFiles(() => checkAll().catch(() => {})),
		vscode.workspace.onDidDeleteFiles(() => checkAll().catch(() => {}))
	);

	checkAll().catch(() => {});
	return index;
}

module.exports = { register };
