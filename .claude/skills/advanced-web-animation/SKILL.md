---
name: advanced-web-animation
description: Use when designing or building animated website UI — page-load sequences, scroll reveals, hover/press micro-interactions, form feedback, loading states, route/page transitions, and motion systems. Covers motion tokens, CSS scroll-driven animations, the View Transitions API, Motion (Framer Motion) and GSAP, performance budgets, and reduced-motion accessibility.
---

# Advanced Web Animation

Motion on a website exists to do one of four jobs: **orient** (where did this come from / go to), **give feedback** (your click/input registered), **show hierarchy** (what to look at first), or **express brand** (feel premium, calm, fast). If an animation does none of these, delete it.

Project context: DriveEasy — a UAE car-rental site. Dark UI (`#0f1419`-ish background, deep green hero gradient), teal accent (`#2bb3a3`), rounded cards, Inter-style sans. Brand feel: **calm, confident, fast**. Motion should be smooth and short, never bouncy or playful.

---

## 1. Motion tokens (define once, use everywhere)

Never hard-code durations or easings in components. Put these on `:root`:

```css
:root {
  /* Durations */
  --dur-instant: 80ms;   /* press states, toggles */
  --dur-fast:   160ms;   /* hovers, focus rings, small fades */
  --dur-base:   240ms;   /* dropdowns, tooltips, cards */
  --dur-slow:   400ms;   /* modals, panels, hero elements */
  --dur-slower: 640ms;   /* page-load hero sequence only */

  /* Easings */
  --ease-out:    cubic-bezier(0.22, 1, 0.36, 1);   /* default for things ENTERING */
  --ease-in:     cubic-bezier(0.55, 0, 1, 0.45);   /* things LEAVING */
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);   /* things MOVING on screen */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);/* tiny overshoot — use sparingly */

  /* Distances */
  --rise-sm: 8px;
  --rise-md: 16px;
  --rise-lg: 32px;

  /* Stagger */
  --stagger: 60ms;
}
```

Rules:
- Enter = `--ease-out`. Exit = `--ease-in` and ~70% of the enter duration. Move = `--ease-in-out`.
- Larger distance or larger element → longer duration. Small UI never exceeds 240ms.
- Total page-load sequence finishes in **under 1.2s**. Users should never wait for animation to use the page.

---

## 2. Choose the lightest tool that works

Go down this ladder and stop at the first rung that solves it:

1. **CSS transitions** — hover, focus, active, open/closed state changes.
2. **CSS `@keyframes`** — load-in sequences, loaders, looping ambience.
3. **CSS scroll-driven animations** (`animation-timeline: view()` / `scroll()`) — reveals, progress bars, parallax. No JS. Feature-detect and fall back.
4. **View Transitions API** — page/route changes, list ↔ detail morphs (car card → car detail page).
5. **Motion (Framer Motion) for React** — layout animations, shared-element transitions, gestures, exit animations on unmount.
6. **GSAP + ScrollTrigger** — complex timelines, pinned storytelling sections, SVG path drawing, precise scrubbing.

Don't load GSAP for a fade-in. Don't build a pinned scroll story in raw CSS.

---

## 3. Performance rules (non-negotiable)

- Animate **only `transform` and `opacity`** (plus `filter` and `clip-path` with care). Never animate `width`, `height`, `top`, `left`, `margin`, `box-shadow` size on large elements — they trigger layout/paint.
  - Need a shadow to grow? Put the shadow on a `::after` pseudo-element and animate its `opacity`.
  - Need height to animate? Use `grid-template-rows: 0fr → 1fr`, or Motion's `layout`, or `interpolate-size: allow-keywords` where supported.
- `will-change` only on elements about to animate, and remove it after. Never `* { will-change: transform }`.
- Use `IntersectionObserver` (or scroll-driven CSS), never `scroll` event listeners that read layout.
- Batch DOM reads before writes; never read `offsetHeight` inside an animation loop.
- Target 60fps on a mid-range Android phone. Test with DevTools → Performance → CPU 4× slowdown.
- Large blurred glows: prefer a pre-blurred image or a `radial-gradient` over `filter: blur()` on big elements.
- Lazy-init heavy animation libraries only on pages that need them.

