#!/usr/bin/env node

/**
 * Unused Code Detection Script for Zephyr IDE Extension
 * 
 * This script analyzes the TypeScript codebase to identify:
 * 1. Unused files (files that are never imported)
 * 2. Unused exports (functions, classes, variables exported but never imported)
 * 3. Dead code within files
 */

const fs = require('fs');
const path = require('path');

class UnusedCodeDetector {
    constructor(srcDir) {
        this.srcDir = srcDir;
        this.files = [];
        this.imports = new Map(); // file -> [imported items]
        this.exports = new Map(); // file -> [exported items]
        this.fileImports = new Map(); // file -> [imported files]
        this.fileExports = new Map(); // file -> [exported items with details]
        this.usedFiles = new Set();
        this.usedExports = new Map(); // file -> Set of used exports
    }

    async analyze() {
        console.log('🔍 Starting unused code detection...\n');
        
        // Step 1: Discover all TypeScript files
        this.discoverFiles();
        console.log(`📁 Found ${this.files.length} TypeScript files`);
        
        // Step 2: Parse imports and exports
        this.parseFiles();
        console.log('📋 Parsed imports and exports');
        
        // Step 3: Build usage maps
        this.buildUsageMaps();
        console.log('🗺️  Built usage maps');
        
        // Step 4: Generate report
        this.generateReport();
    }

    discoverFiles() {
        const walkDir = (dir) => {
            const items = fs.readdirSync(dir, { withFileTypes: true });
            
            for (const item of items) {
                const fullPath = path.join(dir, item.name);
                
                if (item.isDirectory()) {
                    walkDir(fullPath);
                } else if (item.isFile() && item.name.endsWith('.ts') && !item.name.endsWith('.d.ts')) {
                    this.files.push(fullPath);
                }
            }
        };
        
        walkDir(this.srcDir);
    }

    parseFiles() {
        for (const filePath of this.files) {
            this.parseFile(filePath);
        }
    }

    parseFile(filePath) {
        const content = fs.readFileSync(filePath, 'utf8');
        const relativePath = path.relative(this.srcDir, filePath);
        
        // Parse imports
        const importRegex = /import\s+(?:{[^}]*}|\*\s+as\s+\w+|\w+)?\s*from\s+['"`]([^'"`]+)['"`]/g;
        const imports = [];
        let match;
        
        while ((match = importRegex.exec(content)) !== null) {
            const importPath = match[1];
            if (importPath.startsWith('.')) {
                // Resolve relative import
                const resolvedPath = this.resolveImport(filePath, importPath);
                if (resolvedPath) {
                    imports.push(resolvedPath);
                }
            }
        }
        
        this.fileImports.set(relativePath, imports);
        
        // Parse exports
        const exports = this.parseExports(content);
        this.fileExports.set(relativePath, exports);
        
        // Parse named imports for usage tracking
        const namedImportRegex = /import\s+{([^}]+)}\s*from\s+['"`]([^'"`]+)['"`]/g;
        const importedItems = [];
        
        while ((match = namedImportRegex.exec(content)) !== null) {
            const items = match[1].split(',').map(item => item.trim().split(' as ')[0].trim());
            const importPath = match[2];
            
            if (importPath.startsWith('.')) {
                const resolvedPath = this.resolveImport(filePath, importPath);
                if (resolvedPath) {
                    importedItems.push({ file: resolvedPath, items });
                }
            }
        }
        
        this.imports.set(relativePath, importedItems);
    }

    resolveImport(fromFile, importPath) {
        const fromDir = path.dirname(fromFile);
        let resolved = path.resolve(fromDir, importPath);
        
        // Try different extensions
        const extensions = ['.ts', '.js', '/index.ts', '/index.js'];
        
        for (const ext of extensions) {
            const candidate = resolved + ext;
            if (fs.existsSync(candidate)) {
                return path.relative(this.srcDir, candidate);
            }
        }
        
        // Check if it's a directory with index file
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
            const indexPath = path.join(resolved, 'index.ts');
            if (fs.existsSync(indexPath)) {
                return path.relative(this.srcDir, indexPath);
            }
        }
        
        return null;
    }

    parseExports(content) {
        const exports = [];
        
        // Export function/class/const declarations
        const exportRegex = /export\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
        let match;
        
        while ((match = exportRegex.exec(content)) !== null) {
            exports.push({
                name: match[1],
                type: 'declaration',
                line: this.getLineNumber(content, match.index)
            });
        }
        
        // Named exports
        const namedExportRegex = /export\s+{\s*([^}]+)\s*}/g;
        while ((match = namedExportRegex.exec(content)) !== null) {
            const items = match[1].split(',').map(item => {
                const parts = item.trim().split(' as ');
                return parts[parts.length - 1].trim();
            });
            
            for (const item of items) {
                exports.push({
                    name: item,
                    type: 'named',
                    line: this.getLineNumber(content, match.index)
                });
            }
        }
        
        // Default exports
        const defaultExportRegex = /export\s+default\s+/g;
        while ((match = defaultExportRegex.exec(content)) !== null) {
            exports.push({
                name: 'default',
                type: 'default',
                line: this.getLineNumber(content, match.index)
            });
        }
        
