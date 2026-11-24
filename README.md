# MiniScript 2 for Visual Studio Code

Language support for [MiniScript 2](https://github.com/JoeStrout/miniscript2): `.ms` files
get syntax highlighting, a play button that runs the one you are looking at, and a test
suite in the Testing panel.

## What you get

- A TextMate grammar for MiniScript 2 (scope `source.miniscript`), registered for `.ms`
  files, with the aliases `MiniScript`, `MiniScript 2` and `miniscript`.
- A language configuration, so `//` comments toggle, brackets match and auto-close, and
  `if` / `else` / `for` / `while` / `function` … `end` blocks indent themselves.
- **Run MiniScript File** — a play button in the editor title bar, also on the Command
  Palette. It saves the file if it is dirty, opens a terminal in the project folder and
  runs the file there.
- **Tooltips, Ctrl-click and the Outline** — hover a function for its docstring or an
  intrinsic like `print` for what it does, Ctrl-click a name to jump to where it is
  defined, and read the file's functions, methods and classes in the Outline view. See
  below.
- **Squiggles before the run** — a member no type has, a block that never closes, and an
  `import` that names no file are marked as you type, with a "did you mean" for the
  first. See below.
- **Completion and a call's parameters** — Ctrl+Space offers the names in scope, an
  imported module's names after its alias, and a receiver's own and the language's
  members; typing a call shows its parameters with the one you are writing in bold. See
  below.
- **Notebooks** — a `.msnb` file is a column of cells, each run with Shift+Enter against
  one MiniScript session, its output underneath, pictures a cell draws included. See below.
- **Testing panel** — your suite in VS Code's own Test Explorer, one item per case module
  and per check, each result marked in the gutter of the check's own line. See below.

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
listed.

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
Ctrl-clicking `knowledge.loadFacts` reads that file, and Ctrl-clicking the string on the
`import` line opens it. A name found in neither this file nor an imported module is
looked for in the workspace's other `.ms` files, and Ctrl-click lists every file that
defines it.

## Squiggles before the run

Three problems are marked as you type, without starting the interpreter:

- **A member the type does not have.** `s = "hi"` makes `s.lengh` a warning, and hovering
  it says what was probably meant: *`string` has no member `lengh`. Did you mean `len`?*
  Only a receiver whose type the file can prove — a string or a list — is judged, and
  `m.anything` is never reported, since every key of a map is a member. A file that adds a
  member to a type (`string.shout = function`) turns the check off for that type. The
  interpreter only finds the mistake when the line runs (`Key Not Found`), which is why it
  is a warning rather than an error.
- **A block that never closes.** `if`, `for`, `while` and `function` are each closed by
  their own `end`. An `end function` inside a still-open `if` is reported on the `end`
  line with the fix — *add `end if` before it* — and a file that ends with a block open is
  reported where it opened. A short-form `if x then y` opens nothing, a one-line function
  (`f = function(n); return n; end function`) closes on its own line, and an `else if`
  chain is still one `if`. This one is an error: the file does not compile.
- **An import that names no file.** `import "missing"` is marked on the path itself when
  there is no `missing.ms` in the workspace, and a path relative to the file
  (`import "../src/triples"`) is looked for beside it, the way the interpreter looks. It
  is a warning, since a module can also sit on `MS_IMPORT_PATH`, outside the workspace.
  With no workspace folder to search, imports are not judged at all, so a scratch file is
  never told its imports are missing.

Nothing is run and nothing is written: the same text scan behind the tooltips and the
Outline answers these, so a file the interpreter could not start is still read. The
squiggles follow your edits, refreshed shortly after typing stops.

## Completing names, and a call's parameters

**Ctrl+Space** completes the names a line can use: the enclosing function's own names and
parameters first, then the file's top level, then the modules it imports by name. After a
`.` the list is that receiver's — `s.` offers the string's own members, `xs.` the list's,
`file.` the file module's, `Shape.` the methods the file gave that class, and `lib.` the
names `import "lib"` brings in. Nothing is offered inside a string or a comment, where a
name is text, and a receiver whose type the file cannot prove offers only what the file
defines on it.

While a call is being written, its parameters are shown in the parameter popup with the
one the cursor is in in bold: a project function's own list, or an intrinsic's from the
language's tables (`s.split(delimiter=" ", maxCount=null)`). A call may wrap its arguments
over several lines — the popup reads back to the parenthesis that opened it — and the
count follows that call's own commas, so a call inside an argument does not move it.

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
`--json` to collect its checks. If you add, rename or remove checks, run
**Developer: Reload Window** to rediscover them.

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
read.

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

There is no build step and no dependency: `extension.js` and `testing.js` are plain
CommonJS, and VS Code supplies its own `vscode` module.

- Open this folder in VS Code and press `F5`; the checked-in `.vscode/launch.json` starts
  an Extension Development Host with this folder as the development extension.
- `npm test` (`node --test`) runs the symbol scanner's tests, the lint pass's, the
  diagnostics' and the completion and signature-help providers' wiring against a stub
  `vscode`, the Testing panel's tests, and the notebook's tests: its file format and
  controller against a stub `vscode`, and its cell protocol against the real interpreter.
  Those tests skip when `../3rd-party` has no interpreter and `MINISCRIPT_EXE_PATH` is
  unset.
- `symbols.js` reads a file into symbols (nothing in it requires `vscode`); `builtins.js`
  is the table of intrinsic functions and methods; `lint.js` finds the problems those two
  can see without running the file; `features.js` turns them into the hover, definition,
  outline, completion and signature-help providers and the diagnostics.
- `notebook-session.js` is the cell protocol — the interpreter process, what is written
  to it, and how its output is read back — and uses no `vscode`, so it is tested against
  the interpreter itself; `notebook.js` is the `.msnb` serializer and the controller
  around it.
- To package a `.vsix`: `npx @vscode/vsce package`, which writes `out/miniscript2.vsix`.
  `.vscodeignore` keeps `.vscode/`, `out/` and any `.vsix` out of the package.

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 Trey Tomes.
