import './style.css';
import { diffArrays } from 'diff';
import { version } from '../package.json';

document.getElementById('version').textContent = `v${version}`;

const supportEl = document.getElementById('support');
supportEl.textContent = [
  `Serial: ${'serial' in navigator ? 'yes' : 'no'}`,
  `HID: ${'hid' in navigator ? 'yes' : 'no'}`,
  `Keyboard: always`,
].join('  |  ');

const UDEV_CMD = `echo 'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="04d8", ATTRS{idProduct}=="f057", MODE="0660", TAG+="uaccess"' | sudo tee /etc/udev/rules.d/70-mdlr-hidraw.rules && sudo udevadm control --reload-rules && sudo udevadm trigger --subsystem-match=hidraw`;

const isLinux = /Linux/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent);
const linuxSetup = document.getElementById('linux-setup');
if (isLinux && linuxSetup) {
  linuxSetup.hidden = false;
  document.getElementById('udev-cmd').textContent = UDEV_CMD;
  document.getElementById('copy-udev-btn').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(UDEV_CMD);
      const btn = e.currentTarget;
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 900);
    } catch (err) {
      console.error('Copy failed', err);
    }
  });
}

const diffVerdict = document.getElementById('diff-verdict');
const diffView = document.getElementById('diff-view');
const dlDiff = document.getElementById('dl-diff');
const ioStatus = document.getElementById('io-status');

const AAMVA_FIELDS = {
  DAA: 'Full Name (legacy)',
  DAB: 'Family Name (legacy)',
  DAC: 'First Name',
  DAD: 'Middle Name',
  DAE: 'Name Suffix',
  DAF: 'Name Prefix',
  DAG: 'Address Street 1',
  DAH: 'Address Street 2',
  DAI: 'Address City',
  DAJ: 'Address State',
  DAK: 'Address Postal Code',
  DAL: 'Residence Street 1',
  DAM: 'Residence Street 2',
  DAN: 'Residence City',
  DAO: 'Residence State',
  DAP: 'Residence Postal Code',
  DAQ: 'Customer ID',
  DAR: 'Vehicle Class (legacy)',
  DAS: 'Restriction Codes (legacy)',
  DAT: 'Endorsements (legacy)',
  DAU: 'Height',
  DAV: 'Height (cm)',
  DAW: 'Weight (lbs)',
  DAX: 'Weight (kg)',
  DAY: 'Eye Color',
  DAZ: 'Hair Color',
  DBA: 'Expiration Date',
  DBB: 'Date of Birth',
  DBC: 'Sex',
  DBD: 'Issue Date',
  DBE: 'Issuer IIN',
  DBF: 'Additional Jurisdiction Info',
  DBG: 'Name Suffix',
  DBH: 'Organ Donor (legacy)',
  DBI: 'Non-Resident',
  DBJ: 'Unique Customer Idx',
  DBK: 'SSN',
  DBL: 'Date of Birth (legacy)',
  DBM: 'SSN (legacy)',
  DBN: 'Alias Family Name',
  DBO: 'Alias Given Name',
  DBP: 'Alias Middle Name',
  DBQ: 'Alias Prefix Name',
  DBR: 'Name Suffix',
  DBS: 'Alias Suffix',
  DCA: 'Vehicle Class',
  DCB: 'Restriction Codes',
  DCD: 'Endorsement Codes',
  DCE: 'Physical Description Weight Range',
  DCF: 'Document Discriminator',
  DCG: 'Country ID',
  DCH: 'Federal Commercial Vehicle Codes',
  DCI: 'Place of Birth',
  DCJ: 'Audit Information',
  DCK: 'Inventory Control Number',
  DCL: 'Race/Ethnicity',
  DCM: 'Std Vehicle Classification',
  DCN: 'Std Endorsement Code',
  DCO: 'Std Restriction Code',
  DCP: 'Std Vehicle Description',
  DCQ: 'Std Endorsement Description',
  DCR: 'Std Restriction Description',
  DCS: 'Family Name',
  DCT: 'First + Middle Name',
  DCU: 'Name Suffix',
  DDA: 'Compliance Type',
  DDB: 'Card Revision Date',
  DDC: 'HazMat Expiration',
  DDD: 'Limited Duration Indicator',
  DDE: 'Family Name Truncation',
  DDF: 'First Name Truncation',
  DDG: 'Middle Name Truncation',
  DDH: 'Under 18 Until',
  DDI: 'Under 19 Until',
  DDJ: 'Under 21 Until',
  DDK: 'Organ Donor',
  DDL: 'Veteran Indicator',
};