        return exports;
    }

    getLineNumber(content, index) {
        return content.substring(0, index).split('\n').length;
    }

    buildUsageMaps() {
        // Mark files as used if they are imported
        for (const [file, imports] of this.fileImports) {
            for (const importedFile of imports) {
                this.usedFiles.add(importedFile);
            }
        }
        
        // Mark exports as used if they are imported
        for (const [file, importedItems] of this.imports) {
            for (const { file: importedFile, items } of importedItems) {
                if (!this.usedExports.has(importedFile)) {
                    this.usedExports.set(importedFile, new Set());
                }
                
                for (const item of items) {
                    this.usedExports.get(importedFile).add(item);
                }
            }
        }
        
        // Always mark extension.ts as used (entry point)
        this.usedFiles.add('extension.ts');
        
        // Mark test files as used (they are entry points for testing)
        for (const file of this.files) {
            const relativePath = path.relative(this.srcDir, file);
            if (relativePath.includes('test') || relativePath.endsWith('.test.ts')) {
                this.usedFiles.add(relativePath);
            }
        }
        
        // Mark VS Code extension lifecycle functions as used
        if (this.usedExports.has('extension.ts')) {
            this.usedExports.get('extension.ts').add('activate');
            this.usedExports.get('extension.ts').add('deactivate');
        } else {
            this.usedExports.set('extension.ts', new Set(['activate', 'deactivate']));
        }
        
        // Check for commands defined in package.json that might use exports
        this.markPackageJsonCommandUsage();
    }
    
    markPackageJsonCommandUsage() {
        try {
            const packageJsonPath = path.join(this.srcDir, '..', 'package.json');
            if (fs.existsSync(packageJsonPath)) {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                
                // Mark functions that might be used by VS Code commands
                // These are often referenced dynamically through command strings
                if (packageJson.contributes && packageJson.contributes.commands) {
                    for (const command of packageJson.contributes.commands) {
                        const commandName = command.command;
                        if (commandName && commandName.startsWith('zephyr-ide.')) {
                            // This is a heuristic - functions might be named similar to commands
                            const functionName = commandName.replace('zephyr-ide.', '').replace(/-/g, '');
                            
                            // Mark potential function names as used across all files
                            for (const [file, exports] of this.fileExports) {
                                for (const exp of exports) {
                                    if (exp.name.toLowerCase().includes(functionName.toLowerCase()) ||
                                        functionName.toLowerCase().includes(exp.name.toLowerCase())) {
                                        if (!this.usedExports.has(file)) {
                                            this.usedExports.set(file, new Set());
                                        }
                                        this.usedExports.get(file).add(exp.name);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (error) {
            // Silently ignore package.json parsing errors
        }
    }

    generateReport() {
        console.log('\n📊 UNUSED CODE DETECTION REPORT');
        console.log('=' .repeat(50));
        
        // Unused files
        const unusedFiles = this.files
            .map(f => path.relative(this.srcDir, f))
            .filter(f => !this.usedFiles.has(f))
            .filter(f => !f.includes('test')); // Exclude test files from unused files report
        
        console.log('\n🗂️  POTENTIALLY UNUSED FILES:');
        if (unusedFiles.length === 0) {
            console.log('   ✅ No unused files detected!');
        } else {
            for (const file of unusedFiles) {
                console.log(`   📄 ${file}`);
            }
        }
        
        // Unused exports
        console.log('\n📤 POTENTIALLY UNUSED EXPORTS:');
        let hasUnusedExports = false;
        
        for (const [file, exports] of this.fileExports) {
            if (unusedFiles.includes(file)) continue; // Skip files that are entirely unused
            
            const usedExportsInFile = this.usedExports.get(file) || new Set();
            const unusedExports = exports.filter(exp => 
                exp.name !== 'default' && // Keep default exports in report but they're special
                !usedExportsInFile.has(exp.name)
            );
            
            if (unusedExports.length > 0) {
                hasUnusedExports = true;
                console.log(`\n   📁 ${file}:`);
                for (const exp of unusedExports) {
                    console.log(`      🔸 ${exp.name} (${exp.type}, line ${exp.line})`);
                }
            }
        }
        
        if (!hasUnusedExports) {
            console.log('   ✅ No unused exports detected!');
        }
        
        // Summary
        console.log('\n📈 SUMMARY:');
        console.log(`   📁 Total files analyzed: ${this.files.length}`);
        console.log(`   🗂️  Potentially unused files: ${unusedFiles.length}`);
        
        const totalUnusedExports = Array.from(this.fileExports.values())
            .reduce((total, exports) => {
                const file = Array.from(this.fileExports.keys())[Array.from(this.fileExports.values()).indexOf(exports)];
                if (unusedFiles.includes(file)) return total;
                
                const usedExportsInFile = this.usedExports.get(file) || new Set();
                const unusedCount = exports.filter(exp => 
                    exp.name !== 'default' && !usedExportsInFile.has(exp.name)
                ).length;
                return total + unusedCount;
            }, 0);
        
        console.log(`   📤 Potentially unused exports: ${totalUnusedExports}`);
        
        if (unusedFiles.length === 0 && totalUnusedExports === 0) {
            console.log('\n🎉 Great! No obviously unused code detected.');
        } else {
            console.log('\n⚠️  Note: This analysis is static and may show false positives.');
            console.log('   Please review each item carefully before removing code.');
            console.log('   Dynamic imports, reflection, and external references are not detected.');
        }
        
        console.log('\n' + '=' .repeat(50));
    }
}

// Main execution
async function main() {
    const srcDir = path.join(__dirname, '..', 'src');
    
    if (!fs.existsSync(srcDir)) {
        console.error('❌ Source directory not found:', srcDir);
        process.exit(1);
    }
    
    const detector = new UnusedCodeDetector(srcDir);
    await detector.analyze();
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { UnusedCodeDetector };