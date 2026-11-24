// symbols.js — what a tooltip, a Ctrl-click and the Outline view need: the names a
// MiniScript file defines, where each one is, and how it is documented.
//
// There is no `vscode` in here, so the scan and the lookup are plain functions the tests
// can call; features.js wraps them in providers.
//
// MiniScript has no declaration keyword: a symbol is defined by assigning to it.
//
//   add = function(a, b=2)      a function
//   Shape = {"sides": 0}        a class is a map, by the convention of an upper-case name
//   Shape.degrees = function    a method
//   count = 0                   a variable
//
// A function's docstring is the first constant string in its body — the `note` that
// info(@add) reports. When it has none, the `//` comment block directly above the
// definition stands in for it, which is how most of this project's functions are
// documented.

const KEYWORDS = new Set([
	"if", "then", "else", "for", "in", "while", "break", "continue", "return",
	"import", "end", "function", "new", "freeze", "and", "or", "not", "is", "isa",
	"true", "false", "null",
]);

// A statement continues on the next line when its last token is one of these, or when a
// bracket is still open. MiniScript's own rule, used here to read a header that wraps.
const CONTINUES = new Set([
	",", "=", "==", "!=", "<", ">", "<=", ">=", "+", "-", "*", "/", "%", "^",
	"and", "or", "not", "in",
]);

const TWO_CHAR_OPERATORS = new Set([
	"==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "^=",
]);

const OPENERS = "([{";
const CLOSERS = ")]}";

// Receivers whose assignments reach into a value rather than defining a name.
const SCOPES = new Set(["self", "super", "locals", "outer"]);

const FUNCTIONS = new Set(["function", "method"]);

// The tokens of one line, with the comment kept (so a caller can tell a position inside
// one) and a string's doubled quotes already folded into its value.
function tokenize(text, line) {
	const tokens = [];
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (ch === " " || ch === "\t" || ch === "\r") {
			i += 1;
			continue;
		}
		if (i === 0 && ch === "#" && text[1] === "!") break; // shebang
		if (ch === "/" && text[i + 1] === "/") {
			tokens.push({
				type: "comment",
				value: text.slice(i + 2).trim(),
				start: i,
				end: text.length,
				line,
			});
			break;
		}
		if (ch === '"') {
			let value = "";
			let j = i + 1;
			while (j < text.length) {
				if (text[j] === '"') {
					if (text[j + 1] === '"') {
						value += '"';
						j += 2;
						continue;
					}
					j += 1;
					break;
				}
				value += text[j];
				j += 1;
			}
			tokens.push({ type: "string", value, start: i, end: j, line });
			i = j;
			continue;
		}
		const rest = text.slice(i);
		const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
		if (word) {
			tokens.push({ type: "word", value: word[0], start: i, end: i + word[0].length, line });
			i += word[0].length;
			continue;
		}
		const number = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
		if (number) {
			tokens.push({
				type: "number",
				value: number[0],
				start: i,
				end: i + number[0].length,
				line,
			});
			i += number[0].length;
			continue;
		}
		const pair = rest.slice(0, 2);
		const operator = TWO_CHAR_OPERATORS.has(pair) ? pair : ch;
		tokens.push({ type: "punct", value: operator, start: i, end: i + operator.length, line });
		i += operator.length;
	}
	return tokens;
}

// Whether the position sits in a string or a comment, where a name is text and not a
// reference to anything.
function inLiteral(text, line, character) {
	const lines = text.split(/\r?\n/);
	for (const token of tokenize(lines[line] || "", line)) {
		if (token.type !== "string" && token.type !== "comment") continue;
		// A comment runs to the end of its line, so the cursor after its last word is
		// still in it.
		if (token.type === "comment" && character >= token.start) return true;
		if (character >= token.start && character < Math.max(token.end, token.start + 1)) {
			return true;
		}
	}
	return false;
}

