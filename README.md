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
- **Testing panel** — the suite named by `miniscript2.testSuite` appears in the Test
  Explorer, one item per case module and per check, with each result marked in the
  gutter of the check's own line. Running one check, a module or the whole suite runs
  only that much of the program.

## Tests in the Testing panel

There is no separate test format to write. A suite is an ordinary MiniScript program
whose harness prints a record per check, and this extension reads those records:

```
##TEST {"name":"display","status":"pass","file":"display.ms","line":14}
```

so a check's name, its result and the line it sits on all come from the suite itself, and
`test/harness.ms` here is one harness that prints them. The panel runs the suite with
`--json` to list the checks, then runs it again with `--filter` (a substring of a check's
name) and `--file` (a case module) to run the ones you asked for. A suite that does not
take those arguments will list nothing.

The run also has to say when it finished: the harness closes with
`##END {"passed":174,"failed":0,"skipped":0}`, because the interpreter exits `0` even
when an uncaught runtime error stops the program. Without that closing line the extension
reports the checks that never reported as errors rather than as passes.

The suite is found at `miniscript2.testSuite` (default `test/run.ms`), relative to each
workspace folder, and the interpreter comes from the same three places **Run MiniScript
File** uses.

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
- `npm test` (`node --test`) runs the Testing panel's tests against a stub `vscode`
  and the real interpreter. They skip when `../3rd-party` has no interpreter and
  `MINISCRIPT_EXE_PATH` is unset.
- To package a `.vsix`: `npx @vscode/vsce package`, which writes `out/miniscript2.vsix`.
  `.vscodeignore` keeps `.vscode/`, `out/` and any `.vsix` out of the package.

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 Trey Tomes.
