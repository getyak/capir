# Nango user-defined MCP integration

Source: https://cubxxw.com/zh/ai-agent/posts/nango-user-defined-mcp-integration/
Author: Xinwei Xiong
Published: 2026-10-03
Captured: 2026-10-04
Purpose: user-authorized design and implementation reference for Talent Signal.

The article separates runtime tools from credential custody, requires product-owned account/connection authorization, original input schema validation, namespace routing, durable task checkpoints and honest unknown outcomes for effects. Generic Nango OAuth requires DCR/CIMD; no-auth and API-key servers need separate paths. A connection handshake is not business-call acceptance. Verify provider APIs/protocol support from actual source and observed endpoints before adopting examples.

Implementation plan: ../../plans/2026-10-04-user-mcp-interactions.md
