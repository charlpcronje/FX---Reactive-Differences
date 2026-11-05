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
  default: () => markdownPlugin
});
module.exports = __toCommonJS(stdin_exports);
class MarkdownConverter {
  options;
  logger;
  executors;
  footnotes;
  tocItems;
  constructor(options = {}) {
    this.options = {
      sanitize: true,
      breaks: true,
      smartypants: false,
      runnable: false,
      highlightCode: true,
      flavors: {
        gfm: true,
        commonmark: true,
        extended: true,
        math: false,
        mermaid: false,
        tasklists: true,
        tables: true,
        emoji: true,
        autolinks: true,
        footnotes: true,
        toc: false
      },
      ...options
    };
    this.logger = this.createLogger();
    this.executors = /* @__PURE__ */ new Map();
    this.footnotes = /* @__PURE__ */ new Map();
    this.tocItems = [];
    this.setupDefaultExecutors();
  }
  createLogger() {
    return (message, level = "info") => {
      const prefix = "[FX-Markdown]";
      switch (level) {
        case "error":
          console.error(`${prefix} ${message}`);
          break;
        case "warn":
          console.warn(`${prefix} ${message}`);
          break;
        default:
          console.log(`${prefix} ${message}`);
      }
    };
  }
  setupDefaultExecutors() {
    this.executors.set("javascript", {
      language: "javascript",
      execute: (code) => {
        try {
          let cleanCode = code.replace(/^\s*import\s+.*?;?\s*$/gm, "").replace(/^\s*export\s+.*?$/gm, "").trim();
          try {
            const func = new Function("return " + cleanCode);
            return func();
          } catch {
            const func = new Function(cleanCode);
            const result = func();
            return result !== void 0 ? result : "\u2713 Code executed successfully";
          }
        } catch (e) {
          return `Error: ${e.message}`;
        }
      }
    });
    this.executors.set("js", this.executors.get("javascript"));
    this.executors.set("typescript", this.executors.get("javascript"));
    this.executors.set("ts", this.executors.get("javascript"));
    this.executors.set("math", {
      language: "math",
      execute: (code) => {
        try {
          const result = new Function("return " + code.replace(/[^0-9+\-*/.() ]/g, ""))();
          return result;
        } catch (e) {
          return `Error: ${e.message}`;
        }
      }
    });
  }
  addExecutor(executor) {
    this.executors.set(executor.language, executor);
  }
  escapeHtml(text) {
    if (!this.options.sanitize) return text;
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return text.replace(/[&<>"']/g, (char) => map[char]);
  }
  processInlineElements(text) {
    try {
      const flavors = this.options.flavors;
      if (flavors.footnotes) {
        text = text.replace(/\[\^(\w+)\]/g, (match, ref) => {
          return `<sup><a href="#fn-${ref}" id="fnref-${ref}">[${ref}]</a></sup>`;
        });
      }
      if (flavors.math) {
        text = text.replace(/\$([^$]+)\$/g, (_, math) => {
          return `<span class="math-inline" data-math="${this.escapeHtml(math)}">${this.escapeHtml(math)}</span>`;
        });
      }
      text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, url, title) => {
        const titleAttr = title ? ` title="${this.escapeHtml(title)}"` : "";
        return `<img src="${this.escapeHtml(url)}" alt="${this.escapeHtml(alt)}"${titleAttr}>`;
      });
      text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, linkText, url, title) => {
        const titleAttr = title ? ` title="${this.escapeHtml(title)}"` : "";
        return `<a href="${this.escapeHtml(url)}"${titleAttr}>${this.escapeHtml(linkText)}</a>`;
      });
      if (flavors.autolinks) {
        text = text.replace(/(?<!["'])(https?:\/\/[^\s<]+[^<.,:;"'\]\s])/g, (url) => {
          return `<a href="${this.escapeHtml(url)}">${this.escapeHtml(url)}</a>`;
        });
      }
      text = text.replace(/`([^`]+)`/g, (_, code) => {
        return `<code>${this.escapeHtml(code)}</code>`;
      });
      text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
      text = text.replace(/(?:^|\s)\*([^*]+)\*(?:\s|$)/g, " <em>$1</em> ");
      text = text.replace(/(?:^|\s)_([^_]+)_(?:\s|$)/g, " <em>$1</em> ");
      if (flavors.gfm) {
        text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");
      }
      if (flavors.extended) {
        text = text.replace(/==([^=]+)==/g, "<mark>$1</mark>");
      }
      if (flavors.emoji) {
        const emojiMap = {
          ":smile:": "\u{1F60A}",
          ":heart:": "\u2764\uFE0F",
          ":fire:": "\u{1F525}",
          ":rocket:": "\u{1F680}",
          ":star:": "\u2B50",
          ":check:": "\u2705",
          ":x:": "\u274C",
          ":warning:": "\u26A0\uFE0F",
          ":thumbsup:": "\u{1F44D}",
          ":thumbsdown:": "\u{1F44E}",
          ":eyes:": "\u{1F440}",
          ":tada:": "\u{1F389}"
        };
        text = text.replace(/:(\w+):/g, (match, emoji) => emojiMap[match] || match);
      }
      return text;
    } catch (error) {
      this.logger(`Error processing inline elements: ${error}`, "error");
      return text;
    }
  }
  processCodeBlock(lines, index) {
    try {
      const langMatch = lines[index].match(/^```(\w+)?(!)?/);
      const lang = langMatch?.[1] || "";
      const isRunnable = langMatch?.[2] === "!" && this.options.runnable;
      const codeLines = [];
      let i = index + 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      const code = codeLines.join("\n");
      const escaped = this.escapeHtml(code);
      if (lang === "mermaid" && this.options.flavors?.mermaid) {
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        return [`<div class="mermaid" id="${id}">${escaped}</div>`, i];
      }
      if (lang === "math" && this.options.flavors?.math) {
        return [`<div class="math-block">${escaped}</div>`, i];
      }
      const langClass = lang ? ` class="language-${lang}"` : "";
      const highlightClass = this.options.highlightCode ? " highlight" : "";
      if (isRunnable && this.executors.has(lang)) {
        const btnId = `run-${Math.random().toString(36).slice(2)}`;
        const outputId = `output-${Math.random().toString(36).slice(2)}`;
        const html = `<div class="code-runnable">
  <div class="code-header">
    <span class="code-lang">${lang}</span>
    <button class="run-button" onclick="window.__fxMarkdownRun('${btnId}', '${lang}', '${outputId}')">\u25B6 Run</button>
  </div>
  <pre><code${langClass}${highlightClass} id="${btnId}">${escaped}</code></pre>
  <div class="code-output" id="${outputId}"></div>
</div>`;
        if (typeof window !== "undefined") {
          window.__fxMarkdownCode = window.__fxMarkdownCode || {};
          window.__fxMarkdownCode[btnId] = code;
        }
        return [html, i];
      }
      return [`<pre><code${langClass}${highlightClass}>${escaped}</code></pre>`, i];
    } catch (error) {
      this.logger(`Error processing code block: ${error}`, "error");
      return ["", index];
    }
  }
  processList(lines, index, ordered) {
    try {
      const items = [];
      let i = index;
      const pattern = ordered ? /^\d+\.\s+(.+)/ : /^[-*+]\s+(.+)/;
      const flavors = this.options.flavors;
      while (i < lines.length) {
        const line = lines[i];
        if (flavors.tasklists) {
          const taskMatch = line.match(/^[-*+]\s+\[([ xX])\]\s+(.+)/);
          if (taskMatch) {
            const checked = taskMatch[1].toLowerCase() === "x";
            const checkAttr = checked ? " checked" : "";
            items.push(`<li class="task-list-item"><input type="checkbox" disabled${checkAttr}> ${this.processInlineElements(taskMatch[2])}</li>`);
            i++;
            continue;
          }
        }
        const match = line.match(pattern);
        if (!match) break;
        items.push(`<li>${this.processInlineElements(match[1])}</li>`);
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      const taskClass = flavors.tasklists && items.some((item) => item.includes("task-list-item")) ? ' class="task-list"' : "";
      return [`<${tag}${taskClass}>
${items.join("\n")}
</${tag}>`, i - 1];
    } catch (error) {
      this.logger(`Error processing list: ${error}`, "error");
      return ["", index];
    }
  }
  processTable(lines, index) {
    try {
      if (!this.options.flavors?.tables) return ["", index];
      const headerLine = lines[index];
      const separatorLine = lines[index + 1];
      if (!separatorLine || !/^[\s|:-]+$/.test(separatorLine.replace(/[^|:-\s]/g, ""))) {
        return ["", index];
      }
      const parseRow = (line) => line.split("|").map((cell) => cell.trim()).filter(Boolean);
      const headers = parseRow(headerLine);
      const alignments = parseRow(separatorLine).map((sep) => {
        if (sep.startsWith(":") && sep.endsWith(":")) return "center";
        if (sep.endsWith(":")) return "right";
        if (sep.startsWith(":")) return "left";
        return "";
      });
      let i = index + 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      let html = "<table>\n<thead>\n<tr>\n";
      headers.forEach((header, idx) => {
        const align = alignments[idx] ? ` align="${alignments[idx]}"` : "";
        html += `<th${align}>${this.processInlineElements(header)}</th>
`;
      });
      html += "</tr>\n</thead>\n<tbody>\n";
      rows.forEach((row) => {
        html += "<tr>\n";
        row.forEach((cell, idx) => {
          const align = alignments[idx] ? ` align="${alignments[idx]}"` : "";
          html += `<td${align}>${this.processInlineElements(cell)}</td>
`;
        });
        html += "</tr>\n";
      });
      html += "</tbody>\n</table>";
      return [html, i - 1];
    } catch (error) {
      this.logger(`Error processing table: ${error}`, "error");
      return ["", index];
    }
  }
  processBlockquote(lines, index) {
    try {
      const quoteLines = [];
      let i = index;
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      const content = this.processInlineElements(quoteLines.join("\n"));
      return [`<blockquote>${content}</blockquote>`, i - 1];
    } catch (error) {
      this.logger(`Error processing blockquote: ${error}`, "error");
      return ["", index];
    }
  }
  convert(markdown) {
    try {
      if (!markdown || typeof markdown !== "string") {
        this.logger("Invalid markdown input", "warn");
        return "";
      }
      this.footnotes.clear();
      this.tocItems = [];
      if (this.options.flavors?.footnotes) {
        markdown = markdown.replace(/^\[\^(\w+)\]:\s*(.+)$/gm, (_, ref, text) => {
          this.footnotes.set(ref, text);
          return "";
        });
      }
      const lines = markdown.split("\n");
      const html = [];
      let i = 0;
      while (i < lines.length) {
        const line = lines[i].trimEnd();
        if (!line) {
          if (this.options.breaks) html.push("<br>");
          i++;
          continue;
        }
        const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch) {
          const level = headerMatch[1].length;
          const text = this.processInlineElements(headerMatch[2]);
          const id = this.options.flavors?.toc ? `h-${text.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
          if (this.options.flavors?.toc) {
            this.tocItems.push({ level, text, id });
            html.push(`<h${level} id="${id}">${text}</h${level}>`);
          } else {
            html.push(`<h${level}>${text}</h${level}>`);
          }
          i++;
          continue;
        }
        if (/^([-*_])\1{2,}$/.test(line)) {
          html.push("<hr>");
          i++;
          continue;
        }
        if (this.options.flavors?.tables && line.includes("|") && lines[i + 1]?.includes("|")) {
          const [table, newIndex] = this.processTable(lines, i);
          if (table) {
            html.push(table);
            i = newIndex + 1;
            continue;
          }
        }
        if (line.startsWith("```")) {
          const [block, newIndex] = this.processCodeBlock(lines, i);
          html.push(block);
          i = newIndex + 1;
          continue;
        }
        if (line.startsWith(">")) {
          const [block, newIndex] = this.processBlockquote(lines, i);
          html.push(block);
          i = newIndex + 1;
          continue;
        }
        if (/^\d+\.\s+/.test(line)) {
          const [list, newIndex] = this.processList(lines, i, true);
          html.push(list);
          i = newIndex + 1;
          continue;
        }
        if (/^[-*+]\s+/.test(line)) {
          const [list, newIndex] = this.processList(lines, i, false);
          html.push(list);
          i = newIndex + 1;
          continue;
        }
        const paragraph = this.processInlineElements(line);
        html.push(`<p>${paragraph}</p>`);
        i++;
      }
      if (this.footnotes.size > 0 && this.options.flavors?.footnotes) {
        html.push('<div class="footnotes"><hr><ol>');
        this.footnotes.forEach((text, ref) => {
          html.push(`<li id="fn-${ref}">${this.processInlineElements(text)} <a href="#fnref-${ref}">\u21A9</a></li>`);
        });
        html.push("</ol></div>");
      }
      let result = html.join("\n");
      if (this.options.flavors?.toc && this.tocItems.length > 0) {
        const toc = this.generateTOC();
        result = toc + "\n" + result;
      }
      if (this.options.runnable && typeof window !== "undefined") {
        this.setupCodeExecution();
      }
      return result;
    } catch (error) {
      this.logger(`Conversion error: ${error}`, "error");
      return "";
    }
  }
  generateTOC() {
    const items = this.tocItems.map((item) => {
      const indent = "  ".repeat(item.level - 1);
      return `${indent}- [${item.text}](#${item.id})`;
    });
    return `<div class="toc">
<h2>Table of Contents</h2>
${this.convert(items.join("\n"))}
</div>`;
  }
  setupCodeExecution() {
    if (window.__fxMarkdownRun) return;
    window.__fxMarkdownRun = async (btnId, lang, outputId) => {
      const code = window.__fxMarkdownCode?.[btnId];
      if (!code) return;
      const output = document.getElementById(outputId);
      if (!output) return;
      const executor = this.executors.get(lang);
      if (!executor) {
        output.innerHTML = `<div class="error">No executor for ${lang}</div>`;
        return;
      }
      try {
        output.innerHTML = '<div class="loading">Running...</div>';
        const result = await executor.execute(code);
        output.innerHTML = `<div class="result">${this.escapeHtml(String(result))}</div>`;
      } catch (error) {
        output.innerHTML = `<div class="error">Error: ${this.escapeHtml(error.message)}</div>`;
      }
    };
  }
}
function markdownPlugin(fx) {
  const converter = new MarkdownConverter();
  const MarkdownBehavior = {
    name: "markdown",
    toHtml(options) {
      try {
        const markdown = this.get();
        if (typeof markdown !== "string") {
          console.warn("[FX-Markdown] Node value is not a string");
          return "";
        }
        const tempConverter = options ? new MarkdownConverter(options) : converter;
        return tempConverter.convert(markdown);
      } catch (error) {
        console.error("[FX-Markdown] toHtml error:", error);
        return "";
      }
    },
    fromMarkdown(markdown, options) {
      try {
        const tempConverter = options ? new MarkdownConverter(options) : converter;
        const html = tempConverter.convert(markdown);
        this.set(html);
        return this;
      } catch (error) {
        console.error("[FX-Markdown] fromMarkdown error:", error);
        return this;
      }
    },
    renderTo(selector, options) {
      try {
        const html = this.toHtml(options);
        const $ = globalThis.$;
        if ($) {
          const target = $(selector);
          if (target) {
            target.html(html);
          }
        } else {
          console.warn("[FX-Markdown] $ (fx-dom-dollar) not available");
        }
        return this;
      } catch (error) {
        console.error("[FX-Markdown] renderTo error:", error);
        return this;
      }
    }
  };
  const $markdown = {
    convert(markdown, options) {
      try {
        const tempConverter = options ? new MarkdownConverter(options) : converter;
        return tempConverter.convert(markdown);
      } catch (error) {
        console.error("[FX-Markdown] convert error:", error);
        return "";
      }
    },
    parse(markdown, options) {
      return this.convert(markdown, options);
    },
    renderToNode(markdown, nodePath, options) {
      try {
        const html = this.convert(markdown, options);
        fx.$$(nodePath).set(html);
      } catch (error) {
        console.error("[FX-Markdown] renderToNode error:", error);
      }
    },
    renderToDom(markdown, selector, options) {
      try {
        const html = this.convert(markdown, options);
        const $ = globalThis.$;
        if ($) {
          const target = $(selector);
          if (target) {
            target.html(html);
          }
        } else {
          console.warn("[FX-Markdown] $ (fx-dom-dollar) not available");
        }
      } catch (error) {
        console.error("[FX-Markdown] renderToDom error:", error);
      }
    },
    addExecutor(executor) {
      converter.addExecutor(executor);
    },
    gfm(markdown) {
      return this.convert(markdown, { flavors: { gfm: true, commonmark: true, tables: true, tasklists: true, autolinks: true } });
    },
    commonmark(markdown) {
      return this.convert(markdown, { flavors: { commonmark: true, gfm: false, extended: false } });
    },
    extended(markdown) {
      return this.convert(markdown, { flavors: { extended: true, footnotes: true, toc: true, math: true } });
    },
    runnable(markdown, options) {
      return this.convert(markdown, { ...options, runnable: true });
    },
    behavior: MarkdownBehavior
  };
  return { name: "fx-markdown", version: "2.0.0", api: $markdown };
}
