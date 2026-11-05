#!/usr/bin/env node
// fx-disk/cli/build-bundle.ts
/**
 * FX Bundle Builder CLI
 *
 * Build optimized VFS bundles containing plugins and modules
 *
 * Usage:
 *   node build-bundle.ts --config bundle.config.json
 *   node build-bundle.ts --plugins "./plugins/*.ts" --output ./dist/bundle.bin
 */

import { BundleBuilder } from '../fx-bundle-builder.js';
import { logger, LogLevel } from '../fx-disk-logger.js';

interface CLIConfig {
    plugins?: string[];
    modules?: string[];
    assets?: string[];
    manifest?: string;
    output?: string;
    format?: 'binary' | 'base64' | 'json';
    compress?: boolean;
    verbose?: boolean;
    name?: string;
    version?: string;
}

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): CLIConfig {
    const config: CLIConfig = {
        plugins: [],
        modules: [],
        assets: [],
        format: 'binary',
        compress: true,
        verbose: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];

        switch (arg) {
            case '--config':
                // Load from JSON config file
                if (next) {
                    const configContent = readFile(next);
                    const jsonConfig = JSON.parse(configContent);
                    Object.assign(config, jsonConfig);
                    i++;
                }
                break;

            case '--plugins':
            case '-p':
                if (next) {
                    config.plugins!.push(...next.split(',').map(s => s.trim()));
                    i++;
                }
                break;

            case '--modules':
            case '-m':
                if (next) {
                    config.modules!.push(...next.split(',').map(s => s.trim()));
                    i++;
                }
                break;

            case '--assets':
            case '-a':
                if (next) {
                    config.assets!.push(...next.split(',').map(s => s.trim()));
                    i++;
                }
                break;

            case '--manifest':
                if (next) {
                    config.manifest = next;
                    i++;
                }
                break;

            case '--output':
            case '-o':
                if (next) {
                    config.output = next;
                    i++;
                }
                break;

            case '--format':
            case '-f':
                if (next) {
                    config.format = next as any;
                    i++;
                }
                break;

            case '--no-compress':
                config.compress = false;
                break;

            case '--verbose':
            case '-v':
                config.verbose = true;
                break;

            case '--name':
                if (next) {
                    config.name = next;
                    i++;
                }
                break;

            case '--version':
                if (next) {
                    config.version = next;
                    i++;
                }
                break;

            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
        }
    }

    return config;
}

/**
 * Print help message
 */
function printHelp() {
    console.log(`
FX Bundle Builder CLI

Usage:
  node build-bundle.ts [options]

Options:
  --config <file>          Load configuration from JSON file
  --plugins, -p <files>    Plugin files to include (comma-separated or glob)
  --modules, -m <files>    Module files to include (comma-separated or glob)
  --assets, -a <files>     Asset files to include (comma-separated or glob)
  --manifest <file>        .fxrc.json manifest file
  --output, -o <file>      Output bundle file path
  --format, -f <format>    Output format: binary (default), base64, json
  --no-compress            Disable compression
  --verbose, -v            Verbose logging
  --name <name>            Bundle name
  --version <version>      Bundle version
  --help, -h               Show this help message

Examples:
  # Build from config file
  node build-bundle.ts --config bundle.config.json

  # Build with specific plugins
  node build-bundle.ts -p "./plugins/fx-dom-dollar.ts,./plugins/fx-orm.ts" -o ./dist/bundle.bin

  # Build all plugins from directory
  node build-bundle.ts -p "./plugins/*.ts" -o ./dist/bundle.bin --verbose

Config file format (bundle.config.json):
  {
    "name": "my-app",
    "version": "1.0.0",
    "plugins": ["./plugins/fx-dom-dollar.ts"],
    "modules": ["./lib/utils.ts"],
    "manifest": "./.fxrc.json",
    "output": "./dist/bundle.bin",
    "format": "binary",
    "compress": true
  }
`);
}

/**
 * Expand glob patterns
 */
