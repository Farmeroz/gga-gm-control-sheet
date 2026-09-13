const names = ['Characters', 'Group actions', 'Latest GM results'];

function proportions(values) {
  if (!Array.isArray(values) || values.length !== 3 || values.some(n => typeof n !== 'number' || !Number.isFinite(n) || n <= 0)) return null;
  const total = values.reduce((a, b) => a + b, 0);
  return Number.isFinite(total) ? values.map(n => n / total) : null;
}

// Keep every section usable when a saved arrangement meets a smaller window.
function fitHeights(wanted, minimum, total) {
  const scale = total / wanted.reduce((a, b) => a + b, 0);
  const heights = wanted.map((n, i) => Math.max(minimum[i], n * scale));
  const excess = heights.reduce((a, b) => a + b, 0) - total;
  const room = heights.reduce((sum, n, i) => sum + n - minimum[i], 0);
  return room > 0 ? heights.map((n, i) => n - Math.max(0, excess) * (n - minimum[i]) / room) : heights;
}

export class SectionLayout {
  constructor(root, sizes, onChange, onEnd) {
    this.root = root;
    this.panels = Array.from(root.querySelectorAll(':scope > [data-section]'));
    this.dividers = Array.from(root.querySelectorAll(':scope > [data-divider]'));
    this.preferred = proportions(sizes);
    this.onChange = onChange;
    this.onEnd = onEnd;
    this.listeners = new AbortController();
    const options = {signal: this.listeners.signal};
    for (const [index, divider] of this.dividers.entries()) {
      divider.addEventListener('pointerdown', event => this.start(event, index), options);
      divider.addEventListener('pointermove', event => this.move(event), options);
      divider.addEventListener('pointerup', event => {
        if (event.pointerId === this.drag?.pointerId) this.finish();
      }, options);
      divider.addEventListener('pointercancel', () => this.finish(true), options);
      divider.addEventListener('lostpointercapture', () => this.finish(), options);
      divider.addEventListener('keydown', event => this.key(event, index), options);
    }
    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(root);
    // A narrower window can wrap the fixed headings onto another line.
    for (const panel of this.panels.slice(1)) this.observer.observe(panel.querySelector('.gcs-action-title'));
    this.frame = requestAnimationFrame(() => this.layout());
  }
  get dragging() {return !!this.drag;}
  measureMinimum() {
    return [92, ...this.panels.slice(1).map(panel => panel.querySelector('.gcs-action-title').getBoundingClientRect().height + 44)];
  }
  heights() {return this.panels.map(panel => panel.getBoundingClientRect().height);}
  layout() {
    if (this.drag || this.destroyed || !this.root.isConnected) return;
    this.minimum = this.measureMinimum();
    const dividerHeight = this.dividers.reduce((sum, divider) => sum + divider.getBoundingClientRect().height, 0);
    const minTotal = this.minimum.reduce((a, b) => a + b, 0);
    this.root.style.minHeight = `${minTotal + dividerHeight}px`;
    const total = Math.max(minTotal, this.root.clientHeight - dividerHeight);
    let wanted = this.preferred?.map(n => n * total);
    if (!wanted) {
      const natural = this.panels.slice(1).map(panel => {
        const body = panel.querySelector('.gcs-section-body');
        const last = body.lastElementChild;
        const contentHeight = last.getBoundingClientRect().bottom - body.getBoundingClientRect().top + body.scrollTop;
        return panel.querySelector('.gcs-action-title').getBoundingClientRect().height + contentHeight + parseFloat(getComputedStyle(body).paddingBottom) + parseFloat(getComputedStyle(last).marginBottom);
      });
      const results = Math.max(this.minimum[2], Math.min(natural[1], this.root.clientWidth <= 740 ? 130 : 190));
      wanted = [Math.max(this.minimum[0], total - natural[0] - results), natural[0], results];
    }
    this.apply(fitHeights(wanted, this.minimum, total));
  }
  apply(heights) {
    heights.forEach((height, i) => {this.panels[i].style.flex = `0 0 ${height}px`;});
    this.dividers.forEach((divider, i) => {
      divider.setAttribute('aria-valuemin', Math.round(this.minimum[i]));
      divider.setAttribute('aria-valuemax', Math.round(heights[i] + heights[i + 1] - this.minimum[i + 1]));
      divider.setAttribute('aria-valuenow', Math.round(heights[i]));
      divider.setAttribute('aria-valuetext', `${names[i]} ${Math.round(heights[i])} pixels; ${names[i + 1]} ${Math.round(heights[i + 1])} pixels`);
    });
  }
  resize(index, heights, delta) {
    const next = [...heights];
    const movement = Math.max(this.minimum[index] - next[index], Math.min(delta, next[index + 1] - this.minimum[index + 1]));
    next[index] += movement;
    next[index + 1] -= movement;
    this.apply(next);
  }
  start(event, index) {
    if (event.button !== 0 || event.isPrimary === false || this.drag) return;
    event.preventDefault(); event.stopPropagation();
    this.layout();
    const divider = this.dividers[index];
    divider.focus({preventScroll: true});
    this.drag = {index, divider, pointerId: event.pointerId, y: event.clientY, heights: this.heights()};
    divider.setPointerCapture(event.pointerId);
    this.root.classList.add('gcs-resizing');
  }
  move(event) {
    if (event.pointerId !== this.drag?.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    this.resize(this.drag.index, this.drag.heights, event.clientY - this.drag.y);
  }
  commit() {
    this.preferred = proportions(this.heights());
    this.onChange(this.preferred);
  }
  finish(cancel = false) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (cancel) this.apply(drag.heights);
    else this.commit();
    this.root.classList.remove('gcs-resizing');
    if (drag.divider.hasPointerCapture(drag.pointerId)) drag.divider.releasePointerCapture(drag.pointerId);
    this.layout();
    if (!this.destroyed) this.onEnd();
  }
  key(event, index) {
    if (event.key === 'Escape' && this.drag) {event.preventDefault(); event.stopPropagation(); this.finish(true); return;}
    if (this.drag || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    this.layout();
    const delta = {ArrowUp: -10, ArrowDown: 10, Home: -Infinity, End: Infinity}[event.key];
    this.resize(index, this.heights(), delta * (event.shiftKey ? 4 : 1));
    this.commit();
  }
  destroy() {
    this.destroyed = true;
    this.finish();
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.listeners.abort();
  }
}
