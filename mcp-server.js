#!/usr/bin/env node
/**
 * text-browser-agent 鈥?Model Context Protocol (MCP) server
 *
 * Exposes the browser bridge as a standard stdio MCP server using the
 * official @modelcontextprotocol/sdk. Compatible with Claude Code, Cursor,
 * Cline, opencode, and any other MCP client.
 *
 * Run:  text-browser-agent --mcp
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { createHelpers, config, prepareEnv } from './core.js';

const VERSION = '1.0.0';

async function main() {
  prepareEnv();
  const headless = process.argv.includes('--headless') || config.headlessDefault;

  // Lazily build helpers so Chrome only launches on first tool call.
  let helpers;
  const getHelpers = async () => {
    if (!helpers) {
      helpers = await createHelpers();
      helpers.setHeadless(headless);
      await helpers.ensureStarted();
    }
    return helpers;
  };

  const server = new McpServer({
    name: 'text-browser-agent',
    version: VERSION,
    capabilities: {
      tools: {},
    },
  });

  // --- Tools -----------------------------------------------------------

  server.registerTool('openOrReuseTab', {
    description: 'Open a URL in a tab, reusing an existing tab with the same URL (or always-new with match). http/https only.',
    inputSchema: {
      url: z.string().describe('http(s) URL to open'),
      match: z.enum(['reuse', 'always-new']).optional().describe('default reuse; always-new forces a fresh tab'),
    },
  }, async ({ url, match }) => {
    const h = await getHelpers();
    const r = await h.openOrReuseTab(url, match === 'always-new' ? { match: 'always-new' } : undefined);
    return text(r);
  });

  server.registerTool('listTabs', {
    description: 'List all open tabs (targetId, url, title, active, index).',
    inputSchema: {},
  }, async () => {
    const h = await getHelpers();
    return text(await h.listTabs());
  });

  server.registerTool('switchTab', {
    description: 'Switch the active tab to the given targetId.',
    inputSchema: { targetId: z.string() },
  }, async ({ targetId }) => {
    const h = await getHelpers();
    await h.switchTab(targetId);
    return text({ switched: true });
  });

  server.registerTool('closeTab', {
    description: 'Close a tab by targetId.',
    inputSchema: { targetId: z.string() },
  }, async ({ targetId }) => {
    const h = await getHelpers();
    await h.closeTab(targetId);
    return text({ closed: true });
  });

  server.registerTool('currentTab', {
    description: 'Return the current active tab info.',
    inputSchema: {},
  }, async () => {
    const h = await getHelpers();
    return text(await h.currentTab());
  });

  server.registerTool('gotoAndWait', {
    description: 'Navigate the current tab to a URL and wait for load (or networkidle0 when settle=true).',
    inputSchema: {
      url: z.string().describe('http(s) URL'),
      settle: z.boolean().optional().describe('wait for network idle'),
      timeout: z.number().optional().describe('timeout ms, default 20000'),
    },
  }, async ({ url, settle, timeout }) => {
    const h = await getHelpers();
    const r = await h.gotoAndWait(url, { settle, timeout });
    return text(r);
  });

  server.registerTool('pageInfo', {
    description: 'Current page URL, title, and viewport size.',
    inputSchema: {},
  }, async () => {
    const h = await getHelpers();
    return text(await h.pageInfo());
  });

  server.registerTool('snapshotText', {
    description: 'Return the current page as an accessibility (AX) tree text snapshot. Plain text 鈥?no vision tokens needed. This is the cheapest way for an LLM to "see" the page.',
    inputSchema: {},
  }, async () => {
    const h = await getHelpers();
    const snap = await h.snapshotText();
    return { content: [{ type: 'text', text: snap }] };
  });

  server.registerTool('captureScreenshot', {
    description: 'Take a screenshot of the current page. Saved under the sandboxed shot directory; returns the file path.',
    inputSchema: {
      fullPage: z.boolean().optional().describe('capture full page'),
    },
  }, async ({ fullPage }) => {
    const h = await getHelpers();
    const path = await h.captureScreenshot({ fullPage });
    return text({ path });
  });

  server.registerTool('click', {
    description: 'Click an element by CSS selector, or at [x,y] coordinates.',
    inputSchema: {
      selector: z.string().optional().describe('CSS selector'),
      x: z.number().optional().describe('x coordinate (with y)'),
      y: z.number().optional().describe('y coordinate (with x)'),
    },
  }, async ({ selector, x, y }) => {
    const h = await getHelpers();
    if (x != null && y != null) await h.click([x, y]);
    else await h.click(selector);
    return text({ clicked: true });
  });

  server.registerTool('doubleClick', {
    description: 'Double-click an element by CSS selector.',
    inputSchema: { selector: z.string() },
  }, async ({ selector }) => {
    const h = await getHelpers();
    await h.doubleClick(selector);
    return text({ clicked: true });
  });

  server.registerTool('hover', {
    description: 'Hover over an element by CSS selector.',
    inputSchema: { selector: z.string() },
  }, async ({ selector }) => {
    const h = await getHelpers();
    await h.hover(selector);
    return text({ hovered: true });
  });

  server.registerTool('scrollBy', {
    description: 'Scroll the page by dy pixels.',
    inputSchema: { delta: z.number().describe('pixels to scroll') },
  }, async ({ delta }) => {
    const h = await getHelpers();
    await h.scrollBy(delta);
    return text({ scrolled: true });
  });

  server.registerTool('scrollToBottomUntil', {
    description: 'Scroll to bottom repeatedly until the predicate evaluates true in page context.',
    inputSchema: {
      predicate: z.string().describe('JS expression returning boolean, evaluated in page context'),
      maxSteps: z.number().optional(),
      wait: z.number().optional().describe('seconds between steps, default 1'),
    },
  }, async ({ predicate, maxSteps, wait }) => {
    const h = await getHelpers();
    const page = (await h.ensureRealTab());
    if (!page) throw new Error('No active tab');
    // Pass a function that evaluates the predicate expression in page context
    // (where `document` etc. exist), not in Node context.
    await h.scrollToBottomUntil(new Function('return (' + predicate + ')'), { maxSteps, wait });
    return text({ scrolled: true });
  });

  server.registerTool('fillInput', {
    description: 'Fill an input (by CSS selector) with text, dispatching input/change events.',
    inputSchema: {
      selector: z.string(),
      text: z.string(),
    },
  }, async ({ selector, text }) => {
    const h = await getHelpers();
    await h.fillInput(selector, text);
    return text({ filled: true });
  });

  server.registerTool('typeText', {
    description: 'Type text into the focused element.',
    inputSchema: {
      text: z.string(),
      delay: z.number().optional().describe('ms between keystrokes'),
    },
  }, async ({ text, delay }) => {
    const h = await getHelpers();
    await h.typeText(text, { delay });
    return text({ typed: true });
  });

  server.registerTool('pressKey', {
    description: 'Press a keyboard key (e.g. Enter, Tab, ArrowDown).',
    inputSchema: { key: z.string() },
  }, async ({ key }) => {
    const h = await getHelpers();
    await h.pressKey(key);
    return text({ pressed: true });
  });

  server.registerTool('js', {
    description: 'Evaluate a JavaScript expression in the page context and return its value.',
    inputSchema: { expression: z.string() },
  }, async ({ expression }) => {
    const h = await getHelpers();
    const value = await h.js(expression);
    return text(value);
  });

  server.registerTool('cdp', {
    description: 'Send an allowlisted raw CDP command. Only safe/read-only methods are permitted.',
    inputSchema: {
      method: z.string(),
      params: z.record(z.any()).optional(),
    },
  }, async ({ method, params }) => {
    const h = await getHelpers();
    const r = await h.cdp(method, params);
    return text(r);
  });

  server.registerTool('serverFetch', {
    description: 'Fetch a URL from the Node process. http/https only.',
    inputSchema: { url: z.string() },
  }, async ({ url }) => {
    const h = await getHelpers();
    return text(await h.serverFetch(url));
  });

  server.registerTool('browserFetch', {
    description: 'Fetch a URL from the page context. http/https only.',
    inputSchema: { url: z.string() },
  }, async ({ url }) => {
    const h = await getHelpers();
    return text(await h.browserFetch(url));
  });

  // --- Task spaces ------------------------------------------------------

  server.registerTool('useOrCreateTaskSpace', {
    description: 'Create a task space or reuse an existing one by name. Returns task namespace info.',
    inputSchema: { name: z.string().optional() },
  }, async ({ name }) => {
    const h = await getHelpers();
    return text(await h.useOrCreateTaskSpace(name));
  });

  server.registerTool('listTaskSpaces', {
    description: 'List known task spaces.',
    inputSchema: {},
  }, async () => {
    const h = await getHelpers();
    return text(await h.listTaskSpaces());
  });

  server.registerTool('newTaskSpace', {
    description: 'Create a new task space with a unique id.',
    inputSchema: { name: z.string().optional() },
  }, async ({ name }) => {
    const h = await getHelpers();
    return text(await h.newTaskSpace(name));
  });

  server.registerTool('completeTaskSpace', {
    description: 'Mark a task space as done.',
    inputSchema: { name: z.string() },
  }, async ({ name }) => {
    const h = await getHelpers();
    return text(await h.completeTaskSpace(name));
  });

  server.registerTool('handOffTaskSpace', {
    description: 'Hand a task space over to a human.',
    inputSchema: { name: z.string().optional() },
  }, async ({ name }) => {
    const h = await getHelpers();
    return text(await h.handOffTaskSpace(name));
  });

  // --- Transport --------------------------------------------------------

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Ensure a clean shutdown of the browser when the MCP client disconnects.
  process.on('SIGINT', async () => {
    const h = await getHelpers();
    await h.shutdownAll();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    const h = await getHelpers();
    await h.shutdownAll();
    process.exit(0);
  });
}

function text(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return { content: [{ type: 'text', text: s }] };
}

main().catch((err) => {
  console.error('[text-browser-agent mcp] fatal:', err && err.message ? err.message : err);
  process.exit(1);
});

