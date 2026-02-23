# Example App

A self-contained dummy IPC server for manually testing the `mcp-server` bridge without a real app (e.g. Stream Deck). It listens on a Unix socket and speaks the same newline-delimited JSON protocol as the Stream Deck plugin.

---

## Prerequisites

- Node.js 18+ (ESM support required)
- The `mcp-server` bridge built (`pnpm build`)

---

## Setup: register the example app

Add the example app entry to `KNOWN_APPS` in `src/constants.ts`:

```ts
export const KNOWN_APPS: AppDefinition[] = [
    { name: "streamdeck", socketBaseName: "elgato-mcp-streamdeck" },
    { name: "example", socketBaseName: "elgato-mcp-example" }, // <-- add this
];
```

Rebuild after the change:

```bash
pnpm build
```

---

## Running

**Terminal 1 — start the example app:**

```bash
node example/example-app.js
```

**Terminal 2 — start the MCP bridge in stdio mode (for Claude Desktop):**

```bash
node bin/index.js --stdio
```

Or in HTTP mode:

```bash
node bin/index.js --http
```

The example app sends a signal to the bridge's signal socket on startup so the bridge reconnects automatically. If you start the bridge after the app, it will pick it up within ~3 seconds via the polling fallback.

---

## Tools

| Tool             | Description                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `echo`           | Echoes back the provided `text`. Good for basic connectivity checks.                                                                                               |
| `get_weather`    | Fetches live weather from [wttr.in](https://wttr.in). Uses **elicitation** to prompt for city and time range before fetching.                                      |
| `notes`          | Stateful in-memory note-taking. Actions: `add` (requires `title` + `content`), `list`, `delete` (requires `title`). Notes persist for the lifetime of the process. |
| `slow_operation` | Sleeps for `seconds` seconds (1–60) then returns. Use to test request timeout behavior.                                                                            |
| `failing_tool`   | Always returns an error result (not an exception). Use to test error-handling paths.                                                                               |

---

## Resources

| URI             | Name         | Description                                                      |
| --------------- | ------------ | ---------------------------------------------------------------- |
| `status://app`  | `app_status` | Live JSON: `uptime_seconds`, `connected_clients`, `notes_count`. |
| `docs://readme` | `readme`     | Plain-text description of the app and its tools.                 |

---

## `get_weather` — elicitation flow

`get_weather` demonstrates the MCP elicitation protocol:

1. Claude calls the `example__get_weather` tool.
2. The bridge forwards a `call_tool` request to the example app.
3. The example app sends an `elicitation/create` message back to the bridge asking for **City** and **When** (now / today / tomorrow).
4. The bridge surfaces a form to the user (in Claude Desktop this appears as an interactive prompt).
5. The user fills in the form and submits.
6. The bridge sends `elicitation/response` back to the example app.
7. The example app fetches `https://wttr.in/<city>?format=j1` and returns a formatted weather summary.

If the user cancels or declines the form, the tool returns an error message instead.

---

## Socket paths

| Path                                 | Purpose                                        |
| ------------------------------------ | ---------------------------------------------- |
| `/tmp/elgato-mcp-example.sock`       | Main IPC socket (bridge connects here)         |
| `/tmp/elgato-mcp-example-ready.sock` | Signal socket (app notifies bridge on startup) |

Both files are cleaned up on startup and on SIGINT/SIGTERM.
