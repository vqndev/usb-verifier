import './style.css';

const output = document.getElementById('output');
const statusEl = document.getElementById('status');
const supportEl = document.getElementById('support');

supportEl.textContent = [
  `Serial: ${'serial' in navigator ? 'yes' : 'no'}`,
  `HID: ${'hid' in navigator ? 'yes' : 'no'}`,
  `Keyboard: always`,
].join('  |  ');

let active = null;

function setStatus(msg) {
  statusEl.textContent = msg;
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

function toAscii(bytes) {
  return Array.from(bytes, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
}

function logBytes(source, bytes) {
  const entry = document.createElement('div');
  entry.className = 'entry';
  const t = new Date().toLocaleTimeString();
  entry.innerHTML = `
    <div class="meta">[${t}] ${source} · ${bytes.length} bytes</div>
    <div class="hex">${toHex(bytes)}</div>
    <div class="ascii">${toAscii(bytes)}</div>
  `;
  output.prepend(entry);
}

async function stop() {
  if (!active) return;
  try { await active.stop(); } catch (e) { console.error(e); }
  active = null;
  setStatus('Stopped.');
}

async function startSerial() {
  if (!('serial' in navigator)) throw new Error('Web Serial not supported');
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: 9600 });
  setStatus('Serial open @ 9600. Reading…');

  const reader = port.readable.getReader();
  let stopped = false;

  (async () => {
    try {
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.byteLength) logBytes('serial', value);
      }
    } catch (e) {
      if (!stopped) setStatus(`Serial error: ${e.message}`);
    }
  })();

  active = {
    async stop() {
      stopped = true;
      try { await reader.cancel(); } catch {}
      try { reader.releaseLock(); } catch {}
      try { await port.close(); } catch {}
    },
  };
}

async function startHid() {
  if (!('hid' in navigator)) throw new Error('WebHID not supported');
  const devices = await navigator.hid.requestDevice({ filters: [] });
  if (!devices.length) throw new Error('No device selected');
  const device = devices[0];

  const info = {
    productName: device.productName,
    vendorId: '0x' + device.vendorId.toString(16).padStart(4, '0'),
    productId: '0x' + device.productId.toString(16).padStart(4, '0'),
    opened: device.opened,
    collections: device.collections.map((c) => ({
      usagePage: '0x' + c.usagePage.toString(16),
      usage: '0x' + c.usage.toString(16),
      inputReports: c.inputReports?.length ?? 0,
      outputReports: c.outputReports?.length ?? 0,
      featureReports: c.featureReports?.length ?? 0,
    })),
  };
  console.log('HID device picked:', device, info);
  logBytes('hid info', new TextEncoder().encode(JSON.stringify(info)));

  if (!device.opened) {
    try {
      await device.open();
    } catch (err) {
      console.error('HID open failed:', err);
      const hint =
        '\nLinux hint: the kernel usbhid driver may have claimed this device. ' +
        'Try: sudo rmmod usbhid (temporary) or add a udev rule / unbind the interface. ' +
        'Keyboard-class devices are often blocked by the browser for security.';
      throw new Error(`${err.name || 'Error'}: ${err.message}${hint}`);
    }
  }
  setStatus(`HID open: ${device.productName} (vid=${info.vendorId} pid=${info.productId})`);

  const handler = (event) => {
    const data = new Uint8Array(event.data.buffer);
    const combined = new Uint8Array(1 + data.length);
    combined[0] = event.reportId;
    combined.set(data, 1);
    logBytes('hid report', combined);
  };
  device.addEventListener('inputreport', handler);

  active = {
    async stop() {
      device.removeEventListener('inputreport', handler);
      try { await device.close(); } catch {}
    },
  };
}

async function startKeyboard() {
  setStatus('Keyboard capture active. Scan a barcode (focus the page).');
  let buffer = [];
  let flushTimer = null;
  const FLUSH_MS = 80;

  const flush = () => {
    if (!buffer.length) return;
    const bytes = new Uint8Array(buffer.map((c) => c.charCodeAt(0) & 0xff));
    logBytes('keyboard', bytes);
    buffer = [];
  };

  const onKey = (e) => {
    if (e.key === 'Enter') {
      flush();
      e.preventDefault();
      return;
    }
    if (e.key.length === 1) {
      buffer.push(e.key);
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, FLUSH_MS);
    }
  };

  window.addEventListener('keydown', onKey);

  active = {
    async stop() {
      window.removeEventListener('keydown', onKey);
      clearTimeout(flushTimer);
      flush();
    },
  };
}

document.querySelector('.controls').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const mode = btn.dataset.mode;
  try {
    if (mode === 'stop') return stop();
    if (mode === 'clear') { output.innerHTML = ''; return; }
    await stop();
    if (mode === 'serial') await startSerial();
    else if (mode === 'hid') await startHid();
    else if (mode === 'keyboard') await startKeyboard();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  }
});
