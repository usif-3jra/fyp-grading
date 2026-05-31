'use strict';

// ── Utilities ─────────────────────────────────────────────────────────

const Toast = {
  _el: null, _bs: null,
  init() {
    this._el = document.getElementById('appToast');
    this._bs = bootstrap.Toast.getOrCreateInstance(this._el, { delay: 4000 });
  },
  show(msg, type = 'success') {
    document.getElementById('toastMsg').textContent = msg;
    this._el.className = `toast align-items-center border-0 text-bg-${type === 'success' ? 'success' : type === 'error' ? 'danger' : 'warning'}`;
    this._bs.show();
  },
};

const Spinner = {
  show() { document.getElementById('spinner-overlay').classList.remove('d-none'); },
  hide() { document.getElementById('spinner-overlay').classList.add('d-none'); },
};

// Sends every call as a POST to the Vercel API route
async function gsr(fn, ...args) {
  const res = await fetch('/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: fn, args }),
  });
  if (!res.ok) throw new Error('Server error ' + res.status);
  return res.json();
}

// Authenticated gsr — prepends session token automatically
function gsrAuth(fn, ...args) {
  return gsr(fn, Auth.sessionToken || '', ...args);
}

// Escapes HTML special characters to prevent XSS in innerHTML insertions
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _showWeightTotal(elId, total, label) {
  const el = document.getElementById(elId);
  if (!el) return;
  const t = Math.round(total * 10) / 10;
  const ok = Math.round(total) === 100;
  el.innerHTML = `${label ? label + ': ' : ''}Total weight: <strong class="${ok ? 'text-success' : 'text-danger'}">${t} / 100</strong>`;
}

// ── Auth ──────────────────────────────────────────────────────────────

const Auth = {
  supervisor:   null,
  sessionToken: null,

  async login() {
    const id  = document.getElementById('login-id').value.trim();
    const pwd = document.getElementById('login-pwd').value;
    const err = document.getElementById('login-err');
    if (!id || !pwd) { err.textContent = 'Please enter your Supervisor ID and password.'; err.classList.remove('d-none'); return; }
    err.classList.add('d-none');

    const btn = document.getElementById('btn-login');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Signing in…';

    try {
      const res = await gsr('loginSupervisor', id, pwd);
      if (!res.success) {
        err.textContent = res.message;
        err.classList.remove('d-none');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-sign-in-alt me-2"></i>Sign In';
        return;
      }
      this.supervisor   = res.supervisor;
      this.sessionToken = res.sessionToken;
      document.getElementById('login-overlay').style.display = 'none';
      document.getElementById('app-body').classList.remove('d-none');
      document.getElementById('header-sup-name').textContent = res.supervisor.name;
      document.getElementById('header-sup-prog').textContent = res.supervisor.program;
      Toast.init();
      App._applyAdminMode(res.supervisor.isAdmin);
      await App.afterLogin();
    } catch (e) {
      err.textContent = 'Server error: ' + e.message;
      err.classList.remove('d-none');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-sign-in-alt me-2"></i>Sign In';
    }
  },

  logout() {
    InactivityTimer.stop();
    if (this.sessionToken) gsr('logoutSession', this.sessionToken).catch(() => {});
    this.supervisor   = null;
    this.sessionToken = null;
    document.getElementById('app-body').classList.add('d-none');
    document.getElementById('login-overlay').style.display = '';
    document.getElementById('login-id').value  = '';
    document.getElementById('login-pwd').value = '';
    document.getElementById('login-err').classList.add('d-none');
    document.getElementById('btn-login').disabled = false;
    document.getElementById('btn-login').innerHTML = '<i class="fas fa-sign-in-alt me-2"></i>Sign In';
  },

  togglePwd(inputId, btn) {
    const inp = document.getElementById(inputId);
    if (inp.type === 'password') {
      inp.type = 'text';
      btn.innerHTML = '<i class="fas fa-eye-slash"></i>';
    } else {
      inp.type = 'password';
      btn.innerHTML = '<i class="fas fa-eye"></i>';
    }
  },

  async changePassword() {
    const current  = document.getElementById('pwd-current').value;
    const newPwd   = document.getElementById('pwd-new').value;
    const confirm  = document.getElementById('pwd-confirm').value;
    const errEl    = document.getElementById('pwd-err');
    errEl.classList.add('d-none');

    if (!current || !newPwd || !confirm) { errEl.textContent = 'All fields are required.'; errEl.classList.remove('d-none'); return; }
    if (newPwd !== confirm)              { errEl.textContent = 'New passwords do not match.'; errEl.classList.remove('d-none'); return; }
    if (newPwd.length < 6)              { errEl.textContent = 'Password must be at least 6 characters.'; errEl.classList.remove('d-none'); return; }

    Spinner.show();
    try {
      const res = await gsrAuth('changePassword', current, newPwd);
      if (!res.success) { errEl.textContent = res.message; errEl.classList.remove('d-none'); return; }
      bootstrap.Modal.getInstance(document.getElementById('modalChangePwd')).hide();
      ['pwd-current','pwd-new','pwd-confirm'].forEach(id => document.getElementById(id).value = '');
      Toast.show('Password updated successfully.');
    } catch (e) { errEl.textContent = 'Error: ' + e.message; errEl.classList.remove('d-none'); }
    finally { Spinner.hide(); }
  },
};

// ── Inactivity Timer ──────────────────────────────────────────────────

const InactivityTimer = {
  WARN_MS:   30 * 60 * 1000,
  LOGOUT_MS:  5 * 60 * 1000,
  _warnT:    null,
  _interval: null,
  _active:   false,
  _warned:   false,

  start() {
    this._active = true;
    const events = ['mousemove','keydown','click','scroll','touchstart'];
    events.forEach(ev => document.addEventListener(ev, this._onActivity.bind(this), { passive: true }));
    this._schedule();
  },

  stop() {
    this._active = false;
    clearTimeout(this._warnT);
    clearInterval(this._interval);
    this._warned = false;
    const modal = bootstrap.Modal.getInstance(document.getElementById('modalInactivity'));
    if (modal) modal.hide();
  },

  _onActivity() {
    if (!this._active || this._warned) return;
    this._schedule();
  },

  _schedule() {
    clearTimeout(this._warnT);
    this._warnT = setTimeout(() => this._showWarning(), this.WARN_MS);
  },

  _showWarning() {
    this._warned = true;
    let remaining = Math.floor(this.LOGOUT_MS / 1000);
    const el = document.getElementById('inactivity-countdown');
    if (el) el.textContent = this._fmt(remaining);
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalInactivity')).show();
    this._interval = setInterval(() => {
      remaining--;
      if (el) el.textContent = this._fmt(remaining);
      if (remaining <= 0) {
        clearInterval(this._interval);
        bootstrap.Modal.getInstance(document.getElementById('modalInactivity'))?.hide();
        Auth.logout();
      }
    }, 1000);
  },

  stayLoggedIn() {
    clearInterval(this._interval);
    this._warned = false;
    bootstrap.Modal.getInstance(document.getElementById('modalInactivity'))?.hide();
    this._schedule();
  },

  _fmt(s) {
    return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  },
};

// ── App ───────────────────────────────────────────────────────────────

const App = {
  _applyAdminMode(isAdmin) {
    const manageBtn    = document.getElementById('btn-manage-users');
    if (manageBtn)     manageBtn.classList.toggle('d-none', !isAdmin);


    if (!isAdmin) {
      ['cfg-tw-weight','cfg-peer-weight','cfg-sup-weight'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.setAttribute('readonly', true);
      });
      ['btn-save-group-rubric','btn-save-indiv-rubric','btn-save-rubric'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('d-none');
      });
      document.querySelectorAll('.admin-only-field').forEach(el => el.classList.add('d-none'));

      const configNavItem = document.getElementById('tw-config-nav-item');
      if (configNavItem) configNavItem.classList.add('d-none');

      const configPane = document.getElementById('tw-config');
      const gradePane  = document.getElementById('tw-grade');
      const configBtn  = document.getElementById('tw-config-tab-btn');
      const gradeBtn   = document.getElementById('tw-grade-tab-btn');
      if (configPane) { configPane.classList.remove('show', 'active'); }
      if (gradePane)  { gradePane.classList.add('show', 'active'); }
      if (configBtn)  { configBtn.classList.remove('active'); }
      if (gradeBtn)   { gradeBtn.classList.add('active'); }
    }

    const muModal = document.getElementById('modalManageUsers');
    if (muModal) {
      muModal.addEventListener('show.bs.modal', () => Admin.loadUsers());
    }
  },

  async afterLogin() {
    await Promise.all([
      App.loadKPIs(),
      Reg.init(),
      TW.init(),
      Ex.loadProjects(),
    ]);
    document.querySelector('[data-bs-target="#tab-ex"]').addEventListener('shown.bs.tab', () => Ex.loadProjects());
    document.querySelector('[data-bs-target="#tab-tw"]').addEventListener('shown.bs.tab', () => TW.refreshProjectList());
    document.querySelector('[data-bs-target="#tab-tw"]').addEventListener('hide.bs.tab', () => TW.stopPolling());
    InactivityTimer.start();
  },

  async loadKPIs() {
    try {
      const d = await gsrAuth('getKPIs');
      document.getElementById('val-fyp1').textContent = d.fyp1;
      document.getElementById('val-fyp2').textContent = d.fyp2;
      document.getElementById('val-stu').textContent  = d.students;
      document.getElementById('val-proj').textContent = d.projects;
    } catch (e) { console.warn('KPI load failed', e); }
  },

};

// ── Tab 1: Registration ───────────────────────────────────────────────

