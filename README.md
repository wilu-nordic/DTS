# DTS Diff Tool

A VS Code extension for comparing Device Tree Source (.dts) files with automatic comment filtering.

## Features

- Compare two .dts files with comments automatically filtered out
- Compare active .dts file with clipboard content (comments filtered)
- Clean diff view focusing on actual code changes
- Context menu integration for .dts files

## Usage

### Compare Two Files
1. Open a .dts file in VS Code
2. Right-click in the explorer or editor
3. Select "DTS: Compare Files (Skip Comments)"
4. Choose the second file to compare

### Compare with Clipboard
1. Copy .dts content to clipboard
2. Open a .dts file in VS Code
3. Right-click in the editor
4. Select "DTS: Compare with Clipboard (Skip Comments)"

## Extension Settings

This extension contributes the following commands:

* `dtsDiff.compareFiles`: Compare two DTS files with comment filtering
* `dtsDiff.compareWithClipboard`: Compare active file with clipboard content

## Known Issues

None at this time.

## Release Notes

### 0.0.1

Initial release of DTS Diff Tool
- Basic file comparison with comment filtering
- Clipboard comparison support
- Context menu integration