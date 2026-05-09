const { app, BrowserWindow, BrowserView, ipcMain, protocol, session, Menu, screen } = require('electron/main')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

// ── Contacts Storage ─────────────────────────────────────────────────────────
function contactsPath() {
  return path.join(app.getPath('userData'), 'contacts.json')
}

function loadContacts() {
  try { return JSON.parse(fs.readFileSync(contactsPath(), 'utf8')) } catch { return [] }
}

function saveContacts(list) {
  fs.writeFileSync(contactsPath(), JSON.stringify(list, null, 2), 'utf8')
}

ipcMain.handle('get-all-contacts', () => {
  return loadContacts()
})

ipcMain.handle('save-contact', (_event, contact) => {
  const list = loadContacts()
  if (!contact.id) contact.id = crypto.randomUUID()
  const idx = list.findIndex(c => c.id === contact.id)
  if (idx >= 0) list[idx] = contact
  else list.push(contact)
  saveContacts(list)
  return contact
})

ipcMain.handle('delete-contact', (_event, contactId) => {
  const list = loadContacts()
  const filtered = list.filter(c => c.id !== contactId)
  saveContacts(filtered)
  return true
})

// ── Credential Storage ───────────────────────────────────────────────────────
function credentialsPath() {
  return path.join(app.getPath('userData'), 'credentials.json')
}

function loadCredentials() {
  try { return JSON.parse(fs.readFileSync(credentialsPath(), 'utf8')) } catch { return {} }
}

function saveCredentials(store) {
  fs.writeFileSync(credentialsPath(), JSON.stringify(store, null, 2), 'utf8')
}

ipcMain.handle('get-domain-credentials', (_event, domain) => {
  const store = loadCredentials()
  return store[domain] || []
})

ipcMain.handle('save-domain-credential', (_event, domain, credential) => {
  const store = loadCredentials()
  if (!store[domain]) store[domain] = []
  if (!credential.id) credential.id = crypto.randomUUID()
  const idx = store[domain].findIndex(c => c.id === credential.id)
  if (idx >= 0) store[domain][idx] = credential
  else store[domain].push(credential)
  saveCredentials(store)
  return true
})

ipcMain.handle('get-all-credentials', () => {
  return loadCredentials()
})

ipcMain.handle('delete-domain-credential', (_event, domain, credentialId) => {
  const store = loadCredentials()
  if (!store[domain]) return false
  store[domain] = store[domain].filter(c => c.id !== credentialId)
  if (store[domain].length === 0) delete store[domain]
  saveCredentials(store)
  return true
})

async function injectCredentialModal(view, loginForm, savedCreds, win, options = {}) {
  if (win) win.webContents.send('cred-modal-open')

  const domain    = JSON.stringify(loginForm.domain)
  const saved     = JSON.stringify(savedCreds)
  const fields    = JSON.stringify(loginForm.fields)
  const submitSel = JSON.stringify(loginForm.submitSelector)
  const isRetry   = !!(options && options.isRetry)

  await view.webContents.executeJavaScript(`
(function() {
  if (document.getElementById('__ai_cred_overlay__')) return;

  var DOMAIN     = ${domain};
  var SAVED      = ${saved};
  var FIELDS     = ${fields};
  var SUBMIT_SEL = ${submitSel};
  var SEL_ID     = SAVED.length ? SAVED[0].id : null;
  var IS_RETRY   = ${isRetry};

  function dismiss(signal) {
    var o = document.getElementById('__ai_cred_overlay__');
    if (o) o.remove();
    console.log(signal || '__CRED_DISMISSED__');
  }

  function fillPage(fills) {
    fills.forEach(function(f) {
      try {
        var el = document.querySelector(f.selector);
        if (!el) return;
        el.focus();
        var ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        ns ? ns.call(el, f.value) : (el.value = f.value);
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (_) {}
    });
    setTimeout(function() {
      var btn = SUBMIT_SEL ? document.querySelector(SUBMIT_SEL) : null;
      if (!btn) btn = document.querySelector('button[type="submit"],input[type="submit"]');
      if (btn) btn.click();
    }, 280);
  }

  function mk(tag, css) {
    var e = document.createElement(tag);
    if (css) Object.assign(e.style, css);
    return e;
  }

  function mkBtn(label, variant) {
    var base = {
      padding: variant === 'ghost' ? '6px 10px' : '8px 18px',
      borderRadius: '8px', fontSize: '12.5px', fontWeight: '500',
      fontFamily: 'inherit', cursor: 'pointer', border: 'none',
      outline: 'none', letterSpacing: '.1px', transition: 'background .12s, opacity .12s',
      background: variant === 'primary' ? 'rgba(255,255,255,0.92)'
                : variant === 'secondary' ? 'rgba(255,255,255,0.06)' : 'transparent',
      color: variant === 'primary' ? '#0a0a0a'
           : variant === 'secondary' ? '#b0b0b0' : '#4a4a4a',
    };
    if (variant === 'secondary') base.border = '1px solid rgba(255,255,255,0.1)';
    var b = mk('button', base);
    b.textContent = label;
    b.addEventListener('mouseover', function() { b.style.opacity = '.75'; });
    b.addEventListener('mouseout',  function() { b.style.opacity = '1'; });
    return b;
  }

  function showAwaitingPill() {
    if (document.getElementById('__ai_cred_pill__')) return;
    var pill = mk('div', {
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '2147483646', padding: '8px 18px', borderRadius: '24px',
      background: 'rgba(20,20,20,0.92)', border: '1px solid rgba(255,255,255,0.08)',
      color: '#666', fontSize: '12px',
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      display: 'flex', alignItems: 'center', gap: '7px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)', pointerEvents: 'none', whiteSpace: 'nowrap',
      backdropFilter: 'blur(12px)'
    });
    pill.id = '__ai_cred_pill__';
    pill.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3.5l2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>&nbsp;Fill in your login details';
    document.body.appendChild(pill);
    setTimeout(function() { if (pill.parentNode) pill.remove(); }, 7000);
  }

  var overlay = mk('div', {
    position: 'fixed', inset: '0', zIndex: '2147483647',
    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif'
  });
  overlay.id = '__ai_cred_overlay__';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) dismiss(); });

  var modal = mk('div', {
    background: '#111', border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '16px', width: '400px', maxWidth: 'calc(100vw - 32px)',
    boxShadow: '0 24px 60px rgba(0,0,0,0.8)', overflow: 'hidden', color: '#e0e0e0'
  });

  var header = mk('div', {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '18px 20px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)'
  });
  var lockIco = mk('span', { color: '#555', display: 'flex', alignItems: 'center', flexShrink: '0' });
  lockIco.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="4" y="7" width="8" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  var titleEl = mk('span', { flex: '1', fontSize: '13.5px', fontWeight: '600', color: '#e8e8e8', letterSpacing: '.1px' });
  titleEl.textContent = SAVED.length > 0 ? (SAVED.length > 1 ? 'Saved Logins' : 'Saved Login') : 'Sign In';
  var xBtn = mk('button', {
    background: 'none', border: 'none', color: '#3a3a3a', fontSize: '20px',
    cursor: 'pointer', lineHeight: '1', padding: '0', outline: 'none'
  });
  xBtn.textContent = '×';
  xBtn.addEventListener('mouseover', function() { xBtn.style.color = '#888'; });
  xBtn.addEventListener('mouseout',  function() { xBtn.style.color = '#3a3a3a'; });
  xBtn.addEventListener('click', dismiss);
  header.appendChild(lockIco); header.appendChild(titleEl); header.appendChild(xBtn);

  var domEl = mk('div', { padding: '10px 20px 0', fontSize: '11px', color: '#3a3a3a', letterSpacing: '.2px' });
  domEl.textContent = DOMAIN;

  var body = mk('div', { padding: '16px 20px 20px' });

  function renderListView() {
    titleEl.textContent = IS_RETRY ? 'Login may have failed' : (SAVED.length > 1 ? 'Saved Logins' : 'Saved Login');
    body.innerHTML = '';

    var hint = mk('p', { fontSize: '12px', color: '#444', marginBottom: '14px', lineHeight: '1.5' });
    hint.textContent = IS_RETRY ? 'Check your credentials or try a different account.' : 'Use a saved login for this site?';
    body.appendChild(hint);

    var list = mk('div', { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px', maxHeight: '200px', overflowY: 'auto' });

    SAVED.forEach(function(cred, i) {
      var selected = i === 0;
      var item = mk('div', {
        display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px',
        background: selected ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)',
        border: '1px solid ' + (selected ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)'),
        borderRadius: '10px', cursor: 'pointer', transition: 'border-color .12s, background .12s'
      });
      var radio = mk('div', {
        width: '14px', height: '14px', borderRadius: '50%', flexShrink: '0',
        border: '2px solid ' + (selected ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)'),
        background: selected ? 'rgba(255,255,255,0.7)' : 'transparent',
        transition: 'border-color .12s, background .12s'
      });
      var info = mk('div', { flex: '1', minWidth: '0' });
      var lbl = mk('div', { fontSize: '13px', color: '#e0e0e0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: '500' });
      lbl.textContent = cred.label || cred.id || DOMAIN;
      var sub = mk('div', { fontSize: '11px', color: '#3a3a3a', marginTop: '3px' });
      sub.textContent = (cred.fieldMeta || []).map(function(f) {
        return f.isPassword ? f.label + ': ●●●●' : f.label + ': ' + (cred.fields[f.name] || '');
      }).join('  ·  ');
      info.appendChild(lbl); info.appendChild(sub);
      item.appendChild(radio); item.appendChild(info);
      item.addEventListener('click', function() {
        SEL_ID = cred.id;
        list.querySelectorAll('[data-ci]').forEach(function(it) {
          it.style.background = 'rgba(255,255,255,0.02)';
          it.style.borderColor = 'rgba(255,255,255,0.06)';
          it._r.style.borderColor = 'rgba(255,255,255,0.2)';
          it._r.style.background = 'transparent';
        });
        item.style.background = 'rgba(255,255,255,0.05)';
        item.style.borderColor = 'rgba(255,255,255,0.15)';
        radio.style.borderColor = 'rgba(255,255,255,0.7)';
        radio.style.background = 'rgba(255,255,255,0.7)';
      });
      item._r = radio; item.setAttribute('data-ci', '1');
      list.appendChild(item);
    });
    body.appendChild(list);

    var actions = mk('div', { display: 'flex', gap: '8px', alignItems: 'center' });
    var loginBtn = mkBtn('Login', 'primary');
    loginBtn.addEventListener('click', function() {
      var cred = SAVED.find(function(c) { return c.id === SEL_ID; });
      if (!cred) return;
      dismiss('__CRED_SUBMITTED__');
      fillPage((cred.fieldMeta || []).map(function(f) { return { selector: f.selector, value: cred.fields[f.name] || '' }; }));
    });
    var diffBtn = mkBtn('Different account', 'secondary');
    diffBtn.addEventListener('click', function() { renderFormView('Enter different login details:'); });
    var selfBtn = mkBtn("I'll do it myself", 'ghost');
    selfBtn.style.marginLeft = 'auto';
    selfBtn.addEventListener('click', function() { dismiss(); showAwaitingPill(); });
    if (IS_RETRY) {
      var proceedBtn = mkBtn('Proceed anyway', 'ghost');
      proceedBtn.title = 'I\'m logged in, continue';
      proceedBtn.addEventListener('click', function() { dismiss('__CRED_PROCEED__'); });
      actions.appendChild(proceedBtn);
    }
    actions.appendChild(loginBtn); actions.appendChild(diffBtn); actions.appendChild(selfBtn);
    body.appendChild(actions);
  }

  function renderFormView(hintText) {
    titleEl.textContent = IS_RETRY ? 'Sign in again' : 'Sign In';
    body.innerHTML = '';
    var hint = mk('p', { fontSize: '12px', color: '#444', marginBottom: '16px', lineHeight: '1.5' });
    hint.textContent = hintText || (IS_RETRY ? 'Credentials may have been incorrect.' : 'Enter your credentials to continue.');
    body.appendChild(hint);

    var fc = mk('div', { display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' });
    var inputs = [];
    FIELDS.forEach(function(field) {
      var row = mk('div', { display: 'flex', flexDirection: 'column', gap: '5px' });
      var lbl = mk('label', { fontSize: '11px', color: '#3a3a3a', fontWeight: '500', letterSpacing: '.3px', textTransform: 'uppercase' });
      lbl.textContent = field.label;
      var inp = mk('input', {
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '8px', padding: '10px 12px', color: '#e0e0e0',
        fontSize: '13px', fontFamily: 'inherit', outline: 'none',
        width: '100%', boxSizing: 'border-box', transition: 'border-color .12s'
      });
      inp.type = field.isPassword ? 'password' : 'text';
      inp.placeholder = field.isPassword ? '••••••••' : field.label;
      inp.autocomplete = field.isPassword ? 'current-password' : 'username';
      inp.dataset.fn  = field.name;
      inp.dataset.sel = field.selector;
      inp.addEventListener('focus', function() { inp.style.borderColor = 'rgba(255,255,255,0.25)'; });
      inp.addEventListener('blur',  function() { inp.style.borderColor = 'rgba(255,255,255,0.08)'; });
      row.appendChild(lbl); row.appendChild(inp); fc.appendChild(row);
      inputs.push(inp);
    });
    body.appendChild(fc);

    function doSubmit() {
      var vals = {}; var fills = [];
      inputs.forEach(function(inp) { vals[inp.dataset.fn] = inp.value; fills.push({ selector: inp.dataset.sel, value: inp.value }); });
      var firstNonPw = FIELDS.find(function(f) { return !f.isPassword; });
      var credLabel = firstNonPw ? (vals[firstNonPw.name] || DOMAIN) : DOMAIN;
      var cred = {
        label: credLabel, fields: vals,
        fieldMeta: FIELDS.map(function(f) { return { name: f.name, type: f.type, label: f.label, selector: f.selector, isPassword: f.isPassword }; })
      };
      console.log('__CRED_SAVE__:' + JSON.stringify({ domain: DOMAIN, credential: cred }));
      dismiss('__CRED_SUBMITTED__');
      fillPage(fills);
    }

    var actions = mk('div', { display: 'flex', gap: '8px', alignItems: 'center' });
    var saveBtn = mkBtn('Save & Sign In', 'primary');
    saveBtn.addEventListener('click', doSubmit);
    var selfBtn = mkBtn("I'll do it myself", 'ghost');
    selfBtn.style.marginLeft = 'auto';
    selfBtn.addEventListener('click', function() { dismiss(); showAwaitingPill(); });
    if (IS_RETRY) {
      var proceedBtn = mkBtn('Proceed anyway', 'ghost');
      proceedBtn.title = 'I\'m logged in, continue';
      proceedBtn.addEventListener('click', function() { dismiss('__CRED_PROCEED__'); });
      actions.appendChild(proceedBtn);
    }
    actions.appendChild(saveBtn); actions.appendChild(selfBtn);
    body.appendChild(actions);

    inputs.forEach(function(inp) { inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); doSubmit(); } }); });
    if (inputs[0]) setTimeout(function() { inputs[0].focus(); }, 80);
  }

  modal.appendChild(header);
  modal.appendChild(domEl);
  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  if (SAVED.length > 0) renderListView();
  else renderFormView();
})()
  `)
}

