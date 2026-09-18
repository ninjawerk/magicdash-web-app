/**
 * Web app plugin — server side.
 *  - /check?url=          can this page be embedded? (X-Frame-Options / CSP frame-ancestors)
 *  - /sdk.js              the kiosk bridge SDK for embedded pages
 *  - /apps                hosted apps: list / upload zip / delete; served at /apps/<name>/
 *  - /kv/:app/:key        tiny key/value store for hosted or bridged apps
 *  - /fetch?url=          server-side fetch (CORS bypass) for allow-listed hosts
 */
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { asyncHandler, defineServerPlugin } from '../../src/sdk/server';

interface Settings {
  proxyHosts?: string[];
  kvEnabled?: boolean;
}

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SAFE = /^[a-z0-9][a-z0-9-_]{0,40}$/i;

function hostAllowed(url: string, hosts: string[] | undefined): boolean {
  if (!hosts?.length) return false;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return hosts.some((x) => {
      const y = x.trim().toLowerCase().replace(/^\*\./, '');
      return y && (h === y || h.endsWith(`.${y}`));
    });
  } catch {
    return false;
  }
}

export default defineServerPlugin<Settings>((ctx) => {
  const appsDir = path.join(ctx.dataDir, 'apps');
  const kvDir = path.join(ctx.dataDir, 'kv');
  const s = () => ctx.settings.get();

  // ---------------- embeddability check ----------------
  ctx.router.get(
    '/check',
    asyncHandler(async (req, res) => {
      const url = String(req.query.url ?? '');
      if (!/^https?:\/\//i.test(url)) return res.json({ ok: true, local: true });
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 8000);
      try {
        const r = await fetch(url, { redirect: 'follow', signal: ac.signal, headers: { 'user-agent': 'Mozilla/5.0 (MagicDash kiosk)', accept: 'text/html,*/*' } });
        const xfo = (r.headers.get('x-frame-options') ?? '').toLowerCase();
        const csp = r.headers.get('content-security-policy') ?? '';
        const fa = csp
          .split(';')
          .map((x) => x.trim())
          .find((x) => x.toLowerCase().startsWith('frame-ancestors'));
        let blocked = false;
        let reason = '';
        if (xfo.includes('deny') || xfo.includes('sameorigin')) {
          blocked = true;
          reason = `X-Frame-Options: ${xfo}`;
        } else if (fa) {
          const v = fa.slice('frame-ancestors'.length).trim();
          const self = ctx.publicUrl();
          const ok = v.includes('*') || (self && v.includes(new URL(self).origin));
          if (!ok) {
            blocked = true;
            reason = `Content-Security-Policy: ${fa}`;
          }
        }
        const html = r.headers.get('content-type')?.includes('text/html') ? await r.text() : '';
        const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
        res.json({ ok: r.ok, status: r.status, blocked, reason, title, finalUrl: r.url });
      } catch (e) {
        res.json({ ok: false, status: 0, blocked: false, reason: e instanceof Error ? e.message : String(e) });
      } finally {
        clearTimeout(t);
      }
    }),
  );

  // ---------------- SDK + sample app ----------------
  ctx.router.get('/sdk.js', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(HERE, 'sdk', 'magicdash-kiosk.js'));
  });
  ctx.router.use('/apps/sample', express.static(path.join(HERE, 'sample'), { index: 'index.html', maxAge: 0 }));

  // ---------------- hosted apps ----------------
  const listApps = async () => {
    await fs.mkdir(appsDir, { recursive: true });
    const names = (await fs.readdir(appsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    const out = [];
    for (const name of names) {
      const hasIndex = await fs
        .stat(path.join(appsDir, name, 'index.html'))
        .then(() => true)
        .catch(() => false);
      out.push({ name, url: `/api/plugins/${ctx.manifest.id}/apps/${name}/`, hasIndex });
    }
    return out;
  };
  ctx.router.get('/apps', asyncHandler(async (_req, res) => res.json(await listApps())));
  ctx.router.get(
    '/apps/options',
    asyncHandler(async (_req, res) => {
      const apps = await listApps();
      res.json([{ value: '', label: '— none (use the URL) —' }, { value: 'sample', label: 'Sample kiosk app (bundled)', description: 'Shows what the bridge can do' }, ...apps.map((a) => ({ value: a.name, label: a.name, description: a.hasIndex ? a.url : 'missing index.html' }))]);
    }),
  );
  ctx.router.post(
    '/apps',
    express.raw({ type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], limit: '50mb' }),
    asyncHandler(async (req, res) => {
      const name = String(req.query.name ?? '')
        .replace(/\.zip$/i, '')
        .replace(/[^a-z0-9-_]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
      if (!SAFE.test(name) || name === 'sample' || name === 'options') return res.status(400).json({ error: 'Give the app a simple name (letters, digits, dashes).' });
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Send the zip as the raw request body (Content-Type: application/zip).' });
      const zip = new AdmZip(req.body);
      const entries = zip.getEntries().filter((e) => !e.isDirectory && !e.entryName.includes('..') && !e.entryName.split('/').some((p) => p.startsWith('.') || p === '__MACOSX'));
      // If everything sits in one top-level folder, strip it.
      const tops = new Set(entries.map((e) => e.entryName.split('/')[0]));
      const strip = tops.size === 1 && entries.every((e) => e.entryName.includes('/')) ? `${[...tops][0]}/` : '';
      if (!entries.some((e) => e.entryName === `${strip}index.html`)) return res.status(400).json({ error: 'The zip needs an index.html at its root.' });
      const dest = path.join(appsDir, name);
      await fs.rm(dest, { recursive: true, force: true });
      for (const e of entries) {
        const rel = e.entryName.slice(strip.length);
        const full = path.join(dest, rel);
        if (!full.startsWith(dest)) continue;
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, e.getData());
      }
      ctx.log.info(`hosted app "${name}" installed (${entries.length} files)`);
      res.json({ ok: true, name, url: `/api/plugins/${ctx.manifest.id}/apps/${name}/`, files: entries.length });
    }),
  );
  ctx.router.delete(
    '/apps/:name',
    asyncHandler(async (req, res) => {
      const name = String(req.params.name);
      if (!SAFE.test(name)) return res.status(400).json({ error: 'Bad name' });
      await fs.rm(path.join(appsDir, name), { recursive: true, force: true });
      res.json({ ok: true });
    }),
  );
  ctx.router.use(
    '/apps/:name',
    (req, res, next) => {
      const name = String(req.params.name);
      if (!SAFE.test(name)) return res.status(404).end();
      express.static(path.join(appsDir, name), { index: 'index.html', maxAge: 0, fallthrough: true })(req, res, next);
    },
  );

  // ---------------- key/value store ----------------
  const kvFile = (app: string) => path.join(kvDir, `${app}.json`);
  const readKv = async (app: string): Promise<Record<string, unknown>> => JSON.parse(await fs.readFile(kvFile(app), 'utf8').catch(() => '{}'));
  const writeKv = async (app: string, data: Record<string, unknown>) => {
    await fs.mkdir(kvDir, { recursive: true });
    await fs.writeFile(kvFile(app), JSON.stringify(data));
  };
  const kvGuard = (app: string, res: express.Response) => {
    if (s().kvEnabled === false) {
      res.status(403).json({ error: 'The key/value store is disabled in the Web app plugin settings.' });
      return false;
    }
    if (!SAFE.test(app)) {
      res.status(400).json({ error: 'Bad app id' });
      return false;
    }
    return true;
  };
  ctx.router.get('/kv/:app', asyncHandler(async (req, res) => kvGuard(req.params.app, res) && res.json(await readKv(req.params.app))));
  ctx.router.get('/kv/:app/:key', asyncHandler(async (req, res) => kvGuard(req.params.app, res) && res.json({ value: (await readKv(req.params.app))[req.params.key] ?? null })));
  const setKv = asyncHandler(async (req: express.Request, res: express.Response) => {
      if (!kvGuard(req.params.app, res)) return;
      const data = await readKv(req.params.app);
      data[req.params.key] = (req.body as { value?: unknown })?.value ?? null;
      if (JSON.stringify(data).length > 256_000) return res.status(413).json({ error: 'Store is full (256 kB per app).' });
      await writeKv(req.params.app, data);
      res.json({ ok: true });
    });
  const delKv = asyncHandler(async (req: express.Request, res: express.Response) => {
      if (!kvGuard(req.params.app, res)) return;
      const data = await readKv(req.params.app);
      delete data[req.params.key];
      await writeKv(req.params.app, data);
      res.json({ ok: true });
    });
  ctx.router.put('/kv/:app/:key', setKv);
  ctx.router.post('/kv/:app/:key', setKv);
  ctx.router.delete('/kv/:app/:key', delKv);
  ctx.router.post('/kv/:app/:key/delete', delKv);

  // ---------------- fetch proxy ----------------
  ctx.router.all(
    '/fetch',
    asyncHandler(async (req, res) => {
      const url = String(req.query.url ?? '');
      if (!hostAllowed(url, s().proxyHosts)) return res.status(403).json({ error: 'Host not in the Web app plugin’s proxy allow-list.' });
      const method = req.method === 'POST' ? 'POST' : 'GET';
      const r = await fetch(url, { method, headers: { accept: 'application/json, text/*;q=0.8, */*;q=0.5', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) }, body: method === 'POST' ? JSON.stringify(req.body ?? {}) : undefined });
      res.status(r.status);
      res.setHeader('Content-Type', r.headers.get('content-type') ?? 'application/octet-stream');
      res.send(Buffer.from(await r.arrayBuffer()));
    }),
  );

  ctx.log.info('web-app ready');
});
