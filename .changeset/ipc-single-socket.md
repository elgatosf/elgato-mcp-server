---
"@elgato/mcp-server": patch
---

Fix `Failed to parse message` errors and 30-second request timeouts when several bridges run at once. A second bridge's startup probe looked like the app's ready signal, so the first bridge opened an extra socket to the app and mixed both streams in one buffer. The bridge now keeps one socket per app, ignores events from replaced sockets, marks its probe so other bridges ignore it, decodes UTF-8 correctly across chunk boundaries, and runs tool/resource refreshes one at a time.
