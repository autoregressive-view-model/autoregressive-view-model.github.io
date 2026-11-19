/* Switch displayed homepage media between Manifold and its verified private S3 copy. */
(function (root) {
  'use strict';
  if (root.parent !== root && root.parent.AVMHomepageAssets) {
    root.AVMHomepageAssets = root.parent.AVMHomepageAssets;
    return;
  }
  const params = new URLSearchParams(location.search);
  const requested = params.get('media') === 's3' ? 's3' : ['original','manifold'].includes(params.get('media')) ? 'original' : 'dashboard';
  const indexUrl = params.get('s3access')
    || 'https://interncache-all.fbcdn.net/manifold/wai_dashboard/tree/avm/assets/s3_access.json';
  let access = null;
  let mirror = null;
  // This copy always loads its media from ./assets/ (via assets/asset_map.json: original URL -> repo path),
  // wherever it is served: GitHub Pages, a local preview or the internal preview. ?media=... switches back
  // to the internal full-quality mirror.
  const localCopy = !params.has('media');
  const mirrorRoot = localCopy ? new URL('assets/', location.href).href
    : 'https://interncache-all.fbcdn.net/manifold/wai_dashboard/tree/avm/';
  const mirrorIndex = mirrorRoot + (localCopy ? 'asset_map.json' : 'assets/asset_map.json');
  const pageVersion = String(Date.now());
  const api = {mode: requested === 's3' ? 's3' : 'manifold', root: requested, localCopy};
  const jsonLoads = new Map(), immutableLoads = new Map();
  async function cache(name) { try { return await root.caches.open(name); } catch (error) { return null; } }
  async function cached(storage, key) { try { return await storage?.match(key); } catch (error) { return null; } }
  async function store(storage, key, response, limit) {
    if (!storage) return;
    try {
      await storage.put(key, response);
      const keys = await storage.keys();
      await Promise.all(keys.slice(0, Math.max(0, keys.length-limit)).map(key => storage.delete(key)));
    } catch (error) { /* Storage quota or browser policy must not block the page. */ }
  }
  const canonical = value => {
    const url = new URL(value, location.href);
    return url.origin + decodeURIComponent(url.pathname);
  };
  async function loadMirror() {
    const url = requested === 's3' ? access.urls[canonical(mirrorIndex)] : mirrorIndex + '?v=' + Date.now();
    if (!url) throw new Error('The S3 access index is missing the AVM asset index.');
    const response = await fetch(url, {cache: 'no-store'});
    if (!response.ok) throw new Error('AVM asset index unavailable');
    const value = await response.json();
    if (value.schema !== 'avm.asset_url_map/1' || !value.complete || !value.urls
        || Object.keys(value.urls).length !== value.asset_count) throw new Error('Invalid AVM asset index');
    if (localCopy) for (const key of Object.keys(value.urls)) value.urls[key] = new URL(value.urls[key], location.href).href;
    mirror = value;
    mirror.reverse = {};
    for (const [original, copied] of Object.entries(value.urls)) {
      const key = canonical(copied);
      if (!mirror.reverse[key] && !original.startsWith(mirrorRoot)) mirror.reverse[key] = original;
    }
    api.mirrorRoot = value.root;
    if (requested === 'dashboard') api.mirrorIndex = mirrorIndex;
  }
  async function loadAccess() {
    const response = await fetch(indexUrl + (indexUrl.includes('?') ? '&' : '?') + 'v=' + Date.now(), {cache: 'no-store'});
    if (!response.ok) throw new Error('The homepage S3 copy is not ready yet.');
    const value = await response.json();
    if (value.schema !== 'yuzu.homepage_s3_access/1' || value.complete !== true
        || !value.urls || Object.keys(value.urls).length !== value.asset_count) {
      throw new Error('The homepage S3 copy is incomplete.');
    }
    if (value.expires_unix && value.expires_unix <= Date.now() / 1000) {
      throw new Error('S3 access links have expired. Choose Manifold or refresh the links.');
    }
    return value;
  }
  api.resolve = value => {
    if (!value) return value;
    if (api.mode === 'manifold') {
      const original = api.root === 'original' ? mirror?.reverse[canonical(value)] || value : value;
      const live = new URL(original, location.href);
      if (api.root === 'original') {
        if (live.pathname.includes('/tree/videodit/eval/')) live.searchParams.set('default_version', pageVersion);
        return live.href;
      }
      if (live.href.startsWith(mirrorRoot)) return live.href;
      const copied = mirror?.urls[canonical(live)];
      if (copied) return copied;
      if (localCopy) {
        // Not part of the public copy (see README): show the empty media frame instead of an internal URL.
        api.missing = api.missing || new Set();
        if (!api.missing.has(canonical(live))) { api.missing.add(canonical(live)); console.info('Not in the public copy:', canonical(live)); }
        return '';
      }
      // Current-default exports can change before their mirror is refreshed.
      // Keep the live result usable rather than failing an entire comparison tab.
      if (live.pathname.includes('/tree/videodit/eval/')) {
        live.searchParams.set('default_version', pageVersion);
        return live.href;
      }
      if (live.href.startsWith('https://interncache-all.fbcdn.net/manifold/')) {
        throw new Error('Asset missing from the AVM copy: ' + canonical(live));
      }
      if (live.pathname.includes('/tree/videodit/eval/')) live.searchParams.set('default_version', pageVersion);
      return live.href;
    }
    if (access.expires_unix && access.expires_unix <= Date.now() / 1000) {
      throw new Error('S3 access links have expired.');
    }
    if (Object.values(access.urls).includes(String(value))) return String(value);
    const copied = mirror?.urls[canonical(value)] || value;
    const url = access.urls[canonical(copied)] || access.urls[canonical(value)];
    if (!url) throw new Error('This media asset is missing from the homepage S3 copy.');
    // Preserve the exact signed query; no cache-busting parameter may be added.
    return url;
  };
  api.json = async (value, options = {}) => {
    await api.ready;
    if (api.mode !== 'manifold') {
      const response = await fetch(api.resolve(value), {cache: 'no-store', signal: options.signal});
      if (!response.ok) throw Object.assign(new Error('Metadata unavailable'), {status: response.status});
      return response.json();
    }
    const key = canonical(value);
    if (options.refresh) jsonLoads.delete(key);
    if (!jsonLoads.has(key)) jsonLoads.set(key, (async () => {
      const resolved = api.resolve(value);
      if (!resolved) throw new Error('Metadata unavailable');
      const url = new URL(resolved, location.href);
      if (localCopy && url.pathname.endsWith('.json.gz')) {
        const response = await fetch(url, {cache: 'no-cache', signal: options.signal});
        if (!response.ok) throw Object.assign(new Error('Metadata unavailable'), {status: response.status});
        // Decode the stored gzip file after the browser handles HTTP transfer encoding.
        return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
      }
      const storage = await cache('avm-metadata-'+api.root+'-v1'), saved = await cached(storage, key);
      const etag = saved?.headers.get('etag');
      url.searchParams.set('default_probe', String(Date.now()));
      const response = await fetch(url.href, {cache: 'no-store', signal: options.signal, headers: etag ? {'If-None-Match': etag} : {}});
      if (response.status === 304 && saved) return saved.json();
      if (!response.ok) throw Object.assign(new Error('Metadata unavailable'), {status: response.status});
      const copy = response.clone();
      const data = await response.json();
      await store(storage, key, copy, 96);
      return data;
    })().catch(error => {jsonLoads.delete(key);throw error;}));
    return jsonLoads.get(key);
  };
  api.immutable = async value => {
    await api.ready;
    const url = api.resolve(value);
    if (api.mode !== 'manifold') return url;
    if (!immutableLoads.has(url)) immutableLoads.set(url, (async () => {
      const storage = await cache('avm-animation-v1');
      let response = await cached(storage, url);
      if (!response) {
        response = await fetch(url, {cache: 'force-cache'});
        if (!response.ok) throw new Error('Animation asset unavailable');
        await store(storage, url, response.clone(), 64);
      }
      return URL.createObjectURL(await response.blob());
    })().catch(error => {immutableLoads.delete(url);throw error;}));
    return immutableLoads.get(url);
  };
  api.ready = requested === 's3' ? loadAccess().then(value => {access = value; return loadMirror();}) : loadMirror();
  root.AVMHomepageAssets = api;
  document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('mediaSource');
    const status = document.getElementById('mediaSourceStatus');
    api.ready.then(() => {
      if (requested !== 'dashboard') {
        for (const video of document.querySelectorAll('[data-teaser-video],[data-architecture-overview]')) {
          try {
            const poster = video.getAttribute('poster'), src = video.getAttribute('src');
            if (poster) video.poster = api.resolve(poster);
            if (src) {
              const resolved = new URL(api.resolve(src), location.href).href;
              // The local review video can already be playing while metadata
              // resolves. Reloading the same URL would pause and reset it.
              if (video.src !== resolved) { video.src = resolved; video.load(); }
            }
          } catch (error) {
            // One missing asset must not prevent independent animations loading.
            console.warn('Unable to load homepage video:', error.message);
          }
        }
      }
      if (status && access?.expires_unix) status.textContent = 'S3 links valid until ' + new Date(access.expires_unix * 1000).toLocaleTimeString();
    }).catch(error => {if (status) status.textContent = error.message; else console.warn(error.message);});
    if (!select) return;
    select.value = requested;
    select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        if (select.value === 's3') await loadAccess();
        const url = new URL(location.href);
        url.searchParams.set('media', select.value);
        location.assign(url.href);
      } catch (error) {
      select.value = api.root;
        status.textContent = error.message;
      } finally {select.disabled = false;}
    });
  });
})(window);

