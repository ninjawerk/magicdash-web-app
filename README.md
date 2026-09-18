# Web app — a MagicDash plugin

Show any web page or your own kiosk app in a MagicDash tile: in-tile browsing, customisable back button, full screen, page rotation, and a JavaScript bridge to the kiosk

## Install

In [MagicDash](https://github.com/ninjawerk/magicdash): **Admin → Plugins → Browse catalog** and pick *Web app*, or upload the zip from the latest release.

## Develop

Copy the `web-app/` folder into a MagicDash checkout's `plugins/` directory and run `npm run dev`. The plugin contract is documented in
[docs/PLUGINS.md](https://github.com/ninjawerk/magicdash/blob/main/docs/PLUGINS.md).

Release: bump `version` in `manifest.ts`, tag `vX.Y.Z`; the workflow attaches `web-app-X.Y.Z.zip` and its `.sha256` to the release.
Then update the entry in [magicdash-plugins](https://github.com/ninjawerk/magicdash-plugins).

MIT.
