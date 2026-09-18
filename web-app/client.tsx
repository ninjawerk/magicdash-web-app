import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, ChevronLeft, Globe, Home, Loader2, Maximize2, Minimize2, MoreHorizontal, RotateCw, ShieldAlert, X } from 'lucide-react';
import { definePlugin, peek, publish, subscribe, type WidgetProps } from '../../src/sdk/client';
import manifest from './manifest';

interface Config {
  mode?: 'tile' | 'kiosk';
  exitHoldSec?: number;
  exitCorner?: 'tl' | 'tr' | 'bl' | 'br';
  url?: string;
  app?: string;
  pages?: string[];
  rotateSec?: number;
  scale?: number;
  refreshMinutes?: number;
  idleHomeSec?: number;
  background?: string;
  toolbar?: 'auto' | 'always' | 'never';
  toolbarPosition?: 'top' | 'bottom';
  toolbarButtons?: string[];
  toolbarSize?: 'compact' | 'touch';
  backStyle?: 'floating' | 'toolbar' | 'hidden';
  backAction?: 'smart' | 'home' | 'reload' | 'collapse';
  backLabel?: string;
  backIcon?: 'arrow' | 'chevron' | 'home' | 'x' | 'none';
  backPosition?: 'tl' | 'tr' | 'bl' | 'br';
  backShape?: 'pill' | 'circle' | 'square';
  backSize?: number;
  backColor?: 'accent' | 'glass' | 'dark' | 'light' | 'custom';
  backCustomColor?: string;
  backOnlyWhenAway?: boolean;
  expandOnLoad?: boolean;
  expandHoldsAttention?: boolean;
  allow?: string[];
  sandbox?: 'off' | 'standard' | 'strict';
  allowedHosts?: string[];
  bridge?: boolean;
  bridgeOrigins?: string[];
}