const HEADER_LABELS = {
  complianceIndicator: 'Compliance Indicator',
  fileType: 'File Type',
  iin: 'Issuer Identification Number (IIN)',
  aamvaVersion: 'AAMVA Version',
  jurisdictionVersion: 'Jurisdiction Version',
  subfileCount: 'Number of Subfiles',
};

function parseAAMVAHeader(bytes) {
  if (!bytes) return null;
  const text = new TextDecoder('latin1').decode(bytes);
  const m = text.match(/(@)[\s\S]*?(ANSI )(\d{6})(\d{2})(\d{2})(\d{2})((?:[A-Z0-9]{2}\d{8}){1,})/);
  if (!m) return null;
  const [, compliance, fileType, iin, aamvaVersion, jvVersion, subfileCount, subfilesStr] = m;
  const count = parseInt(subfileCount, 10);
  const subfiles = [];
  for (let i = 0; i < count && i * 10 + 10 <= subfilesStr.length; i++) {
    subfiles.push({
      type: subfilesStr.slice(i * 10, i * 10 + 2),
      offset: subfilesStr.slice(i * 10 + 2, i * 10 + 6),
      length: subfilesStr.slice(i * 10 + 6, i * 10 + 10),
    });
  }
  return {
    complianceIndicator: compliance,
    fileType: fileType.trim(),
    iin,
    aamvaVersion,
    jurisdictionVersion: jvVersion,
    subfileCount,
    subfiles,
  };
}

function parseAAMVA(bytes) {
  if (!bytes) return null;
  const text = new TextDecoder('latin1').decode(bytes);
  if (!/ANSI/.test(text)) return null;
  const fields = {};
  const lines = text.split(/[\n\r\x1e]/);
  for (let line of lines) {
    if (/ANSI/.test(line)) {
      const m = line.match(/DL([A-Z]{2}[A-Z0-9].*)$/);
      if (m) line = m[1];
      else continue;
    }
    const prefix = line.match(/^(?:DL|Z[A-Z0-9])(?=[A-Z]{2}[A-Z0-9])/);
    if (prefix) line = line.slice(2);
    if (line.length < 3) continue;
    const code = line.slice(0, 3);
    if (!/^[A-Z]{2}[A-Z0-9]$/.test(code)) continue;
    const value = line.slice(3).trim();
    if (!(code in fields)) fields[code] = value;
  }
  return Object.keys(fields).length ? fields : null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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
    filters: [{ usagePage: 0x8c }, { usagePage: 0xff00 }],
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
    if (event.reportId === 0) {
      acc.push(data);
    } else {
      const combined = new Uint8Array(1 + data.length);
      combined[0] = event.reportId;
      combined.set(data, 1);
      acc.push(combined);
    }
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

// --- Per-slot import (hex text, export format, or raw binary) ---

function parseSlotImport(buffer, slotId) {
  const bytes = new Uint8Array(buffer);
  // decode as text to see whether this is hex / export-format content
  let text = null;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return bytes; // not text: raw binary capture
  }
  let body = text;
  if (text.includes('---SPLIT---')) {
    // whole-export file: take the half that matches this slot
    const parts = text.split('---SPLIT---');
    body = (slotId === '1' ? parts[0] : parts[1]) ?? '';
    if (!body.trim()) throw new Error(`export has no data for Device ${slotId}`);
  }
  const clean = body.replace(/0x/gi, '').replace(/[\s,]/g, '').toLowerCase();
  if (clean && /^[0-9a-f]+$/.test(clean) && clean.length % 2 === 0) {
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  // plain text that isn't hex: keep its raw bytes
  return bytes;
}

function importIntoSlot(slot, buffer, label) {
  const data = parseSlotImport(buffer, slot.id);
  injectBytesIntoSlot(slot, data, label);
  renderDiff();
  setStatus(slot, `Imported ${data.length} bytes (${label}).`);
}

async function importSlotFromClipboard(slot) {
  const text = await navigator.clipboard.readText();
  if (!text.trim()) throw new Error('clipboard is empty');
  importIntoSlot(slot, new TextEncoder().encode(text).buffer, 'clipboard');
}

function importSlotFromFile(slot) {
  const input = slot.el.querySelector('.slot-file-input');
  input.onchange = async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    try {
      importIntoSlot(slot, await file.arrayBuffer(), file.name);
    } catch (err) {
      setStatus(slot, `Error: ${err.message}`);
    }
  };
  input.click();
}

