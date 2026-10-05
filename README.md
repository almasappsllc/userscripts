# Userscripts

Tampermonkey scripts for the consoles we work in. Served locally so Tampermonkey
installs from, and checks for updates at, `http://localhost:8765/`.

```
cd ~/almas-hq/userscripts && python3 -m http.server 8765
```

Install: open http://localhost:8765/console-tools.user.js in the browser and
Tampermonkey offers to install it. After an edit, **bump `@version`**, then
Tampermonkey → Utilities → Check for updates (or wait for its periodic check).

| Script | What it does |
|---|---|
| `console-tools.user.js` | Gear menu on play.google.com/console. Price editor: tick Tier 1 (56 countries), Tier 2 (everyone else), or clear. You still press **Set price** and type the price. |
