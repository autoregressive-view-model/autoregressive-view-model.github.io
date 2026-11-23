/* Serve the media and camera records packaged with the project page. */
(function (root) {
  'use strict';
  const base = new URL('.', location.href);
  function resolve(path) {
    if (!path) return '';
    const url = new URL(path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname + 'assets/')) {
      throw new Error('Expected a bundled asset');
    }
    return url.href;
  }
  async function json(path) {
    const url = resolve(path);
    const response = await fetch(url);
    if (!response.ok) throw new Error('Unable to load ' + path);
    if (new URL(url).pathname.endsWith('.gz')) {
      return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
    }
    return response.json();
  }
  root.AVMHomepageAssets = {resolve, json, immutable: async path => resolve(path)};
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