// --- Capture bridge (local helper streaming OS-level Serial/HID over WS) ---

const bridgeHostInput = document.getElementById('bridge-host');
bridgeHostInput.value = localStorage.getItem('bridgeHost') || '';
bridgeHostInput.addEventListener('input', () => localStorage.setItem('bridgeHost', bridgeHostInput.value));
const bridgeHost = () => bridgeHostInput.value.trim() || bridgeHostInput.placeholder;

function pickBridgeDevice(devices, kind) {
  if (kind === 'serial') {
    // prefer USB serial adapters over Bluetooth links
    const ports = devices.serial;
    return ports.find((p) => p.vid != null) || ports[0] || null;
  }
  // vendor-defined or bar-code-scanner usage pages, same filter as WebHID mode
  const candidates = devices.hid.filter((d) => d.usage_page === 0xff00 || d.usage_page === 0x8c);
  // wireless dongles etc. also expose vendor pages; prefer a scanner usage
  // page, then a device whose vendor also enumerates a serial port
  // (composite scanner), then whatever is left
  const serialVids = new Set(devices.serial.map((p) => p.vid).filter((v) => v != null));
  return candidates.find((d) => d.usage_page === 0x8c)
    || candidates.find((d) => serialVids.has(d.vendor_id))
    || candidates[0]
    || null;
}

async function startBridge(slot, kind) {
  const host = bridgeHost();
  const r = await fetch(`http://${host}/devices`);
  if (!r.ok) throw new Error(`bridge /devices: HTTP ${r.status}`);
  const dev = pickBridgeDevice(await r.json(), kind);
  if (!dev) throw new Error(`bridge found no ${kind} device`);

  const qs = kind === 'serial'
    ? `mode=serial&port=${encodeURIComponent(dev.port)}&baud=9600`
    : `mode=hid&path=${encodeURIComponent(dev.path)}`;
  const label = kind === 'serial' ? dev.port : (dev.product || 'HID device');
  const ws = new WebSocket(`ws://${host}/stream?${qs}`);
  ws.binaryType = 'arraybuffer';
  const acc = makeAccumulator(slot, `bridge-${kind}`);

  ws.onopen = () => setStatus(slot, `Bridge ${kind}: ${label} — reading…`);
  ws.onmessage = (ev) => acc.push(new Uint8Array(ev.data));
  ws.onerror = () => setStatus(slot, `Bridge ${kind}: connection error`);
  ws.onclose = (ev) => {
    if (slot.active) setStatus(slot, `Bridge ${kind}: closed${ev.reason ? ` (${ev.reason})` : ''}`);
  };

  slot.active = {
    async stop() {
      acc.flush();
      try { ws.close(); } catch {}
    },
  };
}

