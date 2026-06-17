// FYP Management System — Render/Express backend
// Stack: Neon PostgreSQL + Mailtrap Email Sending API

const { neon } = require('@neondatabase/serverless');
const crypto    = require('crypto');

const SENDER_EMAIL      = process.env.SENDER_EMAIL      || '';
const MAILTRAP_API_KEY  = process.env.MAILTRAP_API_KEY  || '';
const APP_URL           = (process.env.APP_URL || 'https://your-app.onrender.com').replace(/\/$/, '');
const PWD_SALT          = process.env.PWD_SALT || 'bau-fyp-salt-2025';

const ADMIN_ID          = 'A20160170';
const SESSION_TTL       = 8 * 60 * 60 * 1000;
const MAX_TRIES         = 5;
const LOCKOUT_MS        = 15 * 60 * 1000;
const TOKEN_EXPIRY_DAYS = 30;
const DEFAULT_PWD       = 'fyp2025';

async function sendEmail(to, subject, html) {
  const res = await fetch('https://send.api.mailtrap.io/api/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MAILTRAP_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: { email: SENDER_EMAIL, name: 'FYP System — BAU — ECE' },
      to: [{ email: String(to) }],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => String(res.status));
    throw new Error(`Email failed (${res.status}): ${err}`);
  }
}

function hashPwd(plain) {
  return crypto.createHash('sha256').update(plain + PWD_SALT).digest('hex');
}

function uid(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7).toUpperCase();
}