---

## 4. Accessibility (must ship with every animation)

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- Reduced motion means **replace movement with a fade**, not "remove all feedback". Keep opacity changes and focus rings.
- In JS: `const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;` and skip parallax, auto-scrolling, and large translations.
- In Motion: wrap the app in `<MotionConfig reducedMotion="user">`.
- Nothing flashes more than 3 times per second.
- Content must be readable and clickable **before** and **without** its animation. Never set content to `opacity: 0` in CSS that only JS can undo — if JS fails, the page is blank. Gate hidden initial states behind a class JS adds (`.js-anim`) or behind `@supports`.
- Auto-playing loops longer than 5s need a pause control.
- Focus states must be instantly visible (≤ `--dur-fast`), never delayed by a transition.

---

## 5. Pattern library

### 5.1 Page-load hero sequence (staggered rise)

```css
.js-anim .reveal {
  opacity: 0;
  transform: translateY(var(--rise-md));
  animation: rise var(--dur-slower) var(--ease-out) forwards;
  animation-delay: calc(var(--i, 0) * var(--stagger) + 100ms);
}
@keyframes rise { to { opacity: 1; transform: none; } }
```

```html
<span class="pill reveal" style="--i:0">Dubai · Abu Dhabi · Sharjah</span>
<h1 class="reveal" style="--i:1">Rent a car across the UAE, the easy way.</h1>
<p class="reveal" style="--i:2">Clear prices in AED…</p>
<ul class="reveal" style="--i:3">…ticks…</ul>
<form class="booking-card reveal" style="--i:2">…</form>
```

```js
document.documentElement.classList.add('js-anim');
```

Order: eyebrow pill → headline → subtext → feature ticks, with the booking card entering alongside the subtext from the right (`translateX(var(--rise-lg))`) so the eye lands on the primary action.

### 5.2 Headline word-by-word reveal (premium feel)

Split into words (not letters — letters hurt readability and screen readers):

```js
const h = document.querySelector('h1');
h.setAttribute('aria-label', h.textContent);
h.innerHTML = h.textContent.split(' ').map((w, i) =>
  `<span class="word" aria-hidden="true"><span style="--i:${i}">${w}</span></span>`
).join(' ');
```

```css
.word { display: inline-block; overflow: clip; vertical-align: top; }
.word > span {
  display: inline-block;
  transform: translateY(105%);
  animation: wordUp var(--dur-slow) var(--ease-out) forwards;
  animation-delay: calc(var(--i) * 45ms + 150ms);
}
@keyframes wordUp { to { transform: none; } }
```

### 5.3 Ambient hero background

Slow, almost invisible drift of the green gradient — adds life without distraction.

```css
.hero { position: relative; isolation: isolate; }
.hero::before {
  content: ""; position: absolute; inset: -20%; z-index: -1;
  background:
    radial-gradient(40% 50% at 20% 30%, rgb(43 179 163 / .18), transparent 70%),
    radial-gradient(35% 45% at 80% 20%, rgb(16 90 70 / .25), transparent 70%);
  animation: drift 24s var(--ease-in-out) infinite alternate;
}
@keyframes drift { to { transform: translate3d(3%, 4%, 0) scale(1.05); } }
@media (prefers-reduced-motion: reduce) { .hero::before { animation: none; } }
```

### 5.4 Buttons (hover, press, loading)

```css
.btn-primary {
  transition:
    transform var(--dur-instant) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out);
  position: relative; overflow: hidden;
}
.btn-primary:hover { background-color: color-mix(in oklab, var(--teal) 88%, white); }
.btn-primary:active { transform: scale(0.98); }

/* Sheen sweep on hover */
.btn-primary::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(110deg, transparent 30%, rgb(255 255 255 / .25) 50%, transparent 70%);
  transform: translateX(-100%);
}
.btn-primary:hover::after { transform: translateX(100%); transition: transform 700ms var(--ease-out); }

/* Loading state — keep width stable, swap label for spinner */
.btn-primary[aria-busy="true"] { pointer-events: none; }
.btn-primary[aria-busy="true"] .label { opacity: 0; }
.btn-primary[aria-busy="true"]::before {
  content: ""; position: absolute; inset: 0; margin: auto;
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid rgb(255 255 255 / .35); border-top-color: #fff;
  animation: spin 700ms linear infinite;
}
@keyframes spin { to { transform: rotate(1turn); } }
```