const Reg = {
  programs: [],
  allSupervisors: [],
  studentCount: 0,
  _projectsCache: [],
  _studentsCache: [],
  _submitting: false,

  async init() {
    this._buildYears();
    this._setSemesterField();
    await this._loadMasterData();
    this._initFirstSupRow();
    document.getElementById('studentRows').innerHTML = '';
    this.studentCount = 0;
    this.addStudentRow();
    this.loadProjects();

    document.getElementById('ms-program').innerHTML =
      this.programs.map(p => `<option>${p}</option>`).join('');

    document.getElementById('formRegister').addEventListener('submit', e => {
      e.preventDefault(); Reg.submit();
    });
  },

  _currentSemester() {
    const m = new Date().getMonth() + 1; // 1-12
    return (m >= 9 || m === 1) ? 'Fall' : 'Spring';
  },

  _setSemesterField() {
    const el = document.getElementById('f-semester');
    if (el) el.value = this._currentSemester();
  },

  _buildYears() {
    const sel = document.getElementById('f-year');
    sel.innerHTML = '';
    const START = 2025;
    for (let i = 0; i < 10; i++) {
      const y1 = START + i, y2 = y1 + 1;
      const val = `${y1}-${y2}`;
      sel.innerHTML += `<option value="${val}">${val}</option>`;
    }
  },

  async _loadMasterData() {
    try {
      [this.programs, this.allSupervisors] = await Promise.all([
        gsr('getPrograms'),
        gsrAuth('getAllSupervisors'),
      ]);
    } catch (e) { console.warn('_loadMasterData failed', e); }
  },

  _initFirstSupRow() {
    const first = document.querySelector('#supervisorRows .sup-row');
    if (first) this._populateProgDrop(first.querySelector('.prog-select'));
  },

  _populateProgDrop(sel) {
    sel.innerHTML = '<option value="">Select program…</option>' +
      this.programs.map(p => `<option value="${p}">${p}</option>`).join('');
    sel.addEventListener('change', () => this._onProgChange(sel));
  },

  _onProgChange(progSel) {
    const row    = progSel.closest('.sup-row');
    const supSel = row.querySelector('.sup-select');
    const list   = this.allSupervisors.filter(s => s.program === progSel.value);
    supSel.innerHTML = '<option value="">Select supervisor…</option>' +
      list.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  },

  addSupRow() {
    const container = document.getElementById('supervisorRows');
    const div = document.createElement('div');
    div.className = 'sup-row row g-2 mb-2 align-items-end';
    div.innerHTML = `
      <div class="col-md-4">
        <label class="form-label">Program Type <span class="req">*</span></label>
        <select class="form-select prog-select" required><option value="">Select program…</option></select>
      </div>
      <div class="col-md-5">
        <label class="form-label">Supervisor Name <span class="req">*</span></label>
        <select class="form-select sup-select" required><option value="">Select supervisor…</option></select>
      </div>
      <div class="col-auto">
        <button type="button" class="btn btn-outline-danger btn-sm" onclick="Reg.removeSupRow(this)"><i class="fas fa-trash"></i></button>
      </div>`;
    container.appendChild(div);
    this._populateProgDrop(div.querySelector('.prog-select'));
  },

  removeSupRow(btn) {
    const rows = document.querySelectorAll('#supervisorRows .sup-row');
    if (rows.length <= 1) { Toast.show('At least one supervisor is required.', 'warning'); return; }
    btn.closest('.sup-row').remove();
  },

  addStudentRow() {
    const container = document.getElementById('studentRows');
    const div = document.createElement('div');
    div.className = 'stu-row row g-2 mb-2 align-items-end';
    div.innerHTML = `
      <div class="col-md-3">
        <label class="form-label">Student Name <span class="req">*</span></label>
        <input type="text" class="form-control stu-name" placeholder="Full name" maxlength="100" required/>
      </div>
      <div class="col-md-2">
        <label class="form-label">Student ID <span class="req">*</span></label>
        <input type="text" class="form-control stu-id" placeholder="e.g. 202100123" maxlength="9" pattern="20[0-9]{7}" title="9 digits starting with 20" required/>
      </div>
      <div class="col-md-3">
        <label class="form-label">Email</label>
        <input type="email" class="form-control stu-email" placeholder="student@university.edu" maxlength="100"/>
      </div>
      <div class="col-auto">
        <button type="button" class="btn btn-outline-danger btn-sm" onclick="Reg.removeStudentRow(this)"><i class="fas fa-trash"></i></button>
      </div>`;
    container.appendChild(div);
    this.studentCount++;
  },

  removeStudentRow(btn) {
    const rows = document.querySelectorAll('#studentRows .stu-row');
    if (rows.length <= 1) { Toast.show('At least one student is required.', 'warning'); return; }
    btn.closest('.stu-row').remove();
  },

  _gatherSupervisors() {
    const seen = new Set(), result = [];
    document.querySelectorAll('#supervisorRows .sup-row').forEach(row => {
      const id = row.querySelector('.sup-select').value;
      if (!id) return;
      if (seen.has(id)) throw new Error('Duplicate supervisor selected.');
      seen.add(id);
      const sup = this.allSupervisors.find(s => s.id === id);
      result.push({ id, name: sup ? sup.name : '' });
    });
    return result;
  },

  _gatherStudents() {
    return [...document.querySelectorAll('#studentRows .stu-row')].map(row => ({
      name:  row.querySelector('.stu-name').value.trim(),
      id:    row.querySelector('.stu-id').value.trim(),
      email: row.querySelector('.stu-email').value.trim(),
    }));
  },

  async submit() {
    if (this._submitting) return;
    this._submitting = true;
    const btn = document.getElementById('btnRegister');
    btn.disabled = true; Spinner.show();
    try {
      const supervisors = this._gatherSupervisors();
      if (!supervisors.length) throw new Error('Select at least one supervisor.');

      const students = this._gatherStudents();
      if (!students.length || students.some(s => !s.name || !s.id))
        throw new Error('All student rows must have a name and ID.');
      const _idFmt = /^20\d{7}$/;
      const _badId = students.find(s => !_idFmt.test(s.id));
      if (_badId) throw new Error(`Invalid Student ID "${_badId.id}" — must be exactly 9 digits starting with 20 (e.g. 20210123).`);

      const payload = {
        title:    document.getElementById('f-title').value.trim(),
        type:     document.getElementById('f-type').value,
        semester: document.getElementById('f-semester').value,
        year:     document.getElementById('f-year').value,
        programType: document.querySelector('#supervisorRows .prog-select').value,
        supervisors, students,
        disableNotifications: !document.getElementById('f-enableNotif').checked,
      };
      if (!payload.title || !payload.type || !payload.semester || !payload.year)
        throw new Error('Please fill all required project fields.');

      const res = await gsrAuth('registerProject', payload);
      if (!res.success) throw new Error(res.message);

      Toast.show('Project registered! ID: ' + res.projectId);
      document.getElementById('formRegister').reset();
      this._buildYears();
      this._setSemesterField();
      this._initFirstSupRow();
      document.getElementById('studentRows').innerHTML = '';
      this.studentCount = 0;
      this.addStudentRow();
      this.loadProjects();
      App.loadKPIs();
      TW.refreshProjectList();
      Ex.loadProjects();
    } catch (e) { Toast.show(e.message || e.toString(), 'error'); }
    finally { btn.disabled = false; Spinner.hide(); this._submitting = false; }
  },

  async loadProjects() {
    try {
      const [projects, students] = await Promise.all([
        gsrAuth('getProjectsFiltered'),
        gsrAuth('getStudents'),
      ]);
      this._projectsCache = projects;
      this._studentsCache = students;
      const tbody = document.getElementById('tbProjects');
      if (!projects.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No projects registered yet.</td></tr>';
        return;
      }
      const isAdmin = Auth.supervisor && Auth.supervisor.isAdmin;
      const myId    = Auth.supervisor && Auth.supervisor.id;
      tbody.innerHTML = projects.map(p => {
        const cnt    = students.filter(s => s.ProjectID === p.ProjectID).length;
        const supIds = (p.Supervisors || '').split(',').map(x => x.trim()).filter(Boolean);
        const supNames = supIds.map(sid => {
          const s = this.allSupervisors.find(x => x.id === sid);
          return s ? s.name : sid;
        }).join(', ');
        const programs = [...new Set(supIds.map(sid => {
          const s = this.allSupervisors.find(x => x.id === sid);
          return s ? s.program : '';
        }).filter(Boolean))].join(', ') || escHtml(p.ProgramType);
        const canEdit = isAdmin || supIds.includes(myId);
        const actions = canEdit
          ? `<button class="btn btn-sm btn-outline-primary me-1 py-0 px-1" onclick="Reg.editProject('${escHtml(p.ProjectID)}')" title="Edit"><i class="fas fa-edit"></i></button>
             ${isAdmin ? `<button class="btn btn-sm btn-outline-danger py-0 px-1" onclick="Reg.deleteProject('${escHtml(p.ProjectID)}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}`
          : '';
        return `<tr>
          <td class="fw-medium">${escHtml(p.Title)}</td>
          <td><span class="badge ${p.Type === 'FYP1' ? 'bg-primary' : 'bg-success'}">${escHtml(p.Type)}</span></td>
          <td>${escHtml(p.Semester)}</td><td>${escHtml(p.Year)}</td>
          <td class="small">${escHtml(programs)}</td>
          <td class="small">${escHtml(supNames)}</td>
          <td><span class="badge bg-secondary">${cnt} student${cnt !== 1 ? 's' : ''}</span></td>
          <td class="text-nowrap">${actions}</td>
        </tr>`;
      }).join('');
    } catch (e) { console.warn('loadProjects', e); }
  },

  editProject(id) {
    const p = this._projectsCache.find(x => x.ProjectID === id);
    if (!p) return;
    document.getElementById('edit-project-id').value = id;
    document.getElementById('edit-title').value       = p.Title;
    document.getElementById('edit-type').value        = p.Type;
    document.getElementById('edit-semester').value    = p.Semester;
    document.getElementById('edit-enableNotif').checked = p.DisableNotifications !== 'TRUE';
    document.getElementById('edit-err').classList.add('d-none');
    const yearSel = document.getElementById('edit-year');
    yearSel.innerHTML = '';
    const years = new Set();
    for (let i = 0; i < 10; i++) { const y = 2024 + i; years.add(`${y}-${y + 1}`); }
    if (p.Year) years.add(p.Year);
    [...years].sort().forEach(v => {
      yearSel.innerHTML += `<option value="${v}"${v === p.Year ? ' selected' : ''}>${v}</option>`;
    });
    const container = document.getElementById('edit-student-rows');
    container.innerHTML = '';
    this._studentsCache
      .filter(s => s.ProjectID === id)
      .forEach(s => container.appendChild(this._renderEditStudentRow(s, true)));
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalEditProject')).show();
  },

  _renderEditStudentRow(s, isExisting) {
    const row = document.createElement('div');
    row.className = 'row g-1 mb-2 align-items-center edit-student-row';
    if (isExisting) row.dataset.existingId = s.StudentID;
    row.innerHTML = `
      <div class="col-md-4">
        <input type="text" class="form-control form-control-sm edit-stu-name" placeholder="Full Name *" value="${escHtml(s.StudentName || '')}" maxlength="100" required/>
      </div>
      <div class="col-md-3">
        <input type="text" class="form-control form-control-sm edit-stu-id" placeholder="Student ID *" value="${escHtml(s.StudentID || '')}"${isExisting ? ' readonly style="background:#f8fafc;color:#64748b;"' : ' maxlength="9" pattern="20[0-9]{7}" title="9 digits starting with 20"'} required/>
      </div>
      <div class="col-md-4">
        <input type="email" class="form-control form-control-sm edit-stu-email" placeholder="Email" value="${escHtml(s.Email || '')}" maxlength="100"/>
      </div>
      <div class="col-auto">
        <button type="button" class="btn btn-outline-danger btn-sm py-0 px-1" onclick="this.closest('.edit-student-row').remove()" title="Remove student">
          <i class="fas fa-trash"></i>
        </button>
      </div>`;
    return row;
  },

  addEditStudentRow() {
    document.getElementById('edit-student-rows')
      .appendChild(this._renderEditStudentRow({ StudentID: '', StudentName: '', Email: '' }, false));
  },

  async saveEditProject() {
    const id    = document.getElementById('edit-project-id').value;
    const title = document.getElementById('edit-title').value.trim();
    const errEl = document.getElementById('edit-err');
    errEl.classList.add('d-none');
    if (!title) { errEl.textContent = 'Title is required.'; errEl.classList.remove('d-none'); return; }

    const students = [];
    let studsValid = true;
    document.querySelectorAll('#edit-student-rows .edit-student-row').forEach(row => {
      const name  = row.querySelector('.edit-stu-name').value.trim();
      const sid   = row.querySelector('.edit-stu-id').value.trim();
      const email = row.querySelector('.edit-stu-email').value.trim();
      if (!name || !sid) { studsValid = false; return; }
      students.push({ studentId: sid, studentName: name, email, isExisting: !!row.dataset.existingId });
    });
    if (!studsValid) { errEl.textContent = 'All student rows must have a name and ID.'; errEl.classList.remove('d-none'); return; }
    const _idFmt2 = /^20\d{7}$/;
    const _newBad = students.find(s => !s.isExisting && !_idFmt2.test(s.studentId));
    if (_newBad) { errEl.textContent = `Invalid Student ID "${_newBad.studentId}" — must be exactly 9 digits starting with 20.`; errEl.classList.remove('d-none'); return; }

    Spinner.show();
    try {
      const res = await gsrAuth('updateProject', id, {
        title,
        type:                 document.getElementById('edit-type').value,
        semester:             document.getElementById('edit-semester').value,
        year:                 document.getElementById('edit-year').value,
        disableNotifications: !document.getElementById('edit-enableNotif').checked,
        students,
      });
      if (!res.success) { errEl.textContent = res.message; errEl.classList.remove('d-none'); return; }
      bootstrap.Modal.getInstance(document.getElementById('modalEditProject')).hide();
      Toast.show('Project updated.');
      this.loadProjects();
      App.loadKPIs();
    } catch (e) { errEl.textContent = 'Error: ' + e.message; errEl.classList.remove('d-none'); }
    finally { Spinner.hide(); }
  },

  async deleteProject(id) {
    const p = this._projectsCache.find(x => x.ProjectID === id);
    if (!confirm(`Delete "${p ? p.Title : id}" and all its grades?\n\nThis cannot be undone.`)) return;
    Spinner.show();
    try {
      const res = await gsrAuth('deleteProject', id);
      if (!res.success) { Toast.show(res.message, 'error'); return; }
      Toast.show('Project deleted.');
      this.loadProjects();
      App.loadKPIs();
      TW.refreshProjectList();
      Ex.loadProjects();
    } catch (e) { Toast.show('Error: ' + e.message, 'error'); }
    finally { Spinner.hide(); }
  },

  async saveSupervisorToSystem() {
    const name     = document.getElementById('ms-name').value.trim();
    const program  = document.getElementById('ms-program').value;
    const email    = document.getElementById('ms-email').value.trim();
    const password = document.getElementById('ms-password').value.trim();
    if (!name || !program) { Toast.show('Name and program are required.', 'warning'); return; }
    Spinner.show();
    try {
      const res = await gsrAuth('addSupervisorToSystem', name, program, email, password || 'fyp2025');
      if (!res.success) throw new Error(res.message);
      Toast.show(`Supervisor added. Password: ${password || 'fyp2025'}`);
      await this._loadMasterData();
      document.getElementById('ms-password').value = '';
      bootstrap.Modal.getInstance(document.getElementById('modalAddSupervisor')).hide();
    } catch (e) { Toast.show(e.message, 'error'); }
    finally { Spinner.hide(); }
  },
};

