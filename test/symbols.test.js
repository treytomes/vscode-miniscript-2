// The symbol scanner behind the tooltip, Ctrl-click and the Outline, checked without
// VS Code: these are the plain functions from symbols.js.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { scan, statements, locate, typeOf, inLiteral } = require("../symbols.js");

function named(symbols, name, receiver) {
	return symbols.find(
		(symbol) => symbol.name === name && (receiver === undefined || symbol.receiver === receiver)
	);
}

test("a function's first string is its docstring, and its parameters are known", () => {
	const symbols = scan(
		[
			"// Adds two numbers, the comment the docstring supersedes.",
			"add = function(a, b=2)",
			"\t\"Adds two numbers.\"",
			"\treturn a + b",
			"end function",
		].join("\n")
	);

	const add = named(symbols, "add");
	assert.equal(add.kind, "function");
	assert.equal(add.doc, "Adds two numbers.");
	assert.equal(add.signature, "add(a, b=2)");
	assert.equal(add.line, 1);
	assert.equal(add.endLine, 4);
	assert.deepEqual(
		add.params.map((param) => [param.name, param.text]),
		[
			["a", "a"],
			["b", "b=2"],
		]
	);

	const b = named(symbols, "b");
	assert.equal(b.kind, "parameter");
	assert.equal(b.container, "add");
	assert.equal(b.signature, "b = 2");
});

test("a function without a docstring keeps the comment above it", () => {
	const symbols = scan(
		[
			"// The case module named by one stackTrace frame, and the line in it.",
			"caller = function(frame)",
			"\treturn frame",
			"end function",
		].join("\n")
	);

	const caller = named(symbols, "caller");
	assert.equal(caller.doc, undefined);
	assert.equal(caller.comment, "The case module named by one stackTrace frame, and the line in it.");
});

test("a comment inside the body does not hide the docstring below it", () => {
	const symbols = scan(
		["f = function()", "\t// a note", "\t\"The docstring.\"", "end function"].join("\n")
	);
	assert.equal(named(symbols, "f").doc, "The docstring.");
});

test("methods, classes and variables are told apart", () => {
	const symbols = scan(
		[
			"Shape = {\"sides\": 0}",
			"Shape.degrees = function",
			"\treturn 180 * (self.sides - 2)",
			"end function",
			"Square = new Shape",
			"square = new Shape",
			"Counter = {\"n\": 0}",
			"Counter[\"n=\"] = function(value)",
			"\tsuper.n = value",
			"end function",
		].join("\n")
	);

	assert.equal(named(symbols, "Shape").kind, "class");
	assert.equal(named(symbols, "Square").kind, "class");
	assert.equal(named(symbols, "square").kind, "variable");

	const degrees = named(symbols, "degrees", "Shape");
	assert.equal(degrees.kind, "method");
	assert.equal(degrees.signature, "Shape.degrees()");
	assert.equal(degrees.endLine, 3);

	const setter = named(symbols, "n=", "Counter");
	assert.equal(setter.kind, "method");
	assert.equal(setter.signature, 'Counter["n="](value)');
	assert.equal(named(symbols, "n"), undefined, "self.x / super.x are not definitions");
});

test("assignments in strings and comments define nothing", () => {
	const symbols = scan(
		[
			"// add = function(x)",
			"text = \"add = function(x)\"",
			"print \"not_a_symbol = 1\"",
		].join("\n")
	);

	assert.equal(named(symbols, "add"), undefined);
	assert.equal(named(symbols, "not_a_symbol"), undefined);
	assert.equal(named(symbols, "text").kind, "variable");
});

test("a short-form if does not swallow what follows it", () => {
	const symbols = scan(
		["if n < 0 then print \"neg\" else print \"pos\"", "after = 1"].join("\n")
	);
	assert.equal(named(symbols, "after").container, undefined);
});

