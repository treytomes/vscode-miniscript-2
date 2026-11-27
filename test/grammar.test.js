// The GRFON grammar, checked by running the real tokenizer over sample lines and over the
// project's own documents. A grammar is text like any other, so nothing else notices when a
// rule stops matching; this does.

const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vsctm = require("vscode-textmate");
const oniguruma = require("vscode-oniguruma");

const root = path.join(__dirname, "..");
const grammarPath = path.join(root, "syntaxes", "grfon.tmLanguage.json");
const services = path.join(root, "..", "services");

let grammar;

before(async () => {
	const wasm = fs.readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")).buffer;
	await oniguruma.loadWASM(wasm);
	const registry = new vsctm.Registry({
		onigLib: Promise.resolve({
			createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
			createOnigString: (text) => new oniguruma.OnigString(text),
		}),
		loadGrammar: async (scope) =>
			scope === "source.grfon"
				? vsctm.parseRawGrammar(fs.readFileSync(grammarPath, "utf8"), grammarPath)
				: null,
	});
	grammar = await registry.loadGrammar("source.grfon");
	assert.ok(grammar, "the grammar loads as source.grfon");
});

// Every rule is a plain match with no begin/end state, so one line at a time is enough.
function tokensOf(line) {
	return grammar.tokenizeLine(line, vsctm.INITIAL).tokens.map((token) => ({
		text: line.slice(token.startIndex, token.endIndex),
		startIndex: token.startIndex,
		scope: token.scopes[token.scopes.length - 1],
	}));
}

function scopeOf(line, text) {
	const token = tokensOf(line).find((each) => each.text === text);
	return token && token.scope;
}

function assertScope(line, text, scope) {
	assert.equal(scopeOf(line, text), scope, JSON.stringify(text) + " in " + JSON.stringify(line));
}

// Text the grammar leaves alone shares its token with the whitespace around it, so a plain
// value is found by containment and must carry no scope of its own.
function assertPlain(line, text) {
	const token = tokensOf(line).find((each) => each.text.includes(text));
	assert.ok(token, JSON.stringify(text) + " is one token in " + JSON.stringify(line));
	assert.equal(token.scope, "source.grfon", JSON.stringify(text) + " in " + JSON.stringify(line));
}

function numericTokens(line) {
	return tokensOf(line).filter((token) => token.scope.startsWith("constant.numeric."));
}

test("a key, its colon, the braces and the semicolons are colored", () => {
	assertScope("service: geocode.maps.co", "service", "support.type.property-name.grfon");
	assertScope("service: geocode.maps.co", ":", "punctuation.separator.key-value.grfon");

	// A value that merely looks like the colon's left side is not a key.
	const inline = "{name: Doors; maxPower: 1;}";
	assertScope(inline, "{", "punctuation.section.braces.grfon");
	assertScope(inline, "name", "support.type.property-name.grfon");
	assertPlain(inline, "Doors");
	assertScope(inline, ";", "punctuation.separator.list.grfon");
	assertScope(inline, "maxPower", "support.type.property-name.grfon");
	assertScope(inline, "1", "constant.numeric.grfon");
	assertScope(inline, "}", "punctuation.section.braces.grfon");

	// A key written on the line after a value is a key too.
	assertPlain("  {name: lat; type: number; min: -90; max: 90}", "lat");
	assertScope("  {name: lat; type: number; min: -90; max: 90}", "type", "support.type.property-name.grfon");
});

test("a comment starts at //, but never at a url's ://", () => {
	const note = "  // a note: nothing here is a key";
	assertScope(note, "// a note: nothing here is a key", "comment.line.double-slash.grfon");

	const url = "base: https://api.open-meteo.com";
	assertPlain(url, "https://api.open-meteo.com");
	assert.ok(
		!tokensOf(url).some((token) => token.scope.startsWith("comment.")),
		"the :// of a url is not a comment"
	);

	// A comment after a value still is one, and the url before it stays whole.
	const both = "  url: https://miniscript.org // the site";
	assertScope(both, "// the site", "comment.line.double-slash.grfon");
	assertPlain(both, "https://miniscript.org");
});

test("escapes, numbers and null are colored only where the format reads them", () => {
	assertScope("  {min: -90; max: 90; required: 1}", "-90", "constant.numeric.grfon");
	assertScope("  {min: -90; max: 90; required: 1}", "90", "constant.numeric.grfon");
	assertScope("  {required: 1}", "1", "constant.numeric.grfon");
	assertScope("ratio: .5", ".5", "constant.numeric.grfon");
	assertScope("percent: 50%", "50%", "constant.numeric.grfon");
	assertScope("missing: null", "null", "constant.language.null.grfon");

	// GRFON's escape is what keeps a value that begins with a digit text.
	assertScope("doc: \\15-minutely variables.", "\\1", "constant.character.escape.grfon");
	assert.equal(numericTokens("doc: \\15-minutely variables.").length, 0);
	assertScope("doc: boolAs \\1/0 is text.", "\\1", "constant.character.escape.grfon");

	// A digit inside a name is part of the name; prose that begins with a number is prose.
	assert.equal(numericTokens("  {name: temperature_2m; type: csv}").length, 0);
	assert.equal(numericTokens("  doc: 0 to 40.").length, 0);

	// GRFON reads true and false as text on purpose, so they are not literals here either.
	assert.equal(
		tokensOf("  flag: true").filter((token) => token.scope.startsWith("constant.language")).length,
		0
	);
});

