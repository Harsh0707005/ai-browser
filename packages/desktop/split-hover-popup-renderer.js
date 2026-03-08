(function () {
  const actionsEl = document.getElementById('splitHoverActions')
  let currentTabId = null
  if (!window.splitPopupAPI) return

  window.splitPopupAPI.onOptions((opts) => {
    currentTabId = opts.tabId
    if (!actionsEl) return
    actionsEl.innerHTML = ''
    if (opts.showRemove) {
      const btn = document.createElement('button')
      btn.className = 'split-action-btn split-action-remove'
      btn.textContent = 'Remove from split'
      btn.addEventListener('click', () => {
        window.splitPopupAPI.removeFromSplit(currentTabId)
        window.splitPopupAPI.closePopup()
      })
      actionsEl.appendChild(btn)
    }
    if (opts.showExit) {
      const btn = document.createElement('button')
      btn.className = 'split-action-btn split-action-close'
      btn.textContent = 'Exit split view'
      btn.addEventListener('click', () => {
        window.splitPopupAPI.closeSplit()
        window.splitPopupAPI.closePopup()
      })
      actionsEl.appendChild(btn)
    }
  })

  document.querySelectorAll('.split-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset
      if (preset && currentTabId != null) {
        window.splitPopupAPI.applySplitLayout(preset, currentTabId)
        window.splitPopupAPI.closePopup()
      }
    })
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.splitPopupAPI.closePopup()
  })

  document.documentElement.addEventListener('mouseenter', () => {
    if (window.splitPopupAPI.sendMouseEnter) window.splitPopupAPI.sendMouseEnter()
  })
  document.documentElement.addEventListener('mouseleave', () => {
    if (window.splitPopupAPI.sendMouseLeave) window.splitPopupAPI.sendMouseLeave()
  })
})()
