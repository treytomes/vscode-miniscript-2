// The intrinsic table behind the tooltips: `print`, `s.len`, `file.readLines` and the
// rest of what MiniScript provides. Checked without VS Code, like symbols.js.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { global, member } = require("../builtins.js");

test("a global intrinsic is found by the name it is called by", () => {
	const print = global("print");
	assert.equal(print.name, "print");
	assert.equal(print.kind, "intrinsic");
	assert.match(print.signature, /^print\(/);
	assert.match(print.doc, /print/i);
	assert.equal(global("printy"), undefined);
});

test("a member is looked up on the type the value holds", () => {
	const len = member("len", "string");
	assert.equal(len.length, 1, "only the string's len");
	assert.equal(len[0].type, "string");
	assert.equal(len[0].call, "len");
	assert.match(len[0].note, /characters/);

	assert.equal(member("len", "map")[0].note, "The number of key-value pairs in self.");
	assert.deepEqual(member("len", "number"), [], "a number has no members");
});

test("a member of an unknown type is offered for every type that has one", () => {
	assert.deepEqual(member("len").map((variant) => variant.type), ["string", "list", "map"]);
	assert.deepEqual(member("push").map((variant) => variant.type), ["list", "map"]);
	assert.deepEqual(member("lower").map((variant) => variant.type), ["string"]);
	assert.deepEqual(member("nothing"), []);
});

test("every entry carries a call and a note", () => {
	for (const name of ["hasIndex", "indexOf", "values", "readLines", "close"]) {
		for (const variant of member(name)) {
			assert.equal(typeof variant.call, "string", name);
			assert.ok(variant.note.length > 0, name);
		}
	}
});
