// ======================================================
// STATE & STORAGE
// ======================================================

const DEFAULT_CATEGORIES = ['Work', 'Personal', 'Home', 'Health'];

let state = {
  tasks: [],
  categories: [...DEFAULT_CATEGORIES],
  openaiKey: '',
  filters: { view: 'all', priority: '' },
  filterCategory: ''
};

let focusState = { active: false, tasks: [], index: 0 };
let aiProposedTasks = [];
let editingTaskId = null;
let recognition = null;
let isRecording = false;

function saveState() {
  localStorage.setItem('todoplus_v3', JSON.stringify({
    tasks: state.tasks,
    categories: state.categories,
    openaiKey: state.openaiKey
  }));
}

function loadState() {
  try {
    const raw = localStorage.getItem('todoplus_v3');
    if (raw) {
      const saved = JSON.parse(raw);
      state.tasks = saved.tasks || [];
      state.categories = saved.categories || [...DEFAULT_CATEGORIES];
      state.openaiKey = saved.openaiKey || '';
    }
  } catch (e) {}
}

// ======================================================
// UTILITIES
// ======================================================

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  const t = todayStr();
  if (dateStr < t) {
    const days = Math.round((new Date(t) - new Date(dateStr + 'T00:00:00')) / 86400000);
    return { label: days === 1 ? 'Yesterday' : `${days}d overdue`, status: 'overdue' };
  }
  if (dateStr === t) return { label: 'Today', status: 'today' };
  const tom = new Date(); tom.setDate(tom.getDate() + 1);
  if (dateStr === tom.toISOString().slice(0, 10)) return { label: 'Tomorrow', status: 'upcoming' };
  return {
    label: new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    status: 'upcoming'
  };
}

const CAT_COLORS = ['#7c6aff','#f783ac','#74c0fc','#69db7c','#ffa94d','#da77f2','#4dabf7','#a9e34b','#ff8787','#63e6be'];
function catColor(cat) {
  let h = 0;
  for (const c of (cat || '')) h = c.charCodeAt(0) + ((h << 5) - h);
  return CAT_COLORS[Math.abs(h) % CAT_COLORS.length];
}

function sizeLabel(s) {
  return { quick: 'Quick', medium: 'Medium', big: 'Big' }[s] || s;
}