function renderDiff() {
  const a = slots['1'].lastBytes;
  const b = slots['2'].lastBytes;

  if (!a && !b) {
    diffVerdict.className = 'diff-verdict';
    diffVerdict.textContent = 'Waiting for scans on both devices…';
    diffView.innerHTML = '';
    dlDiff.innerHTML = '';
    return;
  }

  if (!a || !b) {
    const x = a || b;
    const which = a ? '1' : '2';
    diffVerdict.className = 'diff-verdict';
    diffVerdict.textContent = `Waiting for scan on Device ${a ? '2' : '1'}… showing Device ${which} (${x.length} bytes)`;
    const hex = Array.from(x, (v) => v.toString(16).padStart(2, '0')).join(' ');
    diffView.innerHTML =
      `<span class="section-label">HEX (Device ${which})</span><span class="eq">${hex}</span>\n\n` +
      `<span class="section-label">ASCII (Device ${which})</span><span class="eq">${escapeHtml(toAscii(x))}</span>`;
    renderDlDiff(a, b);
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

  renderDlDiff(a, b);
}

function rowHtml(label, nameSub, va, vb) {
  const bothPresent = va !== undefined && va !== null && vb !== undefined && vb !== null;
  const match = bothPresent && va === vb;
  const cls = !bothPresent ? 'only' : match ? 'match' : 'mismatch';
  const indicator = !bothPresent ? '–' : match ? '✓' : '✗';
  return `<tr class="${cls}">
    <td><span class="code">${escapeHtml(label)}</span><div class="field-name">${escapeHtml(nameSub || '')}</div></td>
    <td>${escapeHtml(va ?? '—')}</td>
    <td>${escapeHtml(vb ?? '—')}</td>
    <td>${indicator}</td>
  </tr>`;
}

function subfilesToString(subfiles) {
  if (!subfiles || !subfiles.length) return '—';
  return subfiles.map((s) => `${s.type}@${s.offset}+${s.length}`).join(', ');
}

function renderDlDiff(a, b) {
  const fa = parseAAMVA(a);
  const fb = parseAAMVA(b);
  const ha = parseAAMVAHeader(a);
  const hb = parseAAMVAHeader(b);

  if (!fa && !fb && !ha && !hb) {
    dlDiff.innerHTML = '';
    return;
  }

  const header = `<div class="dl-header">AAMVA Driver's License ${fa || ha ? '(D1: detected)' : '(D1: not detected)'} ${fb || hb ? '(D2: detected)' : '(D2: not detected)'}</div>`;

  let headerRows = '';
  const headerKeys = ['complianceIndicator', 'fileType', 'iin', 'aamvaVersion', 'jurisdictionVersion', 'subfileCount'];
  for (const k of headerKeys) {
    headerRows += rowHtml(k, HEADER_LABELS[k], ha?.[k], hb?.[k]);
  }
  headerRows += rowHtml('subfiles', 'Subfile Directory', subfilesToString(ha?.subfiles), subfilesToString(hb?.subfiles));

  const keys = Array.from(new Set([...Object.keys(fa || {}), ...Object.keys(fb || {})])).sort();
  let fieldRows = '';
  for (const k of keys) {
    fieldRows += rowHtml(k, AAMVA_FIELDS[k], fa?.[k], fb?.[k]);
  }

  dlDiff.innerHTML = header + `
    <div class="dl-section-label">Header</div>
    <table class="dl-table">
      <thead><tr><th>Field</th><th>Device 1</th><th>Device 2</th><th></th></tr></thead>
      <tbody>${headerRows}</tbody>
    </table>
    <div class="dl-section-label">Subfile Fields</div>
    <table class="dl-table">
      <thead><tr><th>Field</th><th>Device 1</th><th>Device 2</th><th></th></tr></thead>
      <tbody>${fieldRows}</tbody>
    </table>
    <div class="dl-actions"><button id="copy-md-btn">Copy Table as Markdown</button></div>`;

  document.getElementById('copy-md-btn').addEventListener('click', () =>
    copyDlTableAsMarkdown({ ha, hb, fa, fb, keys, headerKeys })
  );
}

function copyDlTableAsMarkdown({ ha, hb, fa, fb, keys, headerKeys }) {
  const escapeMd = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const mdRow = (code, name, va, vb) => {
    const bothPresent = va !== undefined && va !== null && vb !== undefined && vb !== null;
    const match = bothPresent && va === vb;
    const indicator = !bothPresent ? '–' : match ? '✓' : '✗';
    return `| ${code} | ${escapeMd(name || '')} | ${escapeMd(va ?? '—')} | ${escapeMd(vb ?? '—')} | ${indicator} |\n`;
  };

  let md = '### Header\n\n';
  md += '| Field | Name | Device 1 | Device 2 | Match |\n';
  md += '|-------|------|----------|----------|-------|\n';
  for (const k of headerKeys) md += mdRow(k, HEADER_LABELS[k], ha?.[k], hb?.[k]);
  md += mdRow('subfiles', 'Subfile Directory', subfilesToString(ha?.subfiles), subfilesToString(hb?.subfiles));

  md += '\n### Subfile Fields\n\n';
  md += '| Code | Field | Device 1 | Device 2 | Match |\n';
  md += '|------|-------|----------|----------|-------|\n';
  for (const k of keys) md += mdRow(k, AAMVA_FIELDS[k], fa?.[k], fb?.[k]);

  navigator.clipboard.writeText(md).then(() => {
    const btn = document.getElementById('copy-md-btn');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 900);
  }).catch((e) => {
    ioStatus.textContent = `Copy failed: ${e.message}`;
  });
}