// Keep a visible, fixed-size frame while posters and videos are unavailable.
(function (root) {
  const api=root.AVMHomepageAssets;if(!api)return;
  api.videoPlaceholderIcon='<svg class="video-placeholder-icon" viewBox="0 0 40 28" fill="none" aria-hidden="true"><rect x="1" y="1" width="38" height="26" rx="5"/><path d="m16 8 10 6-10 6V8Z"/></svg>';
  const doc=root.document;if(!doc||!root.MutationObserver)return;
  const records=new WeakMap();
  function attach(video){
    const host=video.parentElement;if(!host||records.has(video))return;
    host.classList.add('video-placeholder-host');
    const placeholder=host.querySelector(':scope > .video-loading-placeholder')||doc.createElement('span');
    placeholder.className='video-loading-placeholder';placeholder.setAttribute('aria-hidden','true');placeholder.innerHTML=api.videoPlaceholderIcon;host.append(placeholder);
    let displayed=false,version=0,disposed=false;
    function bounds(){if(!video.isConnected)return;placeholder.style.left=video.offsetLeft+'px';placeholder.style.top=video.offsetTop+'px';placeholder.style.width=video.offsetWidth+'px';placeholder.style.height=video.offsetHeight+'px';}
    function reveal(){if(disposed)return;displayed=true;placeholder.hidden=true;bounds();}
    function preview(){
      const current=++version;bounds();
      if(!video.getAttribute('src')&&!video.getAttribute('poster')){displayed=false;placeholder.hidden=false;return;}
      if(video.readyState>=2){reveal();return;}
      if(!displayed)placeholder.hidden=false;
      const poster=video.getAttribute('poster');if(poster){const image=new root.Image();image.onload=()=>{if(current===version)reveal();};image.src=poster;}
    }
    const attributes=new root.MutationObserver(preview);attributes.observe(video,{attributes:true,attributeFilter:['src','poster']});
    const resize=root.ResizeObserver?new root.ResizeObserver(bounds):null;resize?.observe(video);
    ['loadeddata','canplay','playing'].forEach(event=>video.addEventListener(event,reveal));video.addEventListener('loadedmetadata',bounds);
    records.set(video,{destroy(){disposed=true;version++;attributes.disconnect();resize?.disconnect();['loadeddata','canplay','playing'].forEach(event=>video.removeEventListener(event,reveal));video.removeEventListener('loadedmetadata',bounds);placeholder.remove();records.delete(video);}});
    preview();
  }
  function videos(node){return node.nodeType===1?(node.matches('video')?[node]:[...node.querySelectorAll('video')]):[];}
  doc.querySelectorAll('video').forEach(attach);
  new root.MutationObserver(changes=>{
    changes.forEach(change=>change.removedNodes.forEach(node=>videos(node).forEach(video=>{if(!video.isConnected)records.get(video)?.destroy();})));
    changes.forEach(change=>change.addedNodes.forEach(node=>videos(node).forEach(attach)));
  }).observe(doc.documentElement,{childList:true,subtree:true});
})(window);

