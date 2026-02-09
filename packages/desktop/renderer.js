// Browser UI controller
const addressInput = document.getElementById('addressInput')
const backBtn = document.getElementById('backBtn')
const forwardBtn = document.getElementById('forwardBtn')
const reloadBtn = document.getElementById('reloadBtn')
const loadingIndicator = document.getElementById('loadingIndicator')
const closeBtn = document.getElementById('closeBtn')
const minimizeBtn = document.getElementById('minimizeBtn')
const maximizeBtn = document.getElementById('maximizeBtn')

let currentUrl = 'https://www.google.com'

// Navigation handlers
addressInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const url = addressInput.value.trim()
    if (url) {
      navigate(url)
    }
  }
})

backBtn.addEventListener('click', (e) => {
  e.preventDefault()
  if (window.electronAPI && !backBtn.disabled) {
    window.electronAPI.goBack()
  }
})

forwardBtn.addEventListener('click', (e) => {
  e.preventDefault()
  if (window.electronAPI && !forwardBtn.disabled) {
    window.electronAPI.goForward()
  }
})

reloadBtn.addEventListener('click', () => {
  if (window.electronAPI) {
    window.electronAPI.reload()
  }
})

// Window controls
closeBtn.addEventListener('click', () => {
  if (window.electronAPI) {
    window.electronAPI.closeWindow()
  }
})

minimizeBtn.addEventListener('click', () => {
  if (window.electronAPI) {
    window.electronAPI.minimizeWindow()
  }
})

maximizeBtn.addEventListener('click', () => {
  if (window.electronAPI) {
    window.electronAPI.maximizeWindow()
  }
})

function navigate(url) {
  if (window.electronAPI) {
    window.electronAPI.navigate(url)
    addressInput.blur()
  }
}

function updateAddressBar(url) {
  currentUrl = url
  addressInput.value = url
}

function updateNavigationButtons(canGoBack, canGoForward) {
  backBtn.disabled = !canGoBack
  forwardBtn.disabled = !canGoForward
}

function showLoading(show) {
  loadingIndicator.style.display = show ? 'block' : 'none'
}

// Listen to Electron events
if (window.electronAPI) {
  window.electronAPI.onNavigationStart(() => {
    showLoading(true)
  })

  window.electronAPI.onNavigationComplete((data) => {
    showLoading(false)
    updateAddressBar(data.url)
    if (data.canGoBack !== undefined && data.canGoForward !== undefined) {
      updateNavigationButtons(data.canGoBack, data.canGoForward)
    }
  })

  window.electronAPI.onNavigationError((error) => {
    showLoading(false)
    console.error('Navigation error:', error)
  })

  window.electronAPI.onUrlChanged((data) => {
    if (typeof data === 'string') {
      // Handle legacy string format
      updateAddressBar(data)
    } else {
      // Handle new object format with navigation state
      updateAddressBar(data.url)
      if (data.canGoBack !== undefined && data.canGoForward !== undefined) {
        updateNavigationButtons(data.canGoBack, data.canGoForward)
      }
    }
  })

  window.electronAPI.onNavigationStateChanged((data) => {
    updateNavigationButtons(data.canGoBack, data.canGoForward)
  })
}

// Initialize
addressInput.value = currentUrl

// Request initial navigation state
if (window.electronAPI) {
  setTimeout(() => {
    window.electronAPI.getNavigationState()
  }, 500)
}