async function expandGlobs(patterns: string[]): Promise<string[]> {
    const files: string[] = [];

    for (const pattern of patterns) {
        if (pattern.includes('*')) {
            // Simple glob expansion
            const baseDir = pattern.substring(0, pattern.lastIndexOf('/'));
            const filePattern = pattern.substring(pattern.lastIndexOf('/') + 1);
            const regex = new RegExp('^' + filePattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');

            const dirFiles = await listDirectory(baseDir);
            for (const file of dirFiles) {
                if (regex.test(file)) {
                    files.push(`${baseDir}/${file}`);
                }
            }
        } else {
            files.push(pattern);
        }
    }

    return files;
}

/**
 * Build bundle from config
 */
async function buildBundle(config: CLIConfig): Promise<void> {
    if (config.verbose) {
        logger.setLevel(LogLevel.DEBUG);
    }

    console.log('🚀 FX Bundle Builder');
    console.log('==================\n');

    // Create builder
    const builder = new BundleBuilder({
        compress: config.compress,
        format: config.format,
        metadata: {
            name: config.name,
            version: config.version
        }
    });

    // Add plugins
    if (config.plugins && config.plugins.length > 0) {
        console.log('📦 Adding plugins...');
        const pluginFiles = await expandGlobs(config.plugins);
        for (const file of pluginFiles) {
            try {
                builder.addPlugin(file);
                console.log(`  ✓ ${file}`);
            } catch (error) {
                console.error(`  ✗ ${file}: ${error}`);
            }
        }
    }

    // Add modules
    if (config.modules && config.modules.length > 0) {
        console.log('\n📦 Adding modules...');
        const moduleFiles = await expandGlobs(config.modules);
        for (const file of moduleFiles) {
            try {
                builder.addModule(file);
                console.log(`  ✓ ${file}`);
            } catch (error) {
                console.error(`  ✗ ${file}: ${error}`);
            }
        }
    }

    // Add assets
    if (config.assets && config.assets.length > 0) {
        console.log('\n📦 Adding assets...');
        const assetFiles = await expandGlobs(config.assets);
        for (const file of assetFiles) {
            try {
                builder.addAsset(file);
                console.log(`  ✓ ${file}`);
            } catch (error) {
                console.error(`  ✗ ${file}: ${error}`);
            }
        }
    }

    // Add manifest
    if (config.manifest) {
        console.log(`\n📄 Adding manifest: ${config.manifest}`);
        try {
            const manifestContent = readFile(config.manifest);
            const manifestJson = JSON.parse(manifestContent);
            builder.addManifest(manifestJson);
            console.log('  ✓ Manifest added');
        } catch (error) {
            console.error(`  ✗ Failed to add manifest: ${error}`);
        }
    }

    // Build
    console.log('\n🔨 Building bundle...');
    const bundle = await builder.build();

    // Get stats
    const stats = builder.getStats();
    console.log('\n📊 Bundle Statistics:');
    console.log(`  Files:          ${stats.filesCount}`);
    console.log(`  Chunks:         ${stats.chunks}`);
    console.log(`  Deduplicated:   ${stats.dedups}`);
    console.log(`  Original size:  ${(stats.totalSize / 1024).toFixed(2)} KB`);
    console.log(`  Compressed:     ${(stats.compressedSize / 1024).toFixed(2)} KB`);
    console.log(`  Ratio:          ${(stats.ratio * 100).toFixed(1)}%`);

    // Write output
    if (config.output) {
        console.log(`\n💾 Writing bundle to: ${config.output}`);
        await builder.writeBundle(config.output, bundle);
        console.log('  ✓ Bundle written successfully!');
    } else {
        console.log('\n⚠️  No output file specified. Use --output to save bundle.');
    }

    console.log('\n✨ Done!\n');
}

// Helper functions for Node.js/Deno
function readFile(path: string): string {
    if (typeof process !== 'undefined' && (process as any).versions?.node) {
        const fs = require('fs');
        return fs.readFileSync(path, 'utf-8');
    } else if (typeof (globalThis as any).Deno !== 'undefined') {
        return (globalThis as any).Deno.readTextFileSync(path);
    }
    throw new Error('File reading not supported');
}

async function listDirectory(dir: string): Promise<string[]> {
    if (typeof process !== 'undefined' && (process as any).versions?.node) {
        const fs = require('fs');
        return fs.readdirSync(dir);
    } else if (typeof (globalThis as any).Deno !== 'undefined') {
        const entries = [];
        for await (const entry of (globalThis as any).Deno.readDir(dir)) {
            entries.push(entry.name);
        }
        return entries;
    }
    throw new Error('Directory listing not supported');
}

// Main
async function main() {
    try {
        const args = process.argv.slice(2);

        if (args.length === 0) {
            printHelp();
            process.exit(0);
        }

        const config = parseArgs(args);
        await buildBundle(config);

    } catch (error) {
        console.error('\n❌ Error:', error);
        process.exit(1);
    }
}

// Run if called directly
if (typeof require !== 'undefined' && require.main === module) {
    main();
}

export { buildBundle, parseArgs };