ipcMain.handle('fill-login-fields', async (_event, tabId, fills) => {
  const view = getViewForTab(tabId)
  if (!view) return { success: false }
  for (const { selector, value } of fills) {
    try {
      await view.webContents.executeJavaScript(`
        (function() {
          var el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          el.focus();
          var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          if (nativeSetter) nativeSetter.call(el, ${JSON.stringify(value)});
          else el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()
      `)
    } catch (_) {}
  }
  return { success: true }
})

ipcMain.handle('submit-login-form', async (_event, tabId, submitSelector) => {
  const view = getViewForTab(tabId)
  if (!view) return { success: false }
  try {
    await view.webContents.executeJavaScript(`
      (function() {
        var sel = ${JSON.stringify(submitSelector || '')};
        var el = sel ? document.querySelector(sel) : null;
        if (!el) el = document.querySelector('button[type="submit"], input[type="submit"], button:not([type="button"]):not([type="reset"])');
        if (el) { el.click(); return true; }
        return false;
      })()
    `)
  } catch (_) {}
  return { success: true }
})

// ── Per-window State ─────────────────────────────────────────────────────────
// allTabs: tabId -> { view, title, url, isAgent, isPrivate, winId }
// winStates: win.id -> { win, isPrivate, tabIds: Set, activeTabId, sidebarOpen, sidebarWidth, pendingCredVerifyTabId }
const allTabs = new Map()
const winStates = new Map()
let nextTabId = 1

const TOOLBAR_HEIGHT_NORMAL  = 128
const TOOLBAR_HEIGHT_PRIVATE = 158  // +30px for the private window banner
const FIND_BAR_HEIGHT = 48  // extra space when find bar is open so BrowserView doesn't overlap it

// Sample page background so sidebar can blend (white page → white sidebar, etc.)
const GET_PAGE_BACKGROUND_SCRIPT = `
  (function() {
    function parseRgb(s) {
      if (!s || s === 'transparent') return null;
      if (s === 'rgba(0, 0, 0, 0)') return null;
      var m = s.match(/rgba?\\s*\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)(?:\\s*,\\s*[\\d.]+)?\\s*\\)/);
      if (m) return { r: +m[1], g: +m[2], b: +m[3] };
      var hex = s.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
      if (hex) {
        var h = hex[1];
        if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
        return { r: parseInt(h.slice(0,2), 16), g: parseInt(h.slice(2,4), 16), b: parseInt(h.slice(4,6), 16) };
      }
      return null;
    }
    function toHex(rgb) {
      return '#' + [rgb.r, rgb.g, rgb.b].map(function(x) {
        var h = Math.max(0, Math.min(255, Math.round(x))).toString(16);
        return h.length === 1 ? '0' + h : h;
      }).join('');
    }
    var body = getComputedStyle(document.body).backgroundColor;
    var html = getComputedStyle(document.documentElement).backgroundColor;
    var rgb = parseRgb(body) || parseRgb(html);
    if (!rgb) return '#ffffff';
    return toHex(rgb);
  })()
`

async function sendContentBackground(state, view) {
  if (!state?.win || !view) return
  try {
    const color = await view.webContents.executeJavaScript(GET_PAGE_BACKGROUND_SCRIPT)
    if (color && typeof color === 'string') state.win.webContents.send('content-background', color)
  } catch (_) {}
}

function stateForWindow(win) { return win ? winStates.get(win.id) : null }
function stateForEvent(event) { return stateForWindow(event.sender.getOwnerBrowserWindow()) }
function getActiveView(state) { return state?.activeTabId ? allTabs.get(state.activeTabId)?.view : null }
function getViewForTab(tabId) { return allTabs.get(tabId)?.view || null }

// Handle browser shortcuts when focus is in the page (BrowserView). Returns true if handled.
function handlePageShortcut(input, state) {
  if (!state?.win) return false
  // Only act on keyDown — keyUp events can still carry meta:true (e.g. after Cmd+W closes a tab
  // the 'w' keyUp fires on the newly-active tab with meta still set, which would close it too)
  if (input.type !== 'keyDown') return false
  // Require explicit modifier: use modifiers array when present, else boolean meta/ctrl (strict so plain keys don't trigger)
  const modFromArray = Array.isArray(input.modifiers) && (
    input.modifiers.includes('meta') || input.modifiers.includes('control') ||
    input.modifiers.includes('ctrl') || input.modifiers.includes('command') || input.modifiers.includes('cmd')
  )
  const mod = !!(
    modFromArray ||
    input.metaKey === true ||
    input.ctrlKey === true ||
    input.meta === true ||
    input.control === true
  )
  const key = (input.key || '').toLowerCase()
  const view = getActiveView(state)
  const ids = [...state.tabIds]

  // Double-tap Cmd/Ctrl to open AI sidebar (when browser page has focus)
  if (key === 'meta' || key === 'control') {
    const now = Date.now()
    if (now - (state.lastModKeyTime || 0) < 400) {
      state.lastModKeyTime = 0
      state.win.webContents.focus()
      state.win.webContents.send('open-sidebar')
      return true
    }
    state.lastModKeyTime = now
    return false
  }
  // Cmd/Ctrl+E to toggle sidebar (left chrome in sidebar mode, AI sidebar in classic)
  if (mod && key === 'e') {
    state.win.webContents.focus()
    state.win.webContents.send('shortcut-toggle-sidebar')
    return true
  }

  if (mod && key === 'n' && !input.shift) {
    createWindow(false)
    return true
  }
  if (mod && key === 't') {
    state.win.webContents.focus()
    state.win.webContents.send('shortcut-open-address-modal')
    return true
  }
  if (mod && input.shift && key === 'n') {
    createWindow(true)
    return true
  }
  if (mod && input.shift && key === 't') {
    if (state.closedTabs?.length) {
      const { url } = state.closedTabs.pop()
      if (url) createTab(url, { isPrivate: state.isPrivate }, state)
    }
    return true
  }
  if (mod && key === 'tab' && ids.length > 0) {
    const idx = ids.indexOf(state.activeTabId)
    const nextIdx = input.shift
      ? (idx <= 0 ? ids.length - 1 : idx - 1)
      : (idx < 0 || idx >= ids.length - 1 ? 0 : idx + 1)
    switchTab(ids[nextIdx], state)
    return true
  }
  if (mod && !input.shift && key >= '1' && key <= '9' && ids.length > 0) {
    const n = parseInt(key, 10)
    const targetIdx = n === 9 ? ids.length - 1 : Math.min(n - 1, ids.length - 1)
    if (targetIdx >= 0) switchTab(ids[targetIdx], state)
    return true
  }
  if ((mod && key === 'r') || key === 'f5') {
    if (view) view.webContents.reload()
    return true
  }
  if (mod && key === '.') {
    if (view) view.webContents.stopLoad()
    return true
  }
  if ((mod && key === 'l') || (input.alt && key === 'd')) {
    state.win.webContents.focus()
    state.win.webContents.send('shortcut-focus-address-bar')
    return true
  }
  if (mod && (key === '=' || key === '+')) {
    if (view) {
      const z = Math.min(view.webContents.getZoomFactor() + 0.25, 5)
      view.webContents.setZoomFactor(z)
    }
    return true
  }
  if (mod && key === '-') {
    if (view) {
      const z = Math.max(view.webContents.getZoomFactor() - 0.25, 0.25)
      view.webContents.setZoomFactor(z)
    }
    return true
  }
  if (mod && key === '0') {
    if (view) view.webContents.setZoomFactor(1)
    return true
  }
  if ((mod && input.shift && key === 'i') || key === 'f12') {
    if (view) view.webContents.toggleDevTools()
    return true
  }
  if (mod && key === 'f' && !input.shift) {
    state.win.webContents.focus()
    state.win.webContents.send('shortcut-open-find')
    return true
  }
  if (key === 'home' || (mod && key === 'arrowup')) {
    if (view) view.webContents.executeJavaScript('window.scrollTo(0,0)').catch(() => {})
    return true
  }
  if (key === 'end' || (mod && key === 'arrowdown')) {
    if (view) view.webContents.executeJavaScript('window.scrollTo(0,document.documentElement.scrollHeight)').catch(() => {})
    return true
  }
  if (input.alt && key === 'arrowleft') {
    if (view && view.webContents.canGoBack()) view.webContents.goBack()
    return true
  }
  if (input.alt && key === 'arrowright') {
    if (view && view.webContents.canGoForward()) view.webContents.goForward()
    return true
  }
  return false
}

