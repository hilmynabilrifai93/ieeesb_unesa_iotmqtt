// Keep native taps/keyboard navigation; commit a horizontal drag only on release.
export function installGlassDrag(container, itemSelector, property) {
  const items = [...container.querySelectorAll(itemSelector)];
  let gesture = null;
  let suppressClick = false;
  const activeIndex = () => Math.max(0, items.findIndex(item => item.matches('[aria-current="page"], [aria-pressed="true"]')));
  const indexAt = (x) => {
    const first = items[0].getBoundingClientRect();
    const last = items.at(-1).getBoundingClientRect();
    const start = first.left + first.width / 2;
    const end = last.left + last.width / 2;
    return Math.max(0, Math.min(items.length - 1, (x - start) / (end - start) * (items.length - 1)));
  };
  const finish = (index = activeIndex()) => {
    const pointerId = gesture?.id;
    gesture = null;
    container.classList.remove('is-dragging');
    container.style.setProperty(property, index);
    if (pointerId !== undefined && container.hasPointerCapture(pointerId)) container.releasePointerCapture(pointerId);
  };
  container.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || gesture) return;
    suppressClick = false;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
  });
  container.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = Math.abs(event.clientX - gesture.x);
    const dy = Math.abs(event.clientY - gesture.y);
    if (!gesture.dragging) {
      // Let the browser handle vertical scrolling without changing selection.
      if (dy > 8 && dy > dx) { finish(); return; }
      if (dx < 8 || dx <= dy) return;
      gesture.dragging = true;
      container.setPointerCapture(event.pointerId);
      container.classList.add('is-dragging');
    }
    event.preventDefault();
    container.style.setProperty(property, indexAt(event.clientX));
  });
  container.addEventListener('pointerup', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (!gesture.dragging) { finish(); return; }
    const index = Math.round(indexAt(event.clientX));
    suppressClick = true;
    finish(index);
    // Existing click/hash handlers own mode lifecycle and page rendering.
    items[index].click();
  });
  const cancel = event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    suppressClick = gesture.dragging;
    finish();
  };
  container.addEventListener('pointercancel', cancel);
  container.addEventListener('lostpointercapture', event => {
    // Touch begins with implicit capture on the child; moving capture to the
    // container must not be mistaken for cancellation of the drag.
    if (event.target === container) cancel(event);
  });
  container.addEventListener('dragstart', event => event.preventDefault());
  container.addEventListener('click', event => {
    if (!suppressClick || !event.isTrusted || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}