function priorityColor(p) {
  return { high: 'var(--high)', medium: 'var(--medium)', low: 'var(--low)' }[p] || 'var(--border)';
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ======================================================
// TASK OPERATIONS
// ======================================================

function addTask(data) {
  const task = {
    id: uid(),
    title: (data.title || '').trim() || 'Untitled',
    notes: (data.notes || '').trim(),
    dueDate: data.dueDate || '',
    priority: data.priority || 'medium',
    category: (data.category || '').trim(),
    size: data.size || 'quick',
    completed: false,
    completedAt: null,
    createdAt: new Date().toISOString()
  };
  state.tasks.unshift(task);
  if (task.category && !state.categories.includes(task.category)) {
    state.categories.push(task.category);
  }
  saveState();
  return task;
}

function updateTask(id, data) {
  const t = state.tasks.find(t => t.id === id);
  if (!t) return;
  Object.assign(t, {
    title: (data.title || '').trim() || 'Untitled',
    notes: (data.notes || '').trim(),
    dueDate: data.dueDate || '',
    priority: data.priority || 'medium',
    category: (data.category || '').trim(),
    size: data.size || 'quick'
  });
  if (t.category && !state.categories.includes(t.category)) {
    state.categories.push(t.category);
  }
  saveState();
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  saveState();
}

function toggleComplete(id) {
  const t = state.tasks.find(t => t.id === id);
  if (!t) return null;
  t.completed = !t.completed;
  t.completedAt = t.completed ? new Date().toISOString() : null;
  saveState();
  return t;
}

// ======================================================
// FILTERING & SORTING
// ======================================================

function getFiltered() {
  const t = todayStr();
  let tasks = state.tasks.filter(task => {
    if (state.filters.view === 'completed') return task.completed;
    if (task.completed) return false;
    if (state.filters.view === 'today') return task.dueDate === t;
    if (state.filters.view === 'overdue') return task.dueDate && task.dueDate < t;
    return true;
  });

  if (state.filters.priority) tasks = tasks.filter(t => t.priority === state.filters.priority);
  if (state.filterCategory) tasks = tasks.filter(t => t.category === state.filterCategory);

  const pw = { high: 0, medium: 1, low: 2 };
  tasks.sort((a, b) => {
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return (pw[a.priority] ?? 1) - (pw[b.priority] ?? 1);
  });

  return tasks;
}

function overdueCount() {
  const t = todayStr();
  return state.tasks.filter(task => !task.completed && task.dueDate && task.dueDate < t).length;
}

function todayCount() {
  const t = todayStr();
  return state.tasks.filter(task => !task.completed && task.dueDate === t).length;
}

// ======================================================
// RENDER
// ======================================================

function render() {
  renderTaskList();
  renderCategoryFilters();
  renderHeaderBadges();
  renderProgress();
  updateCategorySuggestions();
}

function renderProgress() {
  const todayDone = state.tasks.filter(t => {
    return t.completed && t.completedAt &&
      new Date(t.completedAt).toDateString() === new Date().toDateString();
  }).length;

  const total = state.tasks.filter(t => !t.completed).length + todayDone;
  const pct = total > 0 ? Math.round((todayDone / total) * 100) : 0;

  document.getElementById('progress-label').textContent =
    todayDone === 0 ? 'Ready to go!' : `${todayDone} task${todayDone !== 1 ? 's' : ''} done today`;
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-pct').textContent = pct + '%';
}

function renderHeaderBadges() {
  const overdue = overdueCount();
  const todayCnt = todayCount();
  const container = document.getElementById('header-badges');
  container.innerHTML = '';

  if (overdue > 0) {
    const b = document.createElement('span');
    b.className = 'badge-count';
    b.title = `${overdue} overdue task${overdue !== 1 ? 's' : ''} — click to view`;
    b.textContent = overdue;
    b.onclick = () => setFilter('view', 'overdue');
    container.appendChild(b);
  }

  const overdueBtn = document.getElementById('overdue-filter-btn');
  const todayBtn = document.getElementById('today-filter-btn');

  overdueBtn.innerHTML = overdue > 0
    ? `Overdue <span style="background:rgba(255,107,107,0.18);color:var(--high);padding:0 4px;border-radius:4px;font-size:0.68rem;font-weight:700">${overdue}</span>`
    : 'Overdue';

  todayBtn.innerHTML = todayCnt > 0
    ? `Today <span style="background:rgba(255,169,77,0.18);color:var(--medium);padding:0 4px;border-radius:4px;font-size:0.68rem;font-weight:700">${todayCnt}</span>`
    : 'Today';
}

function renderCategoryFilters() {
  const container = document.getElementById('category-filters');
  const used = [...new Set(state.tasks.filter(t => t.category).map(t => t.category))];

  container.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.className = 'filter-btn' + (!state.filterCategory ? ' active' : '');
  allBtn.dataset.filter = 'category';
  allBtn.dataset.value = '';
  allBtn.textContent = 'All';
  container.appendChild(allBtn);

  used.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'filter-btn' + (state.filterCategory === cat ? ' active' : '');
    btn.dataset.filter = 'category';
    btn.dataset.value = cat;
    btn.innerHTML = `<span class="cat-dot" style="background:${catColor(cat)}"></span>${esc(cat)}`;
    container.appendChild(btn);
  });

  container.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.filterCategory = btn.dataset.value;
      container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      render();
    });
  });
}

