/* ============================================
   WALL OF THOUGHTS — app.js
   Firebase Realtime Database edition
   Real-time sync · Anonymous · Infinite canvas
   ============================================ */

'use strict';

// ============================================
// FIREBASE CONFIG
// ============================================

const firebaseConfig = {
  apiKey:            'AIzaSyCb6YUlzMqkeF_IPBrOrVcyCOvaRpCZeA4',
  authDomain:        'wall-of-thoughts-8f5b3.firebaseapp.com',
  databaseURL:       'https://wall-of-thoughts-8f5b3-default-rtdb.firebaseio.com',
  projectId:         'wall-of-thoughts-8f5b3',
  storageBucket:     'wall-of-thoughts-8f5b3.firebasestorage.app',
  messagingSenderId: '696177048870',
  appId:             '1:696177048870:web:82aefb6c84c093891915e7',
};

firebase.initializeApp(firebaseConfig);
const db          = firebase.database();
const thoughtsRef = db.ref('thoughts');

// ============================================
// CONSTANTS
// ============================================

const MOODS = [
  'happy','grumpy','sleepy','excited','confused','chill',
  'anxious','dreamy','silly','cosmic','fuzzy','electric',
  'melancholy','giddy','whimsical','brooding','serene',
  'chaotic','curious','numb','restless','tender','hollow',
  'blazing','wistful','frantic','luminous','unhinged',
];

const FRUITS = [
  'mango','kiwi','papaya','lychee','durian','starfruit',
  'dragonfruit','guava','persimmon','kumquat','pomelo',
  'rambutan','jackfruit','longan','mangosteen','pitaya',
  'tamarind','ackee','feijoa','salak','cherimoya',
];

const ANIMALS = [
  'capybara','axolotl','narwhal','quokka','platypus',
  'sloth','fennec','pangolin','binturong','wombat',
  'tapir','okapi','fossa','kinkajou','numbat',
  'tarsier','degu','blobfish','tardigrade','mantisshrimp',
];

const REACTIONS = ['✨', '💭', '🔥', '💯', '🤔', '😌'];

const CARD_COLORS = [
  { hex: '#8b5cf6', rgb: '139,92,246'  },  // violet
  { hex: '#06b6d4', rgb: '6,182,212'   },  // cyan
  { hex: '#f59e0b', rgb: '245,158,11'  },  // amber
  { hex: '#f43f5e', rgb: '244,63,94'   },  // rose
  { hex: '#10b981', rgb: '16,185,129'  },  // emerald
  { hex: '#6366f1', rgb: '99,102,241'  },  // indigo
  { hex: '#f97316', rgb: '249,115,22'  },  // orange
  { hex: '#ec4899', rgb: '236,72,153'  },  // pink
];

const SESSION_KEY    = 'wot_session_id';
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE      = 50;   // thoughts per initial load
const LOAD_MORE_SIZE = 30;   // thoughts per "load more" batch

const CARD_W   = 252;  // card width  (matches CSS)
const CARD_H   = 210;  // card height estimate (text + reactions + padding)
const CARD_GAP = 24;   // minimum gap between cards

// ============================================
// STATE
// ============================================

const state = {
  // Canvas transform
  panX: 0, panY: 0, scale: 1,

  // Drag
  isDragging: false,
  dragStartX: 0, dragStartY: 0,

  // Touch
  touches: [], lastPinchDist: 0,

  // Data
  thoughts: [],          // local mirror of loaded thoughts

  // Firebase pagination
  oldestTimestamp: null, // used to load older batches
  isLoadingMore: false,

  // Search
  query: '', matches: [], matchIdx: 0,

  // UI
  panelOpen: false,
  sessionId: '',
};

// ============================================
// DOM REFS
// ============================================

const $ = id => document.getElementById(id);

const canvasWrapper   = $('canvasWrapper');
const infiniteCanvas  = $('infiniteCanvas');
const starfieldCanvas = $('starfield');
const emptyState      = $('emptyState');
const thoughtCount    = $('thoughtCount');

