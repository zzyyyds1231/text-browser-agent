#!/usr/bin/env node
/**
 * text-browser-agent 鈥?Windows browser automation bridge for AI agents
 *
 * Drives real Chrome via Puppeteer (CDP) with an agent-friendly API:
 *   snapshotText (AX-tree text, no vision tokens), click, fillInput,
 *   js, cdp, captureScreenshot, etc.
 *
 * Modes:
 *   ego-browser nodejs <<'EOF'   run a script from stdin (helpers injected)
 *   ego-browser --mcp            run as a Model Context Protocol (stdio) server
 *   ego-browser --doctor         check environment
 *   ego-browser --help           this help
 *
 * Security: URL scheme allowlist, CDP method allowlist, screenshot path
 * sandbox, and no shell execution. See SECURITY.md.
 */

import { createHelpers, launchChrome, config, prepareEnv } from './core.js';

// === Main =================================================================
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('text-browser-agent - Windows browser automation bridge for AI agents\n');
    console.log('Usage:');
    console.log('  ego-browser nodejs <<EOF');
    console.log('    const task = await useOrCreateTaskSpace("my task")');
    console.log('    await openOrReuseTab("https://example.com")');
    console.log('    console.log(await snapshotText())');
    console.log('  EOF\n');
    console.log('  ego-browser --mcp           Run as a Model Context Protocol (stdio) server');
    console.log('  ego-browser --headless      Run Chrome headless (no visible UI)');
    console.log('  ego-browser --doctor        Check environment');
    console.log('  ego-browser --help          This help\n');
    console.log('Env: CHROME_PATH, EGO_DATA_DIR, EGO_SHOT_DIR, EGO_HEADLESS=1, EGO_DEBUG');
    return 0;
  }

  prepareEnv();
  const headless = args.includes('--headless') || config.headlessDefault;

  if (args.includes('--mcp')) {
    // MCP server lives in mcp-server.js (official SDK). Re-exec so the
    // headless flag is honored there too.
    const { spawn } = await import('node:child_process');
    const mcpArgs = ['mcp-server.js'];
    if (headless) mcpArgs.push('--headless');
    const child = spawn(process.execPath, mcpArgs, { stdio: 'inherit', cwd: import.meta.dirname });
    child.on('exit', (code) => process.exit(code == null ? 0 : code));
    return;
  }

  if (args.includes('--doctor')) {
    console.log('text-browser-agent v1.0.0');
    console.log('Node:', process.version);
    console.log('Chrome:', config.chromePath);
    console.log('Headless default:', config.headlessDefault);
    try {
      console.log('Checking Chrome...');
      await launchChrome();
      console.log('Chrome: OK');
      const h = createHelpers();
      await h.shutdownAll();
      return 0;
    } catch (err) {
      console.error('Chrome: FAILED -', err.message);
      return 1;
    }
  }

  // Read stdin
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const script = Buffer.concat(chunks).toString('utf-8').trim();

  if (!script) {
    console.error('No input script. Pipe JS to stdin, or use --mcp / --doctor / --help.');
    return 1;
  }

  const helpers = createHelpers();
  helpers.setHeadless(headless);
  try {
    await helpers.ensureStarted();
    const helperNames = Object.keys(helpers);
    const helperValues = Object.values(helpers);

    const fn = new Function(...helperNames, 'return (async () => {\n' + script + '\n})();');
    await fn(...helperValues);
    return 0;
  } catch (err) {
    console.error(err.message || String(err));
    return 1;
  } finally {
    await helpers.shutdownAll();
  }
}

main().catch(err => {
  console.error('Fatal:', err.message || String(err));
  process.exit(1);
});

