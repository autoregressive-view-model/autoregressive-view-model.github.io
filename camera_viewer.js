/* Camera poses, frustums and playback controls. */
(function (global) {
  'use strict';
  const add = (a, b) => a.map((value, i) => value + b[i]);
  const sub = (a, b) => a.map((value, i) => value - b[i]);
  const scale = (a, amount) => a.map(value => value * amount);
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = vector => scale(vector, 1 / Math.max(Math.hypot(...vector), 1e-12));
  const center = frame => frame.c2w.slice(0, 3).map(row => row[3]);
  const transform = (matrix, point) => matrix.slice(0, 3).map(row => dot(row.slice(0, 3), point) + row[3]);

  function inverse3(matrix) {
    const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
    const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(determinant) < 1e-12) throw new Error('Camera intrinsics are singular');
    return [[e * i - f * h, c * h - b * i, b * f - c * e],
      [f * g - d * i, a * i - c * g, c * d - a * f],
      [d * h - e * g, b * g - a * h, a * e - b * d]].map(row => scale(row, 1 / determinant));
  }

  function frustumVertices(frame, depth) {
    const inverse = inverse3(frame.K);
    const origin = frame.pixel_convention === 'index_center' ? -0.5 : 0;
    const corners = [[origin, origin], [frame.width + origin, origin],
      [frame.width + origin, frame.height + origin], [origin, frame.height + origin]];
    return [center(frame), ...corners.map(([x, y]) => {
      const ray = inverse.map(row => dot(row, [x, y, 1]));
      return transform(frame.c2w, scale(ray, depth / ray[2]));
    })];
  }

  function validateData(data) {
    if (data?.schema !== 'avm.camera_paths/1' || data.coordinate_system !== 'opencv_c2w' ||
        !Array.isArray(data.contexts) || !Array.isArray(data.target?.frames) || !data.target.frames.length) {
      throw new Error('Camera paths are unavailable');
    }
    for (const track of [...data.contexts, data.target]) {
      if (!Array.isArray(track.frames) || !track.frames.length) throw new Error('Empty camera track');
      let previous = -Infinity;
      for (const frame of track.frames) {
        for (const [key, rows] of [['K', 3], ['c2w', 4]]) {
          if (!Array.isArray(frame[key]) || frame[key].length !== rows ||
              frame[key].some(row => !Array.isArray(row) || row.length !== rows || row.some(value => !Number.isFinite(value)))) {
            throw new Error('Invalid camera calibration');
          }
        }
        if (!Number.isFinite(frame.time) || frame.time < previous || !Number.isInteger(frame.width) ||
            !Number.isInteger(frame.height) || Math.min(frame.width, frame.height) <= 0) throw new Error('Invalid camera clock or image size');
        previous = frame.time;
        inverse3(frame.K);
      }
    }
    return data;
  }

  function frameAt(frames, time) {
    let low = 0, high = frames.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (frames[middle].time <= time + 1e-7) low = middle;
      else high = middle - 1;
    }
    return frames[low];
  }

  function chaseBasis(frame, distance, framing = {}) {
    const position = center(frame);
    const forward = unit(frame.c2w.slice(0, 3).map(row => row[2]));
    const right = unit(frame.c2w.slice(0, 3).map(row => row[0]));
    const cameraUp = unit(frame.c2w.slice(0, 3).map(row => -row[1]));
    const eye = add(add(sub(position, scale(forward, distance)), scale(cameraUp, distance * (framing.upOffset ?? 0.35))), scale(right, distance * (framing.rightOffset ?? 0.1)));
    const target = add(position, scale(forward, distance * 0.5));
    const direction = unit(sub(target, eye));
    const viewRight = unit(cross(direction, cameraUp));
    return {eye, target, forward: direction, right: viewRight, up: cross(viewRight, direction)};
  }

  function contextIds(data, selection) {
    if (!selection) return [];
    if (typeof selection === 'string') selection = {source_id: selection};
    const ids = new Set([selection.source_id, ...(Array.isArray(selection.source_ids) ? selection.source_ids : [])].filter(Boolean).map(String));
    let matches = data.contexts.filter(track => ids.has(String(track.id)) || ids.has(String(track.source_id)) ||
      track.frames.some(frame => ids.has(String(frame.id))));
    if (!matches.length && selection.rig) {
      const rig = selection.rig_id || selection.camera_id || selection.source_id;
      matches = data.contexts.filter(track => rig && [track.id, track.camera_id, track.rig_id].includes(rig));
    }
    return matches.map(track => track.id);
  }

  function mount(root, input, video, settings = {}) {
    const data = validateData(input);
    const compact = settings.compact === true;
    const light = settings.theme === 'light';
    const frames = data.target.frames;
    const duration = frames.at(-1).time + 1 / (data.target.fps || 24);
    const points = [...data.contexts.flatMap(track => track.frames), ...frames].map(center);
    if (data.geometry?.edges) points.push(...data.geometry.edges.flat());
    const minimum = points.reduce((bounds, point) => bounds.map((value, axis) => Math.min(value, point[axis])), [Infinity, Infinity, Infinity]);
    const maximum = points.reduce((bounds, point) => bounds.map((value, axis) => Math.max(value, point[axis])), [-Infinity, -Infinity, -Infinity]);
    const extent = Math.max(Math.hypot(...sub(maximum, minimum)), 1);
    const worldUp = unit(data.world_up || frames[0].c2w.slice(0, 3).map(row => -row[1]));
    const initialForward = unit(frames[0].c2w.slice(0, 3).map(row => row[2]));
    const gridForward = unit(sub(initialForward, scale(worldUp, dot(initialForward, worldUp))));
    const gridRight = unit(cross(gridForward, worldUp));
    const gridCenter = scale(add(minimum, maximum), 0.5);
    // A visual reference floor, placed below every real camera and image plane.
    // Keep all recorded geometry untouched, including scenes whose origin is a camera.
    const floorLevel = [...data.contexts.flatMap(track => track.frames), ...frames].reduce((level, frame) =>
      Math.min(level, ...frustumVertices(frame, extent * 0.08).map(vertex => dot(vertex, worldUp))), Infinity) - extent * 0.025;
    const floorOrigin = add(gridCenter, scale(worldUp, floorLevel - dot(gridCenter, worldUp)));
    const state = {target: scale(add(minimum, maximum), 0.5), yaw: 0.65, pitch: 0.42,
      distance: extent * 0.9, time: 0, playing: false, mode: 'chase', contexts: true, targetPath: true, frustums: true,
      geometry: !compact && Boolean(data.geometry?.edges?.length)};
    const home = {target: [...state.target], yaw: state.yaw, pitch: state.pitch, distance: state.distance, mode: state.mode};
    root.className = 'camera-viewer' + (compact ? ' camera-viewer-compact' : '');
    root.replaceChildren();
    const create = (tag, className, text) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text) element.textContent = text;
      return element;
    };
    const header = create('div', 'camera-viewer-header');
    header.hidden = compact;
    header.append(create('span', 'camera-viewer-title', 'Camera paths'));
    const options = create('div', 'camera-viewer-options');
    const canvas = create('canvas', 'camera-viewer-canvas');
    // Keep backing-store dimensions out of flexible viewport sizing.
    canvas.style.flexBasis = '0px';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Interactive context-camera frustums and target trajectory. Drag to orbit, shift-drag to pan, scroll to zoom.');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Camera viewer rendering is unavailable');
    const toolbar = create('div', 'camera-viewer-toolbar');
    const play = create('button', 'camera-viewer-button', 'Play');
    play.type = 'button';
    const scrub = create('input', 'camera-viewer-scrub');
    scrub.type = 'range'; scrub.min = '0'; scrub.max = String(duration); scrub.step = 'any'; scrub.value = '0';
    scrub.setAttribute('aria-label', 'Target camera trajectory time');
    const clock = create('span', 'camera-viewer-clock', '0.00 s');
    const reset = create('button', 'camera-viewer-button', 'Fit'); reset.type = 'button';
    const detail = create('div', 'camera-viewer-detail', 'Drag to orbit · Shift-drag to pan · Scroll to zoom');
    header.append(options); toolbar.append(play, ...(compact ? [] : [scrub, clock]), reset);
    function icon(path) { return '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' + path + '</svg>'; }
    function playLabel() {
      play.setAttribute('aria-label', state.playing ? 'Pause video' : 'Play video');
      play.title = state.playing ? 'Pause' : 'Play';
      play.innerHTML = compact ? icon(state.playing ? '<path d="M7 4v12M13 4v12"/>' : '<path d="m6 4 9 6-9 6Z"/>') : (state.playing ? 'Pause' : 'Play');
    }
    if (compact) {
      reset.innerHTML = icon('<path d="M7 3H3v4M13 3h4v4M3 13v4h4M17 13v4h-4"/>');
      reset.title = 'Fit camera view'; reset.setAttribute('aria-label', reset.title);
      clock.hidden = true;
      const gear = create('button', 'camera-viewer-button'); gear.type = 'button';
      gear.title = 'Camera options'; gear.setAttribute('aria-label', gear.title);
      gear.innerHTML = icon('<circle cx="10" cy="10" r="3"/><path d="M10 2v3M10 15v3M2 10h3M15 10h3M4 4l2 2M14 14l2 2M4 16l2-2M14 6l2-2"/>');
      gear.addEventListener('click', () => { header.hidden = !header.hidden; gear.setAttribute('aria-expanded', String(!header.hidden)); });
      toolbar.append(gear);
    }
    root.append(header, canvas, toolbar, detail);
    let width = 640, height = 360, raf = null, previousTime = null, selected = null, videoCallback = null;
    let hits = [], targetPoint = null, targetImage = null, queryFrames = [];
    let hoveredContexts = new Set(), targetHovered = false;
    const pointers = new Map();
    let gestureDistance = null;
    const contextImages = new Map();
    const contextViewports = new Map();
    const referenceVideos = new Set();
    const referenceListeners = new Map();
    const loadingImages = new Set();
    for (const reference of settings.references || []) {
      if (reference.type === 'video' && reference.source_id && reference.element &&
          (!reference.purpose || ['raw', 'experimental_scene_rgb'].includes(reference.purpose))) {
        contextImages.set(reference.source_id, reference.element);
        contextViewports.set(reference.source_id, reference.viewport);
        referenceVideos.add(reference.element);
        const loaded = () => syncVideo(state.time);
        reference.element.addEventListener('loadeddata', loaded);
        reference.element.addEventListener('seeked', loaded);
        referenceListeners.set(reference.element, loaded);
        continue;
      }
      if (reference.type !== 'image' || !reference.source_id || loadingImages.has(reference.source_id) ||
          (reference.purpose && !['raw', 'experimental_scene_rgb'].includes(reference.purpose))) continue;
      loadingImages.add(reference.source_id);
      const image = new global.Image(); image.crossOrigin = 'anonymous';
      let textureUrl = null;
      const release = () => { if (textureUrl) { global.URL.revokeObjectURL(textureUrl); textureUrl = null; } };
      image.onload = () => { contextImages.set(reference.source_id, image); release(); draw(); };
      image.onerror = release;
      if (new global.URL(reference.url, global.location.href).hostname.endsWith('.amazonaws.com')) {
        // A thumbnail's earlier no-CORS response can lack S3's Origin header.
        // Fetch the camera texture with Origin and bypass that browser cache entry.
        global.fetch(reference.url, {mode: 'cors', cache: 'no-store'})
          .then(response => { if (!response.ok) throw new Error('Camera texture unavailable'); return response.blob(); })
          .then(blob => { textureUrl = global.URL.createObjectURL(blob); image.src = textureUrl; })
          .catch(error => { release(); console.warn('Camera texture could not load', error.message); });
      } else image.src = reference.url;
    }

    function toggle(key, label, color) {
      const control = create('label', 'camera-viewer-toggle');
      const input = create('input'); input.type = 'checkbox'; input.checked = state[key];
      const dot = create('span', 'camera-viewer-dot'); dot.style.background = color;
      control.append(input, dot, create('span', '', label)); options.append(control);
      input.addEventListener('change', () => { state[key] = input.checked; draw(); });
    }
    toggle('contexts', 'Context', '#58c4dd');
    toggle('targetPath', 'Target', '#ff862f');
    toggle('frustums', 'Frustums', '#bdc8dd');
    if (data.geometry?.edges?.length) toggle('geometry', 'Geometry', '#8190a8');

    const mode = create('select', 'camera-viewer-button');
    mode.setAttribute('aria-label', 'Camera view mode');
    for (const value of ['chase', 'orbit']) {
      const option = create('option', '', value === 'chase' ? 'Chase' : 'Orbit'); option.value = value; mode.append(option);
    }
    mode.value = state.mode; options.append(mode);
    mode.addEventListener('change', () => { state.mode = mode.value; draw(); });

    function view() {
      let eye, forward, right, up;
      if (state.mode === 'chase') {
        const active = frameAt(frames, state.time), corners = frustumVertices(active, extent * 0.08).slice(1);
        const span = Math.max(Math.hypot(...sub(corners[1], corners[0])), Math.hypot(...sub(corners[3], corners[0])));
        ({eye, forward, right, up} = chaseBasis(active, span * (settings.chaseDistanceMultiple ?? 3.4) * state.distance / home.distance, settings.chaseFraming));
      } else {
        const offset = add(add(scale(gridRight, Math.cos(state.pitch) * Math.sin(state.yaw)),
          scale(gridForward, Math.cos(state.pitch) * Math.cos(state.yaw))), scale(worldUp, Math.sin(state.pitch)));
        eye = add(state.target, scale(offset, state.distance));
        forward = unit(sub(state.target, eye));
        right = unit(cross(forward, worldUp));
        up = cross(right, forward);
      }
      // Fit the shorter viewport dimension with one scale for both axes.
      const focal = Math.min(width, height) * 0.85;
      return point => {
        const relative = sub(point, eye), depth = dot(relative, forward);
        if (depth <= extent * 0.002) return null;
        return [width / 2 + dot(relative, right) * focal / depth,
          height / 2 - dot(relative, up) * focal / depth];
      };
    }

    function draw() {
      const project = view();
      context.clearRect(0, 0, width, height);
      context.fillStyle = light ? '#ffffff' : '#0e1522'; context.fillRect(0, 0, width, height);
      const segment = (a, b, color, lineWidth = 1) => {
        const from = project(a), to = project(b);
        if (!from || !to) return;
        context.strokeStyle = color; context.lineWidth = lineWidth;
        context.beginPath(); context.moveTo(...from); context.lineTo(...to); context.stroke();
      };
      if (light) {
        const step = extent / 12;
        const gridPoint = (x, y) => add(add(floorOrigin, scale(gridRight, x)), scale(gridForward, y));
        for (let index = -12; index <= 12; index++) {
          const offset = index * step;
          const a = gridPoint(offset, -extent), b = gridPoint(offset, extent);
          const c = gridPoint(-extent, offset), d = gridPoint(extent, offset);
          segment(a, b, '#edf0f5'); segment(c, d, '#edf0f5');
        }
      }
      if (state.geometry) {
        for (const edge of data.geometry.edges) segment(edge[0], edge[1], light ? '#b4bdc95a' : '#8090a840');
      }
      for (const [axis, color, label] of (compact ? [] : [[[1, 0, 0], '#fa8585', 'X'], [[0, 1, 0], '#8ccf9c', 'Y'], [[0, 0, 1], '#82aaff', 'Z']])) {
        const end = add(state.target, scale(axis, extent * 0.18));
        segment(state.target, end, color);
        const point = project(end);
        if (point) { context.fillStyle = color; context.font = '11px ' + getComputedStyle(canvas).fontFamily; context.fillText(label, point[0] + 4, point[1]); }
      }
      const path = (track, color) => {
        context.strokeStyle = color; context.lineWidth = 1.6; context.beginPath();
        let connected = false;
        for (const frame of track) {
          const point = project(center(frame));
          if (!point) { connected = false; continue; }
          if (connected) context.lineTo(...point);
          else context.moveTo(...point);
          connected = true;
        }
        context.stroke();
      };
      const frustum = (frame, color, depth, lineWidth = 1) => {
        const vertices = frustumVertices(frame, depth);
        for (let index = 1; index <= 4; index++) {
          segment(vertices[0], vertices[index], color, lineWidth);
          segment(vertices[index], vertices[index % 4 + 1], color, lineWidth);
        }
      };
      function imagePlane(frame, image, depth, viewport) {
        if (image.tagName === 'VIDEO' && image.readyState < 2) return;
        const imageWidth = image.videoWidth || image.naturalWidth;
        const imageHeight = image.videoHeight || image.naturalHeight;
        if (!imageWidth || !imageHeight) return;
        const vertices = frustumVertices(frame, depth).slice(1).map(project);
        if (vertices.some(vertex => !vertex)) return;
        const [x, y, w, h] = viewport || [0, 0, imageWidth, imageHeight];
        const source = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
        for (const indices of [[0, 1, 2], [0, 2, 3]]) {
          const [s0, s1, s2] = indices.map(index => source[index]);
          const [d0, d1, d2] = indices.map(index => vertices[index]);
          const u1 = s1[0] - s0[0], v1 = s1[1] - s0[1], u2 = s2[0] - s0[0], v2 = s2[1] - s0[1];
          const determinant = u1 * v2 - u2 * v1;
          const a = ((d1[0] - d0[0]) * v2 - (d2[0] - d0[0]) * v1) / determinant;
          const c = (u1 * (d2[0] - d0[0]) - u2 * (d1[0] - d0[0])) / determinant;
          const b = ((d1[1] - d0[1]) * v2 - (d2[1] - d0[1]) * v1) / determinant;
          const d = (u1 * (d2[1] - d0[1]) - u2 * (d1[1] - d0[1])) / determinant;
          context.save(); context.beginPath(); context.moveTo(...d0); context.lineTo(...d1); context.lineTo(...d2); context.closePath(); context.clip();
          context.transform(a, b, c, d, d0[0] - a * s0[0] - c * s0[1], d0[1] - b * s0[0] - d * s0[1]);
          context.drawImage(image, 0, 0); context.restore();
        }
      }
      hits = [];
      if (state.contexts) {
        for (const track of data.contexts) {
          const grouped = track.kind === 'segment';
          const highlighted = hoveredContexts.has(track.id);
          if (grouped) {
            const groupColor = track.color || '#ff862f66';
            path(track.frames, groupColor);
            // Connect matching image-plane corners along the actual camera poses.
            const vertices = track.frames.map(frame => frustumVertices(frame, extent * 0.08));
            for (let i = 1; i < vertices.length; i++) {
              for (let corner = 1; corner <= 4; corner++) {
                segment(vertices[i - 1][corner], vertices[i][corner], groupColor, highlighted ? 1.4 : 0.6);
              }
            }
          }
          if (track.kind === 'video') path(track.frames, light ? '#58c4dd88' : '#58c4dd77');
          const representative = grouped ? track.frames.filter((frame, i) =>
            i % 4 === 3 || i === track.frames.length - 1 || track.frameColors?.[frame.id]) : track.frames;
          const visibleFrames = track.kind === 'video' ? [frameAt(track.frames, state.time)] : representative;
          for (const frame of visibleFrames) {
            const color = track.frameColors?.[frame.id] || (grouped ? track.baseColor : track.color);
            const point = project(center(frame));
            if (point) {
              context.fillStyle = color || (light ? '#58c4dd' : '#58c4dd'); context.beginPath(); context.arc(...point, 2.6, 0, Math.PI * 2); context.fill();
              hits.push({point, track, frame, vertices: state.frustums ? frustumVertices(frame, extent * 0.08).map(project) : []});
            }
            if (state.frustums) {
              const image = contextImages.get(track.id);
              if (image && (image.tagName !== 'VIDEO' || image.readyState >= 2)) {
                imagePlane(frame, image, extent * 0.08, contextViewports.get(track.id));
              }
              frustum(frame, highlighted ? (settings.highlightColor || '#58c4dd') : (color || (light ? '#58c4ddaa' : '#58c4dd90')), extent * 0.08, highlighted ? 2.8 : 1);
            }
          }
        }
      }
      if (state.targetPath) {
        if (light) context.setLineDash([3, 4]);
        path(frames, light ? '#ff862f' : '#ff862faa');
        if (light) context.setLineDash([]);
        if (state.frustums) {
          const stride = Math.max(1, Math.ceil(frames.length / 20));
          if (!compact) for (let index = 0; index < frames.length; index += stride) frustum(frames[index], '#ff862f30', extent * 0.04);
        }
        const active = frameAt(frames, state.time);
        targetPoint = project(center(active));
        if (queryFrames.length) {
          context.setLineDash([4, 3]);
          for (const frame of queryFrames) frustum(frame, '#ff862f', extent * 0.08, 1.6);
          context.setLineDash([]);
        }
        if (targetImage) imagePlane(active, targetImage, extent * 0.08);
        if (video && video.readyState >= 2) imagePlane(active, video, extent * 0.08, settings.videoViewport);
        if (targetImage || video || !queryFrames.length) frustum(active, targetHovered ? '#ff862f' : (settings.targetColor || (light ? '#ff862f' : '#ff862f')), extent * 0.08, targetHovered ? 3.2 : 2);
      }
      if (selected) frustum(selected.frame, light ? '#58c4dd' : '#58c4dd', extent * 0.08, 2);
      scrub.value = String(state.time); clock.textContent = state.time.toFixed(2) + ' s';
      scrub.setAttribute('aria-valuetext', clock.textContent);
      root.setAttribute('data-frame-time', String(state.time));
      root.setAttribute('data-highlighted-contexts', [...hoveredContexts].join(','));
      root.setAttribute('data-query-count', String(queryFrames.length));
      root.setAttribute('data-segment-count', String(data.contexts.filter(track => track.kind === 'segment').length));
      root.setAttribute('data-stored-frame-count', String(data.contexts.reduce((sum, track) => sum + track.frames.length, 0)));
      root.setAttribute('data-target-frame-count', String(frames.length));
      root.setAttribute('data-floor-level', String(floorLevel));
      root.setAttribute('data-floor-up', JSON.stringify(worldUp));
    }

    function resize() {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width); height = Math.max(1, bounds.height);
      const ratio = Math.min(global.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0); draw();
    }
    function animate(now) {
      if (!state.playing) { raf = null; previousTime = null; return; }
      state.time = video ? Math.max(0, Math.min(video.currentTime || 0, frames.at(-1).time))
        : (state.time + (previousTime === null ? 0 : (now - previousTime) / 1000)) % duration;
      previousTime = now; draw(); raf = global.requestAnimationFrame(animate);
    }
    function syncVideo(time = video.currentTime || 0) {
      state.time = Math.max(0, Math.min(time, frames.at(-1).time));
      state.playing = !video.paused && !video.ended;
      for (const reference of referenceVideos) {
        if (!Number.isFinite(reference.duration)) continue;
        const desired = Math.min(state.time, Math.max(0, reference.duration - 1 / 30));
        if (Math.abs(reference.currentTime - desired) > (state.playing ? 0.08 : 0.001)) reference.currentTime = desired;
        reference.playbackRate = video.playbackRate || 1;
        if (state.playing && reference.paused) reference.play().catch(() => {});
        else if (!state.playing && !reference.paused) reference.pause();
      }
      playLabel();
      play.setAttribute('aria-pressed', String(state.playing));
      draw();
      if (state.playing && !video.requestVideoFrameCallback && raf === null) raf = global.requestAnimationFrame(animate);
    }
    const mediaEvents = ['play', 'pause', 'seeking', 'seeked', 'loadedmetadata', 'timeupdate', 'ratechange', 'ended'];
    const mediaListener = event => {
      const presentedClock = video.requestVideoFrameCallback &&
        ['play', 'pause', 'timeupdate', 'ratechange'].includes(event?.type);
      syncVideo(presentedClock ? state.time : video.currentTime || 0);
    };
    function presentedFrame(now, metadata) {
      syncVideo(metadata.mediaTime);
      videoCallback = video.requestVideoFrameCallback(presentedFrame);
    }
    if (video) {
      mediaEvents.forEach(event => video.addEventListener(event, mediaListener));
      if (video.requestVideoFrameCallback) videoCallback = video.requestVideoFrameCallback(presentedFrame);
    }
    play.addEventListener('click', () => {
      if (settings.onPlaybackToggle) { settings.onPlaybackToggle(); return; }
      if (video) {
        if (video.paused) video.play().then(() => syncVideo()).catch(() => syncVideo());
        else { video.pause(); syncVideo(); }
        return;
      }
      state.playing = !state.playing; playLabel();
      play.setAttribute('aria-pressed', String(state.playing));
      if (state.playing && raf === null) raf = global.requestAnimationFrame(animate);
    });
    scrub.addEventListener('input', () => {
      state.time = Math.min(Number(scrub.value), frames.at(-1).time);
      if (video) video.currentTime = state.time;
      draw();
    });
    function fit() { Object.assign(state, home, {target: [...home.target]}); mode.value = state.mode; selected = null; draw(); }
    reset.addEventListener('click', fit); canvas.addEventListener('dblclick', fit);
    canvas.addEventListener('wheel', event => {
      event.preventDefault(); state.distance = Math.min(extent * 50, Math.max(extent * 0.06, state.distance * Math.exp(event.deltaY * 0.001))); draw();
    }, {passive: false});
    canvas.addEventListener('pointerdown', event => {
      canvas.setPointerCapture(event.pointerId); pointers.set(event.pointerId, {x: event.clientX, y: event.clientY, moved: 0});
      gestureDistance = null;
    });
    canvas.addEventListener('pointermove', event => {
      const prior = pointers.get(event.pointerId);
      if (!prior) return;
      const dx = event.clientX - prior.x, dy = event.clientY - prior.y;
      pointers.set(event.pointerId, {x: event.clientX, y: event.clientY, moved: prior.moved + Math.abs(dx) + Math.abs(dy)});
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (gestureDistance !== null && distance > 0) state.distance *= gestureDistance / distance;
        gestureDistance = distance;
      } else if (event.shiftKey || event.buttons === 2) {
        state.mode = 'orbit'; mode.value = 'orbit';
        state.target = add(state.target, [-(dx / width) * state.distance, (dy / height) * state.distance, 0]);
      } else {
        state.mode = 'orbit'; mode.value = 'orbit';
        state.yaw -= dx * 0.007;
        state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch + dy * 0.007));
      }
      draw();
    });
    function pickContext(point) {
      const edgeDistance = (a, b) => {
        const ab = sub(b, a), ap = sub(point, a), length = dot(ab, ab);
        const t = length ? Math.max(0, Math.min(1, dot(ap, ab) / length)) : 0;
        return Math.hypot(...sub(ap, scale(ab, t)));
      };
      const contains = polygon => {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
          const a = polygon[i], b = polygon[j];
          if ((a[1] > point[1]) !== (b[1] > point[1]) &&
              point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        return inside;
      };
      let closest = null, best = Infinity;
      for (const hit of hits) {
        const distance = Math.hypot(...sub(point, hit.point));
        const vertices = hit.vertices;
        const plane = vertices.length === 5 && vertices.every(Boolean) ? vertices.slice(1) : [];
        const onFrustum = plane.length && (contains(plane) || plane.some((v, i) =>
          Math.min(edgeDistance(vertices[0], v), edgeDistance(v, plane[(i + 1) % 4])) < 5));
        if ((distance < 10 || onFrustum) && distance < best) { closest = hit; best = distance; }
      }
      return closest;
    }
    canvas.addEventListener('pointerup', event => {
      const prior = pointers.get(event.pointerId); pointers.delete(event.pointerId); gestureDistance = null;
      if (prior && prior.moved < 4) {
        const bounds = canvas.getBoundingClientRect();
        const point = [event.clientX - bounds.left, event.clientY - bounds.top];
        selected = pickContext(point);
        detail.textContent = selected ? selected.track.id + ' · source time ' + (selected.frame.source_time ?? selected.frame.time).toFixed(2) + ' s'
          : 'Drag to orbit · Shift-drag to pan · Scroll to zoom';
        draw();
        if (selected) settings.onSelectContext?.({id: selected.track.id, source_id: selected.track.source_id || selected.track.id, frame: selected.frame});
      }
    });
    canvas.addEventListener('pointercancel', event => { pointers.delete(event.pointerId); gestureDistance = null; });
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);
    if (!observer) global.addEventListener('resize', resize);
    resize();
    playLabel();
    if (video) syncVideo();
    return {setPlaybackState: value => { state.playing = Boolean(value); playLabel(); play.setAttribute('aria-pressed', String(state.playing)); },
      addContext: (track, reference) => {
        if (data.contexts.some(item => item.id === track.id)) return Promise.resolve();
        validateData({...data, contexts: [track]});
        data.contexts.push(track);
        if (!reference?.url) { draw(); return Promise.resolve(); }
        return new Promise((resolve, reject) => {
          const image = new global.Image();
          image.onload = () => { contextImages.set(track.id, image); draw(); resolve(); };
          image.onerror = () => reject(new Error('Spatial context image could not load'));
          image.src = reference.url;
        });
      },
      setTime: time => { state.time = Math.max(0, Math.min(time, frames.at(-1).time)); if (video) video.currentTime = state.time; draw(); },
      setQueryFrames: value => { queryFrames = value || []; draw(); },
      setContextColors: colors => {
        for (const track of data.contexts) {
          track.baseColor ??= track.color;
          track.frameColors = colors;
          const activeColors = track.kind === 'segment' ? track.frames.map(frame => colors[frame.id]).filter(Boolean) : [];
          track.color = colors[track.id] || activeColors[0] || track.baseColor;
        }
        draw();
      },
      getContextPoint: id => {
        const track = data.contexts.find(track => track.id === id || track.frames.some(frame => frame.id === id));
        const frame = track?.frames.find(frame => frame.id === id) || track?.frames[0];
        const point = frame ? view()(center(frame)) : null;
        const bounds = canvas.getBoundingClientRect();
        return point ? {x: bounds.left + point[0], y: bounds.top + point[1]} : null;
      },
      getTargetPoint: () => {
        const bounds = canvas.getBoundingClientRect();
        return targetPoint ? {x: bounds.left + targetPoint[0], y: bounds.top + targetPoint[1]} : null;
      },
      setTargetImage: url => {
        if (!url) { targetImage = null; draw(); return Promise.resolve(); }
        return new Promise((resolve, reject) => {
          const image = new global.Image();
          image.onload = () => { targetImage = image; draw(); resolve(); };
          image.onerror = () => reject(new Error('Output image could not load'));
          image.src = url;
        });
      },
      setTargetImageElement: image => { targetImage = image; draw(); },
      setContextImageElement: (id, image) => {
        if (settings.singleContextImage) contextImages.clear();
        if (id && image) contextImages.set(id, image);
        draw();
      },
      getFrame: () => frameAt(frames, state.time),
      getMode: () => state.mode,
      highlightContext: selection => { hoveredContexts = new Set(contextIds(data, selection)); draw(); },
      highlightTarget: value => { targetHovered = Boolean(value); draw(); },
      getHighlightedContexts: () => [...hoveredContexts],
      dispose: () => {
        state.playing = false; if (raf !== null) global.cancelAnimationFrame(raf); observer?.disconnect();
        for (const [reference, loaded] of referenceListeners) {
          reference.removeEventListener('loadeddata', loaded);
          reference.removeEventListener('seeked', loaded);
        }
        if (video) { mediaEvents.forEach(event => video.removeEventListener(event, mediaListener));
          if (videoCallback !== null) video.cancelVideoFrameCallback(videoCallback); }
      }};
  }
  global.AVMCameraViewer = {mount, validateData, frustumVertices, frameAt, chaseBasis, contextIds};
})(globalThis);
