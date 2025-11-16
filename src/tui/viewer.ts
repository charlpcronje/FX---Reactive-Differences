import { Table } from "@cliffy/table";
import { colors } from "@cliffy/ansi/colors";
import { FolderComparison, FileComparison } from "../core/comparator.ts";
import { Database } from "../db/index.ts";

export interface ViewOptions {
  showOnlyDifferences?: boolean;
  maxWidth?: number;
}

export class TUIViewer {
  private currentIndex = 0;
  private differenceIndices: number[] = [];

  renderComparison(comparison: FolderComparison, options: ViewOptions = {}): void {
    console.clear();
    this.printHeader(comparison);
    this.printSummary(comparison);

    // Filter files if needed
    let files = comparison.files;
    if (options.showOnlyDifferences) {
      files = files.filter(f => f.isDifferent);
    }

    // Store indices of different files for navigation
    this.differenceIndices = [];
    comparison.files.forEach((file, index) => {
      if (file.isDifferent) {
        this.differenceIndices.push(index);
      }
    });

    if (files.length === 0) {
      console.log(colors.green("\n✨ All files are identical!\n"));
      return;
    }

    this.printFileTable(comparison, files, options);
    this.printFooter();
  }

  private printHeader(comparison: FolderComparison): void {
    console.log(colors.bold.cyan("\n╔═══════════════════════════════════════════════╗"));
    console.log(colors.bold.cyan("║        FXDif - Folder Comparison View        ║"));
    console.log(colors.bold.cyan("╚═══════════════════════════════════════════════╝\n"));

    // Show folder names
    const masterPath = Database.denormalizePath(comparison.masterFolder.folder_path);
    console.log(colors.bold("Master Folder: ") + colors.yellow(masterPath));

    comparison.compareFolders.forEach((folder, index) => {
      const path = Database.denormalizePath(folder.folder_path);
      console.log(colors.bold(`Compare ${index + 1}:    `) + colors.blue(path));
    });

    console.log();
  }

  private printSummary(comparison: FolderComparison): void {
    const s = comparison.summary;

    console.log(colors.bold("📊 Summary:"));
    console.log(`   Total files:     ${s.totalFiles}`);
    console.log(colors.green(`   Identical:       ${s.identicalFiles}`));
    console.log(colors.yellow(`   Modified:        ${s.modifiedFiles}`));
    console.log(colors.red(`   Missing:         ${s.missingFiles}`));
    console.log(colors.magenta(`   Extra:           ${s.extraFiles}`));
    console.log();
  }

  private printFileTable(
    comparison: FolderComparison,
    files: FileComparison[],
    options: ViewOptions
  ): void {
    const headers = [
      "Status",
      "File Path",
      "Master",
      ...comparison.compareFolders.map((_, i) => `Compare ${i + 1}`)
    ];

    const rows: string[][] = [];

    for (const file of files) {
      const statusIcon = this.getStatusIcon(file.status);
      const row: string[] = [
        statusIcon,
        this.truncatePath(file.relativePath, 50)
      ];

      // Master column
      if (file.masterFile) {
        row.push(colors.green("✓"));
      } else {
        row.push(colors.red("✗"));
      }

      // Compare columns
      for (const folder of comparison.compareFolders) {
        const compareFile = file.compareFiles.get(folder.folder_path);
        if (compareFile === undefined) {
          row.push(colors.red("✗"));
        } else if (file.status === 'modified') {
          row.push(colors.yellow("≠"));
        } else {
          row.push(colors.green("✓"));
        }
      }

      rows.push(row);
    }

    const table = new Table()
      .header(headers)
      .body(rows)
      .border(true);

    table.render();
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'identical':
        return colors.green("✓ OK");
      case 'modified':
        return colors.yellow("≠ MOD");
      case 'missing':
        return colors.red("✗ MISS");
      case 'extra':
        return colors.magenta("+ EXTRA");
      default:
        return "?";
    }
  }

  private truncatePath(path: string, maxLen: number): string {
    if (path.length <= maxLen) return path;
    return "..." + path.slice(-(maxLen - 3));
  }

  private printFooter(): void {
    console.log(colors.dim("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(colors.bold("Keyboard Shortcuts:"));
    console.log("  Alt+↓      Next different file");
    console.log("  Alt+↑      Previous different file");
    console.log("  Enter      View file details");
    console.log("  D          Toggle show only differences");
    console.log("  Q          Quit");
    console.log("  ?          Help");
    console.log(colors.dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
  }

  showHelp(): void {
    console.clear();
    console.log(colors.bold.cyan("\n╔═══════════════════════════════════════════════╗"));
    console.log(colors.bold.cyan("║              FXDif - Help                    ║"));
    console.log(colors.bold.cyan("╚═══════════════════════════════════════════════╝\n"));

    console.log(colors.bold("📖 Usage:\n"));

    console.log(colors.bold("Create new project:"));
    console.log("  fxdif\n");

    console.log(colors.bold("Add folder to project:"));
    console.log("  fxdif PROJECT_CODE+\n");

    console.log(colors.bold("Remove folder from project:"));
    console.log("  fxdif PROJECT_CODE-\n");

    console.log(colors.bold("View project comparison:"));
    console.log("  fxdif PROJECT_CODE\n");

    console.log(colors.bold("Add file extension rules:"));
    console.log("  fxdif PROJECT_CODE .php+ .js+ .ts+  (include only)");
    console.log("  fxdif PROJECT_CODE .test.js-        (exclude)\n");

    console.log(colors.bold("Add specific file rules:"));
    console.log("  fxdif PROJECT_CODE config.php-      (exclude file)");
    console.log("  fxdif PROJECT_CODE important.js+    (include file)\n");

    console.log(colors.bold("Start web server:"));
    console.log("  fxdif --host\n");

    console.log(colors.bold("Show this help:"));
    console.log("  fxdif --help\n");

    console.log(colors.dim("Press any key to continue..."));
  }
}