// ── Tab 2: Teamwork & Peer Eval ───────────────────────────────────────

const TW = {
  groupRubric:      [],
  individualRubric: [],
  supervisorProjects: [],
  qrInstance:       null,

  async init() {
    try {
      const cfg = await gsr('getTeamworkConfig');
      document.getElementById('cfg-tw-weight').value     = cfg.teamwork_weight     || 35;
      document.getElementById('cfg-report-weight').value = cfg.report_weight       || 35;
      document.getElementById('cfg-pres-weight').value   = cfg.presentation_weight || 30;
      document.getElementById('cfg-peer-weight').value   = cfg.peer_eval_weight    || 20;
      document.getElementById('cfg-sup-weight').value    = cfg.supervisor_weight   || 80;
      const semEndEl = document.getElementById('cfg-semester-end');
      if (semEndEl) semEndEl.value = cfg.semester_end_date || '';

      this._refreshMainWeightTotal();
      ['cfg-tw-weight', 'cfg-report-weight', 'cfg-pres-weight'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => this._refreshMainWeightTotal());
      });

      this._updateCountdown(cfg.semester_end_date || '');

      this.individualRubric = await gsr('getIndividualRubric');
      this._renderTWRubric('twIndivRubricList', this.individualRubric);
      this._refreshTWTotal('individual');

      const indivEl = document.getElementById('twIndivRubricList');
      if (indivEl) {
        indivEl.addEventListener('input',  () => this._refreshTWTotal('individual'));
        indivEl.addEventListener('change', () => this._refreshTWTotal('individual'));
      }

      await this._loadPeerConfig();

      const isAdmin = Auth.supervisor && Auth.supervisor.isAdmin;
      if (!isAdmin) {
        document.querySelectorAll('#tw-config input, #tw-config select, #tw-config button.btn-primary, #tw-config button.btn-outline-primary').forEach(el => {
          el.disabled = true;
        });
      }

      if (Auth.supervisor) {
        document.getElementById('tw-grading-as').textContent = Auth.supervisor.name;
      }
      await this.refreshProjectList();
    } catch (e) { console.warn('TW.init error', e); }
  },

  async _loadPeerConfig() {
    const questions = await gsr('getPeerEvalConfig');
    this._renderPeerQuestions(questions);
    this._refreshPeerTotal();
    const peerList = document.getElementById('peerQsList');
    if (peerList) {
      peerList.addEventListener('input',  () => this._refreshPeerTotal());
      peerList.addEventListener('change', () => this._refreshPeerTotal());
    }
  },

  _renderPeerQuestions(questions) {
    const isAdmin = Auth.supervisor && Auth.supervisor.isAdmin;
    const c = document.getElementById('peerQsList');
    c.innerHTML = '';
    questions.forEach(q => {
      const row = document.createElement('div');
      row.className = 'peer-q-row';
      const aOpts = ['','5a','5b','2a','2b','7a','7b'].map(o =>
        `<option value="${o}" ${String(q.AbetOutcome||'') === o ? 'selected' : ''}>${o || 'None'}</option>`
      ).join('');
      row.innerHTML = `
        <input type="text"   class="form-control form-control-sm pq-text"   value="${q.QuestionText || ''}" placeholder="Question text" ${isAdmin ? '' : 'readonly'}/>
        <input type="number" class="form-control form-control-sm pq-max"    value="${q.MaxGrade || 10}" min="1" max="100" title="Max Grade" ${isAdmin ? '' : 'readonly'}/>
        <input type="number" class="form-control form-control-sm pq-weight" value="${q.Weight   || 20}" min="1" max="100" title="Weight %" ${isAdmin ? '' : 'readonly'}/>
        <select class="form-select form-select-sm pq-abet" title="ABET Outcome" ${isAdmin ? '' : 'disabled'}>${aOpts}</select>
        ${isAdmin ? '<button type="button" class="btn btn-outline-danger btn-sm" onclick="this.closest(\'.peer-q-row\').remove()"><i class="fas fa-times"></i></button>' : '<span></span>'}`;
      c.appendChild(row);
    });
  },

  addPeerQuestion() {
    if (!Auth.supervisor || !Auth.supervisor.isAdmin) { Toast.show('Only admins can add questions.', 'warning'); return; }
    const row = document.createElement('div');
    row.className = 'peer-q-row';
    const aOpts = ['','5a','5b','2a','2b','7a','7b'].map(o => `<option value="${o}">${o || 'None'}</option>`).join('');
    row.innerHTML = `
      <input type="text"   class="form-control form-control-sm pq-text"   placeholder="Question text"/>
      <input type="number" class="form-control form-control-sm pq-max"    value="10" min="1" max="100" title="Max Grade"/>
      <input type="number" class="form-control form-control-sm pq-weight" value="20" min="1" max="100" title="Weight %"/>
      <select class="form-select form-select-sm pq-abet" title="ABET Outcome">${aOpts}</select>
      <button type="button" class="btn btn-outline-danger btn-sm" onclick="this.closest('.peer-q-row').remove()"><i class="fas fa-times"></i></button>`;
    document.getElementById('peerQsList').appendChild(row);
    this._refreshPeerTotal();
  },

  _refreshMainWeightTotal() {
    const tw = parseFloat(document.getElementById('cfg-tw-weight').value)     || 0;
    const rp = parseFloat(document.getElementById('cfg-report-weight').value) || 0;
    const pr = parseFloat(document.getElementById('cfg-pres-weight').value)   || 0;
    _showWeightTotal('main-weight-total', tw + rp + pr);
  },

  _updateCountdown(endDateStr) {
    const el = document.getElementById('header-countdown');
    const txt = document.getElementById('header-countdown-text');
    if (!el || !txt || !endDateStr) return;
    const now = new Date();
    const end = new Date(endDateStr);
    const m = now.getMonth() + 1;
    const semester = (m >= 9 || m === 1) ? 'Fall' : 'Spring';
    const year = now.getFullYear();
    const diffMs = end - now;
    if (diffMs <= 0) {
      txt.textContent = `${semester} ${year} — Semester ended`;
    } else {
      const totalDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      const weeks = Math.floor(totalDays / 7);
      const days  = totalDays % 7;
      txt.textContent = `${weeks}W:${days}D remaining · ${semester} ${year}`;
    }
    el.classList.remove('d-none');
  },

  _refreshPeerTotal() {
    const total = [...document.querySelectorAll('#peerQsList .pq-weight')].reduce((s, el) => s + (parseFloat(el.value) || 0), 0);
    _showWeightTotal('peer-weight-total', total);
  },

  _refreshTWTotal(type) {
    const listId = type === 'group' ? 'twGroupRubricList' : 'twIndivRubricList';
    const elId   = type === 'group' ? 'group-weight-total' : 'indiv-weight-total';
    const total  = [...document.querySelectorAll(`#${listId} .tw-weight`)].reduce((s, el) => s + (parseFloat(el.value) || 0), 0);
    _showWeightTotal(elId, total);
  },

  async saveConfig() {
    Spinner.show();
    try {
      await gsrAuth('saveTeamworkConfig', {
        teamwork_weight:     document.getElementById('cfg-tw-weight').value,
        report_weight:       document.getElementById('cfg-report-weight').value,
        presentation_weight: document.getElementById('cfg-pres-weight').value,
        peer_eval_weight:    document.getElementById('cfg-peer-weight').value,
        supervisor_weight:   document.getElementById('cfg-sup-weight').value,
      });
      Toast.show('Grade weights saved.');
    } catch (e) { Toast.show(e.message || e, 'error'); }
    finally { Spinner.hide(); }
  },

  async saveSemesterEndDate() {
    if (!Auth.supervisor || !Auth.supervisor.isAdmin) { Toast.show('Only admins can set the semester end date.', 'warning'); return; }
    const date = document.getElementById('cfg-semester-end').value;
    if (!date) { Toast.show('Please select a date first.', 'warning'); return; }
    Spinner.show();
    try {
      const res = await gsrAuth('saveSemesterEndDate', date);
      if (!res.success) throw new Error(res.message);
      Toast.show('Semester end date saved. Presentation tab will unlock for examiners after ' + date + '.');
    } catch (e) { Toast.show(e.message || e, 'error'); }
    finally { Spinner.hide(); }
  },

  async savePeerConfig() {
    const questions = [];
    document.querySelectorAll('.peer-q-row').forEach(row => {
      const text   = row.querySelector('.pq-text').value.trim();
      const max    = parseFloat(row.querySelector('.pq-max').value)    || 10;
      const weight = parseFloat(row.querySelector('.pq-weight').value) || 20;
      const abet   = row.querySelector('.pq-abet').value || '';
      if (text) questions.push({ text, maxGrade: max, weight, abetOutcome: abet });
    });
    if (!questions.length) { Toast.show('Add at least one question.', 'warning'); return; }
    const peerTotal = questions.reduce((s, q) => s + q.weight, 0);
    if (Math.round(peerTotal) !== 100) {
      Toast.show(`Peer question weights must sum to 100 (currently ${peerTotal}).`, 'warning');
      return;
    }
    Spinner.show();
    try {
      await gsrAuth('savePeerEvalConfig', questions);
      Toast.show('Peer evaluation questions saved.');
    } catch (e) { Toast.show(e.message || e, 'error'); }
    finally { Spinner.hide(); }
  },

  _pollInterval: null,

  onPeerTabShown() {
    this.generateQR();
    this.refreshPeerStatus();
    if (this._pollInterval) clearInterval(this._pollInterval);
    this._pollInterval = setInterval(() => this.refreshPeerStatus(), 20000);
  },

  stopPolling() {
    if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
  },

  async generateQR() {
    Spinner.show();
    try {
      const url = await gsrAuth('getPeerEvalURL');
      document.getElementById('peer-url').value = url;
      const container = document.getElementById('qrcode');
      container.innerHTML = '';
      this.qrInstance = null;
      this.qrInstance = new QRCode(container, {
        text: url, width: 220, height: 220,
        colorDark: '#1e3a5f', colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H,
      });
    } catch (e) { Toast.show('Error generating QR: ' + e, 'error'); }
    finally { Spinner.hide(); }
  },

  copyPeerURL() {
    const val = document.getElementById('peer-url').value;
    if (!val) { Toast.show('Generate the QR first.', 'warning'); return; }
    navigator.clipboard.writeText(val).then(() => Toast.show('Link copied to clipboard.'));
  },

  async refreshPeerStatus() {
    const c = document.getElementById('peerStatusContainer');
    c.innerHTML = '<div class="text-muted small"><span class="spinner-border spinner-border-sm me-2"></span>Loading…</div>';
    try {
      const statuses = await gsrAuth('getPeerEvalStatus');
      if (!statuses.length) {
        c.innerHTML = '<p class="text-muted small">No projects found for your account.</p>';
        return;
      }
      c.innerHTML = statuses.map(proj => {
        const headerBadge = proj.allSubmitted
          ? `<span class="badge-all-done"><i class="fas fa-check me-1"></i>All Submitted</span>`
          : `<span class="badge-pending"><i class="fas fa-clock me-1"></i>Pending</span>`;
        const rows = proj.students.map(s => `
          <div class="student-status-row">
            <span><i class="fas fa-user me-2 text-muted"></i>${escHtml(s.name)} <small class="text-muted">(${escHtml(s.id)})</small></span>
            ${s.submitted
              ? '<span class="status-icon-done"><i class="fas fa-check-circle"></i> Submitted</span>'
              : '<span class="status-icon-pending"><i class="fas fa-circle-notch fa-spin"></i> Pending</span>'}
          </div>`).join('');
        return `
          <div class="peer-status-card">
            <div class="peer-status-header">
              <span class="project-name"><i class="fas fa-folder-open me-2 text-primary"></i>${escHtml(proj.projectTitle)}</span>
              ${headerBadge}
            </div>
            <div class="peer-status-body">
              ${rows || '<p class="text-muted small mb-0">No students in this project.</p>'}
            </div>
          </div>`;
      }).join('');
    } catch (e) { c.innerHTML = '<p class="text-danger small">Error loading status: ' + e.message + '</p>'; }
  },

  async refreshProjectList() {
    if (!Auth.supervisor) return;
    const sel    = document.getElementById('tw-project-sel');
    const notice = document.getElementById('tw-debug-notice');
    try {
      const projects = (await gsrAuth('getSupervisedProjectsForGrading')) || [];
      this.supervisorProjects = projects;

      if (!projects.length) {
        sel.innerHTML = '<option value="">— no projects assigned to you —</option>';
        if (notice) {
          notice.innerHTML = `<i class="fas fa-info-circle me-1"></i>
            No projects found for supervisor ID <strong>${Auth.supervisor.id}</strong>.
            Make sure you selected yourself as a supervisor when registering the project.`;
          notice.classList.remove('d-none');
        }
        return;
      }

      if (notice) notice.classList.add('d-none');
      sel.innerHTML = '<option value="">— choose a project —</option>' +
        projects.map(p =>
          `<option value="${p.ProjectID}">${p.Title} (${p.Type})</option>`
        ).join('');
    } catch (e) {
      sel.innerHTML = `<option value="">— error loading projects —</option>`;
      if (notice) { notice.textContent = 'Error: ' + e.message; notice.classList.remove('d-none'); }
    }
  },

  async loadGradingUI() {
    const pid  = document.getElementById('tw-project-sel').value;
    const area = document.getElementById('twGradingArea');
    if (!pid) { area.classList.add('d-none'); return; }

    const project = this.supervisorProjects.find(p => p.ProjectID === pid);
    if (!project) return;

    this._renderIndividualMatrix(project.studentList || []);
    area.classList.remove('d-none');
    await this.loadSavedGrades(pid);
  },

  async loadSavedGrades(pid) {
    try {
      const grades = await gsrAuth('getTeamworkGrades', pid);
      grades.forEach(g => {
        const inp = document.querySelector(`.ind-grade[data-criterion="${CSS.escape(g.criterion)}"][data-student="${CSS.escape(g.studentId)}"]`);
        if (!inp) return;
        inp.value = g.grade;
        const label = inp.parentElement.querySelector('.graded-by-label');
        if (label) {
          label.textContent = g.isMe ? 'You graded' : `By: ${g.gradedBy}`;
          label.className   = `graded-by-label d-block ${g.isMe ? 'text-success' : 'text-warning'}`;
        }
      });
    } catch (e) { console.warn('loadSavedGrades', e); }
  },

  _twLegend() {
    return `<div class="grade-scale-legend mb-3">
      <span class="gs-label">Scale:</span>
      <span class="gs-badge gs-unsat">Unsatisfactory 55–65</span>
      <span class="gs-badge gs-dev">Developing 66–75</span>
      <span class="gs-badge gs-meets">Meets Expectations 76–85</span>
      <span class="gs-badge gs-exceeds">Exceeds Expectations 86–95</span>
    </div>`;
  },

  _renderIndividualMatrix(students) {
    const c = document.getElementById('indGradeMatrix');
    if (!students.length) { c.innerHTML = '<p class="text-muted">No students in this project.</p>'; return; }

    const headerCells = students.map(s =>
      `<th>${s.StudentName}<br/><small class="fw-normal opacity-75">${s.StudentID}</small></th>`
    ).join('');
    const rows = this.individualRubric.map(r => {
      const cells = students.map(s =>
        `<td><input type="number" class="ind-grade"
              data-criterion="${r.criterion}" data-student="${s.StudentID}"
              min="0" max="${r.maxGrade}" step="0.5" placeholder="0–${r.maxGrade}"/>
          <small class="graded-by-label d-block text-muted"></small></td>`
      ).join('');
      return `<tr><td>${r.criterion} <small class="text-muted">(Max: ${r.maxGrade})</small></td>${cells}</tr>`;
    }).join('');

    c.innerHTML = `
      ${this._twLegend()}
      <table class="matrix-table">
        <thead><tr><th>Criterion</th>${headerCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  },

  async submitGrades() {
    const pid = document.getElementById('tw-project-sel').value;
    if (!pid) { Toast.show('Select a project first.', 'warning'); return; }

    const confirmed = await new Promise(resolve => {
      const modal = document.getElementById('modalConfirmTWSubmit');
      if (!modal) { resolve(true); return; }
      const yesBtn = document.getElementById('btn-confirm-tw-yes');
      const handler = () => { modal.removeEventListener('hidden.bs.modal', cancelHandler); resolve(true); };
      const cancelHandler = () => { yesBtn.removeEventListener('click', handler); resolve(false); };
      yesBtn.addEventListener('click', handler, { once: true });
      modal.addEventListener('hidden.bs.modal', cancelHandler, { once: true });
      bootstrap.Modal.getOrCreateInstance(modal).show();
    });
    if (!confirmed) return;

    const indGrades = [...document.querySelectorAll('.ind-grade')].map(inp => ({
      criterion: inp.dataset.criterion, studentId: inp.dataset.student, grade: parseFloat(inp.value) || 0,
    }));

    Spinner.show();
    try {
      const res = await gsrAuth('submitTeamworkGrades', pid, [], indGrades);
      if (!res.success) throw new Error(res.message);
      Toast.show('Teamwork grades submitted successfully.');
      await this.loadSavedGrades(pid);
    } catch (e) { Toast.show(e.message || e, 'error'); }
    finally { Spinner.hide(); }
  },

  _renderTWRubric(containerId, criteria) {
    const c = document.getElementById(containerId);
    if (!c) return;
    const isAdmin = Auth.supervisor && Auth.supervisor.isAdmin;
    const dis = isAdmin ? '' : 'disabled';
    const ro  = isAdmin ? '' : 'readonly';
    c.innerHTML = (criteria || []).map(cr => {
      const sel = ['','5a','5b','2a','2b','7a','7b'].map(o =>
        `<option value="${o}" ${String(cr.abetOutcome||'') === o ? 'selected' : ''}>${o || 'None'}</option>`
      ).join('');
      return `<div class="tw-rubric-row">
        <input type="text"   class="form-control form-control-sm tw-criterion" value="${cr.criterion}" placeholder="Criterion name" ${ro} style="flex:1;min-width:140px;"/>
        <input type="number" class="form-control form-control-sm tw-max"    value="${cr.maxGrade}" min="1" max="1000" title="Max Grade" ${ro} style="width:72px;"/>
        <input type="number" class="form-control form-control-sm tw-weight" value="${cr.weight}"   min="0" max="100"  title="Weight %" ${ro} style="width:68px;"/>
        <select class="form-select form-select-sm tw-abet" title="ABET Outcome" ${dis} style="width:110px;">${sel}</select>
        ${isAdmin ? `<button type="button" class="btn btn-outline-danger btn-sm px-2" onclick="this.closest('.tw-rubric-row').remove()"><i class="fas fa-times"></i></button>` : '<span style="width:32px;flex-shrink:0;"></span>'}
      </div>`;
    }).join('');
  },

  addTWRubricRow(type) {
    if (!Auth.supervisor || !Auth.supervisor.isAdmin) { Toast.show('Only admins can add rows.', 'warning'); return; }
    const c = document.getElementById(type === 'group' ? 'twGroupRubricList' : 'twIndivRubricList');
    const row = document.createElement('div');
    row.className = 'tw-rubric-row';
    const aOpts = ['','5a','5b','2a','2b','7a','7b'].map(o => `<option value="${o}">${o || 'None'}</option>`).join('');
    row.innerHTML = `
      <input type="text"   class="form-control form-control-sm tw-criterion" placeholder="Criterion name" style="flex:1;min-width:140px;"/>
      <input type="number" class="form-control form-control-sm tw-max"    value="25" min="1" max="1000" title="Max Grade" style="width:72px;"/>
      <input type="number" class="form-control form-control-sm tw-weight" value="25" min="0" max="100"  title="Weight %" style="width:68px;"/>
      <select class="form-select form-select-sm tw-abet" title="ABET Outcome" style="width:110px;">${aOpts}</select>
      <button type="button" class="btn btn-outline-danger btn-sm px-2" onclick="this.closest('.tw-rubric-row').remove()"><i class="fas fa-times"></i></button>`;
    c.appendChild(row);
    this._refreshTWTotal(type);
  },

  async saveTWRubric(type) {
    if (!Auth.supervisor || !Auth.supervisor.isAdmin) { Toast.show('Only admins can save.', 'warning'); return; }
    const listId   = type === 'group' ? 'twGroupRubricList' : 'twIndivRubricList';
    const criteria = [];
    document.querySelectorAll(`#${listId} .tw-rubric-row`).forEach(row => {
      const name = row.querySelector('.tw-criterion').value.trim();
      if (!name) return;
      criteria.push({
        criterion:   name,
        maxGrade:    parseFloat(row.querySelector('.tw-max').value)    || 25,
        weight:      parseFloat(row.querySelector('.tw-weight').value) || 25,
        abetOutcome: row.querySelector('.tw-abet').value || '',
      });
    });
    if (criteria.length) {
      const total = criteria.reduce((s, c) => s + c.weight, 0);
      if (Math.round(total) !== 100) {
        Toast.show(`${type === 'group' ? 'Group' : 'Individual'} rubric weights must sum to 100 (currently ${total}).`, 'warning');
        return;
      }
    }
    Spinner.show();
    try {
      await gsrAuth('saveTWRubric', type, criteria);
      if (type === 'group') this.groupRubric = criteria;
      else this.individualRubric = criteria;
      Toast.show((type === 'group' ? 'Group' : 'Individual') + ' rubric saved.');
    } catch(e) { Toast.show(e.message || e, 'error'); }
    finally { Spinner.hide(); }
  },
};