test("a header that wraps is still one definition", () => {
	const symbols = scan(
		[
			"pair = function(first,",
			"\tsecond)",
			"\treturn first + second",
			"end function",
		].join("\n")
	);

	const pair = named(symbols, "pair");
	assert.equal(pair.signature, "pair(first, second)");
	assert.deepEqual(
		pair.params.map((param) => param.name),
		["first", "second"]
	);
	assert.equal(pair.endLine, 3);
});

test("a nested function is a child of the one that holds it", () => {
	const symbols = scan(
		[
			"outer = function()",
			"\tinner = function()",
			"\t\treturn 1",
			"\tend function",
			"\treturn @inner",
			"end function",
		].join("\n")
	);

	assert.equal(named(symbols, "outer").endLine, 5);
	assert.equal(named(symbols, "inner").container, "outer");
});

test("a local is preferred over a name defined elsewhere", () => {
	const symbols = scan(
		[
			"value = 1",
			"print value",
			"f = function()",
			"\tvalue = 2",
			"\treturn value",
			"end function",
		].join("\n")
	);

	assert.equal(locate(symbols, { name: "value", line: 1 }).line, 0, "the module's value");
	assert.equal(locate(symbols, { name: "value", line: 4 }).line, 3, "the local one");
	assert.equal(locate(symbols, { name: "nothing" }), undefined);
});

test("a method is found through its receiver", () => {
	const symbols = scan(
		[
			"Shape = {\"sides\": 0}",
			"other = {\"sides\": 0}",
			"Shape.degrees = function",
			"\treturn 1",
			"end function",
			"other.degrees = function",
			"\treturn 2",
			"end function",
		].join("\n")
	);

	assert.equal(locate(symbols, { name: "degrees", receiver: "Shape" }).line, 2);
	assert.equal(locate(symbols, { name: "degrees", receiver: "other" }).line, 5);
});

test("a literal value tells the type the name holds", () => {
	const symbols = scan(
		[
			's = "text"',
			"xs = [1, 2]",
			'm = {"a": 1}',
			"n = 3",
			"f = function",
			"end function",
			"Shape = new Thing",
		].join("\n")
	);

	assert.equal(typeOf(symbols, { name: "s" }), "string");
	assert.equal(typeOf(symbols, { name: "xs" }), "list");
	assert.equal(typeOf(symbols, { name: "m" }), "map");
	assert.equal(typeOf(symbols, { name: "n" }), "number");
	assert.equal(typeOf(symbols, { name: "f" }), "function");
	assert.equal(typeOf(symbols, { name: "Shape" }), "map");
	assert.equal(typeOf(symbols, { name: "nothing" }), undefined);
});

test("a name given two kinds of value has no one type", () => {
	const symbols = scan(["x = 1", 'x = "one"'].join("\n"));
	assert.equal(typeOf(symbols, { name: "x" }), undefined);
});

test("a name inside a string or a comment is not a reference", () => {
	const text = ["// call add later", "print \"add\""].join("\n");
	assert.equal(inLiteral(text, 0, 8), true);
	assert.equal(inLiteral(text, 0, 16), true, "the end of a comment is still in it");
	assert.equal(inLiteral(text, 1, 8), true);
	assert.equal(inLiteral(text, 1, 0), false);
});

test("a semicolon ends a statement, so a one-line function is three", () => {
	const text = 'f = function(n); return n + 1; end function';
	assert.deepEqual(
		statements(text).map((statement) => statement.tokens.map((token) => token.value)),
		[
			["f", "=", "function", "(", "n", ")"],
			["return", "n", "+", "1"],
			["end", "function"],
		]
	);
});

test("a string that spells an operator ends its statement", () => {
	// `">"` is a value, not a continuation: the line after it is a statement of its own.
	const text = ['label = "x" + ">"', 'if label != "" then', "\tprint label", "end if"].join("\n");
	assert.deepEqual(
		statements(text).map((statement) => statement.line),
		[0, 1, 2, 3]
	);
});