function renderTaskList() {
  const container = document.getElementById('task-list');
  const filtered = getFiltered();

  const viewLabels = { all: 'All Tasks', today: "Today's Tasks", overdue: 'Overdue', completed: 'Completed' };
  document.getElementById('tasks-title').textContent = viewLabels[state.filters.view] || 'Tasks';
  document.getElementById('tasks-count').textContent =
    filtered.length ? `${filtered.length} task${filtered.length !== 1 ? 's' : ''}` : '';

  if (filtered.length === 0) {
    const msgs = {
      all: { icon: '✓', title: "You're all clear!", sub: 'Press N or click "Add Task" to get started.' },
      today: { icon: '📅', title: 'Nothing due today', sub: 'Enjoy the breathing room — or add something.' },
      overdue: { icon: '🎉', title: "Nothing overdue!", sub: "You're all caught up. Great work." },
      completed: { icon: '📋', title: 'No completed tasks yet', sub: 'Check something off your list!' }
    };
    const m = msgs[state.filters.view] || msgs.all;
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${m.icon}</div><h3>${m.title}</h3><p>${m.sub}</p></div>`;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(task => container.appendChild(createTaskCard(task)));
}

function createTaskCard(task) {
  const card = document.createElement('div');
  card.className = `task-card ${task.priority}${task.completed ? ' completed' : ''}`;
  card.dataset.id = task.id;

  const di = task.dueDate ? formatDate(task.dueDate) : null;

  card.innerHTML = `
    <div class="task-checkbox${task.completed ? ' checked' : ''}" data-check="${task.id}">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </div>
    <div class="task-content">
      <div class="task-title">${esc(task.title)}</div>
      <div class="task-meta">
        ${task.category ? `<span class="tag tag-category"><span class="cat-dot" style="background:${catColor(task.category)}"></span>${esc(task.category)}</span>` : ''}
        ${task.size ? `<span class="tag tag-size-${task.size}">${sizeLabel(task.size)}</span>` : ''}
        ${di ? `<span class="due-date ${di.status}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${di.label}
        </span>` : ''}
      </div>
      ${task.notes ? `<div class="task-notes" id="notes-${task.id}">${esc(task.notes)}</div>` : ''}
    </div>
    <div class="task-actions">
      ${task.notes ? `<button class="btn-icon" data-expand="${task.id}" title="Show notes">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>` : ''}
      <button class="btn-icon" data-edit="${task.id}" title="Edit task">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="btn-icon" data-delete="${task.id}" title="Delete task" style="color:var(--text-muted)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
      </button>
    </div>
  `;

  card.querySelector('[data-check]').addEventListener('click', e => {
    e.stopPropagation();
    const wasCompleted = task.completed;
    toggleComplete(task.id);
    if (!wasCompleted) {
      e.currentTarget.classList.add('checked');
      card.classList.add('completing');
      fireConfetti(e.currentTarget);
      showToast('Nice work! Task completed.');
      setTimeout(() => render(), 500);
    } else {
      render();
    }
  });

  card.querySelector('[data-edit]')?.addEventListener('click', e => {
    e.stopPropagation();
    openEditModal(e.currentTarget.dataset.edit);
  });

  card.querySelector('[data-delete]')?.addEventListener('click', e => {
    e.stopPropagation();
    deleteTask(e.currentTarget.dataset.delete);
    render();
    showToast('Task deleted.');
  });

  card.querySelector('[data-expand]')?.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('notes-' + e.currentTarget.dataset.expand)?.classList.toggle('visible');
  });

  return card;
}

// ======================================================
// FILTER CONTROLS
// ======================================================

function setFilter(type, value) {
  if (type === 'view') state.filters.view = value;
  if (type === 'priority') state.filters.priority = value;

  document.querySelectorAll(`[data-filter="${type}"]`).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
  render();
}

document.querySelectorAll('[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => setFilter(btn.dataset.filter, btn.dataset.value));
});

// ======================================================
// ADD / EDIT TASK MODAL
// ======================================================

function openAddModal() {
  editingTaskId = null;
  document.getElementById('task-modal-title').textContent = 'New Task';
  document.getElementById('task-title-input').value = '';
  document.getElementById('task-due-input').value = '';
  document.getElementById('task-category-input').value = '';
  document.getElementById('task-notes-input').value = '';
  document.querySelector('input[name="priority"][value="medium"]').checked = true;
  document.querySelector('input[name="size"][value="quick"]').checked = true;
  document.getElementById('task-modal').classList.add('visible');
  updateCategorySuggestions();
  setTimeout(() => document.getElementById('task-title-input').focus(), 100);
}

function openEditModal(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  editingTaskId = id;
  document.getElementById('task-modal-title').textContent = 'Edit Task';
  document.getElementById('task-title-input').value = task.title;
  document.getElementById('task-due-input').value = task.dueDate || '';
  document.getElementById('task-category-input').value = task.category || '';
  document.getElementById('task-notes-input').value = task.notes || '';
  const pEl = document.querySelector(`input[name="priority"][value="${task.priority}"]`);
  if (pEl) pEl.checked = true;
  const sEl = document.querySelector(`input[name="size"][value="${task.size}"]`);
  if (sEl) sEl.checked = true;
  document.getElementById('task-modal').classList.add('visible');
  updateCategorySuggestions();
  setTimeout(() => document.getElementById('task-title-input').focus(), 100);
}

function closeTaskModal() {
  document.getElementById('task-modal').classList.remove('visible');
  editingTaskId = null;
}

function saveTask() {
  const titleEl = document.getElementById('task-title-input');
  const title = titleEl.value.trim();
  if (!title) {
    titleEl.style.borderColor = 'var(--high)';
    titleEl.focus();
    return;
  }
  titleEl.style.borderColor = '';

  const data = {
    title,
    dueDate: document.getElementById('task-due-input').value,
    category: document.getElementById('task-category-input').value.trim(),
    notes: document.getElementById('task-notes-input').value.trim(),
    priority: document.querySelector('input[name="priority"]:checked')?.value || 'medium',
    size: document.querySelector('input[name="size"]:checked')?.value || 'quick'
  };

  if (editingTaskId) {
    updateTask(editingTaskId, data);
    showToast('Task updated.');
  } else {
    addTask(data);
    showToast('Task added!');
  }

  closeTaskModal();
  render();
}

function updateCategorySuggestions() {
  const container = document.getElementById('category-suggestions');
  if (!container) return;
  const current = document.getElementById('task-category-input')?.value || '';
  container.innerHTML = '';
  state.categories.forEach(cat => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'category-chip' + (cat === current ? ' active' : '');
    chip.textContent = cat;
    chip.addEventListener('click', () => {
      document.getElementById('task-category-input').value = cat;
      updateCategorySuggestions();
    });
    container.appendChild(chip);
  });
}

document.getElementById('add-task-btn').addEventListener('click', openAddModal);
document.getElementById('close-task-modal').addEventListener('click', closeTaskModal);
document.getElementById('cancel-task-modal').addEventListener('click', closeTaskModal);
document.getElementById('save-task-btn').addEventListener('click', saveTask);
document.getElementById('task-category-input').addEventListener('input', updateCategorySuggestions);
document.getElementById('task-title-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveTask();
  if (e.key === 'Escape') closeTaskModal();
});
document.getElementById('task-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeTaskModal();
});

// ======================================================
// BRAIN DUMP MODAL
// ======================================================

function openBrainDump() {
  document.getElementById('brain-dump-text').value = '';
  document.getElementById('ai-tasks-result').style.display = 'none';
  document.getElementById('ai-status').style.display = 'none';
  document.getElementById('add-ai-tasks-btn').style.display = 'none';
  document.getElementById('analyze-btn').style.display = '';
  document.getElementById('analyze-btn').disabled = false;
  document.getElementById('analyze-btn').innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
    Turn into Tasks with AI`;
  document.getElementById('api-key-section').style.display = state.openaiKey ? 'none' : 'block';
  document.getElementById('brain-dump-modal').classList.add('visible');
  setTimeout(() => document.getElementById('brain-dump-text').focus(), 100);
}

function closeBrainDump() {
  document.getElementById('brain-dump-modal').classList.remove('visible');
  stopRecording();
}

document.getElementById('brain-dump-btn').addEventListener('click', openBrainDump);
document.getElementById('close-brain-dump').addEventListener('click', closeBrainDump);
document.getElementById('cancel-brain-dump').addEventListener('click', closeBrainDump);
document.getElementById('brain-dump-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeBrainDump();
});