// ── Tab 3: Examiner Assignment ────────────────────────────────────────

const Ex = {
  assignments:  [],
  allProjects:  [],
  programs:     [],
  allSupsCache: [],

  async loadProjects() {
    try {
      [this.allProjects, this.programs, this.allSupsCache] = await Promise.all([
        gsrAuth('getAllProjectsSummary'),
        gsr('getPrograms'),
        gsrAuth('getAllSupervisors'),
      ]);
      const all = this.allProjects || [];
      const sel = document.getElementById('ex-project-sel');
      const cur = sel.value;
      sel.innerHTML = '<option value="">— choose a project —</option>' +
        all.map(p =>
          `<option value="${p.ProjectID}"${p.ProjectID === cur ? ' selected' : ''}>${p.Title} (${p.Type})</option>`
        ).join('');
      if (!document.querySelector('#rubricListFYP1 .rubric-row')) {
        const criteria = (await gsrAuth('getExaminerConfig')) || [];
        this._renderRubric(criteria);
        if (!document.querySelector('#examinerRows .ex-row')) this.addRow();
      }
    } catch (e) { console.warn('Ex.loadProjects', e); }
  },

  addRow() {
    const c = document.getElementById('examinerRows');
    const row = document.createElement('div');
    row.className = 'ex-row';
    row.innerHTML = `
      <div class="row g-2 align-items-center">
        <div class="col-md-6">
          <label class="form-label mb-1 small fw-medium">Examiner Type <span class="req">*</span></label>
          <select class="form-select form-select-sm ex-type-sel" onchange="Ex.onTypeChange(this)">
            <option value="">Select type…</option>
            <option value="Inside University">Inside University (Internal)</option>
            <option value="Industry">Industry (Presentation only)</option>
            <option value="Outside the Program/University">Outside the Program/University</option>
          </select>
        </div>
        <div class="col-auto align-self-end">
          <button type="button" class="btn btn-outline-danger btn-sm" onclick="this.closest('.ex-row').remove()"><i class="fas fa-trash"></i></button>
        </div>
      </div>
      <div class="ex-type-fields mt-2 d-none" data-for="Inside University">
        <div class="row g-2">
          <div class="col-md-6">
            <label class="form-label mb-1 small">Program</label>
            <select class="form-select form-select-sm ex-int-prog"></select>
          </div>
          <div class="col-md-6">
            <label class="form-label mb-1 small">Supervisor</label>
            <select class="form-select form-select-sm ex-int-sup"></select>
          </div>
        </div>
      </div>
      <div class="ex-type-fields mt-2 d-none" data-for="external">
        <div class="row g-2">
          <div class="col-md-4">
            <label class="form-label mb-1 small">Full Name <span class="req">*</span></label>
            <input type="text" class="form-control form-control-sm ex-ext-name" placeholder="Examiner's Name"/>
          </div>
          <div class="col-md-5">
            <label class="form-label mb-1 small">Email <span class="req">*</span></label>
            <input type="email" class="form-control form-control-sm ex-ext-email" placeholder="name@organization.com"/>
          </div>
        </div>
      </div>`;

    const progSel = row.querySelector('.ex-int-prog');
    progSel.innerHTML = '<option value="">Select program…</option>' +
      this.programs.map(p => `<option>${p}</option>`).join('');
    progSel.addEventListener('change', () => this._onIntProgChange(progSel));

    c.appendChild(row);
  },

  onTypeChange(sel) {
    const row      = sel.closest('.ex-row');
    const intDiv   = row.querySelector('[data-for="Inside University"]');
    const extDiv   = row.querySelector('[data-for="external"]');
    intDiv.classList.add('d-none');
    extDiv.classList.add('d-none');
    if (sel.value === 'Inside University')  intDiv.classList.remove('d-none');
    else if (sel.value)                     extDiv.classList.remove('d-none');
  },

  _onIntProgChange(progSel) {
    const row    = progSel.closest('.ex-row');
    const supSel = row.querySelector('.ex-int-sup');
    const sups   = this.allSupsCache.filter(s => s.program === progSel.value);
    supSel.innerHTML = '<option value="">Select supervisor…</option>' +
      sups.map(s => `<option value="${s.id}" data-email="${s.email}" data-name="${s.name}">${s.name}</option>`).join('');
  },

  onProjectChange() {
    document.getElementById('btnSendEmail').classList.add('d-none');
    this.assignments = [];
    this.refreshStatus();
  },

  _gatherExaminers() {
    const result = [];
    document.querySelectorAll('#examinerRows .ex-row').forEach(row => {
      const type    = row.querySelector('.ex-type-sel').value;
      if (!type) return;

      if (type === 'Inside University') {
        const supSel = row.querySelector('.ex-int-sup');
        const opt    = supSel.options[supSel.selectedIndex];
        if (!opt || !opt.value) return;
        result.push({ name: opt.dataset.name, email: opt.dataset.email, type });
      } else {
        const name  = row.querySelector('.ex-ext-name').value.trim();
        const email = row.querySelector('.ex-ext-email').value.trim();
        if (!name || !email) return;
        result.push({ name, email, type });
      }
    });
    return result;
  },

  async assign() {
    const pid        = document.getElementById('ex-project-sel').value;
    const reportLink = document.getElementById('ex-report-link').value.trim();
    if (!pid) { Toast.show('Select a project first.', 'warning'); return; }
    const examiners = this._gatherExaminers();
    if (!examiners.length) { Toast.show('Add at least one complete examiner row.', 'warning'); return; }

    Spinner.show();
    try {
      const res = await gsrAuth('assignExaminers', pid, examiners, reportLink);
      if (!res.success) throw new Error(res.message);
      this.assignments = res.assignments;

      if (res.warnings && res.warnings.length) {
        const names = res.warnings.map(w => `${w.name} <${w.email}>`).join(', ');
        Toast.show(`Already assigned & emailed — kept in list: ${names}`, 'warning');
      }

      if (this.assignments.length) {
        Toast.show('Examiners assigned. Now send invitation emails.');
        document.getElementById('btnSendEmail').classList.remove('d-none');
      } else {
        Toast.show('No new examiners to email — all were already invited.');
        document.getElementById('btnSendEmail').classList.add('d-none');
      }
      this.refreshStatus();
    } catch (e) { Toast.show(e.message || e, 'error'); }
    finally { Spinner.hide(); }
  },

  async sendEmails() {
    const pid = document.getElementById('ex-project-sel').value;
    if (!this.assignments.length) { Toast.show('Assign examiners first.', 'warning'); return; }
    Spinner.show();
    try {
      const res = await gsrAuth('sendExaminerEmails', pid, this.assignments);
      if (!res.success) throw new Error(res.message);
      Toast.show('Invitation emails sent successfully.');
      await this.refreshStatus();
    } catch (e) { Toast.show(e.message || e, 'error'); }
    finally { Spinner.hide(); }
  },

  async refreshStatus() {
    const pid = document.getElementById('ex-project-sel').value;
    const c   = document.getElementById('examinerStatusTable');
    if (!pid) { c.innerHTML = '<p class="text-muted small">Select a project to see examiner status.</p>'; return; }
    try {
      const examiners = await gsrAuth('getExaminersForProject', pid);
      if (!examiners.length) { c.innerHTML = '<p class="text-muted small">No examiners assigned yet.</p>'; return; }
      const emailSent  = st => st !== 'Assigned';
      const gradeCell  = v => v
        ? `<span class="badge bg-success"><i class="fas fa-check"></i></span>`
        : `<span class="text-muted small">—</span>`;
      c.innerHTML = `
        <table class="table table-sm table-bordered mb-0">
          <thead><tr><th>Name</th><th>Email</th><th>Type</th><th>Report</th><th>Presentation</th><th>Email Status</th><th></th></tr></thead>
          <tbody>${examiners.map(e => {
            const st = e.Status || 'Assigned';
            const sent = emailSent(st);
            const badge = sent
              ? `<span class="badge bg-info text-white">Email Sent</span>`
              : `<span class="badge bg-warning text-dark">Not Emailed</span>`;
            const sendBtn = !sent
              ? `<button class="btn btn-outline-primary btn-sm py-0 px-1 ms-1" onclick="Ex.resendEmail('${escHtml(e.AssignmentID)}')" title="Send Email"><i class="fas fa-envelope"></i></button>`
              : '';
            const removeBtn = st === 'Assigned'
              ? `<button class="btn btn-outline-danger btn-sm py-0 px-1" onclick="Ex.removeExaminer('${escHtml(e.AssignmentID)}','${escHtml(pid)}')" title="Remove"><i class="fas fa-trash"></i></button>`
              : '';
            return `<tr>
              <td>${escHtml(e.ExaminerName || '—')}</td>
              <td>${escHtml(e.ExaminerEmail)}</td>
              <td>${escHtml(e.ExaminerType)}</td>
              <td class="text-center">${gradeCell(e.HasReport)}</td>
              <td class="text-center">${gradeCell(e.HasPresentation)}</td>
              <td>${badge}${sendBtn}</td>
              <td class="text-center">${removeBtn}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>`;
    } catch (err) { console.warn(err); }
  },

  async removeExaminer(assignmentId, pid) {
    if (!confirm('Remove this examiner? This cannot be undone.')) return;
    Spinner.show();
    try {
      const res = await gsrAuth('removeExaminer', assignmentId);
      if (!res.success) { Toast.show(res.message, 'error'); return; }
      Toast.show('Examiner removed.');
      await this.refreshStatus();
    } catch (e) { Toast.show('Error: ' + e.message, 'error'); }
    finally { Spinner.hide(); }
  },

  async resendEmail(assignmentId) {
    if (!confirm('Send invitation email to this examiner?')) return;
    Spinner.show();
    try {
      const res = await gsrAuth('resendExaminerEmail', assignmentId);
      if (!res.success) throw new Error(res.message);
      Toast.show('Invitation email sent.');
      await this.refreshStatus();
    } catch (e) { Toast.show(e.message || e, 'error'); }
    finally { Spinner.hide(); }
  },

  _renderRubric(criteria) {
    this._renderRubricSection('rubricListFYP1', criteria.filter(c => !c.ProjectType || c.ProjectType === 'FYP1'));
    this._renderRubricSection('rubricListFYP2', criteria.filter(c => c.ProjectType === 'FYP2'));
    this._refreshRubricTotals();
    ['rubricListFYP1','rubricListFYP2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input',  () => this._refreshRubricTotals());
        el.addEventListener('change', () => this._refreshRubricTotals());
      }
    });
  },

  _refreshRubricTotals() {
    const groups = {
      'FYP1-Report': 0, 'FYP1-Presentation': 0,
      'FYP2-Report': 0, 'FYP2-Presentation': 0,
    };
    [['rubricListFYP1','FYP1'],['rubricListFYP2','FYP2']].forEach(([listId, fyp]) => {
      document.querySelectorAll(`#${listId} .rubric-row:not(:first-child)`).forEach(row => {
        const nameEl = row.querySelector('.rc-name');
        if (!nameEl || !nameEl.value.trim()) return;
        const cat = row.querySelector('.rc-cat').value;
        const w   = parseFloat(row.querySelector('.rc-weight').value) || 0;
        groups[`${fyp}-${cat}`] += w;
      });
    });
    const el = document.getElementById('rubric-weight-totals');
    if (!el) return;
    el.innerHTML = Object.entries(groups).map(([key, t]) => {
      const t2 = Math.round(t * 10) / 10;
      const ok = Math.round(t) === 100;
      return `<span class="me-3">${key.replace('-', ' ')}: <strong class="${ok ? 'text-success' : 'text-danger'}">${t2}/100</strong></span>`;
    }).join('');
  },

  _renderRubricSection(containerId, criteria) {
    const isAdmin = Auth.supervisor && Auth.supervisor.isAdmin;
    const c = document.getElementById(containerId);
    if (!c) return;
    c.innerHTML = '';
    const hdr = document.createElement('div');
    hdr.className = 'rubric-row';
    hdr.innerHTML = `<strong>Category</strong><strong>Criterion</strong><strong>Graded By</strong><strong>Max</strong><strong>Weight%</strong><strong>ABET</strong><span></span>`;
    c.appendChild(hdr);
    criteria.forEach(cr => {
      const scope = cr.GradingScope || 'Group';
      const abet  = String(cr.ABETOutcome || '');
      const row   = document.createElement('div');
      row.className = 'rubric-row';
      const dis = isAdmin ? '' : 'disabled';
      const abetOpts = ['','5a','5b','2a','2b','7a','7b'].map(o =>
        `<option value="${o}" ${abet === o ? 'selected' : ''}>${o || 'None'}</option>`
      ).join('');
      row.innerHTML = `
        <select class="form-select form-select-sm rc-cat" ${dis}>
          <option ${cr.Category === 'Report'       ? 'selected' : ''}>Report</option>
          <option ${cr.Category === 'Presentation' ? 'selected' : ''}>Presentation</option>
        </select>
        <input type="text"   class="form-control form-control-sm rc-name"   value="${cr.CriterionName}" placeholder="Criterion" ${isAdmin ? '' : 'readonly'}/>
        <select class="form-select form-select-sm rc-scope" ${dis}>
          <option value="Group"      ${scope === 'Group'      ? 'selected' : ''}>Group</option>
          <option value="Individual" ${scope === 'Individual' ? 'selected' : ''}>Per Student</option>
        </select>
        <input type="number" class="form-control form-control-sm rc-max"    value="${cr.MaxGrade}" min="1" max="1000" ${isAdmin ? '' : 'readonly'}/>
        <input type="number" class="form-control form-control-sm rc-weight" value="${cr.Weight}"   min="1" max="100"  ${isAdmin ? '' : 'readonly'}/>
        <select class="form-select form-select-sm rc-abet" title="ABET Outcome" ${dis}>${abetOpts}</select>
        ${isAdmin ? '<button type="button" class="btn btn-outline-danger btn-sm" onclick="this.closest(\'.rubric-row\').remove()"><i class="fas fa-trash"></i></button>' : '<span></span>'}`;
      c.appendChild(row);
    });
  },

  addRubricRow(fypType) {
    if (!Auth.supervisor || !Auth.supervisor.isAdmin) { Toast.show('Only admins can add rubric rows.', 'warning'); return; }
    const id  = fypType === 'FYP2' ? 'rubricListFYP2' : 'rubricListFYP1';
    const c   = document.getElementById(id);
    const row = document.createElement('div');
    row.className = 'rubric-row';
    const aOpts = ['','5a','5b','2a','2b','7a','7b'].map(o => `<option value="${o}">${o || 'None'}</option>`).join('');
    row.innerHTML = `
      <select class="form-select form-select-sm rc-cat"><option>Report</option><option>Presentation</option></select>
      <input type="text"   class="form-control form-control-sm rc-name"   placeholder="Criterion name"/>
      <select class="form-select form-select-sm rc-scope">
        <option value="Group" selected>Group</option>
        <option value="Individual">Per Student</option>
      </select>
      <input type="number" class="form-control form-control-sm rc-max"    value="100" min="1" max="1000"/>
      <input type="number" class="form-control form-control-sm rc-weight" value="25"  min="1" max="100"/>
      <select class="form-select form-select-sm rc-abet" title="ABET Outcome">${aOpts}</select>
      <button type="button" class="btn btn-outline-danger btn-sm" onclick="this.closest('.rubric-row').remove()"><i class="fas fa-trash"></i></button>`;
    c.appendChild(row);
    this._refreshRubricTotals();
  },

  async saveRubric() {
    if (!Auth.supervisor || !Auth.supervisor.isAdmin) { Toast.show('Only admins can save rubrics.', 'warning'); return; }
    const criteria = [];
    [['rubricListFYP1','FYP1'],['rubricListFYP2','FYP2']].forEach(([listId, fypType]) => {
      document.querySelectorAll(`#${listId} .rubric-row:not(:first-child)`).forEach(row => {
        const nameEl = row.querySelector('.rc-name');
        if (!nameEl) return;
        const name = nameEl.value.trim();
        if (!name) return;
        criteria.push({
          projectType:   fypType,
          category:      row.querySelector('.rc-cat').value,
          criterionName: name,
          gradingScope:  row.querySelector('.rc-scope').value,
          maxGrade:      parseFloat(row.querySelector('.rc-max').value)    || 100,
          weight:        parseFloat(row.querySelector('.rc-weight').value) || 25,
          abetOutcome:   row.querySelector('.rc-abet') ? row.querySelector('.rc-abet').value : '',
        });
      });
    });
    const rubricGroups = [
      { label: 'FYP1 Report',       items: criteria.filter(c => c.projectType === 'FYP1' && c.category === 'Report') },
      { label: 'FYP1 Presentation', items: criteria.filter(c => c.projectType === 'FYP1' && c.category === 'Presentation') },
      { label: 'FYP2 Report',       items: criteria.filter(c => c.projectType === 'FYP2' && c.category === 'Report') },
      { label: 'FYP2 Presentation', items: criteria.filter(c => c.projectType === 'FYP2' && c.category === 'Presentation') },
    ];
    for (const g of rubricGroups) {
      if (!g.items.length) continue;
      const total = g.items.reduce((s, c) => s + c.weight, 0);
      if (Math.round(total) !== 100) {
        Toast.show(`${g.label} weights must sum to 100 (currently ${total}).`, 'warning');
        return;
      }
    }
    Spinner.show();
    try {
      await gsrAuth('saveExaminerConfig', criteria);
      Toast.show('Examiner rubric saved for FYP1 and FYP2.');
    } catch (e) { Toast.show(e.message || e, 'error'); }
    finally { Spinner.hide(); }
  },
};

