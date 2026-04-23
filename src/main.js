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

function createEntry(source) {
  const entry = document.createElement('div');
  entry.className = 'entry pending';
  entry.innerHTML = `
    <div class="meta"><span class="dot"></span> ${source} · <span class="count">0</span> bytes</div>
    <div class="hex"></div>
    <div class="ascii"></div>
    <div class="copy-row">
      <button data-copy="hex">Copy Hex</button>
      <button data-copy="hex-compact">Copy Hex (compact)</button>
      <button data-copy="ascii">Copy ASCII</button>
      <button data-copy="bytes">Copy Byte Array</button>
      <button data-copy="base64">Copy Base64</button>
    </div>
  `;
  output.prepend(entry);
  return entry;
}

function updateEntry(entry, bytes) {
  entry.querySelector('.count').textContent = bytes.length;
  entry.querySelector('.hex').textContent = toHex(bytes);
  entry.querySelector('.ascii').textContent = toAscii(bytes);
  entry._bytes = bytes;
}

function bytesToBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function copyFromEntry(entry, kind) {
  const bytes = entry._bytes;
  if (!bytes) return;
  let text;
  switch (kind) {
    case 'hex': text = toHex(bytes); break;
    case 'hex-compact': text = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''); break;
    case 'ascii': text = toAscii(bytes); break;
    case 'bytes': text = '[' + Array.from(bytes).join(', ') + ']'; break;
    case 'base64': text = bytesToBase64(bytes); break;
    default: return;
  }
  try {
    await navigator.clipboard.writeText(text);
    flashCopied(entry, kind);
  } catch (e) {
    setStatus(`Copy failed: ${e.message}`);
  }
}

function flashCopied(entry, kind) {
  const btn = entry.querySelector(`button[data-copy="${kind}"]`);
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = 'Copied!';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = orig;
    btn.classList.remove('copied');
  }, 900);
}

output.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-copy]');
  if (!btn) return;
  const entry = btn.closest('.entry');
  if (entry) copyFromEntry(entry, btn.dataset.copy);
});

function makeAccumulator(source, idleMs = 150) {
  let chunks = [];
  let total = 0;
  let timer = null;
  let entry = null;

  const merge = () => {
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    return merged;
  };

  const flush = () => {
    if (!total || !entry) return;
    updateEntry(entry, merge());
    entry.classList.remove('pending');
    chunks = [];
    total = 0;
    entry = null;
  };

  return {
    push(bytes) {
      chunks.push(bytes);
      total += bytes.length;
      if (!entry) entry = createEntry(source);
      updateEntry(entry, merge());
      clearTimeout(timer);
      timer = setTimeout(flush, idleMs);
    },
    flush() {
      clearTimeout(timer);
      flush();
    },
  };
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
  const acc = makeAccumulator('serial');
  let stopped = false;

  (async () => {
    try {
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.byteLength) acc.push(value);
      }
    } catch (e) {
      if (!stopped) setStatus(`Serial error: ${e.message}`);
    }
  })();

  active = {
    async stop() {
      stopped = true;
      acc.flush();
      try { await reader.cancel(); } catch {}
      try { reader.releaseLock(); } catch {}
      try { await port.close(); } catch {}
    },
  };
}

async function startHid() {
  if (!('hid' in navigator)) throw new Error('WebHID not supported');
  const devices = await navigator.hid.requestDevice({
    filters: [{ usagePage: 0x8c }],
  });
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
  const infoEntry = createEntry('hid info');
  updateEntry(infoEntry, new TextEncoder().encode(JSON.stringify(info)));
  infoEntry.classList.remove('pending');

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

  const acc = makeAccumulator('hid');
  const handler = (event) => {
    const data = new Uint8Array(event.data.buffer);
    const combined = new Uint8Array(1 + data.length);
    combined[0] = event.reportId;
    combined.set(data, 1);
    acc.push(combined);
  };
  device.addEventListener('inputreport', handler);

  active = {
    async stop() {
      device.removeEventListener('inputreport', handler);
      acc.flush();
      try { await device.close(); } catch {}
    },
  };
}

async function startKeyboard() {
  setStatus('Keyboard capture active. Scan a barcode (focus the page).');
  const acc = makeAccumulator('keyboard', 200);

  const onKey = (e) => {
    let byte;
    if (e.key === 'Enter') byte = 0x0a;
    else if (e.key === 'Tab') byte = 0x09;
    else if (e.key.length === 1) byte = e.key.charCodeAt(0) & 0xff;
    else return;
    e.preventDefault();
    acc.push(new Uint8Array([byte]));
  };

  window.addEventListener('keydown', onKey);

  active = {
    async stop() {
      window.removeEventListener('keydown', onKey);
      acc.flush();
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
