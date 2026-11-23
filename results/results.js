/* Results: source media and native camera grids, presented in the gallery layout. */
(async function () {
  'use strict';
  const host=document.querySelector('main');if(!host?.querySelector('[data-result-section]'))return;
  const mediaUrl = AVMHomepageAssets.resolve;
  const catalogue = await AVMHomepageAssets.json('assets/gallery.json.gz');
  const controllers=new Map(),cameraCache=new Map();
  const imageObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{
    if(entry.isIntersecting){entry.target.src=entry.target.dataset.mediaSrc;imageObserver.unobserve(entry.target);}
  }),{rootMargin:'250px'});
  function lazyImage(media,url){media.dataset.mediaSrc=mediaUrl(url);media.loading='lazy';media.decoding='async';imageObserver.observe(media);}
  function queueVideo(video,url,poster){video.dataset.mediaSrc=mediaUrl(url);if(poster)video.dataset.mediaPoster=mediaUrl(poster);}
  function previewPoster(asset,fallback){if(asset.preview_poster){try{return mediaUrl(asset.preview_poster);}catch(error){}}return fallback?mediaUrl(fallback):null;}
  function loadVideo(video){if(video.dataset.mediaSrc&&!video.getAttribute('src')){if(video.dataset.mediaPoster)video.poster=video.dataset.mediaPoster;video.src=video.dataset.mediaSrc;}}
  const arrows={previous:'<path d="M10 2 4 8l6 6"/>',next:'<path d="M6 2l6 6-6 6"/>'};
  function button(label,direction){const b=document.createElement('button');b.type='button';b.className='cbtn';b.setAttribute('aria-label',label);b.innerHTML='<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.5">'+arrows[direction]+'</svg>';return b;}
  function element(tag,className){const e=document.createElement(tag);if(className)e.className=className;return e;}
  function cameraData(example) {
    if (!cameraCache.has(example.id)) {
      const load = AVMHomepageAssets.json(example.camera).catch(error => { cameraCache.delete(example.id); throw error; });
      cameraCache.set(example.id, load);
    }
    return cameraCache.get(example.id);
  }
  function openInput(inputs,index,originals,onSelect){
    const dialog=element('dialog','result-input-dialog'),shell=element('div','result-input-shell');dialog.append(shell);
    const counter=element('span','input-counter');counter.setAttribute('aria-live','polite');shell.append(counter);
    const close=button('Close enlarged input','next');close.className+=' result-input-close';close.textContent='×';
    const prev=button('Previous input','previous'),next=button('Next input','next');prev.className+=' result-input-prev';next.className+=' result-input-next';let media=null;
    function clearMedia(){if(!media)return;media.pause?.();media.removeAttribute('src');media.load?.();media.remove();media=null;}
    function show(){
      clearMedia();const asset=inputs[index],original=originals[index];
      media=element(asset.type==='video'?'video':'img');media.setAttribute('aria-label',asset.label);
      if(asset.type==='video'){
        media.controls=true;media.autoplay=true;media.muted=true;media.playsInline=true;media.loop=true;media.preload='auto';
        if(asset.poster)media.poster=mediaUrl(asset.poster);
        const video=media;video.addEventListener('loadedmetadata',()=>{
          if(video!==media||!dialog.open)return;
          const time=original?.currentTime||0;if(time&&time<video.duration)video.currentTime=time;
          video.play().catch(()=>{});
        },{once:true});
      }else media.alt=asset.label;
      media.src=mediaUrl(asset.url);shell.prepend(media);counter.textContent=(index+1)+'/'+inputs.length;counter.setAttribute('aria-label','Input '+(index+1)+' of '+inputs.length);prev.hidden=next.hidden=inputs.length<2;onSelect?.(index);
    }
    close.onclick=()=>dialog.close();prev.onclick=()=>{index=(index-1+inputs.length)%inputs.length;show();};next.onclick=()=>{index=(index+1)%inputs.length;show();};dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});dialog.addEventListener('keydown',e=>{if(e.target.tagName==='VIDEO'||inputs.length<2)return;if(e.key==='ArrowLeft'){e.preventDefault();prev.click();}if(e.key==='ArrowRight'){e.preventDefault();next.click();}});dialog.addEventListener('close',()=>{clearMedia();dialog.remove();});shell.append(close,prev,next);document.body.append(dialog);show();dialog.showModal();
  }
  function dispose(scope){scope.querySelectorAll('.result-card').forEach(card=>{card.stopObserver?.();controllers.get(card)?.dispose();controllers.delete(card);card.querySelectorAll('video').forEach(video=>{video.pause();video.removeAttribute('src');video.load();});});}
  function eventMediaUrl(example,url){
    const entry=window.AVMEventPrompts?.examples[example.id];if(!entry)return mediaUrl(url);
    const versioned=new URL(url,location.href);versioned.searchParams.set('v',entry.video_sha256.slice(0,12));return mediaUrl(String(versioned));
  }
  function eventInstruction(example,video){
    const entry=window.AVMEventPrompts?.examples[example.id];
    const segments=entry?.instructions||(entry?.instruction?[{start_frame:0,end_frame:example.media.frame_count,instruction:entry.instruction}]:[]);
    if(!segments.length)return null;
    const note=element('div','result-event-instruction');note.setAttribute('role','note');
    note.setAttribute('aria-label','Suggested instruction for this transition');
    function update(){
      const frame=Math.floor(video.currentTime*example.media.fps+1e-4);
      const segment=segments.find(item=>frame>=item.start_frame&&frame<item.end_frame)||segments[segments.length-1];
      note.textContent=segment.instruction;
    }
    for(const event of ['timeupdate','seeked','loadedmetadata','durationchange'])video.addEventListener(event,update);
    update();return note;
  }
  function trajectoryInstruction(example,video){
    const entry=catalogue.trajectory_captions?.[example.id];if(!entry)return null;
    const note=element('div','result-event-instruction');note.setAttribute('aria-label','Camera trajectory type');
    function update(){const frame=Math.min(example.media.frame_count-1,Math.max(0,Math.floor(video.currentTime*example.media.fps+1e-4)));note.textContent=entry.kind==='out-and-back'?'Out-and-back: Loop '+(Math.floor(frame/entry.cycle_frames)+1):'Loop closure';}
    for(const event of ['timeupdate','seeked','loadedmetadata','durationchange'])video.addEventListener(event,update);
    update();return note;
  }
  function card(id,options={}){
    const example=catalogue.examples[id],article=element('article','result-card'),layout=element('div','spatial-layout');
    article.dataset.exampleId=id;
    const left=element('div','spatial-left'),gallery=element('div','reference-gallery'),track=element('div','reference-track');track.tabIndex=0;track.setAttribute('aria-label','Input references');
    const controls=element('div','reference-controls'),prev=button('Previous input','previous'),next=button('Next input','next');controls.append(prev,next);gallery.append(track,controls);
    const refs=[],referenceInstances=[],denseContext=example.dense;
    let selectedReference=null;
    function referenceSlide(index){
      const asset=example.inputs[index],slide=element('figure','reference-slide'),media=element(asset.type==='video'?'video':'img');
      if(asset.type==='image')lazyImage(media,asset.url);else queueVideo(media,mediaUrl(asset.url),previewPoster(asset,asset.poster));media.alt=asset.label;media.draggable=false;media.loading='lazy';media.dataset.contextId=asset.source_id;
      if(asset.type==='video'){media.muted=true;media.loop=true;media.playsInline=true;media.preload='none';}
      if(denseContext)media.addEventListener('load',()=>{if(media===selectedReference)controllers.get(article)?.setContextImageElement(asset.source_id,media);});
      const badge=element('span','input-counter');badge.textContent=(index+1)+'/'+example.inputs.length;badge.setAttribute('aria-label','Input '+(index+1)+' of '+example.inputs.length);
      referenceInstances.push({...asset,url:mediaUrl(asset.url),element:media,purpose:'raw'});slide.append(media,badge);slide.tabIndex=0;slide.setAttribute('role','button');slide.setAttribute('aria-label','Enlarge input reference');
      slide.addEventListener('click',()=>openInput(example.inputs,index,refs,selected=>referenceCarousel.go(selected)));
      slide.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();openInput(example.inputs,index,refs,selected=>referenceCarousel.go(selected));}});
      slide.addEventListener('mouseenter',()=>controllers.get(article)?.highlightContext(asset.source_id));slide.addEventListener('mouseleave',()=>controllers.get(article)?.highlightContext(null));
      return slide;
    }
    const referenceSlides=example.inputs.map((asset,index)=>{const slide=referenceSlide(index);refs.push(slide.firstChild);return slide;});
    const referenceCarousel=AVMLoopCarousel.mount(track,referenceSlides,{clone:(slide,index)=>referenceSlide(index),dragExclude:'button,input,select,a',onChange:(index,slide)=>{if(denseContext){selectedReference=slide.firstChild;controllers.get(article)?.setContextImageElement(example.inputs[index].source_id,selectedReference);}}});
    prev.hidden=next.hidden=example.inputs.length<2;prev.onclick=()=>referenceCarousel.move(-1);next.onclick=()=>referenceCarousel.move(1);
    const viewer=element('div','camera-viewer');viewer.setAttribute('aria-label','Input and requested output cameras');left.append(gallery,viewer);
    const output=element('figure','spatial-output'),video=element('video');queueVideo(video,eventMediaUrl(example,example.video),previewPoster(example,example.poster));video.muted=true;video.loop=true;video.playsInline=true;video.preload='none';video.setAttribute('aria-label','AVM generated result, '+example.scene_id);output.append(video);output.tabIndex=0;output.setAttribute('role','button');output.setAttribute('aria-label','Play or pause the output');output.onclick=()=>{loadVideo(video);if(video.paused)video.play().catch(()=>{});else video.pause();};output.onkeydown=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();output.click();}};output.onmouseenter=()=>controllers.get(article)?.highlightTarget(true);output.onmouseleave=()=>controllers.get(article)?.highlightTarget(false);
    const instruction=options.trajectoryCaptions?trajectoryInstruction(example,video):eventInstruction(example,video);if(instruction)output.append(instruction);
    layout.append(left,output);article.append(layout);let visible=false,initialized=false;
    const observer=new IntersectionObserver(async entries=>{visible=entries[0].isIntersecting;if(!visible){video.pause();referenceInstances.forEach(ref=>ref.element.pause?.());return;}loadVideo(video);referenceInstances.forEach(ref=>{if(ref.element.tagName==='VIDEO')loadVideo(ref.element);});if(!initialized){initialized=true;try{const data=await cameraData(example);if(!article.isConnected)return;const references=denseContext?[]:referenceInstances;const controller=AVMCameraViewer.mount(viewer,data,video,{compact:true,theme:'light',references,singleContextImage:denseContext,onSelectContext:selection=>{const index=example.inputs.findIndex(input=>input.source_id===selection.source_id);if(index>=0)referenceCarousel.go(index);}});controllers.set(article,controller);if(denseContext&&selectedReference)controller.setContextImageElement(selectedReference.dataset.contextId,selectedReference);}catch(error){viewer.textContent='Camera views unavailable.';viewer.classList.add('result-error');}}if(visible&&article.isConnected)video.play().catch(()=>{});},{threshold:.15});observer.observe(article);article.stopObserver=()=>{observer.disconnect();referenceCarousel.dispose();};
    return article;
  }
  function galleryOrder(key, fallback){return catalogue.gallery_orders?.[key]||fallback;}
  let galleryCount=0;
  function singleGallery(scope,ids,options={}){
    const nav=element('div','result-scene-controls'),prev=button('Previous scene','previous'),next=button('Next scene','next'),caption=element('div','result-slide-copy'),track=element('div','result-carousel-track');
    const scenes=element('div','result-scene-thumbnails');
    track.id='result-scenes-'+(++galleryCount);track.tabIndex=0;track.setAttribute('aria-label',options.label||'Result slides');
    scenes.setAttribute('role','group');scenes.setAttribute('aria-label','Choose a scene');
    const thumbnails=ids.map((id,index)=>{
      const example=catalogue.examples[id],thumb=element('button','result-scene-thumbnail'),image=element('img');
      const input=example.inputs.find(asset=>asset.type==='image'||asset.poster);
      let preview=input?(input.type==='image'?input.url:input.poster):example.poster;if(example.thumbnail){try{mediaUrl(example.thumbnail);preview=example.thumbnail;}catch(error){}}
      thumb.type='button';thumb.dataset.exampleId=id;thumb.setAttribute('aria-label','Show scene: '+example.scene_id);
      thumb.setAttribute('aria-controls',track.id);
      thumb.setAttribute('aria-pressed','false');thumb.tabIndex=-1;
      image.alt='';lazyImage(image,preview);image.draggable=false;
      image.addEventListener('error',()=>{
        if(image.dataset.fallback){image.hidden=true;return;}
        image.dataset.fallback='true';image.src=mediaUrl(example.poster);
      });
      const fallback=element('span','result-scene-fallback');fallback.textContent='Scene';fallback.setAttribute('aria-hidden','true');
      thumb.append(fallback,image);thumb.onclick=()=>carousel.go(index);
      thumb.addEventListener('keydown',event=>{
        let target;
        if(event.key==='ArrowRight')target=(index+1)%ids.length;
        else if(event.key==='ArrowLeft')target=(index-1+ids.length)%ids.length;
        else if(event.key==='Home')target=0;
        else if(event.key==='End')target=ids.length-1;
        else return;
        event.preventDefault();thumbnails[target].focus({preventScroll:true});carousel.go(target);
      });
      scenes.append(thumb);return thumb;
    });
    function selectScene(index){
      thumbnails.forEach((thumb,i)=>{thumb.setAttribute('aria-pressed',String(i===index));thumb.tabIndex=i===index?0:-1;});
      const thumb=thumbnails[index];
      if(thumb.offsetLeft<scenes.scrollLeft||thumb.offsetLeft+thumb.offsetWidth>scenes.scrollLeft+scenes.clientWidth){
        scenes.scrollTo({left:thumb.offsetLeft-(scenes.clientWidth-thumb.offsetWidth)/2,behavior:'instant'});
      }
    }
    prev.setAttribute('aria-controls',track.id);next.setAttribute('aria-controls',track.id);
    nav.append(prev,scenes,next);scope.replaceChildren(nav,caption,track);
    function make(id){return card(id,options);}
    const slides=ids.map(make);
    prev.hidden=next.hidden=ids.length<2;
    const carousel=AVMLoopCarousel.mount(track,slides,{clone:(slide,index)=>make(ids[index]),onChange:index=>{
      const example=catalogue.examples[ids[index]];selectScene(index);caption.replaceChildren();
      if(options.copy){const text=options.copy(example);if(text){const title=element('h4','result-subtitle');title.textContent=text.title;const body=element('p','measure dek');body.textContent=text.body;caption.append(title,body);}}
      options.onChange?.(example,index);
    }});
    prev.onclick=()=>carousel.move(-1);next.onclick=()=>carousel.move(1);return carousel;
  }
  function deferGallery(scope,ids,options={}){
    if(!scope||!ids.length)return;
    scope.setAttribute('aria-busy','true');
    const placeholder=element('div','result-gallery-placeholder');placeholder.setAttribute('aria-hidden','true');
    const preview=element('div','result-placeholder-card');preview.innerHTML=AVMHomepageAssets.videoPlaceholderIcon;placeholder.append(element('div','result-placeholder-nav'),preview);scope.replaceChildren(placeholder);
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();singleGallery(scope,ids,options);scope.removeAttribute('aria-busy');}
    },{rootMargin:'600px'});observer.observe(scope);
  }
  const freeCamera=host.querySelector('[data-camera-control]');
  if(freeCamera)deferGallery(freeCamera,galleryOrder('free_camera',catalogue.groups.free_camera),{label:'Choose free-camera scene'});
  const events=host.querySelector('[data-event-prompting]');
  if(events)deferGallery(events,galleryOrder('worldscore_static',catalogue.groups.worldscore_static),{label:'Choose event-prompting scene'});
  deferGallery(host.querySelector('[data-dynamics]'),galleryOrder('camera_control',catalogue.groups.camera_control),{label:'Choose dynamic scene'});
  const imageResults=[...catalogue.groups.worldbench,...catalogue.groups.dl3dv_multiview];
  deferGallery(host.querySelector('[data-image-results]'),galleryOrder('image_context',imageResults),{label:'Choose image-context result'});
  deferGallery(host.querySelector('[data-video-stream-results]'),galleryOrder('video_prompt',catalogue.groups.video_prompt),{label:'Choose 4D reconstruction result'});
  deferGallery(host.querySelector('[data-video-rigs-results]'),galleryOrder('dynamic_reconstruction',catalogue.groups.dynamic_reconstruction),{label:'Choose video-rigs context result'});
  deferGallery(host.querySelector('[data-long-rollouts]'),galleryOrder('long_rollouts',[...catalogue.groups.long_rollout,...catalogue.groups.revisit_static,...catalogue.groups.revisit_dynamic]),{trajectoryCaptions:true});
  deferGallery(host.querySelector('[data-perpetual]'),galleryOrder('perpetual',catalogue.groups.perpetual));
  const dense=host.querySelector('[data-dense-prefill]');
  const denseExamples=galleryOrder('dense_prefill',catalogue.groups.dense_prefill||[]);
  if(dense&&denseExamples.length)deferGallery(dense,denseExamples,{label:'Choose dense-prefill scene'});
  else if(dense)dense.textContent='Dense prompt examples are loading.';
  window.AVMResults={catalogue,getControllers:()=>controllers,getCameraData:cameraData};
  window.dispatchEvent(new Event('avm-results-ready'));
})().catch(error=>{const host=document.querySelector('[data-event-prompting]')||document.querySelector('[data-camera-control]');if(host)host.textContent='Results could not load: '+error.message;});