"Search cars" click → set `aria-busy="true"` immediately (feedback within 100ms), then navigate/fetch.

### 5.5 Form fields (booking card)

```css
.field {
  border: 1px solid var(--border);
  transition: border-color var(--dur-fast) var(--ease-out),
              box-shadow var(--dur-fast) var(--ease-out);
}
.field:hover { border-color: var(--border-strong); }
.field:focus-visible {
  border-color: var(--teal);
  box-shadow: 0 0 0 3px rgb(43 179 163 / .25);
  outline: none;
}

/* Validation shake — short, 2 cycles, horizontal only */
.field[aria-invalid="true"] { animation: shake 280ms var(--ease-in-out); border-color: var(--danger); }
@keyframes shake {
  25%, 75% { transform: translateX(-4px); }
  50%      { transform: translateX(4px); }
}
```

**Checkbox ("Return to a different branch") → reveal second branch field:**

```css
.checkbox svg path { stroke-dasharray: 20; stroke-dashoffset: 20;
  transition: stroke-dashoffset var(--dur-base) var(--ease-out); }
.checkbox input:checked + svg path { stroke-dashoffset: 0; }

.collapse {
  display: grid; grid-template-rows: 0fr; opacity: 0;
  transition: grid-template-rows var(--dur-base) var(--ease-out),
              opacity var(--dur-fast) var(--ease-out);
}
.collapse > * { overflow: hidden; }
.collapse.open { grid-template-rows: 1fr; opacity: 1; }
```

**Swap pick-up/return branches** (if you add a swap button): rotate the icon 180° and cross-fade the two values with a 6px vertical slide.

### 5.6 Dropdowns, date pickers, popovers

- Enter: `opacity 0→1`, `scale .96→1`, `translateY(-4px)→0`, `--dur-base`, `--ease-out`.
- `transform-origin` = the side attached to the trigger (top for a dropdown below the field).
- Exit: `--dur-fast`, `--ease-in`, no scale.
- With native `<dialog>`/`[popover]`, animate with `@starting-style` and `transition-behavior: allow-discrete`:

```css
[popover] {
  opacity: 1; transform: none;
  transition: opacity var(--dur-base) var(--ease-out),
              transform var(--dur-base) var(--ease-out),
              display var(--dur-base) allow-discrete,
              overlay var(--dur-base) allow-discrete;
}
@starting-style { [popover]:popover-open { opacity: 0; transform: translateY(-4px) scale(.96); } }
[popover]:not(:popover-open) { opacity: 0; transform: translateY(-4px) scale(.96); }
```

### 5.7 Scroll reveal ("Cars for every trip" section)

Pure CSS, with JS fallback:

```css
@supports (animation-timeline: view()) {
  .scroll-reveal {
    animation: rise linear both;
    animation-timeline: view();
    animation-range: entry 10% cover 30%;
  }
}
```

```js
if (!CSS.supports('animation-timeline: view()')) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { rootMargin: '0px 0px -10% 0px' });
  document.querySelectorAll('.scroll-reveal').forEach(el => io.observe(el));
}
```

```css
.js-anim .scroll-reveal:not(.in) { opacity: 0; transform: translateY(var(--rise-md)); }
.scroll-reveal { transition: opacity var(--dur-slow) var(--ease-out), transform var(--dur-slow) var(--ease-out); }
```

Stagger cards in a grid by column index (`--i: col`), not by overall index, so row 3 doesn't wait 600ms.

Reveal once. Never re-animate on scroll back up.

### 5.8 Car cards