document.getElementById('save-api-key-btn').addEventListener('click', () => {
  const key = document.getElementById('api-key-input').value.trim();
  if (key) {
    state.openaiKey = key;
    saveState();
    document.getElementById('api-key-section').style.display = 'none';
    document.getElementById('settings-api-key').value = key;
    showToast('API key saved!');
  }
});

document.getElementById('analyze-btn').addEventListener('click', async () => {
  const text = document.getElementById('brain-dump-text').value.trim();
  if (!text) { showToast('Type or speak something first!'); return; }
  if (!state.openaiKey) {
    document.getElementById('api-key-section').style.display = 'block';
    document.getElementById('api-key-input').focus();
    return;
  }
  await analyzeWithAI(text);
});

document.getElementById('select-all-ai-tasks').addEventListener('click', () => {
  document.querySelectorAll('#ai-tasks-list input[type="checkbox"]').forEach(cb => cb.checked = true);
});

document.getElementById('add-ai-tasks-btn').addEventListener('click', () => {
  const checkboxes = document.querySelectorAll('#ai-tasks-list input[type="checkbox"]');
  let count = 0;
  checkboxes.forEach((cb, i) => {
    if (cb.checked && aiProposedTasks[i]) { addTask(aiProposedTasks[i]); count++; }
  });
  if (count > 0) {
    showToast(`Added ${count} task${count !== 1 ? 's' : ''}!`);
    closeBrainDump();
    render();
  } else {
    showToast('Select at least one task to add.');
  }
});