// ── Login Form Detection ─────────────────────────────────────────────────────
const DETECT_LOGIN_FORM_SCRIPT = `
  (function() {
    var pwFields = Array.from(document.querySelectorAll('input[type="password"]')).filter(function(el) {
      var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
    });
    if (pwFields.length === 0) return null;
    var form = pwFields[0].closest('form') || document.body;
    var allInputs = Array.from(form.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])'
    )).filter(function(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    var fields = allInputs.map(function(el) {
      var label = '';
      if (el.id) { var lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (lbl) label = lbl.textContent.trim(); }
      if (!label && el.closest('label')) label = el.closest('label').textContent.replace(el.value, '').trim();
      if (!label) label = el.placeholder || el.name || el.id || (el.type === 'password' ? 'Password' : 'Field');
      var selector = el.name ? ('input[name=' + JSON.stringify(el.name) + ']')
                   : el.id   ? ('#' + CSS.escape(el.id))
                   : ('input[type=' + JSON.stringify(el.type || 'text') + ']');
      return { name: el.name || el.id || el.type || 'field', type: el.type || 'text', label: label, selector: selector, isPassword: el.type === 'password' };
    });
    var submitEl = form.querySelector('button[type="submit"], input[type="submit"]')
                || form.querySelector('button:not([type="button"]):not([type="reset"])');
    var submitSelector = null;
    if (submitEl) submitSelector = submitEl.id ? ('#' + CSS.escape(submitEl.id)) : (submitEl.name ? ('[name=' + JSON.stringify(submitEl.name) + ']') : 'button[type="submit"]');
    return { fields: fields, submitSelector: submitSelector, domain: window.location.hostname };
  })()
`

// ── Credential Verification ──────────────────────────────────────────────────
function scheduleCredVerify(tabId, view, state) {
  const VERIFY_DELAY_MS = 6000
  let done = false
  const finish = () => {
    if (done) return
    done = true
    view.webContents.removeListener('did-finish-load', onLoad)
    clearTimeout(timer)
    doCredVerify(tabId, view, state)
  }
  const onLoad = () => finish()
  const timer = setTimeout(finish, VERIFY_DELAY_MS)
  view.webContents.once('did-finish-load', onLoad)
}

async function doCredVerify(tabId, view, state) {
  try {
    const url = view.webContents.getURL()
    if (!url || url.startsWith('about:') || url.startsWith('file:') || url.startsWith('chrome:')) {
      if (state?.win) state.win.webContents.send('cred-modal-closed')
      return
    }
    const loginForm = await view.webContents.executeJavaScript(DETECT_LOGIN_FORM_SCRIPT)
    if (loginForm && loginForm.fields && loginForm.fields.length > 0) {
      const savedCreds = loadCredentials()[loginForm.domain] || []
      await injectCredentialModal(view, loginForm, savedCreds, state?.win, { isRetry: true })
    } else {
      if (state?.win) state.win.webContents.send('cred-modal-closed')
    }
  } catch (_) {
    if (state?.win) state.win.webContents.send('cred-modal-closed')
  }
}

const SPLIT_GAP = 2  // px gap between split panes (shows window background)

// ── Layout ───────────────────────────────────────────────────────────────────
function updateBrowserViewBounds(state) {
  if (!state?.win) return

  const bounds = state.win.getContentBounds()
  const reserved = state.sidebarOpen ? state.sidebarWidth : 0
  const leftChrome = state.leftChromeWidth || 0
  const findBarH = state.findBarOpen ? FIND_BAR_HEIGHT : 0
  const contentTop = (state.contentTop ?? 128) + findBarH

  const cx = leftChrome
  const cy = contentTop
  const cw = bounds.width - leftChrome - reserved
  const ch = bounds.height - contentTop

  // Show split view only when active tab is in a split group; otherwise single view
  const activeGroup = getActiveGroup(state)
  if (activeGroup && activeGroup.panes.length > 1) {
    // Hide browser views when address or settings modal is open
    if (state.addressModalOpen || state.settingsModalOpen) {
      for (const pane of activeGroup.panes) {
        const tab = allTabs.get(pane.tabId)
        if (tab?.view) try { tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 }) } catch (_) {}
      }
      return
    }

    // Remove any attached views that are no longer in this group
    const splitTabIds = new Set(activeGroup.panes.map(p => p.tabId))
    for (const view of state.win.getBrowserViews()) {
      let tid = null
      for (const [id, t] of allTabs) { if (t.view === view && t.winId === state.win.id) { tid = id; break } }
      if (tid === null || !splitTabIds.has(tid)) {
        try { state.win.removeBrowserView(view) } catch (_) {}
      }
    }

    for (const pane of activeGroup.panes) {
      const tab = allTabs.get(pane.tabId)
      if (!tab?.view) continue
      const x = Math.round(cx + pane.fx * cw)
      const y = Math.round(cy + pane.fy * ch)
      const w = Math.max(100, Math.round(pane.fw * cw) - SPLIT_GAP)
      const h = Math.max(50,  Math.round(pane.fh * ch) - SPLIT_GAP)
      if (!state.win.getBrowserViews().includes(tab.view)) {
        try { state.win.addBrowserView(tab.view) } catch (_) {}
      }
      tab.view.setBounds({ x, y, width: w, height: h })
    }
  } else {
    // ── Single-view mode (no split group, or active tab is not in any group) ─
    const activeView = getActiveView(state)
    for (const view of state.win.getBrowserViews()) {
      if (view !== activeView) try { state.win.removeBrowserView(view) } catch (_) {}
    }

    const view = getActiveView(state)
    if (!view) return
    if (state.addressModalOpen || state.settingsModalOpen) {
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      return
    }
    const tab = allTabs.get(state.activeTabId)
    const borderWidth = tab?.isAgent ? 6 : 0
    view.setBounds({
      x: cx + borderWidth,
      y: cy + borderWidth,
      width: cw - borderWidth * 2,
      height: ch - borderWidth * 2
    })
  }
}

function sendTabsUpdate(state) {
  if (!state?.win) return
  const tabList = []
  for (const tabId of state.tabIds) {
    const tab = allTabs.get(tabId)
    if (tab) tabList.push({ id: tabId, title: tab.title, url: tab.url, isPrivate: tab.isPrivate })
  }
  state.win.webContents.send('tabs-updated', { tabs: tabList, activeTabId: state.activeTabId })
}

