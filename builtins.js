// builtins.js — the names MiniScript itself provides, so a tooltip can say what `print` or
// `s.len` is. Nothing here is defined in the file you are reading, and none of it can be
// navigated to: this is the other half of a reference, the part the project did not write.
//
// The language's own tables are the source: the Intrinsic Functions chapter of the
// MiniScript manual, and the command-line manual for the host functions (file, env and
// friends). MiniScript has no declarations for these either — they live in the `intrinsics`
// map, and are reached by name or through dot syntax.
//
// No `vscode` in here: this is a table and two lookups, so the tests can read it.

// A global intrinsic, by the name it is called by: [signature, what it does].
const GLOBALS = {
	// Numbers
	abs: ["abs(x)", "The absolute value of x."],
	acos: ["acos(x)", "The arccosine of x, in radians."],
	asin: ["asin(x)", "The arcsine of x, in radians."],
	atan: ["atan(y, x=1)", "The arctangent of y/x, in radians, in the right quadrant when x is given."],
	bitAnd: ["bitAnd(x, y)", "The bitwise AND of x and y, read as integers."],
	bitOr: ["bitOr(x, y)", "The bitwise OR of x and y, read as integers."],
	bitXor: ["bitXor(x, y)", "The bitwise exclusive OR of x and y, read as integers."],
	ceil: ["ceil(x)", "The smallest whole number not less than x."],
	cos: ["cos(r)", "The cosine of r radians."],
	floor: ["floor(x)", "The largest whole number not greater than x."],
	log: ["log(x, base=10)", "The logarithm of x to base: the y with base^y == x."],
	pi: ["pi", "3.14159265358979, the ratio of a circle's circumference to its diameter."],
	range: ["range(from, to=0, step=null)", "The values from through to in steps of step, which is 1 upward or -1 downward when it is null."],
	round: ["round(x, d=0)", "x rounded to d decimal places."],
	rnd: ["rnd(seed=null)", "A random number in [0, 1); with a seed, seeds the generator instead."],
	sign: ["sign(x)", "-1, 0 or 1 as x is below, equal to or above zero."],
	sin: ["sin(r)", "The sine of r radians."],
	sqrt: ["sqrt(x)", "The square root of x."],
	tan: ["tan(r)", "The tangent of r radians."],
	str: ["str(x)", "x converted to a string."],
	val: ["val(x)", "x converted to a number, or 0 when x is not a valid number."],

	// Strings, lists and maps: called through a value, or as a global with it first
	char: ["char(i)", "The Unicode character with code point i."],
	code: ["code(self)", "The Unicode code point of the first character of self."],
	hasIndex: ["hasIndex(self, i)", "1 if i is a valid index in self (a key, for a map), else 0."],
	indexes: ["indexes(self)", "range(0, self.len - 1) for a string or list, or the keys of a map."],
	indexOf: ["indexOf(self, value, after=null)", "The 0-based position of the first value in self, or null; the search begins after the given position when one is given."],
	insert: ["insert(self, index, value)", "self with value inserted at index."],
	join: ["join(self, delimiter=\" \")", "The elements of self joined into a string, with delimiter between them."],
	len: ["len(self)", "The number of characters in a string, elements in a list, or key-value pairs in a map."],
	lower: ["lower(self)", "self in lower case."],
	pop: ["pop(self)", "Removes and returns the last element of a list, or an arbitrary key of a map."],
	pull: ["pull(self)", "Removes and returns the first element of a list."],
	push: ["push(self, value)", "Appends value to a list, or sets self[value] = 1 in a map."],
	remove: ["remove(self, key)", "self with one thing removed: a substring from a string, the element at an index from a list, or the entry with that key from a map."],
	replace: ["replace(self, oldval, newval, maxCount=null)", "self with up to maxCount occurrences of oldval replaced by newval, or all of them when maxCount is null."],
	shuffle: ["shuffle(self)", "Rearranges a list, or remaps a map's values, at random."],
	slice: ["slice(seq, from, to)", "The part of a string or list from from up to but not including to, the same as seq[from:to]."],
	sort: ["sort(self, key=null, ascending=1)", "Sorts a list in place, by the value of key when it is given."],
	split: ["split(self, delimiter=\" \", maxCount=null)", "The parts of self split by delimiter, at most maxCount of them."],
	sum: ["sum(self)", "The total of the numeric elements of a list, or values of a map."],
	upper: ["upper(self)", "self in upper case."],
	values: ["values(self)", "The characters of a string, the elements of a list, or the values of a map."],

	// The language itself
	print: ["print(x, delimiter=\"\\n\")", "x converted to a string and printed, followed by delimiter, which is a line break unless one is given."],
	input: ["input(prompt=null)", "Prints the prompt, waits for a line to be typed, and returns it as a string."],
	err: ["err(msg, inner=null)", "A new error value with the given message, wrapping the inner error when one is given."],
	info: ["info(x)", "A map of details about x: for a function, its name, note, parameters and source location."],
	hash: ["hash(obj)", "A hash of obj, the same for equal values."],
	refEquals: ["refEquals(a, b)", "1 if a and b are the same instance, not merely equal values."],
	time: ["time", "The number of seconds since the program started."],
	wait: ["wait(x=1)", "Waits x seconds before the next instruction."],
	yield: ["yield", "Waits for the next invocation of the host's main loop."],
	stackTrace: ["stackTrace", "The current call stack, as a list of strings."],
	version: ["version", "A map of what is running: miniscript, buildDate, platform, host and hostName."],
	globals: ["globals", "The global variable map, where a file's top-level names live."],
	locals: ["locals", "The local variable map of the current call frame."],
	intrinsics: ["intrinsics", "A map of every global intrinsic function."],

	// The types, which are also names you can test a value against with `isa`
	list: ["list", "The list type: x isa list."],
	map: ["map", "The map type: x isa map. An instance of a class is one too."],
	number: ["number", "The number type: x isa number."],
	string: ["string", "The string type: x isa string."],
	funcRef: ["funcRef", "The function type: x isa funcRef."],
	error: ["error", "The error type: x isa error."],

	// The command-line host
	file: ["file", "The module of file and directory functions: file.readLines, file.open and the rest."],
	FileHandle: ["FileHandle", "The class of open files that file.open returns."],
	RawData: ["RawData", "The class of byte buffers that file.loadRaw returns."],
	key: ["key", "The module that reads the keyboard one keystroke at a time."],
	exit: ["exit(resultCode=0)", "Stops the program, returning resultCode as the process exit status."],
	shellArgs: ["shellArgs", "The command-line arguments, starting with the script path (read-only)."],
	env: ["env", "The environment variables, as a map; changes are passed to commands run with exec."],
	exec: ["exec(cmd, timeout=30)", "Runs cmd with the system shell and returns a map of output, errors and status."],
};