test("an escaped colon stays a term, and a term's own characters are colored", () => {
	const line = "      {has-name-in-fr; ?place; $.namedetails.name\\:fr};";
	assertScope(line, "?place", "variable.parameter.term.grfon");
	assertScope(line, "$.namedetails.name", "variable.other.path.grfon");
	assertScope(line, "\\:", "constant.character.escape.grfon");

	// The escaped colon must not be read as a pair, which would swallow the path and the escape.
	assert.ok(
		!tokensOf(line).some((token) => token.scope.startsWith("support.type.property-name.")),
		"nothing on that line is a key"
	);
});

test("a reference and its arguments are colored, and so is the root of a path", () => {
	assertScope("use: @weather", "@", "punctuation.definition.reference.grfon");
	assertScope("use: @weather", "weather", "variable.other.reference.grfon");
	assertScope("      @forecastDays(16);", "forecastDays", "variable.other.reference.grfon");
	assertScope("      @forecastDays(16);", "16", "variable.parameter.argument.grfon");
	assertScope("each: $", "$", "variable.other.path.grfon");
});

test("a takes placeholder is colored, and its declaration is left alone", () => {
	assertScope("    takes: {most}", "most", "source.grfon");

	const parameter =
		"      {name: forecast_days; type: int; min: 0; max: <most>; doc: Forecast days, 0 to <most>.}";
	assertScope(parameter, "<most>", "variable.parameter.placeholder.grfon");
	assert.equal(
		tokensOf(parameter).filter((token) => token.scope.startsWith("variable.parameter.placeholder.")).length,
		2,
		"both uses of the name are placeholders"
	);
	assertPlain(parameter, "0 to ");

	assertScope("      {fact: {<predicate>; ?place; ?value};", "<predicate>", "variable.parameter.placeholder.grfon");
	assertScope("      request: {hourly: {<variable>;}; timezone: auto}}", "<variable>", "variable.parameter.placeholder.grfon");

	// An angle bracket that names nothing is text.
	assertPlain("  doc: less than < 5 and more.", "< 5");
});

test("every document in ../services tokenizes cleanly", (t) => {
	const files = fs.existsSync(services)
		? fs.readdirSync(services).filter((name) => name.endsWith(".grfon")).sort()
		: [];
	if (files.length === 0) {
		t.skip("no ../services/*.grfon beside the extension");
		return;
	}

	for (const name of files) {
		const lines = fs.readFileSync(path.join(services, name), "utf8").split("\n");
		let keys = 0;
		let placeholders = 0;
		let takes = 0;
		lines.forEach((line, index) => {
			const where = name + ":" + (index + 1);
			const tokens = tokensOf(line);
			assert.equal(tokens.map((token) => token.text).join(""), line, where + " is read whole");
			for (const token of tokens) {
				if (token.scope.startsWith("comment.")) {
					assert.equal(token.text.slice(0, 2), "//", where + " starts its comment at //");
					assert.notEqual(line[token.startIndex - 1], ":", where + " does not read a url as a comment");
				}
				if (token.scope.startsWith("support.type.property-name.")) {
					keys++;
					assert.ok(!token.text.includes("\\"), where + " reads an escaped colon as a colon");
				}
				if (token.scope.startsWith("constant.numeric.")) {
					assert.ok(!/[A-Za-z]/.test(token.text), where + " reads a name as a number");
				}
				if (token.scope.startsWith("variable.parameter.placeholder.")) {
					placeholders++;
					assert.match(token.text, /^<[A-Za-z_][A-Za-z0-9_-]*>$/, where + " reads a placeholder whole");
				}
			}
			if (line.includes("takes:")) takes++;
		});
		assert.ok(keys > 0, name + " yields keys");
		if (takes > 0) assert.ok(placeholders > 0, name + " colors the names its takes groups fill");
	}
});

test("the extension registers .grfon with this grammar and configuration", () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
	const language = pkg.contributes.languages.find((entry) => entry.id === "grfon");
	assert.ok(language, "the grfon language is contributed");
	assert.deepEqual(language.extensions, [".grfon"]);

	const configurationPath = path.join(root, language.configuration);
	assert.ok(fs.existsSync(configurationPath), "its configuration file exists");
	const configuration = JSON.parse(fs.readFileSync(configurationPath, "utf8"));
	assert.equal(configuration.comments.lineComment, "//");

	const contribution = pkg.contributes.grammars.find((entry) => entry.language === "grfon");
	assert.ok(contribution, "a grammar is registered for it");
	assert.equal(contribution.scopeName, "source.grfon");

	const registered = path.join(root, contribution.path);
	assert.ok(fs.existsSync(registered), "the grammar file exists");
	const raw = JSON.parse(fs.readFileSync(registered, "utf8"));
	assert.equal(raw.scopeName, contribution.scopeName, "the file's scope is the one registered");
	assert.deepEqual(raw.fileTypes, ["grfon"]);
});
