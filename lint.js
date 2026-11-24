// lint.js — the problems a file has that do not need running it: a member no type has, a
// block that never closes, and an import that names no file. Nothing here requires
// `vscode`, so each check is a plain function the tests call; features.js turns these
// records into a DiagnosticCollection.
//
// A record is { line, character, endCharacter, severity, code, message }, all on one line,
// and a `fix` when there is one repair the author certainly meant: { title, line,
// character, endCharacter, text }, a replacement of that range with that text. An insertion
// has endCharacter equal to character.
//
// The severity follows what the interpreter does with the file. A block that never closes
// does not compile, so it is an error. A member no type has and an import the workspace
// does not hold are warnings: a program can add a member to a built-in type while it
// runs, and a module can sit on the project's own import path, outside the workspace.

const builtins = require("./builtins");
const { SCOPES, scan, statements, typeOf } = require("./symbols");

// Only the types whose members are certainly the language's own are judged. A map is left
// out because every key of one is a member the scan cannot see, and an error value because
// `message` and `stack` are fields the intrinsic table does not list. A list and a string
// are the two a file reaches into most, and the two where a misspelling is always one.
const CHECKED_TYPES = new Set(["string", "list"]);

// `import "path"` at the start of a line, indented or not, as features.js reads it.
const IMPORT = /^[ \t]*import[ \t]+"([^"]*)"/;

function problem(token, message, severity, code) {
	return {
		line: token.line,
		character: token.start,
		endCharacter: token.end,
		severity,
		code,
		message,
	};
}

// Levenshtein distance, for "did you mean" only: small names, small tables.
function distance(a, b) {
	let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i += 1) {
		const current = [i];
		for (let j = 1; j <= b.length; j += 1) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
		}
		previous = current;
	}
	return previous[b.length];
}

// The member the author probably meant, when one is close enough to name. Case is ignored,
// since MiniScript does not: `s.Len` is still a misspelling of `len`.
function closest(name, candidates) {
	const lower = name.toLowerCase();
	const limit = name.length >= 5 ? 3 : name.length === 4 ? 2 : 1;
	let best;
	let bestDistance = limit + 1;
	for (const candidate of [...candidates].sort()) {
		const found = distance(lower, candidate.toLowerCase());
		if (found < bestDistance) {
			best = candidate;
			bestDistance = found;
		}
	}
	return best;
}

// `receiver.member` where the receiver's type is one the intrinsic table lists: the member
// has to be one of that type's, since nothing else can be reached through a string or a
// list. A program that adds a member to the type turns the check off for the whole file.
function memberProblems(text, symbols) {
	const found = [];
	const extended = new Set();
	for (const symbol of symbols) {
		if (symbol.kind !== "method" || !symbol.receiver) continue;
		if (CHECKED_TYPES.has(symbol.receiver)) {
			extended.add(symbol.receiver);
			continue;
		}
		const type = typeOf(symbols, { name: symbol.receiver });
		if (type) extended.add(type);
	}

	for (const statement of statements(text)) {
		const tokens = statement.tokens;
		for (let i = 0; i + 2 < tokens.length; i += 1) {
			const receiver = tokens[i];
			const dot = tokens[i + 1];
			const member = tokens[i + 2];
			if (receiver.type !== "word" || dot.type !== "punct" || dot.value !== ".") continue;
			if (member.type !== "word") continue;
			// These name a map the scan cannot see into, not a value with a type.
			if (receiver.value === "globals" || SCOPES.has(receiver.value)) continue;

			const type = typeOf(symbols, { name: receiver.value, line: receiver.line });
			if (!CHECKED_TYPES.has(type) || extended.has(type)) continue;
			if (builtins.member(member.value, type).length) continue;

			const near = closest(member.value, builtins.membersOf(type));
			const record = problem(
				member,
				near
					? `\`${type}\` has no member \`${member.value}\`. Did you mean \`${near}\`?`
					: `\`${type}\` has no member \`${member.value}\`.`,
				"warning",
				"unknown-member"
			);
			if (near) {
				record.fix = {
					title: `Replace with \`${near}\``,
					line: member.line,
					character: member.start,
					endCharacter: member.end,
					text: near,
				};
			}
			found.push(record);
		}
	}
	return found;
}