async function analyzeWithAI(text) {
  const statusEl = document.getElementById('ai-status');
  const analyzeBtn = document.getElementById('analyze-btn');

  statusEl.style.display = 'flex';
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Analyzing...';

  const prompt = `You are a helpful task planning assistant for someone with ADHD. Parse this brain dump into clear, concrete, actionable tasks.

For each task return:
- title: Starts with a verb. Short and specific.
- priority: "high" (urgent/important), "medium" (normal), or "low" (someday)
- category: One word — Work, Personal, Home, Health, Finance, etc.
- size: "quick" (<15 min), "medium" (up to 1 hr), "big" (1hr+)
- notes: Brief context from the brain dump, if any
- dueDate: YYYY-MM-DD if a date is mentioned, else ""

Return ONLY a valid JSON array. No explanation or markdown. Example:
[{"title":"Call dentist","priority":"medium","category":"Health","size":"quick","notes":"","dueDate":""}]

Brain dump: "${text.replace(/"/g, '\\"')}"`;

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1200
      })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    const content = data.choices[0].message.content.trim();
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Could not parse AI response.');

    aiProposedTasks = JSON.parse(match[0]);
    renderAITasks(aiProposedTasks);

  } catch (err) {
    statusEl.style.display = 'none';
    analyzeBtn.disabled = false;
    analyzeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg> Turn into Tasks with AI`;

    if (err.message.includes('401') || err.message.toLowerCase().includes('incorrect api key') || err.message.toLowerCase().includes('invalid api key')) {
      showToast('Invalid API key — check your key in settings.');
      document.getElementById('api-key-section').style.display = 'block';
    } else {
      showToast('Oops: ' + err.message);
    }
  }
}

function renderAITasks(tasks) {
  document.getElementById('ai-status').style.display = 'none';
  document.getElementById('analyze-btn').style.display = 'none';
  document.getElementById('add-ai-tasks-btn').style.display = '';

  const listEl = document.getElementById('ai-tasks-list');
  listEl.innerHTML = '';

  tasks.forEach((task, i) => {
    const item = document.createElement('div');
    item.className = 'ai-task-item';
    item.innerHTML = `
      <input type="checkbox" id="ai-${i}" checked />
      <div class="ai-task-info">
        <div class="ai-task-title">${esc(task.title)}</div>
        <div class="ai-task-meta">
          ${task.priority ? `<span class="tag" style="background:${task.priority==='high'?'rgba(255,107,107,0.12)':task.priority==='medium'?'rgba(255,169,77,0.12)':'rgba(105,219,124,0.12)'};color:${priorityColor(task.priority)}">${task.priority}</span>` : ''}
          ${task.category ? `<span class="tag tag-category">${esc(task.category)}</span>` : ''}
          ${task.size ? `<span class="tag tag-size-${task.size}">${sizeLabel(task.size)}</span>` : ''}
          ${task.dueDate ? `<span class="due-date">${task.dueDate}</span>` : ''}
        </div>
        ${task.notes ? `<div style="font-size:0.76rem;color:var(--text-muted);margin-top:0.25rem">${esc(task.notes)}</div>` : ''}
      </div>
    `;
    listEl.appendChild(item);
  });

  document.getElementById('ai-tasks-result').style.display = 'block';
}

// ======================================================
// VOICE INPUT
// ======================================================

function initSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    document.getElementById('mic-btn').title = 'Voice input not available in this browser (try Chrome)';
    document.getElementById('mic-btn').style.opacity = '0.4';
    document.getElementById('mic-btn').style.cursor = 'not-allowed';
    return;
  }

  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  let finalText = '';

  recognition.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
      else interim = e.results[i][0].transcript;
    }
    document.getElementById('brain-dump-text').value = finalText + interim;
  };

  recognition.onend = () => { if (isRecording) recognition.start(); };

  recognition.onerror = e => {
    if (e.error !== 'no-speech') { stopRecording(); showToast('Mic error: ' + e.error); }
  };
}

function toggleRecording() {
  if (!recognition) { showToast('Voice input is not supported in this browser. Try Chrome.'); return; }
  isRecording ? stopRecording() : startRecording();
}

function startRecording() {
  isRecording = true;
  recognition.start();
  document.getElementById('mic-btn').classList.add('recording');
  document.getElementById('mic-btn').title = 'Recording — click to stop';
  showToast('Listening... speak freely!');
}

function stopRecording() {
  if (!recognition || !isRecording) return;
  isRecording = false;
  recognition.stop();
  const btn = document.getElementById('mic-btn');
  if (btn) { btn.classList.remove('recording'); btn.title = 'Click to speak your thoughts'; }
}

document.getElementById('mic-btn').addEventListener('click', toggleRecording);

// ======================================================
// FOCUS MODE
// ======================================================

function openFocusMode() {
  const activeTasks = state.tasks.filter(t => !t.completed);
  if (activeTasks.length === 0) { showToast('No active tasks to focus on!'); return; }

  const t = todayStr();
  const pw = { high: 0, medium: 1, low: 2 };

  focusState.tasks = [...activeTasks].sort((a, b) => {
    const aOD = a.dueDate && a.dueDate < t;
    const bOD = b.dueDate && b.dueDate < t;
    const aT = a.dueDate === t;
    const bT = b.dueDate === t;
    if (aOD !== bOD) return aOD ? -1 : 1;
    if (aT !== bT) return aT ? -1 : 1;
    return (pw[a.priority] ?? 1) - (pw[b.priority] ?? 1);
  });

  focusState.index = 0;
  focusState.active = true;

  renderFocusTask();
  document.getElementById('focus-overlay').classList.add('visible');
  document.getElementById('focus-mode-btn').style.cssText = 'background:var(--accent-dim);color:var(--accent);border-color:var(--accent)';
}

function closeFocusMode() {
  focusState.active = false;
  document.getElementById('focus-overlay').classList.remove('visible');
  document.getElementById('focus-mode-btn').style.cssText = '';
}

function renderFocusTask() {
  focusState.tasks = focusState.tasks.filter(t => !t.completed);
  const tasks = focusState.tasks;

  if (tasks.length === 0) {
    document.getElementById('focus-title').textContent = 'All done! Great work.';
    document.getElementById('focus-meta').innerHTML = '';
    document.getElementById('focus-notes').style.display = 'none';
    document.getElementById('focus-priority-dot').style.background = 'var(--success)';
    document.getElementById('focus-counter').textContent = 'Complete!';
    document.getElementById('focus-complete-btn').style.display = 'none';
    document.getElementById('focus-skip-btn').textContent = 'Close';
    document.getElementById('focus-skip-btn').onclick = closeFocusMode;
    document.getElementById('focus-eyebrow').textContent = 'Focus Mode';
    return;
  }

  if (focusState.index >= tasks.length) focusState.index = tasks.length - 1;
  const task = tasks[focusState.index];

  document.getElementById('focus-title').textContent = task.title;
  document.getElementById('focus-priority-dot').style.background = priorityColor(task.priority);
  document.getElementById('focus-counter').textContent = `${focusState.index + 1} / ${tasks.length}`;
  document.getElementById('focus-complete-btn').style.display = '';
  document.getElementById('focus-skip-btn').textContent = 'Skip for Now';
  document.getElementById('focus-skip-btn').onclick = focusNext;
  document.getElementById('focus-eyebrow').textContent = `Focus Mode — ${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)} Priority`;

  const di = task.dueDate ? formatDate(task.dueDate) : null;
  document.getElementById('focus-meta').innerHTML = `
    ${task.category ? `<span class="tag tag-category"><span class="cat-dot" style="background:${catColor(task.category)}"></span>${esc(task.category)}</span>` : ''}
    ${task.size ? `<span class="tag tag-size-${task.size}">${sizeLabel(task.size)}</span>` : ''}
    ${di ? `<span class="due-date ${di.status}">${di.label}</span>` : ''}
  `;

  if (task.notes) {
    document.getElementById('focus-notes').textContent = task.notes;
    document.getElementById('focus-notes').style.display = 'block';
  } else {
    document.getElementById('focus-notes').style.display = 'none';
  }
}

function focusNext() {
  focusState.index = focusState.tasks.length > 0
    ? (focusState.index + 1) % focusState.tasks.length
    : 0;
  renderFocusTask();
}

function focusPrev() {
  focusState.index = focusState.tasks.length > 0
    ? (focusState.index - 1 + focusState.tasks.length) % focusState.tasks.length
    : 0;
  renderFocusTask();
}

document.getElementById('focus-mode-btn').addEventListener('click', () => {
  focusState.active ? closeFocusMode() : openFocusMode();
});
document.getElementById('exit-focus-btn').addEventListener('click', closeFocusMode);
document.getElementById('focus-next-btn').addEventListener('click', focusNext);
document.getElementById('focus-prev-btn').addEventListener('click', focusPrev);
document.getElementById('focus-skip-btn').addEventListener('click', focusNext);

document.getElementById('focus-complete-btn').addEventListener('click', () => {
  const tasks = focusState.tasks.filter(t => !t.completed);
  if (!tasks.length) return;
  const task = tasks[focusState.index];
  toggleComplete(task.id);
  fireConfettiCenter();
  showToast('Task complete! Keep going!');
  setTimeout(() => { renderFocusTask(); render(); }, 200);
});

// ======================================================
// SETTINGS
// ======================================================

function openSettings() {
  document.getElementById('settings-api-key').value = state.openaiKey;
  renderSettingsCategories();
  document.getElementById('settings-modal').classList.add('visible');
}

function closeSettings() {
  document.getElementById('settings-modal').classList.remove('visible');
}

function renderSettingsCategories() {
  const container = document.getElementById('settings-categories');
  container.innerHTML = '';
  state.categories.forEach(cat => {
    const el = document.createElement('span');
    el.style.cssText = 'display:inline-flex;align-items:center;gap:5px;padding:3px 8px 3px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:999px;font-size:0.76rem;color:var(--text-muted)';
    el.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:${catColor(cat)};flex-shrink:0"></span>${esc(cat)}<button onclick="removeCategory('${esc(cat)}')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:0 0 0 3px;font-size:1rem;line-height:1;font-family:inherit">&times;</button>`;
    container.appendChild(el);
  });
}

