# FX — Start Here (for humans and agents)

You are looking at a project that has the FX framework installed. This document is the **one thing you read first** before changing any `fx/`, `src/client.ts`, `src/server.ts`, or `index.html` file. Skipping this will cost you an hour.

Read this all the way through. It is short.

---

## 1. What's in this project

```
<project>/
├── fx/
│   ├── fx.ts              ← the kernel (do NOT edit unless you know what you're doing)
│   ├── plugins/           ← plugin source (.ts) + pre-transpiled (.js)
│   ├── bundle.fxb         ← binary VFS — all plugin .js files packed
│   ├── fx-disk/           ← filesystem-mirror support
│   └── .fxrc.json         ← plugin manifest
├── src/
│   ├── client.ts          ← browser entry — loads plugins, sets globals
│   └── server.ts          ← Deno entry (if scaffolded)
├── docs/fx/               ← plugin docs (only for plugins you installed)
└── index.html
```

## 2. How FX loads in the browser (the ONE thing to understand)

```
<script type="module" src="/fx/fx.ts"></script>         ← kernel
<script type="module">                                   ← VFS loader
  const resp = await fetch('/fx/bundle.fxb');
  if (resp.ok) {
    const data = new Uint8Array(await resp.arrayBuffer());
    globalThis.fxBootBundleSync(data);                   ← loads plugins into VFS
  }
</script>
<script type="module" src="/src/client.ts"></script>    ← your code
```

Inside `client.ts` you ask for plugins with **@-syntax**:

```ts
import "../fx/fx.ts";
$$("@./fx/plugins/fx-dom-dollar.ts").options({ global: "$" });
$$("@./fx/plugins/fx-router.ts").options({ global: "$router" });
```

The `@` tells FX "this is a module path." The loader checks the VFS (bundle.fxb) first, then falls back to sync XHR. **No network round-trip if the plugin is in the bundle.**

## 3. The rules

### Rule 1 — The global name comes from `options({ global: "..." })`. Nothing else.

```ts
$$("@./fx/plugins/fx-dom-dollar.ts").options({ global: "$" });     // → window.$
$$("@./fx/plugins/fx-dom-dollar.ts").options({ global: "$dom" });  // → window.$dom
```

If you want `$("#x")` to work, the global MUST be `"$"`. If you want `$dom("#x")`, the global MUST be `"$dom"`. Plugins do NOT set their own globals.

### Rule 2 — Plugins are in the VFS (bundle.fxb), not on disk.

When you change a plugin's source file in `fx/plugins/`, **the change does not take effect until you rebuild `bundle.fxb`.** The `.ts` file is for your editor; the `.js` file is what actually runs; the `.fxb` file is what the browser loads.

To rebuild the bundle after editing a plugin:

```
deno run -A C:/dev/fx/cli/rebuild-bundle.ts "<absolute path to this project>/fx/plugins"
```

Or reinstall: `fx --update` from the project root.

### Rule 3 — The manifest (`.fxrc.json`) is declarative state. It does NOT auto-load in the browser.

The manifest lists installed plugins. In the current build the manifest's lazy-loading only works server-side — the browser code path is a stub. So **until this is fixed, always load plugins explicitly in `client.ts` with @-syntax**. Don't remove @-syntax calls hoping the manifest will handle it. It won't.

This is a known issue. When it's fixed, this doc will be updated.

### Rule 4 — If `$` is undefined in the console, check in this order:

1. `globalThis.fxBootBundleSync` exists? → kernel loaded.
2. `document.cookie` won't help you. Check **Network tab**: did `bundle.fxb` return 200?
3. In the console, run `$$("@./fx/plugins/fx-dom-dollar.ts").options({ global: "$" })` manually. If `$` is now defined, your `client.ts` wasn't running. If it still isn't, the VFS load failed.
4. Check the browser console for `[FX]` errors. Common ones:
   - `Cannot use import statement outside a module` → the `.js` version in the bundle is stale, rebuild bundle.
   - `$ is not a function` → the plugin is loading but its global hook is wrong. Check `options({ global: "$" })`.

## 4. Doing common things

### Add a new plugin to the project

```
fx --add <plugin-name>       # e.g. fx --add orm
```

Then add one line to `client.ts`:

```ts
$$("@./fx/plugins/fx-orm.ts").options({ global: "$orm" });
```

Then rebuild bundle (`fx --update` or `rebuild-bundle.ts`).

### Update FX after framework changes

```
fx --update
```

This re-copies the kernel, plugins, docs, and rebuilds `bundle.fxb`. Your `client.ts` and `index.html` are NOT overwritten.

### Remove a plugin

Delete the line from `client.ts`, run `fx --remove <name>`, rebuild bundle.

## 5. What NOT to do

- ❌ Don't edit `fx/fx.ts` to "fix" something — fix it in `C:/dev/fx/cli/assets/kernel.ts` so every project benefits.
- ❌ Don't edit `fx/plugins/*.js` — edit the `.ts` master in `C:/dev/fx/cli/assets/plugins/` and rebuild.
- ❌ Don't set `globalThis.$` inside a plugin — the framework handles globals via `options({ global })`.
- ❌ Don't remove @-syntax calls from `client.ts` expecting the manifest to load plugins. The browser lazy-loader is not wired up yet.
- ❌ Don't fetch plugins from a URL. They live in `bundle.fxb`.

## 6. Checking this install is correct

Open the browser devtools on the page. In the console:

```js
typeof globalThis.fxBootBundleSync      // "function"  ← kernel loaded
typeof $$                                // "function"  ← FX root proxy
typeof $                                 // "function"  ← dom-dollar (if installed with global: "$")
$$("app.ready").get()                    // true        ← your client.ts ran
$("body").text().length > 0              // true        ← $ works
```

If any of those are wrong, go to Rule 4 above.

---

**Last updated:** 2026-04-15. If this doc is older than the bundle.fxb you are looking at, trust the code, not the doc, and file a bug.
