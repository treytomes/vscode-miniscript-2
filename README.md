# MiniScript 2 for Visual Studio Code

Language support for [MiniScript 2](https://github.com/JoeStrout/miniscript2): `.ms` files
get syntax highlighting, a play button that runs the one you are looking at, and a test
suite in the Testing panel.

## What you get

- A TextMate grammar for MiniScript 2 (scope `source.miniscript`), registered for `.ms`
  files, with the aliases `MiniScript`, `MiniScript 2` and `miniscript`.
- A language configuration, so `//` comments toggle, brackets match and auto-close, and
  `if` / `else` / `for` / `while` / `function` … `end` blocks indent themselves.
- **Running** — **Run MiniScript File** (a play button, also on the Command Palette)
  saves the file if it is dirty and runs it in a terminal in the project folder;
  **Run MiniScript File with Arguments** asks for them first, and they arrive in
  `shellArgs`; **Run MiniScript Selection** sends the selection to a MiniScript REPL that
  keeps its state between selections, which **MiniScript REPL** opens on its own.
- **Tooltips, Ctrl-click and the Outline** — hover a function for its docstring or an
  intrinsic like `print` for what it does, Ctrl-click a name to jump to where it is
  defined, Find All References and Rename — a local, or an imported name across the files
  that use it — Go to Symbol in Workspace, and read the file's functions, methods and
  classes in the Outline view. An `import`'s path is a link to its module. See below.
- **Squiggles before the run** — a member no type has, a block that never closes, and an
  `import` that names no file are marked as you type, with a "did you mean" for the
  first. See below.
- **Completion and a call's parameters** — Ctrl+Space offers the names in scope, an
  imported module's names after its alias, and a receiver's own and the language's
  members; typing a call shows its parameters with the one you are writing in bold. See
  below.
- **Colors that mean something** — project functions, methods, classes, parameters and
  variables are colored from what the symbol index says they are, and the language's own
  names (`print`, `s.upper`) from its intrinsic table, so a name the file does not define
  never looks like one it does. See below.
- **Notebooks** — a `.msnb` file is a column of cells, each run with Shift+Enter against
  one MiniScript session, its output underneath, pictures a cell draws included. See below.
- **Testing panel** — your suite in VS Code's own Test Explorer, one item per case module
  and per check, each result marked in the gutter of the check's own line. See below.

## Running

All of these are terminals, so a program keeps its input, its colours and the keyboard.

- **Run MiniScript File** — the play button and the Command Palette. Saves the file if it
  is dirty, then runs it in a terminal in the project folder.
- **Run MiniScript File with Arguments** — asks for a line of arguments first. They go
  after the file exactly as typed, so the shell splits them, and the program reads them
  from `shellArgs`.
- **Run MiniScript Selection** — the editor's context menu. The selected text is written
  to a MiniScript REPL, so `x = 41` in one selection is there for `print x` in the next;
  a multi-line selection goes in as it stands, so a function can be defined across lines.
- **MiniScript REPL** — opens that REPL on its own, in the project folder, with
  `MS_IMPORT_PATH` set the way a notebook cell gets it (`<project>/src` and the project
  folder, or the project's `.env`). Closing the terminal ends the REPL.

A selection runs as the REPL reads it, expression by expression, so a `return` outside a
function, or a stray `end`, is reported where it stands. To run a whole program with its
imports resolved the way the interpreter resolves them, run the file.

## Notebooks

A `.msnb` file opens as a notebook, the way `.ipynb` does: cells one above another, each
run on its own with **Shift+Enter** or the ▶ beside it, its output underneath.
**New MiniScript Notebook** in the Command Palette opens one, and saving it writes a
`.msnb` next to the rest of the project. A new cell is MiniScript, and Markdown cells work
the way they do in any other notebook.

**One session per notebook.** A notebook's cells share one MiniScript process, so a name
one cell defines is there for the next one:

```miniscript
x = 41          // first cell
print x + 1     // second cell prints 42
```

**What a cell shows.** What it prints, as the interpreter writes it. A cell of a single
line also shows that line's value, the way the REPL echoes `1 + 1`; a cell of several
lines runs as one block, which has no value to echo, so write `print` for those.

**Pictures.** A cell can draw a picture as well as print it, two ways:

- `notebook.mermaid(diagram)` — a Mermaid diagram, drawn by VS Code's own renderer (1.121
  or later; before that the fence shows as a code block). It takes the list
  `globals["mermaid"].build(...)` returns, or one string of its lines.
- `notebook.svg(svg)` — an SVG document, which every VS Code shows as a picture. This is
  what `globals["mermaid"].svg(...)` returns: the same diagram drawn by the project's own
  renderer, so it needs nothing from the version.

```miniscript
import "mermaid"

diagram = mermaid.build(facts, types, rules)
print diagram.join(char(10))   // the text, as always
notebook.mermaid(diagram)      // and the picture, under it

notebook.svg(mermaid.svg(facts, types, rules))   // the same diagram, drawn here
```

Both go through `notebook.draw(mime, text)`, so anything with a type VS Code knows is
drawn the same way. Drawing only draws: what the cell prints is still its text output, so
print the source too when you want both — `examples/explore.msnb` does. A picture drawn
before a cell fails stays with the cell's output, above the error.

**Errors.** A runtime or compiler error stops that cell and is shown in red under it. The
session carries on, so the values from before the error are still there and the next cell
runs in the same session. What the interpreter says after the first error — its own
confusion about the lines that followed — is left out.

**Stopping and restarting.** The stop button kills the interpreter rather than the cell:
MiniScript cannot be interrupted part way. The next cell then starts a new session, so
the values defined before are gone. **Restart MiniScript Session** (the notebook toolbar,
or the Command Palette) does the same deliberately. Closing the notebook ends its
session, and outputs are not written to the file: only the cells are saved.

**Imports and the working folder.** A cell runs in the notebook's project folder and
imports the way the project's programs do: `MS_IMPORT_PATH` defaults to the notebook's
folder, `<project>/src` and the project folder, and an `MS_IMPORT_PATH` in the project's
`.env` replaces that. That is what makes `import "triples"` work in a notebook in this
repository — `examples/explore.msnb` is a notebook built that way.

A session has no entry script, but it does have an answer for one: `shellArgs` holds the
notebook's own path, set before the REPL starts. A loader that resolves a data file from
the entry script is still working from a path of its own — this project's loaders resolve
against the folder the module was loaded from, which a notebook does not have, so name the
file relative to the project folder instead (`"data/facts.kb"`).

A cell cannot read the keyboard: `input` would swallow the notebook's own lines, so a
program that asks questions belongs in **Run MiniScript File** and its terminal.

A cell is a MiniScript document to the editor, so everything the rest of this README
describes works inside one: the tooltip, Ctrl-click, the Outline, completion after a dot,
the parameter popup and the squiggles. A relative `import` in a cell is left unjudged,
since a cell has no file of its own to measure the path from.

## Tooltips, Ctrl-click and the Outline

These read the file's names without running anything.

**Hover** a function or method for its signature and its docstring — the first constant
string in its body, the same `note` that `info(@f)` reports:

```miniscript
add = function(a, b=2)
	"Adds two numbers."
	return a + b
end function
```

A function documented with a `//` comment above it instead — how most of this project's
functions are written — shows that, and so does a variable, along with its assignment.
Hovering inside a string or a comment shows nothing: a name there is text.

**Ctrl-click** (Cmd-click on macOS, or F12 / Go to Definition) a name to jump to the line
that assigns it. A name that is local to the function you are in wins over one defined
elsewhere, and `owner.name` looks for a method of that name on that receiver.

MiniScript's own names — `print`, `s.len`, `xs.push(value)`, `file.readLines(path)` — are
documented from the language's tables, and get no Ctrl-click: there is no line to jump to.
A member's type is read from the value the receiver was given, so `s = "text"` makes
`s.len` the string's; when the value does not say, every type that has that member is
listed. `self.name` and `super.name` are the exception that needs no type: inside a method
they reach the class the method belongs to, so a method called through `self` gets that
method's tooltip, its jump and its parameters. `sq = new Shape` says the same for the
instance, so `sq.method` is the method `Shape` was given. A field a method sets
(`self.sides = 0`) is a member of the class too, so `sq.sides` has a tooltip showing the
line that set it, and a jump to it.

**The Outline** (and the breadcrumb above the editor) lists the file's functions,
methods, classes and top-level variables, with a method under its class and a nested
function under the one that holds it.

MiniScript declares nothing, so a symbol is whatever a line assigns:

```miniscript
add = function(a, b=2)      // a function
Shape = {"sides": 0}        // a class, by the capitalised-name convention
Shape.degrees = function    // a method of Shape
count = 0                   // a variable
```

`import "knowledge"` makes `knowledge` a name for `knowledge.ms`: hovering or
Ctrl-clicking `knowledge.loadFacts` reads that file, and the path itself is a link that
opens it. Find All References and Rename follow it into that file too. An `import` written
as a path — `import "../sizes"` — is read the same way, resolved from the importing file,
so `sizes.helper` hovers, jumps and lists its uses as a module name's alias does. A name found in
neither this file nor an imported module is looked for in the workspace's other `.ms`
files, and Ctrl-click lists every file that defines it.

**Find All References** (`Shift+F12`) lists every place in the file the name under the
cursor is written — the declaration too, when the editor asks for it — and **Rename**
(`F2`) rewrites them. A call through an instance counts: after `sq = new Shape`,
`sq.degrees` is one of `Shape.degrees`'s uses, the same reading hover and Ctrl-click give,
and a local spelled `degrees` does not take it away. A field is found through the instance
that way too: `sq.sides` is a use of the `sides` a method set with `self.sides = 0`.

An imported name belongs to the module that defines it, so both follow it there: on
`knowledge.loadFacts`, or on the `loadFacts` where `knowledge.ms` defines it, the list is
the module's own declaration and uses together with every `alias.loadFacts` in the files
that import it, and Rename rewrites all of them. A file's own `loadFacts` is a different
name and is left alone, and so is an alias an importing file gives its own meaning — a
top-level `knowledge`, or a local in the function being written — since `knowledge.loadFacts`
there is that name's member, not the module's. Rename is offered for a local or a parameter anywhere, and for a
name at a file's top level only when something in the workspace imports that file: a module
nothing here imports could still be read by a file outside the workspace, and rewriting
only the uses the editor can see would be a quiet mistake. A member access is never renamed
as the local it happens to be spelled like.

**Go to Symbol in Workspace** (`Ctrl+T`) searches every `.ms` file for the functions,
methods, classes and top-level variables the name contains; locals and parameters are
left out, since a file does not offer them to the project.

## Squiggles before the run

Three problems are marked as you type, without starting the interpreter:

- **A member the type does not have.** `s = "hi"` makes `s.lengh` a warning, and hovering
  it says what was probably meant: *`string` has no member `lengh`. Did you mean `len`?*
  Only a receiver whose type the file can prove — a string, a list, or an instance of a
  class this file declares and gave methods — is judged, and `m.anything` is never
  reported, since every key of a map is a member. So `sq.degrez(2)` after
  `sq = new Shape` is a warning against `Shape`, with the method it probably meant; but
  nothing the program gives itself is: `sq.extra = 1`, a field a constructor sets
  (`self.label = "x"`), a literal's keys, and `Shape["n="]` are all left alone, and so is
  a class that takes a computed key (`Shape[key] = ...`) or whose other methods live in
  another module. A file that adds a member to a type (`string.shout = function`) turns
  the check off for that type. The
  interpreter only finds the mistake when the line runs (`Key Not Found`), which is why it
  is a warning rather than an error.
- **A block that never closes.** `if`, `for`, `while` and `function` are each closed by
  their own `end`. An `end function` inside a still-open `if` is reported on the `end`
  line, saying to add `end if` before it, and offers that insertion; once it is applied the
  wrong `end` is itself reported as stray, since it closes nothing. A file that ends with a
  block open is reported where it opened. A short-form `if x then y` opens nothing, a
  one-line function (`f = function(n); return n; end function`) closes on its own line, and
  an `else if` chain is still one `if`. This one is an error: the file does not compile.
- **An import that names no file.** `import "missing"` is marked on the path itself when
  there is no `missing.ms` in the workspace, and a path relative to the file
  (`import "../src/triples"`) is looked for beside it, the way the interpreter looks. It
  is a warning, since a module can also sit on `MS_IMPORT_PATH`, outside the workspace.
  With no workspace folder to search, imports are not judged at all, so a scratch file is
  never told its imports are missing.

Three of these can be repaired from the squiggle itself. A misspelt member offers the name
it probably meant — **Replace with `len`** — an unclosed block offers to insert the `end`
it is missing, above the `end` that closed an enclosing block or at the end of the file, at
the block's own indentation, and an `end` that cannot close what is open offers the `end`
that should come before it. A block still holding another brings the ends for both. The
import warning has no such fix, since whether to create the module or correct the path is
not something a scan can know.

Nothing is run and nothing is written: the same text scan behind the tooltips and the
Outline answers these, so a file the interpreter could not start is still read. The
squiggles follow your edits, refreshed shortly after typing stops.

## Completing names, and a call's parameters

**Ctrl+Space** completes the names a line can use: the enclosing function's own names and
parameters first, then the file's top level, then the modules it imports by name. After a
`.` the list is that receiver's — `s.` offers the string's own members, `xs.` the list's,
`file.` the file module's, `Shape.` the methods the file gave that class, `sq.` those same
methods and the fields a constructor set when `sq = new Shape` made it (the map's own
members are still there, since an instance is a map), and `lib.` the names `import "lib"`
brings in. Nothing is offered
inside a string or a comment, where a name is text, and a receiver whose type the file
cannot prove offers only what the file defines on it.

While a call is being written, its parameters are shown in the parameter popup with the
one the cursor is in in bold: a project function's own list, or an intrinsic's from the
language's tables (`s.split(delimiter=" ", maxCount=null)`). A call may wrap its arguments
over several lines — the popup reads back to the parenthesis that opened it — and the
count follows that call's own commas, so a call inside an argument does not move it.

## Colors that mean something

The grammar colors by shape — any `name(` is a function — so on its own it cannot tell
`print` from `add` from a name that does not exist. Semantic tokens answer that from the
same scan the tooltips use: a name the file defines is colored as what it is (function,
method, class, parameter, variable), a name the language provides (`print`, `range`,
`s.upper`) as an intrinsic, and a name the scan cannot place — an imported module's, a key
of a map — keeps the grammar's color instead of pretending to be something it is not.

The theme chooses the colors; the extension only says which kind each name is. Intrinsics
carry the standard `defaultLibrary` modifier and are mapped to `support.function.builtin`
for themes that have no rule for the type, so a theme which does not distinguish them
colors them like functions. One line in settings takes care of that:

```json
"editor.semanticTokenColorCustomizations": {
  "rules": { "intrinsic:miniscript": { "foreground": "#4EC9B0", "fontStyle": "italic" } }
}
```

Semantic highlighting is turned on for MiniScript files by default; setting
`editor.semanticHighlighting.enabled` to `false` turns it off again.

## Using the Testing panel

Your suite runs inside VS Code's own Test Explorer — the same panel every other language
uses — so there is no separate test window and nothing new to learn beyond where things
are.

**Open it.** Click the **Testing** icon (the beaker) in the Activity Bar, or run
**Testing: Focus on Test Explorer View** from the Command Palette (`Ctrl+Shift+P`). A
controller named **MiniScript 2** appears.

**Read the tree.** It is three levels deep:

- the workspace folder,
- each case module the suite runs (`display.ms`, `proofs.ms`, …),
- each check inside it, under the name the suite gave it.

The list is built the first time you open the panel, by running the suite once with
`--json` to collect its checks. It keeps itself current: saving a `.ms` file in the folder
makes the panel ask the suite again, so a check you add, rename or remove appears or goes
by itself. A check that is still there keeps its item and the last run's mark; one that
moved keeps its item and its gutter line follows.

**Run.** Hover any item and click its ▶, or select items and use the run button at the top
of the panel:

- the folder runs the whole suite,
- a module runs just that case file (the extension passes `--file`),
- a single check runs only the checks whose name contains it (`--filter`).

Running one check or one module runs only that much of the program, not the whole suite.
The **Run Failed Tests** and re-run buttons the Test Explorer provides work as usual, and
the stop button cancels a run and kills the interpreter.

**See results.** Pass and fail show as icons in the tree and in the **gutter** beside each
check's own line — open the case file to see them there. Click a check to jump to its
line. A failure carries a `FAIL <name>` message pinned to that line; select the check to
read it. Because a check's line comes from the suite itself, editing a case file and
shifting its checks is fine: the next run matches each check by name and moves the gutter
to the line the check now reports.

**When a run is cut short.** The interpreter exits `0` even when an uncaught runtime error
stops the program, so a check that never reported its result is shown as an **error**, not
a pass — *"The suite stopped before this check was recorded."* If the interpreter cannot
be found, every check in that folder errors with the reason instead.

**Output.** Anything the suite prints that is not a check — plus everything on stderr —
goes to the **Test Results** output, so a stray `print` or a stack trace is still there to
read. Each run also ends with the suite's own totals there, `2 passed, 0 failed, 0 skipped`,
since a check the harness skipped has no item of its own for the panel to count.

**Choose the suite.** `miniscript2.testSuite` (default `test/run.ms`) names the suite,
relative to each workspace folder. The interpreter comes from the same three places
**Run MiniScript File** uses (below).

## Writing a suite the panel can read

There is no separate test format to write. A suite is an ordinary MiniScript program whose
harness prints one record per check, and which honours three arguments:

- `--json` — print a `##TEST` record per check and a closing `##END` record;
- `--filter <text>` — run only the checks whose name contains `<text>`;
- `--file <module>` — run only that case module.

A check record carries its name, its result and the file and line it sits on:

```
##TEST {"name":"display","status":"pass","file":"display.ms","line":14}
```

so a check's name, result and location all come from the suite itself, and
`test/harness.ms` is one harness that prints them. The run then closes with

```
##END {"passed":174,"failed":0,"skipped":0}
```

which is how the extension tells a finished run from one an error stopped early — without
that closing line it reports the checks that never reported as errors rather than as
passes. A suite that does not take `--json`, `--filter` and `--file` will list nothing.

## Where the interpreter comes from

The extension needs a MiniScript 2 interpreter. It looks in three places, in this order:

| Order | Source | Note |
| --- | --- | --- |
| 1 | `miniscript2.interpreterPath` | Absolute, or relative to the project folder |
| 2 | `MINISCRIPT_EXE_PATH` in the project's `.env` | The same file `micro-expert.bat` reads, so one setting serves both |
| 3 | `miniscript` on `PATH` | Nothing to configure if it is installed there |

If the first two name a path that does not exist, the extension says so instead of falling
through, and offers to open the setting. The interpreter download for Windows, macOS and
Linux lives on the [MiniScript 2 releases page](https://github.com/JoeStrout/miniscript2/releases).

## Development

There is no build step and nothing shipped depends on a package: `extension.js` and
`testing.js` are plain CommonJS, and VS Code supplies its own `vscode` module. The editor
test is the only thing with dependencies — `npm install` installs `@vscode/test-electron`
and `mocha`, and the packaged extension does not include them.

- Open this folder in VS Code and press `F5`; the checked-in `.vscode/launch.json` starts
  an Extension Development Host with this folder as the development extension.
- `npm test` (`node --test`) runs the symbol scanner's tests, the lint pass's, the
  diagnostics' and the completion and signature-help providers' wiring against a stub
  `vscode`, the Testing panel's tests, and the notebook's tests: its file format and
  controller against a stub `vscode`, and its cell protocol against the real interpreter.
  Those tests skip when `../3rd-party` has no interpreter and `MINISCRIPT_EXE_PATH` is
  unset.
- `npm run test:editor` launches a real VS Code with this folder as the development
  extension and `e2e/fixtures` as the workspace, then checks one hover, one completion, one
  diagnostic and one semantic token through the editor's own commands — the wiring
  `npm test` cannot see, since it stubs `vscode`. It needs a display (on a headless machine,
  `xvfb-run -a npm run test:editor`) and downloads VS Code once into `.vscode-test/`. The
  workflow in `.github/workflows/tests.yml` runs both suites on every push and pull request.
- `symbols.js` reads a file into symbols (nothing in it requires `vscode`); `builtins.js`
  is the table of intrinsic functions and methods; `lint.js` finds the problems those two
  can see without running the file; `features.js` turns them into the hover, definition,
  outline, completion and signature-help providers and the diagnostics.
- `run.js` is the Run commands: the file with arguments, the selection in a REPL, and
the REPL itself.
- `notebook-session.js` is the cell protocol — the interpreter process, what is written
  to it, and how its output is read back — and uses no `vscode`, so it is tested against
  the interpreter itself; `notebook.js` is the `.msnb` serializer and the controller
  around it.
- To package a `.vsix`: `npx @vscode/vsce package`, which writes `out/miniscript2.vsix`.
  `.vscodeignore` keeps `.vscode/`, `out/` and any `.vsix` out of the package.

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 Trey Tomes.