window.removeCategory = function(cat) {
  state.categories = state.categories.filter(c => c !== cat);
  saveState();
  renderSettingsCategories();
};

document.getElementById('settings-btn').addEventListener('click', openSettings);
document.getElementById('close-settings').addEventListener('click', closeSettings);
document.getElementById('settings-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeSettings();
});

document.getElementById('settings-save-key').addEventListener('click', () => {
  const key = document.getElementById('settings-api-key').value.trim();
  state.openaiKey = key;
  saveState();
  showToast(key ? 'API key saved!' : 'API key cleared.');
});

document.getElementById('add-category-btn').addEventListener('click', () => {
  const input = document.getElementById('new-category-input');
  const val = input.value.trim();
  if (val && !state.categories.includes(val)) {
    state.categories.push(val);
    saveState();
    input.value = '';
    renderSettingsCategories();
    showToast(`Category "${val}" added.`);
  }
});

document.getElementById('new-category-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('add-category-btn').click();
});

document.getElementById('clear-completed-btn').addEventListener('click', () => {
  if (!confirm('Remove all completed tasks?')) return;
  state.tasks = state.tasks.filter(t => !t.completed);
  saveState();
  render();
  closeSettings();
  showToast('Completed tasks cleared.');
});

document.getElementById('clear-all-btn').addEventListener('click', () => {
  if (!confirm('Clear ALL tasks? This cannot be undone.')) return;
  state.tasks = [];
  saveState();
  render();
  closeSettings();
  showToast('All tasks cleared.');
});

