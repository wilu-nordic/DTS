# ZephyrDiff Tool

A powerful VS Code extension for comparing and formatting Zephyr Device Tree Source (.dts) files with comprehensive semantic normalization.

## Features

### 🔍 **Smart ZephyrDiff Comparison**
- **Semantic comparison** with node and property sorting
- **Comment filtering** - Focus on actual code differences
- **Recursive node sorting** - All nested nodes sorted alphabetically
- **Property normalization** - Consistent property ordering within nodes
- **Hex value normalization** - Standardized hex formatting (lowercase, consistent padding)
- **Array normalization** - Consistent spacing in `< >` arrays and string arrays
- **Whitespace normalization** - Standardized indentation and spacing

### 📋 **Comparison Options**
- **Compare two DTS files** with full semantic normalization
- **Compare with clipboard** - Quick comparison with copied DTS content
- **Copy formatted file** - Get fully normalized DTS content in clipboard
- **Save/load comparison configurations** - Reuse comparison setups

### ⚙️ **Advanced Configuration**
- **Configurable normalization options** - Enable/disable specific features
- **Property sorting** - Sort properties alphabetically within nodes
- **Node sorting** - Sort child nodes alphabetically (e.g., `cpuapp_data`, `cpurad_data`)
- **Hex and array normalization** - Consistent formatting

## Usage

### Compare Two Zephyr DTS Files
1. Open a `.dts` or `.dtsi` file in VS Code
2. Right-click in the file explorer or editor
3. Select **"ZephyrDiff: Compare Files"**
4. Choose the second file to compare
5. View semantic diff with normalized content

### Compare with Clipboard
1. Copy DTS content to clipboard
2. Open a `.dts` file in VS Code
3. Right-click in the editor
4. Select **"ZephyrDiff: Compare with Clipboard"**

### Copy Formatted File
1. Open a `.dts` file in VS Code
2. Right-click in the editor
3. Select **"ZephyrDiff: Copy formatted file"**
4. Fully normalized content is copied to clipboard

### Save Comparison Configuration
1. Open a `.dts` file and run **"ZephyrDiff: Save Comparison Configuration"**
2. Enter a configuration name
3. Select second file to compare
4. Configuration saved for future use

### Configure Advanced Options
- Run **"ZephyrDiff: Configure Advanced Comparison Options"**
- Enable/disable:
  - Semantic comparison
  - Property sorting
  - Hex value normalization
  - Array normalization
  - Comment stripping
  - Whitespace normalization

## Commands

All commands are available via Command Palette (`Ctrl+Shift+P`):

- **`ZephyrDiff: Compare Files`** - Compare two DTS files
- **`ZephyrDiff: Compare with Clipboard`** - Compare with clipboard content
- **`ZephyrDiff: Copy formatted file`** - Copy normalized DTS to clipboard
- **`ZephyrDiff: Save Comparison Configuration`** - Save comparison setup
- **`ZephyrDiff: Load Saved Comparison`** - Run saved comparison
- **`ZephyrDiff: Manage Comparison Configurations`** - Manage saved configurations
- **`ZephyrDiff: Configure Advanced Comparison Options`** - Configure normalization options
- **`ZephyrDiff: Delete Saved Comparison`** - Remove saved configuration

## Semantic Normalization

The extension performs comprehensive DTS normalization:

### Node Sorting
```dts
// Before: Random order
reserved-memory {
    cpurad_data: memory@1f000000 { ... }
    cpuapp_data: memory@2f000000 { ... }
}

// After: Alphabetical order
reserved-memory {
    cpuapp_data: memory@2f000000 { ... }
    cpurad_data: memory@1f000000 { ... }
}
```

### Property Sorting
```dts
// Before: Random order
gpio6: gpio@938c00 {
    status = "disabled";
    compatible = "nordic,nrf-gpio";
    reg = < 0x938c00 0x200 >;
}

// After: Alphabetical order
gpio6: gpio@938c00 {
    compatible = "nordic,nrf-gpio";
    reg = < 0x938c00 0x200 >;
    status = "disabled";
}
```

### Value Normalization
```dts
// Hex normalization: 0x938C00 → 0x938c00
// Array normalization: <0x1 0x2> → < 0x1 0x2 >
```

## Requirements

- VS Code 1.74.0 or higher
- Device Tree Source files (`.dts`, `.dtsi`)

## Known Issues

None at this time.

## Release Notes

### 1.0.0
- **Complete semantic DTS normalization**
- **Recursive node and property sorting**
- **Advanced configuration options** 
- **Copy formatted file functionality**
- **Improved comparison accuracy**
- **Hex and array value normalization**

### 0.0.1
- Initial release with basic comparison functionality