// ── Tab 4: Final Results ──────────────────────────────────────────────

const Res = {
  allResults:  [],
  abetByType:  {},
  statsByType: {},

  async load() {
    Spinner.show();
    try {
      const res = await gsrAuth('getFinalResults');
      if (!res.success) {
        if (res.incomplete) {
          this._showIncomplete(res.incompleteByType || {});
        } else {
          Toast.show(res.message || 'Failed to load results.', 'error');
        }
        return;
      }
      this.allResults  = res.results;
      this.abetByType  = res.abetByType  || {};
      this.statsByType = res.statsByType || {};
      this.applyFilter();
      // Show per-type incomplete warning alongside results when only some types are ready
      if (res.incompleteByType && Object.keys(res.incompleteByType).length) {
        this._showIncomplete(res.incompleteByType);
      } else {
        const warn = document.getElementById('res-incomplete-warning');
        if (warn) { warn.innerHTML = ''; warn.classList.add('d-none'); }
      }
      const done = (res.completeTypes || []).join(' & ') || 'results';
      Toast.show(`Results loaded — ${res.results.length} student(s) (${done} complete).`);
    } catch (e) { Toast.show(e.message || e, 'error'); }
    finally { Spinner.hide(); }
  },

  applyFilter() {
    const type = document.getElementById('res-filter-type').value;
    const filtered = type ? this.allResults.filter(r => r.projectType === type) : this.allResults;
    this._render(filtered);
    this._renderSummary(this.abetByType, this.statsByType);
  },

  _showIncomplete(incompleteByType) {
    const warn  = document.getElementById('res-incomplete-warning');
    const tbody = document.getElementById('tbResults');

    const sections = Object.entries(incompleteByType).map(([type, projs]) => {
      const items = projs.map(p => {
        const bullets = p.missing.map(m => `<li>${escHtml(m)}</li>`).join('');
        return `<li class="mb-1"><strong>${escHtml(p.title)}</strong><ul class="mb-0">${bullets}</ul></li>`;
      }).join('');
      return `<p class="mb-1 fw-semibold">${escHtml(type)} — incomplete:</p><ul class="mb-2 small">${items}</ul>`;
    }).join('');

    if (warn) {
      warn.innerHTML = `
        <div class="alert alert-warning d-flex align-items-start gap-3 mb-3">
          <i class="fas fa-exclamation-triangle fa-lg mt-1 flex-shrink-0"></i>
          <div>
            <strong>Some results not yet available</strong>
            <p class="mb-2 mt-1 small">The following project types have incomplete grading and are excluded from results:</p>
            ${sections}
          </div>
        </div>`;
      warn.classList.remove('d-none');
    }
    if (!this.allResults || !this.allResults.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted py-4">Grading incomplete — see warning above.</td></tr>';
    }
  },

  _render(data) {
    const warn = document.getElementById('res-incomplete-warning');
    if (warn) { warn.innerHTML = ''; warn.classList.add('d-none'); }

    const tbody = document.getElementById('tbResults');
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted py-5">No results available.</td></tr>';
      return;
    }
    tbody.innerHTML = data.map((r, i) => {
      const lc = r.letterGrade.replace('+', '-plus').replace(/-$/, '-minus');
      return `<tr>
        <td>${i + 1}</td>
        <td class="fw-medium">${escHtml(r.studentName)}</td>
        <td><code>${escHtml(r.studentId)}</code></td>
        <td>${escHtml(r.projectTitle)}</td>
        <td><span class="badge ${r.projectType === 'FYP1' ? 'bg-primary' : 'bg-success'}">${escHtml(r.projectType)}</span></td>
        <td>${r.teamworkPct}%</td>
        <td>${r.reportPct}%</td>
        <td>${r.presPct}%</td>
        <td class="fw-bold">${r.finalGrade}%</td>
        <td class="text-center"><span class="grade-${escHtml(lc)} px-2 py-1 rounded">${escHtml(r.letterGrade)}</span></td>
      </tr>`;
    }).join('');
  },

  _renderSummary(abetByType, statsByType) {
    const c = document.getElementById('summaryCards');
    if (!c) return;
    const html = ['FYP1','FYP2'].map(pt => {
      const stats = statsByType[pt];
      const abet  = abetByType[pt];
      if (!stats || stats.count === 0) return '';
      return this._summaryCard(pt, stats, abet);
    }).join('');
    c.innerHTML = html || '<p class="text-muted small">No summary data available.</p>';
    document.getElementById('resultsSummary').classList.remove('d-none');
  },

  _summaryCard(pt, stats, abet) {
    const mean = parseFloat(stats.mean) || 0;
    const sd   = parseFloat(stats.sd)   || 0;
    const meanOk    = mean >= 75 && mean <= 90;
    const meanColor = meanOk ? '#16a34a' : mean < 75 ? '#dc2626' : '#d97706';
    const meanBadge = meanOk
      ? `<span class="badge bg-success ms-2"><i class="fas fa-check-circle me-1"></i>Within Range (75–90)</span>`
      : mean < 75
        ? `<span class="badge bg-danger ms-2"><i class="fas fa-exclamation-triangle me-1"></i>Below 75 — Action Required</span>`
        : `<span class="badge bg-warning text-dark ms-2"><i class="fas fa-exclamation-circle me-1"></i>Above 90 — Review Grading</span>`;
    const sdOk    = sd >= 5 && sd <= 15;
    const sdColor = sdOk ? '#16a34a' : sd < 5 ? '#d97706' : '#dc2626';
    const sdBadge = sdOk
      ? `<span class="badge bg-success ms-2"><i class="fas fa-check-circle me-1"></i>Normal Range (5–15)</span>`
      : sd < 5
        ? `<span class="badge bg-warning text-dark ms-2"><i class="fas fa-compress-arrows-alt me-1"></i>Too Uniform (SD &lt; 5)</span>`
        : `<span class="badge bg-danger ms-2"><i class="fas fa-expand-arrows-alt me-1"></i>High Variance (SD &gt; 15)</span>`;
    const sdPct   = Math.min(100, (sd / 30) * 100);
    const m5pct   = ((5  / 30) * 100).toFixed(2);
    const m15pct  = ((15 / 30) * 100).toFixed(2);
    const abetKeys   = ['abet5a','abet5b','abet2a','abet2b','abet7a','abet7b'];
    const abetLabels = { abet5a:'5a', abet5b:'5b', abet2a:'2a', abet2b:'2b', abet7a:'7a', abet7b:'7b' };
    const lvlColors  = ['','#fee2e2','#fef3c7','#dbeafe','#d1fae5'];
    const lvlLabels  = ['','Level 1','Level 2','Level 3','Level 4'];
    const abetRows   = abet
      ? abetKeys.map(k => {
          const v = abet[k];
          if (!v) return '';
          const bg  = lvlColors[v.level] || '#f3f4f6';
          const lbl = lvlLabels[v.level] || '—';
          return `<div class="d-flex align-items-center justify-content-between py-2 border-bottom" style="font-size:13px;">
            <span class="fw-medium">Outcome ${abetLabels[k]}</span>
            <div class="d-flex align-items-center gap-2">
              <span class="fw-bold">${v.pct}%</span>
              <span style="background:${bg};padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700;">${lbl}</span>
            </div>
          </div>`;
        }).join('')
      : '<p class="text-muted small mb-0">No ABET data.</p>';
    const ptBadge = pt === 'FYP1'
      ? '<span class="badge bg-primary px-3 py-2 fs-6">FYP1</span>'
      : '<span class="badge bg-success px-3 py-2 fs-6">FYP2</span>';
    return `
      <div class="card mb-4">
        <div class="card-header d-flex align-items-center gap-3 py-3">
          ${ptBadge}
          <span class="fw-bold">${pt} Summary</span>
          <small class="text-muted ms-auto">${stats.count} student${stats.count !== 1 ? 's' : ''}</small>
        </div>
        <div class="card-body">
          <div class="row g-4 mb-4">
            <div class="col-md-6">
              <div class="d-flex align-items-center flex-wrap gap-1 mb-2">
                <span class="fw-semibold">Average Grade</span>${meanBadge}
              </div>
              <div class="mb-2"><span class="fw-bold fs-5" style="color:${meanColor};">${mean.toFixed(1)}%</span></div>
              <div class="position-relative mb-4" style="height:20px;">
                <div class="progress" style="height:20px;border-radius:10px;">
                  <div class="progress-bar" style="width:${Math.min(100,mean)}%;background:${meanColor};transition:width .4s;"></div>
                </div>
                <div style="position:absolute;top:0;left:75%;width:2px;height:20px;background:#374151;opacity:.7;"></div>
                <div style="position:absolute;top:22px;left:75%;transform:translateX(-50%);font-size:10px;color:#6b7280;">75</div>
                <div style="position:absolute;top:0;left:90%;width:2px;height:20px;background:#374151;opacity:.7;"></div>
                <div style="position:absolute;top:22px;left:90%;transform:translateX(-50%);font-size:10px;color:#6b7280;">90</div>
              </div>
              <small class="text-muted">Accepted range: 75 – 90</small>
            </div>
            <div class="col-md-6">
              <div class="d-flex align-items-center flex-wrap gap-1 mb-2">
                <span class="fw-semibold">Standard Deviation</span>${sdBadge}
              </div>
              <div class="mb-2"><span class="fw-bold fs-5" style="color:${sdColor};">${sd.toFixed(2)}</span></div>
              <div class="position-relative mb-4" style="height:20px;">
                <div class="progress" style="height:20px;border-radius:10px;">
                  <div class="progress-bar" style="width:${sdPct}%;background:${sdColor};transition:width .4s;"></div>
                </div>
                <div style="position:absolute;top:0;left:${m5pct}%;width:2px;height:20px;background:#374151;opacity:.7;"></div>
                <div style="position:absolute;top:22px;left:${m5pct}%;transform:translateX(-50%);font-size:10px;color:#6b7280;">5</div>
                <div style="position:absolute;top:0;left:${m15pct}%;width:2px;height:20px;background:#374151;opacity:.7;"></div>
                <div style="position:absolute;top:22px;left:${m15pct}%;transform:translateX(-50%);font-size:10px;color:#6b7280;">15</div>
              </div>
              <small class="text-muted">Accepted range: 5 – 15 | Scale: 0 – 30</small>
            </div>
          </div>
          <div>
            <h6 class="fw-bold mb-3"><i class="fas fa-graduation-cap me-2 text-primary"></i>ABET Outcomes (Aggregate)</h6>
            ${abetRows}
          </div>
        </div>
      </div>`;
  },

  async exportPDF() {
    Spinner.show();
    try {
      const res = await gsrAuth('getDetailedResults');
      if (!res.success) { Toast.show(res.message || 'Failed to load data.', 'error'); return; }
      if (!res.projects.length) { Toast.show('No projects to export.', 'warning'); return; }

      const { jsPDF } = window.jspdf;
      const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const W    = 210, margin = 14, cW = W - 2 * margin;
      const navy = [30, 58, 95], blue = [37, 99, 235], green = [22, 163, 74];
      const lvlLabels = ['', 'Level 1 — Beginning', 'Level 2 — Developing', 'Level 3 — Accomplished', 'Level 4 — Exemplary'];
      const abetKeys  = ['abet5a','abet5b','abet2a','abet2b','abet7a','abet7b'];
      const abetLabel = { abet5a:'5a', abet5b:'5b', abet2a:'2a', abet2b:'2b', abet7a:'7a', abet7b:'7b' };
      const meta = res.meta || {};

      const drawHeader = (doc) => {
        doc.setFillColor(...navy);
        doc.rect(0, 0, W, 26, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');   doc.setFontSize(13);
        doc.text('Final Year Project — Assessment Report', W / 2, 9, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
        doc.text(`Beirut Arab University  ·  Faculty of Engineering  ·  ${meta.department || 'ECE'} Department`, W / 2, 15.5, { align: 'center' });
        doc.text(`Academic Year ${meta.year || ''}${meta.semester ? '  ·  Semester: ' + meta.semester : ''}`, W / 2, 21, { align: 'center' });
        doc.setTextColor(0, 0, 0);
      };

      let first = true;
      for (const proj of res.projects) {
        if (!first) doc.addPage();
        first = false;
        drawHeader(doc);
        let y = 31;

        // Project banner
        doc.setFillColor(235, 242, 255);
        doc.roundedRect(margin, y, cW, 16, 2, 2, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...navy);
        doc.text(proj.title, margin + 3, y + 6.5);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(60, 60, 60);
        doc.text(`Type: ${proj.type}   |   Program: ${proj.program}   |   Supervisor(s): ${proj.supervisors.join(', ')}`, margin + 3, y + 13);
        doc.setTextColor(0, 0, 0);
        y += 20;

        for (const stu of proj.students) {
          if (y > 245) { doc.addPage(); drawHeader(doc); y = 31; }

          // Student header strip
          doc.setFillColor(...blue);
          doc.rect(margin, y, cW, 7, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
          doc.text(`${stu.studentName}   (${stu.studentId})`, margin + 3, y + 5);
          doc.setTextColor(0, 0, 0);
          y += 9;

          // Teamwork individual table
          doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(50, 50, 50);
          doc.text('Teamwork — Individual Assessment', margin, y + 3.5);
          y += 5;
          doc.autoTable({
            startY: y, margin: { left: margin, right: margin }, theme: 'grid',
            headStyles: { fillColor: navy, textColor: 255, fontSize: 7.5, fontStyle: 'bold', cellPadding: 1.8 },
            bodyStyles: { fontSize: 7.5, cellPadding: 1.8 },
            footStyles: { fillColor: [220, 235, 255], textColor: [...navy], fontSize: 7.5, fontStyle: 'bold', cellPadding: 1.8 },
            columnStyles: { 0: { cellWidth: cW * 0.62 }, 1: { cellWidth: cW * 0.19, halign: 'center' }, 2: { cellWidth: cW * 0.19, halign: 'center' } },
            head: [['Criterion', 'Grade', 'Max']],
            body: stu.twDetails.map(d => [d.criterion, d.grade, d.maxGrade]),
            foot: [[{ content: `Peer Evaluation`, styles: { fontStyle: 'bold' } }, { content: `${stu.peerPct}%`, colSpan: 2, styles: { halign: 'center' } }]],
          });
          y = doc.lastAutoTable.finalY + 3;

          // Report grades
          if (stu.repDetails.length) {
            if (y > 255) { doc.addPage(); drawHeader(doc); y = 31; }
            doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(50, 50, 50);
            doc.text('Examiner — Report Grading', margin, y + 3.5);
            y += 5;
            doc.autoTable({
              startY: y, margin: { left: margin, right: margin }, theme: 'grid',
              headStyles: { fillColor: [50, 90, 140], textColor: 255, fontSize: 7.5, fontStyle: 'bold', cellPadding: 1.8 },
              bodyStyles: { fontSize: 7.5, cellPadding: 1.8 },
              columnStyles: { 0: { cellWidth: cW * 0.55 }, 1: { cellWidth: cW * 0.15, halign: 'center' }, 2: { cellWidth: cW * 0.15, halign: 'center' }, 3: { cellWidth: cW * 0.15, halign: 'center' } },
              head: [['Criterion', 'Score', 'Max', 'Weight']],
              body: stu.repDetails.map(d => [d.criterion, d.score, d.maxGrade, `${d.weight}%`]),
            });
            y = doc.lastAutoTable.finalY + 3;
          }

          // Presentation grades
          if (stu.presDetails.length) {
            if (y > 255) { doc.addPage(); drawHeader(doc); y = 31; }
            doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(50, 50, 50);
            doc.text('Examiner — Presentation Grading', margin, y + 3.5);
            y += 5;
            doc.autoTable({
              startY: y, margin: { left: margin, right: margin }, theme: 'grid',
              headStyles: { fillColor: [50, 90, 140], textColor: 255, fontSize: 7.5, fontStyle: 'bold', cellPadding: 1.8 },
              bodyStyles: { fontSize: 7.5, cellPadding: 1.8 },
              columnStyles: { 0: { cellWidth: cW * 0.55 }, 1: { cellWidth: cW * 0.15, halign: 'center' }, 2: { cellWidth: cW * 0.15, halign: 'center' }, 3: { cellWidth: cW * 0.15, halign: 'center' } },
              head: [['Criterion', 'Score', 'Max', 'Weight']],
              body: stu.presDetails.map(d => [d.criterion, d.score, d.maxGrade, `${d.weight}%`]),
            });
            y = doc.lastAutoTable.finalY + 3;
          }

          // Final summary
          if (y > 260) { doc.addPage(); drawHeader(doc); y = 31; }
          doc.autoTable({
            startY: y, margin: { left: margin, right: margin }, theme: 'grid',
            headStyles: { fillColor: [...green], textColor: 255, fontSize: 7.5, fontStyle: 'bold', cellPadding: 2 },
            bodyStyles: { fontSize: 8.5, fontStyle: 'bold', cellPadding: 2.5, halign: 'center' },
            columnStyles: { 0:{cellWidth:cW*0.2}, 1:{cellWidth:cW*0.2}, 2:{cellWidth:cW*0.2}, 3:{cellWidth:cW*0.2}, 4:{cellWidth:cW*0.2} },
            head: [[`Teamwork (${meta.weights?.tw ?? 35}%)`, `Report (${meta.weights?.report ?? 35}%)`, `Presentation (${meta.weights?.pres ?? 30}%)`, 'Final Grade', 'Letter Grade']],
            body: [[`${stu.summary.teamworkPct}%`, `${stu.summary.reportPct}%`, `${stu.summary.presPct}%`, `${stu.summary.finalGrade}%`, stu.summary.letterGrade]],
          });
          y = doc.lastAutoTable.finalY + 8;
        }
      }

      // ── Summary page ──────────────────────────────────────────────────────
      doc.addPage();
      doc.setFillColor(...navy);
      doc.rect(0, 0, W, 26, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.text('Assessment Summary & ABET Outcomes', W / 2, 10, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      doc.text(`Beirut Arab University  ·  ${meta.department || 'ECE'} Department  ·  Academic Year ${meta.year || ''}`, W / 2, 18, { align: 'center' });
      doc.setTextColor(0, 0, 0);

      let ys = 31;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...navy);
      doc.text('Grade Statistics', margin, ys + 4); ys += 8;
      doc.setTextColor(0, 0, 0);
      doc.autoTable({
        startY: ys, margin: { left: margin, right: margin }, theme: 'grid',
        headStyles: { fillColor: navy, textColor: 255, fontSize: 8.5, fontStyle: 'bold', cellPadding: 2.5 },
        bodyStyles: { fontSize: 8.5, cellPadding: 2.5, halign: 'center' },
        columnStyles: { 0: { fontStyle: 'bold', halign: 'left' } },
        head: [['Type', 'Students', 'Mean Grade', 'Standard Deviation']],
        body: ['FYP1','FYP2'].filter(t => res.statistics[t]).map(t => {
          const s = res.statistics[t];
          return [t, s.count, `${s.mean}%`, s.sd.toFixed ? s.sd.toFixed(2) : s.sd];
        }),
      });
      ys = doc.lastAutoTable.finalY + 10;

      const abetBody = abetKeys.map(k => {
        const f1 = res.abet.FYP1?.[k], f2 = res.abet.FYP2?.[k];
        if (!f1 && !f2) return null;
        return [`Outcome ${abetLabel[k]}`, f1 ? `${f1.pct}%` : '—', f1 ? lvlLabels[f1.level] : '—', f2 ? `${f2.pct}%` : '—', f2 ? lvlLabels[f2.level] : '—'];
      }).filter(Boolean);

      if (abetBody.length) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...navy);
        doc.text('ABET Outcomes', margin, ys + 4); ys += 8;
        doc.setTextColor(0, 0, 0);
        doc.autoTable({
          startY: ys, margin: { left: margin, right: margin }, theme: 'grid',
          headStyles: { fillColor: navy, textColor: 255, fontSize: 8.5, fontStyle: 'bold', cellPadding: 2.5 },
          bodyStyles: { fontSize: 8, cellPadding: 2.5 },
          columnStyles: { 0:{fontStyle:'bold',cellWidth:cW*0.14}, 1:{halign:'center',cellWidth:cW*0.12}, 2:{cellWidth:cW*0.26}, 3:{halign:'center',cellWidth:cW*0.12}, 4:{cellWidth:cW*0.26} },
          head: [['Outcome', 'FYP1 %', 'FYP1 Level', 'FYP2 %', 'FYP2 Level']],
          body: abetBody,
        });
      }

      const yr   = (meta.year || new Date().getFullYear()).toString().replace('–', '-');
      const sem  = meta.semester ? `_S${meta.semester}` : '';
      doc.save(`FYP_Assessment_Report_${yr}${sem}.pdf`);
      Toast.show('PDF report downloaded.');
    } catch (e) { Toast.show('PDF error: ' + (e.message || e), 'error'); console.error(e); }
    finally { Spinner.hide(); }
  },
};

// ── Admin: Supervisor Credential Management ───────────────────────────

const Admin = {
  _supervisors: [],

  async loadUsers() {
    if (!Auth.supervisor || !Auth.supervisor.isAdmin) return;
    const tbody = document.getElementById('manageUsersTbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3"><span class="spinner-border spinner-border-sm me-2"></span>Loading…</td></tr>';
    try {
      const res = await gsrAuth('getAllSupervisorsForAdmin');
      if (!res.success) throw new Error(res.message);
      this._supervisors = res.supervisors;
      tbody.innerHTML = res.supervisors.map(s => `
        <tr>
          <td><code>${s.id}</code></td>
          <td>${s.name}</td>
          <td class="small text-muted">${s.program}</td>
          <td>
            <input type="text" class="form-control form-control-sm cred-pwd"
                   data-id="${s.id}" data-name="${s.name}" data-email="${s.email}"
                   placeholder="Leave blank to keep current"/>
          </td>
          <td class="text-center">
            <input type="checkbox" class="form-check-input cred-email" data-id="${s.id}"
                   title="Send credentials email to ${s.email || 'no email'}"/>
          </td>
        </tr>`).join('');
    } catch(e) { tbody.innerHTML = `<tr><td colspan="5" class="text-danger small py-2">${e.message}</td></tr>`; }
  },

  async saveCredentials() {
    const targets = [];
    let hasWarning = false;
    document.querySelectorAll('#manageUsersTbody tr').forEach(row => {
      const pwdEl   = row.querySelector('.cred-pwd');
      const emailEl = row.querySelector('.cred-email');
      if (!pwdEl) return;
      const id        = pwdEl.dataset.id;
      const password  = pwdEl.value.trim();
      const sendEmail = emailEl ? emailEl.checked : false;
      if (!password && !sendEmail) return;
      if (!password) {
        Toast.show(`Enter a password for ${pwdEl.dataset.name} before sending email.`, 'warning');
        hasWarning = true;
        return;
      }
      const sup = this._supervisors.find(s => s.id === id);
      const email = sup ? (sup.email || '') : '';
      if (sendEmail && !email) {
        Toast.show(`No email on file for ${pwdEl.dataset.name} — password saved but email cannot be sent.`, 'warning');
        hasWarning = true;
      }
      targets.push({ id, password, name: pwdEl.dataset.name, email, sendEmail });
    });
    if (!targets.length) { Toast.show('No changes to save.', 'warning'); return; }
    Spinner.show();
    try {
      const res = await gsrAuth('setAndEmailCredentials', targets);
      if (!res.success) throw new Error(res.message);
      const sent   = res.sent   || [];
      const failed = res.failed || [];
      const emailRequested = targets.filter(t => t.sendEmail).length;
      let msg = `Passwords updated for ${targets.length} supervisor(s).`;
      if (emailRequested > 0) {
        if (sent.length > 0)   msg += ` ${sent.length} email(s) sent.`;
        if (failed.length > 0) msg += ` ${failed.length} email(s) failed.`;
      }
      Toast.show(msg, failed.length > 0 ? 'warning' : 'success');
      bootstrap.Modal.getInstance(document.getElementById('modalManageUsers')).hide();
    } catch(e) { Toast.show(e.message || e, 'error'); }
    finally { Spinner.hide(); }
  },
};

// ── Boot ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  ['login-id', 'login-pwd'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') Auth.login();
    });
  });
});