const APP_BASE = `/api/plugins/${manifest.id}/apps/`;
const SANDBOX: Record<string, string | undefined> = { off: undefined, standard: 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-popups-to-escape-sandbox', strict: 'allow-scripts allow-forms' };

function homeOf(c: Config): string {
  if (c.app) return `${APP_BASE}${c.app}/`;
  return (c.url ?? '').trim();
}
function absolute(url: string, base: string): string {
  try {
    return new URL(url, new URL(base, location.href)).href;
  } catch {
    return url;
  }
}
function hostAllowed(url: string, hosts: string[] | undefined): boolean {
  const list = (hosts ?? []).map((h) => h.trim().toLowerCase().replace(/^\*\./, '')).filter(Boolean);
  if (!list.length) return true;
  try {
    const u = new URL(url, location.href);
    if (u.origin === location.origin) return true;
    return list.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}
function themeSnapshot() {
  const cs = getComputedStyle(document.documentElement);
  const v = (k: string) => cs.getPropertyValue(k).trim();
  return { accent: v('--accent'), fg: v('--fg'), surface: v('--surface'), cool: v('--cool'), warm: v('--warm'), tileBg: v('--tile-bg'), tileRadius: v('--tile-radius'), fontSans: v('--font-sans'), fontMono: v('--font-mono'), dark: document.documentElement.dataset.dark !== '0' };
}
function prettyUrl(u: string): string {
  try {
    const x = new URL(u, location.href);
    if (x.pathname.startsWith(APP_BASE)) return `app: ${x.pathname.slice(APP_BASE.length).replace(/\/$/, '')}`;
    return (x.host + x.pathname + x.search).replace(/\/$/, '');
  } catch {
    return u;
  }
}

function WebAppWidget({ config, context, size, editMode, api, openSettings, setAlert, setBackground, attention, notify, locale, instanceId }: WidgetProps<Config>) {
  const home = useMemo(() => homeOf(config), [config.url, config.app]);
  const scale = Math.min(2, Math.max(0.25, config.scale ?? 1));
  const pages = useMemo(() => [home, ...(config.pages ?? []).map((p) => p.trim()).filter(Boolean)], [home, config.pages]);

  const [src, setSrc] = useState(home);
  const [nonce, setNonce] = useState(0);
  const kiosk = config.mode === 'kiosk';
  const [expandedState, setExpanded] = useState(!!config.expandOnLoad);
  // Kiosk takeover: always expanded, unless the exit gesture paused it for a moment.
  const [pausedUntil, setPausedUntil] = useState(0);
  const [pauseTick, setPauseTick] = useState(0);
  const paused = kiosk && pausedUntil > Date.now();
  const expanded = kiosk ? !paused : expandedState;
  useEffect(() => {
    if (!paused) return;
    const id = setInterval(() => setPauseTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [paused]);
  void pauseTick;
  const [loading, setLoading] = useState(true);
  const [toolbarOpen, setToolbarOpen] = useState(config.toolbar === 'always');
  const [href, setHref] = useState<string>(home); // best-known current location
  const [bridged, setBridged] = useState(false);
  const [check, setCheck] = useState<{ blocked?: boolean; reason?: string; ok?: boolean; status?: number; title?: string } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const stack = useRef<string[]>([home]);
  const depth = useRef(0); // same-origin navigations since home
  const subs = useRef(new Map<string, () => void>());
  const lastActivity = useRef(Date.now());
  const backReply = useRef<((handled: boolean) => void) | null>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number; visible: boolean }>({ x: 0, y: 0, w: 0, h: 0, visible: false });
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setToolbarHeight(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    setToolbarHeight(Math.round(el.getBoundingClientRect().height));
    return () => ro.disconnect();
  }, [editMode, home, expanded, config.toolbar]);

  // Reset when the home page changes.
  useEffect(() => {
    setSrc(home);
    stack.current = [home];
    depth.current = 0;
    setHref(home);
    setBridged(false);
    setLoading(true);
  }, [home]);

  const sameOrigin = useCallback((): Location | null => {
    try {
      const w = iframeRef.current?.contentWindow;
      const l = w?.location;
      return l && l.href && l.href !== 'about:blank' ? l : null;
    } catch {
      return null;
    }
  }, []);

  const post = useCallback((msg: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage({ magicdash: 1, ...msg }, '*');
  }, []);

  const touch = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  const load = useCallback(
    (url: string, pushStack = true) => {
      const abs = absolute(url, src || home);
      if (!hostAllowed(abs, config.allowedHosts)) {
        notify({ message: `Blocked navigation to ${prettyUrl(abs)} (not in this tile's allowed hosts).`, level: 'warn', durationSec: 5 });
        return false;
      }
      if (pushStack) stack.current = [...stack.current.slice(-30), abs];
      depth.current = 0;
      setBridged(false);
      setLoading(true);
      setHref(abs);
      setSrc(abs);
      setNonce((n) => n + 1);
      return true;
    },
    [src, home, config.allowedHosts, notify],
  );
  const goHome = useCallback(() => {
    stack.current = [home];
    load(home, false);
  }, [home, load]);
  const reload = useCallback(() => {
    setLoading(true);
    setBridged(false);
    setNonce((n) => n + 1);
  }, []);
  const collapse = useCallback(() => {
    if (!kiosk) setExpanded(false);
  }, [kiosk]);

  const goBack = useCallback(() => {
    touch();
    const action = config.backAction ?? 'smart';
    if (action === 'reload') return reload();
    if (action === 'home') return goHome();
    if (action === 'collapse') return expanded ? collapse() : goHome();
    // smart
    if (sameOrigin() && depth.current > 0) {
      depth.current -= 1;
      iframeRef.current?.contentWindow?.history.back();
      return;
    }
    const fallback = () => {
      if (stack.current.length > 1) {
        stack.current = stack.current.slice(0, -1);
        load(stack.current[stack.current.length - 1], false);
      } else if (expanded && config.backOnlyWhenAway !== false) collapse();
      else goHome();
    };
    if (bridged) {
      // Ask the page first; it answers with backHandled.
      const t = setTimeout(() => {
        backReply.current = null;
        fallback();
      }, 400);
      backReply.current = (handled) => {
        clearTimeout(t);
        backReply.current = null;
        if (!handled) fallback();
      };
      post({ event: 'back' });
      return;
    }
    fallback();
  }, [config.backAction, config.backOnlyWhenAway, expanded, bridged, sameOrigin, reload, goHome, collapse, load, post, touch]);

  const goForward = useCallback(() => {
    if (sameOrigin()) {
      depth.current += 1;
      iframeRef.current?.contentWindow?.history.forward();
    }
  }, [sameOrigin]);

  // --- iframe load: track same-origin location, reset bridge state.
  const onLoad = useCallback(() => {
    setLoading(false);
    const l = sameOrigin();
    if (l) {
      setHref(l.href);
      const isHome = absolute(home, location.href).replace(/index\.html$/, '') === l.href.replace(/index\.html$/, '');
      if (isHome) depth.current = 0;
    }
  }, [sameOrigin, home]);
  // Same-origin pages navigate without a React-visible event; poll the location while visible.
  useEffect(() => {
    if (editMode) return;
    let last = '';
    const id = setInterval(() => {
      const l = sameOrigin();
      if (l && l.href !== last) {
        if (last && l.href !== absolute(home, location.href)) depth.current += 1;
        last = l.href;
        setHref(l.href);
      }
    }, 500);
    return () => clearInterval(id);
  }, [editMode, sameOrigin, home, nonce]);

  // --- Kiosk bridge -------------------------------------------------------------------------------------
  // In full screen the page gets the real viewport size, not the tile's.
  const frameSize = useMemo(() => (expanded ? { ...size, width: window.innerWidth, height: window.innerHeight } : size), [expanded, size]);
  const ready = useCallback(() => ({ context, theme: themeSnapshot(), size: frameSize, editMode, locale, expanded, instanceId }), [context, frameSize, editMode, locale, expanded, instanceId]);
  useEffect(() => {
    if (config.bridge === false || editMode) return;
    const originOk = (origin: string) => {
      if (origin === 'null') return true; // sandboxed without allow-same-origin
      try {
        if (origin === new URL(src, location.href).origin) return true;
      } catch {
        /* ignore */
      }
      return (config.bridgeOrigins ?? []).some((o) => o.trim().replace(/\/$/, '') === origin);
    };
    const onMessage = async (e: MessageEvent) => {
      const d = e.data as { magicdash?: number; id?: number; type?: string; payload?: Record<string, unknown> };
      if (!d || d.magicdash !== 1 || !d.type) return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (!originOk(e.origin)) return;
      const reply = (ok: boolean, resultOrError: unknown) => {
        if (d.id) (e.source as Window | null)?.postMessage({ magicdash: 1, id: d.id, ok, ...(ok ? { result: resultOrError } : { error: String(resultOrError) }) }, '*');
      };
      const p = d.payload ?? {};
      try {
        switch (d.type) {
          case 'hello':
            setBridged(true);
            if (typeof p.href === 'string') setHref(p.href);
            post({ event: 'ready', payload: ready() });
            return;
          case 'activity':
            touch();
            return;
          case 'backHandled':
            backReply.current?.(!!p.handled);
            return;
          case 'notify':
            notify({ message: String(p.message ?? ''), title: p.title as string | undefined, level: (p.level as 'info') ?? 'info', durationSec: typeof p.durationSec === 'number' ? p.durationSec : undefined });
            return reply(true, { ok: true });
          case 'setAlert':
            setAlert(!!p.on);
            return reply(true, { ok: true });
          case 'setBackground':
            setBackground((p.css as string) || undefined);
            return reply(true, { ok: true });
          case 'requestAttention':
            return reply(true, { granted: attention.request((p.reason as string) ?? 'web app'), busy: attention.busy });
          case 'releaseAttention':
            attention.release();
            return reply(true, { ok: true });
          case 'showScreen': {
            const r = await fetch('/api/screens/show', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ screenId: p.screen }) });
            return reply(r.ok, r.ok ? await r.json() : (await r.json().catch(() => ({ error: r.statusText }))).error);
          }
          case 'expand':
            setExpanded(true);
            return reply(true, { expanded: true });
          case 'collapse':
            if (kiosk) return reply(false, 'This tile runs in kiosk takeover mode; it cannot collapse.');
            setExpanded(false);
            return reply(true, { expanded: false });
          case 'navigate':
            return reply(load(String(p.url ?? '')), { ok: true });
          case 'back':
            goBack();
            return reply(true, { ok: true });
          case 'home':
            goHome();
            return reply(true, { ok: true });
          case 'publish':
            publish(String(p.topic), p.payload);
            return reply(true, { ok: true });
          case 'getTopic':
            return reply(true, peek(String(p.topic)) ?? null);
          case 'subscribe': {
            const topic = String(p.topic);
            if (!subs.current.has(topic)) {
              subs.current.set(
                topic,
                subscribe(topic, (payload) => post({ event: 'topic', payload: { topic, payload } })),
              );
              const cur = peek(topic);
              if (cur !== undefined) post({ event: 'topic', payload: { topic, payload: cur } });
            }
            return reply(true, { ok: true });
          }
          case 'unsubscribe':
            subs.current.get(String(p.topic))?.();
            subs.current.delete(String(p.topic));
            return reply(true, { ok: true });
          case 'openSettings':
            openSettings();
            return reply(true, { ok: true });
          case 'kv': {
            const app = (config.app || new URL(src, location.href).hostname.replace(/[^a-z0-9-_]/gi, '-')).slice(0, 40);
            const key = encodeURIComponent(String(p.key ?? ''));
            if (p.op === 'all') return reply(true, await api.get(`/kv/${app}`));
            if (p.op === 'get') return reply(true, ((await api.get(`/kv/${app}/${key}`)) as { value: unknown }).value);
            if (p.op === 'set') {
              await api.post(`/kv/${app}/${key}`, { value: p.value });
              return reply(true, { ok: true });
            }
            if (p.op === 'delete') {
              await api.post(`/kv/${app}/${key}/delete`);
              return reply(true, { ok: true });
            }
            return reply(false, 'unknown kv op');
          }
          case 'fetch': {
            const url = `/api/plugins/${manifest.id}/fetch?url=${encodeURIComponent(String(p.url ?? ''))}`;
            const r = await fetch(url, { method: p.method === 'POST' ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: p.method === 'POST' ? JSON.stringify(p.body ?? {}) : undefined });
            const text = await r.text();
            let body: unknown = text;
            try {
              body = JSON.parse(text);
            } catch {
              /* keep text */
            }
            return reply(r.ok, r.ok ? { status: r.status, body } : (body as { error?: string })?.error ?? `HTTP ${r.status}`);
          }
          default:
            return reply(false, `Unknown request "${d.type}"`);
        }
      } catch (err) {
        reply(false, err instanceof Error ? err.message : String(err));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [config.bridge, config.bridgeOrigins, config.app, editMode, src, ready, post, touch, notify, setAlert, setBackground, attention, load, goBack, goHome, openSettings, api, kiosk]);
  // Push changes to a connected page.
  useEffect(() => {
    if (bridged) post({ event: 'context', payload: context });
  }, [bridged, context, post]);
  useEffect(() => {
    if (bridged) post({ event: 'size', payload: frameSize });
  }, [bridged, frameSize, post]);
  useEffect(() => {
    if (bridged) post({ event: 'editMode', payload: editMode });
  }, [bridged, editMode, post]);
  useEffect(() => {
    if (bridged) post({ event: 'expanded', payload: expanded });
  }, [bridged, expanded, post]);
  useEffect(() => {
    if (!bridged) return;
    const mo = new MutationObserver(() => post({ event: 'theme', payload: themeSnapshot() }));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-dark'] });
    return () => mo.disconnect();
  }, [bridged, post]);
  useEffect(() => () => subs.current.forEach((u) => u()), []);

  // --- Attention while expanded --------------------------------------------------------------------------
  useEffect(() => {
    if (editMode) return;
    if (kiosk) return;
    if (expanded && config.expandHoldsAttention !== false) attention.request('web app in full screen');
    else if (!expanded && attention.held) attention.release();
  }, [expanded, editMode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!expanded || kiosk) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && collapse();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, collapse, kiosk]);

  // --- Idle, rotation, refresh ----------------------------------------------------------------------------
  useEffect(() => {
    const onBlur = () => {
      if (document.activeElement === iframeRef.current) touch();
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [touch]);
  useEffect(() => {
    const idle = config.idleHomeSec ?? 0;
    if (!idle || editMode) return;
    const id = setInterval(() => {
      if (Date.now() - lastActivity.current < idle * 1000) return;
      if (expanded && !config.expandOnLoad && !kiosk) setExpanded(false);
      if (src !== home || depth.current > 0) goHome();
      lastActivity.current = Date.now();
    }, 1000);
    return () => clearInterval(id);
  }, [config.idleHomeSec, config.expandOnLoad, editMode, expanded, src, home, goHome, kiosk]);
  useEffect(() => {
    if (pages.length < 2 || editMode || expanded) return;
    let i = pages.indexOf(src);
    const id = setInterval(() => {
      if (Date.now() - lastActivity.current < (config.rotateSec ?? 30) * 1000) return;
      i = (i + 1) % pages.length;
      load(pages[i], false);
    }, (config.rotateSec ?? 30) * 1000);
    return () => clearInterval(id);
  }, [pages, config.rotateSec, editMode, expanded, src, load]);
  useEffect(() => {
    const m = config.refreshMinutes ?? 0;
    if (!m || editMode) return;
    const id = setInterval(reload, m * 60_000);
    return () => clearInterval(id);
  }, [config.refreshMinutes, editMode, reload]);

  // --- Track the tile's on-screen rectangle (the frame lives in a body portal so full screen never reloads it).
  useEffect(() => {
    if (editMode) return;
    let raf = 0;
    let last = '';
    const tick = () => {
      const el = hostRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const visible = r.width > 0 && r.height > 0 && (typeof el.checkVisibility === 'function' ? el.checkVisibility({ visibilityProperty: true } as never) : true);
        const key = `${r.x}|${r.y}|${r.width}|${r.height}|${visible}`;
        if (key !== last) {
          last = key;
          setRect({ x: r.x, y: r.y, w: r.width, h: r.height, visible });
        }
      }
      raf = window.setTimeout(tick, 120) as unknown as number;
    };
    tick();
    return () => clearTimeout(raf);
  }, [editMode]);

  // --- Embeddability check while editing.
  useEffect(() => {
    if (!editMode || !home) return setCheck(null);
    api
      .get<typeof check>('/check', { url: home })
      .then(setCheck)
      .catch(() => setCheck(null));
  }, [editMode, home, api]);

  // --- Toolbar auto-hide
  const toolbarMode: 'auto' | 'always' | 'never' = kiosk ? 'never' : (config.toolbar ?? 'auto');
  const hideTimer = useRef<number | undefined>(undefined);
  const showToolbar = useCallback(() => {
    if (toolbarMode !== 'auto') return;
    setToolbarOpen(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setToolbarOpen(false), 4000);
  }, [toolbarMode]);
  useEffect(() => setToolbarOpen(toolbarMode === 'always'), [toolbarMode]);

  if (!home) {
    return (
      <div className="flex h-full cursor-pointer flex-col items-center justify-center gap-2 p-4 text-center text-white/55" onClick={editMode ? openSettings : undefined}>
        <Globe className="text-white/40" />
        <p className="text-sm">Set a page URL or pick a hosted app in this tile's settings.</p>
      </div>
    );
  }

  // Edit mode: a static card (no live frame, so drag/resize stays responsive).
  if (editMode) {
    return (
      <div className="flex h-full flex-col justify-center gap-1.5 p-4 text-sm">
        <div className="flex items-center gap-2 text-white/80">
          <Globe size={16} className="shrink-0 text-[var(--accent)]" />
          <span className="truncate font-medium">{check?.title || prettyUrl(home)}</span>
        </div>
        <div className="truncate font-mono text-[11px] text-white/45">{home}</div>
        {check?.blocked && (
          <div className="mt-1 flex items-start gap-2 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-200">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            <span>
              This site refuses to be embedded ({check.reason}). It will show a blank frame. Host a copy as an app, or pick a page that allows framing.
            </span>
          </div>
        )}
        {check && !check.blocked && check.ok === false && (check.status ?? 0) > 0 && <div className="text-xs text-[var(--warm)]">The page answered HTTP {check.status}.</div>}
        {pages.length > 1 && <div className="text-xs text-white/45">Rotates through {pages.length} pages every {config.rotateSec ?? 30}s.</div>}
        {kiosk && (
          <div className="text-xs text-[var(--warm)]">
            Kiosk takeover: covers the whole screen outside edit mode.{(config.exitHoldSec ?? 3) > 0 ? ` Hold the ${{ tl: 'top-left', tr: 'top-right', bl: 'bottom-left', br: 'bottom-right' }[config.exitCorner ?? 'tl']} corner for ${config.exitHoldSec ?? 3}s to pause it.` : ' No exit gesture: leave via the admin or press E.'}
          </div>
        )}
        <div className="text-xs text-white/35">Live preview when you leave edit mode.</div>
      </div>
    );
  }

  const allow = (config.allow ?? []).join('; ');
  const sandbox = SANDBOX[config.sandbox ?? 'off'];
  const away = href.replace(/\/(index\.html)?$/, '') !== absolute(home, location.href).replace(/\/(index\.html)?$/, '') || depth.current > 0 || stack.current.length > 1;
  const showBackFloating = !kiosk && config.backStyle !== 'hidden' && (config.backStyle ?? 'floating') === 'floating' && (config.backOnlyWhenAway === false || away || expanded);
  const buttons = new Set(config.toolbarButtons ?? ['back', 'home', 'reload', 'url', 'expand']);
  const touchSize = (config.toolbarSize ?? 'touch') === 'touch';
  const btn = 'flex shrink-0 items-center justify-center rounded-lg text-white/85 hover:bg-white/15 active:bg-white/25';
  const btnStyle: React.CSSProperties = { height: touchSize ? 44 : 32, width: touchSize ? 44 : 32 };
  const iconSize = touchSize ? 20 : 16;
  const radius = expanded ? 0 : 'var(--tile-radius)';
  const frameStyle: React.CSSProperties = expanded
    ? { position: 'fixed', inset: 0, zIndex: 75 } // under the dim layer (80), toasts (90) and display-off (95)
    : { position: 'fixed', left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: 20, display: rect.visible ? undefined : 'none', borderRadius: radius, overflow: 'hidden' };
  // In full screen the toolbar is docked (always visible, page below it) and carries the styled Back button.
  const docked = expanded && toolbarMode !== 'never';
  const toolbarVisible = docked || toolbarOpen;
  // Keep the floating button clear of the toolbar when both sit on the same edge.
  const toolbarEdge = config.toolbarPosition === 'bottom' ? 'b' : 't';
  const backEdge = (config.backPosition ?? 'bl')[0];
  const backOffset = toolbarMode !== 'never' && toolbarVisible && backEdge === toolbarEdge ? toolbarHeight : 0;
  const back = <BackButton config={config} onClick={goBack} label={config.backLabel ?? 'Back'} offset={backOffset} />;
  const pageInset: React.CSSProperties = docked ? (config.toolbarPosition === 'bottom' ? { bottom: toolbarHeight } : { top: toolbarHeight }) : {};

  return (
    <>
      <div ref={hostRef} className="h-full w-full" style={{ background: config.background ?? '#000' }} />
      {paused &&
        createPortal(
          <div className="surface-glass fixed left-1/2 top-4 z-[76] flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/15 px-4 py-2 text-sm shadow-xl">
            <span className="text-white/80">Kiosk paused · resumes in {Math.max(0, Math.ceil((pausedUntil - Date.now()) / 1000))}s</span>
            <button type="button" className="btn btn-primary px-3 py-1 text-xs" onClick={() => setPausedUntil(0)}>
              Resume now
            </button>
          </div>,
          document.body,
        )}
      {createPortal(
        <div style={{ ...frameStyle, background: config.background ?? '#000' }} onMouseEnter={showToolbar} onPointerDownCapture={touch} onMouseMoveCapture={touch} className={expanded ? '' : 'transition-none'}>
          <div className="absolute inset-0" style={{ ...pageInset, ...(scale === 1 ? {} : { width: `${100 / scale}%`, height: `calc(${100 / scale}% - ${(docked ? toolbarHeight : 0) / scale}px)`, transform: `scale(${scale})`, transformOrigin: '0 0' }) }}>
            <iframe
              key={nonce}
              ref={iframeRef}
              src={src}
              title={prettyUrl(home)}
              onLoad={onLoad}
              allow={allow}
              sandbox={sandbox}
              referrerPolicy="strict-origin-when-cross-origin"
              className="h-full w-full border-0 bg-transparent"
              onMouseOver={showToolbar}
            />
          </div>
          {loading && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <Loader2 className="animate-spin text-white/50" />
            </div>
          )}
          {toolbarMode !== 'never' && (
            <div
              ref={toolbarRef}
              className={`surface-glass absolute inset-x-0 flex items-center gap-1 px-2 py-1.5 text-sm shadow-lg ${config.toolbarPosition === 'bottom' ? 'bottom-0' : 'top-0'}`}
              style={{ transition: 'transform 200ms ease', transform: toolbarVisible ? 'translateY(0)' : config.toolbarPosition === 'bottom' ? 'translateY(100%)' : 'translateY(-100%)' }}
              onMouseEnter={showToolbar}
              onPointerDown={showToolbar}
            >
              {docked && config.backStyle !== 'hidden' && <BackButton config={config} onClick={goBack} label={config.backLabel ?? 'Back'} inline height={touchSize ? 44 : 32} />}
              {buttons.has('back') && !(docked && config.backStyle !== 'hidden') && (
                <button className={btn} style={btnStyle} onClick={goBack} title="Back" type="button">
                  <ArrowLeft size={iconSize} />
                </button>
              )}
              {buttons.has('forward') && sameOrigin() && (
                <button className={btn} style={btnStyle} onClick={goForward} title="Forward" type="button">
                  <ArrowRight size={iconSize} />
                </button>
              )}
              {buttons.has('home') && (
                <button className={btn} style={btnStyle} onClick={goHome} title="Home" type="button">
                  <Home size={iconSize} />
                </button>
              )}
              {buttons.has('reload') && (
                <button className={btn} style={btnStyle} onClick={reload} title="Reload" type="button">
                  <RotateCw size={iconSize} />
                </button>
              )}
              {buttons.has('url') && <div className="min-w-0 flex-1 truncate rounded-lg bg-white/8 px-3 py-1.5 font-mono text-[11px] text-white/60">{prettyUrl(href)}</div>}
              {!buttons.has('url') && <div className="flex-1" />}
              {buttons.has('expand') && (
                <button className={btn} style={btnStyle} onClick={() => setExpanded((v) => !v)} title={expanded ? 'Leave full screen' : 'Full screen'} type="button">
                  {expanded ? <Minimize2 size={iconSize} /> : <Maximize2 size={iconSize} />}
                </button>
              )}
              {expanded && !buttons.has('expand') && (
                <button className={btn} style={btnStyle} onClick={collapse} title="Leave full screen" type="button">
                  <X size={iconSize} />
                </button>
              )}
            </div>
          )}
          {toolbarMode === 'auto' && !toolbarVisible && (
            <button
              type="button"
              aria-label="Show toolbar"
              onClick={showToolbar}
              className={`absolute ${config.toolbarPosition === 'bottom' ? 'bottom-1' : 'top-1'} left-1/2 -translate-x-1/2 rounded-full bg-black/35 px-2 py-0.5 text-white/60 backdrop-blur-sm hover:bg-black/55`}
            >
              <MoreHorizontal size={14} />
            </button>
          )}
          {showBackFloating && !docked && back}
          {kiosk && expanded && (config.exitHoldSec ?? 3) > 0 && <ExitHotspot corner={config.exitCorner ?? 'tl'} holdMs={(config.exitHoldSec ?? 3) * 1000} onExit={() => setPausedUntil(Date.now() + 60_000)} />}
        </div>,
        document.body,
      )}
    </>
  );
}

/** An invisible press-and-hold target in a corner; completing the hold fires onExit. */
function ExitHotspot({ corner, holdMs, onExit }: { corner: 'tl' | 'tr' | 'bl' | 'br'; holdMs: number; onExit: () => void }) {
  const timer = useRef<number | undefined>(undefined);
  const [holding, setHolding] = useState(false);
  const start = () => {
    setHolding(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setHolding(false);
      onExit();
    }, holdMs);
  };
  const stop = () => {
    setHolding(false);
    window.clearTimeout(timer.current);
  };
  const pos = { tl: 'left-0 top-0', tr: 'right-0 top-0', bl: 'left-0 bottom-0', br: 'right-0 bottom-0' }[corner];
  return (
    <div
      className={`absolute ${pos} z-20 h-14 w-14 select-none`}
      style={{ background: holding ? 'radial-gradient(circle at center, rgba(255,255,255,0.25), transparent 70%)' : 'transparent', transition: 'background 300ms', touchAction: 'none' }}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onContextMenu={(e) => e.preventDefault()}
      aria-hidden
    />
  );
}

