/**
 * core.js 鈥?shared browser-bridge logic for text-browser-agent.
 *
 * Exposes `prepareEnv()` to read configuration and `createHelpers()` to build
 * the agent-facing API. Used by both index.js (CLI) and mcp-server.js (MCP).
 */
import { createRequire } from 'node:module';
import { join, resolve, isAbsolute, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');

// === Config ================================================================
export const config = {
  chromePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  dataDir: process.env.EGO_DATA_DIR || join(tmpdir(), 'text-browser-agent-data'),
  shotDir: process.env.EGO_SHOT_DIR || join(tmpdir(), 'text-browser-agent-shots'),
  headlessDefault: process.env.EGO_HEADLESS === '1',
};

export function prepareEnv() {
  // Re-read env in case it changed between module load and call (defensive).
  config.chromePath = process.env.CHROME_PATH || config.chromePath;
  config.dataDir = process.env.EGO_DATA_DIR || config.dataDir;
  config.shotDir = process.env.EGO_SHOT_DIR || config.shotDir;
  config.headlessDefault = process.env.EGO_HEADLESS === '1';
}

function log(...args) {
  if (process.env.EGO_DEBUG) console.error('[text-browser-agent]', ...args);
}

// === Security policy =======================================================
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);
const ALLOWED_CDP = new Set([
  'Page.enable', 'Page.getLayoutMetrics', 'Page.getFrameTree',
  'Page.getNavigationHistory', 'Page.captureScreenshot',
  'Runtime.evaluate', 'Runtime.getProperties',
  'DOM.getDocument', 'DOM.querySelector', 'DOM.querySelectorAll',
  'DOM.getOuterHTML', 'DOM.getBoxModel', 'DOM.resolveNode',
  'Accessibility.getFullAXTree', 'Accessibility.getPartialAXTree',
  'Network.getResponseBody', 'Network.getCookies', 'Network.getRequestPostData',
  'Emulation.setDeviceMetricsOverride', 'Emulation.clearDeviceMetricsOverride',
  'Input.dispatchKeyEvent', 'Input.dispatchMouseEvent',
  'Target.getTargets', 'Target.activateTarget', 'Target.closeTarget',
  'CSS.getComputedStyleForNode', 'CSS.getStyleSheetText',
]);
const BLOCKED_CDP = new Set([
  'Browser.setDownloadBehavior', 'Browser.grantPermissions',
  'Page.setDownloadBehavior', 'Page.navigateToHistoryEntry',
  'Page.setWebLifecycleState', 'Page.handleJavaScriptDialog',
  'Network.setCookie', 'Network.setCookies', 'Network.clearBrowserCookies',
  'Network.setExtraHTTPHeaders', 'Network.setRequestInterception',
  'Fetch.enable', 'Fetch.continueRequest', 'Fetch.fulfillRequest',
  'Runtime.addBinding', 'Runtime.setCustomObjectFormatterEnabled',
  'Debugger.enable', 'Debugger.evaluateOnCallFrame',
  'Profiler.enable', 'HeapProfiler.enable',
  'SystemInfo.getProcessInfo', 'SystemInfo.getInfo',
  'Browser.getVersion', 'Browser.getBrowserCommandLine',
  'Browser.close', 'Browser.setPermission',
]);

function isSafeUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return false;
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (!ALLOWED_SCHEMES.has(u.protocol)) return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return false;
  if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^169\.254\./.test(host)) return false;
  return true;
}

function isSafeCdp(method) {
  if (typeof method !== 'string') return false;
  if (BLOCKED_CDP.has(method)) return false;
  return ALLOWED_CDP.has(method);
}

function safeShotPath(p) {
  const root = normalize(config.shotDir);
  if (!p) return join(root, 'ego-shot-' + Date.now() + '.png');
  // Relative paths resolve inside the sandboxed shot dir; absolute paths must
  // also live inside it. This keeps the sandbox while allowing `rel.png`.
  const abs = isAbsolute(p) ? p : resolve(root, p);
  const norm = normalize(abs);
  if (!norm.toLowerCase().startsWith(root.toLowerCase() + '\\') && norm.toLowerCase() !== root.toLowerCase()) {
    throw new Error('Screenshot path outside allowed directory: ' + config.shotDir);
  }
  return norm;
}

