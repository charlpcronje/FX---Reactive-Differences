import { FileInfo, FileScanner, ScanOptions } from "./scanner.ts";
import { ProjectFolder } from "../db/index.ts";
import { join } from "@std/path";

export interface FileComparison {
  relativePath: string;
  masterFile?: FileInfo;
  compareFiles: Map<string, FileInfo | undefined>;
  isDifferent: boolean;
  status: 'identical' | 'modified' | 'missing' | 'extra';
}

export interface FolderComparison {
  masterFolder: ProjectFolder;
  compareFolders: ProjectFolder[];
  files: FileComparison[];
  summary: {
    totalFiles: number;
    identicalFiles: number;
    modifiedFiles: number;
    missingFiles: number;
    extraFiles: number;
  };
}

export class FolderComparator {
  private scanner: FileScanner;

  constructor() {
    this.scanner = new FileScanner();
  }

  async compareFolders(
    masterFolder: ProjectFolder,
    compareFolders: ProjectFolder[],
    options: ScanOptions
  ): Promise<FolderComparison> {
    // Scan all folders
    const masterFiles = await this.scanner.scanFolder(
      this.denormalizePath(masterFolder.folder_path),
      options
    );

    const compareResults = await Promise.all(
      compareFolders.map(async (folder) => ({
        folder,
        files: await this.scanner.scanFolder(
          this.denormalizePath(folder.folder_path),
          options
        )
      }))
    );

    // Build file comparison map
    const fileMap = new Map<string, FileComparison>();

    // Add master files
    for (const masterFile of masterFiles) {
      fileMap.set(masterFile.relativePath, {
        relativePath: masterFile.relativePath,
        masterFile,
        compareFiles: new Map(),
        isDifferent: false,
        status: 'identical'
      });
    }

    // Add compare files
    for (const { folder, files } of compareResults) {
      for (const file of files) {
        const existing = fileMap.get(file.relativePath);
        if (existing) {
          existing.compareFiles.set(folder.folder_path, file);
        } else {
          // Extra file not in master
          const comparison: FileComparison = {
            relativePath: file.relativePath,
            compareFiles: new Map([[folder.folder_path, file]]),
            isDifferent: true,
            status: 'extra'
          };
          fileMap.set(file.relativePath, comparison);
        }
      }

      // Mark missing files
      for (const masterFile of masterFiles) {
        const comparison = fileMap.get(masterFile.relativePath)!;
        if (!comparison.compareFiles.has(folder.folder_path)) {
          comparison.compareFiles.set(folder.folder_path, undefined);
          comparison.isDifferent = true;
          if (comparison.status === 'identical') {
            comparison.status = 'missing';
          }
        }
      }
    }

    // Compute hashes and determine differences
    const files: FileComparison[] = [];
    let identicalCount = 0;
    let modifiedCount = 0;
    let missingCount = 0;
    let extraCount = 0;

    for (const comparison of fileMap.values()) {
      if (comparison.masterFile) {
        // Compare hashes
        let allIdentical = true;
        const masterHash = await this.scanner.computeHash(comparison.masterFile.path);

        for (const [folderPath, compareFile] of comparison.compareFiles) {
          if (!compareFile) {
            allIdentical = false;
            comparison.isDifferent = true;
            comparison.status = 'missing';
            missingCount++;
            break;
          }

          const compareHash = await this.scanner.computeHash(compareFile.path);
          if (masterHash !== compareHash) {
            allIdentical = false;
            comparison.isDifferent = true;
            comparison.status = 'modified';
          }
        }

        if (allIdentical && comparison.status !== 'missing') {
          comparison.status = 'identical';
          identicalCount++;
        } else if (comparison.status === 'modified') {
          modifiedCount++;
        }
      } else {
        extraCount++;
      }

      files.push(comparison);
    }

    return {
      masterFolder,
      compareFolders,
      files: files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
      summary: {
        totalFiles: files.length,
        identicalFiles: identicalCount,
        modifiedFiles: modifiedCount,
        missingFiles: missingCount,
        extraFiles: extraCount
      }
    };
  }

  private denormalizePath(path: string): string {
    // Convert stored path format back to OS path
    if (Deno.build.os === 'windows') {
      return path.replace(/--/, ':').replace(/\//g, '\\');
    }
    return path;
  }
}
