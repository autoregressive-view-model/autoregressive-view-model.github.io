/* Continuous scroll-snap carousels with a visible neighboring case at both ends. */
(function (global) {
  'use strict';
  function mount(track, slides, options = {}) {
    const count = slides.length;
    if (!count) return {go() {}, move() {}, dispose() {}};
    let physical = count > 1 ? 1 : 0, index = 0, timer = null, drag = null, suppressUntil = 0;
    const all = [], listeners = [];
    const pageScale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--page-scale')) || 1;
    function listen(element, type, handler, settings) {
      element.addEventListener(type, handler, settings);
      listeners.push(() => element.removeEventListener(type, handler, settings));
    }
    function clone(i) {
      const slide = options.clone ? options.clone(slides[i], i) : slides[i].cloneNode(true);
      slide.dataset.loopClone = 'true';
      slide.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
      slide.removeAttribute('id');
      return slide;
    }
    if (count > 1) all.push(clone(count - 1));
    all.push(...slides);
    if (count > 1) all.push(clone(0), clone(1));
    all.forEach((slide, i) => {
      slide.dataset.logicalIndex = String(count > 1 ? (i - 1 + count) % count : 0);
      track.append(slide);
    });
    track.dataset.loopCount = String(count);
    function offset(i) { return all[i].offsetLeft - all[0].offsetLeft; }
    function sync() {
      track.dataset.currentIndex = String(index);
      options.onChange?.(index, all[physical]);
    }
    function jump(i) {
      const snap = track.style.scrollSnapType, behavior = track.style.scrollBehavior;
      track.style.scrollSnapType = 'none'; track.style.scrollBehavior = 'auto';
      track.scrollLeft = offset(i);
      track.style.scrollSnapType = snap; track.style.scrollBehavior = behavior;
    }
    function normalize() {
      if (count < 2 || (physical >= 1 && physical <= count)) return;
      const previous = all[physical]; physical = index + 1;
      const canonical = all[physical];
      previous.querySelectorAll('video').forEach((video, i) => {
        const destination = canonical.querySelectorAll('video')[i];
        if (!destination) return;
        const copy = () => { destination.currentTime = video.currentTime; };
        if (destination.readyState >= 1) copy();
        else destination.addEventListener('loadedmetadata', copy, {once: true});
      });
      options.onNormalize?.(previous, canonical);
      jump(physical);
    }
    function settle() {
      if (drag) return;
      physical = all.reduce((best, slide, i) =>
        Math.abs(offset(i) - track.scrollLeft) < Math.abs(offset(best) - track.scrollLeft) ? i : best, 0);
      index = Number(all[physical].dataset.logicalIndex);
      normalize(); sync();
    }
    function scroll(i, immediate = false) {
      physical = i; index = Number(all[i].dataset.logicalIndex); clearTimeout(timer);
      track.scrollTo({left: offset(i), behavior: immediate || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
      sync(); timer = setTimeout(settle, 160);
    }
    function go(value) {
      const logical = (value % count + count) % count;
      scroll(count > 1 ? logical + 1 : 0);
    }
    function move(delta) {
      normalize(); scroll(Math.max(0, Math.min(all.length - 1, physical + delta)));
    }
    listen(track, 'scroll', () => { clearTimeout(timer); timer = setTimeout(settle, 120); }, {passive: true});
    listen(track, 'keydown', event => {
      if (event.target !== track) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
    });
    listen(track, 'dragstart', event => event.preventDefault());
    listen(track, 'pointerdown', event => {
      if (count < 2 || event.pointerType === 'touch' || event.button !== 0 ||
          event.target.closest(options.dragExclude || 'button,input,select,a,.camera-viewer,.reference-gallery')) return;
      clearTimeout(timer); drag = {x: event.clientX, scroll: track.scrollLeft, physical, moved: false};
    });
    listen(track, 'pointermove', event => {
      if (!drag) return;
      const delta = (event.clientX - drag.x) / pageScale();
      if (Math.abs(delta) > 4 && !drag.moved) { drag.moved = true; track.setPointerCapture(event.pointerId); }
      if (drag.moved) {
        event.preventDefault(); track.classList.add('is-dragging');
        track.style.scrollSnapType = 'none'; track.style.scrollBehavior = 'auto';
        track.scrollLeft = drag.scroll - delta;
      }
    });
    function finish(event) {
      if (!drag) return;
      const prior = drag, delta = (event.clientX - prior.x) / pageScale(); drag = null;
      track.classList.remove('is-dragging'); track.style.scrollSnapType = ''; track.style.scrollBehavior = '';
      if (prior.moved) {
        suppressUntil = performance.now() + 400; physical = prior.physical;
        move(Math.abs(delta) > track.clientWidth * .12 ? (delta < 0 ? 1 : -1) : 0);
      }
    }
    listen(track, 'pointerup', finish); listen(track, 'pointercancel', finish);
    listen(track, 'click', event => {
      if (event.detail && performance.now() < suppressUntil) { event.preventDefault(); event.stopPropagation(); }
    }, true);
    const observer = new ResizeObserver(() => { normalize(); jump(physical); }); observer.observe(track);
    jump(physical); sync();
    return {go, move, dispose() {clearTimeout(timer); observer.disconnect(); listeners.forEach(remove => remove());}};
  }
  global.AVMLoopCarousel = {mount};
})(window);