// === State ================================================================
let browser = null;
let page = null;
let cdpSession = null;
let headless = config.headlessDefault;

const taskSpaces = new Map();
let taskSeq = 0;

// === Task space persistence ===============================================
function tasksFile() { return join(config.dataDir, 'tasks.json'); }

async function loadTaskSpaces() {
  try {
    const { readFile } = require('node:fs/promises');
    const raw = await readFile(tasksFile(), 'utf-8');
    const arr = JSON.parse(raw);
    for (const t of arr) {
      taskSpaces.set(t.id, t);
      if (typeof t.id === 'number' && t.id > taskSeq) taskSeq = t.id;
    }
  } catch { /* no persisted tasks yet */ }
}

async function saveTaskSpaces() {
  try {
    const { writeFile } = require('node:fs/promises');
    await mkdir(config.dataDir, { recursive: true });
    await writeFile(tasksFile(), JSON.stringify([...taskSpaces.values()], null, 2), 'utf-8');
  } catch (e) { log('save tasks failed:', e.message); }
}

// === Launch ================================================================
// Kill any orphaned Chrome from a previous (crashed) run that still holds the
// data-dir lock. Without this, a SIGKILL'd run leaves a zombie Chrome that
// blocks every subsequent launch.
function killOrphanChrome() {
  try {
    const { execSync } = require('node:child_process');
    const dataDir = config.dataDir;
    // Windows: use tasklist to find chrome.exe processes whose command line
    // references our data dir, then kill them. (tasklist/taskkill are more
    // future-proof than the deprecated wmic.)
    const out = execSync(
      'tasklist /FI "IMAGENAME eq chrome.exe" /FO CSV /NH',
      { encoding: 'utf8', windowsHide: true, timeout: 10000 }
    );
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/"chrome\.exe","(\d+)"/);
      if (m) pids.add(m[1]);
    }
    if (!pids.size) return;
    // Verify each pid's command line references our data dir before killing.
    const wmicOut = execSync(
      'wmic process where "name=\'chrome.exe\'" get ProcessId,CommandLine /format:csv',
      { encoding: 'utf8', windowsHide: true, timeout: 10000 }
    );
    const toKill = new Set();
    for (const line of wmicOut.split(/\r?\n/)) {
      if (!line.includes(dataDir)) continue;
      const m = line.match(/(\d+)\s*$/);
      if (m && pids.has(m[1])) toKill.add(m[1]);
    }
    for (const pid of toKill) {
      try { process.kill(Number(pid), 'SIGKILL'); } catch {}
    }
    if (toKill.size) log('killed orphan Chrome pids:', [...toKill].join(','));
  } catch (e) {
    log('orphan cleanup skipped:', e.message);
  }
}

