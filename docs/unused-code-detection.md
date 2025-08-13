# Unused Code Detection

This project includes a static analysis tool to detect potentially unused code and dead files. This helps maintain a clean codebase by identifying exports and files that may no longer be needed.

## Features

The unused code detector analyzes:
- **Unused Files**: TypeScript files that are never imported by other files
- **Unused Exports**: Functions, classes, variables, and types that are exported but never imported
- **VS Code Integration**: Smart detection of VS Code extension patterns like `activate`/`deactivate` functions

## Usage

### Command Line

Run the detection script from the command line:

```bash
npm run detect-unused
```

### VS Code Command

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Search for "Zephyr IDE: Detect Unused Code"
3. Run the command
4. View results in the Output panel (select "Zephyr IDE" from the dropdown)

## Understanding the Results

### Report Sections

**🗂️ Potentially Unused Files**
- Lists TypeScript files that are never imported
- Excludes test files and the main extension entry point
- These files might be safe to remove, but review carefully

**📤 Potentially Unused Exports**
- Lists exported functions, classes, variables that are never imported
- Shows the file, export name, type, and line number
- Includes smart filtering for VS Code extension patterns

**📈 Summary**
- Total files analyzed
- Count of potentially unused files and exports

### Important Notes

⚠️ **This analysis is static and may show false positives**

The tool cannot detect:
- Dynamic imports using `import()` statements
- Reflection-based usage
- External references from other packages
- Command handlers registered via strings in package.json
- Functions called via VS Code's command system

### Best Practices

1. **Review before removing**: Always manually verify that flagged code is truly unused
2. **Check git history**: Look at recent usage patterns before removing old code
3. **Consider API boundaries**: Some exports might be intended for external use
4. **Test thoroughly**: After removing code, run all tests and verify functionality

## Technical Details

The detection script:
1. Scans all `.ts` files in the `src` directory
2. Parses import/export statements using regex patterns
3. Builds a dependency graph
4. Identifies unused files and exports
5. Applies VS Code extension-specific filtering rules

### Limitations

- Does not use TypeScript compiler API for performance reasons
- Regex-based parsing may miss complex import/export patterns
- Cannot detect runtime-only dependencies
- May not catch all dynamic usage patterns

## Example Output

```
📊 UNUSED CODE DETECTION REPORT
==================================================

🗂️  POTENTIALLY UNUSED FILES:
   ✅ No unused files detected!

📤 POTENTIALLY UNUSED EXPORTS:

   📁 utilities/utils.ts:
      🔸 unusedHelper (declaration, line 42)
      🔸 oldFunction (declaration, line 156)

📈 SUMMARY:
   📁 Total files analyzed: 36
   🗂️  Potentially unused files: 0
   📤 Potentially unused exports: 2
```

This report suggests reviewing `unusedHelper` and `oldFunction` in the utils file to determine if they can be safely removed.