// ======================================================
// CONFETTI
// ======================================================

const canvas = document.getElementById('confetti-canvas');
const ctx = canvas.getContext('2d');
let particles = [];
let raf = null;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function spawnParticles(x, y, count) {
  const colors = ['#7c6aff','#69db7c','#ffa94d','#74c0fc','#f783ac','#51cf66','#fff'];
  for (let i = 0; i < count; i++) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 10,
      vy: Math.random() * -9 - 2,
      color: colors[i % colors.length],
      size: Math.random() * 6 + 3,
      rot: Math.random() * 360,
      rotV: (Math.random() - 0.5) * 12,
      life: 1,
      decay: Math.random() * 0.018 + 0.012
    });
  }
  if (!raf) animateConfetti();
}

function fireConfetti(el) {
  const r = el.getBoundingClientRect();
  spawnParticles(r.left + r.width / 2, r.top + r.height / 2, 22);
}

function fireConfettiCenter() {
  spawnParticles(canvas.width / 2, canvas.height * 0.4, 50);
}

function animateConfetti() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles = particles.filter(p => p.life > 0);

  particles.forEach(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.28;
    p.vx *= 0.99;
    p.rot += p.rotV;
    p.life -= p.decay;

    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot * Math.PI / 180);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.55);
    ctx.restore();
  });

  if (particles.length) {
    raf = requestAnimationFrame(animateConfetti);
  } else {
    raf = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// ======================================================
// TOASTS
// ======================================================

function showToast(msg) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  container.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('visible')));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 350);
  }, 2800);
}

