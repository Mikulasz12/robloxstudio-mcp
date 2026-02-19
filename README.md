# Roblox Studio MCP Server

**Connect AI assistants like Codex, Claude, Copilot, and Gemini to Roblox Studio**

[![NPM Version](https://img.shields.io/npm/v/robloxstudio-mcp)](https://www.npmjs.com/package/robloxstudio-mcp)

---

## What Is This?

An MCP server that lets AI explore your game structure, read/edit scripts, and perform bulk changes locally.

## Quick Setup

1. Install the [Studio plugin](https://github.com/boshyxd/robloxstudio-mcp/releases) to your Plugins folder
2. Enable **Allow HTTP Requests** in Experience Settings > Security
3. Connect your AI client

**Claude Code:**
```bash
claude mcp add robloxstudio -- npx -y robloxstudio-mcp@latest
```

**Codex CLI:**
```bash
codex mcp add robloxstudio -- npx -y robloxstudio-mcp@latest
```

**Gemini CLI:**
```bash
gemini mcp add robloxstudio npx --trust -- -y robloxstudio-mcp@latest
```

Plugin shows "Connected" when ready.

<details>
<summary>Other MCP clients (Claude Desktop, Cursor, Copilot MCP-compatible clients, etc.)</summary>

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

## Default: One Studio Instance (No Daemon)

If you are working with one Studio instance, use `stdio` and do not run a daemon.

Some AI clients (including Codex) can open multiple MCP sessions. If they use the same Studio port, only one server owns that port and the others automatically forward through it.

Use this plugin URL:

```text
http://localhost:58741
```

## Multiple Studio Instances

For concurrent workflows, run one MCP server per Studio instance on different ports.

2+ workflow pattern (no daemon):

1. Workflow A:
`ROBLOX_STUDIO_PORT=58741 npx -y robloxstudio-mcp@latest`
Plugin URL: `http://localhost:58741`
2. Workflow B:
`ROBLOX_STUDIO_PORT=58742 npx -y robloxstudio-mcp@latest`
Plugin URL: `http://localhost:58742`
3. Workflow C+:
increment the port for each additional workflow (`58743`, `58744`, ...)

Keep each workflow mapped to its own port end-to-end.

If you want two or more clients on the same workflow/Studio, point them to the same port. One MCP server owns the port; all additional sessions forward to it automatically.

## Optional: Shared Daemon Mode

Daemon mode is optional. Use it only when you want a shared long-running `url` endpoint.

Useful in simple terms:

- You want one stable MCP URL instead of starting a new server per client.
- You have multiple AI clients and want them all pointed at the same endpoint.
- You want long-running server state/logs in one place.

Start daemon:

```bash
npx -y robloxstudio-mcp@latest --streamable-http
```

Client `url`:

```text
http://127.0.0.1:59000/mcp
```

Environment options:

- `MCP_TRANSPORT=streamable-http`
- `MCP_HTTP_HOST` (default `127.0.0.1`)
- `MCP_HTTP_PORT` (default `59000`)
- `MCP_HTTP_PATH` (default `/mcp`)
- `ROBLOX_STUDIO_PORT` (default `58741`)
- `ROBLOX_STUDIO_PORT_RETRY_COUNT` (set `1` for single-primary behavior)

## What Can You Do?

Ask things like: *"What's the structure of this game?"*, *"Find scripts with deprecated APIs"*, *"Create 50 test NPCs in a grid"*, *"Optimize this movement code"*

---

**v2.3.0** - 37+ tools, asset property fetching, full HTTP API, Streamable HTTP transport, proxy bridge fallback, undo/redo tools, improved script source range handling, and stability updates

[Report Issues](https://github.com/boshyxd/robloxstudio-mcp/issues) | [DevForum](https://devforum.roblox.com/t/v180-roblox-studio-mcp-speed-up-your-workflow-by-letting-ai-read-paths-and-properties/3707071) | MIT Licensed