```css
.car-card {
  transition: transform var(--dur-base) var(--ease-out), border-color var(--dur-fast);
  position: relative;
}
.car-card::after { /* shadow layer */
  content: ""; position: absolute; inset: 0; border-radius: inherit; z-index: -1;
  box-shadow: 0 20px 40px -12px rgb(0 0 0 / .6), 0 0 0 1px rgb(43 179 163 / .25);
  opacity: 0; transition: opacity var(--dur-base) var(--ease-out);
}
.car-card:hover { transform: translateY(-4px); border-color: rgb(43 179 163 / .4); }
.car-card:hover::after { opacity: 1; }
.car-card img { transition: transform var(--dur-slow) var(--ease-out); }
.car-card:hover img { transform: scale(1.04) translateX(2%); } /* car "rolls" forward slightly */
```

Optional cursor-follow spotlight (desktop only, `@media (hover: hover)`):

```js
card.addEventListener('pointermove', (e) => {
  const r = card.getBoundingClientRect();
  card.style.setProperty('--mx', `${e.clientX - r.left}px`);
  card.style.setProperty('--my', `${e.clientY - r.top}px`);
});
```
```css
.car-card { background:
  radial-gradient(300px circle at var(--mx, 50%) var(--my, 50%), rgb(43 179 163 / .08), transparent 60%),
  var(--card-bg); }
```

Skip 3D tilt on cards containing prices and text — it hurts legibility.

### 5.9 Search results loading

- Show **skeletons in the exact layout** of result cards within 100ms. Shimmer:

```css
.skeleton {
  background: linear-gradient(90deg, var(--sk-1) 0%, var(--sk-2) 50%, var(--sk-1) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.4s linear infinite;
}
@keyframes shimmer { to { background-position: -200% 0; } }
```

- When results arrive, cross-fade skeleton → card (no layout jump). Stagger the first 6 only.
- If a result loads in < 300ms, skip the skeleton entirely (delay showing it by 150ms) to avoid flicker.

### 5.10 Price changes

When dates or extras change the total, animate the number instead of snapping:

```js
function tweenNumber(el, to, ms = 400) {
  const from = parseFloat(el.dataset.value || 0);
  const start = performance.now();
  const fmt = new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 });
  const step = (t) => {
    const p = Math.min((t - start) / ms, 1);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt.format(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step); else el.dataset.value = to;
  };
  requestAnimationFrame(step);
}
```

Pair with `font-variant-numeric: tabular-nums;` so digits don't jitter. Add `aria-live="polite"` on the total.

### 5.11 Sticky nav on scroll

```css
@supports (animation-timeline: scroll()) {
  .nav {
    animation: navShrink linear both;
    animation-timeline: scroll();
    animation-range: 0 120px;
  }
  @keyframes navShrink {
    to { background: rgb(15 20 25 / .8); backdrop-filter: blur(12px);
         padding-block: 8px; border-bottom-color: rgb(255 255 255 / .08); }
  }
}
```

Hide-on-scroll-down / show-on-scroll-up only on mobile, using `translateY(-100%)`.

### 5.12 Page / route transitions (View Transitions API)

Multi-page site:
```css
@view-transition { navigation: auto; }
::view-transition-old(root) { animation: fadeOut var(--dur-fast) var(--ease-in) both; }
::view-transition-new(root) { animation: rise var(--dur-base) var(--ease-out) both; }
@keyframes fadeOut { to { opacity: 0; } }
```

Shared element — car card image morphs into the detail page hero:
```html
<!-- list page -->
<img src="..." style="view-transition-name: car-123">
<!-- detail page -->
<img src="..." style="view-transition-name: car-123">
```

SPA: `document.startViewTransition(() => updateDOM())`. Each `view-transition-name` must be unique on the page at once.

### 5.13 Toasts, modals, confirmation

- Toast: slide in from bottom 16px + fade, `--dur-base`; auto-dismiss 4–6s; pause timer on hover/focus.
- Modal: backdrop fades `--dur-base`; panel `scale(.96)→1` + fade. On mobile, bottom sheet slides up from `translateY(100%)`.
- Booking confirmed: one moment of delight is allowed — checkmark stroke-draw (`stroke-dashoffset`) + subtle `--ease-spring` scale on the voucher card. Once, not looping.

