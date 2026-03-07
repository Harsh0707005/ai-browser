const { app, BrowserWindow, BrowserView, ipcMain, session, Menu } = require('electron/main')
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

  if (mod && key === 'n' && !input.shift) {
    createWindow(false)
    return true
  }
  if (mod && key === 't') {
    createTab(undefined, { isPrivate: state.isPrivate }, state)
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

// ── Layout ───────────────────────────────────────────────────────────────────
function updateBrowserViewBounds(state) {
  const view = getActiveView(state)
  if (!state?.win || !view) return
  const bounds = state.win.getContentBounds()
  const reserved = state.sidebarOpen ? state.sidebarWidth : 0
  const tab = allTabs.get(state.activeTabId)
  const borderWidth = tab?.isAgent ? 6 : 0
  const findBarH = state.findBarOpen ? FIND_BAR_HEIGHT : 0
  const toolbarH = (state.isPrivate ? TOOLBAR_HEIGHT_PRIVATE : TOOLBAR_HEIGHT_NORMAL) + findBarH

  view.setBounds({
    x: borderWidth,
    y: toolbarH + borderWidth,
    width: bounds.width - reserved - borderWidth * 2,
    height: bounds.height - toolbarH - borderWidth * 2
  })
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

  view.webContents.on('did-start-loading', () => {
    if (tabId === state.activeTabId && state.win) {
      state.win.webContents.send('navigation-start')
    }
  })

  view.webContents.on('did-finish-load', () => {
    const tab = allTabs.get(tabId)
    if (tab) {
      tab.url = view.webContents.getURL()
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
          if (popup.contains(e.target)) return;
          setTimeout(function() {
            var sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) { hide(); return; }
            var range = sel.getRangeAt(0);
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
          background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 13px; font-weight: 500; letter-spacing: 0.3px;
          box-shadow: 0 4px 20px rgba(139, 92, 246, 0.4);
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

  view.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    if (tabId === state.activeTabId && state.win) {
      state.win.webContents.send('navigation-error', { errorCode, errorDescription })
    }
  })

  view.webContents.on('did-navigate', (event, url) => {
    const tab = allTabs.get(tabId)
    if (tab) { tab.url = url; tab.title = view.webContents.getTitle() || url; sendTabsUpdate(state) }
    if (tabId === state.activeTabId && state.win) {
      state.win.webContents.send('url-changed', {
        url, canGoBack: view.webContents.canGoBack(), canGoForward: view.webContents.canGoForward()
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

function switchTab(tabId, state) {
  if (!state.tabIds.has(tabId) || !state.win) return

  if (state.activeTabId && state.tabIds.has(state.activeTabId)) {
    const prevTab = allTabs.get(state.activeTabId)
    if (prevTab) state.win.removeBrowserView(prevTab.view)
  }

  state.activeTabId = tabId
  const tab = allTabs.get(tabId)
  if (tab) state.win.addBrowserView(tab.view)
  updateBrowserViewBounds(state)
  sendTabsUpdate(state)

  state.win.webContents.send('url-changed', {
    url: tab?.view.webContents.getURL() || tab?.url || '',
    canGoBack: tab?.view.webContents.canGoBack() || false,
    canGoForward: tab?.view.webContents.canGoForward() || false
  })
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

  if (state.tabIds.size === 0) {
    state.activeTabId = null
    if (state.isPrivate) {
      // Close private window when last tab closes
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
    backgroundColor: isPrivate ? '#16162a' : '#1e1e1e'
  })

  const state = {
    win,
    isPrivate,
    tabIds: new Set(),
    activeTabId: null,
    sidebarOpen: false,
    sidebarWidth: 0,
    findBarOpen: false,
    pendingCredVerifyTabId: null,
    closedTabs: [] // last 15 closed tabs for reopen (url, title)
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
  if (state) createTab(url || undefined, { isPrivate: state.isPrivate }, state)
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

ipcMain.on('find-bar-open', (event) => {
  const state = stateForEvent(event)
  if (state) { state.findBarOpen = true; updateBrowserViewBounds(state) }
})

ipcMain.on('find-bar-closed', (event) => {
  const state = stateForEvent(event)
  if (state) { state.findBarOpen = false; updateBrowserViewBounds(state) }
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
  return Menu.buildFromTemplate([])
}

// ── WhatsApp Service ──────────────────────────────────────────────────────────
const QRCode = require('qrcode')
let waSock = null
let waStatus = 'disconnected' // 'disconnected' | 'qr' | 'connecting' | 'connected'
let waPhone = null

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
  BrowserWindow.getAllWindows().forEach(win => {
    try { if (!win.isDestroyed()) win.webContents.send('whatsapp-status', data) } catch (_) {}
  })
}

async function connectWhatsApp() {
  if (waSock) return
  try {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = await import('baileys')
    const { Boom } = await import('@hapi/boom')

    const { state, saveCreds } = await useMultiFileAuthState(waSessionPath())

    let version = [2, 3000, 1015920675]
    try { const f = await fetchLatestBaileysVersion(); version = f.version } catch (_) {}

    waSock = makeWASocket({ version, auth: state, printQRInTerminal: false, logger: waNoopLogger })

    waSock.ev.on('creds.update', saveCreds)

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
        waSock = null
        waStatus = 'disconnected'
        waPhone = null
        sendWaStatusToAll({ status: 'disconnected' })
        if (!loggedOut) setTimeout(connectWhatsApp, 3000)
      }

      if (connection === 'open') {
        waStatus = 'connected'
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

ipcMain.handle('whatsapp-get-status', () => ({ status: waStatus, phone: waPhone }))


ipcMain.handle('whatsapp-connect', async () => {
  await connectWhatsApp()
  return { success: true }
})

ipcMain.handle('whatsapp-send-message', async (_event, phone, message) => {
  if (!waSock || waStatus !== 'connected') return { success: false, error: 'WhatsApp not connected' }
  try {
    const cleanPhone = phone.replace(/[^\d+@]/g, '').replace(/(?!^\+)\+/g, '')
    const jid = cleanPhone.includes('@') ? cleanPhone : `${cleanPhone}@s.whatsapp.net`
    await waSock.sendMessage(jid, { text: message })
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('whatsapp-disconnect', async () => {
  try { if (waSock) { await waSock.logout(); waSock = null } } catch (_) {}
  waStatus = 'disconnected'
  waPhone = null
  try { fs.rmSync(waSessionPath(), { recursive: true, force: true }) } catch (_) {}
  sendWaStatusToAll({ status: 'disconnected' })
  return { success: true }
})

// ── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow(false)
  if (waSessionExists()) connectWhatsApp()
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
