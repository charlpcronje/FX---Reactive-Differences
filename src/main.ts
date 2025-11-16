#!/usr/bin/env -S deno run --allow-all

import { resolve } from "@std/path";
import { CommandParser, ParsedCommand } from "./cli/parser.ts";
import { CommandHandler } from "./cli/handlers.ts";
import { TUIViewer } from "./tui/viewer.ts";
import { FolderComparator } from "./core/comparator.ts";
import { ProjectRepository, RuleRepository, Database } from "./db/index.ts";
import { startWebServer } from "./web/server.ts";

async function main() {
  const args = Deno.args;
  const parser = new CommandParser();
  const command = parser.parse(args);
  const handler = new CommandHandler();

  try {
    switch (command.action) {
      case 'help':
        const viewer = new TUIViewer();
        viewer.showHelp();
        break;

      case 'host':
        await startWebServer(command.port || 8000);
        break;

      case 'new':
        const currentPath = resolve(Deno.cwd());
        await handler.handleNew(currentPath);
        break;

      case 'add':
        await handler.handleAdd(command, resolve(Deno.cwd()));
        break;

      case 'remove':
        await handler.handleRemove(command, resolve(Deno.cwd()));
        break;

      case 'view':
        await handleView(command);
        break;
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    Deno.exit(1);
  } finally {
    handler.close();
  }
}

async function handleView(command: ParsedCommand) {
  if (!command.projectCode) {
    console.error("❌ Error: Project code is required");
    console.log("💡 Tip: Run 'fxdif' to create a new project or 'fxdif --help' for usage");
    return;
  }

  const db = new Database();
  const projectRepo = new ProjectRepository(db);
  const ruleRepo = new RuleRepository(db);

  const project = projectRepo.getProjectByCode(command.projectCode);
  if (!project) {
    console.error(`❌ Error: Project "${command.projectCode}" not found`);
    db.close();
    return;
  }

  const folders = projectRepo.getFolders(project.id!);
  if (folders.length === 0) {
    console.log(`ℹ️  No folders added to project "${command.projectCode}" yet`);
    console.log(`💡 Tip: Navigate to a folder and run: fxdif ${command.projectCode}+`);
    db.close();
    return;
  }

  // Get master folder
  const masterFolder = folders.find(f => f.is_master === 1);
  if (!masterFolder) {
    console.error("❌ Error: No master folder set for this project");
    db.close();
    return;
  }

  const compareFolders = folders.filter(f => f.is_master !== 1);

  if (compareFolders.length === 0) {
    console.log(`ℹ️  Only the master folder exists for project "${command.projectCode}"`);
    console.log(`💡 Tip: Navigate to other folders and run: fxdif ${command.projectCode}+`);
    db.close();
    return;
  }

  // Get rules
  const rules = ruleRepo.getRules(project.id!);
  const defaultExclusions = ruleRepo.getDefaultExclusions();

  // Build scan options
  const scanOptions = {
    excludeFolders: defaultExclusions,
    includeExtensions: command.extensions.include,
    excludeExtensions: command.extensions.exclude,
    includeFiles: command.files.include,
    excludeFiles: command.files.exclude,
    rules
  };

  // Perform comparison
  console.log("🔍 Scanning and comparing folders...\n");
  const comparator = new FolderComparator();
  const comparison = await comparator.compareFolders(
    masterFolder,
    compareFolders,
    scanOptions
  );

  // Display results
  const viewer = new TUIViewer();
  viewer.renderComparison(comparison, { showOnlyDifferences: false });

  db.close();
}

if (import.meta.main) {
  main();
}

export { main };