const searchInput        = $('searchInput');
const searchResultsGroup = $('searchResultsGroup');
const searchCount        = $('searchCount');
const searchPrev         = $('searchPrev');
const searchNext         = $('searchNext');
const searchClear        = $('searchClear');

const chatBubble      = $('chatBubble');
const thoughtPanel    = $('thoughtPanel');
const thoughtTextarea = $('thoughtTextarea');
const panelCloseBtn   = $('panelCloseBtn');
const charCount       = $('charCount');
const dropBtn         = $('dropBtn');

const resetViewBtn = $('resetViewBtn');
const zoomInBtn    = $('zoomInBtn');
const zoomOutBtn   = $('zoomOutBtn');
const toast        = $('toast');

// ============================================
// INIT
// ============================================

async function init() {
  initSession();
  initStarfield();
  showToast('🛰️ Connecting to the wall…', 2000);
  await loadInitialThoughts();
  setupRealtimeListeners();
  syncEmptyState();
  syncStats();
  bindEvents();
  updateTransform();
}

function initSession() {
  let sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    sessionStorage.setItem(SESSION_KEY, sid);
  }
  state.sessionId = sid;
}

// ============================================
// FIREBASE: INITIAL LOAD
// ============================================

async function loadInitialThoughts() {
  try {
    const snap = await thoughtsRef
      .orderByChild('timestamp')
      .limitToLast(PAGE_SIZE)
      .once('value');

    const batch = [];
    snap.forEach(child => batch.unshift(child.val())); // unshift = newest first

    batch.forEach(thought => {
      state.thoughts.push(thought);
      if (!state.oldestTimestamp || thought.timestamp < state.oldestTimestamp) {
        state.oldestTimestamp = thought.timestamp;
      }
      createCardEl(thought, false);
    });

    syncStats();
    syncEmptyState();

    if (batch.length > 0) {
      showToast(`✦ ${batch.length} thoughts loaded`, 2000);
    } else {
      showToast('✦ Wall is empty — be first!', 2500);
    }
  } catch (err) {
    console.error('Firebase load error:', err);
    showToast('⚠️ Could not connect. Check your internet.', 4000);
  }
}

// ============================================
// FIREBASE: REAL-TIME LISTENERS
// ============================================

function setupRealtimeListeners() {
  const since = Date.now();

  // 1. New thoughts from OTHER users (added after page load)
  thoughtsRef
    .orderByChild('timestamp')
    .startAfter(since)
    .on('child_added', snap => {
      const thought = snap.val();
      if (state.thoughts.find(t => t.id === thought.id)) return;
      state.thoughts.unshift(thought);
      createCardEl(thought, true); // animate as new
      syncStats();
      syncEmptyState();
      showToast(`💭 New thought from ${thought.id.split('-')[0]}-…`, 2500);
    });

  // 2. Updates to existing thoughts (reactions, edits)
  thoughtsRef.on('child_changed', snap => {
    const thought = snap.val();
    const idx = state.thoughts.findIndex(t => t.id === thought.id);
    if (idx !== -1) {
      state.thoughts[idx] = thought;
      const wasHighlighted = state.matches.includes(thought.id);
      createCardEl(thought, false);
      if (wasHighlighted) {
        document.getElementById(`card-${thought.id}`)?.classList.add('is-highlighted');
      }
    }
  });

  // 3. Deletions
  thoughtsRef.on('child_removed', snap => {
    const id = snap.key;
    state.thoughts = state.thoughts.filter(t => t.id !== id);
    const el = document.getElementById(`card-${id}`);
    if (el) {
      el.style.transition = 'opacity 0.22s, transform 0.22s';
      el.style.opacity    = '0';
      el.style.transform  = 'scale(0.75)';
      setTimeout(() => el.remove(), 240);
    }
    syncStats();
    syncEmptyState();
    if (state.query) runSearch(state.query);
  });
}