// Add a consistent fullscreen affordance to every custom video player. Native-control videos and
// comparison players already expose their own fullscreen controls, so they are left unchanged.
(function (root) {
  const doc=root.document;if(!doc||!root.MutationObserver)return;
  const records=new WeakMap();
  const icon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5"/></svg>';
  function videos(node){return node.nodeType===1?(node.matches('video')?[node]:[...node.querySelectorAll('video')]):[];}
  function attach(video){
    if(records.has(video)||video.controls||video.closest('.comparison-player'))return;
    const host=video.parentElement;if(!host)return;
    host.classList.add('video-fullscreen-host');
    const button=doc.createElement('button');button.type='button';button.className='video-fullscreen-button';
    button.setAttribute('aria-label','View video fullscreen');button.title='Fullscreen';button.innerHTML=icon;host.append(button);
    let disposed=false;
    function position(){
      if(disposed||!video.isConnected)return;
      const inset=Math.max(6,Math.min(10,video.offsetWidth*.018));
      button.style.left=Math.max(0,video.offsetLeft+video.offsetWidth-button.offsetWidth-inset)+'px';
      button.style.top=Math.max(0,video.offsetTop+video.offsetHeight-button.offsetHeight-inset)+'px';
    }
    function open(event){
      event.preventDefault();event.stopPropagation();
      if(doc.fullscreenElement){doc.exitFullscreen?.();return;}
      if(video.requestFullscreen)video.requestFullscreen().catch(()=>{});
      else video.webkitEnterFullscreen?.();
    }
    button.addEventListener('pointerdown',event=>event.stopPropagation());button.addEventListener('click',open);
    const resize=root.ResizeObserver?new root.ResizeObserver(position):null;resize?.observe(video);
    video.addEventListener('loadedmetadata',position);root.requestAnimationFrame(position);
    records.set(video,{destroy(){disposed=true;resize?.disconnect();video.removeEventListener('loadedmetadata',position);button.remove();records.delete(video);}});
  }
  doc.querySelectorAll('video').forEach(attach);
  new root.MutationObserver(changes=>{
    changes.forEach(change=>change.removedNodes.forEach(node=>videos(node).forEach(video=>{if(!video.isConnected)records.get(video)?.destroy();})));
    changes.forEach(change=>change.addedNodes.forEach(node=>videos(node).forEach(attach)));
  }).observe(doc.documentElement,{childList:true,subtree:true});
})(window);