// The file's statements, each with its tokens and the line it starts on, with continued
// lines folded into the statement they continue.
function statements(text) {
	const lines = text.split(/\r?\n/);
	const out = [];
	let current;
	let depth = 0;

	const flush = () => {
		if (current && current.tokens.length) out.push(current);
		current = undefined;
		depth = 0;
	};

	for (let n = 0; n < lines.length; n += 1) {
		const tokens = tokenize(lines[n], n);
		const code = tokens.filter((token) => token.type !== "comment");
		if (!code.length) {
			// A blank line inside an open bracket does not end the statement.
			if (current && depth > 0) continue;
			flush();
			continue;
		}
		if (!current) current = { line: n, tokens: [] };
		for (const token of code) {
			// A `;` at the top level ends one statement and starts the next, which is how a
			// one-line function is written: `f = function(n); return n; end function`.
			if (token.type === "punct" && token.value === ";" && depth <= 0) {
				flush();
				current = { line: n, tokens: [] };
				continue;
			}
			current.tokens.push(token);
			if (token.type === "punct" && OPENERS.includes(token.value)) depth += 1;
			else if (token.type === "punct" && CLOSERS.includes(token.value)) depth -= 1;
		}
		// Only an operator or a keyword continues a statement onto the next line: a string
		// that happens to spell one (`">"` or `"and"`) ends it like any other value.
		const last = current.tokens[current.tokens.length - 1];
		const continues =
			last && (last.type === "punct" || last.type === "word") && CONTINUES.has(last.value);
		if (depth <= 0 && !continues) flush();
	}
	flush();
	return out;
}

// Tokens back to source-like text, for a signature or a definition shown in a tooltip.
function renderTokens(tokens) {
	let out = "";
	for (const token of tokens) {
		const text =
			token.type === "string" ? `"${token.value.replace(/"/g, '""')}"` : token.value;
		if (out && /[A-Za-z0-9_]$/.test(out) && /^[A-Za-z0-9_]/.test(text)) out += " ";
		out += text;
	}
	return out;
}

// A statement as it was written, when it sits on one line, so a tooltip keeps the spacing
// and the literal its author typed.
function sourceText(lines, tokens) {
	const first = tokens[0];
	const last = tokens[tokens.length - 1];
	if (first.line !== last.line) return renderTokens(tokens);
	return lines[first.line].slice(first.start, last.end);
}

// The `//` lines directly above `line`, joined, or undefined when there are none.
function commentAbove(lines, line) {
	const parts = [];
	for (let n = line - 1; n >= 0; n -= 1) {
		const text = lines[n].trim();
		if (!text.startsWith("//")) break;
		parts.unshift(text.slice(2).trim());
	}
	return parts.length ? parts.join("\n") : undefined;
}

// The assignment a statement makes, if it makes one: `name =`, `owner.name =`, or the
// setter form `owner["name="] =`. Comparisons (`==`) are a single token, so they are not
// mistaken for one.
function assignment(tokens) {
	const [first, second, third, fourth, fifth] = tokens;
	if (!first || first.type !== "word") return undefined;
	if (second && second.value === "=") {
		return { name: first.value, token: first, receiver: undefined, valueIndex: 2 };
	}
	if (
		second && second.value === "." &&
		third && third.type === "word" &&
		fourth && fourth.value === "="
	) {
		return { name: third.value, token: third, receiver: first.value, valueIndex: 4 };
	}
	if (
		second && second.value === "[" &&
		third && third.type === "string" &&
		fourth && fourth.value === "]" &&
		fifth && fifth.value === "="
	) {
		return { name: third.value, token: third, receiver: first.value, valueIndex: 5 };
	}
	return undefined;
}