---

## 6. React + Motion recipes

```jsx
import { motion, AnimatePresence, MotionConfig, stagger } from "motion/react";

const ease = [0.22, 1, 0.36, 1];

export const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.4, ease } },
};
export const list = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
};

// Wrap app
<MotionConfig reducedMotion="user">{children}</MotionConfig>

// Grid of cars, revealed once on scroll
<motion.ul variants={list} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }}>
  {cars.map(c => (
    <motion.li key={c.id} variants={fadeUp} whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }}>
      <CarCard car={c} />
    </motion.li>
  ))}
</motion.ul>

// Conditional field (return branch)
<AnimatePresence initial={false}>
  {differentReturn && (
    <motion.div
      key="return-branch"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0, transition: { duration: 0.16 } }}
      transition={{ duration: 0.24, ease }}
      style={{ overflow: "hidden" }}
    >
      <BranchSelect />
    </motion.div>
  )}
</AnimatePresence>

// Filter tabs with sliding indicator
{tabs.map(t => (
  <button key={t} onClick={() => setActive(t)} className="relative">
    {active === t && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-full bg-teal-500/15" />}
    <span className="relative">{t}</span>
  </button>
))}
```

Re-sorting results (price low→high): add `layout` to each card so they glide to new positions instead of jumping.

---

## 7. GSAP recipes (complex sequences only)

```js
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
gsap.registerPlugin(ScrollTrigger);

const mm = gsap.matchMedia();
mm.add("(prefers-reduced-motion: no-preference)", () => {
  // Pinned "How it works" — 3 steps scrub as you scroll
  const tl = gsap.timeline({
    scrollTrigger: { trigger: ".how", start: "top top", end: "+=150%", pin: true, scrub: 0.6 }
  });
  tl.from(".step-1", { autoAlpha: 0, y: 40 })
    .from(".route-line", { strokeDashoffset: 1000, ease: "none" }, "<")
    .from(".step-2", { autoAlpha: 0, y: 40 })
    .from(".step-3", { autoAlpha: 0, y: 40 });
});
```

Use `gsap.matchMedia()` for reduced-motion and breakpoint-specific timelines; it auto-reverts on change. Always `ScrollTrigger.refresh()` after images/fonts load.

---

## 8. Mobile rules

- Disable hover-only effects with `@media (hover: hover) and (pointer: fine)`.
- Cut distances by ~50% and durations by ~20% on small screens.
- No parallax on mobile. No pinned sections taller than 2 screens.
- Tap feedback (`:active` scale/opacity) is mandatory — there's no hover.
- Respect `env(safe-area-inset-*)` for bottom sheets and toasts.

---

## 9. Anti-patterns (reject these)

- Animating everything on the page at load.
- Bouncy springs on serious UI (prices, payments, forms).
- Durations > 500ms for anything the user triggered.
- Scroll-jacking / overriding native scroll speed.
- Letter-by-letter typing effects on body copy.
- Infinite looping attention-grabbers next to the booking form.
- Content hidden until JS runs with no fallback.
- Layout-triggering properties in animations.
- Different easings/durations scattered across components instead of tokens.
- Re-triggering reveal animations every time an element scrolls into view.

---

## 10. QA checklist before shipping

- [ ] Every animation has a stated purpose (orient / feedback / hierarchy / brand).
- [ ] All durations and easings come from tokens.
- [ ] Only `transform` / `opacity` (or justified exceptions) are animated.
- [ ] Reduced-motion tested: OS setting on → page still fully usable, fades only.
- [ ] JS disabled → all content visible.
- [ ] 60fps in DevTools Performance with 4× CPU throttle; no long tasks during scroll.
- [ ] No layout shift (CLS) caused by animations or skeletons.
- [ ] Keyboard: focus rings appear instantly; nothing animates focus away.
- [ ] Page-load sequence completes < 1.2s; booking form is usable immediately.
- [ ] Tested on iOS Safari and Android Chrome; scroll-driven/View Transitions have fallbacks.
- [ ] Interactive feedback appears within 100ms of every click/tap.
