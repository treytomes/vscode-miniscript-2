// The problems lint.js reports, checked without VS Code: a member no type has, a block
// that never closes, and an import that names no file.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { lint } = require("../lint.js");

test("a member the type does not have is reported on the word", () => {
	const found = lint('s = "hi"\nprint s.lengh');
	assert.equal(found.length, 1);
	const [problem] = found;
	assert.equal(problem.code, "unknown-member");
	assert.equal(problem.severity, "warning");
	assert.equal(problem.message, "`string` has no member `lengh`. Did you mean `len`?");
	assert.deepEqual([problem.line, problem.character, problem.endCharacter], [1, 8, 13]);
});

test("a member the type does have is left alone", () => {
	assert.deepEqual(lint('s = "hi"\nprint s.len\nxs = [1]\nxs.push(2)\nxs.join(",")'), []);
});

test("a map's key is not a member the scan can know", () => {
	assert.deepEqual(lint('m = {"a": 1}\nprint m.anything'), []);
});

test("a receiver with no one type is not judged", () => {
	assert.deepEqual(lint('x = 1\nx = "one"\nprint x.lengh'), []);
	assert.deepEqual(lint("f = function(value)\n\treturn value.lengh\nend function"), []);
});

test("self and globals are not receivers to look a member up on", () => {
	const text = [
		"Shape = {",
		'\t"go": function',
		"\t\tself.lengh = 1",
		"\t\tglobals.lengh = 2",
		"\tend function",
		"}",
	].join("\n");
	assert.deepEqual(lint(text), []);
});

test("a type the file extends is not judged", () => {
	const text = [
		"string.shout = function",
		'\treturn self + "!"',
		"end function",
		's = "hi"',
		"print s.shout",
	].join("\n");
	assert.deepEqual(lint(text), []);
});

test("a dotted name in a string or a comment is text", () => {
	assert.deepEqual(lint(['s = "hi"', 'print "s.lengh"', "// s.lengh"].join("\n")), []);
});

test("a block that never closes is reported where it opens", () => {
	const found = lint(["if true then", '\tprint "yes"'].join("\n"));
	assert.equal(found.length, 1);
	assert.equal(found[0].code, "unclosed-block");
	assert.equal(found[0].severity, "error");
	assert.equal(found[0].message, "`if` is never closed. Add `end if`.");
	assert.deepEqual([found[0].line, found[0].character, found[0].endCharacter], [0, 0, 2]);
});

test("each kind of block is closed by its own end", () => {
	const text = [
		"loop = function(n)",
		"\tfor i in range(1, n)",
		'\t\tprint "for"',
		"\tend for",
		"\twhile n > 0",
		"\t\tn = n - 1",
		"\tend while",
		"end function",
	].join("\n");
	assert.deepEqual(lint(text), []);
});

test("a one-line function opens and closes on its line", () => {
	const text = [
		"cursor = {}",
		'cursor.up = function(n=1); return esc + "[" + n + "A"; end function',
		"print cursor.up",
	].join("\n");
	assert.deepEqual(lint(text), []);
});

test("a function passed as an argument opens a block too", () => {
	const text = [
		'd = {"one": "ichi"}',
		"d.filterValues function(v)",
		"\treturn v.len < 3",
		"end function",
		"print d.values",
	].join("\n");
	assert.deepEqual(lint(text), []);
});

test("an end with nothing open is reported as stray", () => {
	const found = lint(["print 1", "end if"].join("\n"));
	assert.equal(found.length, 1);
	assert.equal(found[0].code, "stray-end");
	assert.equal(found[0].message, "`end if` has no `if` to close.");
	assert.equal(found[0].line, 1);
});

test("an end that cannot close what is open says what to add", () => {
	const found = lint(["if true then", '\tprint "yes"', "end function"].join("\n"));
	assert.equal(found.length, 1);
	assert.equal(found[0].code, "mismatched-end");
	assert.equal(found[0].line, 2);
	assert.match(found[0].message, /`end function` cannot close the `if` opened on line 1/);
	assert.match(found[0].message, /Add `end if` before it\./);
});

test("a short-form if opens no block", () => {
	assert.deepEqual(lint(['if true then print "yes"']), []);
});

test("an else-if chain is one block", () => {
	const text = [
		"if n < 0 then",
		'\tprint "neg"',
		"else if n > 0 then",
		'\tprint "pos"',
		"else",
		'\tprint "zero"',
		"end if",
	];
	assert.deepEqual(lint(text), []);
});

test("a block left open inside the one an end closes says where", () => {
	const found = lint(["f = function()", "\tif true then", '\t\tprint "yes"', "end function"].join("\n"));
	assert.equal(found.length, 1);
	assert.equal(found[0].code, "unclosed-block");
	assert.equal(found[0].line, 1);
	assert.match(found[0].message, /`if` is never closed/);
	assert.match(found[0].message, /before the `end function` on line 4/);
});

test("an import that names no file is reported on the string", () => {
	const text = ['import "found"', 'import "missing"'].join("\n");
	const found = lint(text, { moduleExists: (target) => target === "found" });
	assert.equal(found.length, 1);
	assert.equal(found[0].code, "missing-import");
	assert.equal(found[0].severity, "warning");
	assert.equal(found[0].message, '`import "missing"` finds no missing.ms.');
	assert.deepEqual([found[0].line, found[0].character, found[0].endCharacter], [1, 7, 16]);
});

test("an import is judged only when the caller can look for it", () => {
	assert.deepEqual(lint('import "missing"'), []);
	assert.deepEqual(lint('import "missing"', { moduleExists: () => true }), []);
	assert.deepEqual(lint('import "missing"', { moduleExists: () => undefined }), []);
});

test("problems come back in the order they appear", () => {
	const found = lint(['import "missing"', "end if", 's = "hi"', "print s.lengh"].join("\n"), {
		moduleExists: () => false,
	});
	assert.deepEqual(
		found.map((problem) => [problem.line, problem.code]),
		[
			[0, "missing-import"],
			[1, "stray-end"],
			[3, "unknown-member"],
		]
	);
});