// ── BrowserView Event Wiring ─────────────────────────────────────────────────
function wireViewEvents(tabId, view, state) {
  view.webContents.setWindowOpenHandler(({ url }) => {
    const u = (url || '').trim()
    if (u && (u.startsWith('http://') || u.startsWith('https://'))) {
      createTab(u, { isPrivate: state.isPrivate }, state)
    }
    return { action: 'deny' }
  })

  // Shortcuts work when the webpage has focus (only for the active tab)
  view.webContents.on('before-input-event', (event, input) => {
    if (state.activeTabId !== tabId) return
    if (handlePageShortcut(input, state)) event.preventDefault()
  })

  // Main-frame only: avoid loading bar for iframe/subresource loads (e.g. in split view)
  view.webContents.on('will-navigate', () => {
    const tab = allTabs.get(tabId)
    if (tab && tab.loadingErrorPage) return
    if (tabId === state.activeTabId && state.win) {
      state.win.webContents.send('navigation-start')
    }
  })

  view.webContents.on('did-finish-load', () => {
    const tab = allTabs.get(tabId)
    const currentUrl = view.webContents.getURL()
    if (currentUrl.startsWith('browser-error://')) {
      if (tab) {
        tab.loadingErrorPage = false
        tab.url = tab.failedUrl || currentUrl
        tab.title = 'Page load failed'
        sendTabsUpdate(state)
      }
      if (tabId === state.activeTabId && state.win) {
        state.win.webContents.send('navigation-complete', {
          url: (tab && tab.failedUrl) ? tab.failedUrl : currentUrl,
          title: 'Page load failed',
          canGoBack: view.webContents.canGoBack(),
          canGoForward: view.webContents.canGoForward()
        })
        state.win.webContents.send('content-background', '#1a1a1a')
      }
      return
    }
    if (tab) {
      tab.url = currentUrl
      tab.title = view.webContents.getTitle() || tab.url
      sendTabsUpdate(state)
    }
    if (tabId === state.activeTabId && state.win) {
      state.win.webContents.send('navigation-complete', {
        url: view.webContents.getURL(),
        title: view.webContents.getTitle(),
        canGoBack: view.webContents.canGoBack(),
        canGoForward: view.webContents.canGoForward()
      })
      sendContentBackground(state, view)
    }

    view.webContents.insertCSS(`
      #ai-sel-popup {
        position: fixed; z-index: 2147483646; background: #1a1a1a;
        border: 1px solid #444; border-radius: 12px; padding: 14px 18px;
        display: flex; flex-direction: column; align-items: center; gap: 10px;
        min-width: 240px; box-shadow: 0 4px 24px rgba(0,0,0,0.5);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        opacity: 0; pointer-events: none; transition: opacity 0.15s ease;
      }
      #ai-sel-popup.visible { opacity: 1; pointer-events: auto; }
      #ai-sel-popup .ai-sel-summarize {
        padding: 8px 20px; border-radius: 8px; border: none;
        background: linear-gradient(135deg, #3a3a4a 0%, #2d2d3a 100%);
        color: #e8e8e8; font-size: 13px; font-weight: 600; cursor: pointer;
        letter-spacing: 0.3px; transition: background 0.2s, transform 0.1s;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      }
      #ai-sel-popup .ai-sel-summarize:hover { background: linear-gradient(135deg, #4a4a5a 0%, #3d3d4a 100%); transform: translateY(-1px); }
      #ai-sel-popup .ai-sel-summarize:active { transform: translateY(0); }
      #ai-sel-popup .ai-sel-or { font-size: 11px; color: #888; letter-spacing: 0.5px; text-transform: uppercase; }
      #ai-sel-popup .ai-sel-input-wrap {
        width: 100%; display: flex; align-items: center;
        border: 1px solid #444; border-radius: 8px; background: #252526; overflow: hidden;
      }
      #ai-sel-popup .ai-sel-input-wrap:focus-within { border-color: #555; }
      #ai-sel-popup .ai-sel-input-wrap input {
        flex: 1; min-width: 0; padding: 8px 12px; border: none;
        background: transparent; color: #e0e0e0; font-size: 12px; font-family: inherit; outline: none;
      }
      #ai-sel-popup .ai-sel-input-wrap input::placeholder { color: #666; }
      #ai-sel-popup .ai-sel-send {
        flex-shrink: 0; width: 36px; height: 36px; border: none; background: transparent;
        color: #888; cursor: pointer; display: flex; align-items: center; justify-content: center;
        padding: 0; transition: color 0.15s, background 0.15s;
      }
      #ai-sel-popup .ai-sel-send:hover { color: #e0e0e0; background: #333; }
    `)
    view.webContents.executeJavaScript(`
      (function() {
        if (window.location.protocol === 'browser-error:') return;
        if (document.getElementById('ai-sel-popup')) return;
        var popup = document.createElement('div');
        popup.id = 'ai-sel-popup';
        var btnS = document.createElement('button');
        btnS.className = 'ai-sel-summarize';
        btnS.textContent = 'Summarize';
        var orLabel = document.createElement('div');
        orLabel.className = 'ai-sel-or';
        orLabel.textContent = 'or';
        var wrap = document.createElement('div');
        wrap.className = 'ai-sel-input-wrap';
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = 'Ask about this...';
        var sendBtn = document.createElement('button');
        sendBtn.className = 'ai-sel-send';
        sendBtn.type = 'button';
        sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h12M9 4l4 4-4 4"/></svg>';
        wrap.appendChild(inp);
        wrap.appendChild(sendBtn);
        popup.appendChild(btnS);
        popup.appendChild(orLabel);
        popup.appendChild(wrap);
        document.body.appendChild(popup);
        var selText = '';
        function hide() { popup.classList.remove('visible'); inp.value = ''; }
        function show(centerX, y) {
          popup.style.left = centerX + 'px'; popup.style.top = y + 'px';
          popup.style.transform = 'translateX(-50%)';
          popup.classList.add('visible'); inp.value = '';
          setTimeout(function() { inp.focus(); }, 50);
        }
        function sendAsk() {
          var q = inp.value.trim();
          console.log('__AI_ACTION__:' + JSON.stringify({ type: 'ask', text: selText, query: q }));
          hide(); window.getSelection().removeAllRanges();
        }
        document.addEventListener('mouseup', function(e) {
          if (window.location.protocol === 'browser-error:') return;
          if (popup.contains(e.target)) return;
          setTimeout(function() {
            if (window.location.protocol === 'browser-error:') return;
            var sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) { hide(); return; }
            var range = sel.getRangeAt(0);
            if (range.collapsed) { hide(); return; }
            var t = (sel ? sel.toString() : '').trim();
            if (t.length <= 3) { hide(); return; }
            function isInEditable(node) {
              while (node && node !== document.body) {
                if (node.nodeType === 1) {
                  var el = node; var tag = el.tagName;
                  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
                  if (el.isContentEditable) return true;
                }
                node = node.parentNode;
              }
              return false;
            }
            var active = document.activeElement;
            if ((active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) ||
                isInEditable(range.commonAncestorContainer)) { hide(); return; }
            selText = t;
            var rect = range.getBoundingClientRect();
            var centerX = rect.left + rect.width / 2;
            var py = rect.top - 120;
            if (py < 8) py = rect.bottom + 8;
            show(Math.max(120, Math.min(window.innerWidth - 120, centerX)), py);
          }, 10);
        });
        document.addEventListener('mousedown', function(e) { if (!popup.contains(e.target)) hide(); });
        document.addEventListener('scroll', hide, true);
        btnS.addEventListener('click', function() {
          console.log('__AI_ACTION__:' + JSON.stringify({ type: 'summarize', text: selText }));
          hide(); window.getSelection().removeAllRanges();
        });
        inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); sendAsk(); } });
        sendBtn.addEventListener('click', sendAsk);
      })()
    `)

    if (tab && tab.isAgent) {
      view.webContents.insertCSS(`
        #agent-toast-pill {
          position: fixed; top: 24px; left: 50%; transform: translateX(-50%);
          z-index: 2147483647; padding: 8px 24px; border-radius: 30px;
          background: linear-gradient(135deg, #0d9488, #14b8a6); color: white;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 13px; font-weight: 500; letter-spacing: 0.3px;
          box-shadow: 0 4px 20px rgba(20, 184, 166, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.2); backdrop-filter: blur(8px);
          pointer-events: none; opacity: 0;
          transition: opacity 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
          animation: agent-float 3s ease-in-out infinite;
        }
        #agent-toast-pill.visible { opacity: 1; }
        @keyframes agent-float {
          0%, 100% { transform: translate(-50%, 0); }
          50% { transform: translate(-50%, -6px); }
        }
      `)
      view.webContents.executeJavaScript(`
        if (!document.getElementById('agent-toast-pill')) {
          const el = document.createElement('div');
          el.id = 'agent-toast-pill';
          el.textContent = 'AI Assistant is working...';
          document.body.appendChild(el);
          void el.offsetWidth;
          el.classList.add('visible');
        }
      `)
    }

    // Skip credential detection for private tabs/windows
    if (!tab?.isPrivate) {
      setTimeout(async () => {
        try {
          const url = view.webContents.getURL()
          if (!url || url.startsWith('about:') || url.startsWith('file:') || url.startsWith('chrome:')) return
          const loginForm = await view.webContents.executeJavaScript(DETECT_LOGIN_FORM_SCRIPT)
          if (loginForm && loginForm.fields.length > 0) {
            const savedCreds = loadCredentials()[loginForm.domain] || []
            await injectCredentialModal(view, loginForm, savedCreds, state.win)
          }
        } catch (_) {}
      }, 1800)
    }
  })

  view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (tabId === state.activeTabId && state.win) {
      state.win.webContents.send('navigation-error', { errorCode, errorDescription })
    }
    if (isMainFrame && errorCode !== ERR_ABORTED && validatedURL && !validatedURL.startsWith('browser-error://')) {
      const tab = allTabs.get(tabId)
      if (tab) {
        tab.failedUrl = validatedURL
        tab.loadingErrorPage = true
      }
      const errorUrl = `browser-error://?url=${encodeURIComponent(validatedURL)}&code=${encodeURIComponent(String(errorCode))}&desc=${encodeURIComponent(errorDescription || '')}`
      view.webContents.loadURL(errorUrl)
    }
  })

  view.webContents.on('did-navigate', (event, url) => {
    const tab = allTabs.get(tabId)
    if (tab) {
      if (url.startsWith('browser-error://') && tab.failedUrl) {
        tab.url = tab.failedUrl
        tab.title = 'Page load failed'
      } else {
        if (!url.startsWith('browser-error://')) tab.failedUrl = null
        tab.url = url
        tab.title = view.webContents.getTitle() || url
      }
      sendTabsUpdate(state)
    }
    if (tabId === state.activeTabId && state.win) {
      const displayUrl = (tab && url.startsWith('browser-error://') && tab.failedUrl) ? tab.failedUrl : url
      state.win.webContents.send('url-changed', {
        url: displayUrl, canGoBack: view.webContents.canGoBack(), canGoForward: view.webContents.canGoForward()
      })
    }
  })

  view.webContents.on('did-navigate-in-page', (event, url) => {
    const tab = allTabs.get(tabId)
    if (tab) { tab.url = url; sendTabsUpdate(state) }
    if (tabId === state.activeTabId && state.win) {
      state.win.webContents.send('url-changed', {
        url, canGoBack: view.webContents.canGoBack(), canGoForward: view.webContents.canGoForward()
      })
    }
  })

  view.webContents.on('console-message', (event, level, message) => {
    if (message.startsWith('__AI_ACTION__:')) {
      try {
        const data = JSON.parse(message.substring('__AI_ACTION__:'.length))
        if (state.win) { state.win.webContents.send('selection-action', data); state.win.webContents.focus() }
      } catch (_) {}
    }
    if (message.startsWith('__CRED_SAVE__:')) {
      try {
        const { domain, credential } = JSON.parse(message.substring('__CRED_SAVE__:'.length))
        const store = loadCredentials()
        if (!store[domain]) store[domain] = []
        credential.id = crypto.randomUUID()
        store[domain].push(credential)
        saveCredentials(store)
      } catch (_) {}
    }
    if (message === '__CRED_SUBMITTED__') { state.pendingCredVerifyTabId = tabId }
    if (message === '__CRED_PROCEED__') {
      state.pendingCredVerifyTabId = null
      if (state.win) state.win.webContents.send('cred-modal-closed')
    }
    if (message === '__CRED_DISMISSED__') {
      if (state.pendingCredVerifyTabId === tabId) {
        state.pendingCredVerifyTabId = null
        scheduleCredVerify(tabId, view, state)
      } else {
        if (state.win) state.win.webContents.send('cred-modal-closed')
      }
    }
  })

  view.webContents.on('page-title-updated', (event, title) => {
    const tab = allTabs.get(tabId)
    if (tab) { tab.title = title; sendTabsUpdate(state) }
  })

  // When user clicks inside a split pane's BrowserView, make that pane active
  view.webContents.on('focus', () => {
    const group = getGroupForTab(state, tabId)
    if (!group) return
    const pane = group.panes.find(p => p.tabId === tabId)
    if (pane && pane.paneId !== group.activePaneId) {
      group.activePaneId = pane.paneId
      state.activeTabId = tabId
      sendSplitLayoutUpdate(state)
      sendTabsUpdate(state)
    }
  })
}

// ── Tab Management ───────────────────────────────────────────────────────────
function createTab(url, options = {}, state) {
  const tabId = nextTabId++
  const targetUrl = url || 'https://www.google.com'
  const isAgent = options.isAgent || false
  const background = options.background || false
  const isPrivate = options.isPrivate || state.isPrivate || false

  const webPreferences = { nodeIntegration: false, contextIsolation: true, webSecurity: true }
  if (isPrivate) {
    webPreferences.session = session.fromPartition(`private-${tabId}`)
  }

  const view = new BrowserView({ webPreferences })
  allTabs.set(tabId, { view, title: 'New Tab', url: targetUrl, isAgent, isPrivate, winId: state.win.id })
  state.tabIds.add(tabId)

  wireViewEvents(tabId, view, state)
  view.webContents.loadURL(targetUrl)

  if (!background) switchTab(tabId, state)
  else sendTabsUpdate(state)
  return tabId
}

function focusActiveView(state) {
  const view = getActiveView(state)
  if (view?.webContents && !view.webContents.isDestroyed()) {
    try { view.webContents.focus() } catch (_) {}
  }
}

function switchTab(tabId, state) {
  if (!state.tabIds.has(tabId) || !state.win) return

  const groupForTab = getGroupForTab(state, tabId)
  if (groupForTab) {
    const paneForTab = groupForTab.panes.find(p => p.tabId === tabId)
    if (paneForTab) {
      // Switching to a tab that's in this split group: show that group with this pane active
      groupForTab.activePaneId = paneForTab.paneId
      state.activeTabId = tabId
      const tab = allTabs.get(tabId)
      if (tab) sendContentBackground(state, tab.view)
      updateBrowserViewBounds(state)
      sendTabsUpdate(state)
      sendSplitLayoutUpdate(state)
      state.win.webContents.send('url-changed', {
        url: tab?.view.webContents.getURL() || tab?.url || '',
        canGoBack: tab?.view.webContents.canGoBack() || false,
        canGoForward: tab?.view.webContents.canGoForward() || false
      })
      focusActiveView(state)
      return
    }
  }

  // Switching to a tab that's not in any group (or single view): show that tab only
  state.activeTabId = tabId
  for (const view of state.win.getBrowserViews()) {
    try { state.win.removeBrowserView(view) } catch (_) {}
  }
  const tab = allTabs.get(tabId)
  if (tab) {
    state.win.addBrowserView(tab.view)
    sendContentBackground(state, tab.view)
  }
  updateBrowserViewBounds(state)
  sendTabsUpdate(state)
  sendSplitLayoutUpdate(state)
  state.win.webContents.send('url-changed', {
    url: tab?.view.webContents.getURL() || tab?.url || '',
    canGoBack: tab?.view.webContents.canGoBack() || false,
    canGoForward: tab?.view.webContents.canGoForward() || false
  })
  focusActiveView(state)
}

const MAX_CLOSED_TABS = 15

function closeTab(tabId, state) {
  if (!state.tabIds.has(tabId)) return

  const tab = allTabs.get(tabId)
  if (tab) {
    if (state.closedTabs && tab.url && !tab.isAgent) {
      state.closedTabs.push({ url: tab.url, title: tab.title })
      if (state.closedTabs.length > MAX_CLOSED_TABS) state.closedTabs.shift()
    }
    if (state.activeTabId === tabId) state.win.removeBrowserView(tab.view)
    try { tab.view.webContents.close() } catch (_) {}
    allTabs.delete(tabId)
  }
  state.tabIds.delete(tabId)

  // If this tab was in a split group, remove it from that group
  const group = getGroupForTab(state, tabId)
  if (group) {
    const remaining = group.panes.filter(p => p.tabId !== tabId)
    if (remaining.length <= 1) {
      state.splitGroups = state.splitGroups.filter(g => g.groupId !== group.groupId)
      state.win.getBrowserViews().forEach(v => { try { state.win.removeBrowserView(v) } catch (_) {} })
      const keepTabId = remaining[0]?.tabId
      if (keepTabId != null) {
        state.activeTabId = keepTabId
        const keepTab = allTabs.get(keepTabId)
        if (keepTab) {
          state.win.addBrowserView(keepTab.view)
          state.win.webContents.send('url-changed', {
            url: keepTab.view.webContents.getURL() || keepTab.url || '',
            canGoBack: keepTab.view.webContents.canGoBack() || false,
            canGoForward: keepTab.view.webContents.canGoForward() || false
          })
        }
      }
    } else {
      group.panes = redistributeEvenly(remaining)
      if (!group.panes.find(p => p.paneId === group.activePaneId)) {
        group.activePaneId = group.panes[0].paneId
        state.activeTabId = group.panes[0].tabId
      }
    }
    updateBrowserViewBounds(state)
    sendTabsUpdate(state)
    sendSplitLayoutUpdate(state)
  }

  if (state.tabIds.size === 0) {
    state.activeTabId = null
    if (state.isPrivate) {
      state.win.close()
    } else {
      createTab('https://www.google.com', {}, state)
    }
    return
  }

  if (state.activeTabId === tabId) {
    const ids = [...state.tabIds]
    switchTab(ids[ids.length - 1], state)
  } else {
    sendTabsUpdate(state)
  }
}