function BackButton({ config, onClick, label, offset = 0, inline = false, height }: { config: Config; onClick: () => void; label: string; offset?: number; inline?: boolean; height?: number }) {
  const sizePx = inline ? (height ?? 40) : (config.backSize ?? 48);
  const icon = config.backIcon ?? 'arrow';
  const Icon = icon === 'arrow' ? ArrowLeft : icon === 'chevron' ? ChevronLeft : icon === 'home' ? Home : icon === 'x' ? X : null;
  const pos = config.backPosition ?? 'bl';
  const posCls = { tl: 'left-3', tr: 'right-3', bl: 'left-3', br: 'right-3' }[pos];
  const edge: React.CSSProperties = pos.startsWith('t') ? { top: 12 + offset } : { bottom: 12 + offset };
  const shape = config.backShape ?? 'pill';
  const color = config.backColor ?? 'accent';
  const style: React.CSSProperties = {
    height: sizePx,
    minWidth: sizePx,
    padding: label && shape !== 'circle' ? `0 ${Math.round(sizePx * 0.4)}px` : 0,
    fontSize: Math.max(12, Math.round(sizePx * 0.32)),
    borderRadius: shape === 'circle' ? 999 : shape === 'pill' ? 999 : Math.round(sizePx * 0.25),
    ...(color === 'accent' ? { background: 'var(--accent)', color: '#0b0f17' } : color === 'glass' ? { background: 'rgba(20,20,25,0.45)', color: '#fff', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.2)' } : color === 'dark' ? { background: '#111', color: '#fff' } : color === 'light' ? { background: '#fff', color: '#111' } : { background: config.backCustomColor ?? '#ff5c5c', color: '#fff' }),
    boxShadow: '0 8px 24px -8px rgba(0,0,0,0.6)',
    transition: 'top 200ms ease, bottom 200ms ease, transform 100ms ease',
    ...edge,
  };
  if (inline) {
    const { transition, ...rest } = style;
    void transition;
    delete (rest as Record<string, unknown>).top;
    delete (rest as Record<string, unknown>).bottom;
    return (
      <button type="button" onClick={onClick} className="mr-1 flex shrink-0 items-center justify-center gap-2 font-semibold select-none active:scale-95" style={{ ...rest, boxShadow: 'none' }} aria-label={label || 'Back'}>
        {Icon && <Icon size={Math.round(sizePx * 0.45)} strokeWidth={2.5} />}
        {label && shape !== 'circle' && <span>{label}</span>}
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} className={`absolute ${posCls} z-10 flex items-center justify-center gap-2 font-semibold select-none active:scale-95`} style={style} aria-label={label || 'Back'}>
      {Icon && <Icon size={Math.round(sizePx * 0.45)} strokeWidth={2.5} />}
      {label && shape !== 'circle' && <span>{label}</span>}
    </button>
  );
}

export default definePlugin<Config>({ manifest, Widget: WebAppWidget });
