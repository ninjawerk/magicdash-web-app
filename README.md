# Web app — a MagicDash plugin

Show any web page, or your own kiosk app, inside a MagicDash tile. Browse within it, put a customisable back button on it, take it full screen, rotate pages, return home when idle, and let the page talk to the kiosk through a small JavaScript bridge.

## Install

In [MagicDash](https://github.com/ninjawerk/magicdash): **Admin → Plugins → Browse catalog** and pick *Web app*, or upload the zip from the latest release.

## Two modes

- **Tile** — lives in the grid, can go full screen (the toolbar docks at the top with the styled Back button).
- **Kiosk takeover** — the page *is* the screen: no toolbar, no back button, no dashboard. It covers the display as soon as the dashboard loads. To reach the dashboard again, press and hold an invisible spot in a corner (which corner and how long are configurable; default top-left, 3 s): the takeover pauses for a minute and a "Resume now" pill appears. Edit mode and the admin always show the grid, so you can change the tile from a laptop at any time.

## What the tile can do

| Area | Options |
|---|---|
| Mode | tile or kiosk takeover; exit gesture corner and hold time |
| Page | URL, or a **hosted app** uploaded to the dashboard; extra pages to rotate through (signage mode); zoom; reload interval; return-home after idle; loading backdrop |
| Toolbar | show on tap/hover, always, or never; top or bottom; pick the buttons (back, forward, home, reload, address, full screen); compact or touch-sized |
| Back button | floating over the page or toolbar-only; label, icon, position (any corner), shape, size, colour (accent, glass, dark, light, custom); only show when away from home; what it does (history → home, always home, reload, leave full screen) |
| Full screen | start expanded; the page covers the whole dashboard without reloading; pauses screen rotation while expanded; Escape / Back leaves |
| Permissions | camera, microphone, location, autoplay, browser full screen, clipboard; sandbox off / standard / strict; hosts the tile may navigate to |
| Bridge | the MagicDash JavaScript API for the page, with extra allowed origins |

In edit mode the tile checks whether the page allows embedding (X-Frame-Options / CSP) and tells you before you leave edit mode.

## Hosting your own kiosk app

Zip a folder with an `index.html` at its root and upload it:

```bash
curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/zip" \
  --data-binary @myapp.zip "http://<pi>:3210/api/plugins/web-app/apps?name=myapp"
```

It is served at `/api/plugins/web-app/apps/myapp/` and appears in the tile's **Hosted app** dropdown. Same-origin pages get real history (back/forward work natively). A bundled **sample app** shows every bridge feature; pick it from the dropdown.

## The kiosk bridge (for pages)

```html
<script src="/api/plugins/web-app/sdk.js"></script>
<script>
  MagicDash.ready().then(ctx => {
    // ctx = dashboard context: { location, name, units }
    MagicDash.notify('Hello from my app', { level: 'success' });
  });
  MagicDash.on('topic:weather:current', w => console.log(w.temp));
  MagicDash.on('back', () => { /* handle the kiosk back button; return false to let the tile decide */ });
</script>
```

For pages on another origin use the absolute URL of the SDK (`http://<pi>:3210/api/plugins/web-app/sdk.js`). Everything is promise-based and works only inside a Web app tile; outside one the methods reject.

| Method | Effect |
|---|---|
| `ready()` | resolves with the dashboard context once connected |
| `notify(message, {title, level, durationSec})` | toast on the dashboard |
| `setAlert(bool)` | turn the tile red and pulsing |
| `setBackground(css)` | paint the tile frame |
| `requestAttention(reason)` / `releaseAttention()` | switch every kiosk to this tile's screen and hold it (120 s max) |
| `showScreen(idOrName)` | switch screens without a lock |
| `expand()` / `collapse()` | full screen on / off |
| `navigate(url)` / `back()` / `home()` | drive the tile's navigation (subject to allowed hosts) |
| `publish(topic, payload)` / `getTopic(topic)` / `on('topic:<name>', fn)` | the in-browser plugin bus (`weather:current`, `calendar:next`, your own topics) |
| `kv.get/set/delete/all` | small per-app key/value store on the server (256 kB per app) |
| `fetch(url, {method, body})` | server-side fetch for hosts allow-listed in the plugin settings (no CORS trouble) |
| `openSettings()` | open this tile's settings dialog |
| `activity()` | tell the tile the user is active (the SDK does this automatically on touch/keys) |

Properties after `ready()`: `context`, `theme`, `size` (`{w,h,width,height}`), `editMode`, `locale`, `expanded`.
Events via `on(name, fn)`: `context`, `theme`, `size`, `editMode`, `expanded`, `back`, `topic:<name>`.

The theme arrives as CSS variables on `<html>`: `--md-accent --md-fg --md-surface --md-cool --md-warm --md-tile-bg --md-tile-radius --md-font-sans --md-font-mono`, plus `data-md-dark="1|0"`, so a page can match the dashboard with no JavaScript of its own.

## Server routes

| Route | Purpose |
|---|---|
| `GET /api/plugins/web-app/check?url=` | embeddability check |
| `GET /api/plugins/web-app/sdk.js` | the bridge SDK |
| `GET/POST/DELETE /api/plugins/web-app/apps[/:name]` | hosted apps |
| `GET/PUT/POST/DELETE /api/plugins/web-app/kv/:app/:key` | key/value store |
| `GET/POST /api/plugins/web-app/fetch?url=` | allow-listed proxy |

Plugin routes are public on the network, like every kiosk route; the key/value store can be switched off in the plugin settings.

## Develop

Copy the `web-app/` folder into a MagicDash checkout's `plugins/` directory and run `npm run dev`. The plugin contract is documented in
[docs/PLUGINS.md](https://github.com/ninjawerk/magicdash/blob/main/docs/PLUGINS.md).

Release: bump `version` in `manifest.ts`, tag `vX.Y.Z`; the workflow attaches `web-app-X.Y.Z.zip` and its `.sha256` to the release.
Then update the entry in [magicdash-plugins](https://github.com/ninjawerk/magicdash-plugins).

MIT.