// The parameters of a `function` header starting at `at`, including each default's text.
function paramsOf(tokens, at) {
	if (!tokens[at + 1] || tokens[at + 1].value !== "(") return [];
	const groups = [];
	let current = [];
	let depth = 0;

	for (let i = at + 2; i < tokens.length; i += 1) {
		const token = tokens[i];
		const punctuation = token.type === "punct" ? token.value : undefined;
		if (punctuation && OPENERS.includes(punctuation)) {
			depth += 1;
			current.push(token);
			continue;
		}
		if (punctuation && CLOSERS.includes(punctuation)) {
			if (depth === 0 && punctuation === ")") break;
			depth -= 1;
			current.push(token);
			continue;
		}
		if (punctuation === "," && depth === 0) {
			groups.push(current);
			current = [];
			continue;
		}
		current.push(token);
	}
	groups.push(current);

	const params = [];
	for (const group of groups) {
		if (!group.length) continue;
		const name = group[0];
		if (name.type !== "word") continue;
		const equals = group.findIndex((token) => token.value === "=");
		params.push({
			name: name.value,
			line: name.line,
			character: name.start,
			default: equals >= 0 ? renderTokens(group.slice(equals + 1)) : undefined,
			text: renderTokens(group),
		});
	}
	return params;
}

function signatureOf(symbol) {
	// A setter's name is not an identifier (`Counter["n="] = function`), so it is shown
	// in the bracket form that can spell it.
	const name = /^[A-Za-z_][A-Za-z0-9_]*$/.test(symbol.name)
		? symbol.receiver
			? `${symbol.receiver}.${symbol.name}`
			: symbol.name
		: `${symbol.receiver}["${symbol.name}"]`;
	const params = (symbol.params || []).map((param) => param.text).join(", ");
	return `${name}(${params})`;
}

// The type a value right of the `=` gives the name, when the value itself says it.
function valueTypeOf(token) {
	if (!token) return undefined;
	if (token.type === "string") return "string";
	if (token.type === "number") return "number";
	if (token.type === "punct") {
		if (token.value === "{") return "map";
		if (token.value === "[") return "list";
		return undefined;
	}
	if (token.type !== "word") return undefined;
	if (token.value === "function") return "function";
	if (token.value === "new") return "map";
	if (token.value === "true" || token.value === "false") return "number";
	return undefined;
}

// A capitalised name assigned a map literal or a `new` is a class, the convention the
// MiniScript style guide uses; anything else is a plain variable.
function isClass(symbol, value) {
	if (symbol.receiver || !/^[A-Z]/.test(symbol.name) || !value) return false;
	return value.value === "{" || (value.type === "word" && value.value === "new");
}

// The innermost symbol whose body holds `line`, so a name there can be read as a local
// of that function, and a declaration read as a child of the one that holds it.
function innermost(found, line, { skip, kinds } = {}) {
	let best;
	for (const symbol of found) {
		if (symbol === skip) continue;
		if (kinds && !kinds.has(symbol.kind)) continue;
		if (symbol.endLine === undefined || symbol.endLine <= symbol.line) continue;
		if (symbol.line <= line && line <= symbol.endLine) {
			if (!best || symbol.line > best.line) best = symbol;
		}
	}
	return best;
}

// The function whose body an open block sits in, from the stack of blocks being read.
function openFunction(blocks) {
	for (let i = blocks.length - 1; i >= 0; i -= 1) {
		if (blocks[i].kind === "function") return blocks[i];
	}
	return undefined;
}

