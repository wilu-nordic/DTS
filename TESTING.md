# Testing the DTS Diff Tool Extension

## Quick Start

1. **Launch Extension Development Host**
   - Press `F5` in VS Code to open a new window with the extension loaded
   - Or use the Command Palette: `Developer: Reload Window`

2. **Test File Comparison**
   - Open `example.dts` in the new window
   - Right-click and select "DTS: Compare Files (Skip Comments)"
   - Choose `example-v2.dts` to compare
   - Notice how all comments are filtered out, showing only the actual code differences

3. **Test Clipboard Comparison**
   - Copy the content of `example-v2.dts` to clipboard
   - Open `example.dts`
   - Right-click and select "DTS: Compare with Clipboard (Skip Comments)"
   - See the clean diff without comment noise

4. **Test Comment Stripping**
   - Open `example.dts`
   - Right-click and select "DTS: Strip Comments from File"
   - A new editor will open with all comments removed

## Key Features Demonstrated

### Comment Filtering
The extension intelligently removes:
- Line comments (`//`)
- Block comments (`/* */`)
- Multi-line block comments

While preserving:
- String literals containing comment-like characters
- Code structure and indentation
- Meaningful whitespace

### File Types Supported
- `.dts` files (Device Tree Source)
- `.dtsi` files (Device Tree Source Include)

### Context Menu Integration
Commands are available:
- In Explorer context menu (right-click on .dts/.dtsi files)
- In Editor context menu (right-click in editor)
- Via Command Palette (Ctrl/Cmd+Shift+P)

## Expected Behavior

### Before (with comments)
```dts
/* Sample Device Tree Source file for testing */
/dts-v1/;

/ {
    model = "Example Board"; // Board identifier
    compatible = "vendor,example-board";
    
    /* Memory configuration */
    memory@80000000 {
        device_type = "memory";
        reg = <0x80000000 0x20000000>; // 512MB RAM
    };
```

### After (comments filtered)
```dts
/dts-v1/;

/ {
    model = "Example Board";
    compatible = "vendor,example-board";
    
    memory@80000000 {
        device_type = "memory";
        reg = <0x80000000 0x20000000>;
    };
```

## Troubleshooting

### Extension Not Loading
- Check the Debug Console for errors
- Ensure dependencies are installed: `npm install`
- Recompile: `npm run compile`

### Commands Not Appearing
- Verify you're working with .dts or .dtsi files
- Check the Command Palette for "DTS:" prefixed commands

### Diff Not Opening
- Ensure both files exist and are readable
- Check VS Code's diff viewer permissions
- Look for error messages in the notification area

## Development Notes

- Temporary files are created in the extension's global storage
- Files are automatically cleaned up after 30 seconds
- The extension preserves the original files unchanged
- All filtering happens on copies for comparison only