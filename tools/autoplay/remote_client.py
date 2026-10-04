"""Call one tool on a kyty MCP server served over HTTP (mcp_server.py --http behind a tunnel).

    remote_client.py list
    remote_client.py <tool> '<json arguments>'

The URL and key are never kept in the repository. Give them as KYTY_REMOTE_URL and KYTY_REMOTE_KEY,
or as KYTY_REMOTE_FILE, a private file whose first line is the URL (ending in /mcp) and second line
the key. Images are saved under KYTY_REMOTE_SHOTS (default ./remote_shots) and the path is printed.

Run it with the virtualenv that has the MCP SDK: tools/autoplay/.venv/bin/python (setup-mcp.sh).
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
from pathlib import Path

# The SDK drops a server event larger than this; a 4K PNG screenshot is several MB.
MAX_EVENT_BYTES = 64 * 1024 * 1024


def credentials() -> tuple[str, str]:
    url, key = os.environ.get("KYTY_REMOTE_URL", ""), os.environ.get("KYTY_REMOTE_KEY", "")
    path = os.environ.get("KYTY_REMOTE_FILE")
    if path and not (url and key):
        lines = Path(path).read_text().split()
        url, key = lines[0], lines[1]
    if not url or not key:
        sys.exit("set KYTY_REMOTE_URL and KYTY_REMOTE_KEY, or KYTY_REMOTE_FILE (url on line 1, key on line 2)")
    return url, key


async def call(tool: str, args: dict) -> None:
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client
    from mcp.shared._httpx_utils import create_mcp_http_client

    url, key = credentials()
    shots = Path(os.environ.get("KYTY_REMOTE_SHOTS", "remote_shots"))
    client = create_mcp_http_client(headers={"Authorization": f"Bearer {key}"})
    async with client:
        async with streamable_http_client(url, http_client=client,
                                          max_sse_event_size=MAX_EVENT_BYTES) as streams:
            async with ClientSession(streams[0], streams[1]) as session:
                await session.initialize()
                if tool == "list":
                    for t in (await session.list_tools()).tools:
                        print(t.name)
                    return
                result = await session.call_tool(tool, args)
                for item in result.content:
                    if item.type == "text":
                        print(item.text)
                    elif item.type == "image":
                        shots.mkdir(parents=True, exist_ok=True)
                        out = shots / f"{args.get('name') or 'shot'}.png"
                        out.write_bytes(base64.b64decode(item.data))
                        print(f"[image saved to {out}]")


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    asyncio.run(call(sys.argv[1], json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}))


if __name__ == "__main__":
    main()