// The blocks a file opens, closed in the order the interpreter requires: each `end` closes
// the innermost block of its own kind, and an `end` with nothing to close is the line the
// compiler stops on.
function blockProblems(text) {
	const found = [];
	const open = [];
	const lines = String(text).split(/\r?\n/);

	// The indentation a block's own `end` belongs at: the whitespace that starts its
	// statement, which for `f = function` is not where the `function` token stands.
	const indentOf = (block) => (/^[ \t]*/.exec(lines[block.token.line] || "") || [""])[0];

	// The ends still owed to `block` and to everything still open inside it, innermost
	// first, each at its own block's indentation. A fix carrying the whole tail compiles
	// whichever of the diagnostics the author chooses to repair.
	const endsDownTo = (group, block) => {
		const index = group.indexOf(block);
		return group
			.slice(index + 1)
			.concat([block])
			.map((each) => `${indentOf(each)}end ${each.kind}`);
	};

	const unclosed = (block, group, closedBy) => {
		const ends = endsDownTo(group, block);
		const last = lines.length - 1;
		// Before the `end` that closed an enclosing block, the missing ones go above it, at
		// the start of its line; at the end of the file they go below it, after a newline
		// unless the file already ends with one.
		const at = closedBy
			? { line: closedBy.line, character: 0, text: `${ends.join("\n")}\n` }
			: lines[last] === ""
				? { line: last, character: 0, text: ends.join("\n") }
				: { line: last, character: lines[last].length, text: `\n${ends.join("\n")}` };
		const record = problem(
			block.token,
			closedBy
				? `\`${block.kind}\` is never closed. Add \`end ${block.kind}\` before the ` +
						`\`end ${closedBy.kind}\` on line ${closedBy.line + 1}.`
				: `\`${block.kind}\` is never closed. Add \`end ${block.kind}\`.`,
			"error",
			"unclosed-block"
		);
		record.fix = {
			title: `Insert \`end ${block.kind}\``,
			line: at.line,
			character: at.character,
			endCharacter: at.character,
			text: at.text,
		};
		return record;
	};

	// One `end`, wherever it stands in the file: it closes the innermost block of its own
	// kind, or says why it cannot.
	const close = (token, named) => {
		let index = open.length - 1;
		while (index >= 0 && named && open[index].kind !== named) index -= 1;

		if (index < 0) {
			const inner = open[open.length - 1];
			if (!inner) {
				found.push(
					problem(
						token,
						named ? `\`end ${named}\` has no \`${named}\` to close.` : "`end` has no block to close.",
						"error",
						"stray-end"
					)
				);
			} else {
				// The compiler stops on this line, so the report does too, and says what the
				// block it was meant to close still needs. The fix is that insertion: the end
				// this line should have had, above it, at the open block's own indentation,
				// leaving the wrong end itself to be corrected.
				const record = problem(
					token,
					`\`end ${named}\` cannot close the \`${inner.kind}\` opened on line ` +
						`${inner.token.line + 1}. Add \`end ${inner.kind}\` before it.`,
					"error",
					"mismatched-end"
				);
				record.fix = {
					title: `Insert \`end ${inner.kind}\``,
					line: token.line,
					character: 0,
					endCharacter: 0,
					text: `${indentOf(inner)}end ${inner.kind}\n`,
				};
				found.push(record);
				open.pop();
			}
			return;
		}

		// Anything still open inside the block this `end` closes is missing its own.
		const tail = open.splice(index + 1);
		for (const inner of tail) {
			found.push(unclosed(inner, tail, { kind: named || open[index].kind, line: token.line }));
		}
		open.length = index;
	};

	for (const statement of statements(text)) {
		const tokens = statement.tokens;
		const first = tokens[0];
		const word = first.type === "word" ? first.value : undefined;

		if (word === "end") {
			close(first, tokens[1] && tokens[1].type === "word" ? tokens[1].value : undefined);
			continue;
		}

		if (word === "if") {
			// A short-form `if x then y` has no matching `end if`.
			const then = tokens.findIndex((token) => token.value === "then");
			if (then === -1 || tokens.length === then + 1) open.push({ kind: "if", token: first });
			continue;
		}
		if (word === "for" || word === "while") {
			open.push({ kind: word, token: first });
			continue;
		}

		// A statement that fits on one line can carry a whole function, so its `function`
		// and `end` tokens are read where they stand: `f = function(n); return n; end
		// function`, or a function handed to a method as `xs.sort function(a, b)`.
		//
		// A statement folded over several lines is a map or list literal, and a function in
		// one is an entry the file's own scan does not follow: its `end` never stands at the
		// start of a statement, so opening it here would only report a block that does
		// close. Those entries are left to the interpreter.
		if (tokens[tokens.length - 1].line !== first.line) continue;

		for (let i = 0; i < tokens.length; i += 1) {
			const token = tokens[i];
			if (token.type !== "word") continue;
			if (token.value === "end") {
				const named = tokens[i + 1] && tokens[i + 1].type === "word" ? tokens[i + 1].value : undefined;
				close(token, named);
				if (named) i += 1;
				continue;
			}
			if (token.value === "function") open.push({ kind: "function", token });
		}
	}

	for (const block of open) found.push(unclosed(block, open));
	return found;
}

// Every `import "path"` in the text, with where the string sits, so a missing one is marked
// on its own path. features.js uses the same list to ask the workspace whether each exists.
function importTargets(text) {
	const found = [];
	const lines = String(text).split(/\r?\n/);
	for (let line = 0; line < lines.length; line += 1) {
		const match = IMPORT.exec(lines[line]);
		if (!match || !match[1]) continue;
		const start = lines[line].indexOf('"');
		found.push({ target: match[1], line, start, end: start + match[1].length + 2 });
	}
	return found;
}

// An import the caller has looked for and not found. Nothing is reported when the caller
// cannot look (no workspace) or has not said (no `moduleExists`), so a file opened on its
// own is never told its imports are missing.
function importProblems(text, moduleExists) {
	if (typeof moduleExists !== "function") return [];
	return importTargets(text)
		.filter(({ target }) => moduleExists(target) === false)
		.map(({ target, line, start, end }) => ({
			line,
			character: start,
			endCharacter: end,
			severity: "warning",
			code: "missing-import",
			message: `\`import "${target}"\` finds no ${target}.ms.`,
		}));
}

function lint(text, options = {}) {
	const source = String(text ?? "");
	const symbols = scan(source);
	const found = [
		...memberProblems(source, symbols),
		...blockProblems(source),
		...importProblems(source, options.moduleExists),
	];
	return found.sort(
		(a, b) => a.line - b.line || a.character - b.character || (a.code < b.code ? -1 : 1)
	);
}

module.exports = { lint, importTargets };