function genToken() {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

function mapProject(r) {
  return {
    ProjectID:            r.project_id,
    Title:                r.title,
    Type:                 r.type,
    Semester:             r.semester,
    Year:                 r.year,
    EndDate:              r.end_date || '',
    ProgramType:          r.program_type,
    Supervisors:          r.supervisors || '',
    Students:             r.students || '',
    DisableNotifications: r.disable_notifications ? 'TRUE' : 'FALSE',
    CreatedAt:            r.created_at || '',
  };
}
function mapStudent(r)    { return { StudentID: r.student_id, StudentName: r.student_name, Email: r.email || '', ProjectID: r.project_id }; }
function mapSupervisor(r) { return { SupervisorID: r.supervisor_id, Name: r.name, Program: r.program, Email: r.email || '' }; }
function mapPeerConfig(r) { return { QuestionNo: r.question_no, QuestionText: r.question_text, MaxGrade: r.max_grade, Weight: r.weight, AbetOutcome: r.abet_outcome || '' }; }
function mapExaminer(r) {
  return {
    AssignmentID: r.assignment_id, ProjectID: r.project_id,
    ExaminerName: r.examiner_name, ExaminerEmail: r.examiner_email,
    ExaminerType: r.examiner_type, Token: r.token, Status: r.status,
    AssignedAt: r.assigned_at, ReportLink: r.report_link || '',
    DraftGrades: r.draft_grades || '',
  };
}
function mapExConfig(r) {
  return {
    ProjectType: r.project_type, Category: r.category, CriterionName: r.criterion_name,
    MaxGrade: r.max_grade, Weight: r.weight, GradingScope: r.grading_scope,
    ABETOutcome: r.abet_outcome || '',
  };
}

// ── Main handler ──────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.json({ error: 'Method not allowed' }); return; }

  const sql = neon(process.env.DATABASE_URL);
  const body = req.body || {};
  const { action, args = [] } = body;

  // ok() just returns its argument so `return ok({...})` exits dispatch()
  function ok(data) { return data; }

  // ── Session helpers ────────────────────────────────────────────────────

  async function verifySession(token) {
    if (!token) return null;
    const rows = await sql`SELECT * FROM sessions WHERE token = ${token} AND expires_at > NOW()`;
    return rows[0] || null;
  }

  async function checkLockout(supId) {
    const rows = await sql`SELECT * FROM login_lockout WHERE supervisor_id = ${supId}`;
    const data = rows[0] || null;
    if (!data) return { blocked: false };
    if (data.locked_until && new Date(data.locked_until) > new Date()) {
      return { blocked: true, remaining: Math.ceil((new Date(data.locked_until) - Date.now()) / 60000) };
    }
    if (data.locked_until) {
      await sql`DELETE FROM login_lockout WHERE supervisor_id = ${supId}`;
    }
    return { blocked: false };
  }

  async function recordLoginFail(supId) {
    const rows = await sql`SELECT * FROM login_lockout WHERE supervisor_id = ${supId}`;
    const existing = rows[0] || null;
    const tries = ((existing && existing.tries) || 0) + 1;
    const locked_until = tries >= MAX_TRIES ? new Date(Date.now() + LOCKOUT_MS).toISOString() : null;
    await sql`INSERT INTO login_lockout (supervisor_id, tries, locked_until) VALUES (${supId}, ${tries}, ${locked_until}) ON CONFLICT (supervisor_id) DO UPDATE SET tries = ${tries}, locked_until = ${locked_until}`;
    return { tries, locked_until };
  }

  async function clearLockout(supId) {
    await sql`DELETE FROM login_lockout WHERE supervisor_id = ${supId}`;
  }

  async function createSession(sup) {
    const token     = crypto.randomUUID().replace(/-/g,'') + crypto.randomUUID().replace(/-/g,'');
    const expiresAt = new Date(Date.now() + SESSION_TTL).toISOString();
    await sql`INSERT INTO sessions (token, supervisor_id, name, program, is_admin, expires_at, last_seen) VALUES (${token}, ${sup.id}, ${sup.name}, ${sup.program || ''}, ${!!sup.isAdmin}, ${expiresAt}, NOW())`;
    return token;
  }

  async function getTWConfig() {
    const rows = await sql`SELECT * FROM tw_config`;
    const cfg = {};
    rows.forEach(r => { cfg[r.config_key] = r.config_value; });
    return cfg;
  }

  async function getIndividualRubric() {
    const cfg = await getTWConfig();
    try { const stored = JSON.parse(cfg.individual_rubric || '[]'); if (stored.length) return stored; } catch {}
    return [
      { criterion: 'Technical Contribution',   maxGrade: 25, weight: 25, abetOutcome: '' },
      { criterion: 'Initiative & Leadership',  maxGrade: 25, weight: 25, abetOutcome: '' },
      { criterion: 'Attendance & Punctuality', maxGrade: 25, weight: 25, abetOutcome: '' },
      { criterion: 'Documentation Quality',    maxGrade: 25, weight: 25, abetOutcome: '' },
    ];
  }

  async function filterProjectsBySession(session, allProjects, allSups) {
    if (session.is_admin) return allProjects;
    const prog = session.program || '';
    if (!prog) return allProjects;
    return allProjects.filter(p => {
      if (p.program_type === prog) return true;
      const supIds = (p.supervisors || '').split(',').map(x => x.trim()).filter(Boolean);
      return supIds.some(sid => {
        const found = allSups.find(su => su.supervisor_id === sid);
        return found && found.program === prog;
      });
    });
  }

  function pct(num, denom) { return denom > 0 ? (num / denom) * 100 : 0; }
  function rnd(v) { return Math.round(v * 10) / 10; }

  function weightedPct(grades, config) {
    if (!grades.length || !config.length) return 0;
    let wSum = 0, wTotal = 0;
    config.forEach(c => {
      const cg  = grades.filter(g => g.criterion === c.criterion_name || g.Criterion === c.CriterionName);
      const max = parseFloat(c.max_grade || c.MaxGrade);
      const w   = parseFloat(c.weight || c.Weight);
      if (cg.length && max > 0) {
        const avg = cg.reduce((s, g) => s + parseFloat(g.score || g.Score || 0), 0) / cg.length;
        wSum += (avg / max) * 100 * w;
        wTotal += w;
      }
    });
    return wTotal > 0 ? wSum / wTotal : 0;
  }

  const GRADE_BORDERS = [54, 59, 64, 69, 72, 75, 79, 82, 85, 89, 94];

  function letterGrade(score) {
    const rounded  = Math.round(score);
    const adjusted = GRADE_BORDERS.includes(rounded) ? rounded + 1 : rounded;
    if (adjusted >= 95) return 'A+'; if (adjusted >= 90) return 'A';
    if (adjusted >= 86) return 'A-'; if (adjusted >= 83) return 'B+';
    if (adjusted >= 80) return 'B';  if (adjusted >= 76) return 'B-';
    if (adjusted >= 73) return 'C+'; if (adjusted >= 70) return 'C';
    if (adjusted >= 65) return 'C-'; if (adjusted >= 60) return 'D';
    if (adjusted >= 55) return 'D-';
    return 'F';
  }

  // ── Dispatch ──────────────────────────────────────────────────────────

  async function dispatch() {
    switch (action) {

      // ─── Auth ────────────────────────────────────────────────────────

      case 'loginSupervisor': {
        const [supervisorId, password] = args;
        if (!supervisorId || !password) return ok({ success: false, message: 'ID and password are required.' });

        const lockCheck = await checkLockout(supervisorId.trim());
        if (lockCheck.blocked) return ok({ success: false, message: `Account locked. Try again in ${lockCheck.remaining} minute(s).` });

        const supRows = await sql`SELECT * FROM supervisors WHERE supervisor_id = ${supervisorId.trim()}`;
        const sup = supRows[0] || null;
        if (!sup) {
          await recordLoginFail(supervisorId.trim());
          return ok({ success: false, message: 'Supervisor ID not found.' });
        }

        const stored = sup.password || '';
        const inputHash = hashPwd(password);
        const isHash = stored.length === 64;
        const passwordOk = isHash ? stored === inputHash : (stored === password || stored === '');

        if (!passwordOk) {
          const failData = await recordLoginFail(supervisorId.trim());
          const left = MAX_TRIES - (failData.tries || 0);
          return ok({ success: false, message: left > 0 ? `Incorrect password. ${left} attempt(s) left.` : 'Account locked for 15 minutes.' });
        }

        if (!isHash) await sql`UPDATE supervisors SET password = ${inputHash} WHERE supervisor_id = ${sup.supervisor_id}`;
        await clearLockout(supervisorId.trim());

        const supervisorData = { id: sup.supervisor_id, name: sup.name, program: sup.program, email: sup.email, isAdmin: sup.supervisor_id === ADMIN_ID };
        const sessionToken = await createSession(supervisorData);
        return ok({ success: true, supervisor: supervisorData, sessionToken });
      }

      case 'logoutSession': {
        const [token] = args;
        if (token) await sql`DELETE FROM sessions WHERE token = ${token}`;
        return ok({ success: true });
      }

      case 'changePassword': {
        const [sessionToken, currentPwd, newPwd] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, message: 'Session expired.' });
        const supRows = await sql`SELECT * FROM supervisors WHERE supervisor_id = ${session.supervisor_id}`;
        const sup = supRows[0] || null;
        if (!sup) return ok({ success: false, message: 'Supervisor not found.' });
        const stored = sup.password || '';
        const isHash = stored.length === 64;
        const currentOk = isHash ? stored === hashPwd(currentPwd) : (stored === currentPwd || stored === '');
        if (!currentOk) return ok({ success: false, message: 'Current password is incorrect.' });
        if (!newPwd || newPwd.length < 6) return ok({ success: false, message: 'New password must be at least 6 characters.' });
        await sql`UPDATE supervisors SET password = ${hashPwd(newPwd)} WHERE supervisor_id = ${session.supervisor_id}`;
        await sql`DELETE FROM sessions WHERE supervisor_id = ${session.supervisor_id} AND token != ${sessionToken}`;
        return ok({ success: true });
      }

      case 'heartbeat': {
        const [sessionToken] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false });
        await sql`UPDATE sessions SET last_seen = NOW() WHERE token = ${sessionToken}`;
        return ok({ success: true });
      }

      case 'getOnlineUsers': {
        const [sessionToken] = args;
        const session = await verifySession(sessionToken);
        if (!session || !session.is_admin) return ok({ users: [] });
        const rows = await sql`SELECT supervisor_id, name, program, is_admin, last_seen FROM sessions WHERE last_seen > NOW() - INTERVAL '5 minutes' AND expires_at > NOW() ORDER BY last_seen DESC`;
        return ok({ users: rows.map(r => ({ id: r.supervisor_id, name: r.name, program: r.program, isAdmin: r.is_admin, lastSeen: r.last_seen })) });
      }

      case 'initializeSheets': return ok({ success: true });

      // ─── KPIs ────────────────────────────────────────────────────────

      case 'getKPIs': {
        const [sessionToken] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ fyp1: 0, fyp2: 0, students: 0, projects: 0 });

        const [allProjects, allStudents, allSups] = await Promise.all([
          sql`SELECT * FROM projects`,
          sql`SELECT * FROM students`,
          sql`SELECT * FROM supervisors`,
        ]);

        const projects   = await filterProjectsBySession(session, allProjects, allSups);
        const projectIds = new Set(projects.map(p => p.project_id));
        const students   = allStudents.filter(s => projectIds.has(s.project_id));
        return ok({
          fyp1:     projects.filter(p => p.type === 'FYP1').length,
          fyp2:     projects.filter(p => p.type === 'FYP2').length,
          students: students.length,
          projects: projects.length,
        });
      }

      // ─── Programs & Supervisors ──────────────────────────────────────

      case 'getPrograms': {
        const rows = await sql`SELECT * FROM programs ORDER BY program_name`;
        return ok(rows.map(r => r.program_name));
      }

      case 'getSupervisorsByProgram': {
        const [program] = args;
        const rows = await sql`SELECT * FROM supervisors WHERE program = ${program} AND supervisor_id != ${ADMIN_ID}`;
        return ok(rows.map(r => ({ id: r.supervisor_id, name: r.name, email: r.email })));
      }

      case 'getAllSupervisors': {
        const [sessionToken] = args;
        if (!await verifySession(sessionToken)) return ok([]);
        const rows = await sql`SELECT * FROM supervisors WHERE supervisor_id != ${ADMIN_ID} ORDER BY name`;
        return ok(rows.map(r => ({ id: r.supervisor_id, name: r.name, program: r.program, email: r.email || '' })));
      }

      case 'addSupervisorToSystem': {
        const [sessionToken, name, program, email, initialPassword] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, message: 'Session expired.' });
        if (!session.is_admin) return ok({ success: false, message: 'Only the admin can add supervisors.' });
        const existing = await sql`SELECT supervisor_id FROM supervisors WHERE name = ${name} AND program = ${program}`;
        if (existing.length) return ok({ success: false, message: 'Supervisor already exists in this program.' });
        const id  = uid('SUP');
        const pwd = (initialPassword && initialPassword.length >= 6) ? initialPassword : DEFAULT_PWD;
        await sql`INSERT INTO supervisors (supervisor_id, name, program, email, password) VALUES (${id}, ${name}, ${program}, ${email || ''}, ${hashPwd(pwd)})`;
        return ok({ success: true, id, name, program });
      }

      case 'getAllSupervisorsForAdmin': {
        const [sessionToken] = args;
        const session = await verifySession(sessionToken);
        if (!session || !session.is_admin) return ok({ success: false, message: 'Unauthorized.' });
        const rows = await sql`SELECT * FROM supervisors WHERE supervisor_id != ${ADMIN_ID} ORDER BY name`;
        return ok({ success: true, supervisors: rows.map(r => ({ id: r.supervisor_id, name: r.name, program: r.program, email: r.email || '' })) });
      }

      case 'setAndEmailCredentials': {
        const [sessionToken, targets] = args;
        const session = await verifySession(sessionToken);
        if (!session || !session.is_admin) return ok({ success: false, message: 'Unauthorized.' });
        const sent = [], failed = [];
        for (const t of (targets || [])) {
          if (!t.id || !t.password) continue;
          await sql`UPDATE supervisors SET password = ${hashPwd(String(t.password))} WHERE supervisor_id = ${String(t.id)}`;
          const shouldEmail = t.sendEmail === true || t.sendEmail === 'true' || t.sendEmail === 1;
          if (t.email && shouldEmail) {
            try {
              await sendEmail(
                String(t.email),
                'FYP Grading System — Your Login Credentials',
                `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                  <div style="background:#1e3a5f;padding:24px 28px;">
                    <h2 style="color:#fff;margin:0;font-size:20px;">FYP Management &amp; Grading System</h2>
                    <p style="color:#94a3b8;margin:6px 0 0;font-size:13px;">Beirut Arab University — Faculty of Engineering</p>
                  </div>
                  <div style="padding:24px 28px;">
                    <p>Dear ${t.name || t.id},</p>
                    <p>Your account credentials for the FYP Management System:</p>
                    <table style="border-collapse:collapse;width:100%;margin:16px 0;border:1px solid #e5e7eb;">
                      <tr style="background:#1e3a5f;color:#fff;"><th style="padding:10px 16px;text-align:left;">Field</th><th style="padding:10px 16px;text-align:left;">Value</th></tr>
                      <tr><td style="padding:10px 16px;font-weight:600;">Supervisor ID</td><td style="padding:10px 16px;font-family:monospace;font-weight:700;">${t.id}</td></tr>
                      <tr><td style="padding:10px 16px;font-weight:600;">Password</td><td style="padding:10px 16px;font-family:monospace;font-weight:700;">${t.password}</td></tr>
                    </table>
                    <div style="text-align:center;margin:24px 0;">
                      <a href="${APP_URL}" style="display:inline-block;background:#2563eb;color:#fff;padding:13px 32px;text-decoration:none;border-radius:7px;font-weight:700;">Open FYP Grading System</a>
                    </div>
                  </div>
                </div>`
              );
              sent.push(String(t.id));
            } catch { failed.push(String(t.id)); }
          }
        }
        return ok({ success: true, sent, failed });
      }

      case 'addProgram': {
        const [sessionToken, name] = args;
        const session = await verifySession(sessionToken);
        if (!session || !session.is_admin) return ok({ success: false, message: 'Unauthorized.' });
        if (!name) return ok({ success: false, message: 'Program name is required.' });
        try {
          await sql`INSERT INTO programs (program_name) VALUES (${name})`;
        } catch { return ok({ success: false, message: 'Program already exists.' }); }
        return ok({ success: true });
      }

      // ─── Projects & Students ─────────────────────────────────────────

      case 'registerProject': {
        const [sessionToken, payload] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, message: 'Session expired.' });

        const existingProjects = await sql`SELECT title FROM projects`;
        if (existingProjects.some(r => r.title.trim().toLowerCase() === (payload.title || '').trim().toLowerCase()))
          return ok({ success: false, message: `A project titled "${payload.title}" already exists. Please use a unique title.` });

        const allStudents = await sql`SELECT student_id, student_name FROM students`;
        for (const s of (payload.students || [])) {
          if (allStudents.some(r => r.student_name.toLowerCase().trim() === s.name.toLowerCase().trim()))
            return ok({ success: false, message: `Student name "${s.name}" already exists.` });
          if (allStudents.some(r => r.student_id === s.id))
            return ok({ success: false, message: `Student ID "${s.id}" already exists.` });
        }

        const idFmt = /^20\d{7}$/;
        for (const s of (payload.students || [])) {
          if (!idFmt.test(s.id)) return ok({ success: false, message: `Invalid Student ID "${s.id}" — must be exactly 9 digits starting with 20.` });
        }
        const supIds = (payload.supervisors || []).map(s => s.id);
        if (new Set(supIds).size !== supIds.length) return ok({ success: false, message: 'Duplicate supervisors are not allowed.' });
        if (!payload.disableNotifications && !(payload.students || []).some(s => s.email && s.email.trim()))
          return ok({ success: false, message: 'At least one student email is required when notifications are enabled.' });

        const projectId  = uid('PRJ');
        const studentIds = [];
        for (const s of (payload.students || [])) {
          await sql`INSERT INTO students (student_id, student_name, email, project_id) VALUES (${s.id}, ${s.name}, ${s.email || ''}, ${projectId})`;
          studentIds.push(s.id);
        }
        await sql`INSERT INTO projects (project_id, title, type, semester, year, end_date, program_type, supervisors, students, disable_notifications) VALUES (${projectId}, ${payload.title}, ${payload.type}, ${payload.semester}, ${payload.year}, ${payload.endDate || ''}, ${payload.programType || ''}, ${supIds.join(',')}, ${studentIds.join(',')}, ${!!payload.disableNotifications})`;
        return ok({ success: true, projectId });
      }

      case 'getProjects': {
        const data = await sql`SELECT * FROM projects ORDER BY created_at DESC`;
        return ok(data.map(mapProject));
      }

      case 'getProjectsFiltered': {
        const [sessionToken] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok([]);
        const [allProjects, allSups] = await Promise.all([
          sql`SELECT * FROM projects ORDER BY created_at DESC`,
          sql`SELECT * FROM supervisors`,
        ]);
        const filtered = await filterProjectsBySession(session, allProjects, allSups);
        return ok(filtered.map(mapProject));
      }

      case 'getStudents': {
        const [sessionToken] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok([]);
        const allStudents = await sql`SELECT * FROM students`;
        if (session.is_admin) return ok(allStudents.map(mapStudent));
        const [allProjects, allSups] = await Promise.all([
          sql`SELECT * FROM projects`,
          sql`SELECT * FROM supervisors`,
        ]);
        const progProjects = await filterProjectsBySession(session, allProjects, allSups);
        const ids = new Set(progProjects.map(p => p.project_id));
        return ok(allStudents.filter(s => ids.has(s.project_id)).map(mapStudent));
      }

      case 'getProjectsWithStudents': {
        const [sessionToken] = args;
        if (!await verifySession(sessionToken)) return ok([]);
        const [projects, students] = await Promise.all([
          sql`SELECT * FROM projects`,
          sql`SELECT * FROM students`,
        ]);
        return ok(projects.map(p => ({ ...mapProject(p), studentList: students.filter(s => s.project_id === p.project_id).map(mapStudent) })));
      }

      case 'getAllProjectsSummary': {
        const [sessionToken] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok([]);
        let data;
        if (session.is_admin) {
          data = await sql`SELECT project_id, title, type FROM projects ORDER BY title`;
        } else {
          const needle = session.supervisor_id.trim().toLowerCase();
          const all = await sql`SELECT project_id, title, type, supervisors FROM projects ORDER BY title`;
          data = all.filter(p => (p.supervisors || '').split(',').map(x => x.trim().toLowerCase()).includes(needle));
        }
        return ok(data.map(r => ({ ProjectID: r.project_id, Title: r.title, Type: r.type })));
      }

      case 'getSupervisedProjectsForGrading': {
        const [sessionToken] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok([]);
        const needle = session.supervisor_id.trim().toLowerCase();
        const [projects, students] = await Promise.all([
          sql`SELECT * FROM projects`,
          sql`SELECT * FROM students`,
        ]);
        return ok(projects
          .filter(p => (p.supervisors || '').split(',').map(x => x.trim().toLowerCase()).includes(needle))
          .map(p => ({
            ProjectID: p.project_id, Title: p.title, Type: p.type,
            studentList: students.filter(s => s.project_id === p.project_id)
              .map(s => ({ StudentID: s.student_id, StudentName: s.student_name })),
          })));
      }

      // ─── Teamwork Config ─────────────────────────────────────────────

      case 'getTeamworkConfig': return ok(await getTWConfig());

      case 'getIndividualRubric': return ok(await getIndividualRubric());

      case 'saveTeamworkConfig': {
        const [sessionToken, updates] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, message: 'Session expired.' });
        if (!session.is_admin) return ok({ success: false, message: 'Only the admin can change grade weights.' });
        const twV   = parseFloat(updates.teamwork_weight     || 0);
        const repV  = parseFloat(updates.report_weight       || 0);
        const presV = parseFloat(updates.presentation_weight || 0);
        const supV  = parseFloat(updates.supervisor_weight   || 0);
        const peerV = parseFloat(updates.peer_eval_weight    || 0);
        if (Math.round(twV + repV + presV) !== 100)
          return ok({ success: false, message: `Teamwork + Report + Presentation must sum to 100% (currently ${twV + repV + presV}%).` });
        if (Math.round(supV + peerV) !== 100)
          return ok({ success: false, message: `Supervisor + Peer Eval portions must sum to 100% (currently ${supV + peerV}%).` });
        for (const [key, value] of Object.entries(updates || {})) {
          await sql`INSERT INTO tw_config (config_key, config_value) VALUES (${key}, ${String(value)}) ON CONFLICT (config_key) DO UPDATE SET config_value = ${String(value)}`;
        }
        return ok({ success: true });
      }

      case 'getSemesterEndDate': {
        const cfg = await getTWConfig();
        return ok({ success: true, date: cfg.semester_end_date || '' });
      }

      case 'saveSemesterEndDate': {
        const [sessionToken, date] = args;
        const session = await verifySession(sessionToken);
        if (!session || !session.is_admin) return ok({ success: false, message: 'Unauthorized.' });
        await sql`INSERT INTO tw_config (config_key, config_value) VALUES ('semester_end_date', ${String(date || '')}) ON CONFLICT (config_key) DO UPDATE SET config_value = ${String(date || '')}`;
        return ok({ success: true });
      }

      case 'saveTWRubric': {
        const [sessionToken, type, criteria] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, message: 'Session expired.' });
        if (!session.is_admin) return ok({ success: false, message: 'Only the admin can save rubrics.' });
        const key  = type === 'group' ? 'group_rubric' : 'individual_rubric';
        const safe = (criteria || []).map(c => ({
          criterion:   String(c.criterion || ''),
          maxGrade:    Math.max(1, Number(c.maxGrade || 25)),
          weight:      Math.max(0, Number(c.weight   || 0)),
          abetOutcome: String(c.abetOutcome || ''),
        }));
        await sql`INSERT INTO tw_config (config_key, config_value) VALUES (${key}, ${JSON.stringify(safe)}) ON CONFLICT (config_key) DO UPDATE SET config_value = ${JSON.stringify(safe)}`;
        return ok({ success: true });
      }

      // ─── Teamwork Grading ────────────────────────────────────────────

      case 'getTeamworkGrades': {
        const [sessionToken, projectId] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok([]);
        const rows = await sql`
          SELECT DISTINCT ON (g.student_id, g.criterion)
            g.student_id, g.criterion, g.grade, g.graded_by, s.name AS supervisor_name
          FROM tw_grades g
          LEFT JOIN supervisors s ON s.supervisor_id = g.graded_by
          WHERE g.project_id = ${projectId} AND g.grade_type = 'Individual'
          ORDER BY g.student_id, g.criterion, g.timestamp DESC
        `;
        return ok(rows.map(r => ({
          studentId:  r.student_id,
          criterion:  r.criterion,
          grade:      Number(r.grade),
          gradedBy:   r.supervisor_name || r.graded_by,
          isMe:       r.graded_by === session.supervisor_id,
        })));
      }

      case 'submitTeamworkGrades': {
        const [sessionToken, projectId, groupGrades, individualGrades] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, message: 'Session expired.' });
        const gradedBy = session.supervisor_id;

        // Delete all grades for this project (shared grade — last write wins)
        await sql`DELETE FROM tw_grades WHERE project_id = ${projectId}`;

        const ts = new Date().toISOString();
        for (const g of (individualGrades || [])) {
          await sql`INSERT INTO tw_grades (grade_id, project_id, student_id, criterion, grade, graded_by, grade_type, timestamp) VALUES (${uid('TG')}, ${projectId}, ${g.studentId}, ${g.criterion}, ${g.grade}, ${gradedBy}, 'Individual', ${ts})`;
        }
        return ok({ success: true });
      }

      case 'getMyPendingTasks': {
        const [sessionToken] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, twTasks: [], examTasks: [] });
        if (session.is_admin) return ok({ success: true, twTasks: [], examTasks: [] });

        const supId = session.supervisor_id;

        // TW lock state — skip TW tasks when grading is not actionable
        const twCfg          = await getTWConfig();
        const twManualLocked = twCfg.tw_locked === 'true';
        const twDateLocked   = twCfg.week14_date
          ? (() => { try { const w = new Date(twCfg.week14_date); w.setHours(23,59,59,999); return new Date() > w; } catch { return false; } })()
          : false;
        const twIsLocked = twManualLocked || twDateLocked;
        const week14Label = twCfg.week14_date || '';
        const semEndLabel = twCfg.semester_end_date || '';

        // ── TW tasks: projects this supervisor owns that are not fully graded ──
        const twTasks = [];
        if (!twIsLocked) {
          const allProjects = await sql`SELECT project_id, title, type, supervisors FROM projects`;
          const myProjects  = allProjects.filter(p =>
            (p.supervisors || '').split(',').map(s => s.trim()).includes(supId)
          );
          if (myProjects.length) {
            const myProjIds = myProjects.map(p => p.project_id);
            const [allStudents, allGrades, indRubric] = await Promise.all([
              sql`SELECT student_id, project_id FROM students WHERE project_id = ANY(${myProjIds})`,
              sql`SELECT project_id, student_id, criterion, graded_by FROM tw_grades WHERE project_id = ANY(${myProjIds}) AND grade_type = 'Individual'`,
              getIndividualRubric(),
            ]);
            for (const proj of myProjects) {
              const pid          = proj.project_id;
              const projStudents = allStudents.filter(s => s.project_id === pid);
              if (!projStudents.length || !indRubric.length) continue;
              const expected    = projStudents.length * indRubric.length;
              const humanGrades = allGrades.filter(g => g.project_id === pid && g.graded_by !== 'system').length;
              if (humanGrades < expected) {
                twTasks.push({ projectId: pid, title: proj.title, type: String(proj.type || 'FYP1'),
                  status: humanGrades === 0 ? 'not_started' : 'in_progress', graded: humanGrades, total: expected });
              }
            }
          }
        }

        // ── Examiner tasks: assignments where this supervisor is the examiner ──
        const examTasks = [];
        const supEmailRows = await sql`SELECT email FROM supervisors WHERE supervisor_id = ${supId}`;
        const supEmail = supEmailRows[0] ? String(supEmailRows[0].email || '').trim().toLowerCase() : '';
        if (supEmail) {
          const assignments = await sql`
            SELECT e.project_id, e.examiner_type, e.status, e.token, e.report_link,
                   p.title AS project_title, p.supervisors AS proj_sups
            FROM examiners e
            LEFT JOIN projects p ON p.project_id = e.project_id
            WHERE LOWER(e.examiner_email) = ${supEmail} AND e.status != 'Submitted'
          `;
          if (assignments.length) {
            const allSupIds = [...new Set(
              assignments.flatMap(a => (a.proj_sups || '').split(',').map(s => s.trim()).filter(Boolean))
            )];
            const supNameRows = allSupIds.length
              ? await sql`SELECT supervisor_id, name FROM supervisors WHERE supervisor_id = ANY(${allSupIds})`
              : [];
            const supNameMap = {};
            supNameRows.forEach(r => { supNameMap[r.supervisor_id] = r.name; });
            for (const a of assignments) {
              const supIds = (a.proj_sups || '').split(',').map(s => s.trim()).filter(Boolean);
              const supervisorNames = supIds.map(id => supNameMap[id] || id).join(', ') || '—';
              const isIndustry = a.examiner_type === 'Industry';
              const missing    = isIndustry             ? ['Presentation']
                               : a.status === 'Pending' ? ['Report', 'Presentation']
                               :                          ['Presentation'];
              examTasks.push({ projectId: a.project_id, projectTitle: a.project_title || '—',
                supervisorNames, examinerType: a.examiner_type, status: a.status,
                token: a.token, missing, reportLink: a.report_link || '' });
            }
          }
        }

        return ok({ success: true, twTasks, examTasks, week14Label, semEndLabel });
      }

      // ─── Feedback ────────────────────────────────────────────────────

      case 'submitFeedback': {
        const [sessionToken, message] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, message: 'Session expired.' });
        const from = session.name || session.supervisor_id;
        const ts   = new Date().toISOString();
        await sql`CREATE TABLE IF NOT EXISTS feedback (
          id TEXT PRIMARY KEY, supervisor_id TEXT, supervisor_name TEXT,
          program TEXT, message TEXT, submitted_at TIMESTAMPTZ DEFAULT NOW(), is_read BOOLEAN DEFAULT FALSE
        )`;
        await sql`INSERT INTO feedback (id, supervisor_id, supervisor_name, program, message, submitted_at)
                  VALUES (${uid('FB')}, ${session.supervisor_id}, ${from}, ${session.program || ''}, ${String(message || '')}, ${ts})`;
        try {
          await sendEmail(
            'yousef.ajrah@bau.edu.lb',
            `FYP System Feedback — from ${from}`,
            `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:28px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;">
              <h3 style="color:#1e3a5f;margin-top:0;border-bottom:2px solid #e5e7eb;padding-bottom:12px;">FYP System — User Feedback</h3>
              <p><strong>From:</strong> ${from}</p>
              <p><strong>ID:</strong> ${session.supervisor_id}</p>
              <p><strong>Program:</strong> ${session.program || '—'}</p>
              <p><strong>Submitted:</strong> ${new Date(ts).toLocaleString('en-GB')}</p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;"/>
              <p style="white-space:pre-wrap;line-height:1.7;color:#374151;">${String(message || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;"/>
              <p style="color:#9ca3af;font-size:12px;margin:0;">Sent via the FYP Management System feedback form. All submissions are also stored in the system dashboard.</p>
            </div>`
          );
        } catch { /* email failure doesn't affect the stored record */ }
        return ok({ success: true });
      }

      case 'getFeedbacks': {
        const [sessionToken] = args;
        const session = await verifySession(sessionToken);
        if (!session || !session.is_admin) return ok({ success: false, message: 'Unauthorized.' });
        await sql`CREATE TABLE IF NOT EXISTS feedback (
          id TEXT PRIMARY KEY, supervisor_id TEXT, supervisor_name TEXT,
          program TEXT, message TEXT, submitted_at TIMESTAMPTZ DEFAULT NOW(), is_read BOOLEAN DEFAULT FALSE
        )`;
        const rows = await sql`SELECT * FROM feedback ORDER BY submitted_at DESC`;
        await sql`UPDATE feedback SET is_read = TRUE WHERE is_read = FALSE`;
        return ok({ success: true, feedbacks: rows.map(r => ({
          id: r.id, supervisorId: r.supervisor_id, name: r.supervisor_name,
          program: r.program, message: r.message,
          submittedAt: r.submitted_at, isRead: r.is_read,
        })) });
      }

      case 'getUnreadFeedbackCount': {
        const [sessionToken] = args;
        const session = await verifySession(sessionToken);
        if (!session || !session.is_admin) return ok({ count: 0 });
        try {
          await sql`CREATE TABLE IF NOT EXISTS feedback (
            id TEXT PRIMARY KEY, supervisor_id TEXT, supervisor_name TEXT,
            program TEXT, message TEXT, submitted_at TIMESTAMPTZ DEFAULT NOW(), is_read BOOLEAN DEFAULT FALSE
          )`;
          const rows = await sql`SELECT COUNT(*) AS cnt FROM feedback WHERE is_read = FALSE`;
          return ok({ count: Number(rows[0]?.cnt || 0) });
        } catch { return ok({ count: 0 }); }
      }

      // ─── Peer Evaluation ─────────────────────────────────────────────

      case 'getPeerEvalURL': {
        const [sessionToken] = args;
        if (!await verifySession(sessionToken)) return ok({ success: false, message: 'Session expired.' });
        return ok(`${APP_URL}/peer.html`);
      }

      case 'getPeerEvalStatus': {
        const [sessionToken] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok([]);
        const needle = session.supervisor_id.trim().toLowerCase();
        const [allProjects, allStudents, peerEvals] = await Promise.all([
          sql`SELECT * FROM projects`,
          sql`SELECT * FROM students`,
          sql`SELECT evaluator_id FROM peer_evaluations`,
        ]);
        const myProjects  = allProjects.filter(p => (p.supervisors || '').split(',').map(x => x.trim().toLowerCase()).includes(needle));
        const submittedIds = new Set(peerEvals.map(e => e.evaluator_id));
        return ok(myProjects.map(p => {
          const studs = allStudents.filter(s => s.project_id === p.project_id);
          const studentStatuses = studs.map(s => ({ id: s.student_id, name: s.student_name, submitted: submittedIds.has(s.student_id) }));
          return { projectId: p.project_id, projectTitle: p.title, allSubmitted: studentStatuses.length > 0 && studentStatuses.every(s => s.submitted), students: studentStatuses };
        }));
      }

      case 'getPeerEvalConfig': {
        const data = await sql`SELECT * FROM peer_config ORDER BY question_no`;
        return ok(data.map(mapPeerConfig));
      }

      case 'savePeerEvalConfig': {
        const [sessionToken, questions] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, message: 'Session expired.' });
        if (!session.is_admin) return ok({ success: false, message: 'Only the admin can edit peer eval questions.' });
        await sql`DELETE FROM peer_config WHERE question_no != 0`;
        const inserts = (questions || []).map((q, i) => ({ question_no: i + 1, question_text: q.text, max_grade: q.maxGrade || 10, weight: q.weight || 20, abet_outcome: q.abetOutcome || '' }));
        for (const q of inserts) {
          await sql`INSERT INTO peer_config (question_no, question_text, max_grade, weight, abet_outcome) VALUES (${q.question_no}, ${q.question_text}, ${q.max_grade}, ${q.weight}, ${q.abet_outcome})`;
        }
        return ok({ success: true });
      }

      case 'validateStudentForPeerEval': {
        const [studentId] = args;
        const studentRows = await sql`SELECT * FROM students WHERE student_id = ${String(studentId)}`;
        const student = studentRows[0] || null;
        if (!student) return ok({ valid: false, message: 'Student ID not found.' });
        const existingRows = await sql`SELECT eval_id FROM peer_evaluations WHERE evaluator_id = ${String(studentId)} LIMIT 1`;
        if (existingRows.length) return ok({ valid: false, message: 'You have already submitted your peer evaluation.' });
        const projectRows = await sql`SELECT * FROM projects WHERE project_id = ${student.project_id}`;
        const project = projectRows[0] || null;
        if (!project) return ok({ valid: false, message: 'No project associated with this student.' });
        const teammates = await sql`SELECT * FROM students WHERE project_id = ${student.project_id} AND student_id != ${String(studentId)}`;
        const questions = await sql`SELECT * FROM peer_config ORDER BY question_no`;
        return ok({
          valid: true,
          student:   { id: student.student_id, name: student.student_name },
          project:   { id: project.project_id, title: project.title },
          teammates: teammates.map(t => ({ id: t.student_id, name: t.student_name })),
          questions: questions.map(mapPeerConfig),
        });
      }

      case 'submitPeerEvaluation': {
        const [evaluatorId, projectId, grades] = args;
        const evalStudentRows = await sql`SELECT student_id FROM students WHERE student_id = ${String(evaluatorId)} AND project_id = ${String(projectId)}`;
        if (!evalStudentRows[0]) return ok({ success: false, message: 'Invalid student or project.' });
        const existingRows = await sql`SELECT eval_id FROM peer_evaluations WHERE evaluator_id = ${String(evaluatorId)} LIMIT 1`;
        if (existingRows.length) return ok({ success: false, message: 'You have already submitted your peer evaluation.' });
        const teammates = await sql`SELECT student_id FROM students WHERE project_id = ${String(projectId)} AND student_id != ${String(evaluatorId)}`;
        const validTeammateIds = new Set(teammates.map(t => t.student_id));
        for (const g of (grades || [])) {
          if (!validTeammateIds.has(String(g.evaluatedId))) return ok({ success: false, message: 'Invalid evaluated student.' });
        }
        const ts = new Date().toISOString();
        const inserts = (grades || []).map(g => ({ eval_id: uid('PE'), project_id: projectId, evaluator_id: evaluatorId, evaluated_id: g.evaluatedId, question_no: g.questionNo, grade: g.grade, submitted_at: ts }));
        try {
          for (const i of inserts) {
            await sql`INSERT INTO peer_evaluations (eval_id, project_id, evaluator_id, evaluated_id, question_no, grade, submitted_at) VALUES (${i.eval_id}, ${i.project_id}, ${i.evaluator_id}, ${i.evaluated_id}, ${i.question_no}, ${i.grade}, ${i.submitted_at})`;
          }
        } catch(e) {
          if (e.code === '23505') return ok({ success: false, message: 'You have already submitted your peer evaluation.' });
          return ok({ success: false, message: e.message });
        }
        return ok({ success: true });
      }

      // ─── Examiner Config ─────────────────────────────────────────────

      case 'getExaminerConfig': {
        const [sessionToken] = args;
        if (!await verifySession(sessionToken)) return ok([]);
        const data = await sql`SELECT * FROM examiner_config ORDER BY id`;
        return ok(data.map(mapExConfig));
      }

      case 'saveExaminerConfig': {
        const [sessionToken, criteria] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, message: 'Session expired.' });
        if (!session.is_admin) return ok({ success: false, message: 'Only the admin can edit the examiner rubric.' });
        await sql`DELETE FROM examiner_config WHERE id != 0`;
        const inserts = (criteria || []).map(c => ({
          project_type: c.projectType, category: c.category, criterion_name: c.criterionName,
          max_grade: c.maxGrade, weight: c.weight, grading_scope: c.gradingScope || 'Individual',
          abet_outcome: c.abetOutcome || '',
        }));
        for (const c of inserts) {
          await sql`INSERT INTO examiner_config (project_type, category, criterion_name, max_grade, weight, grading_scope, abet_outcome) VALUES (${c.project_type}, ${c.category}, ${c.criterion_name}, ${c.max_grade}, ${c.weight}, ${c.grading_scope}, ${c.abet_outcome})`;
        }
        return ok({ success: true });
      }

      // ─── Examiner Assignment ─────────────────────────────────────────

      case 'assignExaminers': {
        const [sessionToken, projectId, examiners, reportLink] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, message: 'Session expired.' });
        const link = String(reportLink || '');
        if (link && !link.startsWith('https://')) return ok({ success: false, message: 'Report link must use HTTPS.' });

        const existing  = await sql`SELECT * FROM examiners WHERE project_id = ${projectId}`;
        const newEmails = (examiners || []).map(e => String(e.email).toLowerCase());

        // Only remove examiners that were never emailed; keep Invited/Submitted ones
        for (const old of existing) {
          if (!newEmails.includes(old.examiner_email.toLowerCase()) && old.status === 'Assigned') {
            await sql`DELETE FROM examiner_grades WHERE assignment_id = ${old.assignment_id}`;
            await sql`DELETE FROM examiners WHERE assignment_id = ${old.assignment_id}`;
          }
        }

        const assignments = [];
        const warnings    = [];
        for (const ex of (examiners || [])) {
          const found = existing.find(e => e.examiner_email.toLowerCase() === String(ex.email).toLowerCase());
          if (found && found.status !== 'Assigned') {
            // Already emailed — preserve as-is, warn the caller
            warnings.push({ name: found.examiner_name || found.examiner_email, email: found.examiner_email });
            continue;
          }
          let token, aId;
          if (found) {
            token = found.token; aId = found.assignment_id;
            await sql`UPDATE examiners SET examiner_name = ${ex.name || ''}, examiner_type = ${ex.type}, report_link = ${link} WHERE assignment_id = ${aId}`;
          } else {
            token = genToken(); aId = uid('EXM');
            await sql`INSERT INTO examiners (assignment_id, project_id, examiner_name, examiner_email, examiner_type, token, status, report_link) VALUES (${aId}, ${projectId}, ${ex.name || ''}, ${ex.email}, ${ex.type}, ${token}, 'Assigned', ${link})`;
          }
          assignments.push({ assignmentId: aId, name: ex.name || '', email: ex.email, type: ex.type, token, reportLink: link });
        }
        return ok({ success: true, assignments, warnings });
      }

      case 'sendExaminerEmails': {
        const [sessionToken, projectId, assignments] = args;
        if (!await verifySession(sessionToken)) return ok({ success: false, message: 'Session expired.' });
        const projectRows = await sql`SELECT title, supervisors FROM projects WHERE project_id = ${projectId}`;
        const project = projectRows[0] || null;
        const v2SupIds = (project?.supervisors || '').split(',').map(x => x.trim()).filter(Boolean);
        const v2SupRows = v2SupIds.length ? await sql`SELECT name FROM supervisors WHERE supervisor_id = ANY(${v2SupIds})` : [];
        const v2SupervisorName = v2SupRows.map(r => r.name).join(', ') || '—';
        const RUBRIC_PDF = 'https://mirror-logic.github.io/fyp-grading/FYP%20Grading%20and%20Rubrics.pdf';
        await Promise.all((assignments || []).map(async a => {
          const link = `${APP_URL}/examiner.html?token=${a.token}`;
          const reportBlock = a.reportLink ? `<p><strong>Project Report:</strong><br/><a href="${a.reportLink}">${a.reportLink}</a></p>` : '';
          await sendEmail(
            a.email,
            `FYP Grading Assignment – ${project ? project.title : projectId}`,
            `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;text-align:left;">
              <h2 style="color:#1e3a5f;">FYP Grading Assignment</h2>
              <p>Dear ${a.name || 'Examiner'},</p>
              <p>You have been assigned to evaluate: <strong>${project ? project.title : projectId}</strong><br/>Supervisor: <strong>${v2SupervisorName}</strong><br/>Role: ${a.type}</p>
              ${reportBlock}
              <p><strong>FYP Grading Rubrics:</strong> <a href="${RUBRIC_PDF}">View Rubrics</a></p>
              <p><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:bold;">Open Grading Portal</a></p>
              <p style="color:#666;font-size:12px;">This link is unique to you. Do not share it.</p>
              <hr/><p style="color:#666;font-size:12px;">FYP Management System — Beirut Arab University — ECE Department</p>
            </div>`
          );
          await sql`UPDATE examiners SET status = 'Invited' WHERE assignment_id = ${a.assignmentId} AND status = 'Assigned'`;
        }));
        return ok({ success: true });
      }

      case 'removeExaminer': {
        const [sessionToken, assignmentId] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, message: 'Session expired.' });
        const examinerRows = await sql`SELECT status FROM examiners WHERE assignment_id = ${assignmentId}`;
        const examiner = examinerRows[0] || null;
        if (!examiner) return ok({ success: false, message: 'Examiner not found.' });
        if (examiner.status !== 'Assigned') return ok({ success: false, message: 'Cannot remove an examiner after the invitation email has been sent.' });
        await sql`DELETE FROM examiner_grades WHERE assignment_id = ${assignmentId}`;
        await sql`DELETE FROM examiners WHERE assignment_id = ${assignmentId}`;
        return ok({ success: true });
      }

      case 'getExaminersForProject': {
        const [sessionToken, projectId] = args;
        if (!await verifySession(sessionToken)) return ok([]);
        const data = await sql`
          SELECT e.*,
            EXISTS(SELECT 1 FROM examiner_grades g WHERE g.assignment_id = e.assignment_id AND g.category = 'Report')       AS has_report,
            EXISTS(SELECT 1 FROM examiner_grades g WHERE g.assignment_id = e.assignment_id AND g.category = 'Presentation') AS has_presentation
          FROM examiners e
          WHERE e.project_id = ${projectId}
        `;
        return ok(data.map(r => ({ ...mapExaminer(r), HasReport: r.has_report, HasPresentation: r.has_presentation })));
      }

      case 'resendExaminerEmail': {
        const [sessionToken, assignmentId] = args;
        if (!await verifySession(sessionToken)) return ok({ success: false, message: 'Session expired.' });
        const rows = await sql`SELECT e.*, p.title, p.supervisors FROM examiners e JOIN projects p ON p.project_id = e.project_id WHERE e.assignment_id = ${assignmentId}`;
        const e = rows[0];
        if (!e) return ok({ success: false, message: 'Examiner not found.' });
        const v2rSupIds = (e.supervisors || '').split(',').map(x => x.trim()).filter(Boolean);
        const v2rSupRows = v2rSupIds.length ? await sql`SELECT name FROM supervisors WHERE supervisor_id = ANY(${v2rSupIds})` : [];
        const v2rSupervisorName = v2rSupRows.map(r => r.name).join(', ') || '—';
        const RUBRIC_PDF = 'https://mirror-logic.github.io/fyp-grading/FYP%20Grading%20and%20Rubrics.pdf';
        const link = `${APP_URL}/examiner.html?token=${e.token}`;
        const reportBlock = e.report_link ? `<p><strong>Project Report:</strong><br/><a href="${e.report_link}">${e.report_link}</a></p>` : '';
        await sendEmail(
          e.examiner_email,
          `FYP Grading Assignment – ${e.title || assignmentId}`,
          `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;text-align:left;">
            <h2 style="color:#1e3a5f;">FYP Grading Assignment</h2>
            <p>Dear ${e.examiner_name || 'Examiner'},</p>
            <p>You have been assigned to evaluate: <strong>${e.title || assignmentId}</strong><br/>Supervisor: <strong>${v2rSupervisorName}</strong><br/>Role: ${e.examiner_type}</p>
            ${reportBlock}
            <p><strong>FYP Grading Rubrics:</strong> <a href="${RUBRIC_PDF}">View Rubrics</a></p>
            <p><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:bold;">Open Grading Portal</a></p>
            <p style="color:#666;font-size:12px;">This link is unique to you. Do not share it.</p>
            <hr/><p style="color:#666;font-size:12px;">FYP Management System — Beirut Arab University — ECE Department</p>
          </div>`
        );
        await sql`UPDATE examiners SET status = 'Invited' WHERE assignment_id = ${assignmentId} AND status = 'Assigned'`;
        return ok({ success: true });
      }

      // ─── Examiner Portal ─────────────────────────────────────────────

      case 'getExaminerByToken': {
        const [token] = args;
        const assignmentRows = await sql`SELECT * FROM examiners WHERE token = ${token}`;
        const assignment = assignmentRows[0] || null;
        if (!assignment) return ok({ valid: false, message: 'Invalid or expired access link.' });
        if (assignment.status === 'Submitted') return ok({ valid: false, message: 'You have already submitted grades for this project.' });

        const assignedAt = new Date(assignment.assigned_at || 0);
        if (isNaN(assignedAt.getTime()) || Date.now() > assignedAt.getTime() + TOKEN_EXPIRY_DAYS * 24 * 3600 * 1000)
          return ok({ valid: false, message: 'This grading link has expired. Please contact your supervisor to receive a new link.' });

        const [projectRows, students, allConfig, cfg] = await Promise.all([
          sql`SELECT * FROM projects WHERE project_id = ${assignment.project_id}`,
          sql`SELECT * FROM students WHERE project_id = ${assignment.project_id}`,
          sql`SELECT * FROM examiner_config ORDER BY id`,
          getTWConfig(),
        ]);
        const project = projectRows[0] || null;

        const projectType = project ? String(project.type || 'FYP1') : 'FYP1';
        const typed  = allConfig.filter(c => String(c.project_type) === projectType);
        const config = typed.length ? typed : allConfig;

        let presentationLocked = true;
        if (cfg.semester_end_date) {
          try {
            const endDate = new Date(cfg.semester_end_date);
            endDate.setHours(23, 59, 59, 999);
            presentationLocked = new Date() < endDate;
          } catch {}
        }

        let draftGrades = [];
        try { if (assignment.draft_grades) draftGrades = Array.isArray(assignment.draft_grades) ? assignment.draft_grades : JSON.parse(assignment.draft_grades); } catch {}

        return ok({
          valid: true,
          presentationLocked,
          reportSubmitted: assignment.status === 'ReportSubmitted',
          draftGrades,
          assignment: { id: assignment.assignment_id, name: assignment.examiner_name, email: assignment.examiner_email, type: assignment.examiner_type, reportLink: assignment.report_link || '' },
          project:    { id: project ? project.project_id : '', title: project ? project.title : '', type: projectType },
          students:   students.map(s => ({ id: s.student_id, name: s.student_name })),
          config:     config.map(mapExConfig),
        });
      }

      case 'saveExaminerDraft': {
        const [token, grades] = args;
        const assignmentRows = await sql`SELECT assignment_id, status FROM examiners WHERE token = ${token}`;
        const assignment = assignmentRows[0] || null;
        if (!assignment) return ok({ success: false, message: 'Invalid token.' });
        if (assignment.status === 'Submitted') return ok({ success: false, message: 'Already submitted.' });
        const safe = (grades || []).map(g => ({ category: String(g.category||''), criterion: String(g.criterion||''), studentId: String(g.studentId||''), score: Number(g.score||0) }));
        await sql`UPDATE examiners SET draft_grades = ${JSON.stringify(safe)}::jsonb WHERE assignment_id = ${assignment.assignment_id}`;
        return ok({ success: true });
      }

      case 'submitExaminerGrades': {
        const [token, gradesPayload] = args;
        const assignmentRows = await sql`SELECT * FROM examiners WHERE token = ${token}`;
        const assignment = assignmentRows[0] || null;
        if (!assignment) return ok({ success: false, message: 'Invalid token.' });
        if (assignment.status === 'Submitted') return ok({ success: false, message: 'Already submitted.' });

        const cfg = await getTWConfig();
        let presentationLocked = true;
        if (cfg.semester_end_date) {
          try {
            const endDate = new Date(cfg.semester_end_date);
            endDate.setHours(23, 59, 59, 999);
            presentationLocked = new Date() < endDate;
          } catch {}
        }
        if (presentationLocked && (gradesPayload.grades || []).some(g => g.category === 'Presentation'))
          return ok({ success: false, message: 'Presentation grading is not yet open.' });

        const grades     = gradesPayload.grades || [];
        const isIndustry = assignment.examiner_type === 'Industry';
        const hasReport  = grades.some(g => g.category === 'Report');
        const hasPres    = grades.some(g => g.category === 'Presentation');

        // Partial: non-Industry examiner whose submission has no presentation grades
        // (date-independent — only complete when both Report + Presentation are present)
        const isPartial  = !isIndustry && hasReport && !hasPres;

        const ts = new Date().toISOString();
        // Delete existing grades first to avoid duplicates on re-submission
        await sql`DELETE FROM examiner_grades WHERE assignment_id = ${assignment.assignment_id}`;
        for (const g of grades) {
          await sql`INSERT INTO examiner_grades (grade_id, assignment_id, project_id, examiner_email, category, criterion, student_id, score, submitted_at) VALUES (${uid('EG')}, ${assignment.assignment_id}, ${assignment.project_id}, ${assignment.examiner_email}, ${g.category}, ${g.criterion}, ${g.studentId || ''}, ${g.score}, ${ts})`;
        }

        if (isPartial) {
          // Save submitted grades as draft so they pre-fill on next visit
          const safeDraft = grades.map(g => ({ category: g.category, criterion: g.criterion, studentId: g.studentId || '', score: g.score }));
          await sql`UPDATE examiners SET status = 'ReportSubmitted', draft_grades = ${JSON.stringify(safeDraft)}::jsonb WHERE assignment_id = ${assignment.assignment_id}`;
          return ok({ success: true, partial: true });
        }

        // Complete submission
        await sql`UPDATE examiners SET status = 'Submitted' WHERE assignment_id = ${assignment.assignment_id}`;

        // Confirmation email — fire-and-forget, never blocks response
        try {
          const projRows      = await sql`SELECT title, supervisors, type FROM projects WHERE project_id = ${assignment.project_id}`;
          const proj          = projRows[0] || null;
          const projectTitle  = proj ? proj.title : '—';
          const projectType   = proj ? String(proj.type || 'FYP1') : 'FYP1';
          const supIds        = proj ? (proj.supervisors || '').split(',').map(s => s.trim()).filter(Boolean) : [];
          const supRows       = supIds.length ? await sql`SELECT name FROM supervisors WHERE supervisor_id = ANY(${supIds})` : [];
          const supervisorName = supRows.map(r => r.name).join(', ') || '—';
          const rawCfg        = await sql`SELECT * FROM examiner_config WHERE project_type = ${projectType} ORDER BY id`;
          const cfgMap        = {};
          for (const c of rawCfg) cfgMap[`${c.category}::${c.criterion_name}`] = { weight: c.weight, maxGrade: c.max_grade };

          const examinerName   = assignment.examiner_name || 'Examiner';
          const examinerType   = assignment.examiner_type;
          const isIndustryExam = examinerType === 'Industry';

          const buildGradeTable = (cat) => {
            const catGrades = grades.filter(g => g.category === cat);
            if (!catGrades.length) return '';
            const hasStudentCol = catGrades.some(g => g.studentId);
            const thSt = 'padding:8px 12px;border:1px solid #e5e7eb;font-size:12px;color:#374151;font-weight:600;';
            const tdSt = 'padding:8px 12px;border:1px solid #e5e7eb;font-size:13px;';
            const thead = `<tr style="background:#f0f4ff;"><th style="${thSt}text-align:left;">Criterion</th>${hasStudentCol ? `<th style="${thSt}text-align:center;">Student</th>` : ''}<th style="${thSt}text-align:center;">Score</th><th style="${thSt}text-align:center;">Weight</th><th style="${thSt}text-align:center;">Max</th></tr>`;
            const tbody = catGrades.map(g => {
              const c = cfgMap[`${cat}::${g.criterion}`] || {};
              return `<tr><td style="${tdSt}color:#374151;">${g.criterion}</td>${hasStudentCol ? `<td style="${tdSt}text-align:center;color:#6b7280;">${g.studentId || '—'}</td>` : ''}<td style="${tdSt}text-align:center;font-weight:700;color:#0a1f44;">${g.score}</td><td style="${tdSt}text-align:center;color:#6b7280;">${c.weight != null ? c.weight + '%' : '—'}</td><td style="${tdSt}text-align:center;color:#6b7280;">${c.maxGrade != null ? c.maxGrade : '—'}</td></tr>`;
            }).join('');
            return `<p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#0a1f44;">${cat} Grades</p><table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 24px;">${thead}${tbody}</table>`;
          };

          const categories     = isIndustryExam ? ['Presentation'] : ['Report', 'Presentation'];
          const tablesHtml     = categories.map(buildGradeTable).join('');
          const completionNote = isIndustryExam
            ? 'the <strong>Presentation</strong> grading'
            : 'grading of both the <strong>Report</strong> and <strong>Presentation</strong>';

          await sendEmail(
            assignment.examiner_email,
            `Grade Submission Confirmed — ${projectTitle}`,
            `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;"><tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
  <tr><td align="center" style="background:#ffffff;padding:28px 40px 16px;"><img src="https://usif-3jra.github.io/epme-study-plan/assets/logo_ECE.png" alt="BAU ECE" width="130" style="display:block;max-width:130px;height:auto;"/></td></tr>
  <tr><td style="background:#0a1f44;padding:24px 40px;text-align:center;"><div style="color:#fff;font-size:20px;font-weight:700;letter-spacing:.02em;margin-bottom:6px;">FYP Management &amp; Grading System</div><div style="color:#94a3b8;font-size:13px;">Beirut Arab University — Faculty of Engineering — ECE Department</div></td></tr>
  <tr><td style="padding:32px 40px;color:#2d2d2d;font-size:15px;line-height:1.7;">
    <p style="margin:0 0 16px;">Dear ${examinerName},</p>
    <div style="background:#e8f5e9;border-left:4px solid #22c55e;border-radius:6px;padding:14px 18px;margin:0 0 20px;font-size:14px;color:#166534;"><strong>&#10003; Submission Confirmed</strong> &mdash; Your grades have been successfully recorded.</div>
    <p style="margin:0 0 16px;">Thank you for completing ${completionNote} for the following project:</p>
    <div style="background:#f0f4ff;border-left:4px solid #0a1f44;border-radius:6px;padding:18px 24px;margin:0 0 24px;">
      <table cellpadding="0" cellspacing="0" style="width:100%;">
        <tr><td style="font-size:13px;color:#6b7280;font-weight:600;padding:5px 0;width:140px;">Project Title</td><td style="font-size:14px;font-weight:700;color:#0a1f44;padding:5px 0;">${projectTitle}</td></tr>
        <tr><td style="font-size:13px;color:#6b7280;font-weight:600;padding:5px 0;border-top:1px solid #dde3f3;">Supervisor(s)</td><td style="font-size:14px;font-weight:700;color:#0a1f44;padding:5px 0;border-top:1px solid #dde3f3;">${supervisorName}</td></tr>
        <tr><td style="font-size:13px;color:#6b7280;font-weight:600;padding:5px 0;border-top:1px solid #dde3f3;">Examiner Role</td><td style="font-size:14px;font-weight:700;color:#0a1f44;padding:5px 0;border-top:1px solid #dde3f3;">${examinerType} Examiner</td></tr>
      </table>
    </div>
    <p style="margin:0 0 16px;font-size:14px;color:#374151;">A summary of the grades you submitted is provided below:</p>
    ${tablesHtml}
    <p style="margin:0 0 8px;font-size:14px;color:#374151;">No further action is required. Should you have any questions, please contact the ECE Department.</p>
    <p style="margin:0 0 4px;">Best regards,</p>
    <p style="margin:0 0 2px;font-weight:600;">ECE Department Administration</p>
    <p style="margin:0;color:#6b7280;font-size:13px;">Faculty of Engineering &mdash; Beirut Arab University</p>
  </td></tr>
  <tr><td style="border-top:1px solid #e5e7eb;padding:16px 40px;text-align:center;color:#9ca3af;font-size:11px;background:#f9fafb;">
    &copy; 2026 Beirut Arab University &mdash; Faculty of Engineering &mdash; ECE Department<br/>
    This is an automated message. Please do not reply directly to this email.
  </td></tr>
</table>
</td></tr></table>
</body></html>`
          );
        } catch {}

        return ok({ success: true });
      }

      // ─── Final Results ────────────────────────────────────────────────

      case 'getDetailedResults': {
        const [sessionToken] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, message: 'Session expired.' });

        const [allProjects, allStudents, twGrades, peerEvals, exGrades, allSups, exCfg, peerCfg, allExaminers] = await Promise.all([
          sql`SELECT * FROM projects`,
          sql`SELECT * FROM students`,
          sql`SELECT * FROM tw_grades`,
          sql`SELECT * FROM peer_evaluations`,
          sql`SELECT * FROM examiner_grades`,
          sql`SELECT * FROM supervisors`,
          sql`SELECT * FROM examiner_config ORDER BY id`,
          sql`SELECT * FROM peer_config ORDER BY question_no`,
          sql`SELECT * FROM examiners`,
        ]);
        const cfg       = await getTWConfig();
        const indRubric = await getIndividualRubric();

        const twW   = parseFloat(cfg.teamwork_weight     || 35) / 100;
        const peerW = parseFloat(cfg.peer_eval_weight    || 20) / 100;
        const supW  = parseFloat(cfg.supervisor_weight   || 80) / 100;
        const repW  = parseFloat(cfg.report_weight       || 35) / 100;
        const presW = parseFloat(cfg.presentation_weight || 30) / 100;

        let projects = await filterProjectsBySession(session, allProjects, allSups);

        const projectDetails = projects.map(proj => {
          const pid      = proj.project_id;
          const projType = String(proj.type || 'FYP1');
          const supIds   = (proj.supervisors || '').split(',').map(s => s.trim()).filter(Boolean);
          const supNames = supIds.map(id => { const s = allSups.find(s => s.supervisor_id === id); return s ? s.name : id; });
          const projStudents = allStudents.filter(s => s.project_id === pid);
          const projExCfg    = exCfg.filter(c => !c.project_type || c.project_type === projType);
          const repCfg       = projExCfg.filter(c => c.category === 'Report');
          const presCfg      = projExCfg.filter(c => c.category === 'Presentation');
          const projGrades   = exGrades.filter(g => g.project_id === pid);
          const projExList   = allExaminers.filter(e => e.project_id === pid);

          // Grade lookup: assignmentId -> criterion -> studentId -> score
          const gLookup = {};
          projGrades.forEach(g => {
            if (!gLookup[g.assignment_id]) gLookup[g.assignment_id] = {};
            if (!gLookup[g.assignment_id][g.criterion]) gLookup[g.assignment_id][g.criterion] = {};
            gLookup[g.assignment_id][g.criterion][g.student_id] = parseFloat(g.score || 0);
          });

          // Examiners who submitted each category
          const repExaminers  = projExList.filter(e => projGrades.some(g => g.assignment_id === e.assignment_id && g.category === 'Report'));
          const presExaminers = projExList.filter(e => projGrades.some(g => g.assignment_id === e.assignment_id && g.category === 'Presentation'));

          // Build per-examiner table for a category
          const buildExTable = (examList, criteria, category, sid, showNames) => {
            if (!examList.length || !criteria.length) return null;
            const exNames = showNames
              ? examList.map(e => `${e.examiner_name || e.examiner_email} (${e.examiner_type})`)
              : examList.map((_, i) => `Examiner ${i + 1}`);
            const rows = criteria.map((c, idx) => {
              const isGroup  = (c.grading_scope || 'Individual') === 'Group';
              const lookupId = isGroup ? 'GROUP' : sid;
              const scores   = examList.map(e => {
                const s = gLookup[e.assignment_id]?.[c.criterion_name]?.[lookupId];
                return s !== undefined ? s : null;
              });
              return { num: idx + 1, criterion: c.criterion_name, scope: isGroup ? 'Group' : 'Individual', maxGrade: parseFloat(c.max_grade), weight: parseFloat(c.weight), scores };
            });
            const allG  = projGrades.filter(g => g.category === category && (g.student_id === sid || g.student_id === 'GROUP'));
            const pctVal = weightedPct(allG.map(g => ({ Criterion: g.criterion, Score: g.score })), criteria.map(c => ({ CriterionName: c.criterion_name, MaxGrade: c.max_grade, Weight: c.weight })));
            return { examiners: exNames, rows, pct: rnd(pctVal) };
          };

          const studentsData = projStudents.map(student => {
            const sid = student.student_id;

            const twDetails = indRubric.map((r, idx) => {
              const g = twGrades.find(g => g.student_id === sid && g.criterion === r.criterion && g.grade_type === 'Individual');
              return { num: idx + 1, criterion: r.criterion, grade: g ? parseFloat(g.grade) : 0, maxGrade: Number(r.maxGrade || 25) };
            });
            const indMax  = indRubric.reduce((s, r) => s + Number(r.maxGrade || 25), 0) || 100;
            const indPct  = pct(twDetails.reduce((s, d) => s + d.grade, 0), indMax);
            const peer      = peerEvals.filter(e => e.evaluated_id === sid);
            const maxPeer   = peerCfg.reduce((s, q) => s + parseFloat(q.max_grade || 10), 0);
            const peerCount = peerCfg.length || 1;
            const peerPct   = pct(peer.reduce((s, e) => s + parseFloat(e.grade || 0), 0), maxPeer * (peer.length / peerCount));
            const isSolo    = projStudents.length === 1;
            const twScore   = isSolo ? indPct : (indPct * supW) + (peerPct * peerW);

            const peerDetails = peerCfg.map((q, idx) => {
              const qGrades = peer.filter(e => String(e.question_no) === String(q.question_no));
              const avg = qGrades.length ? qGrades.reduce((s, g) => s + parseFloat(g.grade || 0), 0) / qGrades.length : 0;
              return { num: idx + 1, question: q.question_text, avgScore: Math.round(avg * 10) / 10, maxGrade: parseFloat(q.max_grade || 10) };
            });

            const repTable  = buildExTable(repExaminers,  repCfg,  'Report',       sid, session.is_admin);
            const presTable = buildExTable(presExaminers, presCfg, 'Presentation', sid, session.is_admin);
            const repPct    = repTable  ? repTable.pct  : 0;
            const presPct   = presTable ? presTable.pct : 0;
            const final     = (twScore * twW) + (repPct * repW) + (presPct * presW);

            return {
              studentId: sid, studentName: student.student_name,
              isSolo: projStudents.length === 1,
              twDetails, peerDetails, indPct: rnd(indPct), peerPct: rnd(peerPct), twScore: rnd(twScore),
              repTable, presTable,
              summary: { teamworkPct: rnd(twScore), reportPct: rnd(repPct), presPct: rnd(presPct), finalGrade: Math.round(final), boosted: GRADE_BORDERS.includes(Math.round(final)), letterGrade: letterGrade(final) },
            };
          });

          return { projectId: pid, title: proj.title || pid, type: projType, program: proj.program_type || '', supervisors: supNames, students: studentsData };
        });

        // Statistics
        const allSR = projectDetails.flatMap(p => p.students.map(s => ({ ...s.summary, pt: p.type })));
        const statsByType = {};
        ['FYP1','FYP2'].forEach(pt => {
          const gr = allSR.filter(r => r.pt === pt);
          if (!gr.length) return;
          const mean = gr.reduce((s, r) => s + r.finalGrade, 0) / gr.length;
          const sd   = Math.sqrt(gr.reduce((s, r) => s + Math.pow(r.finalGrade - mean, 2), 0) / gr.length);
          statsByType[pt] = { count: gr.length, mean: rnd(mean), sd: rnd(sd) };
        });

        // ABET
        const abetByType = {};
        ['FYP1','FYP2'].forEach(pt => {
          const typeIds = new Set(projects.filter(p => p.type === pt).map(p => p.project_id));
          if (!typeIds.size) return;
          const tIndG = twGrades.filter(g => typeIds.has(g.project_id) && g.grade_type === 'Individual');
          const tExG  = exGrades.filter(g => typeIds.has(g.project_id));
          function computeABET2(tag) {
            const cp = [];
            indRubric.filter(r => String(r.abetOutcome || '') === tag).forEach(c => {
              const gs = tIndG.filter(g => g.criterion === c.criterion);
              if (!gs.length) return;
              cp.push((gs.filter(g => parseFloat(g.grade || 0) >= 0.7 * c.maxGrade).length / gs.length) * 100);
            });
            exCfg.filter(c => String(c.abet_outcome || '') === tag).forEach(c => {
              const cg = tExG.filter(g => g.criterion === c.criterion_name);
              if (!cg.length) return;
              cp.push((cg.filter(g => parseFloat(g.score || 0) >= 0.7 * parseFloat(c.max_grade || 100)).length / cg.length) * 100);
            });
            if (!cp.length) return tag === '2b' ? { notMeasured: true } : null;
            const avg2 = cp.reduce((a, b) => a + b, 0) / cp.length;
            return { pct: rnd(avg2), level: avg2 < 60 ? 1 : avg2 < 70 ? 2 : avg2 < 85 ? 3 : 4 };
          }
          abetByType[pt] = { abet1a: computeABET2('1a'), abet2a: computeABET2('2a'), abet2b: computeABET2('2b'), abet3a: computeABET2('3a'), abet3b: computeABET2('3b'), abet4a: computeABET2('4a'), abet5a: computeABET2('5a'), abet5b: computeABET2('5b'), abet7a: computeABET2('7a') };
        });

        const now = new Date();
        return ok({ success: true, projects: projectDetails, statistics: statsByType, abet: abetByType,
          meta: { year: `${now.getFullYear()}–${now.getFullYear()+1}`, semester: cfg.semester || '', department: 'ECE',
            weights: { tw: Math.round(twW*100), report: Math.round(repW*100), pres: Math.round(presW*100) } } });
      }

      // ─── Criteria Grade Distribution (Admin statistical report) ──────
      case 'getCriteriaDistribution': {
        const [sessionToken] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, message: 'Session expired.' });
        if (!session.is_admin) return ok({ success: false, message: 'Only the admin can view this report.' });

        const [allProjects, twGrades, peerEvals, exGrades, exCfg, peerCfg] = await Promise.all([
          sql`SELECT * FROM projects`,
          sql`SELECT * FROM tw_grades WHERE grade_type = 'Individual'`,
          sql`SELECT * FROM peer_evaluations`,
          sql`SELECT * FROM examiner_grades`,
          sql`SELECT * FROM examiner_config ORDER BY id`,
          sql`SELECT * FROM peer_config ORDER BY question_no`,
        ]);
        const indRubric = await getIndividualRubric();
        const cfg = await getTWConfig();

        const projById = {};
        allProjects.forEach(p => { projById[p.project_id] = p; });

        // Each entry = one graded criterion instance, normalized to a percentage
        const entries = [];

        // TW — Supervisor (Individual rubric)
        twGrades.forEach(g => {
          const proj = projById[g.project_id];
          if (!proj) return;
          const rub = indRubric.find(r => r.criterion === g.criterion);
          const max = rub ? Number(rub.maxGrade || 25) : 25;
          if (max <= 0) return;
          entries.push({ pct: (parseFloat(g.grade || 0) / max) * 100, program: proj.program_type || 'Unspecified', type: String(proj.type || 'FYP1'), category: 'TW' });
        });

        // Peer Evaluation
        const peerMaxByQ = {};
        peerCfg.forEach(q => { peerMaxByQ[String(q.question_no)] = parseFloat(q.max_grade || 10); });
        peerEvals.forEach(e => {
          const proj = projById[e.project_id];
          if (!proj) return;
          const max = peerMaxByQ[String(e.question_no)] || 10;
          if (max <= 0) return;
          entries.push({ pct: (parseFloat(e.grade || 0) / max) * 100, program: proj.program_type || 'Unspecified', type: String(proj.type || 'FYP1'), category: 'Peer' });
        });

        // Examiner — Report & Presentation
        exGrades.forEach(g => {
          const proj = projById[g.project_id];
          if (!proj) return;
          const projType = String(proj.type || 'FYP1');
          const cfgMatch = exCfg.find(c => c.criterion_name === g.criterion && c.category === g.category && (!c.project_type || c.project_type === projType));
          const max = cfgMatch ? parseFloat(cfgMatch.max_grade || 0) : 0;
          if (!max || max <= 0) return;
          const category = g.category === 'Presentation' ? 'Presentation' : 'Report';
          entries.push({ pct: (parseFloat(g.score || 0) / max) * 100, program: proj.program_type || 'Unspecified', type: projType, category });
        });

        // ── Bucketing: 45-49, 50-54, ..., 95-100 (11 buckets) ──────────────
        const bucketLabels = ['45-49','50-54','55-59','60-64','65-69','70-74','75-79','80-84','85-89','90-94','95-100'];
        const bucketIndex = p => p < 45 ? -1 : Math.min(10, Math.floor((p - 45) / 5));
        const makeDist = list => {
          const total = list.length;
          const counts = new Array(11).fill(0);
          list.forEach(e => { const idx = bucketIndex(e.pct); if (idx >= 0) counts[idx]++; });
          return { total, pct: counts.map(c => total > 0 ? rnd((c / total) * 100) : 0) };
        };

        const overall = makeDist(entries);
        const byType = {};
        ['FYP1', 'FYP2'].forEach(t => { const list = entries.filter(e => e.type === t); if (list.length) byType[t] = makeDist(list); });
        const byCategory = {};
        ['TW', 'Peer', 'Report', 'Presentation'].forEach(cat => { const list = entries.filter(e => e.category === cat); if (list.length) byCategory[cat] = makeDist(list); });
        const programs = [...new Set(entries.map(e => e.program))].sort();
        const byProgram = {};
        programs.forEach(p => { const list = entries.filter(e => e.program === p); if (list.length) byProgram[p] = makeDist(list); });

        const now2 = new Date();
        return ok({ success: true, buckets: bucketLabels, overall, byType, byCategory, byProgram,
          meta: { year: `${now2.getFullYear()}–${now2.getFullYear()+1}`, semester: cfg.semester || '', department: 'ECE' } });
      }

      case 'getFinalResults': {
        const [sessionToken] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, message: 'Session expired.' });

        const [allProjects, allStudents, twGrades, peerEvals, exGrades, allSups, exCfg, peerCfg, allExaminers] = await Promise.all([
          sql`SELECT * FROM projects`,
          sql`SELECT * FROM students`,
          sql`SELECT * FROM tw_grades`,
          sql`SELECT * FROM peer_evaluations`,
          sql`SELECT * FROM examiner_grades`,
          sql`SELECT * FROM supervisors`,
          sql`SELECT * FROM examiner_config ORDER BY id`,
          sql`SELECT * FROM peer_config ORDER BY question_no`,
          sql`SELECT * FROM examiners`,
        ]);

        const cfg       = await getTWConfig();
        const indRubric = await getIndividualRubric();

        let projects = await filterProjectsBySession(session, allProjects, allSups);
        const programName = session.is_admin ? '' : (session.program || '');

        const projectIds = new Set(projects.map(p => p.project_id));
        const students   = allStudents.filter(s => projectIds.has(s.project_id));

        // ── Per-project completeness ─────────────────────────────────────
        const incompleteByType  = { FYP1: [], FYP2: [] };
        const projectCompletion = {};

        projects.forEach(proj => {
          const pid      = proj.project_id;
          const projType = String(proj.type || 'FYP1');
          const key      = projType === 'FYP2' ? 'FYP2' : 'FYP1';
          const projStudents = allStudents.filter(s => s.project_id === pid);
          const missing = [];

          if (projStudents.length > 1) {
            const peerSubmitters = new Set(peerEvals.filter(e => e.project_id === pid).map(e => e.evaluator_id));
            projStudents.forEach(s => { if (!peerSubmitters.has(s.student_id)) missing.push(`Peer eval not submitted by ${s.student_name}`); });
          }

          if (!twGrades.some(g => g.project_id === pid))
            missing.push('Teamwork grades not submitted by supervisor');

          const projExaminers = allExaminers.filter(e => e.project_id === pid);
          if (!projExaminers.length) missing.push('No examiners assigned yet');
          projExaminers.forEach(examiner => {
            const name  = examiner.examiner_name || examiner.examiner_email;
            const eType = examiner.examiner_type;
            if (examiner.status === 'Assigned') { missing.push(`${name} (${eType}) — invitation email not yet sent`); return; }
            const eg = exGrades.filter(g => g.assignment_id === examiner.assignment_id);
            if (eType === 'Industry') { if (!eg.some(g => g.category === 'Presentation')) missing.push(`${name} (Industry) — Presentation grades missing`); }
            else { if (!eg.some(g => g.category === 'Report')) missing.push(`${name} (${eType}) — Report grades missing`); if (!eg.some(g => g.category === 'Presentation')) missing.push(`${name} (${eType}) — Presentation grades missing`); }
          });

          projectCompletion[pid] = missing.length === 0;
          if (missing.length) incompleteByType[key].push({ title: String(proj.title || pid), missing });
        });

        // ── Determine showable projects ──────────────────────────────────
        const showableProjectIds   = new Set();
        let   partialPendingByType = {};
        let   completeTypes        = [];
        let   incompleteOut        = {};

        if (session.is_admin) {
          // Admin: show any individually-complete project, no type-level blocking
          projects.forEach(p => { if (projectCompletion[p.project_id]) showableProjectIds.add(p.project_id); });
          if (showableProjectIds.size === 0)
            return ok({ success: false, incomplete: true, program: '', incompleteByType: {}, message: 'No project has complete grading yet.' });
        } else {
          // Non-admin: program publish / unlock settings gate per-type visibility
          let pubRows = [];
          try {
            await sql`CREATE TABLE IF NOT EXISTS program_publish_settings (
              program_name TEXT PRIMARY KEY, unlocked_fyp1 BOOLEAN NOT NULL DEFAULT FALSE,
              unlocked_fyp2 BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )`;
            pubRows = await sql`SELECT * FROM program_publish_settings`;
          } catch {}
          const pubMap = {};
          pubRows.forEach(r => { pubMap[r.program_name] = r; });
          const isUnlocked = (type) => {
            const row = pubMap[programName];
            if (!row) return false;
            return type === 'FYP1' ? !!row.unlocked_fyp1 : !!row.unlocked_fyp2;
          };

          ['FYP1', 'FYP2'].forEach(pt => {
            const typeProjects   = projects.filter(p => String(p.type || 'FYP1') === pt);
            const typeIncomplete = incompleteByType[pt] || [];
            const allComplete    = typeIncomplete.length === 0;
            if (allComplete) {
              completeTypes.push(pt);
              typeProjects.forEach(p => showableProjectIds.add(p.project_id));
            } else if (isUnlocked(pt)) {
              const individually = typeProjects.filter(p => projectCompletion[p.project_id]);
              if (individually.length) {
                individually.forEach(p => showableProjectIds.add(p.project_id));
                partialPendingByType[pt] = typeIncomplete;
              }
            }
          });

          incompleteOut = Object.fromEntries(
            Object.entries(incompleteByType).filter(([t, v]) => v.length > 0 && !isUnlocked(t))
          );

          if (showableProjectIds.size === 0)
            return ok({ success: false, incomplete: true, program: programName, incompleteByType: { ...incompleteOut, ...Object.fromEntries(Object.entries(incompleteByType).filter(([,v]) => v.length > 0)) }, message: 'No project type is fully graded yet.' });
        }

        // ── Compute results for showable projects ────────────────────────
        const showableStudents = students.filter(s => showableProjectIds.has(s.project_id));

        const twW   = parseFloat(cfg.teamwork_weight     || 35) / 100;
        const peerW = parseFloat(cfg.peer_eval_weight    || 20) / 100;
        const supW  = parseFloat(cfg.supervisor_weight   || 80) / 100;
        const repW  = parseFloat(cfg.report_weight       || 35) / 100;
        const presW = parseFloat(cfg.presentation_weight || 30) / 100;

        const results = showableStudents.map(student => {
          const project = projects.find(p => p.project_id === student.project_id);
          const pt      = project ? String(project.type || 'FYP1') : 'FYP1';

          const ind    = twGrades.filter(g => g.student_id === student.student_id && g.grade_type === 'Individual');
          const indMax = indRubric.reduce((s, r) => s + Number(r.maxGrade||25), 0) || 100;
          const indPct = pct(ind.reduce((s, g) => s + parseFloat(g.grade||0), 0), indMax);

          const peer      = peerEvals.filter(e => e.evaluated_id === student.student_id);
          const maxPeer   = peerCfg.reduce((s, q) => s + parseFloat(q.max_grade||10), 0);
          const peerCount = peerCfg.length || 1;
          const peerPct   = pct(peer.reduce((s, e) => s + parseFloat(e.grade||0), 0), maxPeer * (peer.length / peerCount));

          const isSolo    = students.filter(s => s.project_id === student.project_id).length === 1;
          const twScore   = isSolo ? indPct : (indPct * supW) + (peerPct * peerW);

          const projExCfg = exCfg.filter(c => !c.project_type || c.project_type === pt);

          // ── Report: scope-aware per-student grade filter ──────────────
          const repCfg = projExCfg.filter(c => c.category === 'Report');
          const repG   = exGrades.filter(g => {
            if (g.project_id !== student.project_id || g.category !== 'Report') return false;
            const c = repCfg.find(cf => cf.criterion_name === g.criterion);
            return c && c.grading_scope === 'Individual'
              ? g.student_id === student.student_id
              : (g.student_id === 'GROUP' || !g.student_id);
          });
          const repPct = weightedPct(repG.map(g => ({ Criterion: g.criterion, Score: g.score })), repCfg.map(c => ({ CriterionName: c.criterion_name, MaxGrade: c.max_grade, Weight: c.weight })));

          // ── Presentation: scope-aware per-student grade filter ────────
          const presCfg = projExCfg.filter(c => c.category === 'Presentation');
          const presG   = exGrades.filter(g => {
            if (g.project_id !== student.project_id || g.category !== 'Presentation') return false;
            const c = presCfg.find(cf => cf.criterion_name === g.criterion);
            return c && c.grading_scope === 'Individual'
              ? g.student_id === student.student_id
              : (g.student_id === 'GROUP' || !g.student_id);
          });
          const presPct = weightedPct(presG.map(g => ({ Criterion: g.criterion, Score: g.score })), presCfg.map(c => ({ CriterionName: c.criterion_name, MaxGrade: c.max_grade, Weight: c.weight })));

          const final = (twScore * twW) + (repPct * repW) + (presPct * presW);
          const finalRounded = Math.round(final);
          return {
            studentId: student.student_id, studentName: student.student_name,
            projectId: student.project_id, projectTitle: project ? project.title : '—',
            projectType: pt, projectProgram: project ? (project.program_type || '') : '',
            teamworkPct: rnd(twScore), reportPct: rnd(repPct), presPct: rnd(presPct),
            finalGrade: finalRounded, boosted: GRADE_BORDERS.includes(finalRounded),
            letterGrade: letterGrade(final),
            isSolo, peerWarning: !isSolo && peer.length === 0,
          };
        });

        const abetByType = {};
        ['FYP1','FYP2'].forEach(pt => {
          const typeShowable = projects.filter(p => String(p.type||'FYP1') === pt && showableProjectIds.has(p.project_id));
          if (!typeShowable.length) return;
          const typeIds = new Set(typeShowable.map(p => p.project_id));
          const tIndG   = twGrades.filter(g => typeIds.has(g.project_id) && g.grade_type === 'Individual');
          const tExG    = exGrades.filter(g => typeIds.has(g.project_id));
          function computeABET(tag) {
            const cp = [];
            indRubric.filter(r => String(r.abetOutcome||'') === tag).forEach(c => { const gs = tIndG.filter(g => g.criterion === c.criterion); if (!gs.length) return; cp.push((gs.filter(g=>parseFloat(g.grade||0)>=0.7*c.maxGrade).length/gs.length)*100); });
            exCfg.filter(c => String(c.abet_outcome||'') === tag).forEach(c => { const cg = tExG.filter(g => g.criterion === c.criterion_name); if (!cg.length) return; cp.push((cg.filter(g=>parseFloat(g.score||0)>=0.7*parseFloat(c.max_grade||100)).length/cg.length)*100); });
            if (!cp.length) return tag === '2b' ? { notMeasured: true } : null;
            const avg2 = cp.reduce((a,b)=>a+b,0)/cp.length;
            return { pct: rnd(avg2), level: avg2<60?1:avg2<70?2:avg2<85?3:4 };
          }
          abetByType[pt] = { abet1a: computeABET('1a'), abet2a: computeABET('2a'), abet2b: computeABET('2b'), abet3a: computeABET('3a'), abet3b: computeABET('3b'), abet4a: computeABET('4a'), abet5a: computeABET('5a'), abet5b: computeABET('5b'), abet7a: computeABET('7a') };
        });

        const statsByType = {};
        ['FYP1','FYP2'].forEach(pt => {
          const gr = results.filter(r => r.projectType === pt);
          if (!gr.length) return;
          const mean = gr.reduce((s,r)=>s+r.finalGrade,0)/gr.length;
          const sd   = Math.sqrt(gr.reduce((s,r)=>s+Math.pow(r.finalGrade-mean,2),0)/gr.length);
          statsByType[pt] = { count: gr.length, mean: rnd(mean), sd: rnd(sd) };
        });

        return ok({ success: true, results, abetByType, statsByType, incompleteByType: incompleteOut, completeTypes, partialPendingByType });
      }

      case 'getProgramPublishSettings': {
        const [sessionToken] = args;
        const session = await verifySession(sessionToken);
        if (!session || !session.is_admin) return ok({ success: false, message: 'Admin only.' });
        await sql`CREATE TABLE IF NOT EXISTS program_publish_settings (
          program_name TEXT PRIMARY KEY, unlocked_fyp1 BOOLEAN NOT NULL DEFAULT FALSE,
          unlocked_fyp2 BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        const programs  = await sql`SELECT program_name FROM programs ORDER BY program_name`;
        const settings  = await sql`SELECT * FROM program_publish_settings`;
        const settMap   = {};
        settings.forEach(r => { settMap[r.program_name] = r; });
        const merged = programs.map(p => ({
          program_name:  p.program_name,
          unlocked_fyp1: settMap[p.program_name]?.unlocked_fyp1 ?? false,
          unlocked_fyp2: settMap[p.program_name]?.unlocked_fyp2 ?? false,
        }));
        return ok({ success: true, settings: merged });
      }

      case 'setProgramPublish': {
        const [sessionToken, programName, type, unlocked] = args;
        const session = await verifySession(sessionToken);
        if (!session || !session.is_admin) return ok({ success: false, message: 'Admin only.' });
        const col = type === 'FYP1' ? 'unlocked_fyp1' : 'unlocked_fyp2';
        if (col === 'unlocked_fyp1') {
          await sql`INSERT INTO program_publish_settings (program_name, unlocked_fyp1, updated_at)
            VALUES (${programName}, ${!!unlocked}, NOW())
            ON CONFLICT (program_name) DO UPDATE SET unlocked_fyp1 = EXCLUDED.unlocked_fyp1, updated_at = NOW()`;
        } else {
          await sql`INSERT INTO program_publish_settings (program_name, unlocked_fyp2, updated_at)
            VALUES (${programName}, ${!!unlocked}, NOW())
            ON CONFLICT (program_name) DO UPDATE SET unlocked_fyp2 = EXCLUDED.unlocked_fyp2, updated_at = NOW()`;
        }
        return ok({ success: true });
      }

      case 'updateProject': {
        const [sessionToken, projectId, updates] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, message: 'Session expired.' });
        const projectRows = await sql`SELECT supervisors FROM projects WHERE project_id = ${projectId}`;
        const project = projectRows[0] || null;
        if (!project) return ok({ success: false, message: 'Project not found.' });
        const isOwner = (project.supervisors || '').split(',').map(x => x.trim()).includes(session.supervisor_id);
        if (!session.is_admin && !isOwner) return ok({ success: false, message: 'You can only edit projects you supervise.' });

        const patch = {};
        if (updates.title    !== undefined) patch.title    = String(updates.title).trim();
        if (updates.type     !== undefined) patch.type     = updates.type;
        if (updates.semester !== undefined) patch.semester = updates.semester;
        if (updates.year     !== undefined) patch.year     = updates.year;
        if (updates.endDate  !== undefined) patch.end_date = updates.endDate;
        if (updates.disableNotifications !== undefined) patch.disable_notifications = !!updates.disableNotifications;
        if (patch.title !== undefined && !patch.title) return ok({ success: false, message: 'Title cannot be empty.' });

        if (updates.students !== undefined) {
          const submitted   = (updates.students || []).map(s => ({ ...s, studentId: String(s.studentId).trim(), studentName: String(s.studentName).trim() }));
          if (!submitted.length) return ok({ success: false, message: 'A project must have at least one student.' });
          const submittedIds = submitted.map(s => s.studentId);

          const currentStudents = await sql`SELECT * FROM students WHERE project_id = ${projectId}`;
          const currentIds = currentStudents.map(s => s.student_id);

          const toDelete = currentIds.filter(id => !submittedIds.includes(id));
          const toInsert = submitted.filter(s => !s.isExisting);
          const toUpdate = submitted.filter(s => s.isExisting);

          if (toInsert.length) {
            const otherStudents = await sql`SELECT student_id, student_name FROM students WHERE project_id != ${projectId}`;
            for (const s of toInsert) {
              if (otherStudents.some(r => r.student_id === s.studentId))
                return ok({ success: false, message: `Student ID "${s.studentId}" is already registered in another project.` });
              if (otherStudents.some(r => r.student_name.trim().toLowerCase() === s.studentName.toLowerCase()))
                return ok({ success: false, message: `Student name "${s.studentName}" is already registered in another project.` });
            }
          }

          for (const id of toDelete) {
            await sql`DELETE FROM tw_grades WHERE student_id = ${id} AND project_id = ${projectId}`;
            await sql`DELETE FROM peer_evaluations WHERE evaluator_id = ${id}`;
            await sql`DELETE FROM peer_evaluations WHERE evaluated_id = ${id}`;
            await sql`DELETE FROM examiner_grades WHERE student_id = ${id} AND project_id = ${projectId}`;
            await sql`DELETE FROM students WHERE student_id = ${id}`;
          }
          for (const s of toUpdate) {
            await sql`UPDATE students SET student_name = ${s.studentName}, email = ${s.email || ''} WHERE student_id = ${s.studentId}`;
          }
          for (const s of toInsert) {
            await sql`INSERT INTO students (student_id, student_name, email, project_id) VALUES (${s.studentId}, ${s.studentName}, ${s.email || ''}, ${projectId})`;
          }
          patch.students = submittedIds.join(',');
        }

        if (Object.keys(patch).length) {
          const fields = [];
          const params = [];
          let idx = 1;
          for (const [k, v] of Object.entries(patch)) {
            fields.push(`${k} = $${idx++}`);
            params.push(v);
          }
          params.push(projectId);
          await sql(`UPDATE projects SET ${fields.join(', ')} WHERE project_id = $${idx}`, params);
        }
        return ok({ success: true });
      }

      case 'deleteProject': {
        const [sessionToken, projectId] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, message: 'Session expired.' });
        if (!session.is_admin) return ok({ success: false, message: 'Only the admin can delete projects.' });
        await sql`DELETE FROM peer_evaluations WHERE project_id = ${projectId}`;
        await sql`DELETE FROM examiner_grades WHERE project_id = ${projectId}`;
        await sql`DELETE FROM examiners WHERE project_id = ${projectId}`;
        await sql`DELETE FROM tw_grades WHERE project_id = ${projectId}`;
        await sql`DELETE FROM students WHERE project_id = ${projectId}`;
        await sql`DELETE FROM projects WHERE project_id = ${projectId}`;
        return ok({ success: true });
      }

      default:
        return ok({ success: false, message: 'Unknown action: ' + action });
    }
  }

  try {
    const result = await dispatch();
    res.json(result);
  } catch (err) {
    if (!res.headersSent) {
      res.json({ success: false, message: err.message || String(err) });
    }
  }
};