// ── Window Creation ──────────────────────────────────────────────────────────
function createWindow(isPrivate = false) {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hidden',
    frame: false,
    backgroundColor: isPrivate ? '#0f172a' : '#1e1e1e'
  })

  const state = {
    win,
    isPrivate,
    tabIds: new Set(),
    activeTabId: null,
    sidebarOpen: false,
    sidebarWidth: 0,
    leftChromeWidth: 0,
    contentTop: 128,
    findBarOpen: false,
    addressModalOpen: false,
    settingsModalOpen: false,
    pendingCredVerifyTabId: null,
    closedTabs: [], // last 15 closed tabs for reopen (url, title)
    lastModKeyTime: 0,
    splitGroups: [],     // [{ groupId, panes: [{paneId, tabId, fx, fy, fw, fh}], activePaneId }, ...]
    tabDragging: false   // true while a tab is being dragged (BrowserViews hidden)
  }
  winStates.set(win.id, state)

  win.loadFile('index.html').then(() => {
    win.maximize()
    if (isPrivate) {
      win.webContents.send('private-window-mode')
    }
    createTab('https://www.google.com', { isPrivate }, state)
    win.webContents.setWindowOpenHandler(({ url }) => {
      const u = (url || '').trim()
      if (u && (u.startsWith('http://') || u.startsWith('https://'))) {
        createTab(u, { isPrivate }, state)
      }
      return { action: 'deny' }
    })
  })

  win.on('resize', () => updateBrowserViewBounds(state))
  win.on('maximize', () => updateBrowserViewBounds(state))
  win.on('unmaximize', () => updateBrowserViewBounds(state))

  win.on('closed', () => {
    for (const tabId of state.tabIds) {
      const tab = allTabs.get(tabId)
      if (tab) {
        try { tab.view.webContents.close() } catch (_) {}
        allTabs.delete(tabId)
      }
    }
    winStates.delete(win.id)
  })

  return state
}

// ── IPC: Tabs ────────────────────────────────────────────────────────────────
ipcMain.on('create-tab', (event, url) => {
  const state = stateForEvent(event)
  if (!state) return
  // New tab opens as single tab; split group is preserved (switchTab will show single view)
  createTab(url || undefined, { isPrivate: state.isPrivate }, state)
})

ipcMain.on('create-private-window', () => {
  createWindow(true)
})

ipcMain.on('close-tab', (event, tabId) => {
  const state = stateForEvent(event)
  if (state) closeTab(tabId, state)
})

ipcMain.on('switch-tab', (event, tabId) => {
  const state = stateForEvent(event)
  if (state) switchTab(tabId, state)
})

ipcMain.on('create-window', () => {
  createWindow(false)
})

ipcMain.on('reopen-closed-tab', (event) => {
  const state = stateForEvent(event)
  if (!state?.closedTabs?.length) return
  const { url } = state.closedTabs.pop()
  if (url) createTab(url, { isPrivate: state.isPrivate }, state)
})

ipcMain.handle('get-closed-tabs', (event) => {
  const state = stateForEvent(event)
  if (!state?.closedTabs?.length) return []
  return [...state.closedTabs].reverse()
})

ipcMain.on('scroll-page', (event, where) => {
  const state = stateForEvent(event)
  const view = getActiveView(state)
  if (!view) return
  const script = where === 'bottom'
    ? 'window.scrollTo(0, document.documentElement.scrollHeight - document.documentElement.clientHeight)'
    : 'window.scrollTo(0, 0)'
  view.webContents.executeJavaScript(script).catch(() => {})
})

ipcMain.on('stop-loading', (event) => {
  const view = getActiveView(stateForEvent(event))
  if (view) view.webContents.stopLoad()
})

const ZOOM_STEP = 0.25
const ZOOM_MIN = 0.25
const ZOOM_MAX = 5

ipcMain.on('zoom', (event, direction) => {
  const state = stateForEvent(event)
  const view = getActiveView(state)
  if (!view) return
  const zoom = view.webContents.getZoomFactor()
  if (direction === 'in') view.webContents.setZoomFactor(Math.min(zoom + ZOOM_STEP, ZOOM_MAX))
  else if (direction === 'out') view.webContents.setZoomFactor(Math.max(zoom - ZOOM_STEP, ZOOM_MIN))
  else if (direction === 'reset') view.webContents.setZoomFactor(1)
})

ipcMain.on('toggle-devtools', (event) => {
  const state = stateForEvent(event)
  const view = getActiveView(state)
  if (view) view.webContents.toggleDevTools()
})

ipcMain.on('find-in-page', (event, text, findNext) => {
  const state = stateForEvent(event)
  const view = getActiveView(state)
  if (!view) return
  if (!text) {
    view.webContents.stopFindInPage('clearSelection')
    return
  }
  view.webContents.findInPage(text, { forward: true, findNext: !!findNext })
})

ipcMain.handle('create-agent-tab', (event, url, background) => {
  const state = stateForEvent(event)
  if (!state) return null
  return createTab(url || 'https://www.google.com', { isAgent: true, isPrivate: state.isPrivate, background: !!background }, state)
})

ipcMain.on('start-agent-control', (event, tabId) => {
  const tab = allTabs.get(tabId)
  if (tab && !tab.isAgent) {
    tab.isAgent = true
    const state = winStates.get(tab.winId)
    if (state) updateBrowserViewBounds(state)
  }
})

ipcMain.on('stop-agent-control', (event, tabId) => {
  const tab = allTabs.get(tabId)
  if (tab && tab.isAgent) {
    tab.isAgent = false
    tab.view.webContents.executeJavaScript(`
      (function() {
        const el = document.getElementById('agent-toast-pill');
        if (el) el.remove();
      })()
    `).catch(() => {})
    const state = winStates.get(tab.winId)
    if (state) updateBrowserViewBounds(state)
  }
})

// ── IPC: Navigation ──────────────────────────────────────────────────────────
ipcMain.on('navigate', (event, url) => {
  const state = stateForEvent(event)
  const view = getActiveView(state)
  if (!view) return
  let targetUrl = url
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    if (url.includes('.') && !url.includes(' ')) {
      targetUrl = 'https://' + url
    } else {
      targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(url)
    }
  }
  view.webContents.loadURL(targetUrl)
})

ipcMain.on('get-navigation-state', (event) => {
  const state = stateForEvent(event)
  const view = getActiveView(state)
  if (state?.win && view) {
    state.win.webContents.send('navigation-state-changed', {
      canGoBack: view.webContents.canGoBack(),
      canGoForward: view.webContents.canGoForward()
    })
  }
})

ipcMain.on('go-back',    (event) => { const v = getActiveView(stateForEvent(event)); if (v) v.webContents.goBack() })
ipcMain.on('go-forward', (event) => { const v = getActiveView(stateForEvent(event)); if (v) v.webContents.goForward() })
ipcMain.on('reload',     (event) => { const v = getActiveView(stateForEvent(event)); if (v) v.webContents.reload() })

// ── IPC: Sidebar / Layout ────────────────────────────────────────────────────
ipcMain.on('sidebar-toggled', (event, isOpen) => {
  const state = stateForEvent(event)
  if (state) { state.sidebarOpen = isOpen; updateBrowserViewBounds(state) }
})

ipcMain.on('sidebar-width-changed', (event, width) => {
  const state = stateForEvent(event)
  if (state) { state.sidebarWidth = width; updateBrowserViewBounds(state) }
})

ipcMain.on('left-chrome-width-changed', (event, width) => {
  const state = stateForEvent(event)
  if (state) { state.leftChromeWidth = width; updateBrowserViewBounds(state) }
})

ipcMain.on('chrome-layout-changed', (event, { leftChromeWidth, contentTop }) => {
  const state = stateForEvent(event)
  if (state) {
    if (leftChromeWidth !== undefined) state.leftChromeWidth = leftChromeWidth
    if (contentTop !== undefined) state.contentTop = contentTop
    updateBrowserViewBounds(state)
  }
})

ipcMain.on('find-bar-open', (event) => {
  const state = stateForEvent(event)
  if (state) { state.findBarOpen = true; updateBrowserViewBounds(state) }
})

ipcMain.on('find-bar-closed', (event) => {
  const state = stateForEvent(event)
  if (state) { state.findBarOpen = false; updateBrowserViewBounds(state) }
})

ipcMain.on('address-modal-opened', (event) => {
  const state = stateForEvent(event)
  if (state) { state.addressModalOpen = true; updateBrowserViewBounds(state) }
})

ipcMain.on('address-modal-closed', (event) => {
  const state = stateForEvent(event)
  if (state) { state.addressModalOpen = false; updateBrowserViewBounds(state) }
})

ipcMain.on('settings-modal-opened', (event) => {
  const state = stateForEvent(event)
  if (state) { state.settingsModalOpen = true; updateBrowserViewBounds(state) }
})

ipcMain.on('settings-modal-closed', (event) => {
  const state = stateForEvent(event)
  if (state) { state.settingsModalOpen = false; updateBrowserViewBounds(state) }
})

ipcMain.on('hide-browser-view', (event) => {
  const state = stateForEvent(event)
  if (!state?.win || !state.activeTabId) return
  const tab = allTabs.get(state.activeTabId)
  if (tab) state.win.removeBrowserView(tab.view)
})

ipcMain.on('show-browser-view', (event) => {
  const state = stateForEvent(event)
  if (!state?.win || !state.activeTabId) return
  const tab = allTabs.get(state.activeTabId)
  if (tab) { state.win.addBrowserView(tab.view); updateBrowserViewBounds(state) }
})

// ── IPC: Window Controls ─────────────────────────────────────────────────────
ipcMain.on('close-window',    (event) => { event.sender.getOwnerBrowserWindow()?.close() })
ipcMain.on('minimize-window', (event) => { event.sender.getOwnerBrowserWindow()?.minimize() })

ipcMain.on('maximize-window', (event) => {
  const win = event.sender.getOwnerBrowserWindow()
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
  const state = stateForWindow(win)
  if (state) setTimeout(() => updateBrowserViewBounds(state), 100)
})