// ============================================
// FIREBASE: LOAD OLDER THOUGHTS (lazy pan)
// ============================================

async function loadMoreThoughts() {
  if (state.isLoadingMore || !state.oldestTimestamp) return;
  state.isLoadingMore = true;
  showToast('Loading more thoughts…', 2000);

  try {
    const snap = await thoughtsRef
      .orderByChild('timestamp')
      .endBefore(state.oldestTimestamp)
      .limitToLast(LOAD_MORE_SIZE)
      .once('value');

    const batch = [];
    snap.forEach(child => {
      const thought = child.val();
      if (!state.thoughts.find(t => t.id === thought.id)) {
        batch.unshift(thought);
        if (thought.timestamp < state.oldestTimestamp) {
          state.oldestTimestamp = thought.timestamp;
        }
      }
    });

    batch.forEach(t => {
      state.thoughts.push(t);
      createCardEl(t, false);
    });

    if (batch.length > 0) {
      showToast(`✦ ${batch.length} older thoughts loaded`, 2000);
      syncStats();
    } else {
      showToast("✦ You've reached the beginning of the wall", 2500);
    }
  } catch (err) {
    console.error('Load more error:', err);
    showToast('⚠️ Failed to load more thoughts', 3000);
  } finally {
    state.isLoadingMore = false;
  }
}

// ============================================
// CANVAS TRANSFORM
// ============================================

