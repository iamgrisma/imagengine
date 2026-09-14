/**
 * ImageEngine Drop-in Client Script (v2.0)
 * Accelerates all images on your website with zero-downtime edge fallback.
 * 
 * Usage:
 * <script src="https://imagengine.grisma.info.np/engine.js" data-tenant="YOUR_TENANT_ID" data-subdomain="YOUR_SUBDOMAIN" async></script>
 */
(function() {
  'use strict';

  var script = document.currentScript || (function() {
    var s = document.getElementsByTagName('script');
    return s[s.length - 1];
  })();

  var tenant = script ? script.getAttribute('data-tenant') : '';
  var subdomain = script ? (script.getAttribute('data-subdomain') || 'main') : 'main';
  var cdnHost = script ? (script.getAttribute('data-cdn') || 'https://img.grisma.info.np') : 'https://img.grisma.info.np';
  var autoAvatar = script ? (script.getAttribute('data-avatar') === 'true') : false;

  if (!tenant) return;

  function optimizeImage(img) {
    if (!img || img.dataset.engineProcessed || img.dataset.noEngine) return;
    var originalSrc = img.getAttribute('src');
    if (!originalSrc || originalSrc.indexOf('data:') === 0 || originalSrc.indexOf('blob:') === 0) return;
    if (originalSrc.indexOf(cdnHost) !== -1) return;

    img.dataset.originSrc = originalSrc;
    img.dataset.engineProcessed = 'true';

    var cleanPath = originalSrc;
    if (cleanPath.indexOf('http://') === 0 || cleanPath.indexOf('https://') === 0) {
      try {
        cleanPath = new URL(cleanPath).pathname;
      } catch (e) {
        return;
      }
    }
    cleanPath = cleanPath.replace(/^\/+/, '');
    if (!cleanPath) return;

    var isAvatar = autoAvatar || img.classList.contains('avatar') || img.classList.contains('profile-pic');
    var params = [];
    if (isAvatar) params.push('avatar=true');
    if (img.width && img.width > 0 && img.width < 1200) {
      var dpr = window.devicePixelRatio || 1;
      params.push('w=' + Math.round(img.width * (dpr > 1 ? 1.5 : 1)));
    }
    var qs = params.length > 0 ? '?' + params.join('&') : '';
    var edgeUrl = cdnHost + '/' + tenant + '/' + subdomain + '/' + cleanPath.replace(/\.(jpe?g|png|webp|svg)$/i, '') + '.webp' + qs;

    function onImgError() {
      img.removeEventListener('error', onImgError);
      if (img.dataset.originSrc && img.src !== img.dataset.originSrc) {
        img.src = img.dataset.originSrc;
      }
    }
    img.addEventListener('error', onImgError);

    img.src = edgeUrl;
  }

  function scan() {
    var images = document.querySelectorAll('img:not([data-engine-processed])');
    for (var i = 0; i < images.length; i++) {
      optimizeImage(images[i]);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan);
  } else {
    scan();
  }

  if (window.MutationObserver) {
    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.addedNodes) {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var node = m.addedNodes[j];
            if (node.tagName === 'IMG') {
              optimizeImage(node);
            } else if (node.querySelectorAll) {
              var imgs = node.querySelectorAll('img:not([data-engine-processed])');
              for (var k = 0; k < imgs.length; k++) optimizeImage(imgs[k]);
            }
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
