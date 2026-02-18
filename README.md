# Roblox Studio MCP Server

**Connect AI assistants like Codex, Claude, Copilot, and Gemini to Roblox Studio**

[![NPM Version](https://img.shields.io/npm/v/robloxstudio-mcp)](https://www.npmjs.com/package/robloxstudio-mcp)

---

## What is This?

An MCP server that lets AI explore your game structure, read/edit scripts, and perform bulk changes locally.

## Quick Setup

1. Install the [Studio plugin](https://github.com/boshyxd/robloxstudio-mcp/releases) to your Plugins folder
2. Enable **Allow HTTP Requests** in Experience Settings > Security
3. Connect your AI client

**Claude:**
```bash
claude mcp add robloxstudio -- npx -y robloxstudio-mcp@latest
```

**Codex:**
```bash
codex mcp add robloxstudio -- npx -y robloxstudio-mcp@latest
```

**Gemini:**
```bash
gemini mcp add robloxstudio npx --trust -- -y robloxstudio-mcp@latest
```

Plugin shows "Connected" when ready.

<details>
<summary>Other MCP clients (Claude Desktop, Cursor, Copilot MCP-compatible clients, etc.)</summary>

`stdio` example (single Studio target, no daemon):

```json
{
  "mcpServers": {
    "robloxstudio-mcp": {
      "command": "npx",
      "args": ["-y", "robloxstudio-mcp@latest"]
    }
  }
}
```

**Windows users:** If you encounter issues, use `cmd`:
```json
{
  "mcpServers": {
    "robloxstudio-mcp": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "robloxstudio-mcp@latest"]
    }
  }
}
```

`url` example (shared daemon endpoint):

```json
{
  "mcpServers": {
    "robloxstudio-mcp": {
      "url": "http://127.0.0.1:59000/mcp"
    }
  }
}
```

Use the same URL for Codex/Claude/Copilot clients when you want them all routed to the same Studio target.
</details>

## Single Studio Target (No Daemon Needed)

If you are working with **one Studio instance**, use `stdio` and do **not** run a daemon.

Codex `config.toml` example:

```toml
[mcp_servers.robloxstudio]
command = "cmd"
args = ["/c", "npx", "-y", "robloxstudio-mcp@latest"]
enabled = true
```

Keep the plugin URL at:

```text
http://localhost:58741
```

## Transport Modes

### Which mode should I use?

- Use `stdio` if you want one Studio target and do not want to run a daemon.
- Use `streamable-http` for concurrent workflows, especially with multiple Studio instances and projects.

### 1) Stdio Mode (default)

- Easiest quick start (`npx ...`)
- One MCP process per client session
- Recommended for one Studio target when you do not want a daemon
- If another MCP process tries to use the same Studio bridge port, it is automatically proxied to the primary instance
- The Studio plugin UI will show this on the MCP bridge line as `MCP bridge (proxying 1 instance)` or `MCP bridge (proxying N instances)`
- This resolves common `EADDRINUSE`/port-collision issues and lets multiple MCP clients share one Studio target without manual port setup

Example: Codex + Claude + Copilot on one Studio target (no daemon)

1. Configure each client to run the same command (`npx -y robloxstudio-mcp@latest`)
2. Keep the Studio plugin on `http://localhost:58741`
3. Use all clients concurrently

What this resolves:

- You do not need separate bridge ports per client
- Extra MCP processes automatically proxy to the primary one
- The plugin tells you when this is happening via `MCP bridge (proxying 1 instance)` / `MCP bridge (proxying N instances)`

### 2) Shared Daemon Mode (recommended for concurrent workflows)

The quick-start commands above use stdio, which launches one MCP process per client session.

If you want stable routing for concurrent workflows (for example, when you have multiple Studio instances open), run this server in Streamable HTTP mode and connect clients with a `url`.

Start daemon (published package):

```bash
npx -y robloxstudio-mcp@latest --streamable-http
```

Start daemon (local checkout helper):

```powershell
./scripts/start-streamable-http.ps1
```

Custom ports example:

```powershell
./scripts/start-streamable-http.ps1 -StudioPort 58742 -McpPort 59001
```

Use published package instead of local `dist`:

```powershell
./scripts/start-streamable-http.ps1 -UseNpx
```

Environment variables (daemon mode):

- `MCP_TRANSPORT=streamable-http` (or `--streamable-http`)
- `MCP_HTTP_HOST` (default `127.0.0.1`)
- `MCP_HTTP_PORT` (default `59000`)
- `MCP_HTTP_PATH` (default `/mcp`)
- `ROBLOX_STUDIO_PORT` (plugin bridge port, default `58741`)
- `ROBLOX_STUDIO_PORT_RETRY_COUNT` (set to `1` for single-primary behavior)

## Route Multiple Clients to One Studio (same proxy target)

Run one daemon, then point every MCP client to the same URL.

Codex example:

```toml
[mcp_servers.robloxstudio]
url = "http://127.0.0.1:59000/mcp"
enabled = true
```

Any other MCP client that supports URL transport should use the same endpoint:

```text
http://127.0.0.1:59000/mcp
```

This gives you one stable command endpoint per Studio target and works well in concurrent workflows.

## Proxy Behavior (when bridge port is already in use)

When another MCP instance cannot bind `ROBLOX_STUDIO_PORT`, it automatically forwards tool calls to the primary instance through `/proxy`.

- Primary instance owns plugin polling (`/poll`, `/response`)
- Secondary instances proxy tool requests to primary
- Plugin status can show `MCP bridge (proxying 1 instance)` / `MCP bridge (proxying N instances)` when forwarded traffic is active
- If a Studio instance connects to the wrong bridge target, the plugin shows an instance-mismatch warning and blocks commands until you switch to the correct port

## Multiple Studio Instances

Use one daemon per Studio target (unique bridge + MCP ports).

Example:

```powershell
# Studio A
./scripts/start-streamable-http.ps1 -StudioPort 58741 -McpPort 59000

# Studio B
./scripts/start-streamable-http.ps1 -StudioPort 58742 -McpPort 59001
```

Then configure separate MCP entries:

- `http://127.0.0.1:59000/mcp` -> Studio A
- `http://127.0.0.1:59001/mcp` -> Studio B

## What Can You Do?

Ask things like: *"What's the structure of this game?"*, *"Find scripts with deprecated APIs"*, *"Create 50 test NPCs in a grid"*, *"Optimize this movement code"*

---

**v2.3.0** - 37+ tools, asset property fetching, full HTTP API, Streamable HTTP transport, proxy bridge fallback, undo/redo tools, improved script source range handling, and stability updates

[Report Issues](https://github.com/boshyxd/robloxstudio-mcp/issues) | [DevForum](https://devforum.roblox.com/t/v180-roblox-studio-mcp-speed-up-your-workflow-by-letting-ai-read-paths-and-properties/3707071) | MIT Licensed
