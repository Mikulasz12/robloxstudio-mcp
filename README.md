# Roblox Studio MCP Server

**Connect AI assistants like Claude and Gemini to Roblox Studio**

[![NPM Version](https://img.shields.io/npm/v/robloxstudio-mcp)](https://www.npmjs.com/package/robloxstudio-mcp)

---

## What is This?

An MCP server that lets AI explore your game structure, read/edit scripts, and perform bulk changes all locally and safely.

## Setup

1. Install the [Studio plugin](https://github.com/boshyxd/robloxstudio-mcp/releases) to your Plugins folder
2. Enable **Allow HTTP Requests** in Experience Settings > Security
3. Connect your AI:

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
<summary>Other MCP clients (Claude Desktop, Cursor, etc.)</summary>

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
</details>

## Shared Daemon Mode (Recommended for Multiple Codex/Claude Sessions)

The quick-start `npx ...` commands above use stdio, which launches one MCP process per client session.

If you want multiple AI sessions to share one MCP instance, run this server in Streamable HTTP mode and connect clients with a `url`.

Start daemon:

```bash
npx -y robloxstudio-mcp@latest --streamable-http
```

Windows PowerShell helper (repo checkout):

```powershell
./scripts/start-streamable-http.ps1
```

Example with custom ports:

```powershell
./scripts/start-streamable-http.ps1 -StudioPort 58742 -McpPort 59001
```

Use published package instead of local `dist`:

```powershell
./scripts/start-streamable-http.ps1 -UseNpx
```

Environment variables:

- `MCP_TRANSPORT=streamable-http` (or `--streamable-http`)
- `MCP_HTTP_HOST` (default `127.0.0.1`)
- `MCP_HTTP_PORT` (default `59000`)
- `MCP_HTTP_PATH` (default `/mcp`)
- `ROBLOX_STUDIO_PORT` (plugin bridge port, default `58741`)
- `ROBLOX_STUDIO_PORT_RETRY_COUNT` (set to `1` for single-primary behavior)

Codex config example:

```toml
[mcp_servers.robloxstudio]
url = "http://127.0.0.1:59000/mcp"
enabled = true
```

Run one daemon per Studio target (per plugin bridge port). For a second Studio instance, run another daemon with a different `ROBLOX_STUDIO_PORT` and `MCP_HTTP_PORT`.

## What Can You Do?

Ask things like: *"What's the structure of this game?"*, *"Find scripts with deprecated APIs"*, *"Create 50 test NPCs in a grid"*, *"Optimize this movement code"*

---

**v1.9.0** — 37+ tools, asset property fetching, full HTTP API, improved stability

[Report Issues](https://github.com/boshyxd/robloxstudio-mcp/issues) | [DevForum](https://devforum.roblox.com/t/v180-roblox-studio-mcp-speed-up-your-workflow-by-letting-ai-read-paths-and-properties/3707071) | MIT Licensed