function updateTransform() {
  infiniteCanvas.style.transform =
    `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
}

function viewportToCanvas(vx, vy) {
  return {
    x: (vx - state.panX) / state.scale,
    y: (vy - state.panY) / state.scale,
  };
}

function viewportCenter() {
  return viewportToCanvas(window.innerWidth / 2, window.innerHeight / 2);
}

function animateTo({ targetX, targetY, targetScale }) {
  const startX = state.panX, startY = state.panY, startScale = state.scale;
  const endX = targetX ?? startX, endY = targetY ?? startY, endScale = targetScale ?? startScale;
  const startTime = performance.now();
  const duration  = 520;

  function step(now) {
    const t    = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    state.panX  = startX  + (endX  - startX)  * ease;
    state.panY  = startY  + (endY  - startY)  * ease;
    state.scale = startScale + (endScale - startScale) * ease;
    updateTransform();
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function applyZoom(factor, pivotX, pivotY) {
  const newScale = Math.min(Math.max(state.scale * factor, 0.15), 5);
  state.panX  = pivotX - (pivotX - state.panX) * (newScale / state.scale);
  state.panY  = pivotY - (pivotY - state.panY) * (newScale / state.scale);
  state.scale = newScale;
  updateTransform();
}

// ============================================
// CARD RENDERING
// ============================================

function createCardEl(thought, isNew = false) {
  const existing = document.getElementById(`card-${thought.id}`);
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className  = 'thought-card' + (isNew ? ' is-new' : '');
  el.id         = `card-${thought.id}`;
  el.dataset.id = thought.id;

  const { hex, rgb } = thought.color;
  el.style.setProperty('--card-color', hex);
  el.style.setProperty('--card-rgb', rgb);
  el.style.left = thought.x + 'px';
  el.style.top  = thought.y + 'px';

  const ownedBySession = thought.sessionId === state.sessionId;
  const canEdit   = ownedBySession && (Date.now() - thought.timestamp < EDIT_WINDOW_MS);
  const canDelete = ownedBySession;

  const actionBtns = [
    canEdit   ? `<button class="card-act-btn edit"   data-id="${thought.id}" title="Edit (24h window)">✏️</button>` : '',
    canDelete ? `<button class="card-act-btn delete" data-id="${thought.id}" title="Delete">🗑️</button>` : '',
  ].join('');

  const reactionHtml = REACTIONS.map(emoji => {
    const count   = (thought.reactions && thought.reactions[emoji]) || 0;
    const reacted = ((thought.userReactions || {})[state.sessionId] || []).includes(emoji);
    return `<button
      class="react-btn${reacted ? ' is-reacted' : ''}"
      data-emoji="${emoji}"
      data-id="${thought.id}"
      title="${emoji}"
    >${emoji}${count > 0 ? `<span class="react-count">${count}</span>` : ''}</button>`;
  }).join('');

  el.innerHTML = `
    <div class="card-header">
      <span class="card-id" title="${thought.id}">${thought.id}</span>
      <div class="card-actions">${actionBtns}</div>
    </div>
    <div class="card-text" id="txt-${thought.id}">${escHtml(thought.text)}</div>
    <div class="card-edit-wrap" id="editwrap-${thought.id}">
      <textarea class="card-edit-ta" id="edita-${thought.id}" maxlength="280">${escAttr(thought.text)}</textarea>
      <div class="card-edit-btns">
        <button class="edit-save-btn"   data-id="${thought.id}">Save</button>
        <button class="edit-cancel-btn" data-id="${thought.id}">Cancel</button>
      </div>
    </div>
    <div class="card-ts" id="ts-${thought.id}">${relativeTime(thought.timestamp)}</div>
    <div class="card-reactions">${reactionHtml}</div>
  `;

  el.addEventListener('mousedown', e => e.stopPropagation());
  el.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });

  el.querySelectorAll('.react-btn').forEach(btn => {
    btn.addEventListener('click', () => handleReaction(thought.id, btn.dataset.emoji));
  });

  const delBtn  = el.querySelector('.card-act-btn.delete');
  const editBtn = el.querySelector('.card-act-btn.edit');
  if (delBtn)  delBtn.addEventListener('click',  () => deleteThought(thought.id));
  if (editBtn) editBtn.addEventListener('click', () => startEdit(thought.id));

  const saveBtn   = el.querySelector('.edit-save-btn');
  const cancelBtn = el.querySelector('.edit-cancel-btn');
  if (saveBtn)   saveBtn.addEventListener('click',   () => saveEdit(thought.id));
  if (cancelBtn) cancelBtn.addEventListener('click', () => cancelEdit(thought.id));

  infiniteCanvas.appendChild(el);

  if (state.matches.includes(thought.id)) {
    el.classList.add('is-highlighted');
  }

  return el;
}

// ============================================
// COLLISION AVOIDANCE
// ============================================

/**
 * Returns a position for a new card that doesn't overlap any existing card.
 * Starts at (preferX, preferY) and spirals outward until a free slot is found.
 */
function findNonOverlappingPosition(preferX, preferY) {
  const slotW = CARD_W + CARD_GAP;
  const slotH = CARD_H + CARD_GAP;

  function overlapsAny(x, y) {
    return state.thoughts.some(t => {
      const dx = Math.abs(x - t.x);
      const dy = Math.abs(y - t.y);
      return dx < slotW && dy < slotH;
    });
  }

  // No existing cards — use the preferred position
  if (state.thoughts.length === 0) return { x: preferX, y: preferY };

  // Try preferred position first
  if (!overlapsAny(preferX, preferY)) return { x: preferX, y: preferY };

  // Spiral outward in rings, testing candidate positions evenly around each ring
  const ringStep = Math.max(slotW, slotH);
  for (let ring = 1; ring <= 30; ring++) {
    const radius  = ring * ringStep * 0.75;
    // More candidate points on larger rings for better coverage
    const samples = Math.max(8, Math.round(2 * Math.PI * radius / ringStep));
    for (let i = 0; i < samples; i++) {
      const angle = (2 * Math.PI * i) / samples;
      const cx = preferX + Math.round(radius * Math.cos(angle));
      const cy = preferY + Math.round(radius * Math.sin(angle));
      if (!overlapsAny(cx, cy)) return { x: cx, y: cy };
    }
  }

  // Absolute fallback (should never reach here in practice)
  return { x: preferX + slotW * 30, y: preferY };
}

// ============================================
// THOUGHT ACTIONS (Firebase-backed)
// ============================================

function addThought(text) {
  text = text.trim();
  if (!text) return;

  const center = viewportCenter();
  // Slight initial scatter so cards dropped in quick succession
  // start searching from slightly different anchor points
  const anchorX = center.x + (Math.random() - 0.5) * 80 - CARD_W / 2;
  const anchorY = center.y + (Math.random() - 0.5) * 60 - CARD_H / 2;
  const { x, y } = findNonOverlappingPosition(anchorX, anchorY);

  const thought = {
    id:           generateId(),
    text,
    x,
    y,
    color:        CARD_COLORS[Math.floor(Math.random() * CARD_COLORS.length)],
    timestamp:    Date.now(),
    sessionId:    state.sessionId,
    reactions:    Object.fromEntries(REACTIONS.map(e => [e, 0])),
    userReactions: {},
  };

  // Optimistic local render (won't show again from listener since we filter duplicates)
  state.thoughts.unshift(thought);
  createCardEl(thought, true);
  syncStats();
  syncEmptyState();

  // Push to Firebase
  thoughtsRef.child(thought.id).set(thought)
    .then(() => showToast(`✦ Dropped as ${thought.id}`))
    .catch(err => {
      console.error('Add thought error:', err);
      showToast('⚠️ Failed to drop thought. Check your connection.', 4000);
      // Roll back local optimistic update
      state.thoughts = state.thoughts.filter(t => t.id !== thought.id);
      document.getElementById(`card-${thought.id}`)?.remove();
      syncStats();
      syncEmptyState();
    });
}

function deleteThought(id) {
  // Optimistic local remove (Firebase listener will confirm)
  state.thoughts = state.thoughts.filter(t => t.id !== id);
  const el = document.getElementById(`card-${id}`);
  if (el) {
    el.style.transition = 'opacity 0.22s, transform 0.22s';
    el.style.opacity    = '0';
    el.style.transform  = 'scale(0.75)';
    setTimeout(() => el.remove(), 240);
  }
  syncStats();
  syncEmptyState();

  thoughtsRef.child(id).remove()
    .catch(err => {
      console.error('Delete error:', err);
      showToast('⚠️ Delete failed.', 3000);
    });
}

function handleReaction(id, emoji) {
  const thought = state.thoughts.find(t => t.id === id);
  if (!thought) return;

  if (!thought.userReactions[state.sessionId]) {
    thought.userReactions[state.sessionId] = [];
  }

  const alreadyReacted = thought.userReactions[state.sessionId].includes(emoji);
  const delta = alreadyReacted ? -1 : 1;

  // Optimistic local update
  if (alreadyReacted) {
    thought.userReactions[state.sessionId] =
      thought.userReactions[state.sessionId].filter(e => e !== emoji);
  } else {
    thought.userReactions[state.sessionId].push(emoji);
  }
  thought.reactions[emoji] = Math.max(0, (thought.reactions[emoji] || 0) + delta);

  const wasHighlighted = state.matches.includes(id);
  createCardEl(thought, false);
  if (wasHighlighted) document.getElementById(`card-${id}`)?.classList.add('is-highlighted');

  // Atomic count update in Firebase
  thoughtsRef.child(id).child('reactions').child(emoji)
    .transaction(count => Math.max(0, (count || 0) + delta));

  // User reaction record
  thoughtsRef.child(id).child('userReactions').child(state.sessionId)
    .set(thought.userReactions[state.sessionId]);
}

function startEdit(id) {
  const wrap = document.getElementById(`editwrap-${id}`);
  const txt  = document.getElementById(`txt-${id}`);
  const ta   = document.getElementById(`edita-${id}`);
  if (!wrap || !txt || !ta) return;
  txt.classList.add('hidden');
  wrap.classList.add('visible');
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function cancelEdit(id) {
  const thought = state.thoughts.find(t => t.id === id);
  if (!thought) return;
  const wrap = document.getElementById(`editwrap-${id}`);
  const txt  = document.getElementById(`txt-${id}`);
  const ta   = document.getElementById(`edita-${id}`);
  if (!wrap || !txt || !ta) return;
  ta.value = thought.text;
  wrap.classList.remove('visible');
  txt.classList.remove('hidden');
}

function saveEdit(id) {
  const thought = state.thoughts.find(t => t.id === id);
  if (!thought) return;
  const ta      = document.getElementById(`edita-${id}`);
  if (!ta) return;
  const newText = ta.value.trim();
  if (!newText) { showToast('Thought cannot be empty.'); return; }

  thought.text = newText;
  const wasHighlighted = state.matches.includes(id);
  createCardEl(thought, false);
  if (wasHighlighted) document.getElementById(`card-${id}`)?.classList.add('is-highlighted');

  thoughtsRef.child(id).child('text').set(newText)
    .then(() => showToast('✦ Thought updated'))
    .catch(err => {
      console.error('Edit error:', err);
      showToast('⚠️ Edit failed.', 3000);
    });
}

// ============================================
// SEARCH
// ============================================

function runSearch(query) {
  state.query = query;

  document.querySelectorAll('.thought-card.is-highlighted').forEach(el => {
    el.classList.remove('is-highlighted');
  });

  if (!query.trim()) {
    state.matches  = [];
    state.matchIdx = 0;
    searchResultsGroup.classList.remove('is-visible');
    searchCount.textContent = '';
    return;
  }

  const q = query.toLowerCase();
  state.matches = state.thoughts
    .filter(t => t.text.toLowerCase().includes(q) || t.id.toLowerCase().includes(q))
    .map(t => t.id);

  state.matches.forEach(id => {
    document.getElementById(`card-${id}`)?.classList.add('is-highlighted');
  });

  searchResultsGroup.classList.add('is-visible');

  if (state.matches.length === 0) {
    searchCount.textContent = 'No results';
    return;
  }

  state.matchIdx = 0;
  updateSearchUI();
  jumpToMatch(0);
}

function updateSearchUI() {
  searchCount.textContent = `${state.matchIdx + 1} / ${state.matches.length}`;
}

function stepSearch(direction) {
  if (state.matches.length === 0) return;
  state.matchIdx = (state.matchIdx + direction + state.matches.length) % state.matches.length;
  updateSearchUI();
  jumpToMatch(state.matchIdx);
}

function jumpToMatch(idx) {
  const id      = state.matches[idx];
  const thought = state.thoughts.find(t => t.id === id);
  if (!thought) return;
  const targetPanX = window.innerWidth  / 2 - (thought.x + 126) * state.scale;
  const targetPanY = window.innerHeight / 2 - (thought.y +  80) * state.scale;
  animateTo({ targetX: targetPanX, targetY: targetPanY });
}

// ============================================
// STARFIELD
// ============================================

function initStarfield() {
  const ctx = starfieldCanvas.getContext('2d');
  let W = window.innerWidth, H = window.innerHeight;

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    starfieldCanvas.width = W; starfieldCanvas.height = H;
  }
  resize();
  window.addEventListener('resize', resize);

  const stars = Array.from({ length: 220 }, () => ({
    x: Math.random() * W, y: Math.random() * H,
    r: Math.random() * 1.4 + 0.2,
    phase: Math.random() * Math.PI * 2,
    speed: Math.random() * 0.006 + 0.002,
  }));

  const shooters = [];

  function trySpawnShooter() {
    if (Math.random() > 0.003) return;
    const startLeft = Math.random() < 0.5;
    shooters.push({
      x: startLeft ? Math.random() * W * 0.5 : W * 0.5 + Math.random() * W * 0.5,
      y: Math.random() * H * 0.45,
      vx: (startLeft ? 1 : -1) * (Math.random() * 5 + 2),
      vy: Math.random() * 3 + 0.8,
      trail: Math.random() * 90 + 50,
      alpha: 1,
      decay: Math.random() * 0.018 + 0.012,
    });
  }

  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, W, H);
    stars.forEach(s => {
      const a = (Math.sin(frame * s.speed + s.phase) * 0.5 + 0.5) * 0.7 + 0.1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fill();
    });

    trySpawnShooter();
    for (let i = shooters.length - 1; i >= 0; i--) {
      const s  = shooters[i];
      const tx = s.x - s.vx * (s.trail / 12);
      const ty = s.y - s.vy * (s.trail / 12);
      const g  = ctx.createLinearGradient(s.x, s.y, tx, ty);
      g.addColorStop(0, `rgba(255,255,255,${s.alpha})`);
      g.addColorStop(0.4, `rgba(180,160,255,${s.alpha * 0.4})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(tx, ty);
      ctx.strokeStyle = g; ctx.lineWidth = 1.8; ctx.stroke();
      s.x += s.vx; s.y += s.vy; s.alpha -= s.decay;
      if (s.alpha <= 0) shooters.splice(i, 1);
    }
    frame++;
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}

