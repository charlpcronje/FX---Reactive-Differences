// webui — Client Entry
// Plugins live pre-transpiled in fx/bundle.fxb (the VFS).
// Only load plugins the app actually uses (see app.ts).
import "../fx/fx.ts";

// $ — jQuery-style DOM helper (used everywhere in app.ts)
$$("@./fx/plugins/fx-dom-dollar.ts").options({ global: "$" });

// App init
$$("app.name").set("webui");
$$("app.ready").set(true);

console.log("[FX] Ready");