// ── IPC: Page Context / Agent Actions ────────────────────────────────────────
ipcMain.handle('get-page-context', async (event, tabId) => {
  const view = getViewForTab(tabId)
  if (!view) return { title: '', url: '', headings: [], elements: [], mainText: '' }
  try {
    const context = await view.webContents.executeJavaScript(`
      (function() {
        var elements = [];
        var id = 0;
        var MAX = 200;
        var selectors = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [type="submit"], [onclick]';
        var els = document.querySelectorAll(selectors);
        for (var i = 0; i < els.length && id < MAX; i++) {
          var el = els[i];
          var rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          if (el.disabled) continue;
          if (el.type === 'hidden') continue;
          el.setAttribute('data-ai-id', id);
          var info = { id: id, tag: el.tagName.toLowerCase() };
          if (el.type) info.type = el.type;
          if (el.name) info.name = el.name;
          if (el.id) info.elementId = el.id;
          if (el.placeholder) info.placeholder = el.placeholder;
          if (el.href) info.href = el.href;
          if (el.getAttribute('aria-label')) info.ariaLabel = el.getAttribute('aria-label');
          if (el.title) info.title = el.title;
          if (el.getAttribute('role')) info.role = el.getAttribute('role');
          if (el.value && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) info.value = el.value;
          var text = (el.innerText || el.textContent || '').trim();
          if (text && text.length > 0) info.text = text.substring(0, 80);
          elements.push(info);
          id++;
        }
        var headings = [];
        var hs = document.querySelectorAll('h1, h2, h3');
        for (var j = 0; j < hs.length && j < 10; j++) {
          var t = hs[j].textContent.trim();
          if (t) headings.push(t.substring(0, 100));
        }
        function getMainText() {
          var root = document.querySelector('main') || document.querySelector('article') ||
            document.querySelector('#main') || document.querySelector('#content') || document.body;
          var text = (root && root.innerText) ? root.innerText : (document.body ? document.body.innerText : '');
          text = (text || '').replace(/\\s+/g, ' ').trim();
          if (text.length > 4000) text = text.substring(0, 4000);
          return text;
        }
        return { title: document.title, url: window.location.href, headings: headings, elements: elements, mainText: getMainText() };
      })()
    `)
    return context
  } catch (_) {
    return { title: '', url: '', headings: [], elements: [], mainText: '' }
  }
})

ipcMain.handle('get-page-url', async (event, tabId) => {
  const view = getViewForTab(tabId)
  if (!view) return ''
  return view.webContents.getURL()
})

ipcMain.handle('execute-action', async (event, action, tabId) => {
  const view = getViewForTab(tabId)
  if (!view) return { success: false, error: 'No browser view' }
  try {
    if (action.action === 'navigate') {
      await view.webContents.loadURL(action.url)
      return { success: true }
    }
    if (action.action === 'click') {
      const eid = Number(action.elementId)
      const result = await view.webContents.executeJavaScript(`
        (function() {
          var el = document.querySelector('[data-ai-id="${eid}"]');
          if (el) { el.click(); return true; }
          return false;
        })()
      `)
      return { success: result, error: result ? null : 'Element [' + eid + '] not found' }
    }
    if (action.action === 'type') {
      const eid = Number(action.elementId)
      const text = String(action.text ?? '')
      const focusResult = await view.webContents.executeJavaScript(`
        (function() {
          var el = document.querySelector('[data-ai-id="${eid}"]');
          if (!el) return false;
          el.focus();
          if (typeof el.select === 'function') { el.select(); return true; }
          if (el.isContentEditable) {
            var sel = window.getSelection(); var range = document.createRange();
            range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range);
            return true;
          }
          return true;
        })()
      `)
      if (!focusResult) return { success: false, error: 'Element [' + eid + '] not found' }
      await view.webContents.insertText(text)
      await view.webContents.executeJavaScript(`
        (function() {
          var active = document.activeElement;
          if (!active) return;
          active.dispatchEvent(new Event('change', { bubbles: true }));
        })()
      `)
      return { success: true }
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('wait-for-load', (event, tabId) => {
  return new Promise((resolve) => {
    const view = getViewForTab(tabId)
    if (!view) return resolve()
    if (!view.webContents.isLoading()) { setTimeout(resolve, 1500); return }
    const timeout = setTimeout(resolve, 10000)
    view.webContents.once('did-finish-load', () => { clearTimeout(timeout); setTimeout(resolve, 1500) })
  })
})

// ── Application menu: Cmd+W = Close Tab (not Close Window) when browser is focused ─
function getFocusedState() {
  const win = BrowserWindow.getFocusedWindow()
  return win ? winStates.get(win.id) : null
}

function buildAppMenu() {
  const template = []

  // macOS requires the first menu to be the app menu
  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    })
  }

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' },
    ],
  })

  return Menu.buildFromTemplate(template)
}

// ── WhatsApp Service ──────────────────────────────────────────────────────────
const QRCode = require('qrcode')
const { EventEmitter } = require('events')
const waEvents = new EventEmitter()
let waSock = null
let waStatus = 'disconnected' // 'disconnected' | 'qr' | 'connecting' | 'connected'
let waPhone = null
let waIntentionalClose = false
let waIdleTimer = null
let waHasSession = false // cached; avoids sync I/O in hot paths
const IDLE_DISCONNECT_MS = 30_000

const waNoopLogger = {
  level: 'silent',
  child: () => waNoopLogger,
  trace: () => {}, debug: () => {}, info: () => {},
  warn: () => {}, error: () => {}, fatal: () => {}
}

function waSessionPath() {
  return path.join(app.getPath('userData'), 'whatsapp-session')
}

function waSessionExists() {
  try {
    const sp = waSessionPath()
    return fs.existsSync(sp) && fs.readdirSync(sp).length > 0
  } catch (_) { return false }
}

function sendWaStatusToAll(data) {
  const payload = { ...data, sessionExists: waHasSession }
  waEvents.emit('status', payload)
  BrowserWindow.getAllWindows().forEach(win => {
    try { if (!win.isDestroyed()) win.webContents.send('whatsapp-status', payload) } catch (_) {}
  })
}

function resetIdleTimer() {
  if (waIdleTimer) clearTimeout(waIdleTimer)
  waIdleTimer = setTimeout(() => {
    if (waSock && waStatus === 'connected') {
      waIntentionalClose = true
      try { waSock.end(undefined) } catch (_) {}
    }
  }, IDLE_DISCONNECT_MS)
}

// Connects (if not already) and resolves when 'connected', rejects on timeout/failure
function connectAndWait(timeoutMs = 20000) {
  if (waStatus === 'connected') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waEvents.removeListener('status', handler)
      reject(new Error('Connection timed out'))
    }, timeoutMs)
    let attemptCount = 0
    function handler(data) {
      if (data.status === 'connected') {
        clearTimeout(timer)
        waEvents.removeListener('status', handler)
        resolve()
      } else if (data.status === 'connecting' || data.status === 'qr') {
        attemptCount++
      } else if (data.status === 'disconnected' && attemptCount === 0) {
        // Failed immediately before even starting a connect attempt — give up
        clearTimeout(timer)
        waEvents.removeListener('status', handler)
        reject(new Error('Connection failed'))
      }
      // If disconnected after a connect attempt Baileys will auto-reconnect; keep waiting
    }
    waEvents.on('status', handler)
    connectWhatsApp()
  })
}

async function connectWhatsApp() {
  if (waSock || waStatus === 'connecting') return
  try {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = await import('baileys')
    const { Boom } = await import('@hapi/boom')

    const { state, saveCreds } = await useMultiFileAuthState(waSessionPath())

    let version = [2, 3000, 1015920675]
    try { const f = await fetchLatestBaileysVersion(); version = f.version } catch (_) {}

    waSock = makeWASocket({ version, auth: state, printQRInTerminal: false, logger: waNoopLogger })

    waSock.ev.on('creds.update', () => { waHasSession = true; saveCreds() })

    waSock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        waStatus = 'qr'
        try {
          const qrDataUrl = await QRCode.toDataURL(qr, { width: 220, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
          sendWaStatusToAll({ status: 'qr', qrDataUrl })
        } catch (e) { console.error('[WA] QR gen failed:', e.message) }
      }

      if (connection === 'connecting') {
        waStatus = 'connecting'
        sendWaStatusToAll({ status: 'connecting' })
      }

      if (connection === 'close') {
        const code = new Boom(lastDisconnect?.error)?.output?.statusCode
        const loggedOut = code === DisconnectReason.loggedOut
        const wasIntentional = waIntentionalClose
        waSock = null
        waStatus = 'disconnected'
        waPhone = null
        waIntentionalClose = false
        if (waIdleTimer) { clearTimeout(waIdleTimer); waIdleTimer = null }
        sendWaStatusToAll({ status: 'disconnected' })
        // Reconnect unless logged out or we intentionally closed (idle disconnect)
        if (!loggedOut && !wasIntentional) setTimeout(connectWhatsApp, 3000)
      }

      if (connection === 'open') {
        waStatus = 'connected'
        waHasSession = true
        const id = waSock.user?.id || ''
        waPhone = id.split(':')[0] || id.split('@')[0] || ''
        sendWaStatusToAll({ status: 'connected', phone: waPhone })
      }
    })
  } catch (e) {
    console.error('[WA] Connect failed:', e.message)
    waSock = null
    waStatus = 'disconnected'
    sendWaStatusToAll({ status: 'disconnected' })
  }
}

ipcMain.handle('whatsapp-get-status', () => ({ status: waStatus, phone: waPhone, sessionExists: waHasSession }))


ipcMain.handle('whatsapp-connect', async () => {
  await connectWhatsApp()
  return { success: true }
})

