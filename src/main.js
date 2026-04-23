import './style.css';
import { diffArrays } from 'diff';

const supportEl = document.getElementById('support');
supportEl.textContent = [
  `Serial: ${'serial' in navigator ? 'yes' : 'no'}`,
  `HID: ${'hid' in navigator ? 'yes' : 'no'}`,
  `Keyboard: always`,
].join('  |  ');

const diffVerdict = document.getElementById('diff-verdict');
const diffView = document.getElementById('diff-view');

const slots = {};
for (const el of document.querySelectorAll('.slot')) {
  const id = el.dataset.slot;
  slots[id] = {
    id,
    el,
    output: el.querySelector('.output'),
    statusEl: el.querySelector('.status'),
    active: null,
    lastBytes: null,
  };
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

function toAscii(bytes) {
  return Array.from(bytes, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
}

function setStatus(slot, msg) {
  slot.statusEl.textContent = msg;
}

function createEntry(slot, source) {
  const entry = document.createElement('div');
  entry.className = 'entry pending';
  entry.innerHTML = `
    <div class="meta"><span class="dot"></span> ${source} · <span class="count">0</span> bytes</div>
    <div class="hex"></div>
    <div class="ascii"></div>
    <div class="copy-row">
      <button data-copy="hex">Hex</button>
      <button data-copy="hex-compact">Hex (compact)</button>
      <button data-copy="ascii">ASCII</button>
      <button data-copy="bytes">Byte Array</button>
      <button data-copy="base64">Base64</button>
    </div>
  `;
  slot.output.prepend(entry);
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
    const btn = entry.querySelector(`button[data-copy="${kind}"]`);
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 900);
    }
  } catch (e) {
    console.error('Copy failed', e);
  }
}

function makeAccumulator(slot, source, idleMs = 150) {
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
    const merged = merge();
    updateEntry(entry, merged);
    entry.classList.remove('pending');
    slot.lastBytes = merged;
    chunks = [];
    total = 0;
    entry = null;
    renderDiff();
  };

  return {
    push(bytes) {
      chunks.push(bytes);
      total += bytes.length;
      if (!entry) entry = createEntry(slot, source);
      updateEntry(entry, merge());
      clearTimeout(timer);
      timer = setTimeout(flush, idleMs);
    },
    flush() { clearTimeout(timer); flush(); },
  };
}

async function stopSlot(slot) {
  if (!slot.active) return;
  try { await slot.active.stop(); } catch (e) { console.error(e); }
  slot.active = null;
  setStatus(slot, 'Stopped.');
}

async function startSerial(slot) {
  if (!('serial' in navigator)) throw new Error('Web Serial not supported');
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: 9600 });
  setStatus(slot, 'Serial open @ 9600. Reading…');

  const reader = port.readable.getReader();
  const acc = makeAccumulator(slot, 'serial');
  let stopped = false;

  (async () => {
    try {
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.byteLength) acc.push(value);
      }
    } catch (e) {
      if (!stopped) setStatus(slot, `Serial error: ${e.message}`);
    }
  })();

  slot.active = {
    async stop() {
      stopped = true;
      acc.flush();
      try { await reader.cancel(); } catch {}
      try { reader.releaseLock(); } catch {}
      try { await port.close(); } catch {}
    },
  };
}

async function startHid(slot) {
  if (!('hid' in navigator)) throw new Error('WebHID not supported');
  const devices = await navigator.hid.requestDevice({
    filters: [{ usagePage: 0x8c }],
  });
  if (!devices.length) throw new Error('No device selected');
  const device = devices[0];

  if (!device.opened) {
    try {
      await device.open();
    } catch (err) {
      const hint = ' (Linux: needs udev rule granting hidraw access)';
      throw new Error(`${err.name || 'Error'}: ${err.message}${hint}`);
    }
  }
  setStatus(slot, `HID open: ${device.productName} (${device.vendorId.toString(16)}:${device.productId.toString(16)})`);

  const acc = makeAccumulator(slot, 'hid');
  const handler = (event) => {
    const data = new Uint8Array(event.data.buffer);
    const combined = new Uint8Array(1 + data.length);
    combined[0] = event.reportId;
    combined.set(data, 1);
    acc.push(combined);
  };
  device.addEventListener('inputreport', handler);

  slot.active = {
    async stop() {
      device.removeEventListener('inputreport', handler);
      acc.flush();
      try { await device.close(); } catch {}
    },
  };
}