// The intrinsics reached through a value, by the type it holds: MEMBERS[type][name] =
// [call, what it does]. A member with no parentheses is a computed property (`.len`).
const MEMBERS = {
	string: {
		code: ["code", "The Unicode code point of the first character of self."],
		hasIndex: ["hasIndex(i)", "1 if i is in 0 to self.len - 1, else 0."],
		indexes: ["indexes", "range(0, self.len - 1)."],
		indexOf: ["indexOf(s, after=null)", "The 0-based position of the first s within self, or null; the search begins after the given position when one is given."],
		insert: ["insert(index, s)", "A copy of self with s inserted at index."],
		len: ["len", "The number of characters in self."],
		lower: ["lower", "self in lower case."],
		remove: ["remove(s)", "A copy of self with the first s removed."],
		replace: ["replace(oldval, newval, maxCount=null)", "A copy of self with up to maxCount occurrences of oldval replaced by newval."],
		split: ["split(delimiter=\" \", maxCount=null)", "The parts of self split by delimiter, at most maxCount of them."],
		upper: ["upper", "self in upper case."],
		val: ["val", "self converted to a number, or 0 when self is not a valid number."],
		values: ["values", "The individual characters of self."],
	},
	list: {
		hasIndex: ["hasIndex(i)", "1 if i is in 0 to self.len - 1, else 0."],
		indexes: ["indexes", "range(0, self.len - 1)."],
		indexOf: ["indexOf(x, after=null)", "The 0-based position of the first element equal to x, or null."],
		insert: ["insert(index, value)", "Inserts value into self at index, in place."],
		join: ["join(delimiter=\" \")", "The elements of self joined into a string, with delimiter between them."],
		len: ["len", "The number of elements in self."],
		pop: ["pop", "Removes and returns the last element of self."],
		pull: ["pull", "Removes and returns the first element of self."],
		push: ["push(value)", "Appends value to the end of self."],
		remove: ["remove(i)", "Removes the element at index i, in place."],
		replace: ["replace(oldval, newval, maxCount=null)", "Replaces up to maxCount occurrences of oldval with newval, in place."],
		shuffle: ["shuffle", "Rearranges the elements of self at random, in place."],
		sort: ["sort(key=null, ascending=1)", "Sorts self in place, by the value of key when it is given."],
		sum: ["sum", "The total of the numeric elements of self."],
		values: ["values", "The elements of self."],
	},
	map: {
		hasIndex: ["hasIndex(x)", "1 if x is a key of self, else 0."],
		indexes: ["indexes", "The keys of self, in arbitrary order."],
		indexOf: ["indexOf(x, after=null)", "The first key of self whose value is x, or null."],
		len: ["len", "The number of key-value pairs in self."],
		pop: ["pop", "Removes and returns an arbitrary key of self."],
		push: ["push(x)", "Sets self[x] = 1, which makes a map work as a set."],
		remove: ["remove(x)", "Removes the entry whose key is x, in place."],
		replace: ["replace(oldval, newval, maxCount=null)", "Replaces up to maxCount values equal to oldval with newval, in place."],
		shuffle: ["shuffle", "Remaps the values of self at random."],
		sum: ["sum", "The total of the numeric values of self."],
		values: ["values", "The values of self, in arbitrary order."],
	},
	error: {
		err: ["err(msg, inner=null)", "A new error of this type, wrapping the inner error when one is given."],
	},
	file: {
		curdir: ["curdir", "The current working directory."],
		setdir: ["setdir(path)", "Changes the current working directory."],
		makedir: ["makedir(path)", "Creates a new directory."],
		children: ["children(path)", "The names of the files and directories within path."],
		name: ["name(path)", "The file name part of path, after the last slash."],
		parent: ["parent(path)", "The directory part of path."],
		child: ["child(parentPath, childName)", "A directory path and a name joined into one path."],
		exists: ["exists(path)", "1 if a file or directory exists at path, else 0."],
		info: ["info(path)", "A map of path, isDirectory, size and date for path, or null when it does not exist."],
		copy: ["copy(oldPath, newPath)", "Copies a file."],
		move: ["move(oldPath, newPath)", "Moves or renames a file."],
		delete: ["delete(path)", "Deletes a file, or an empty directory."],
		readLines: ["readLines(path)", "The lines of a text file, as a list of strings."],
		writeLines: ["writeLines(path, lines)", "Writes a list of strings to a text file, one per line, replacing what was there."],
		loadRaw: ["loadRaw(path)", "The contents of a file, as a RawData buffer."],
		saveRaw: ["saveRaw(path, data)", "Writes a RawData buffer to a file."],
		open: ["open(path, mode=\"r+\")", "Opens a file and returns a FileHandle; mode is \"r\", \"w\", \"a\" or \"r+\"."],
	},
	FileHandle: {
		write: ["write(data)", "Writes a string to the file."],
		writeLine: ["writeLine(data)", "Writes a string, followed by a line break."],
		read: ["read(byteCount=-1)", "Reads up to byteCount bytes as a string, or to the end of the file when none is given."],
		readLine: ["readLine", "Reads the next line, without its line break."],
		atEnd: ["atEnd", "1 if the read position is at the end of the file."],
		position: ["position", "The read/write position, in bytes from the start; it can also be assigned to."],
		seek: ["seek(pos)", "Moves to the given position."],
		isOpen: ["isOpen", "1 if the file is still open."],
		close: ["close", "Closes the file."],
	},
	RawData: {
		len: ["len", "The size of the buffer in bytes; it can also be assigned to."],
		resize: ["resize(bytes=32)", "Changes the size of the buffer."],
		littleEndian: ["littleEndian", "The byte order for multi-byte values: 1 (the default) or 0."],
		byte: ["byte(offset)", "The unsigned 8-bit integer at offset."],
		setByte: ["setByte(offset, value)", "Stores an unsigned 8-bit integer at offset."],
		sbyte: ["sbyte(offset)", "The signed 8-bit integer at offset."],
		setSbyte: ["setSbyte(offset, value)", "Stores a signed 8-bit integer at offset."],
		ushort: ["ushort(offset)", "The unsigned 16-bit integer at offset."],
		setUshort: ["setUshort(offset, value)", "Stores an unsigned 16-bit integer at offset."],
		short: ["short(offset)", "The signed 16-bit integer at offset."],
		setShort: ["setShort(offset, value)", "Stores a signed 16-bit integer at offset."],
		uint: ["uint(offset)", "The unsigned 32-bit integer at offset."],
		setUint: ["setUint(offset, value)", "Stores an unsigned 32-bit integer at offset."],
		int: ["int(offset)", "The signed 32-bit integer at offset."],
		setInt: ["setInt(offset, value)", "Stores a signed 32-bit integer at offset."],
		float: ["float(offset)", "The 32-bit floating-point number at offset."],
		setFloat: ["setFloat(offset, value)", "Stores a 32-bit floating-point number at offset."],
		double: ["double(offset)", "The 64-bit floating-point number at offset."],
		setDouble: ["setDouble(offset, value)", "Stores a 64-bit floating-point number at offset."],
		utf8: ["utf8(offset, bytes=-1)", "The UTF-8 text starting at offset, or to the end of the buffer when no byte count is given."],
		setUtf8: ["setUtf8(offset, value)", "Stores a string as UTF-8, returning the number of bytes written."],
	},
	key: {
		available: ["available", "1 if a keystroke is waiting, else 0; it does not wait."],
		get: ["get", "Waits for the next keystroke and returns it as a one-character string."],
		raw: ["raw", "A flag, normally 0; 1 gives the raw bytes the terminal sends instead of translated keys."],
	},
	gc: {
		collect: ["collect", "Runs a full garbage collection."],
		stats: ["stats", "A map of garbage collector statistics."],
	},
};

// The intrinsic called `name`, or undefined when the name is the file's own.
function global(name) {
	const entry = GLOBALS[name];
	if (!entry) return undefined;
	return { name, kind: "intrinsic", signature: entry[0], doc: entry[1] };
}

// Every intrinsic called `name`: on the one type when it is known, and on all the types
// that have one by that name when the value could not be read (an empty list when none do).
function member(name, type) {
	const found = [];
	for (const [kind, members] of Object.entries(MEMBERS)) {
		if (type && kind !== type) continue;
		const entry = members[name];
		if (entry) found.push({ type: kind, call: entry[0], note: entry[1] });
	}
	return found;
}

module.exports = { global, member };