// Refresh visible default media after the underlying Manifold object changes.
(function () {
  const observed = new Map();
  let checking = false;
  async function checkDefaults() {
    if (checking || document.hidden || window.AVMHomepageAssets.mode !== 'manifold') return;
    checking = true;
    try {
      const urls = new Set([...document.querySelectorAll('video[src]')].filter(video => {
        const box = video.getBoundingClientRect();
        return box.bottom > 0 && box.top < innerHeight && box.width > 0;
      }).map(video => video.src).filter(url => url.includes('/tree/videodit/eval/')));
      if (window.AVMHomepageAssets.mirrorIndex) urls.add(window.AVMHomepageAssets.mirrorIndex);
      for (const value of urls) {
        const url = new URL(value);
        url.search = '';
        const key = url.href;
        url.searchParams.set('default_probe', String(Date.now()));
        const response = await fetch(url, {method: 'HEAD', cache: 'no-store'});
        if (!response.ok) continue;
        const revision = [response.headers.get('last-modified'), response.headers.get('etag'), response.headers.get('content-length')].join('|');
        if (observed.has(key) && observed.get(key) !== revision) { location.reload(); return; }
        observed.set(key, revision);
      }
    } catch (error) { console.warn('Default media refresh will retry', error); }
    finally { checking = false; }
  }
  setTimeout(checkDefaults, 5000);
  setInterval(checkDefaults, 60000);
})();
