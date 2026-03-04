const { app, BrowserWindow, BrowserView, ipcMain, globalShortcut } = require('electron/main')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

// ── Credential Storage ──────────────────────────────────────────────────────
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

async function injectCredentialModal(view, loginForm, savedCreds) {
  if (mainWindow) mainWindow.webContents.send('cred-modal-open')

  const domain    = JSON.stringify(loginForm.domain)
  const saved     = JSON.stringify(savedCreds)
  const fields    = JSON.stringify(loginForm.fields)
  const submitSel = JSON.stringify(loginForm.submitSelector)

  await view.webContents.executeJavaScript(`
(function() {
  if (document.getElementById('__ai_cred_overlay__')) return;

  var DOMAIN     = ${domain};
  var SAVED      = ${saved};
  var FIELDS     = ${fields};
  var SUBMIT_SEL = ${submitSel};
  var SEL_ID     = SAVED.length ? SAVED[0].id : null;

  // ── shared helpers ────────────────────────────────────────────────────────
  function dismiss() {
    var o = document.getElementById('__ai_cred_overlay__');
    if (o) o.remove();
    console.log('__CRED_DISMISSED__');
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

  // ── shell ─────────────────────────────────────────────────────────────────
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

  // header
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

  // ── list view ─────────────────────────────────────────────────────────────
  function renderListView() {
    titleEl.textContent = SAVED.length > 1 ? 'Saved Logins' : 'Saved Login';
    body.innerHTML = '';

    var hint = mk('p', { fontSize: '12px', color: '#444', marginBottom: '14px', lineHeight: '1.5' });
    hint.textContent = 'Use a saved login for this site?';
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
      dismiss();
      fillPage((cred.fieldMeta || []).map(function(f) { return { selector: f.selector, value: cred.fields[f.name] || '' }; }));
    });
    var diffBtn = mkBtn('Different account', 'secondary');
    diffBtn.addEventListener('click', function() { renderFormView('Enter different login details:'); });
    var selfBtn = mkBtn("I'll do it myself", 'ghost');
    selfBtn.style.marginLeft = 'auto';
    selfBtn.addEventListener('click', function() { dismiss(); showAwaitingPill(); });
    actions.appendChild(loginBtn); actions.appendChild(diffBtn); actions.appendChild(selfBtn);
    body.appendChild(actions);
  }

  // ── form view ─────────────────────────────────────────────────────────────
  function renderFormView(hintText) {
    titleEl.textContent = 'Sign In';
    body.innerHTML = '';
    var hint = mk('p', { fontSize: '12px', color: '#444', marginBottom: '16px', lineHeight: '1.5' });
    hint.textContent = hintText || 'Enter your credentials to continue.';
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
      dismiss();
      fillPage(fills);
    }

    var actions = mk('div', { display: 'flex', gap: '8px', alignItems: 'center' });
    var saveBtn = mkBtn('Save & Sign In', 'primary');
    saveBtn.addEventListener('click', doSubmit);
    var selfBtn = mkBtn("I'll do it myself", 'ghost');
    selfBtn.style.marginLeft = 'auto';
    selfBtn.addEventListener('click', function() { dismiss(); showAwaitingPill(); });
    actions.appendChild(saveBtn); actions.appendChild(selfBtn);
    body.appendChild(actions);

    inputs.forEach(function(inp) { inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); doSubmit(); } }); });
    if (inputs[0]) setTimeout(function() { inputs[0].focus(); }, 80);
  }

  // ── mount ─────────────────────────────────────────────────────────────────
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
  // fills: [{selector, value}] — values come from local storage, never from the backend WS
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

let mainWindow
let sidebarOpen = false
let sidebarWidth = 0

const tabs = new Map()
let activeTabId = null
let nextTabId = 1

const TOOLBAR_HEIGHT = 128

const getActiveView = () => activeTabId ? tabs.get(activeTabId)?.view : null
const getViewForTab = (tabId) => tabId ? tabs.get(tabId)?.view : getActiveView()

const updateBrowserViewBounds = () => {
  const view = getActiveView()
  if (!mainWindow || !view) return
  const bounds = mainWindow.getContentBounds()
  const reserved = sidebarOpen ? sidebarWidth : 0
  
  const activeTab = tabs.get(activeTabId)
  const isAgent = activeTab?.isAgent
  const borderWidth = isAgent ? 6 : 0

  view.setBounds({
    x: borderWidth,
    y: TOOLBAR_HEIGHT + borderWidth,
    width: bounds.width - reserved - (borderWidth * 2),
    height: bounds.height - TOOLBAR_HEIGHT - (borderWidth * 2)
  })
}

function sendTabsUpdate() {
  if (!mainWindow) return
  const tabList = []
  for (const [id, tab] of tabs) {
    tabList.push({ id, title: tab.title, url: tab.url })
  }
  mainWindow.webContents.send('tabs-updated', { tabs: tabList, activeTabId })
}

function wireViewEvents(tabId, view) {
  // Open target="_blank" / window.open from web pages in a new tab instead of popup
  view.webContents.setWindowOpenHandler(({ url }) => {
    const u = (url || '').trim()
    if (u && (u.startsWith('http://') || u.startsWith('https://'))) {
      createTab(u)
    }
    return { action: 'deny' }
  })

  view.webContents.on('did-start-loading', () => {
    if (tabId === activeTabId && mainWindow) {
      mainWindow.webContents.send('navigation-start')
    }
  })

  view.webContents.on('did-finish-load', () => {
    const tab = tabs.get(tabId)
    if (tab) {
      tab.url = view.webContents.getURL()
      tab.title = view.webContents.getTitle() || tab.url
      sendTabsUpdate()
    }
    if (tabId === activeTabId && mainWindow) {
      mainWindow.webContents.send('navigation-complete', {
        url: view.webContents.getURL(),
        title: view.webContents.getTitle(),
        canGoBack: view.webContents.canGoBack(),
        canGoForward: view.webContents.canGoForward()
      })
    }
    
    view.webContents.insertCSS(`
      #ai-sel-popup {
        position: fixed;
        z-index: 2147483646;
        background: #1a1a1a;
        border: 1px solid #444;
        border-radius: 12px;
        padding: 14px 18px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        min-width: 240px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.5);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s ease;
      }
      #ai-sel-popup.visible {
        opacity: 1;
        pointer-events: auto;
      }
      #ai-sel-popup .ai-sel-summarize {
        padding: 8px 20px;
        border-radius: 8px;
        border: none;
        background: linear-gradient(135deg, #3a3a4a 0%, #2d2d3a 100%);
        color: #e8e8e8;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        letter-spacing: 0.3px;
        transition: background 0.2s, transform 0.1s;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      }
      #ai-sel-popup .ai-sel-summarize:hover {
        background: linear-gradient(135deg, #4a4a5a 0%, #3d3d4a 100%);
        transform: translateY(-1px);
      }
      #ai-sel-popup .ai-sel-summarize:active {
        transform: translateY(0);
      }
      #ai-sel-popup .ai-sel-or {
        font-size: 11px;
        color: #888;
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }
      #ai-sel-popup .ai-sel-input-wrap {
        width: 100%;
        display: flex;
        align-items: center;
        border: 1px solid #444;
        border-radius: 8px;
        background: #252526;
        overflow: hidden;
      }
      #ai-sel-popup .ai-sel-input-wrap:focus-within {
        border-color: #555;
      }
      #ai-sel-popup .ai-sel-input-wrap input {
        flex: 1;
        min-width: 0;
        padding: 8px 12px;
        border: none;
        background: transparent;
        color: #e0e0e0;
        font-size: 12px;
        font-family: inherit;
        outline: none;
      }
      #ai-sel-popup .ai-sel-input-wrap input::placeholder {
        color: #666;
      }
      #ai-sel-popup .ai-sel-send {
        flex-shrink: 0;
        width: 36px;
        height: 36px;
        border: none;
        background: transparent;
        color: #888;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: color 0.15s, background 0.15s;
      }
      #ai-sel-popup .ai-sel-send:hover {
        color: #e0e0e0;
        background: #333;
      }
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
        function hide() {
          popup.classList.remove('visible');
          inp.value = '';
        }
        function show(centerX, y) {
          popup.style.left = centerX + 'px';
          popup.style.top = y + 'px';
          popup.style.transform = 'translateX(-50%)';
          popup.classList.add('visible');
          inp.value = '';
          setTimeout(function() { inp.focus(); }, 50);
        }
        function sendAsk() {
          var q = inp.value.trim();
          console.log('__AI_ACTION__:' + JSON.stringify({ type: 'ask', text: selText, query: q }));
          hide();
          window.getSelection().removeAllRanges();
        }
        document.addEventListener('mouseup', function(e) {
          if (popup.contains(e.target)) return;
          setTimeout(function() {
            var sel = window.getSelection();
            var t = (sel ? sel.toString() : '').trim();
            if (t.length > 3) {
              selText = t;
              var range = sel.getRangeAt(0);
              var rect = range.getBoundingClientRect();
              var centerX = rect.left + rect.width / 2;
              var py = rect.top - 120;
              if (py < 8) py = rect.bottom + 8;
              show(Math.max(120, Math.min(window.innerWidth - 120, centerX)), py);
            } else { hide(); }
          }, 10);
        });
        document.addEventListener('mousedown', function(e) {
          if (!popup.contains(e.target)) hide();
        });
        document.addEventListener('scroll', hide, true);
        btnS.addEventListener('click', function() {
          console.log('__AI_ACTION__:' + JSON.stringify({ type: 'summarize', text: selText }));
          hide();
          window.getSelection().removeAllRanges();
        });
        inp.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            sendAsk();
          }
        });
        sendBtn.addEventListener('click', sendAsk);
      })()
    `)

    if (tab && tab.isAgent) {
      view.webContents.insertCSS(`
        #agent-toast-pill {
          position: fixed;
          top: 24px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 2147483647;
          padding: 8px 24px;
          border-radius: 30px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color: white;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 13px;
          font-weight: 500;
          letter-spacing: 0.3px;
          box-shadow: 0 4px 20px rgba(139, 92, 246, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.2);
          backdrop-filter: blur(8px);
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
          animation: agent-float 3s ease-in-out infinite;
        }
        #agent-toast-pill.visible {
          opacity: 1;
        }
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
          // Force reflow
          void el.offsetWidth;
          el.classList.add('visible');
        }
      `)
    }

    // ── Login form detection ───────────────────────────────────────────────
    setTimeout(async () => {
      try {
        const url = view.webContents.getURL()
        if (!url || url.startsWith('about:') || url.startsWith('file:') || url.startsWith('chrome:')) return
        const loginForm = await view.webContents.executeJavaScript(`
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
        `)
        if (loginForm && loginForm.fields.length > 0) {
          const savedCreds = loadCredentials()[loginForm.domain] || []
          await injectCredentialModal(view, loginForm, savedCreds)
        }
      } catch (_) {}
    }, 1800)
  })

  view.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    if (tabId === activeTabId && mainWindow) {
      mainWindow.webContents.send('navigation-error', { errorCode, errorDescription })
    }
  })

  view.webContents.on('did-navigate', (event, url) => {
    const tab = tabs.get(tabId)
    if (tab) {
      tab.url = url
      tab.title = view.webContents.getTitle() || url
      sendTabsUpdate()
    }
    if (tabId === activeTabId && mainWindow) {
      mainWindow.webContents.send('url-changed', {
        url,
        canGoBack: view.webContents.canGoBack(),
        canGoForward: view.webContents.canGoForward()
      })
    }
  })

  view.webContents.on('did-navigate-in-page', (event, url) => {
    const tab = tabs.get(tabId)
    if (tab) {
      tab.url = url
      sendTabsUpdate()
    }
    if (tabId === activeTabId && mainWindow) {
      mainWindow.webContents.send('url-changed', {
        url,
        canGoBack: view.webContents.canGoBack(),
        canGoForward: view.webContents.canGoForward()
      })
    }
  })

  view.webContents.on('console-message', (event, level, message) => {
    if (message.startsWith('__AI_ACTION__:')) {
      try {
        const data = JSON.parse(message.substring('__AI_ACTION__:'.length))
        if (mainWindow) {
          mainWindow.webContents.send('selection-action', data)
          mainWindow.webContents.focus()
        }
      } catch (e) {}
    }
    if (message.startsWith('__CRED_SAVE__:')) {
      try {
        const { domain, credential } = JSON.parse(message.substring('__CRED_SAVE__:'.length))
        const store = loadCredentials()
        if (!store[domain]) store[domain] = []
        credential.id = crypto.randomUUID()
        store[domain].push(credential)
        saveCredentials(store)
      } catch (e) {}
    }
    if (message === '__CRED_DISMISSED__') {
      if (mainWindow) mainWindow.webContents.send('cred-modal-closed')
    }
  })

  view.webContents.on('page-title-updated', (event, title) => {
    const tab = tabs.get(tabId)
    if (tab) {
      tab.title = title
      sendTabsUpdate()
    }
  })
}

function createTab(url, options = {}) {
  const tabId = nextTabId++
  const targetUrl = url || 'https://www.google.com'
  const isAgent = options.isAgent || false
  const background = options.background || false

  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    }
  })

  tabs.set(tabId, { view, title: 'New Tab', url: targetUrl, isAgent })
  wireViewEvents(tabId, view)
  view.webContents.loadURL(targetUrl)
  if (!background) switchTab(tabId)
  else sendTabsUpdate()
  return tabId
}

function switchTab(tabId) {
  if (!tabs.has(tabId) || !mainWindow) return

  if (activeTabId && tabs.has(activeTabId)) {
    mainWindow.removeBrowserView(tabs.get(activeTabId).view)
  }

  activeTabId = tabId
  const tab = tabs.get(tabId)
  mainWindow.addBrowserView(tab.view)
  updateBrowserViewBounds()
  sendTabsUpdate()

  mainWindow.webContents.send('url-changed', {
    url: tab.view.webContents.getURL() || tab.url,
    canGoBack: tab.view.webContents.canGoBack(),
    canGoForward: tab.view.webContents.canGoForward()
  })
}

function closeTab(tabId) {
  if (!tabs.has(tabId)) return

  const tab = tabs.get(tabId)
  if (activeTabId === tabId) {
    mainWindow.removeBrowserView(tab.view)
  }

  tab.view.webContents.close()
  tabs.delete(tabId)

  if (tabs.size === 0) {
    activeTabId = null
    createTab()
    return
  }

  if (activeTabId === tabId) {
    const ids = [...tabs.keys()]
    switchTab(ids[ids.length - 1])
  } else {
    sendTabsUpdate()
  }
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
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
    frame: false
  })

  mainWindow.loadFile('index.html').then(() => {
    mainWindow.maximize()
    createTab()
    // Open links with target="_blank" / Ctrl+Click (sidebar, etc.) in a new tab instead of popup
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      const u = (url || '').trim()
      if (u && (u.startsWith('http://') || u.startsWith('https://'))) {
        createTab(u)
      }
      return { action: 'deny' }
    })
  })

  mainWindow.on('resize', updateBrowserViewBounds)
  mainWindow.on('maximize', updateBrowserViewBounds)
  mainWindow.on('unmaximize', updateBrowserViewBounds)
}

ipcMain.on('create-tab', (event, url) => { createTab(url || undefined) })
ipcMain.on('close-tab', (event, tabId) => { closeTab(tabId) })
ipcMain.on('switch-tab', (event, tabId) => { switchTab(tabId) })
ipcMain.handle('create-agent-tab', (event, url, background) => createTab(url || 'https://www.google.com', { isAgent: true, background: !!background }))

ipcMain.on('start-agent-control', (event, tabId) => {
  const tab = tabs.get(tabId)
  if (tab && !tab.isAgent) {
    tab.isAgent = true
    updateBrowserViewBounds()
  }
})

ipcMain.on('stop-agent-control', (event, tabId) => {
  const tab = tabs.get(tabId)
  if (tab && tab.isAgent) {
    tab.isAgent = false
    tab.view.webContents.executeJavaScript(`
      (function() {
        const el = document.getElementById('agent-toast-pill');
        if (el) el.remove();
      })()
    `).catch(() => {})
    updateBrowserViewBounds()
  }
})

ipcMain.on('navigate', (event, url) => {
  const view = getActiveView()
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

ipcMain.on('get-navigation-state', () => {
  const view = getActiveView()
  if (mainWindow && view) {
    mainWindow.webContents.send('navigation-state-changed', {
      canGoBack: view.webContents.canGoBack(),
      canGoForward: view.webContents.canGoForward()
    })
  }
})

ipcMain.on('go-back', () => { const v = getActiveView(); if (v) v.webContents.goBack() })
ipcMain.on('go-forward', () => { const v = getActiveView(); if (v) v.webContents.goForward() })
ipcMain.on('reload', () => { const v = getActiveView(); if (v) v.webContents.reload() })

// Hide/show the active BrowserView so overlays in the renderer HTML become visible
ipcMain.on('hide-browser-view', () => {
  if (!mainWindow || !activeTabId) return
  const tab = tabs.get(activeTabId)
  if (tab) mainWindow.removeBrowserView(tab.view)
})
ipcMain.on('show-browser-view', () => {
  if (!mainWindow || !activeTabId) return
  const tab = tabs.get(activeTabId)
  if (tab) { mainWindow.addBrowserView(tab.view); updateBrowserViewBounds() }
})
ipcMain.on('close-window', () => { if (mainWindow) mainWindow.close() })
ipcMain.on('minimize-window', () => { if (mainWindow) mainWindow.minimize() })

ipcMain.on('maximize-window', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
  setTimeout(updateBrowserViewBounds, 100)
})

ipcMain.on('sidebar-toggled', (event, isOpen) => {
  sidebarOpen = isOpen
  updateBrowserViewBounds()
})

ipcMain.on('sidebar-width-changed', (event, width) => {
  sidebarWidth = width
  updateBrowserViewBounds()
})

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
          var root =
            document.querySelector('main') ||
            document.querySelector('article') ||
            document.querySelector('#main') ||
            document.querySelector('#content') ||
            document.body;
          var text = (root && root.innerText) ? root.innerText : (document.body ? document.body.innerText : '');
          text = (text || '').replace(/\\s+/g, ' ').trim();
          if (text.length > 4000) text = text.substring(0, 4000);
          return text;
        }

        return {
          title: document.title,
          url: window.location.href,
          headings: headings,
          elements: elements,
          mainText: getMainText()
        };
      })()
    `)
    return context
  } catch (e) {
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

          if (typeof el.select === 'function') {
            el.select();
            return true;
          }

          if (el.isContentEditable) {
            var sel = window.getSelection();
            var range = document.createRange();
            range.selectNodeContents(el);
            sel.removeAllRanges();
            sel.addRange(range);
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

    if (!view.webContents.isLoading()) {
      setTimeout(resolve, 1500)
      return
    }

    const timeout = setTimeout(resolve, 10000)

    view.webContents.once('did-finish-load', () => {
      clearTimeout(timeout)
      setTimeout(resolve, 1500)
    })
  })
})

app.whenReady().then(() => {
  createWindow()

  globalShortcut.register('Command+Shift+B', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send('open-sidebar')
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
