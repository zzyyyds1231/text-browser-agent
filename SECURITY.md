# Security

`text-browser-agent` is a browser automation bridge. Because it drives a real
browser and exposes agent-facing tools, it is designed with a **default-deny**
security posture. This document describes the controls in place.

## Threat model

The tool is intended to be run **locally by a trusted user/agent**. It is **not**
a network service and does not listen on any port. The main risks are:

1. **Prompt-injected / malicious tool calls** 鈥?an untrusted page or prompt
   tricking the agent into performing dangerous actions.
2. **SSRF** 鈥?navigating to or fetching internal/private network resources.
3. **File exfiltration** 鈥?writing screenshots or reading sensitive paths.

## Controls

### 1. No shell execution
The tool **never** spawns a shell or runs arbitrary OS commands. There is no
`shell_exec`, `exec`, `spawn`, or `child_process` for user input. This removes
the entire class of command-injection / RCE attacks.

### 2. URL scheme + SSRF allowlist
Navigation and fetch helpers (`openOrReuseTab`, `gotoAndWait`, `serverFetch`,
`browserFetch`) only accept `http:` / `https:` URLs and **block**:
- `file:`, `data:`, `javascript:`, `chrome:`, etc.
- `localhost` / `127.0.0.1` / `0.0.0.0` / `::1`
- private ranges (`10.x`, `192.168.x`, `172.16-31.x`) and link-local (`169.254.x`)

### 3. CDP method allowlist
The raw `cdp(method, ...)` helper only permits a curated allowlist of
read-only / safe CDP methods. Dangerous methods (`Browser.setDownloadBehavior`,
`Network.setCookie`, `Fetch.*`, `Debugger.*`, `Browser.close`, etc.) are
explicitly blocked.

### 4. Screenshot path sandbox
`captureScreenshot` only writes inside `EGO_SHOT_DIR` (default
`%TEMP%\text-browser-agent-shots`). Any path outside that directory is rejected.

### 5. No credential access
The tool does not read `.env`, registry, or credential stores. It does not
expose environment variables to the page.

## Reporting a vulnerability

Please report security issues privately to the maintainer before public
disclosure. Do **not** open a public issue for a live vulnerability.

