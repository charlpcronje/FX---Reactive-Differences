#!/usr/bin/env -S deno run --allow-all

import { resolve } from "@std/path";
import { CommandParser } from "./cli/parser.ts";
import { CommandHandler } from "./cli/handlers.ts";
import { TUIViewer } from "./tui/viewer.ts";
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
        await handler.handleView(command);
        break;
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error("❌ Error:", error.message);
    } else {
      console.error("❌ An unknown error occurred:", error);
    }
    Deno.exit(1);
  } finally {
    handler.close();
  }
}

if (import.meta.main) {
  main();
}

export { main };
