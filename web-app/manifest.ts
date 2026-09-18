import type { PluginManifest } from '../../src/sdk/types';

const manifest: PluginManifest = {
  id: 'web-app',
  name: 'Web app',
  description:
    'Show any web page or your own kiosk app in a tile: browse inside it, a customisable back button, full-screen mode, page rotation, idle return-home, and a JavaScript bridge so the page can talk to the kiosk (toasts, alerts, screens, weather, storage). Host your own apps right on the dashboard.',
  version: '1.0.0',
  sdkVersion: 1,
  minHost: '0.2.0',
  author: 'ninjawerk',
  icon: '🌐',
  defaultSize: { w: 6, h: 5 },
  minSize: { w: 2, h: 2 },
  frameless: true,
  settings: [
    { key: 'proxyHosts', label: 'Hosts the server may fetch for embedded apps', type: 'list', itemLabel: 'host', placeholder: 'api.example.com', help: 'Apps can call MagicDash.fetch(url) to read JSON from these hosts without CORS trouble. Empty = proxy disabled.' },
    { key: 'kvEnabled', label: 'Let embedded apps store small values on this server (MagicDash.kv)', type: 'boolean', default: true },
  ],
  widgetConfig: [
    // --- Page
    { key: 'url', label: 'Page URL', type: 'string', placeholder: 'https://example.com', help: 'The home page. Leave empty when you pick a hosted app below.' },
    { key: 'app', label: 'Hosted app', type: 'select', optionsFrom: '/apps/options', help: 'Apps uploaded in the Web app plugin settings (Admin → Plugins), or the bundled sample. Overrides the URL.' },
    { key: 'pages', label: 'More pages to rotate through', type: 'list', itemLabel: 'URL', placeholder: 'https://…', help: 'Digital-signage mode: the tile cycles home + these pages.' },
    { key: 'rotateSec', label: 'Seconds per page', type: 'number', min: 5, max: 3600, default: 30, unit: 's' },
    { key: 'scale', label: 'Zoom', type: 'number', min: 0.25, max: 2, step: 0.05, default: 1, help: '0.5 shows a desktop page at half size; 1.5 makes small text readable across the room.' },
    { key: 'refreshMinutes', label: 'Reload every', type: 'number', min: 0, max: 1440, default: 0, unit: 'min', help: '0 = never.' },
    { key: 'idleHomeSec', label: 'Return home after idle', type: 'number', min: 0, max: 3600, default: 0, unit: 's', help: 'Goes back to the home page (and leaves full screen) when nobody has touched it. 0 = never.' },
    { key: 'background', label: 'Backdrop while loading', type: 'color', default: '#000000' },

    // --- Toolbar
    { key: 'toolbar', label: 'Toolbar', type: 'select', options: [{ value: 'auto', label: 'Show on tap / hover' }, { value: 'always', label: 'Always visible' }, { value: 'never', label: 'Hidden' }], default: 'auto' },
    { key: 'toolbarPosition', label: 'Toolbar position', type: 'select', options: [{ value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }], default: 'top', showWhen: { key: 'toolbar', oneOf: ['auto', 'always'] } },
    {
      key: 'toolbarButtons',
      label: 'Toolbar buttons',
      type: 'multiselect',
      options: [
        { value: 'back', label: 'Back' },
        { value: 'forward', label: 'Forward' },
        { value: 'home', label: 'Home' },
        { value: 'reload', label: 'Reload' },
        { value: 'url', label: 'Address (read-only)' },
        { value: 'expand', label: 'Full screen' },
      ],
      default: ['back', 'home', 'reload', 'url', 'expand'],
      showWhen: { key: 'toolbar', oneOf: ['auto', 'always'] },
    },
    { key: 'toolbarSize', label: 'Button size', type: 'select', options: [{ value: 'compact', label: 'Compact (mouse)' }, { value: 'touch', label: 'Large (touch)' }], default: 'touch', showWhen: { key: 'toolbar', oneOf: ['auto', 'always'] } },

    // --- Back button
    { key: 'backStyle', label: 'Back button', type: 'select', options: [{ value: 'floating', label: 'Floating over the page' }, { value: 'toolbar', label: 'Only in the toolbar' }, { value: 'hidden', label: 'Hidden' }], default: 'floating' },
    { key: 'backAction', label: 'Back does', type: 'select', options: [{ value: 'smart', label: 'Go back in history, then home' }, { value: 'home', label: 'Always go home' }, { value: 'reload', label: 'Reload the page' }, { value: 'collapse', label: 'Leave full screen / go home' }], default: 'smart', showWhen: { key: 'backStyle', oneOf: ['floating', 'toolbar'] } },
    { key: 'backLabel', label: 'Back label', type: 'string', default: 'Back', placeholder: 'Back', help: 'Empty for icon only.', showWhen: { key: 'backStyle', equals: 'floating' } },
    { key: 'backIcon', label: 'Back icon', type: 'select', options: [{ value: 'arrow', label: 'Arrow ←' }, { value: 'chevron', label: 'Chevron ‹' }, { value: 'home', label: 'House' }, { value: 'x', label: 'Close ×' }, { value: 'none', label: 'No icon' }], default: 'arrow', showWhen: { key: 'backStyle', equals: 'floating' } },
    { key: 'backPosition', label: 'Back position', type: 'select', options: [{ value: 'tl', label: 'Top left' }, { value: 'tr', label: 'Top right' }, { value: 'bl', label: 'Bottom left' }, { value: 'br', label: 'Bottom right' }], default: 'bl', showWhen: { key: 'backStyle', equals: 'floating' } },
    { key: 'backShape', label: 'Back shape', type: 'select', options: [{ value: 'pill', label: 'Pill' }, { value: 'circle', label: 'Circle' }, { value: 'square', label: 'Rounded square' }], default: 'pill', showWhen: { key: 'backStyle', equals: 'floating' } },
    { key: 'backSize', label: 'Back size', type: 'number', min: 28, max: 96, default: 48, unit: 'px', showWhen: { key: 'backStyle', equals: 'floating' } },
    { key: 'backColor', label: 'Back colour', type: 'select', options: [{ value: 'accent', label: 'Theme accent' }, { value: 'glass', label: 'Frosted glass' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'custom', label: 'Custom' }], default: 'accent', showWhen: { key: 'backStyle', equals: 'floating' } },
    { key: 'backCustomColor', label: 'Custom back colour', type: 'color', default: '#ff5c5c', showWhen: { key: 'backColor', equals: 'custom' } },
    { key: 'backOnlyWhenAway', label: 'Only show back when away from home', type: 'boolean', default: true, showWhen: { key: 'backStyle', equals: 'floating' } },

    // --- Full screen
    { key: 'expandOnLoad', label: 'Start in full screen', type: 'boolean', default: false, help: 'The page covers the whole dashboard until Back / collapse.' },
    { key: 'expandHoldsAttention', label: 'Pause screen rotation while in full screen', type: 'boolean', default: true },

    // --- Permissions
    {
      key: 'allow',
      label: 'Allow the page to use',
      type: 'multiselect',
      options: [
        { value: 'camera', label: 'Camera' },
        { value: 'microphone', label: 'Microphone' },
        { value: 'geolocation', label: 'Location' },
        { value: 'autoplay', label: 'Autoplay media' },
        { value: 'fullscreen', label: 'Browser full screen' },
        { value: 'clipboard-read', label: 'Read clipboard' },
        { value: 'clipboard-write', label: 'Write clipboard' },
      ],
      default: ['autoplay', 'fullscreen'],
    },
    { key: 'sandbox', label: 'Sandbox', type: 'select', options: [{ value: 'off', label: 'Off (trusted page)' }, { value: 'standard', label: 'Standard (scripts, forms, popups)' }, { value: 'strict', label: 'Strict (scripts and forms only, no cookies)' }], default: 'off', help: 'Sandboxing limits what a page can do. Strict mode breaks most logged-in sites.' },
    { key: 'allowedHosts', label: 'Hosts the tile may navigate to', type: 'list', itemLabel: 'host', placeholder: 'example.com', help: 'Applies to navigations the tile controls (bridge navigate, rotation). Empty = any. Subdomains included.' },
    { key: 'bridge', label: 'Kiosk bridge (MagicDash JavaScript API for the page)', type: 'boolean', default: true },
    { key: 'bridgeOrigins', label: 'Extra origins allowed to use the bridge', type: 'list', itemLabel: 'origin', placeholder: 'https://app.example.com', help: 'The page origin is always allowed. Add others if the page embeds further frames that need the bridge.', showWhen: { key: 'bridge', equals: true } },
  ],
};
export default manifest;
