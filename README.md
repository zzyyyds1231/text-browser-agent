# text-browser-agent

> Windows browser automation bridge for AI agents. Drives real Chrome via
> Puppeteer/CDP with an agent-friendly API — **AX-tree text snapshots, no vision
> tokens needed.**

[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)]()
[![GitHub stars](https://img.shields.io/github/stars/zzyyyds1231/text-browser-agent?style=social)](https://github.com/zzyyyds1231/text-browser-agent)

`text-browser-agent` lets an AI agent **see** and **operate** a real Chrome
browser. Instead of expensive, slow vision models, it converts the page's
accessibility (AX) tree into plain text via `snapshotText()`, so any cheap text
model can drive the browser. It ships as both a CLI and a **Model Context
Protocol (MCP) server**.

## Why

Browser automation for agents usually burns vision tokens on screenshots. This
tool takes a different route: the **accessibility tree is already text**. That
means:

- **Zero vision tokens** 鈥?any text LLM can read the page.
- **Fast** 鈥?no image round-trips.
- **Structured** 鈥?elements carry roles and references for reliable clicking.

## Features

- **AX-tree text snapshots** 鈥?`snapshotText()` returns the page as text.
- **Full interaction** 鈥?click, fill, type, press keys, scroll, hover.
- **Raw CDP** 鈥?allowlisted `cdp()` for power users.
- **MCP server** 鈥?expose browser tools to any MCP client (Claude, Cursor, etc.).
- **Headless or headed** 鈥?`--headless` for automation, headed for human viewing.
- **Persistent task spaces** 鈥?real, saved task spaces (not stubs).
- **Security-first** 鈥?no shell execution, URL/SSRF allowlist, CDP allowlist,
  screenshot path sandbox. See [SECURITY.md](SECURITY.md).

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

## Usage

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

### 3. MCP server (stdio) 鈥?connect and go

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

**Claude Code** 鈥?add to `.mcp.json` (project) or `~/.claude.json` (global):

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

**Cursor** 鈥?Settings 鈫?MCP 鈫?Add server, choose "command", enter
`text-browser-agent --mcp --headless`.

**opencode** 鈥?add to `opencode.json`:

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

The server exposes 26 tools: `openOrReuseTab`, `listTabs`, `switchTab`,
`closeTab`, `currentTab`, `gotoAndWait`, `pageInfo`, `snapshotText`,
`captureScreenshot`, `click`, `doubleClick`, `hover`, `scrollBy`,
`scrollToBottomUntil`, `fillInput`, `typeText`, `pressKey`, `js`, `cdp`,
`serverFetch`, `browserFetch`, and task-space management
(`useOrCreateTaskSpace`, `listTaskSpaces`, `newTaskSpace`,
`completeTaskSpace`, `handOffTaskSpace`).

## API reference

### Task spaces (persisted)
`useOrCreateTaskSpace(name)` 路 `listTaskSpaces()` 路 `newTaskSpace(name)` 路
`switchTaskSpace(name)` 路 `claimTaskSpace(name)` 路 `completeTaskSpace(name)` 路
`handOffTaskSpace(name)` 路 `takeOverTaskSpace(name)` 路 `waitForAgentControl()`

### Tabs / navigation
`openOrReuseTab(url, opts?)` 路 `listTabs()` 路 `switchTab(targetId)` 路
`closeTab(targetId)` 路 `currentTab()` 路 `gotoAndWait(url, opts?)` 路 `pageInfo()`

### Observation
`snapshotText(opts?)` 路 `captureScreenshot(opts?)` 路 `cliLog(...)` 路 `drainEvents()`

### Mouse
`click(sel, opts?)` 路 `doubleClick(sel)` 路 `hover(sel)` 路 `scrollBy(delta)` 路
`scrollToBottomUntil(pred, opts?)` 路 `scroll({dy})`

### Keyboard / input
`typeText(text, opts?)` 路 `fillInput(sel, text)` 路 `pressKey(key)`

### CDP / JS / network
`js(expression)` 路 `cdp(method, params?)` 路 `browserFetch(url)` 路 `serverFetch(url, opts?)`

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `CHROME_PATH` | `C:\Program Files\Google\Chrome\Application\chrome.exe` | Chrome executable |
| `EGO_DATA_DIR` | `%TEMP%\text-browser-agent-data` | Browser user-data + task persistence |
| `EGO_SHOT_DIR` | `%TEMP%\text-browser-agent-shots` | Screenshot output sandbox |
| `EGO_HEADLESS` | `0` | `1` to default to headless |
| `EGO_DEBUG` | 鈥?| set to enable debug logging |

## Security

This tool is **default-deny**: no shell execution, URL/SSRF allowlist, CDP
method allowlist, and a screenshot path sandbox. It is a local tool and does not
listen on any port. Read [SECURITY.md](SECURITY.md) for the full threat model.

## License

MIT. Underlying `puppeteer` is Apache-2.0 (Copyright The Chromium Authors).

## Contact

Questions, feedback, or collaboration? Reach out on WeChat:

**WeChat: `1127765955`**

If you find this tool useful, a ⭐ on GitHub goes a long way. Thanks!



