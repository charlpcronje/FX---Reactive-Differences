var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var stdin_exports = {};
__export(stdin_exports, {
  default: () => fxDevToolsPlugin
});
module.exports = __toCommonJS(stdin_exports);
class FXDevToolsPlugin {
  name = "fx-devtools";
  version = "1.0.0";
  description = "Quake-style developer console with remote control";
  fx;
  options;
  console = null;
  input = null;
  output = null;
  isVisible = false;
  commandHistory = [];
  historyIndex = -1;
  commands = /* @__PURE__ */ new Map();
  webSocket = null;
  watchers = [];
  watcherInterval = null;
  constructor(fx, options = {}) {
    this.fx = fx;
    this.options = {
      global: "$dev",
      hotkey: "ctrl+`",
      theme: "dark",
      enableRemoteControl: true,
      enableElementWatching: true,
      enableAutomatedTesting: true,
      websocketUrl: "ws://localhost:4005",
      ...options
    };
    this.initializeConsole();
    this.setupCommands();
    this.setupKeyboardShortcuts();
    this.setupWebSocketRemoteControl();
    this.setupElementWatching();
    console.log("\u{1F3AE} FX DevTools initialized - Press Ctrl+` for console");
  }
  /**
   * Create Quake-style slide-down console
   */
  initializeConsole() {
    if (typeof document === "undefined") return;
    this.console = document.createElement("div");
    this.console.id = "fx-dev-console";
    this.console.style.cssText = `
      position: fixed;
      top: -400px;
      left: 0;
      width: 100%;
      height: 400px;
      background: ${this.options.theme === "matrix" ? "rgba(0, 20, 0, 0.95)" : "rgba(0, 0, 0, 0.95)"};
      color: ${this.options.theme === "matrix" ? "#00ff00" : "#00ff00"};
      font-family: 'Courier New', monospace;
      font-size: 14px;
      z-index: 999999;
      backdrop-filter: blur(10px);
      border-bottom: 2px solid #00ff00;
      transition: top 0.3s ease-out;
      display: flex;
      flex-direction: column;
    `;
    const header = document.createElement("div");
    header.style.cssText = `
      padding: 10px;
      background: rgba(0, 50, 0, 0.8);
      border-bottom: 1px solid #00ff00;
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;
    header.innerHTML = `
      <span>\u{1F3AE} FX Developer Console v${this.version} | ${this.options.theme.toUpperCase()} MODE</span>
      <span>Press Ctrl+\` to toggle | Type /help for commands</span>
    `;
    this.output = document.createElement("div");
    this.output.style.cssText = `
      flex: 1;
      padding: 10px;
      overflow-y: auto;
      white-space: pre-wrap;
      line-height: 1.4;
    `;
    const inputContainer = document.createElement("div");
    inputContainer.style.cssText = `
      padding: 10px;
      background: rgba(0, 30, 0, 0.8);
      border-top: 1px solid #00ff00;
      display: flex;
      align-items: center;
    `;
    const prompt = document.createElement("span");
    prompt.textContent = "FX> ";
    prompt.style.color = "#00ff00";
    prompt.style.marginRight = "5px";
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.style.cssText = `
      flex: 1;
      background: transparent;
      border: none;
      color: #00ff00;
      font-family: inherit;
      font-size: inherit;
      outline: none;
    `;
    this.input.placeholder = "Enter command (try /help)";
    inputContainer.appendChild(prompt);
    inputContainer.appendChild(this.input);
    this.console.appendChild(header);
    this.console.appendChild(this.output);
    this.console.appendChild(inputContainer);
    document.body.appendChild(this.console);
    this.input.addEventListener("keydown", (e) => this.handleKeyDown(e));
    this.log("\u{1F3AE} FX Developer Console Ready");
    this.log("\u26A1 Type /help to see available commands");
    this.log("\u{1F527} Remote control enabled via WebSocket");
    this.log("\u{1F4CA} Element watching active");
    this.log("");
  }
  /**
   * Setup keyboard shortcuts
   */
  setupKeyboardShortcuts() {
    if (typeof document === "undefined") return;
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        this.toggleConsole();
      }
      if (e.key === "Escape" && this.isVisible) {
        this.hideConsole();
      }
    });
  }
  /**
   * Toggle console visibility (Quake-style)
   */
  toggleConsole() {
    if (this.isVisible) {
      this.hideConsole();
    } else {
      this.showConsole();
    }
  }
  showConsole() {
    if (!this.console) return;
    this.isVisible = true;
    this.console.style.top = "0px";
    setTimeout(() => {
      if (this.input) {
        this.input.focus();
      }
    }, 300);
    this.log("\u{1F3AE} Console activated");
  }
  hideConsole() {
    if (!this.console) return;
    this.isVisible = false;
    this.console.style.top = "-400px";
    this.log("\u{1F3AE} Console hidden");
  }
  /**
   * Handle console input
   */
  handleKeyDown(e) {
    if (e.key === "Enter") {
      const command = e.target.value.trim();
      if (command) {
        this.executeCommand(command);
        this.commandHistory.push(command);
        this.historyIndex = this.commandHistory.length;
        e.target.value = "";
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (this.historyIndex > 0) {
        this.historyIndex--;
        e.target.value = this.commandHistory[this.historyIndex];
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (this.historyIndex < this.commandHistory.length - 1) {
        this.historyIndex++;
        e.target.value = this.commandHistory[this.historyIndex];
      } else {
        this.historyIndex = this.commandHistory.length;
        e.target.value = "";
      }
    }
  }
  /**
   * Execute console command
   */
  async executeCommand(commandLine) {
    this.log(`FX> ${commandLine}`, "input");
    if (!commandLine.startsWith("/")) {
      this.log("\u274C Commands must start with / (try /help)", "error");
      return;
    }
    const parts = commandLine.slice(1).split(" ");
    const commandName = parts[0];
    const params = this.parseCommandParams(parts.slice(1));
    const command = this.commands.get(commandName);
    if (!command) {
      this.log(`\u274C Unknown command: ${commandName} (try /help)`, "error");
      return;
    }
    try {
      const result = await command.handler(params);
      if (result !== void 0) {
        this.log(`\u2705 ${JSON.stringify(result, null, 2)}`, "success");
      }
    } catch (error) {
      this.log(`\u274C Command failed: ${error.message}`, "error");
    }
  }
  /**
   * Parse command parameters (param:value format)
   */
  parseCommandParams(parts) {
    const params = {};
    parts.forEach((part) => {
      if (part.includes(":")) {
        const [key, ...valueParts] = part.split(":");
        let value = valueParts.join(":");
        if (value === "true") value = true;
        else if (value === "false") value = false;
        else if (/^\d+$/.test(value)) value = parseInt(value);
        else if (/^\d*\.\d+$/.test(value)) value = parseFloat(value);
        else if (value.startsWith("{") || value.startsWith("[")) {
          try {
            value = JSON.parse(value);
          } catch {
          }
        }
        params[key] = value;
      } else {
        params[part] = true;
      }
    });
    return params;
  }
  /**
   * Setup built-in commands
   */
  setupCommands() {
    this.addCommand("help", {
      description: "Show available commands",
      syntax: "/help [command]",
      handler: (params) => {
        if (params.command) {
          const cmd = this.commands.get(params.command);
          if (cmd) {
            this.log(`\u{1F4CB} ${params.command}: ${cmd.description}`);
            this.log(`\u{1F4A1} Syntax: ${cmd.syntax}`);
            this.log(`\u{1F4DD} Examples:`);
            cmd.examples.forEach((ex) => this.log(`   ${ex}`));
          } else {
            this.log(`\u274C Command not found: ${params.command}`);
          }
        } else {
          this.log("\u{1F4CB} Available FX Developer Commands:");
          this.log("");
          this.commands.forEach((cmd, name) => {
            this.log(`/${name.padEnd(15)} - ${cmd.description}`);
          });
          this.log("");
          this.log("\u{1F4A1} Use /help command:name for detailed help");
        }
      },
      examples: ["/help", "/help command:goto"]
    });
    this.addCommand("fx", {
      description: "Inspect FX framework state",
      syntax: "/fx [action:nodes|plugins|stats]",
      handler: (params) => {
        const action = params.action || "stats";
        switch (action) {
          case "nodes":
            const nodeCount = Object.keys(this.fx.root.__nodes).length;
            this.log(`\u{1F4CA} FX Nodes: ${nodeCount} total`);
            Object.keys(this.fx.root.__nodes).slice(0, 10).forEach((key) => {
              const node = this.fx.root.__nodes[key];
              this.log(`  ${key}: ${typeof node.__value} (${node.__watchers?.size || 0} watchers)`);
            });
            break;
          case "plugins":
            const plugins = Object.keys(globalThis).filter((key) => key.startsWith("$"));
            this.log(`\u{1F4E6} Loaded Plugins: ${plugins.length}`);
            plugins.forEach((plugin) => {
              const available = typeof globalThis[plugin] !== "undefined";
              this.log(`  ${plugin}: ${available ? "\u2705" : "\u274C"}`);
            });
            break;
          case "stats":
          default:
            this.log(`\u{1FA84} FX Framework Status:`);
            this.log(`  Version: ${this.fx.version || "Unknown"}`);
            this.log(`  Auto-loading: ${typeof loadPluginByGlobal !== "undefined" ? "Enabled" : "Disabled"}`);
            this.log(`  Plugins: ${Object.keys(globalThis).filter((k) => k.startsWith("$")).length}`);
            this.log(`  Nodes: ${Object.keys(this.fx.root.__nodes).length}`);
            break;
        }
      },
      examples: ["/fx", "/fx action:nodes", "/fx action:plugins"]
    });
    this.addCommand("goto", {
      description: "Navigate to URL",
      syntax: "/goto url:address [wait:ms]",
      handler: async (params) => {
        if (!params.url) {
          throw new Error("URL required");
        }
        window.location.href = params.url;
        if (params.wait) {
          await new Promise((resolve) => setTimeout(resolve, params.wait));
        }
        return `\u{1F517} Navigated to: ${params.url}`;
      },
      examples: ["/goto url:/run/dc_1039", "/goto url:http://localhost:4003 wait:1000"]
    });
    this.addCommand("click", {
      description: "Click element by selector",
      syntax: "/click target:selector [wait:ms]",
      handler: async (params) => {
        if (!params.target) {
          throw new Error("Target selector required");
        }
        const element = document.querySelector(params.target);
        if (!element) {
          throw new Error(`Element not found: ${params.target}`);
        }
        element.click();
        if (params.wait) {
          await new Promise((resolve) => setTimeout(resolve, params.wait));
        }
        return `\u{1F5B1}\uFE0F Clicked: ${params.target}`;
      },
      examples: ["/click target:button", "/click target:#submit-btn wait:500"]
    });
    this.addCommand("type", {
      description: "Type text into input element",
      syntax: "/type target:selector value:text [clear:true]",
      handler: (params) => {
        if (!params.target || !params.value) {
          throw new Error("Target and value required");
        }
        const element = document.querySelector(params.target);
        if (!element) {
          throw new Error(`Element not found: ${params.target}`);
        }
        if (params.clear) {
          element.value = "";
        }
        element.value = params.value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return `\u2328\uFE0F Typed "${params.value}" into ${params.target}`;
      },
      examples: ["/type target:#email value:test@example.com", '/type target:input[name="username"] value:admin clear:true']
    });
    this.addCommand("get", {
      description: "Get element value or property",
      syntax: "/get target:selector [prop:property]",
      handler: (params) => {
        if (!params.target) {
          throw new Error("Target selector required");
        }
        const element = document.querySelector(params.target);
        if (!element) {
          throw new Error(`Element not found: ${params.target}`);
        }
        const property = params.prop || "textContent";
        const value = element[property];
        this.log(`\u{1F4CB} ${params.target}.${property}: ${JSON.stringify(value)}`);
        return value;
      },
      examples: ["/get target:#username", "/get target:button prop:disabled"]
    });
    this.addCommand("wait", {
      description: "Wait for specified time or element",
      syntax: "/wait [time:ms] [for:selector] [timeout:ms]",
      handler: async (params) => {
        if (params.time) {
          await new Promise((resolve) => setTimeout(resolve, params.time));
          return `\u23F3 Waited ${params.time}ms`;
        }
        if (params.for) {
          const timeout = params.timeout || 5e3;
          const startTime = Date.now();
          while (Date.now() - startTime < timeout) {
            if (document.querySelector(params.for)) {
              return `\u2705 Element appeared: ${params.for}`;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw new Error(`Timeout waiting for: ${params.for}`);
        }
        throw new Error("Either time or for parameter required");
      },
      examples: ["/wait time:1000", "/wait for:button timeout:10000"]
    });
    this.addCommand("clear", {
      description: "Clear console output",
      syntax: "/clear",
      handler: () => {
        if (this.output) {
          this.output.innerHTML = "";
        }
        return "Console cleared";
      },
      examples: ["/clear"]
    });
    this.addCommand("set", {
      description: "Set FX node value",
      syntax: "/set path:node.path value:data",
      handler: (params) => {
        if (!params.path || params.value === void 0) {
          throw new Error("Path and value required");
        }
        $$(params.path).set(params.value);
        return `\u2705 Set ${params.path} = ${JSON.stringify(params.value)}`;
      },
      examples: ["/set path:app.debug value:true", '/set path:user.name value:"John Doe"']
    });
    this.addCommand("get", {
      description: "Get FX node value",
      syntax: "/get path:node.path",
      handler: (params) => {
        if (!params.path) {
          throw new Error("Path required");
        }
        const value = $$(params.path).get();
        this.log(`\u{1F4CB} ${params.path}: ${JSON.stringify(value, null, 2)}`);
        return value;
      },
      examples: ["/get path:app.user", "/get path:wizard.currentStep"]
    });
    this.addCommand("watch", {
      description: "Watch element for changes",
      syntax: "/watch target:selector [prop:property] [stop:true]",
      handler: (params) => {
        if (params.stop) {
          this.watchers = this.watchers.filter((w) => w.selector !== params.target);
          return `\u{1F50D} Stopped watching: ${params.target}`;
        }
        if (!params.target) {
          throw new Error("Target selector required");
        }
        const watcher = {
          selector: params.target,
          property: params.prop || "textContent",
          callback: (oldVal, newVal) => {
            this.log(`\u{1F441}\uFE0F ${params.target}.${watcher.property}: ${JSON.stringify(oldVal)} \u2192 ${JSON.stringify(newVal)}`, "watch");
          }
        };
        this.watchers.push(watcher);
        return `\u{1F441}\uFE0F Watching: ${params.target}.${watcher.property}`;
      },
      examples: ["/watch target:#status", "/watch target:input prop:value", "/watch target:#status stop:true"]
    });
    this.addCommand("test", {
      description: "Run automated test sequence",
      syntax: "/test script:name [steps:json]",
      handler: async (params) => {
        if (params.script) {
          return await this.runTestScript(params.script);
        }
        if (params.steps) {
          return await this.runTestSteps(params.steps);
        }
        throw new Error("Script name or steps required");
      },
      examples: ["/test script:login", '/test steps:[{"action":"click","target":"button"}]']
    });
  }
  /**
   * Add custom command
   */
  addCommand(name, command) {
    this.commands.set(name, {
      name,
      ...command
    });
  }
  /**
   * Log message to console
   */
  log(message, type = "info") {
    if (!this.output) return;
    const timestamp = (/* @__PURE__ */ new Date()).toLocaleTimeString();
    const colors = {
      info: "#00ff00",
      error: "#ff4444",
      success: "#44ff44",
      input: "#ffff44",
      watch: "#44ffff"
    };
    const logLine = document.createElement("div");
    logLine.style.color = colors[type];
    logLine.textContent = `[${timestamp}] ${message}`;
    this.output.appendChild(logLine);
    this.output.scrollTop = this.output.scrollHeight;
    $$("devtools.console.history").set([
      ...($$("devtools.console.history").get() || []).slice(-99),
      { timestamp, message, type }
    ]);
  }
  /**
   * Setup WebSocket remote control
   */
  setupWebSocketRemoteControl() {
    if (!this.options.enableRemoteControl) return;
    try {
      this.webSocket = new WebSocket(this.options.websocketUrl);
      this.webSocket.onopen = () => {
        this.log("\u{1F4E1} Remote control connected", "success");
        $$("devtools.remoteControl.connected").set(true);
      };
      this.webSocket.onclose = () => {
        this.log("\u274C Remote control disconnected", "error");
        $$("devtools.remoteControl.connected").set(false);
        setTimeout(() => this.setupWebSocketRemoteControl(), 3e3);
      };
      this.webSocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "command") {
          this.log(`\u{1F4E1} Remote command: ${data.command}`, "input");
          this.executeCommand(data.command);
        }
        if (data.type === "test_script") {
          this.log(`\u{1F916} Remote test script: ${data.script}`, "input");
          this.runTestScript(data.script);
        }
      };
    } catch (error) {
      this.log(`\u274C Failed to setup remote control: ${error.message}`, "error");
    }
  }
  /**
   * Setup element watching system
   */
  setupElementWatching() {
    if (!this.options.enableElementWatching) return;
    this.watcherInterval = setInterval(() => {
      this.watchers.forEach((watcher) => {
        const element = document.querySelector(watcher.selector);
        if (element) {
          const currentValue = element[watcher.property];
          if (currentValue !== watcher.lastValue) {
            watcher.callback(watcher.lastValue, currentValue);
            watcher.lastValue = currentValue;
          }
        }
      });
    }, 500);
  }
  /**
   * Run automated test script
   */
  async runTestScript(scriptName) {
    this.log(`\u{1F916} Running test script: ${scriptName}`);
    const scripts = {
      "wizard_navigation": [
        { action: "goto", target: "/run/dc_1039" },
        { action: "wait", timeout: 2e3 },
        { action: "assert", target: "h1", expected: "Tenant Migration: dc_1039" },
        { action: "click", target: 'button:contains("2. Inventory")' },
        { action: "wait", timeout: 1e3 },
        { action: "report", target: "Current step completed" }
      ],
      "form_interaction": [
        { action: "type", target: 'input[placeholder*="host"]', value: "localhost" },
        { action: "type", target: 'input[type="password"]', value: "testpass" },
        { action: "click", target: 'button[type="submit"]' },
        { action: "wait", timeout: 2e3 },
        { action: "report", target: "Form submission attempted" }
      ]
    };
    const steps = scripts[scriptName];
    if (!steps) {
      throw new Error(`Test script not found: ${scriptName}`);
    }
    return await this.runTestSteps(steps);
  }
  /**
   * Execute test steps
   */
  async runTestSteps(steps) {
    const results = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      this.log(`\u{1F916} Step ${i + 1}: ${step.action} ${step.target || ""}`);
      try {
        let result;
        switch (step.action) {
          case "goto":
            if (step.target) {
              window.location.href = step.target;
              result = `Navigated to ${step.target}`;
            }
            break;
          case "click":
            if (step.target) {
              const element = document.querySelector(step.target);
              if (element) {
                element.click();
                result = `Clicked ${step.target}`;
              }
            }
            break;
          case "type":
            if (step.target && step.value) {
              const element = document.querySelector(step.target);
              if (element) {
                element.value = step.value;
                element.dispatchEvent(new Event("input", { bubbles: true }));
                result = `Typed "${step.value}" into ${step.target}`;
              }
            }
            break;
          case "wait":
            if (step.timeout) {
              await new Promise((resolve) => setTimeout(resolve, step.timeout));
              result = `Waited ${step.timeout}ms`;
            }
            break;
          case "assert":
            if (step.target && step.expected) {
              const element = document.querySelector(step.target);
              const actual = element?.textContent || "";
              if (actual.includes(step.expected)) {
                result = `\u2705 Assertion passed: ${step.target} contains "${step.expected}"`;
              } else {
                throw new Error(`Assertion failed: ${step.target} = "${actual}", expected "${step.expected}"`);
              }
            }
            break;
          case "report":
            result = `\u{1F4CA} ${step.target}`;
            break;
        }
        if (result) {
          this.log(`  \u2705 ${result}`, "success");
          results.push(result);
        }
      } catch (error) {
        this.log(`  \u274C Step failed: ${error.message}`, "error");
        results.push({ error: error.message, step: i + 1 });
      }
    }
    return { completed: steps.length, results };
  }
  /**
   * Get console output for remote access
   */
  getConsoleOutput() {
    return $$("devtools.console.history").get() || [];
  }
  /**
   * Send remote command
   */
  sendRemoteCommand(command) {
    if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
      this.webSocket.send(JSON.stringify({
        type: "command",
        command,
        timestamp: Date.now()
      }));
      return true;
    }
    return false;
  }
  /**
   * Cleanup
   */
  destroy() {
    if (this.console) {
      this.console.remove();
    }
    if (this.webSocket) {
      this.webSocket.close();
    }
    if (this.watcherInterval) {
      clearInterval(this.watcherInterval);
    }
    this.log("\u{1F6D1} FX DevTools destroyed");
  }
}
function fxDevToolsPlugin(fx, options = {}) {
  const devTools = new FXDevToolsPlugin(fx, options);
  if (options.global) {
    globalThis[options.global] = {
      show: () => devTools.showConsole(),
      hide: () => devTools.hideConsole(),
      toggle: () => devTools.toggleConsole(),
      log: (msg) => devTools.log(msg),
      addCommand: (name, cmd) => devTools.addCommand(name, cmd),
      getOutput: () => devTools.getConsoleOutput(),
      sendRemote: (cmd) => devTools.sendRemoteCommand(cmd),
      destroy: () => devTools.destroy()
    };
  }
  return devTools;
}
