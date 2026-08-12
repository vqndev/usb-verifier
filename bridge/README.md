# Capture bridge

Optional local helper for scripted or hands-free captures. The web page's
Serial/HID buttons use the browser's device-chooser dialogs, which always
require a human click. The bridge captures the same bytes at the OS level
and streams them into the page over a WebSocket instead — no dialogs.

The existing chooser-based flow is unchanged; the bridge is purely additive.

## Setup

```bash
pip install -r requirements.txt
python bridge.py            # listens on 127.0.0.1:8765
```

Then open the page, expand "Capture bridge", leave the host as
`localhost:8765`, and use the **B-Serial** / **B-HID** buttons on a device
panel. The bridge must run on the same machine as the browser (browsers
only allow a hosted HTTPS page to talk to plain-HTTP localhost).

Works on Windows and Linux. Linux notes: HID needs the same udev rule the
page's Linux setup section shows (hidraw access), serial needs dialout
group membership.

## Endpoints

- `GET /devices` — JSON inventory of serial ports and HID interfaces.
- `WS /stream?mode=serial&port=<port>&baud=9600` — stream a serial port.
- `WS /stream?mode=hid&path=<path>` — stream a HID interface (one binary
  frame per input report).

Keyboard-wedge mode needs no bridge: the device types like a keyboard, so
the page's normal Keyboard capture works as long as the page has focus.