// ======================================================
// KEYBOARD SHORTCUTS
// ======================================================

document.addEventListener('keydown', e => {
  if (e.target.matches('input,textarea,select')) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openAddModal(); }
  if (e.key === 'b' || e.key === 'B') { e.preventDefault(); openBrainDump(); }
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); focusState.active ? closeFocusMode() : openFocusMode(); }
  if (e.key === 'Escape') { closeFocusMode(); closeTaskModal(); closeBrainDump(); closeSettings(); }
});

// ======================================================
// SAMPLE TASKS (first run only)
// ======================================================

function addSampleTasks() {
  const t = todayStr();
  const tom = new Date(); tom.setDate(tom.getDate() + 1);
  const yest = new Date(); yest.setDate(yest.getDate() - 1);

  [
    {
      title: 'Try the Brain Dump — type or speak your thoughts',
      priority: 'high', category: 'Personal', size: 'quick', dueDate: t,
      notes: 'Click "Brain Dump" in the header. Type everything on your mind, then let AI turn it into tasks. You can also tap the mic to speak!'
    },
    {
      title: 'Review the quarterly report',
      priority: 'high', category: 'Work', size: 'medium', dueDate: t
    },
    {
      title: 'Reply to Sarah about the team meeting',
      priority: 'medium', category: 'Work', size: 'quick', dueDate: yest.toISOString().slice(0, 10)
    },
    {
      title: 'Schedule dentist appointment',
      priority: 'low', category: 'Health', size: 'quick',
      notes: 'It\'s been a while — just a 5-minute call to book it.'
    },
    {
      title: 'Grocery run',
      priority: 'medium', category: 'Home', size: 'medium', dueDate: tom.toISOString().slice(0, 10),
      notes: 'Milk, eggs, coffee, fruit, pasta'
    }
  ].forEach(t => addTask(t));
}

// ======================================================
// INIT
// ======================================================

loadState();
if (state.tasks.length === 0) addSampleTasks();
initSpeech();
render();