async function startKeyboard(slot) {
  setStatus(slot, 'Keyboard capture active. Focus this panel and scan.');
  const acc = makeAccumulator(slot, 'keyboard', 200);

  const onKey = (e) => {
    if (!slot.el.contains(document.activeElement) && document.activeElement !== document.body) return;
    let byte;
    if (e.key === 'Enter') byte = 0x0a;
    else if (e.key === 'Tab') byte = 0x09;
    else if (e.key.length === 1) byte = e.key.charCodeAt(0) & 0xff;
    else return;
    e.preventDefault();
    acc.push(new Uint8Array([byte]));
  };

  slot.el.tabIndex = 0;
  slot.el.focus();
  window.addEventListener('keydown', onKey);

  slot.active = {
    async stop() {
      window.removeEventListener('keydown', onKey);
      acc.flush();
    },
  };
}

function renderDiff() {
  const a = slots['1'].lastBytes;
  const b = slots['2'].lastBytes;

  if (!a || !b) {
    diffVerdict.className = 'diff-verdict';
    diffVerdict.textContent = a || b
      ? `Waiting for scan on Device ${a ? '2' : '1'}…`
      : 'Waiting for scans on both devices…';
    diffView.innerHTML = '';
    return;
  }

  const equal = a.length === b.length && a.every((v, i) => v === b[i]);
  if (equal) {
    diffVerdict.className = 'diff-verdict match';
    diffVerdict.textContent = `✓ MATCH — ${a.length} bytes identical`;
  } else {
    diffVerdict.className = 'diff-verdict mismatch';
    diffVerdict.textContent = `✗ DIFFER — Device 1: ${a.length} bytes, Device 2: ${b.length} bytes`;
  }

  const parts = diffArrays(Array.from(a), Array.from(b));
  const hexHtml = parts.map((p) => {
    const hex = p.value.map((v) => v.toString(16).padStart(2, '0')).join(' ');
    if (p.added) return `<span class="add">+${hex}</span>`;
    if (p.removed) return `<span class="del">-${hex}</span>`;
    return `<span class="eq">${hex}</span>`;
  }).join(' ');

  const asciiParts = diffArrays(Array.from(a), Array.from(b));
  const asciiHtml = asciiParts.map((p) => {
    const s = p.value.map((v) => (v >= 0x20 && v < 0x7f ? String.fromCharCode(v) : '.')).join('');
    if (p.added) return `<span class="add">${s}</span>`;
    if (p.removed) return `<span class="del">${s}</span>`;
    return `<span class="eq">${s}</span>`;
  }).join('');

  diffView.innerHTML =
    `<span class="section-label">HEX DIFF (−Device 1, +Device 2)</span>${hexHtml}\n\n` +
    `<span class="section-label">ASCII DIFF</span>${asciiHtml}`;
}

document.addEventListener('click', async (e) => {
  const copyBtn = e.target.closest('button[data-copy]');
  if (copyBtn) {
    const entry = copyBtn.closest('.entry');
    if (entry) copyFromEntry(entry, copyBtn.dataset.copy);
    return;
  }

  const modeBtn = e.target.closest('.slot button[data-mode]');
  if (!modeBtn) return;

  const slotEl = modeBtn.closest('.slot');
  const slot = slots[slotEl.dataset.slot];
  const mode = modeBtn.dataset.mode;

  try {
    if (mode === 'stop') return stopSlot(slot);
    if (mode === 'clear') {
      slot.output.innerHTML = '';
      slot.lastBytes = null;
      renderDiff();
      return;
    }
    await stopSlot(slot);
    if (mode === 'serial') await startSerial(slot);
    else if (mode === 'hid') await startHid(slot);
    else if (mode === 'keyboard') await startKeyboard(slot);
  } catch (err) {
    setStatus(slot, `Error: ${err.message}`);
    console.error(err);
  }
});