function bytesToHexCompact(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(s) {
  const clean = s.replace(/[\s:,]/g, '').toLowerCase();
  if (!clean || !/^[0-9a-f]+$/.test(clean) || clean.length % 2) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function injectBytesIntoSlot(slot, bytes, label) {
  const entry = createEntry(slot, label);
  updateEntry(entry, bytes);
  entry.classList.remove('pending');
  slot.lastBytes = bytes;
}

async function exportToClipboard() {
  const a = slots['1'].lastBytes;
  const b = slots['2'].lastBytes;
  if (!a && !b) {
    ioStatus.textContent = 'Nothing to export.';
    return;
  }
  const text = `${a ? bytesToHexCompact(a) : ''}\n---SPLIT---\n${b ? bytesToHexCompact(b) : ''}`;
  try {
    await navigator.clipboard.writeText(text);
    ioStatus.textContent = `Exported ${(a?.length ?? 0)} + ${(b?.length ?? 0)} bytes.`;
  } catch (e) {
    ioStatus.textContent = `Export failed: ${e.message}`;
  }
}

function importFromText(text, source) {
  const parts = text.split('---SPLIT---');
  if (parts.length !== 2) {
    ioStatus.textContent = `${source} missing ---SPLIT--- delimiter.`;
    return;
  }
  const a = hexToBytes(parts[0]);
  const b = hexToBytes(parts[1]);
  if (!a && !b) {
    ioStatus.textContent = 'No valid hex on either side.';
    return;
  }
  if (a) injectBytesIntoSlot(slots['1'], a, 'imported');
  if (b) injectBytesIntoSlot(slots['2'], b, 'imported');
  renderDiff();
  ioStatus.textContent = `Imported ${(a?.length ?? 0)} + ${(b?.length ?? 0)} bytes.`;
}

async function importFromClipboard() {
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch (e) {
    ioStatus.textContent = `Read failed: ${e.message}`;
    return;
  }
  importFromText(text, 'Clipboard');
}

function importFromFile() {
  document.getElementById('import-file-input').click();
}

document.getElementById('import-file-input').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    importFromText(text, `File ${file.name}`);
  } catch (err) {
    ioStatus.textContent = `Read failed: ${err.message}`;
  } finally {
    e.target.value = '';
  }
});

function exportToFile() {
  const a = slots['1'].lastBytes;
  const b = slots['2'].lastBytes;
  if (!a && !b) {
    ioStatus.textContent = 'Nothing to export.';
    return;
  }
  const text = `${a ? bytesToHexCompact(a) : ''}\n---SPLIT---\n${b ? bytesToHexCompact(b) : ''}`;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `${ts}_diff.txt`;
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a_el = document.createElement('a');
  a_el.href = url;
  a_el.download = filename;
  document.body.appendChild(a_el);
  a_el.click();
  document.body.removeChild(a_el);
  URL.revokeObjectURL(url);
  ioStatus.textContent = `Saved ${filename}.`;
}

document.getElementById('export-btn').addEventListener('click', exportToClipboard);
document.getElementById('export-file-btn').addEventListener('click', exportToFile);
document.getElementById('import-btn').addEventListener('click', importFromClipboard);
document.getElementById('import-file-btn').addEventListener('click', importFromFile);

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
    else if (mode === 'bridge-serial') await startBridge(slot, 'serial');
    else if (mode === 'bridge-hid') await startBridge(slot, 'hid');
    else if (mode === 'import-file') importSlotFromFile(slot);
    else if (mode === 'import-clip') await importSlotFromClipboard(slot);
  } catch (err) {
    setStatus(slot, `Error: ${err.message}`);
    console.error(err);
  }
});
