(function() {
  var SELECTORS = __SELECTORS_PLACEHOLDER__;
  var ATTR_IDS = ['@click', 'v-on:click', 'ng-click', '(click)', 'data-ng-click', 'data-bind'];
  var CONTAINER_ID = 'ai-clickable-overlays';
  var BADGE_CLASS = 'ai-clickable-badge';
  var ID_ATTR = 'data-ai-id';

  function getClickables() {
    var seen = new Set();
    var result = [];

    function add(el) {
      if (!el || seen.has(el)) return;
      var rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      if (el.disabled && (el.tagName === 'INPUT' || el.tagName === 'BUTTON')) return;
      if (el.type === 'hidden') return;
      var style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') return;
      seen.add(el);
      result.push(el);
    }

    for (var i = 0; i < SELECTORS.length; i++) {
      try {
        var nodes = document.querySelectorAll(SELECTORS[i]);
        for (var j = 0; j < nodes.length; j++) add(nodes[j]);
      } catch (e) {}
    }

    var all = document.querySelectorAll('*');
    for (var k = 0; k < all.length; k++) {
      var node = all[k];
      for (var a = 0; a < ATTR_IDS.length; a++) {
        if (node.getAttribute && node.getAttribute(ATTR_IDS[a])) {
          add(node);
          break;
        }
      }
    }

    return result;
  }

  function ensureIds(elements) {
    var used = new Set();
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      var existing = el.getAttribute(ID_ATTR);
      if (existing !== null && existing !== '') {
        var num = parseInt(existing, 10);
        if (!isNaN(num)) used.add(num);
      }
    }
    var nextId = 0;
    for (var j = 0; j < elements.length; j++) {
      var e = elements[j];
      if (e.getAttribute(ID_ATTR) === null || e.getAttribute(ID_ATTR) === '') {
        while (used.has(nextId)) nextId++;
        e.setAttribute(ID_ATTR, nextId);
        used.add(nextId);
        nextId++;
      }
    }
  }

  function getOrCreateContainer() {
    var c = document.getElementById(CONTAINER_ID);
    if (!c) {
      c = document.createElement('div');
      c.id = CONTAINER_ID;
      document.body.appendChild(c);
    }
    c.innerHTML = '';
    return c;
  }

  function getBgLuminance(el) {
    var style = window.getComputedStyle(el);
    var bg = style.backgroundColor;
    var r = 0, g = 0, b = 0, a = 1;
    var m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (m) {
      r = parseInt(m[1], 10) / 255;
      g = parseInt(m[2], 10) / 255;
      b = parseInt(m[3], 10) / 255;
      if (m[4]) a = parseFloat(m[4]);
    } else {
      m = bg.match(/#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})/);
      if (m) {
        r = parseInt(m[1], 16) / 255;
        g = parseInt(m[2], 16) / 255;
        b = parseInt(m[3], 16) / 255;
      } else {
        m = bg.match(/#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])/);
        if (m) {
          r = parseInt(m[1] + m[1], 16) / 255;
          g = parseInt(m[2] + m[2], 16) / 255;
          b = parseInt(m[3] + m[3], 16) / 255;
        } else if (bg === 'transparent' || !bg) {
          if (el.parentElement) return getBgLuminance(el.parentElement);
          return 0.95;
        } else return 0.95;
      }
    }
    if (a < 0.1 && el.parentElement) return getBgLuminance(el.parentElement);
    r = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
    g = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
    b = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function createBadge(id) {
    var b = document.createElement('div');
    b.className = BADGE_CLASS;
    b.textContent = id;
    b.setAttribute('data-badge-for', id);
    return b;
  }

  function positionBadges() {
    var container = document.getElementById(CONTAINER_ID);
    if (!container) return;
    var badges = container.querySelectorAll('.' + BADGE_CLASS);
    for (var i = 0; i < badges.length; i++) {
      var bid = badges[i].getAttribute('data-badge-for');
      var targets = document.querySelectorAll('[' + ID_ATTR + '="' + bid + '"]');
      var target = null;
      for (var t = 0; t < targets.length; t++) {
        if (targets[t].className && targets[t].className.indexOf(BADGE_CLASS) >= 0) continue;
        target = targets[t];
        break;
      }
      if (!target) continue;
      var rect = target.getBoundingClientRect();
      badges[i].style.left = rect.left + 'px';
      badges[i].style.top = rect.top + 'px';
      var lum = getBgLuminance(target);
      if (lum > 0.5) {
        badges[i].style.background = 'rgba(26, 26, 26, 0.95)';
        badges[i].style.color = '#fff';
        badges[i].style.filter = '';
      } else {
        badges[i].style.background = 'rgba(255, 213, 79, 0.95)';
        badges[i].style.color = '#1a1a1a';
        badges[i].style.filter = '';
      }
    }
  }

  function run() {
    var elements = getClickables();
    ensureIds(elements);
    var container = getOrCreateContainer();
    for (var i = 0; i < elements.length; i++) {
      var id = elements[i].getAttribute(ID_ATTR);
      container.appendChild(createBadge(id));
    }
    positionBadges();
  }

  var debounceTimer;
  var runTimer;
  function debouncedPosition() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(positionBadges, 50);
  }
  function debouncedRun() {
    clearTimeout(runTimer);
    runTimer = setTimeout(run, 200);
  }

  run();
  window.addEventListener('scroll', debouncedPosition, true);
  window.addEventListener('resize', debouncedPosition);

  var observer = new MutationObserver(function() {
    debouncedPosition();
    debouncedRun();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