// ============================================
// SYNC UI
// ============================================

function syncStats() {
  thoughtCount.textContent = state.thoughts.length;
}

function syncEmptyState() {
  state.thoughts.length === 0
    ? emptyState.classList.remove('is-hidden')
    : emptyState.classList.add('is-hidden');
}

// ============================================
// TOAST
// ============================================

let toastTimer = null;

function showToast(msg, duration = 2800) {
  toast.textContent = msg;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), duration);
}

// ============================================
// PANEL
// ============================================

function openPanel() {
  state.panelOpen = true;
  chatBubble.style.display = 'none';
  thoughtPanel.classList.add('is-open');
  setTimeout(() => thoughtTextarea.focus(), 60);
}

function closePanel() {
  state.panelOpen = false;
  thoughtPanel.classList.remove('is-open');
  chatBubble.style.display = '';
}

// ============================================
// EVENTS
// ============================================

function bindEvents() {
  // ---- Canvas mouse drag ----
  canvasWrapper.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('.thought-card')) return;
    state.isDragging = true;
    state.dragStartX = e.clientX - state.panX;
    state.dragStartY = e.clientY - state.panY;
    canvasWrapper.classList.add('is-dragging');
  });

  window.addEventListener('mousemove', e => {
    if (!state.isDragging) return;
    state.panX = e.clientX - state.dragStartX;
    state.panY = e.clientY - state.dragStartY;
    updateTransform();
  });

  window.addEventListener('mouseup', () => {
    if (!state.isDragging) return;
    state.isDragging = false;
    canvasWrapper.classList.remove('is-dragging');
    // Lazy-load older thoughts when user has panned far from origin
    const distFromOrigin = Math.sqrt(state.panX ** 2 + state.panY ** 2);
    if (distFromOrigin > 400) loadMoreThoughts();
  });

  // ---- Scroll zoom ----
  canvasWrapper.addEventListener('wheel', e => {
    e.preventDefault();
    applyZoom(e.deltaY < 0 ? 1.09 : 0.91, e.clientX, e.clientY);
  }, { passive: false });

  // ---- Touch ----
  canvasWrapper.addEventListener('touchstart', e => {
    if (e.target.closest('.thought-card')) return;
    state.touches = Array.from(e.touches);
    if (state.touches.length === 1) {
      state.isDragging = true;
      state.dragStartX = state.touches[0].clientX - state.panX;
      state.dragStartY = state.touches[0].clientY - state.panY;
    }
    if (state.touches.length === 2) {
      state.lastPinchDist = Math.hypot(
        state.touches[1].clientX - state.touches[0].clientX,
        state.touches[1].clientY - state.touches[0].clientY,
      );
    }
  }, { passive: true });

  canvasWrapper.addEventListener('touchmove', e => {
    e.preventDefault();
    state.touches = Array.from(e.touches);
    if (state.touches.length === 1 && state.isDragging) {
      state.panX = state.touches[0].clientX - state.dragStartX;
      state.panY = state.touches[0].clientY - state.dragStartY;
      updateTransform();
    }
    if (state.touches.length === 2) {
      const dist   = Math.hypot(
        state.touches[1].clientX - state.touches[0].clientX,
        state.touches[1].clientY - state.touches[0].clientY,
      );
      const mx = (state.touches[0].clientX + state.touches[1].clientX) / 2;
      const my = (state.touches[0].clientY + state.touches[1].clientY) / 2;
      applyZoom(dist / state.lastPinchDist, mx, my);
      state.lastPinchDist = dist;
    }
  }, { passive: false });

  canvasWrapper.addEventListener('touchend', () => {
    state.isDragging = false;
    state.touches    = [];
    loadMoreThoughts(); // check if we should load more after a touch pan
  }, { passive: true });

  // ---- Search ----
  searchInput.addEventListener('input', () => runSearch(searchInput.value));
  searchPrev.addEventListener('click', () => stepSearch(-1));
  searchNext.addEventListener('click', () => stepSearch(+1));
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    runSearch('');
    searchInput.focus();
  });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? stepSearch(-1) : stepSearch(+1); }
    if (e.key === 'Escape') { searchClear.click(); searchInput.blur(); }
  });

  // ---- Panel ----
  chatBubble.addEventListener('click', openPanel);
  panelCloseBtn.addEventListener('click', closePanel);

  thoughtTextarea.addEventListener('input', () => {
    const len = thoughtTextarea.value.length;
    charCount.textContent = `${len} / 280`;
    charCount.className = 'char-count' + (len > 270 ? ' danger' : len > 240 ? ' warn' : '');
  });

  thoughtTextarea.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); dropBtn.click(); }
    if (e.key === 'Escape') closePanel();
  });

  dropBtn.addEventListener('click', () => {
    const text = thoughtTextarea.value.trim();
    if (!text) { showToast('✦ Write something first!'); thoughtTextarea.focus(); return; }
    addThought(text);
    thoughtTextarea.value = '';
    charCount.textContent = '0 / 280';
    charCount.className   = 'char-count';
    closePanel();
  });

  // ---- Controls ----
  resetViewBtn.addEventListener('click', () => animateTo({ targetX: 0, targetY: 0, targetScale: 1 }));
  zoomInBtn.addEventListener('click', () =>
    applyZoom(1.25, window.innerWidth / 2, window.innerHeight / 2));
  zoomOutBtn.addEventListener('click', () =>
    applyZoom(0.8, window.innerWidth / 2, window.innerHeight / 2));

  // ---- Keyboard ----
  window.addEventListener('keydown', e => {
    if (document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA') return;
    switch (e.key) {
      case '/':   e.preventDefault(); searchInput.focus(); break;
      case 'n': case 'N': e.preventDefault(); openPanel(); break;
      case 'r': case 'R': e.preventDefault(); resetViewBtn.click(); break;
      case '+': case '=': applyZoom(1.15, window.innerWidth/2, window.innerHeight/2); break;
      case '-':           applyZoom(0.87, window.innerWidth/2, window.innerHeight/2); break;
    }
  });

  // ---- Timestamp refresh ----
  setInterval(() => {
    state.thoughts.forEach(t => {
      const el = document.getElementById(`ts-${t.id}`);
      if (el) el.textContent = relativeTime(t.timestamp);
    });
  }, 60_000);
}

// ============================================
// UTILITIES
// ============================================

function generateId() {
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  return `${pick(MOODS)}-${pick(FRUITS)}-${pick(ANIMALS)}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function escAttr(str) { return String(str).replace(/"/g, '&quot;'); }

function relativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000)      return 'just now';
  if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ============================================
// GO
// ============================================

init();
