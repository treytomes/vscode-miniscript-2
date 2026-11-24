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
- **Testing panel** — your suite in VS Code's own Test Explorer, one item per case module
  and per check, each result marked in the gutter of the check's own line. See below.

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
- `npm test` (`node --test`) runs the symbol scanner's tests, and the Testing panel's
  tests against a stub `vscode` and the real interpreter. The panel's tests skip when
  `../3rd-party` has no interpreter and `MINISCRIPT_EXE_PATH` is unset.
- `symbols.js` reads a file into symbols (nothing in it requires `vscode`); `builtins.js`
  is the table of intrinsic functions and methods; `features.js` turns both into the
  hover, definition and outline providers.
- To package a `.vsix`: `npx @vscode/vsce package`, which writes `out/miniscript2.vsix`.
  `.vscodeignore` keeps `.vscode/`, `out/` and any `.vsix` out of the package.

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 Trey Tomes.