ipcMain.handle('whatsapp-send-message', async (_event, phone, message) => {
  // Lazily connect if a session exists but socket is not up
  if (waStatus !== 'connected') {
    if (!waHasSession) return { success: false, needsQR: true, error: 'WhatsApp not connected' }
    try { await connectAndWait() } catch (e) { return { success: false, error: 'Could not connect: ' + e.message } }
  }
  if (!waSock || waStatus !== 'connected') return { success: false, error: 'WhatsApp not connected' }
  try {
    const cleanPhone = phone.replace(/[^\d+@]/g, '').replace(/(?!^\+)\+/g, '')
    const jid = cleanPhone.includes('@') ? cleanPhone : `${cleanPhone}@s.whatsapp.net`
    await waSock.sendMessage(jid, { text: message })
    resetIdleTimer()
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('whatsapp-disconnect', async () => {
  try { if (waSock) { await waSock.logout(); waSock = null } } catch (_) {}
  waStatus = 'disconnected'
  waPhone = null
  waHasSession = false
  try { fs.rmSync(waSessionPath(), { recursive: true, force: true }) } catch (_) {}
  sendWaStatusToAll({ status: 'disconnected' })
  return { success: true }
})

// ── Split View (multiple independent groups) ───────────────────────────────────
let _splitPaneCounter = 0
let _splitGroupCounter = 0
function newPaneId() { return `sp${++_splitPaneCounter}` }
function newGroupId() { return `sg${++_splitGroupCounter}` }

function getGroupForTab(state, tabId) {
  if (!state?.splitGroups?.length) return null
  return state.splitGroups.find(g => g.panes.some(p => p.tabId === tabId)) || null
}

function getActiveGroup(state) {
  if (!state?.activeTabId) return null
  return getGroupForTab(state, state.activeTabId)
}

function sendSplitLayoutUpdate(state) {
  if (!state?.win) return
  const activeGroup = getActiveGroup(state)
  state.win.webContents.send('split-layout-changed', {
    splitGroups: state.splitGroups,
    activeGroupId: activeGroup ? activeGroup.groupId : null
  })
}

// Redistribute N remaining panes into equal-sized slots.
// Detects if panes are in a row (columns layout), a column (rows layout), or mixed (grid).
function redistributeEvenly(panes) {
  const n = panes.length
  if (n === 0) return panes
  if (n === 1) return [{ ...panes[0], fx: 0, fy: 0, fw: 1, fh: 1 }]

  const EPS = 0.02
  const allSameY = panes.every(p => Math.abs(p.fy - panes[0].fy) < EPS && Math.abs(p.fh - panes[0].fh) < EPS)
  const allSameX = panes.every(p => Math.abs(p.fx - panes[0].fx) < EPS && Math.abs(p.fw - panes[0].fw) < EPS)

  if (allSameY) {
    // Pure column layout → equal-width columns
    return panes.map((p, i) => ({ ...p, fx: i / n, fy: 0, fw: 1 / n, fh: 1 }))
  }
  if (allSameX) {
    // Pure row layout → equal-height rows
    return panes.map((p, i) => ({ ...p, fx: 0, fy: i / n, fw: 1, fh: 1 / n }))
  }
  // Mixed (e.g. grid) → distribute as equal columns (simplest legible result)
  return panes.map((p, i) => ({ ...p, fx: i / n, fy: 0, fw: 1 / n, fh: 1 }))
}

// Build fractional pane list for a simple 2-pane split
function buildTwoPaneSplit(tabA, tabB, side) {
  const id1 = newPaneId(), id2 = newPaneId()
  if (side === 'left')   return [{ paneId: id1, tabId: tabA, fx: 0,   fy: 0,   fw: 0.5, fh: 1   }, { paneId: id2, tabId: tabB, fx: 0.5, fy: 0,   fw: 0.5, fh: 1   }]
  if (side === 'right')  return [{ paneId: id1, tabId: tabB, fx: 0,   fy: 0,   fw: 0.5, fh: 1   }, { paneId: id2, tabId: tabA, fx: 0.5, fy: 0,   fw: 0.5, fh: 1   }]
  if (side === 'top')    return [{ paneId: id1, tabId: tabA, fx: 0,   fy: 0,   fw: 1,   fh: 0.5 }, { paneId: id2, tabId: tabB, fx: 0,   fy: 0.5, fw: 1,   fh: 0.5 }]
  if (side === 'bottom') return [{ paneId: id1, tabId: tabB, fx: 0,   fy: 0,   fw: 1,   fh: 0.5 }, { paneId: id2, tabId: tabA, fx: 0,   fy: 0.5, fw: 1,   fh: 0.5 }]
  return null
}

// Pick the pane on the given edge for "add to split" (drag tab onto left/right/top/bottom zone)
function pickPaneIdForSide(splitLayout, side) {
  if (!splitLayout?.panes?.length) return null
  const panes = splitLayout.panes
  if (side === 'left') return panes.reduce((a, p) => (p.fx < a.fx ? p : a), panes[0])
  if (side === 'right') return panes.reduce((a, p) => (p.fx + p.fw > a.fx + a.fw ? p : a), panes[0])
  if (side === 'top') return panes.reduce((a, p) => (p.fy < a.fy ? p : a), panes[0])
  if (side === 'bottom') return panes.reduce((a, p) => (p.fy + p.fh > a.fy + a.fh ? p : a), panes[0])
  return null
}

// Build 2x2 panes with sourceTabId in the given quadrant
function build2x2WithQuadrant(sourceTabId, quadrant, state) {
  const available = [...state.tabIds]
  const ordered = [sourceTabId, ...available.filter(id => id !== sourceTabId)]
  while (ordered.length < 4) ordered.push(ordered[ordered.length - 1])
  const q = ['top-left', 'top-right', 'bottom-left', 'bottom-right'].indexOf(quadrant)
  if (q < 0) return null
  const arr = ordered.slice(0, 4)
  const idx = arr.indexOf(sourceTabId)
  if (idx !== q) { const t = arr[idx]; arr[idx] = arr[q]; arr[q] = t }
  return [
    { paneId: newPaneId(), tabId: arr[0], fx: 0,   fy: 0,   fw: 0.5, fh: 0.5 },
    { paneId: newPaneId(), tabId: arr[1], fx: 0.5, fy: 0,   fw: 0.5, fh: 0.5 },
    { paneId: newPaneId(), tabId: arr[2], fx: 0,   fy: 0.5, fw: 0.5, fh: 0.5 },
    { paneId: newPaneId(), tabId: arr[3], fx: 0.5, fy: 0.5, fw: 0.5, fh: 0.5 }
  ]
}

ipcMain.handle('apply-split-layout', (event, { sourceTabId, side, targetPaneId, preset }) => {
  const state = stateForEvent(event) || splitHoverPopupOwnerState
  if (!state) return
  state.tabDragging = false  // drag / popup closed; unblock updateBrowserViewBounds
  const interval = _dragIntervals.get(state.win?.id)
  if (interval) { clearInterval(interval); _dragIntervals.delete(state.win.id) }
  clearPreviewInViews(state)

  // Drag-drop zones 3-rows / 3-cols → treat as preset
  let effectivePreset = preset
  let effectiveSide = side
  if (!effectivePreset && (side === '3-rows' || side === '3-cols')) {
    effectivePreset = side
    effectiveSide = null
  }

  // ── Preset template (from hover-popup or drag 3-rows/3-cols) ──────────────
  if (effectivePreset) {
    const available = [...state.tabIds]
    const ordered = [sourceTabId, ...available.filter(id => id !== sourceTabId)]
    const ensure = (n) => { while (ordered.length < n) ordered.push(ordered[ordered.length - 1]) }
    let panes
    if (effectivePreset === 'left-right') {
      ensure(2)
      panes = buildTwoPaneSplit(ordered[0], ordered[1], 'left')
    } else if (effectivePreset === 'top-bottom') {
      ensure(2)
      panes = buildTwoPaneSplit(ordered[0], ordered[1], 'top')
    } else if (effectivePreset === '3-cols') {
      ensure(3)
      panes = [
        { paneId: newPaneId(), tabId: ordered[0], fx: 0,       fy: 0, fw: 1/3, fh: 1 },
        { paneId: newPaneId(), tabId: ordered[1], fx: 1/3,     fy: 0, fw: 1/3, fh: 1 },
        { paneId: newPaneId(), tabId: ordered[2], fx: 2/3,     fy: 0, fw: 1/3, fh: 1 }
      ]
    } else if (effectivePreset === 'left-right-split-right') {
      ensure(3)
      panes = [
        { paneId: newPaneId(), tabId: ordered[0], fx: 0,   fy: 0,   fw: 0.5, fh: 1   },
        { paneId: newPaneId(), tabId: ordered[1], fx: 0.5, fy: 0,   fw: 0.5, fh: 0.5 },
        { paneId: newPaneId(), tabId: ordered[2], fx: 0.5, fy: 0.5, fw: 0.5, fh: 0.5 }
      ]
    } else if (effectivePreset === '3-rows') {
      ensure(3)
      panes = [
        { paneId: newPaneId(), tabId: ordered[0], fx: 0, fy: 0,     fw: 1, fh: 1/3 },
        { paneId: newPaneId(), tabId: ordered[1], fx: 0, fy: 1/3,   fw: 1, fh: 1/3 },
        { paneId: newPaneId(), tabId: ordered[2], fx: 0, fy: 2/3,   fw: 1, fh: 1/3 }
      ]
    } else if (effectivePreset === '2x2') {
      ensure(4)
      panes = [
        { paneId: newPaneId(), tabId: ordered[0], fx: 0,   fy: 0,   fw: 0.5, fh: 0.5 },
        { paneId: newPaneId(), tabId: ordered[1], fx: 0.5, fy: 0,   fw: 0.5, fh: 0.5 },
        { paneId: newPaneId(), tabId: ordered[2], fx: 0,   fy: 0.5, fw: 0.5, fh: 0.5 },
        { paneId: newPaneId(), tabId: ordered[3], fx: 0.5, fy: 0.5, fw: 0.5, fh: 0.5 }
      ]
    } else return
    if (!panes) return
    // Remove these tabs from any existing groups (each tab belongs to at most one group)
    const tabIdsInPreset = [...new Set(panes.map(p => p.tabId))]
    for (const g of state.splitGroups) {
      g.panes = g.panes.filter(p => !tabIdsInPreset.includes(p.tabId))
      if (g.panes.length <= 1) state.splitGroups = state.splitGroups.filter(x => x.groupId !== g.groupId)
    }
    state.splitGroups = state.splitGroups.filter(g => g.panes.length > 1)
    const newGroup = { groupId: newGroupId(), panes, activePaneId: panes[0].paneId }
    state.splitGroups.push(newGroup)
    state.win.getBrowserViews().forEach(v => { try { state.win.removeBrowserView(v) } catch (_) {} })
    state.activeTabId = panes[0].tabId
    updateBrowserViewBounds(state)
    sendTabsUpdate(state)
    sendSplitLayoutUpdate(state)
    return
  }

  // ── Drag-drop split ───────────────────────────────────────────────────────
  if (!effectiveSide) return

  const quadrantSides = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
  if (quadrantSides.includes(effectiveSide)) {
    const panes = build2x2WithQuadrant(sourceTabId, effectiveSide, state)
    if (!panes) return
    const tabIdsInPreset = [...new Set(panes.map(p => p.tabId))]
    for (const g of state.splitGroups) {
      g.panes = g.panes.filter(p => !tabIdsInPreset.includes(p.tabId))
    }
    state.splitGroups = state.splitGroups.filter(g => g.panes.length > 1)
    const newGroup = { groupId: newGroupId(), panes, activePaneId: panes[0].paneId }
    state.splitGroups.push(newGroup)
    state.win.getBrowserViews().forEach(v => { try { state.win.removeBrowserView(v) } catch (_) {} })
    state.activeTabId = sourceTabId
    updateBrowserViewBounds(state)
    sendTabsUpdate(state)
    sendSplitLayoutUpdate(state)
    return
  }

  const sourceGroup = getGroupForTab(state, sourceTabId)
  if (sourceGroup) {
    // Add to existing group: pick pane on the dropped edge from this group
    let effectiveTargetPaneId = targetPaneId
    if (!effectiveTargetPaneId) {
      const edgePane = pickPaneIdForSide(sourceGroup, effectiveSide)
      if (edgePane) effectiveTargetPaneId = edgePane.paneId
    }
    const targetPane = sourceGroup.panes.find(p => p.paneId === effectiveTargetPaneId)
    if (!targetPane) return
    const newId = newPaneId()
    const { fx, fy, fw, fh } = targetPane
    if (effectiveSide === 'left') {
      sourceGroup.panes.push({ paneId: newId, tabId: sourceTabId, fx, fy, fw: fw / 2, fh })
      targetPane.fx += fw / 2; targetPane.fw = fw / 2
    } else if (effectiveSide === 'right') {
      sourceGroup.panes.push({ paneId: newId, tabId: sourceTabId, fx: fx + fw / 2, fy, fw: fw / 2, fh })
      targetPane.fw = fw / 2
    } else if (effectiveSide === 'top') {
      sourceGroup.panes.push({ paneId: newId, tabId: sourceTabId, fx, fy, fw, fh: fh / 2 })
      targetPane.fy += fh / 2; targetPane.fh = fh / 2
    } else if (effectiveSide === 'bottom') {
      sourceGroup.panes.push({ paneId: newId, tabId: sourceTabId, fx, fy: fy + fh / 2, fw, fh: fh / 2 })
      targetPane.fh = fh / 2
    } else return
    sourceGroup.activePaneId = newId
    state.activeTabId = sourceTabId
  } else {
    // Source tab not in any group: create a new independent split group (2-pane)
    const otherTabId = (state.activeTabId !== sourceTabId && !getGroupForTab(state, state.activeTabId))
      ? state.activeTabId
      : [...state.tabIds].find(id => id !== sourceTabId && !getGroupForTab(state, id))
    if (otherTabId == null) return
    const panes = buildTwoPaneSplit(sourceTabId, otherTabId, effectiveSide)
    if (!panes) return
    const tabIdsInNew = [sourceTabId, otherTabId]
    for (const g of state.splitGroups) {
      g.panes = g.panes.filter(p => !tabIdsInNew.includes(p.tabId))
    }
    state.splitGroups = state.splitGroups.filter(g => g.panes.length > 1)
    const newGroup = { groupId: newGroupId(), panes, activePaneId: panes.find(p => p.tabId === sourceTabId)?.paneId || panes[0].paneId }
    state.splitGroups.push(newGroup)
    state.win.getBrowserViews().forEach(v => { try { state.win.removeBrowserView(v) } catch (_) {} })
    state.activeTabId = sourceTabId
  }

  updateBrowserViewBounds(state)
  sendTabsUpdate(state)
  sendSplitLayoutUpdate(state)
})

ipcMain.handle('remove-from-split', (event, tabId) => {
  const state = stateForEvent(event) || splitHoverPopupOwnerState
  const group = state ? getGroupForTab(state, tabId) : null
  if (!state?.win || !group) return
  state.tabDragging = false

  const remaining = group.panes.filter(p => p.tabId !== tabId)

  if (remaining.length <= 1) {
    state.splitGroups = state.splitGroups.filter(g => g.groupId !== group.groupId)
    state.win.getBrowserViews().forEach(v => { try { state.win.removeBrowserView(v) } catch (_) {} })
    const keepTabId = remaining[0]?.tabId || state.activeTabId
    state.activeTabId = keepTabId
    const tab = allTabs.get(keepTabId)
    if (tab) state.win.addBrowserView(tab.view)
  } else {
    group.panes = redistributeEvenly(remaining)
    if (!group.panes.find(p => p.paneId === group.activePaneId)) {
      group.activePaneId = group.panes[0].paneId
      state.activeTabId = group.panes[0].tabId
    }
  }

  updateBrowserViewBounds(state)
  sendTabsUpdate(state)
  sendSplitLayoutUpdate(state)
})

ipcMain.handle('close-split', (event) => {
  const state = stateForEvent(event) || splitHoverPopupOwnerState
  if (!state) return
  state.tabDragging = false
  const activeGroup = getActiveGroup(state)
  if (activeGroup) {
    state.splitGroups = state.splitGroups.filter(g => g.groupId !== activeGroup.groupId)
  }
  state.win.getBrowserViews().forEach(v => { try { state.win.removeBrowserView(v) } catch (_) {} })
  const tab = allTabs.get(state.activeTabId)
  if (tab) state.win.addBrowserView(tab.view)
  updateBrowserViewBounds(state)
  sendTabsUpdate(state)
  sendSplitLayoutUpdate(state)
})

// Split hover popup: separate window so we don't hide the main window's web content
let splitHoverPopupWindow = null
let splitHoverPopupOwnerState = null
let splitHoverPopupOwnerWebContents = null

function hideSplitHoverPopupSafe() {
  if (!splitHoverPopupWindow || splitHoverPopupWindow.isDestroyed()) return
  splitHoverPopupWindow.hide()
  const wc = splitHoverPopupOwnerWebContents
  splitHoverPopupOwnerState = null
  splitHoverPopupOwnerWebContents = null
  if (wc && !wc.isDestroyed()) {
    try { wc.send('split-hover-popup-closed') } catch (_) {}
  }
}

ipcMain.on('show-split-hover-popup', (event, { left, top, tabId }) => {
  const state = stateForEvent(event)
  if (!state?.win) return
  const mainWin = state.win
  splitHoverPopupOwnerState = state
  splitHoverPopupOwnerWebContents = mainWin.webContents

  const sendOptionsAndShow = () => {
    const group = getGroupForTab(state, tabId)
    const opts = {
      tabId,
      showRemove: !!group,
      showExit: !!(group && group.panes.length > 1)
    }
    splitHoverPopupWindow.webContents.send('split-popup-options', opts)
    const bounds = mainWin.getContentBounds()
    const x = Math.round(bounds.x + left)
    const y = Math.round(bounds.y + top)
    splitHoverPopupWindow.setBounds({ x, y, width: 280, height: 240 })
    splitHoverPopupWindow.show()
    try { mainWin.webContents.send('split-hover-popup-opened', { left, top, width: 280, height: 240 }) } catch (_) {}
  }

  if (!splitHoverPopupWindow || splitHoverPopupWindow.isDestroyed()) {
    splitHoverPopupWindow = new BrowserWindow({
      parent: mainWin,
      width: 280,
      height: 240,
      frame: false,
      resizable: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'split-hover-popup-preload.js')
      },
      backgroundColor: '#252526'
    })
    splitHoverPopupWindow.setMenu(null)
    splitHoverPopupWindow.on('closed', () => {
      splitHoverPopupWindow = null
      splitHoverPopupOwnerState = null
      splitHoverPopupOwnerWebContents = null
    })
    splitHoverPopupWindow.webContents.once('did-finish-load', sendOptionsAndShow)
    splitHoverPopupWindow.loadFile(path.join(__dirname, 'split-hover-popup.html'))
  } else {
    sendOptionsAndShow()
  }
})

ipcMain.on('split-hover-popup-close', () => {
  hideSplitHoverPopupSafe()
})

ipcMain.on('split-popup-mouse-enter', () => {
  if (splitHoverPopupOwnerWebContents && !splitHoverPopupOwnerWebContents.isDestroyed()) {
    try { splitHoverPopupOwnerWebContents.send('split-popup-mouse-enter') } catch (_) {}
  }
})
ipcMain.on('split-popup-mouse-leave', () => {
  if (splitHoverPopupOwnerWebContents && !splitHoverPopupOwnerWebContents.isDestroyed()) {
    try { splitHoverPopupOwnerWebContents.send('split-popup-mouse-leave') } catch (_) {}
  }
})

// ── Drag-preview helpers ─────────────────────────────────────────────────────
const _dragIntervals = new Map()

function detectSplitEdge(state, cursorScreenPos) {
  const wb = state.win.getBounds()
  const reserved = state.sidebarOpen ? state.sidebarWidth : 0
  const leftChrome = state.leftChromeWidth || 0
  const contentTop = state.contentTop ?? 128
  const cx = wb.x + leftChrome
  const cy = wb.y + contentTop
  const cw = wb.width - leftChrome - reserved
  const ch = wb.height - contentTop
  const rx = cursorScreenPos.x - cx
  const ry = cursorScreenPos.y - cy
  if (rx < 0 || ry < 0 || rx > cw || ry > ch) return null
  const edgeW = cw * 0.25
  const edgeH = ch * 0.25
  if (rx < edgeW) return 'left'
  if (rx > cw - edgeW) return 'right'
  if (ry < edgeH) return 'top'
  if (ry > ch - edgeH) return 'bottom'
  return null
}

function getPreviewStyle(edge) {
  const base = 'position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:2147483647;background:rgba(20,184,166,0.18);border:3px solid rgba(20,184,166,0.6);box-sizing:border-box;transition:all 0.1s ease;'
  if (edge === 'right')  return base + 'left:50%;'
  if (edge === 'left')   return base + 'right:50%;'
  if (edge === 'top')    return base + 'bottom:50%;'
  if (edge === 'bottom') return base + 'top:50%;'
  return base + 'display:none;'
}

function injectPreviewInViews(state, edge) {
  const css = getPreviewStyle(edge)
  for (const view of state.win.getBrowserViews()) {
    try {
      view.webContents.executeJavaScript(`(function(){
        let el=document.getElementById('__sp_preview__')
        if(!el){el=document.createElement('div');el.id='__sp_preview__';document.body.appendChild(el)}
        el.style.cssText=${JSON.stringify(css)}
      })()`, true)
    } catch (_) {}
  }
}

function clearPreviewInViews(state) {
  if (!state?.win) return
  for (const view of state.win.getBrowserViews()) {
    try {
      view.webContents.executeJavaScript(`(function(){const el=document.getElementById('__sp_preview__');if(el)el.remove()})()`, true)
    } catch (_) {}
  }
}

ipcMain.on('tab-drag-start', (event) => {
  const state = stateForEvent(event)
  if (!state?.win) return
  let lastEdge = undefined
  const interval = setInterval(() => {
    const cursor = screen.getCursorScreenPoint()
    const edge = detectSplitEdge(state, cursor)
    if (edge !== lastEdge) {
      lastEdge = edge
      if (edge) injectPreviewInViews(state, edge)
      else clearPreviewInViews(state)
      try { state.win.webContents.send('drag-edge-updated', edge) } catch (_) {}
    }
  }, 30)
  _dragIntervals.set(state.win.id, interval)
})

ipcMain.on('tab-drag-end', (event) => {
  const state = stateForEvent(event)
  if (!state?.win) return
  const interval = _dragIntervals.get(state.win.id)
  if (interval) { clearInterval(interval); _dragIntervals.delete(state.win.id) }
  clearPreviewInViews(state)
  state.tabDragging = false
  updateBrowserViewBounds(state)
})

ipcMain.on('set-active-split-pane', (event, paneId) => {
  const state = stateForEvent(event)
  if (!state?.splitGroups?.length) return
  for (const group of state.splitGroups) {
    const pane = group.panes.find(p => p.paneId === paneId)
    if (pane) {
      group.activePaneId = paneId
      state.activeTabId = pane.tabId
      sendSplitLayoutUpdate(state)
      sendTabsUpdate(state)
      break
    }
  }
})

// ── Custom error page protocol ───────────────────────────────────────────────
const ERR_ABORTED = -3

function getErrorMessage(code, description) {
  const codeStr = String(code)
  if (codeStr === '-105' || description.includes('ERR_NAME_NOT_RESOLVED')) return 'This site can’t be reached'
  if (codeStr === '-106' || description.includes('ERR_INTERNET')) return 'You’re offline'
  if (codeStr === '-502' || description.includes('ERR_CONNECTION_REFUSED')) return 'Connection refused'
  if (codeStr === '-501' || description.includes('ERR_INSECURE')) return 'Connection not secure'
  if (codeStr === '-310' || description.includes('ERR_TOO_MANY_REDIRECTS')) return 'Too many redirects'
  if (description.includes('500') || description.includes('Internal Server Error')) return 'Server error (500)'
  if (description.includes('502') || description.includes('Bad Gateway')) return 'Bad gateway (502)'
  if (description.includes('503')) return 'Service unavailable (503)'
  if (description.includes('404')) return 'Page not found (404)'
  if (description.includes('403')) return 'Access denied (403)'
  return 'This page couldn’t be loaded'
}

function buildErrorPageHTML(failedUrl, errorCode, errorDescription) {
  const title = getErrorMessage(errorCode, errorDescription)
  const safeUrl = failedUrl.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  const safeDesc = (errorDescription || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #1a1a1a; color: #e0e0e0; padding: 24px; text-align: center;
    }
    .card {
      max-width: 420px; width: 100%;
    }
    .icon { font-size: 48px; margin-bottom: 16px; opacity: 0.9; }
    h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; color: #fff; }
    .url { font-size: 13px; color: #888; word-break: break-all; margin-bottom: 24px; }
    .detail { font-size: 12px; color: #666; margin-bottom: 28px; }
    .actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
    a {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 500;
      text-decoration: none; transition: background 0.2s, color 0.2s;
    }
    .primary { background: #14b8a6; color: #fff; }
    .primary:hover { background: #0d9488; }
    .secondary { background: #333; color: #e0e0e0; }
    .secondary:hover { background: #444; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon" aria-hidden="true">⚠</div>
    <h1>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</h1>
    <p class="url">${safeUrl}</p>
    ${safeDesc ? `<p class="detail">${safeDesc}</p>` : ''}
    <div class="actions">
      <a href="${safeUrl}" class="primary">Try again</a>
      <a href="javascript:history.back()" class="secondary">Go back</a>
    </div>
  </div>
</body>
</html>`
}

// ── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  protocol.handle('browser-error', (request) => {
    try {
      const u = new URL(request.url)
      const failedUrl = u.searchParams.get('url') || 'about:blank'
      const code = u.searchParams.get('code') || ''
      const desc = u.searchParams.get('desc') || ''
      const html = buildErrorPageHTML(failedUrl, code, desc)
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    } catch (_) {
      return new Response('Error', { status: 500 })
    }
  })

  waHasSession = waSessionExists() // one-time check at startup; kept in sync from here on
  createWindow(false)
  Menu.setApplicationMenu(buildAppMenu())

  // No global shortcuts: shortcuts only work when the browser window is focused
  // (handled in renderer when UI is focused, and in BrowserView before-input-event when page is focused)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(false)
  })
})


app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
