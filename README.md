# Userscripts

Tampermonkey scripts for the consoles we work in. Tampermonkey installs from,
and checks for updates at, this repo's `main` branch on GitHub.

Install: open
https://raw.githubusercontent.com/almasappsllc/userscripts/main/console-tools.user.js
and Tampermonkey offers to install it. After an edit, **bump `@version`** and
push to `main`, then Tampermonkey → Utilities → Check for updates (or wait for
its periodic check). GitHub caches raw files for about five minutes.

To try an edit before pushing, serve the folder and install from localhost:

```
cd ~/almas-hq/userscripts && python3 -m http.server 8765
```

then open http://localhost:8765/console-tools.user.js. That copy still updates
from GitHub, so push when it works.

| Script | What it does |
|---|---|
| `console-tools.user.js` | Gear menu on play.google.com/console. Price editor: tick Tier 1 (56 countries), Tier 2 (everyone else), or clear. You still press **Set price** and type the price. Order management: the menu opens with a count of real purchases (test orders excluded, totals converted to CAD via open.er-api.com) covering every page viewed since reload. Toggles: **Hide test orders**, **Hide refunded orders** (out of the table and the counts), **Purchase overlay** (keeps the stats on screen), **Keep menu open** (on by default: takes the Console's hover-only mode, the `hover-expandable` class, off the left menu so it stays docked open). |
