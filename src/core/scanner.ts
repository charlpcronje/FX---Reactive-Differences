import { walk } from "@std/fs";
import { join, relative, sep } from "@std/path";
import { FileRule } from "../db/index.ts";

export interface FileInfo {
  path: string;
  relativePath: string;
  size: number;
  modified: Date;
  hash?: string;
  isDirectory: boolean;
}

export interface ScanOptions {
  excludeFolders: string[];
  includeExtensions?: string[];
  excludeExtensions?: string[];
  includeFiles?: string[];
  excludeFiles?: string[];
  rules?: FileRule[];
}

export class FileScanner {
  private textExtensions = new Set([
    '.txt', '.md', '.js', '.ts', '.jsx', '.tsx', '.json', '.html', '.css',
    '.scss', '.sass', '.less', '.php', '.py', '.rb', '.java', '.c', '.cpp',
    '.h', '.cs', '.go', '.rs', '.swift', '.kt', '.scala', '.sh', '.bash',
    '.zsh', '.fish', '.sql', '.xml', '.yaml', '.yml', '.toml', '.ini',
    '.conf', '.config', '.env', '.gitignore', '.dockerfile', '.vue',
    '.svelte', '.astro', '.r', '.jl', '.lua', '.perl', '.pl'
  ]);

  async scanFolder(folderPath: string, options: ScanOptions): Promise<FileInfo[]> {
    const files: FileInfo[] = [];

    try {
      for await (const entry of walk(folderPath, {
        includeDirs: false,
        skip: options.excludeFolders.map(f => new RegExp(`(^|${sep})${f}($|${sep})`))
      })) {
        const relativePath = relative(folderPath, entry.path);

        // Apply file rules
        if (!this.shouldIncludeFile(relativePath, entry.path, options)) {
          continue;
        }

        const stat = await Deno.stat(entry.path);

        files.push({
          path: entry.path,
          relativePath,
          size: stat.size,
          modified: stat.mtime || new Date(),
          isDirectory: stat.isDirectory
        });
      }
    } catch (error) {
      console.error(`Error scanning ${folderPath}:`, error);
    }

    return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  private shouldIncludeFile(relativePath: string, fullPath: string, options: ScanOptions): boolean {
    const fileName = relativePath.split(sep).pop() || '';
    const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';

    // Check if it's a text file (default: only text files)
    if (!this.textExtensions.has(ext.toLowerCase()) && !options.includeExtensions?.length) {
      return false;
    }

    // Apply specific file exclusions first
    if (options.excludeFiles?.some(f => fileName === f || relativePath === f)) {
      // But check if explicitly included
      if (!options.includeFiles?.some(f => fileName === f || relativePath === f)) {
        return false;
      }
    }

    // Apply specific file inclusions
    if (options.includeFiles?.some(f => fileName === f || relativePath === f)) {
      return true;
    }

    // Apply extension rules
    if (options.includeExtensions?.length) {
      if (!options.includeExtensions.includes(ext)) {
        return false;
      }
    }

    if (options.excludeExtensions?.includes(ext)) {
      return false;
    }

    // Apply database rules if provided
    if (options.rules) {
      for (const rule of options.rules) {
        if (rule.rule_type === 'extension' && ext === rule.pattern) {
          return rule.action === 'include';
        }
        if (rule.rule_type === 'file' && (fileName === rule.pattern || relativePath === rule.pattern)) {
          return rule.action === 'include';
        }
      }
    }

    return true;
  }

  async computeHash(filePath: string): Promise<string> {
    try {
      const data = await Deno.readFile(filePath);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return '';
    }
  }

  async compareFiles(file1: string, file2: string): Promise<boolean> {
    try {
      const [hash1, hash2] = await Promise.all([
        this.computeHash(file1),
        this.computeHash(file2)
      ]);
      return hash1 === hash2;
    } catch {
      return false;
    }
  }
}
