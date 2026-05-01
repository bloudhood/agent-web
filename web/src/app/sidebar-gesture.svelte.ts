export const SIDEBAR_DRAWER_WIDTH = 320;
export const SIDEBAR_GESTURE_EDGE_OFFSET = 12;
export const SIDEBAR_GESTURE_EDGE_WIDTH = 84;
export const SIDEBAR_GESTURE_THRESHOLD = 72;

const SIDEBAR_GESTURE_VELOCITY = 0.45;
const SIDEBAR_GESTURE_SLOP = 6;
const SIDEBAR_SETTLE_MS = 320;
const SCRIM_CLICK_SUPPRESS_MS = 160;

type SidebarGestureMode = 'opening' | 'closing';
type SidebarGestureIntent = 'pending' | 'horizontal';

interface SidebarGestureOptions {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  isBlocked?: () => boolean;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isPrimaryPointer(e: PointerEvent) {
  return e.pointerType !== 'mouse' || e.button === 0;
}

function pointerTarget(e: PointerEvent) {
  return e.currentTarget instanceof HTMLElement ? e.currentTarget : null;
}

export function createSidebarGesture({ isOpen, open, close, isBlocked }: SidebarGestureOptions) {
  let pointerId = $state<number | null>(null);
  let mode = $state<SidebarGestureMode | null>(null);
  let intent = $state<SidebarGestureIntent>('pending');
  let startX = $state(0);
  let startY = $state(0);
  let lastX = $state(0);
  let lastTime = $state(0);
  let offset = $state(0);
  let velocity = $state(0);
  let active = $state(false);
  let settling = $state(false);
  let suppressNextClick = $state(false);
  let settleTimer: number | null = null;
  let suppressTimer: number | null = null;

  const progress = $derived.by(() => {
    if (!active || !mode) return isOpen() ? 1 : 0;
    if (mode === 'opening') return clamp(offset / SIDEBAR_DRAWER_WIDTH, 0, 1);
    return clamp(1 + offset / SIDEBAR_DRAWER_WIDTH, 0, 1);
  });

  function begin(e: PointerEvent, nextMode: SidebarGestureMode) {
    if (isBlocked?.() || !isPrimaryPointer(e)) return;
    clearSettleTimer();
    pointerId = e.pointerId;
    mode = nextMode;
    intent = 'pending';
    startX = e.clientX;
    startY = e.clientY;
    lastX = e.clientX;
    lastTime = performance.now();
    offset = 0;
    velocity = 0;
    active = false;
  }

  function release(e: PointerEvent) {
    const target = pointerTarget(e);
    if (target?.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
  }

  function reset() {
    pointerId = null;
    mode = null;
    intent = 'pending';
    offset = 0;
    velocity = 0;
    active = false;
  }

  function clearSettleTimer() {
    if (settleTimer != null) window.clearTimeout(settleTimer);
    settleTimer = null;
    settling = false;
  }

  function settleSidebarGesture(nextOpen: boolean) {
    if (nextOpen) open();
    else close();
    settling = true;
    reset();
    if (settleTimer != null) window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      settling = false;
      settleTimer = null;
    }, SIDEBAR_SETTLE_MS);
  }

  function suppressScrimClickOnce() {
    suppressNextClick = true;
    if (suppressTimer != null) window.clearTimeout(suppressTimer);
    suppressTimer = window.setTimeout(() => {
      suppressNextClick = false;
      suppressTimer = null;
    }, SCRIM_CLICK_SUPPRESS_MS);
  }

  function cancel(e: PointerEvent) {
    release(e);
    reset();
  }

  function pointerMove(e: PointerEvent) {
    if (pointerId == null || e.pointerId !== pointerId || !mode) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (intent === 'pending') {
      if (absX < SIDEBAR_GESTURE_SLOP && absY < SIDEBAR_GESTURE_SLOP) return;
      if (absY > absX) {
        cancel(e);
        return;
      }
      intent = 'horizontal';
      const target = pointerTarget(e);
      if (target && !target.hasPointerCapture(e.pointerId)) {
        target.setPointerCapture(e.pointerId);
      }
      active = true;
    }

    if (e.cancelable) e.preventDefault();
    const now = performance.now();
    velocity = (e.clientX - lastX) / Math.max(now - lastTime, 1);
    lastX = e.clientX;
    lastTime = now;
    offset = mode === 'opening'
      ? clamp(dx, 0, SIDEBAR_DRAWER_WIDTH)
      : clamp(dx, -SIDEBAR_DRAWER_WIDTH, 0);
  }

  function pointerUp(e: PointerEvent) {
    if (pointerId == null || e.pointerId !== pointerId) return;
    const endedMode = mode;
    const endedIntent = intent;
    const endedOffset = offset;
    const endedVelocity = velocity;
    release(e);
    if (endedIntent !== 'horizontal') {
      reset();
      return;
    }

    if (endedMode === 'opening') {
      settleSidebarGesture(endedOffset > SIDEBAR_GESTURE_THRESHOLD || endedVelocity > SIDEBAR_GESTURE_VELOCITY);
      return;
    }

    if (endedMode === 'closing') {
      suppressScrimClickOnce();
      settleSidebarGesture(!(endedOffset < -SIDEBAR_GESTURE_THRESHOLD || endedVelocity < -SIDEBAR_GESTURE_VELOCITY));
    }
  }

  function pointerCancel(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    cancel(e);
  }

  function edgePointerDown(e: PointerEvent) {
    if (isOpen()) return;
    begin(e, 'opening');
  }

  function rootPointerDown(e: PointerEvent) {
    if (isOpen()) return;
    const inEdgeZone = e.clientX >= SIDEBAR_GESTURE_EDGE_OFFSET
      && e.clientX <= SIDEBAR_GESTURE_EDGE_OFFSET + SIDEBAR_GESTURE_EDGE_WIDTH;
    if (!inEdgeZone) return;
    begin(e, 'opening');
  }

  function drawerPointerDown(e: PointerEvent) {
    if (!isOpen()) return;
    begin(e, 'closing');
  }

  function scrimClick(e: MouseEvent) {
    if (suppressNextClick) {
      suppressNextClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    close();
  }

  return {
    edgeOffset: SIDEBAR_GESTURE_EDGE_OFFSET,
    edgeWidth: SIDEBAR_GESTURE_EDGE_WIDTH,
    get active() { return active; },
    get drawerStyle() { return `transform: translate3d(${(progress - 1) * 100}%, 0, 0);`; },
    get scrimStyle() { return `opacity: ${Math.min(progress * 0.92, 0.92)};`; },
    get showScrim() { return isOpen() || active || settling || progress > 0; },
    drawerPointerDown,
    edgePointerDown,
    pointerCancel,
    pointerMove,
    pointerUp,
    rootPointerDown,
    scrimClick,
  };
}
