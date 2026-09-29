(function () {
  const vscode = acquireVsCodeApi();

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'update') {
      renderBoard(message.data);
    }
  });

  function renderBoard(data) {
    const root = document.getElementById('board-root');
    if (root === null) {
      return;
    }

    root.innerHTML = '';
    root.className = 'board-root';
    root.appendChild(createEisenhowerMatrix(data.eisenhower));
    root.appendChild(createKanbanBoard(data.kanban));
  }

  function createEisenhowerMatrix(eisenhower) {
    const section = document.createElement('section');
    section.className = 'eisenhower-section';

    const heading = document.createElement('h2');
    heading.textContent = 'Eisenhower Matrix';
    section.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'eisenhower-matrix';
    [
      ['q1', 'Q1 — Do (Urgent+Important)'],
      ['q2', 'Q2 — Schedule (Important)'],
      ['q3', 'Q3 — Delegate (Urgent)'],
      ['q4', 'Q4 — Eliminate'],
    ].forEach(([key, label]) => {
      grid.appendChild(createEisenhowerCell(label, eisenhower[key] || []));
    });
    section.appendChild(grid);

    const unassigned = document.createElement('div');
    unassigned.className = 'unassigned-section';
    const unassignedHeading = document.createElement('h3');
    unassignedHeading.textContent = 'Unassigned';
    unassigned.appendChild(unassignedHeading);
    appendTasks(unassigned, eisenhower.unassigned || []);
    section.appendChild(unassigned);

    return section;
  }

  function createEisenhowerCell(label, tasks) {
    const cell = document.createElement('div');
    cell.className = 'eisenhower-cell';
    const heading = document.createElement('h3');
    heading.textContent = label;
    cell.appendChild(heading);
    appendTasks(cell, tasks);
    return cell;
  }

  function createKanbanBoard(kanban) {
    const section = document.createElement('section');
    section.className = 'kanban-section';
    const heading = document.createElement('h2');
    heading.textContent = 'Kanban';
    section.appendChild(heading);

    const board = document.createElement('div');
    board.className = 'kanban-board';
    board.appendChild(createKanbanColumn('To Do', kanban.todo || []));
    board.appendChild(createKanbanColumn('Done', kanban.done || []));
    section.appendChild(board);
    return section;
  }

  function createKanbanColumn(label, tasks) {
    const column = document.createElement('div');
    column.className = 'kanban-column';
    const heading = document.createElement('h3');
    heading.textContent = label;
    column.appendChild(heading);
    const list = document.createElement('div');
    list.className = 'kanban-list';
    tasks.forEach((task) => list.appendChild(createTaskCard(task)));
    column.appendChild(list);
    return column;
  }

  function appendTasks(parent, tasks) {
    const list = document.createElement('div');
    list.className = 'task-list';
    tasks.forEach((task) => list.appendChild(createTaskCard(task)));
    parent.appendChild(list);
  }

  function createTaskCard(task) {
    const card = document.createElement('article');
    card.className = 'task-card';
    if (task.checked) {
      card.classList.add('checked');
    }

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.checked;
    checkbox.setAttribute('aria-label', 'Toggle task');
    checkbox.addEventListener('change', () => {
      card.classList.toggle('checked', checkbox.checked);
      vscode.postMessage({
        type: 'toggle',
        identity: task.identity,
        checked: checkbox.checked,
      });
    });

    const text = document.createElement('span');
    text.className = 'task-text';
    text.textContent = decodeEscapedHtml(task.text);

    const badge = document.createElement('span');
    badge.className = 'quadrant-badge';
    badge.textContent = task.quadrant;

    card.appendChild(checkbox);
    card.appendChild(text);
    card.appendChild(badge);
    return card;
  }

  function decodeEscapedHtml(text) {
    return text.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => {
      const entities = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
      };
      return entities[entity] || entity;
    });
  }
})();