// Every symbol the file defines, in source order: functions, methods, classes, variables
// and parameters. Each carries its kind, the line and column of its name, the end line of
// a function's body, its enclosing function's name, its docstring (or the comment above),
// and a signature line to show.
function scan(text) {
	const lines = text.split(/\r?\n/);
	const found = [];
	const blocks = [];

	for (const statement of statements(text)) {
		const tokens = statement.tokens;
		const first = tokens[0];
		const word = first.type === "word" ? first.value : undefined;

		if (word === "end") {
			const what = tokens[1] && tokens[1].type === "word" ? tokens[1].value : undefined;
			let index = blocks.length - 1;
			while (index >= 0 && what && blocks[index].kind !== what) index -= 1;
			if (index >= 0) {
				for (const closed of blocks.splice(index)) {
					if (closed.symbol) closed.symbol.endLine = statement.line;
				}
			}
			continue;
		}

		const open = blocks.length ? blocks[blocks.length - 1] : undefined;
		if (open && open.waiting) {
			open.waiting = false;
			// The first constant string of a body is the docstring, unless it is only part
			// of a statement (`"a" + "b"`), which a single string token followed by an end
			// of statement or a `;` tells apart.
			if (first.type === "string" && (tokens.length === 1 || tokens[1].value === ";")) {
				open.symbol.doc = first.value;
			}
		}

		if (word === "if") {
			// A short-form `if x then y` has no matching `end if`.
			const then = tokens.findIndex((token) => token.value === "then");
			if (then === -1 || tokens.length === then + 1) {
				blocks.push({ kind: "if", line: statement.line });
			}
			continue;
		}
		if (word === "for" || word === "while") {
			blocks.push({ kind: word, line: statement.line });
			continue;
		}

		const definition = assignment(tokens);
		if (!definition) continue;

		// `self.x = 1` and `super.x = 1` store into an object, they do not name a symbol
		// this file defines; `globals.x` is this file's own x, kept as a top-level name.
		if (SCOPES.has(definition.receiver)) continue;

		const owner = openFunction(blocks);
		const symbol = {
			name: definition.name,
			kind: "variable",
			receiver: definition.receiver === "globals" ? undefined : definition.receiver,
			line: definition.token.line,
			character: definition.token.start,
			endLine: definition.token.line,
			container: owner ? owner.symbol.name : undefined,
			comment: commentAbove(lines, statement.line),
			signature: sourceText(lines, tokens),
		};

		const value = tokens[definition.valueIndex];
		symbol.valueType = valueTypeOf(value);
		if (value && value.type === "word" && value.value === "function") {
			symbol.kind = symbol.receiver ? "method" : "function";
			symbol.params = paramsOf(tokens, definition.valueIndex);
			symbol.signature = signatureOf(symbol);
			symbol.endLine = lines.length - 1;
			found.push(symbol);
			for (const param of symbol.params) {
				found.push({
					name: param.name,
					kind: "parameter",
					line: param.line,
					character: param.character,
					endLine: param.line,
					container: symbol.name,
					signature: param.name + (param.default === undefined ? "" : " = " + param.default),
				});
			}
			blocks.push({ kind: "function", symbol, waiting: true });
			continue;
		}

		if (isClass(symbol, value)) symbol.kind = "class";
		found.push(symbol);
	}
	return found;
}

// The definition a reference names: a local or parameter of the enclosing function first,
// then a name defined at the file's top level, then anything that matches. With a
// `receiver`, only a method of that name on that receiver.
function locate(found, { name, receiver, line }) {
	const candidates = found.filter((symbol) => symbol.name === name);
	if (!candidates.length) return undefined;

	if (receiver !== undefined) {
		return candidates.find((symbol) => symbol.receiver === receiver);
	}

	const owner = line === undefined ? undefined : innermost(found, line, { kinds: FUNCTIONS });
	if (owner) {
		const local = candidates.find((symbol) => symbol.container === owner.name);
		if (local) return local;
	}
	return candidates.find((symbol) => !symbol.container) || candidates[0];
}

// The type a name holds where it is used, when every assignment to it in that one scope
// agrees: what a `s.len` is looked up on.
function typeOf(found, { name, line }) {
	const symbol = locate(found, { name, line });
	if (!symbol) return undefined;
	const types = new Set(
		found
			.filter((other) => other.name === name && other.container === symbol.container)
			.map((other) => other.valueType)
	);
	return types.size === 1 ? types.values().next().value : undefined;
}

module.exports = {
	KEYWORDS,
	SCOPES,
	statements,
	scan,
	locate,
	typeOf,
	innermost,
	inLiteral,
	tokenize,
};
