/* Matched camera paths; native clips share a camera-frame playback clock. */
(async function () {
  'use strict';
  const host=document.querySelector('[data-method-comparisons]');if(!host)return;
  host.classList.add('comparison-pending');
  const skeleton=document.createElement('div');skeleton.className='comparison-loading-layout';skeleton.setAttribute('aria-hidden','true');skeleton.innerHTML='<div class="comparison-loading-context"><i></i><i></i></div><div class="comparison-loading-videos"><i></i><i></i><i></i></div>';host.append(skeleton);
  await new Promise(resolve=>{const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();resolve();}},{rootMargin:'800px'});observer.observe(host);});
  await AVMHomepageAssets.ready;
  const media=url=>AVMHomepageAssets.resolve(String(url));
  const bootstrap=host.querySelector('[data-comparison-bootstrap]');
  const data=bootstrap?JSON.parse(bootstrap.content.textContent):await jsonAsset('https://media.avm.invalid/x96d8f1cd43/x5756e5ede0/x7f83f2aa4a/x56ecab341f/x3baf9e9373/comparisons.json?v='+Date.now());const excluded={'text-control':['SEVA'],dynamics:['SEVA','Gen3R','Gen3C']};data.dimensions.forEach(d=>d.cases.forEach(c=>{c.clips=c.clips.filter(v=>!excluded[d.id]?.includes(v.method));}));const panelOrder=['camera-control','text-control','dynamics','sparse-reconstruction','4d-reconstruction','revisiting'];data.dimensions.sort((a,b)=>panelOrder.indexOf(a.id)-panelOrder.indexOf(b.id));
  const manifestUrl='https://media.avm.invalid/x4d41d9f5a5/x5756e5ede0/x7ca57f56ca/collage/manifest.json';
  let currentManifest=null,manifestRevision=null,manifestPromise=null;
  const readyDimensions=new Set(),dimensionLoads=new Map();
  const sourceRecords=data.dimensions.map(dimension=>({dimension,example:dimension.cases[0],clips:[...dimension.cases[0].clips]}));
  const sourceSignature=manifest=>JSON.stringify(sourceRecords.map(({dimension,example,clips})=>clips.map(clip=>{const source=currentSource(dimension,example,clip,manifest);return source?[source.video,source.poster,source.fps,source.entry.sceneOverrides?.[example.scene]?.nativeCompletedMetadataSha256]:null;})));
  const groupName=method=>({'AVM':'Base x9915000fd6','DreamX-World':'DreamX-World AR'})[method]||method;
  async function jsonAsset(url){
    const timeout=url.includes('/collage/manifest.json')?60000:30000;
    for(let attempt=0;attempt<2;attempt++){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
      try{return await AVMHomepageAssets.json(url,{signal:controller.signal,refresh:url.includes('/collage/manifest.json')});}
      catch(error){if(attempt===1||(error.status>=400&&error.status<500&&error.status!==429))throw error;await new Promise(resolve=>setTimeout(resolve,500));}
      finally{clearTimeout(timer);}
    }
  }
  function currentSource(dimension,example,clip,manifest){
    const pair=manifest.pairs.find(pair=>pair.dataset===dimension.dataset);if(!pair)return null;
    const entry=pair.entries.find(entry=>entry.group===groupName(clip.method)&&(!entry.disabled)&&((clip.method!=='AVM')||entry.label.includes('x354a247a19'))&&entry.scenes.some(index=>pair.scenes[index].name===example.scene));if(!entry)return null;
    const override=entry.sceneOverrides?.[example.scene]||{},root=override.sceneBase||override.baseUrl||entry.sceneBase||entry.baseUrl;
    const base=root?root.replace(/\/$/,'')+'/'+encodeURIComponent(example.scene):manifest.cdnBase.replace(/\/$/,'')+'/'+(override.id||entry.id)+'/'+encodeURIComponent(override.sourceDataset||entry.sourceDataset||dimension.dataset)+'/'+encodeURIComponent(example.scene);
    return {entry,pair,base,video:base+'/'+(override.gen||entry.gen||manifest.genVideo),poster:base+'/'+(override.posterPath||entry.posterPath||manifest.genPoster),fps:override.playbackFps||entry.playbackFps};
  }
  function relativePoses(frames){
    const origin=frames[0].transform_matrix;return frames.map(frame=>{
      const pose=frame.transform_matrix,values=[];
      for(let row=0;row<3;row++){for(let column=0;column<3;column++)values.push([0,1,2].reduce((sum,k)=>sum+origin[k][row]*pose[k][column],0));values.push([0,1,2].reduce((sum,k)=>sum+origin[k][row]*(pose[k][3]-origin[k][3]),0));}return values;
    });
  }
  async function resolveDimension(dimension){
    if(!manifestPromise)manifestPromise=jsonAsset(manifestUrl+'?v='+Date.now()).then(manifest=>{currentManifest=manifest;manifestRevision=sourceSignature(manifest);return manifest;}).catch(error=>{manifestPromise=null;throw error;});
    await manifestPromise;
      const example=structuredClone(dimension.cases[0]),sources=example.clips.map(clip=>currentSource(dimension,example,clip,currentManifest));
      const loaded=await Promise.all(sources.map(async source=>{if(!source)return null;try{const metadata=await jsonAsset(source.base+'/gen/scene_meta.json');return {...source,metadata,frames:metadata.frames.filter(frame=>frame.frame_name.startsWith('000000_'))};}catch(error){console.warn('Current comparison source unavailable',error);return null;}}));
      const avm=loaded[example.clips.findIndex(clip=>clip.method==='AVM')];if(!avm?.frames.length)throw new Error('The current AVM collage result is unavailable');
      const [input,sample]=await Promise.all([jsonAsset(avm.base+'/input/scene_meta.json'),jsonAsset(avm.base+'/sample_meta.json')]);
      const queryFrames=dimension.id==='sparse-reconstruction'?input.frames.filter(frame=>frame.frame_name.startsWith('000000_')).length:avm.frames.length;
      example.frame_count=queryFrames;const reference=relativePoses(avm.frames.slice(0,queryFrames));
      example.clips=example.clips.filter((clip,index)=>{
        const source=loaded[index];if(!source||source.frames.length<queryFrames)return false;
        const poses=relativePoses(source.frames.slice(0,queryFrames));if(poses.some((pose,i)=>pose.some((value,j)=>Math.abs(value-reference[i][j])>1e-5))){console.warn('Current comparison camera path differs',clip.method,example.scene);return false;}
        const canonical=url=>{const value=new URL(url,location.href);return value.origin+decodeURIComponent(value.pathname);},sameVideo=canonical(clip.video)===canonical(source.video),verifiedCount=clip.native_frame_count;
        clip.video=source.video;clip.poster=source.poster;clip.frame_count=queryFrames;clip.native_frame_count=sameVideo&&verifiedCount?verifiedCount:source.frames.length;clip.playback_fps_override=source.fps||null;clip.fps=source.fps||source.metadata.fps||clip.fps;
        clip.width=source.metadata.w||clip.width;clip.height=source.metadata.h||clip.height;clip.current_source=source.base;return true;
      });
      const scene=avm.pair.scenes.find(scene=>scene.name===example.scene),refs=avm.entry.sceneInputs?.[example.scene]||scene.cond||[];
      example.inputs=refs.filter(ref=>['image','video'].includes(ref.kind)).map(ref=>({type:ref.kind,source_id:'input-'+String(ref.chunk).padStart(6,'0'),label:ref.kind==='video'?'Input video':'Input view',url:avm.base+'/input/input_'+String(ref.chunk).padStart(6,'0')+(ref.kind==='video'?'.mp4':'.png'),poster:ref.kind==='video'?avm.base+'/input/images/'+String(ref.chunk).padStart(6,'0')+'_000000.png':null}));
      if(!example.inputs.length)throw new Error('Current collage inputs are unavailable');
      if(dimension.id==='text-control'){
        const prompt=avm.entry.scenePrompts?.[example.scene]||scene,texts=prompt.prompts||[];
        example.prompt_segments=example.prompt_segments.map((part,i)=>({...part,text:texts[i]||part.text}));
      }
      example.current_sample=sample;
    return example;
  }
  function loadDimension(index){
    const dimension=data.dimensions[index];
    if(readyDimensions.has(dimension.id))return Promise.resolve();
    if(!dimensionLoads.has(dimension.id))dimensionLoads.set(dimension.id,resolveDimension(dimension).then(example=>{dimension.cases[0]=example;readyDimensions.add(dimension.id);}).finally(()=>dimensionLoads.delete(dimension.id)));
    return dimensionLoads.get(dimension.id);
  }
  const selectedMethods=new Set(data.dimensions.flatMap(d=>d.cases.flatMap(c=>c.clips.map(v=>v.method))));
  const methodOrder=[...selectedMethods];let draggingMethod=null,dragOrder=null,dragCommitted=false;
  const layoutAnimations=new Map(),reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const pageScale=()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--page-scale'))||1;
  let active=null,visible=false,wantsPlay=true,dimensionIndex=0,renderVersion=0,retryTimer=null;
  const groups=new WeakMap();
  let resultsPromise=null;
  function resultsReady(){if(window.YuzuResults)return Promise.resolve(window.YuzuResults);if(!resultsPromise)resultsPromise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Camera catalogue unavailable')),30000);window.addEventListener('yuzu-results-ready',()=>{clearTimeout(timer);resolve(window.YuzuResults);},{once:true});});return resultsPromise;}
  function el(tag,css,text){const node=document.createElement(tag);if(css)node.className=css;if(text)node.textContent=text;return node;}
  function button(text,label){const b=el('button','comparison-button',text);b.type='button';b.setAttribute('aria-label',label||text);return b;}
  const track=el('div','comparison-track');
  const controls=el('div','comparison-controls playback-controls'),play=button('','Pause comparison'),restart=button('','Restart comparison');play.classList.add('comparison-icon-button','playback-icon-button','playback-toggle');restart.classList.add('comparison-icon-button','playback-icon-button');restart.innerHTML='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 7a5 5 0 1 0-1.2 4.2M13 3v4H9"/></svg>';
  const tabs=el('div','comparison-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Comparison dimension');
  track.tabIndex=0;track.id='comparison-results';track.setAttribute('role','tabpanel');track.setAttribute('aria-label','Matched method videos');
  const methodControls=document.querySelector('[data-comparison-methods]');
  const navigation=el('div','comparison-navigation'),methodBar=el('div','comparison-method-bar'),status=host.querySelector('[data-comparison-status]')||el('p','comparison-status');status.setAttribute('role','status');controls.append(play,restart);methodBar.append(methodControls,controls);navigation.append(tabs);host.append(navigation,status,track,methodBar);
  function syncButton(){const enabled=active?.hasSelection()??true,running=wantsPlay&&enabled;play.innerHTML='<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="'+(running?'M4 3h3v10H4zM9 3h3v10H9z':'M4 2l9 6-9 6z')+'"/></svg>';play.setAttribute('aria-label',(running?'Pause':'Play')+' comparison');play.disabled=restart.disabled=!enabled;active?.controller?.setPlaybackState(running&&visible);}
  function captureLayout(nodes){
    const before=new Map();for(const node of nodes){if(node.isConnected&&!node.hidden&&!node.parentElement.hidden)before.set(node,node.getBoundingClientRect());}
    for(const node of nodes){layoutAnimations.get(node)?.cancel();layoutAnimations.delete(node);}return before;
  }
  function animateLayout(before){
    if(reducedMotion.matches)return;
    for(const [node,old] of before){
      if(!node.isConnected||node.hidden||node.parentElement.hidden)continue;
      const now=node.getBoundingClientRect(),scale=pageScale(),x=(old.left-now.left)/scale,y=(old.top-now.top)/scale;if(Math.abs(x)+Math.abs(y)<.5)continue;
      const animation=node.animate([{transform:`translate(${x}px,${y}px)`},{transform:'translate(0,0)'}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'});
      layoutAnimations.set(node,animation);animation.onfinish=animation.oncancel=()=>{if(layoutAnimations.get(node)===animation)layoutAnimations.delete(node);};
    }
  }
  function applyOrder(order){
    if(order.every((method,index)=>method===methodOrder[index]))return false;
    const before=captureLayout([...methodControls.children]);methodOrder.splice(0,methodOrder.length,...order);
    methodOrder.forEach(name=>{const control=[...methodControls.children].find(node=>node.dataset.method===name);if(control)methodControls.append(control);});
    track.querySelectorAll('.comparison-card').forEach(card=>groups.get(card)?.updateSelection());animateLayout(before);return true;
  }
  function reorder(method,target,after=false){
    if(method===target)return;const next=methodOrder.filter(name=>name!==method),index=next.indexOf(target);if(index<0)return;
    next.splice(index+(after?1:0),0,method);return applyOrder(next);
  }
  function clearDrag(){
    draggingMethod=null;dragOrder=null;dragCommitted=false;
    track.querySelectorAll('.is-dragging,.is-reordering').forEach(node=>node.classList.remove('is-dragging','is-reordering'));
  }
  function attachReorder(handle,control,method){
    handle.className='comparison-reorder-handle';handle.draggable=true;handle.title='Drag to reorder; use Left/Right keys';
    handle.ondragstart=e=>{draggingMethod=method;dragOrder=[...methodOrder];dragCommitted=false;control.classList.add('is-dragging');control.parentElement.classList.add('is-reordering');e.dataTransfer.setData('text/plain',method);e.dataTransfer.effectAllowed='move';};
    handle.ondragend=()=>{if(!dragCommitted&&dragOrder)applyOrder(dragOrder);clearDrag();};
    handle.onkeydown=e=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();
      const shown=[...methodControls.children].filter(node=>!node.hidden&&node.querySelector('input').checked).map(node=>node.dataset.method),index=shown.indexOf(method),next=e.key==='Home'?0:e.key==='End'?shown.length-1:Math.max(0,Math.min(shown.length-1,index+(e.key==='ArrowLeft'?-1:1)));
      reorder(method,shown[next],next>index);handle.focus();
    };
  }
  const methodCheckboxes=[...selectedMethods].map(method=>{
    const control=el('div','comparison-method-control'),label=el('label','comparison-method-toggle'),checkbox=el('input');control.dataset.method=method;checkbox.type='checkbox';checkbox.checked=true;checkbox.dataset.method=method;checkbox.setAttribute('aria-label','Show '+method);label.classList.toggle('pinned',method==='AVM');label.append(checkbox,el('span','',method));control.append(label);methodControls.append(control);
    checkbox.onchange=()=>{if(method==='AVM'){checkbox.checked=true;return;}if(checkbox.checked)selectedMethods.add(method);else selectedMethods.delete(method);track.querySelectorAll('.comparison-card').forEach(card=>groups.get(card)?.updateSelection());syncButton();};return checkbox;
  });
  function toggle(){wantsPlay=!wantsPlay;syncButton();if(wantsPlay&&visible)active?.start();else active?.stop();}
  play.onclick=toggle;restart.onclick=()=>active?.restart();
  function inputDialog(asset){
    const dialog=el('dialog','result-input-dialog'),shell=el('div','result-input-shell'),image=el(asset.type==='video'?'video':'img'),close=button('×','Close enlarged input');
    image.src=media(asset.url);image.alt=asset.label;if(asset.type==='video'){image.controls=true;image.autoplay=true;image.muted=true;image.playsInline=true;image.loop=true;}close.className='cbtn result-input-close';close.onclick=()=>dialog.close();shell.append(image,close);dialog.append(shell);
    dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});dialog.addEventListener('close',()=>{image.pause?.();image.removeAttribute('src');image.load?.();dialog.remove();});document.body.append(dialog);dialog.showModal();
  }
  function card(example,dimension){
    const article=el('article','comparison-card'),context=el('div','comparison-context'),inputs=el('div','comparison-inputs'),viewer=el('div','camera-viewer'),videos=el('div','comparison-videos');article.dataset.comparisonId=example.id;videos.dataset.methods=String(example.clips.length);
    viewer.setAttribute('aria-label','Input image and requested camera frustums');context.append(inputs,viewer);
    let inputIndex=0;
    videos.tabIndex=0;videos.setAttribute('role','group');videos.setAttribute('aria-label','Method output videos');
    videos.onkeydown=e=>{if(e.target===videos&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();videos.scrollBy({left:e.key==='ArrowLeft'?-200:200,behavior:'smooth'});}};
    const inputButtons=example.inputs.map((asset,index)=>{
      const b=button('','Enlarge comparison input '+(index+1)),image=el(asset.type==='video'?'video':'img');
      if(asset.type==='video'){image.muted=true;image.playsInline=true;image.preload='none';if(asset.poster)image.poster=media(asset.poster);}
      b.className='comparison-input';b.hidden=index!==0;image.src=media(asset.url);image.alt=asset.label;image.loading='lazy';b.append(image);b.onclick=()=>inputDialog(asset);inputs.append(b);return b;
    });
    if(example.inputs.length>1){const navigation=el('div','comparison-reference-controls'),previous=button('‹','Previous comparison input'),next=button('›','Next comparison input');previous.className=next.className='comparison-reference-button';const move=delta=>{inputIndex=(inputIndex+delta+example.inputs.length)%example.inputs.length;inputButtons.forEach((b,i)=>{b.hidden=i!==inputIndex;});group.controller?.highlightContext(example.inputs[inputIndex].source_id);};previous.onclick=()=>move(-1);next.onclick=()=>move(1);navigation.append(previous,next);inputs.append(navigation);}
    const cells=[];const players=example.clips.map(clip=>{
      const cell=el('figure','comparison-player'),label=el('figcaption','comparison-method'),name=el('span','comparison-method-name',clip.method+' ('+clip.height+'×'+clip.width+')'),handle=button('⠿','Reorder '+clip.method),video=el('video'),full=button('⛶','Fullscreen '+clip.method+' result');
      label.append(name,handle);attachReorder(handle,cell,clip.method);cell.dataset.method=clip.method;cell.style.setProperty('--comparison-aspect',String(clip.width/clip.height));
      video.src=media(clip.video);video.poster=media(clip.poster);video.muted=true;video.loop=true;video.playsInline=true;video.preload='none';video.style.aspectRatio=clip.width+'/'+clip.height;video.addEventListener('loadedmetadata',()=>{if(video.duration>0&&Number.isFinite(video.duration)){if(clip.playback_fps_override){clip.fps=clip.playback_fps_override;clip.native_frame_count=Math.round(clip.fps*video.duration);}else if(clip.native_frame_count)clip.fps=clip.native_frame_count/video.duration;}video.style.aspectRatio=video.videoWidth+'/'+video.videoHeight;cell.style.setProperty('--comparison-aspect',String(video.videoWidth/video.videoHeight));name.textContent=clip.method+' ('+video.videoHeight+'×'+video.videoWidth+')';});video.tabIndex=0;video.setAttribute('role','button');video.setAttribute('aria-label','Play or pause '+clip.method+' result');
      video.playbackRate=example.clips[0].fps/clip.fps;full.className='comparison-fullscreen';full.innerHTML='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4"/></svg>';full.onclick=e=>{e.stopPropagation();video.requestFullscreen?.().catch(()=>{});};
      video.onclick=toggle;video.onkeydown=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();toggle();}};
      video.addEventListener('error',()=>{if(!cell.querySelector('.result-error'))cell.append(el('p','result-error',clip.method+' video unavailable.'));});
      cell.append(label,video,full);if(example.prompt_segments?.length){const prompt=el('div','comparison-prompt-overlay');prompt.setAttribute('aria-label','Summary of the recorded text prompt');cell.append(prompt);}videos.append(cell);cells.push(cell);return video;
    });
    const empty=el('p','comparison-empty','Select a method to compare.');videos.append(empty);article.append(context,videos);let master=players[0],masterIndex=0,callback=null,startController=null,playbackIndices=[];
    const orderedIndices=()=>methodOrder.map(method=>example.clips.findIndex(clip=>clip.method===method)).filter(i=>i>=0);
    const indices=()=>orderedIndices().filter(i=>selectedMethods.has(example.clips[i].method));
    function cancel(){if(callback!==null){if(master.cancelVideoFrameCallback)master.cancelVideoFrameCallback(callback);else cancelAnimationFrame(callback);callback=null;}}
    function updatePrompt(frame){const prompt=example.prompt_segments?.filter(item=>item.start_frame<=frame).at(-1);if(prompt)cells.forEach(cell=>{const label=cell.querySelector('.comparison-prompt-overlay');label.textContent=prompt.summary||prompt.text;});}
    function waitMedia(video,event,ready,signal){return new Promise(resolve=>{if(signal.aborted||video.error){resolve(false);return;}if(ready()){resolve(true);return;}const finish=ok=>{clearTimeout(timer);video.removeEventListener(event,success);video.removeEventListener('error',failure);signal.removeEventListener('abort',failure);resolve(ok);},success=()=>finish(true),failure=()=>finish(false),timer=setTimeout(failure,15000);video.addEventListener(event,success);video.addEventListener('error',failure);signal.addEventListener('abort',failure);});}
    async function prepare(video,time,signal){const loaded=waitMedia(video,'canplay',()=>video.readyState>=3,signal);video.preload='auto';if(video.readyState===0&&video.networkState!==2)video.load();if(!await loaded||signal.aborted)return false;if(Math.abs(video.currentTime-time)>.001)video.currentTime=time;if(!await waitMedia(video,'seeked',()=>!video.seeking,signal))return false;return waitMedia(video,'canplay',()=>video.readyState>=3,signal);}
    const group={players,example,controller:null,targetFps:example.clips[0].fps,currentReady:AVMHomepageAssets.mode!=='manifold'||readyDimensions.has(dimension.id),
      hasSelection:()=>indices().length>0,
      shownPlayers:()=>indices().map(i=>players[i]),
      seek(frame){players.forEach((v,i)=>{if(v.readyState>=1)v.currentTime=Math.max(0,Math.min(frame,example.frame_count-1))/example.clips[i].fps;});group.controller?.setTime(frame/group.targetFps);updatePrompt(frame);},
      stop(){startController?.abort();startController=null;cancel();players.forEach(v=>v.pause());playbackIndices=[];group.controller?.setPlaybackState(false);},
      restart(){group.stop();group.seek(0);if(active===group&&visible&&wantsPlay)group.start(0);},
      dispose(){group.stop();cells.forEach(cell=>{layoutAnimations.get(cell)?.cancel();layoutAnimations.delete(cell);});group.controller?.dispose();players.forEach(v=>{v.removeAttribute('src');v.load();});},
      updateSelection(){
        const before=captureLayout(cells),frame=master.currentTime*example.clips[masterIndex].fps;group.stop();const shown=indices();
        orderedIndices().forEach(i=>videos.append(cells[i]));videos.append(empty);
        cells.forEach((cell,i)=>{cell.hidden=!shown.includes(i);cell.toggleAttribute('data-row-first',i===shown[0]);cell.toggleAttribute('data-row-last',i===shown.at(-1));});
        empty.hidden=shown.length>0;animateLayout(before);masterIndex=shown[0]??0;master=players[masterIndex];group.seek(frame);if(active===group&&visible&&wantsPlay)group.start(frame);
      },
      async start(frame=master.currentTime*example.clips[masterIndex].fps){
        if(!group.currentReady||active!==group||!visible||!wantsPlay||!group.hasSelection()||startController||callback!==null)return;
        group.stop();const request=new AbortController();startController=request;const shown=indices();
        try{const ready=await Promise.all(shown.map(i=>prepare(players[i],Math.max(0,Math.min(frame,example.frame_count-1))/example.clips[i].fps,request.signal)));if(request.signal.aborted||active!==group||!visible||!wantsPlay)return;const available=shown.filter((i,j)=>ready[j]);if(!available.length)return;playbackIndices=available;available.forEach(i=>{players[i].playbackRate=example.clips[0].fps/example.clips[i].fps;});if(!available.includes(masterIndex)){masterIndex=available[0];master=players[masterIndex];}group.controller?.setTime(frame/group.targetFps);await Promise.allSettled(available.map(i=>players[i].play()));if(!request.signal.aborted&&active===group&&visible&&wantsPlay){schedule();}else if(active!==group||!wantsPlay)group.stop();}finally{if(startController===request)startController=null;}
      }
    };
    videos.ondragover=e=>{
      if(!draggingMethod||!indices().some(i=>example.clips[i].method===draggingMethod))return;
      e.preventDefault();e.dataTransfer.dropEffect='move';const bounds=videos.getBoundingClientRect();
      if(e.clientX<bounds.left+24)videos.scrollLeft-=18;else if(e.clientX>bounds.right-24)videos.scrollLeft+=18;
      const x=(e.clientX-bounds.left)/pageScale()+videos.scrollLeft,peers=indices().filter(i=>example.clips[i].method!==draggingMethod);
      if(!peers.length)return;const target=peers.find(i=>x<cells[i].offsetLeft+cells[i].offsetWidth/2);
      reorder(draggingMethod,example.clips[target??peers.at(-1)].method,target===undefined);
    };
    videos.ondrop=e=>{if(!draggingMethod)return;e.preventDefault();dragCommitted=true;};
    function schedule(){group.controller?.setPlaybackState(true);callback=master.requestVideoFrameCallback?master.requestVideoFrameCallback(tick):requestAnimationFrame(tick);}
    function tick(now,metadata){
      callback=null;if(active!==group||!visible||!wantsPlay||!group.hasSelection())return;
      const frame=(metadata?.mediaTime??master.currentTime)*example.clips[masterIndex].fps;if(example.clips.some(clip=>clip.native_frame_count>example.frame_count)&&frame>=example.frame_count-1){group.stop();group.seek(0);group.start(0);return;}
      playbackIndices.filter(i=>i!==masterIndex).forEach(i=>{const v=players[i],expected=frame/example.clips[i].fps;if(v.readyState>=1&&Math.abs(v.currentTime-expected)*example.clips[i].fps>1)v.currentTime=expected;});group.controller?.setTime(frame/group.targetFps);updatePrompt(frame);schedule();
    }
    players.forEach((video,i)=>video.addEventListener('waiting',()=>{if(active===group&&visible&&wantsPlay&&playbackIndices.includes(i)&&!startController){const frame=master.currentTime*example.clips[masterIndex].fps;group.stop();group.start(frame);}}));
    (async()=>{await Promise.resolve();const results=group.currentReady?await resultsReady():null,registered=Object.values(results?.catalogue.examples||{}).find(item=>item.dataset===dimension.dataset&&item.scene_id===example.scene),source=(AVMHomepageAssets.mode==='manifold'?null:registered)||{id:example.id,video:example.clips.find(clip=>clip.method==='AVM').video,media:{fps:example.clips[0].fps},inputs:example.inputs};const cameras=!group.currentReady?example.camera_data:AVMHomepageAssets.mode==='manifold'||registered?await results.getCameraData(source):example.camera_data;if(cameras?.target.frames.length>example.frame_count)cameras.target.frames=cameras.target.frames.slice(0,example.frame_count);if(!cameras)throw new Error('Scene camera records unavailable');if(!article.isConnected)return;const references=example.inputs.map((asset,i)=>({type:asset.type||'image',source_id:source.inputs[i].source_id,url:media(asset.url),element:inputButtons[i].firstChild}));group.targetFps=cameras.target.fps;group.controller=WCMCameraViewer.mount(viewer,cameras,null,{compact:true,theme:'light',references,onPlaybackToggle:toggle,onSelectContext:selection=>{const index=references.findIndex(reference=>reference.source_id===selection.source_id);if(index<0)return;inputIndex=index;inputButtons.forEach((button,i)=>{button.hidden=i!==inputIndex;});group.controller.highlightContext(selection.source_id);}});group.controller.setPlaybackState(wantsPlay&&visible);group.controller.highlightTarget(true);if(inputButtons.length>1)group.controller.highlightContext(example.inputs[inputIndex].source_id);group.controller.setTime(master.currentTime*example.clips[masterIndex].fps/group.targetFps);})().catch(()=>{if(article.isConnected){viewer.textContent='Camera views unavailable.';viewer.classList.add('result-error');}});
    group.updateSelection();
    groups.set(article,group);return article;
  }
  const dimensionButtons=data.dimensions.map((dimension,index)=>{
    const b=button(dimension.label);b.id='comparison-tab-'+dimension.id;b.setAttribute('role','tab');b.setAttribute('aria-controls',track.id);b.onclick=()=>render(index);
    b.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?data.dimensions.length-1:(index+(e.key==='ArrowLeft'?-1:1)+data.dimensions.length)%data.dimensions.length;dimensionButtons[n].focus();render(n);}};
    tabs.append(b);return b;
  });
  function render(index){
    clearTimeout(retryTimer);retryTimer=null;
    const version=++renderVersion;
    const dimension=data.dimensions[index],example=dimension.cases[0],available=new Set(example.clips.map(v=>v.method));methodCheckboxes.forEach(checkbox=>{const pinned=checkbox.dataset.method==='AVM',unavailable=!available.has(checkbox.dataset.method);checkbox.disabled=pinned||unavailable;const label=checkbox.closest('label');label.parentElement.hidden=unavailable;label.classList.toggle('unavailable',unavailable);label.title=pinned?'AVM is always shown.':'';});
    let article,next;try{article=card(example,dimension);next=groups.get(article);}catch(error){console.warn('Comparison tab render failed',dimension.id,error);return;}
    const previous=active;track.replaceChildren(article);active=next;dimensionIndex=index;previous?.dispose();
    dimensionButtons.forEach((b,i)=>{b.setAttribute('aria-selected',String(i===index));b.tabIndex=i===index?0:-1;});track.setAttribute('aria-labelledby',dimensionButtons[index].id);
    syncButton();if(visible&&wantsPlay)active.start();
    status.replaceChildren();host.setAttribute('aria-busy',String(!active.currentReady));
    if(!active.currentReady){
      let retryDelay=1000;
      const loadCurrent=()=>{
        if(renderVersion!==version)return;
        loadDimension(index).then(()=>{const refresh=()=>{if(renderVersion!==version)return;if(draggingMethod){setTimeout(refresh,100);return;}render(index);};refresh();})
          .catch(error=>{console.warn('Current comparison will retry',error);if(renderVersion!==version)return;retryTimer=setTimeout(loadCurrent,retryDelay);retryDelay=Math.min(30000,retryDelay*2);});
      };
      loadCurrent();
    }
  }
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible&&wantsPlay)active?.start();else active?.stop();},{threshold:.15}).observe(host);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)active?.stop();else if(visible&&wantsPlay)active?.start();});
  setInterval(async()=>{if(document.hidden||AVMHomepageAssets.mode!=='manifold'||manifestRevision===null)return;try{const latest=await jsonAsset(manifestUrl+'?v='+Date.now());if(sourceSignature(latest)!==manifestRevision)location.reload();}catch(error){console.warn('Current collage refresh will retry',error);}},60000);
  skeleton.remove();host.classList.remove('comparison-pending');render(0);syncButton();window.YuzuComparisons={data,getState:()=>({dimension:data.dimensions[dimensionIndex].id,scene:active?.example.scene,playing:wantsPlay,loading:!active?.currentReady,methods:methodOrder.filter(method=>selectedMethods.has(method)),methodOrder:[...methodOrder]}),getPlayers:()=>active?.shownPlayers()||[],getController:()=>active?.controller};
})().catch(error=>{console.warn('Comparison initialization failed',error);});
