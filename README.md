# MiniScript 2 for Visual Studio Code

Language support for [MiniScript 2](https://github.com/JoeStrout/miniscript2): `.ms` files
get syntax highlighting and a play button that runs the one you are looking at.

## What you get

- A TextMate grammar for MiniScript 2 (scope `source.miniscript`), registered for `.ms`
  files, with the aliases `MiniScript`, `MiniScript 2` and `miniscript`.
- A language configuration, so `//` comments toggle, brackets match and auto-close, and
  `if` / `else` / `for` / `while` / `function` … `end` blocks indent themselves.
- **Run MiniScript File** — a play button in the editor title bar, also on the Command
  Palette. It saves the file if it is dirty, opens a terminal in the project folder and
  runs the file there.

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

There is no build step and no dependency: `extension.js` is plain CommonJS, and VS Code
supplies its own `vscode` module.

- Open this folder in VS Code and press `F5`; the checked-in `.vscode/launch.json` starts
  an Extension Development Host with this folder as the development extension.
- To package a `.vsix`: `npx @vscode/vsce package`, which writes `out/miniscript2.vsix`.
  `.vscodeignore` keeps `.vscode/`, `out/` and any `.vsix` out of the package.

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 Trey Tomes.
