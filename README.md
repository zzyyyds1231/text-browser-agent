# text-browser-agent

> **让 AI 用纯文本看懂网页，浏览器自动化从此不烧视觉 token。**

Windows browser automation bridge for AI agents. Drives real Chrome via
Puppeteer/CDP with an agent-friendly API — **AX-tree text snapshots, no vision
tokens needed.** Ships as both a CLI and a **Model Context Protocol (MCP) server**.

[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)]()
[![GitHub stars](https://img.shields.io/github/stars/zzyyyds1231/text-browser-agent?style=social)](https://github.com/zzyyyds1231/text-browser-agent)

---

## Why this exists

Browser automation for AI agents usually burns **vision tokens** on screenshots —
expensive, slow, and error-prone. This tool takes a different route:

> **The accessibility (AX) tree is already text.**

`text-browser-agent` converts any page into a plain-text snapshot via
`snapshotText()`, so **any cheap text model** can "see" and drive a real Chrome
browser. No images, no vision round-trips.

| | Vision-based | **text-browser-agent** |
|---|---|---|
| Cost (100 pages) | ~$0.38 | **~$0.00** |
| Speed | slow (image round-trips) | fast (pure text) |
| Model needed | vision-capable | any text LLM |
| Structure | pixels | roles + refs (reliable clicks) |

---

## Features

- **AX-tree text snapshots** — `snapshotText()` returns the page as structured text.
- **Full interaction** — click, fill, type, press keys, scroll, hover.
- **Raw CDP** — allowlisted `cdp()` for power users.
- **MCP server** — official `@modelcontextprotocol/sdk`, works with any MCP client.
- **Headless or headed** — `--headless` for automation, headed for human viewing.
- **Persistent task spaces** — real, saved task spaces (not stubs).
- **Security-first** — no shell execution, URL/SSRF allowlist, CDP allowlist,
  screenshot path sandbox. See [SECURITY.md](SECURITY.md).

---

## Installation

```bash
# from the project directory
npm install
npm link          # exposes the `text-browser-agent` CLI globally
```

Prerequisites:
- **Node.js >= 22**
- **Chrome** at `C:\Program Files\Google\Chrome\Application\chrome.exe`
  (override with `CHROME_PATH`). If the browser wasn't downloaded:
  `npx puppeteer browsers install`

---

## Quick start

### 1. Environment check

```bash
text-browser-agent --doctor
```

### 2. Run a script (helpers injected)

```bash
@'
await openOrReuseTab("https://example.com")
console.log(await snapshotText())
'@ | text-browser-agent nodejs
```

Headless:

```bash
@'
await openOrReuseTab("https://example.com")
console.log(await snapshotText())
'@ | text-browser-agent nodejs --headless
```

### 3. MCP server — connect and go

The MCP server uses the **official `@modelcontextprotocol/sdk`**, so it works
with any MCP client (Claude Code, Cursor, Cline, opencode, etc.) with zero
custom glue.

```bash
text-browser-agent --mcp            # headed (visible Chrome)
text-browser-agent --mcp --headless # headless (recommended for automation)
```

Add it to your client's MCP config as a **stdio** server:

```json
{
  "mcpServers": {
    "text-browser-agent": {
      "command": "text-browser-agent",
      "args": ["--mcp", "--headless"]
    }
  }
}
```

> A ready-to-copy config lives in [`mcp.example.json`](mcp.example.json).

**Claude Code** — add to `.mcp.json` (project) or `~/.claude.json` (global):

```json
{
  "mcpServers": {
    "text-browser-agent": {
      "command": "text-browser-agent",
      "args": ["--mcp", "--headless"]
    }
  }
}
```

**Cursor** — Settings → MCP → Add server, choose "command", enter
`text-browser-agent --mcp --headless`.

**opencode** — add to `opencode.json`:

```json
{
  "mcp": {
    "text-browser-agent": {
      "type": "local",
      "command": ["text-browser-agent", "--mcp", "--headless"]
    }
  }
}
```

The server exposes **26 tools**: `openOrReuseTab`, `listTabs`, `switchTab`,
`closeTab`, `currentTab`, `gotoAndWait`, `pageInfo`, `snapshotText`,
`captureScreenshot`, `click`, `doubleClick`, `hover`, `scrollBy`,
`scrollToBottomUntil`, `fillInput`, `typeText`, `pressKey`, `js`, `cdp`,
`serverFetch`, `browserFetch`, and task-space management
(`useOrCreateTaskSpace`, `listTaskSpaces`, `newTaskSpace`,
`completeTaskSpace`, `handOffTaskSpace`).

---

## API reference

### Task spaces (persisted)
`useOrCreateTaskSpace(name)` · `listTaskSpaces()` · `newTaskSpace(name)` ·
`switchTaskSpace(name)` · `claimTaskSpace(name)` · `completeTaskSpace(name)` ·
`handOffTaskSpace(name)` · `takeOverTaskSpace(name)` · `waitForAgentControl()`

### Tabs / navigation
`openOrReuseTab(url, opts?)` · `listTabs()` · `switchTab(targetId)` ·
`closeTab(targetId)` · `currentTab()` · `gotoAndWait(url, opts?)` · `pageInfo()`

### Observation
`snapshotText(opts?)` · `captureScreenshot(opts?)` · `cliLog(...)` · `drainEvents()`

### Mouse
`click(sel, opts?)` · `doubleClick(sel)` · `hover(sel)` · `scrollBy(delta)` ·
`scrollToBottomUntil(pred, opts?)` · `scroll({dy})`

### Keyboard / input
`typeText(text, opts?)` · `fillInput(sel, text)` · `pressKey(key)`

### CDP / JS / network
`js(expression)` · `cdp(method, params?)` · `browserFetch(url)` · `serverFetch(url, opts?)`

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `CHROME_PATH` | `C:\Program Files\Google\Chrome\Application\chrome.exe` | Chrome executable |
| `EGO_DATA_DIR` | `%TEMP%\text-browser-agent-data` | Browser user-data + task persistence |
| `EGO_SHOT_DIR` | `%TEMP%\text-browser-agent-shots` | Screenshot output sandbox |
| `EGO_HEADLESS` | `0` | `1` to default to headless |
| `EGO_DEBUG` | — | set to enable debug logging |

---

## Security

This tool is **default-deny**: no shell execution, URL/SSRF allowlist, CDP
method allowlist, and a screenshot path sandbox. It is a local tool and does not
listen on any port. Read [SECURITY.md](SECURITY.md) for the full threat model.

---

## License

MIT. Underlying `puppeteer` is Apache-2.0 (Copyright The Chromium Authors).

---

## Contact

Questions, feedback, or collaboration? Reach out on WeChat:

**WeChat: `1127765955`**

If you find this tool useful, a ⭐ on GitHub goes a long way. Thanks!