export async function launchChrome() {
  if (browser) return;
  killOrphanChrome();
  log('Launching Chrome:', config.chromePath, 'headless=', headless);
  await mkdir(config.dataDir, { recursive: true });
  await mkdir(config.shotDir, { recursive: true });

  browser = await puppeteer.launch({
    executablePath: config.chromePath,
    headless,
    userDataDir: config.dataDir,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
      '--disable-sync',
      '--disable-dev-shm-usage',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const pages = await browser.pages();
  page = pages[0] || await browser.newPage();
  cdpSession = await page.createCDPSession();
  await cdpSession.send('Page.enable');
  log('Chrome launched, pid:', browser.process().pid);
}

// === AX tree 鈫?text =======================================================
function buildSnapshotLines(axNodes) {
  const lines = [];
  const seen = new Set();
  function walk(node, depth) {
    if (!node || !node.role) return;
    const role = node.role.value || '';
    const name = node.name?.value || '';
    const backendNodeId = node.backendDOMNodeId;
    if (node.ignored || (!role && !name)) {
      if (node.children) for (const child of node.children) walk(child, depth);
      return;
    }
    if (backendNodeId && !seen.has(backendNodeId)) {
      seen.add(backendNodeId);
      const indent = '  '.repeat(depth);
      const label = name ? ' "' + name + '"' : '';
      lines.push(indent + '[' + role + ']' + label + ' [ref=' + backendNodeId + ']');
    }
    if (node.children) {
      for (const child of node.children) walk(child, depth + 1);
    }
  }
  for (const node of axNodes) walk(node, 0);
  return lines;
}

// === Helpers =============================================================
export function createHelpers() {
  const helpers = {

    cliLog: (...args) => console.log(...args),

    help: (name) => {
      const docs = {
        cliLog: 'cliLog(value) - prints to stdout',
        click: 'click(selector, options?) - click element by CSS/xpath/@N/coordinates',
        fillInput: 'fillInput(selector, text) - type text into input',
        snapshotText: 'snapshotText(options?) - return page AX tree as text',
        js: 'js(string) - evaluate JS in page context',
        cdp: 'cdp(method, params?) - raw CDP command (allowlisted)',
        captureScreenshot: 'captureScreenshot(options?) - take screenshot, returns path',
        typeText: 'typeText(text, options?) - type keyboard text',
        pressKey: 'pressKey(key) - press a keyboard key',
        pageInfo: 'pageInfo() - current page URL, title, viewport',
        openOrReuseTab: 'openOrReuseTab(url, options?) - open or reuse a tab',
        listTabs: 'listTabs() - list open tabs',
        switchTab: 'switchTab(targetId) - switch to a tab',
        closeTab: 'closeTab(targetId) - close a tab',
        gotoAndWait: 'gotoAndWait(url, options?) - navigate and wait',
        useOrCreateTaskSpace: 'useOrCreateTaskSpace(name) - create/reuse a task space',
        listTaskSpaces: 'listTaskSpaces() - list task spaces',
        newTaskSpace: 'newTaskSpace(name) - create a new task space',
        completeTaskSpace: 'completeTaskSpace(name) - mark a task space done',
        handOffTaskSpace: 'handOffTaskSpace(name) - hand a task space to a human',
        serverFetch: 'serverFetch(url, options?) - fetch from Node (http/https only)',
        browserFetch: 'browserFetch(url) - fetch from page context (http/https only)',
      };
      if (name) return docs[name] || 'Unknown helper: ' + name;
      return Object.values(docs).join('\n');
    },

    // --- Task spaces ---
    useOrCreateTaskSpace: async (name) => {
      const key = name || 'default';
      for (const t of taskSpaces.values()) {
        if (t.name === key) { t.updatedAt = Date.now(); return t; }
      }
      const t = { id: ++taskSeq, name: key, ownership: 'agent', status: 'active', createdAt: Date.now(), updatedAt: Date.now() };
      taskSpaces.set(t.id, t);
      await saveTaskSpaces();
      return t;
    },
    listTaskSpaces: async () => [...taskSpaces.values()],
    newTaskSpace: async (name) => {
      const id = ++taskSeq;
      const key = name || ('task-' + id);
      const t = { id, name: key, ownership: 'agent', status: 'active', createdAt: Date.now(), updatedAt: Date.now() };
      taskSpaces.set(t.id, t);
      await saveTaskSpaces();
      return t;
    },
    switchTaskSpace: async (name) => {
      for (const t of taskSpaces.values()) {
        if (t.name === name) { t.updatedAt = Date.now(); return t; }
      }
      return helpers.useOrCreateTaskSpace(name);
    },
    claimTaskSpace: async (name) => {
      const t = await helpers.useOrCreateTaskSpace(name);
      t.ownership = 'agent';
      t.updatedAt = Date.now();
      await saveTaskSpaces();
      return t;
    },
    completeTaskSpace: async (name) => {
      for (const t of taskSpaces.values()) {
        if (t.name === name) { t.status = 'done'; t.updatedAt = Date.now(); await saveTaskSpaces(); return { done: true, id: t.id }; }
      }
      return { done: false };
    },
    handOffTaskSpace: async (name) => {
      const t = await helpers.useOrCreateTaskSpace(name);
      t.ownership = 'human';
      t.updatedAt = Date.now();
      await saveTaskSpaces();
      return { done: true, id: t.id };
    },
    takeOverTaskSpace: async (name) => {
      const t = await helpers.useOrCreateTaskSpace(name);
      t.ownership = 'agent';
      t.updatedAt = Date.now();
      await saveTaskSpaces();
      return { done: true, id: t.id };
    },
    waitForAgentControl: async () => ({ done: true }),

    // --- Tabs / navigation ---
    listTabs: async () => {
      if (!browser) return [];
      const pages = await browser.pages();
      const out = [];
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        out.push({
          targetId: p.target()._targetId,
          title: await p.title(),
          url: p.url(),
          active: p === page,
          index: i,
        });
      }
      return out;
    },    openOrReuseTab: async (url, options) => {
      if (!browser) throw new Error('Browser not launched');
      if (url && url !== 'about:blank' && !isSafeUrl(url)) {
        throw new Error('Blocked URL (scheme or target not allowed): ' + url);
      }
      const pages = await browser.pages();
      // Normalize URLs (strip trailing slash) so "https://example.com" and
      // "https://example.com/" are treated as the same tab for reuse.
      const norm = (u) => { try { return new URL(u).href.replace(/\/$/, ''); } catch { return u; } };
      const existing = options?.match === 'always-new' ? null : pages.find(p => norm(p.url()) === norm(url));
      if (existing) {
        await existing.bringToFront();
        page = existing;
        cdpSession = await page.createCDPSession();
        await cdpSession.send('Page.enable');
        return { targetId: page.target()._targetId, url, title: await page.title(), active: true, reused: true };
      }
      const newPage = await browser.newPage();
      if (url && url !== 'about:blank') {
        const timeout = options?.timeout || 20000;
        const waitUntil = options?.wait !== false ? 'load' : 'commit';
        let lastErr;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await newPage.goto(url, { waitUntil, timeout });
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
            if (!/Requesting main frame too early/.test(e.message)) throw e;
            await new Promise(r => setTimeout(r, 300));
          }
        }
        if (lastErr) throw lastErr;
      }
      page = newPage;
      cdpSession = await page.createCDPSession();
      await cdpSession.send('Page.enable');
      return { targetId: page.target()._targetId, url, title: await page.title(), active: true, reused: false };
    },

    closeTab: async (target) => {
      if (!browser) return;
      const pages = await browser.pages();
      const tid = typeof target === 'string' ? target : (target ? target.targetId : null);
      const p = pages.find(pg => pg.target()._targetId === tid);
      if (p) await p.close();
    },

    switchTab: async (target) => {
      if (!browser) return;
      const pages = await browser.pages();
      const tid = typeof target === 'string' ? target : (target ? target.targetId : null);
      const p = pages.find(pg => pg.target()._targetId === tid);
      if (p) {
        await p.bringToFront();
        page = p;
        cdpSession = await page.createCDPSession();
        await cdpSession.send('Page.enable');
      }
    },

    currentTab: async () => {
      if (!page) throw new Error('No active tab');
      return { targetId: page.target()._targetId, url: page.url(), title: await page.title() };
    },

    pageInfo: async () => {
      if (!page) return { url: '', title: '', w: 0, h: 0, sx: 0, sy: 0, pw: 0, ph: 0 };
      const vp = await page.viewport();
      return {
        url: page.url(),
        title: await page.title(),
        w: vp.width, h: vp.height,
        sx: 0, sy: 0, pw: vp.width, ph: vp.height,
      };
    },

    ensureRealTab: async () => {
      if (!page) return null;
      return { targetId: page.target()._targetId, url: page.url(), title: await page.title() };
    },

    gotoAndWait: async (url, options) => {
      if (!page) throw new Error('No active tab');
      if (!isSafeUrl(url)) throw new Error('Blocked URL (scheme or target not allowed): ' + url);
      await page.goto(url, {
        waitUntil: options?.settle ? 'networkidle0' : 'load',
        timeout: options?.timeout || 20000,
      });
      if (options?.settle) await new Promise(r => setTimeout(r, options.settle));
      return { loaded: true };
    },

    // --- Observation ---
    snapshotText: async (options) => {
      if (!cdpSession) return '';
      try {
        const result = await cdpSession.send('Accessibility.getFullAXTree', {});
        const lines = buildSnapshotLines(result.nodes || []);
        return lines.join('\n');
      } catch (err) {
        log('snapshotText error:', err);
        return '';
      }
    },

    captureScreenshot: async (options) => {
      if (!page) throw new Error('No active tab');
      const path = safeShotPath(options?.path);
      await mkdir(join(path, '..'), { recursive: true });
      await page.screenshot({ path, fullPage: options?.fullPage || false });
      return path;
    },

    drainEvents: () => [],

    // --- Mouse ---
    click: async (selector, options) => {
      if (!page) throw new Error('No active tab');
      try {
        if (Array.isArray(selector)) {
          await page.mouse.click(selector[0], selector[1]);
          return;
        }
        if (typeof selector === 'object' && 'x' in selector && 'y' in selector) {
          await page.mouse.click(selector.x, selector.y);
          return;
        }
        const sel = typeof selector === 'string' ? selector : (selector ? selector.selector : null);
        if (sel) {
          await page.waitForSelector(sel, { timeout: (options && options.timeout) || 5000 });
          await page.click(sel);
        }
      } catch (err) {
        log('click error:', err);
        throw err;
      }
    },

    doubleClick: async (selector) => {
      if (!page) return;
      const sel = typeof selector === 'string' ? selector : (selector ? selector.selector : null);
      if (sel) await page.click(sel, { clickCount: 2 });
    },

    hover: async (selector) => {
      if (!page) return;
      const sel = typeof selector === 'string' ? selector : (selector ? selector.selector : null);
      if (sel) await page.hover(sel);
    },

    scrollBy: async (delta) => {
      if (!page) return;
      await page.evaluate((d) => window.scrollBy(0, d), delta);
    },

    scrollToBottomUntil: async (predicate, options) => {
      if (!page) return;
      const maxSteps = (options && options.maxSteps) || 20;
      const step = (options && options.step) || 900;
      const waitMs = ((options && options.wait) || 1) * 1000;
      for (let i = 0; i < maxSteps; i++) {
        const done = await page.evaluate(predicate);
        if (done) break;
        await page.evaluate((s) => window.scrollBy(0, s), step);
        await new Promise(r => setTimeout(r, waitMs));
      }
    },

    scroll: async (options) => {
      if (!page) return;
      if (options && options.dy) await page.evaluate((dy) => window.scrollBy(0, dy), options.dy);
    },

    // --- Keyboard ---
    typeText: async (text, options) => {
      if (!page) return;
      await page.keyboard.type(text, { delay: (options && options.delay) || 0 });
    },

    fillInput: async (selector, text) => {
      if (!page) return;
      const sel = typeof selector === 'string' ? selector : (selector ? selector.selector : null);
      if (!sel) return;
      await page.waitForSelector(sel, { timeout: 5000 });
      await page.$eval(sel, (el, val) => {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, text);
    },

    pressKey: async (key) => {
      if (!page) return;
      await page.keyboard.press(key);
    },

    // --- CDP / JS / fetch ---
    js: async (expression) => {
      if (!page) return undefined;
      return page.evaluate(expression);
    },

    cdp: async (method, params) => {
      if (!cdpSession) throw new Error('No CDP session');
      if (!isSafeCdp(method)) throw new Error('CDP method not allowed: ' + method);
      return cdpSession.send(method, params || {});
    },

    serverFetch: async (url, options) => {
      if (!isSafeUrl(url)) throw new Error('Blocked URL (scheme or target not allowed): ' + url);
      const resp = await fetch(url, options || {});
      return resp.text();
    },

    browserFetch: async (url) => {
      if (!page) return '';
      if (!isSafeUrl(url)) throw new Error('Blocked URL (scheme or target not allowed): ' + url);
      return page.evaluate((u) => fetch(u).then(r => r.text()), url);
    },

    // --- Lifecycle ---
    setHeadless: (val) => { headless = !!val; },
    ensureStarted: async () => {
      await loadTaskSpaces();
      await launchChrome();
    },
    shutdownAll: async () => {
      try { if (browser) await browser.close(); } catch (e) {}
      browser = null; page = null; cdpSession = null;
    },
  };
  return helpers;
}

