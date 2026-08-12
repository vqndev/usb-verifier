#!/usr/bin/env python3
"""Local capture bridge for the USB Verifier web page.

Captures bytes from a serial port or a HID device at the OS level and
streams them to the page over a WebSocket, bypassing the browser's
device-chooser dialogs. Run it on the same machine as the browser and
point the page's Bridge field at it (default localhost:8765).

  python bridge.py [--host 127.0.0.1] [--port 8765]

Endpoints:
  GET /devices
      JSON inventory: {"serial": [{port, description}...],
                       "hid": [{path, vendor_id, product_id,
                                usage_page, usage, product}...]}
  WS  /stream?mode=serial&port=COM17&baud=9600
  WS  /stream?mode=hid&path=<url-encoded path from /devices>
      Binary frames, one per read (HID: one frame per input report).

CORS is wide open (any origin, private-network preflight allowed) so the
hosted page can reach a localhost bridge.

Works on Windows and Linux. On Linux, /dev/hidraw* nodes are root-only by
default; use the same udev rule the page's Linux setup note describes (or
run the bridge with sudo) so HID capture can open the device. Serial needs
the usual dialout-group membership.
"""

import argparse
import asyncio
import json

from aiohttp import web

try:
    import serial as pyserial
    import serial.tools.list_ports as list_ports
except ImportError:  # pragma: no cover
    pyserial = None
    list_ports = None

try:
    import hid
except ImportError:  # pragma: no cover
    hid = None


CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    # Chrome sends a private-network preflight when a public page talks
    # to a local server; without this header the request silently fails.
    "Access-Control-Allow-Private-Network": "true",
}


def list_devices():
    out = {"serial": [], "hid": []}
    if list_ports:
        for p in list_ports.comports():
            out["serial"].append({
                "port": p.device,
                "description": p.description or "",
                "vid": p.vid,
                "pid": p.pid,
            })
    if hid:
        for d in hid.enumerate():
            out["hid"].append({
                # surrogateescape round-trips any raw bytes in the platform
                # device path (Windows GUID paths, Linux /dev/hidraw*)
                "path": d["path"].decode("utf-8", "surrogateescape"),
                "vendor_id": d["vendor_id"],
                "product_id": d["product_id"],
                "usage_page": d["usage_page"],
                "usage": d["usage"],
                "product": d.get("product_string") or "",
            })
    return out


async def devices_handler(request):
    return web.json_response(list_devices(), headers=CORS_HEADERS)


async def preflight_handler(request):
    return web.Response(status=204, headers=CORS_HEADERS)


async def stream_serial(ws, query):
    if pyserial is None:
        raise RuntimeError("pyserial is not installed")
    port = query.get("port")
    if not port:
        raise ValueError("missing ?port=")
    baud = int(query.get("baud", "9600"))
    conn = pyserial.Serial(port, baud, timeout=0.05)
    print(f"serial open: {port} @ {baud}")
    try:
        while not ws.closed:
            data = await asyncio.to_thread(conn.read, 4096)
            if data:
                await ws.send_bytes(data)
    finally:
        conn.close()
        print(f"serial closed: {port}")


async def stream_hid(ws, query):
    if hid is None:
        raise RuntimeError("hidapi is not installed")
    path = query.get("path")
    if not path:
        raise ValueError("missing ?path=")
    dev = hid.device()
    dev.open_path(path.encode("utf-8", "surrogateescape"))
    dev.set_nonblocking(True)
    print(f"hid open: {path}")

    def read_report():
        return dev.read(64)

    try:
        while not ws.closed:
            report = await asyncio.to_thread(read_report)
            if report:
                await ws.send_bytes(bytes(report))
            else:
                await asyncio.sleep(0.005)
    finally:
        dev.close()
        print(f"hid closed: {path}")


async def stream_handler(request):
    # heartbeat so a vanished client (page reload, crash) is detected and
    # the serial port / HID handle is released instead of held forever
    ws = web.WebSocketResponse(heartbeat=5)
    await ws.prepare(request)
    mode = request.query.get("mode")
    try:
        if mode == "serial":
            await stream_serial(ws, request.query)
        elif mode == "hid":
            await stream_hid(ws, request.query)
        else:
            await ws.close(message=b"mode must be serial or hid")
    except Exception as e:  # surface the reason to the page before closing
        print(f"stream error: {e}")
        if not ws.closed:
            await ws.close(message=str(e).encode()[:120])
    return ws


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()

    app = web.Application()
    app.router.add_get("/devices", devices_handler)
    app.router.add_options("/{tail:.*}", preflight_handler)
    app.router.add_get("/stream", stream_handler)

    print(f"USB Verifier bridge on http://{args.host}:{args.port}")
    print(f"  serial support: {'yes' if pyserial else 'NO (pip install pyserial)'}")
    print(f"  hid support:    {'yes' if hid else 'NO (pip install hidapi)'}")
    web.run_app(app, host=args.host, port=args.port, print=None)


if __name__ == "__main__":
    main()
