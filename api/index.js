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

function buildExaminerEmail({ name, projectTitle, examinerType, projectType, reportLink, gradingLink }) {
  const isIndustry = examinerType === 'Industry';
  const ghost = 'display:inline-block;background:#fff;color:#0a1f44;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:700;border:2px solid #0a1f44;';

  const roleNote = isIndustry
    ? `<div style="background:#fff8e1;border-left:4px solid #f59e0b;border-radius:6px;padding:14px 18px;margin:0 0 20px;font-size:14px;color:#78350f;">
         <strong>Note:</strong> You are assigned to grade the <strong>Presentation</strong> only. No report grading is required from you.
       </div>`
    : (reportLink
        ? `<p style="margin:0 0 10px;font-size:14px;color:#374151;">The project report is available for your review:</p>
           <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td>
             <a href="${reportLink}" style="${ghost}">Access Project Report</a>
           </td></tr></table>`
        : '');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;"><tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
  <tr><td align="center" style="background:#ffffff;padding:28px 40px 16px;"><img src="https://usif-3jra.github.io/epme-study-plan/assets/logo_ECE.png" alt="BAU ECE" width="130" style="display:block;max-width:130px;height:auto;"/></td></tr>
  <tr><td style="background:#0a1f44;padding:24px 40px;text-align:center;"><div style="color:#fff;font-size:20px;font-weight:700;letter-spacing:.02em;margin-bottom:6px;">FYP Management &amp; Grading System</div><div style="color:#94a3b8;font-size:13px;">Beirut Arab University — Faculty of Engineering — ECE Department</div></td></tr>
  <tr><td style="padding:32px 40px;color:#2d2d2d;font-size:15px;line-height:1.7;">
    <p style="margin:0 0 16px;">Dear ${name || 'Examiner'},</p>
    <p style="margin:0 0 20px;">You have been assigned as an examiner for a Final Year Project at Beirut Arab University. Please review your assignment details below:</p>
    <div style="background:#f0f4ff;border-left:4px solid #0a1f44;border-radius:6px;padding:18px 24px;margin:0 0 20px;">
      <table cellpadding="0" cellspacing="0" style="width:100%;">
        <tr><td style="font-size:13px;color:#6b7280;font-weight:600;padding:5px 0;width:140px;">Project Title</td><td style="font-size:14px;font-weight:700;color:#0a1f44;padding:5px 0;">${projectTitle}</td></tr>
        <tr><td style="font-size:13px;color:#6b7280;font-weight:600;padding:5px 0;border-top:1px solid #dde3f3;">Examiner Role</td><td style="font-size:14px;font-weight:700;color:#0a1f44;padding:5px 0;border-top:1px solid #dde3f3;">${examinerType}</td></tr>
        <tr><td style="font-size:13px;color:#6b7280;font-weight:600;padding:5px 0;border-top:1px solid #dde3f3;">Project Type</td><td style="font-size:14px;font-weight:700;color:#0a1f44;padding:5px 0;border-top:1px solid #dde3f3;">${projectType || '—'}</td></tr>
      </table>
    </div>
    ${roleNote}
    <p style="margin:0 0 8px;font-size:14px;color:#374151;">Your grading portal has been prepared. Please use the button below to access it:</p>
    <p style="margin:0 0 16px;font-size:12px;color:#6b7280;">This link is unique to you — do not share it with anyone.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 12px;"><tr><td><a href="${gradingLink}" style="${ghost}">Open Grading Portal</a></td></tr></table>
    <p style="margin:0 0 12px;font-size:13px;color:#6b7280;">To access the FYP assessment rubrics, please use the button below:</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;"><tr><td><a href="https://baudom-my.sharepoint.com/:b:/g/personal/yousef_ajrah_bau_edu_lb/IQA0FxBsdn1JTbKFp9Hb_RRMAaH-tzBurxrjb6gd-c6AvyU?e=K5B6xq" style="${ghost}">FYP 1 &amp; 2 Rubrics</a></td></tr></table>
    <p style="margin:0 0 8px;font-size:14px;">Should you encounter any issues or have suggestions for improving the system, you are welcome to submit your feedback through the dashboard after logging in.</p>
    <p style="margin:0 0 4px;">Best regards,</p>
    <p style="margin:0 0 2px;font-weight:600;">ECE Department Administration</p>
    <p style="margin:0;color:#6b7280;font-size:13px;">Faculty of Engineering — Beirut Arab University</p>
  </td></tr>
  <tr><td style="border-top:1px solid #e5e7eb;padding:16px 40px;text-align:center;color:#9ca3af;font-size:11px;background:#f9fafb;">
    &copy; 2026 Beirut Arab University — Faculty of Engineering — ECE Department<br/>
    This is an automated message. Please do not reply directly to this email.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

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

  function letterGrade(score) {
    const rounded  = Math.round(score * 10) / 10;
    const borders  = [64, 69, 72, 75, 79, 82, 85, 89, 94];
    const adjusted = borders.includes(Math.round(rounded)) ? rounded + 1 : rounded;
    if (adjusted >= 95) return 'A+'; if (adjusted >= 90) return 'A';
    if (adjusted >= 86) return 'A-'; if (adjusted >= 83) return 'B+';
    if (adjusted >= 80) return 'B';  if (adjusted >= 76) return 'B-';
    if (adjusted >= 73) return 'C+'; if (adjusted >= 70) return 'C';
    if (adjusted >= 65) return 'C-'; if (adjusted >= 60) return 'D';
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
                'FYP Management & Grading System — Your Login Credentials',
                `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;"><tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
  <tr><td align="center" style="background:#ffffff;padding:28px 40px 16px;"><img src="https://usif-3jra.github.io/epme-study-plan/assets/logo_ECE.png" alt="BAU ECE" width="130" style="display:block;max-width:130px;height:auto;"/></td></tr>
  <tr><td style="background:#0a1f44;padding:24px 40px;text-align:center;"><div style="color:#fff;font-size:20px;font-weight:700;letter-spacing:.02em;margin-bottom:6px;">FYP Management &amp; Grading System</div><div style="color:#94a3b8;font-size:13px;">Beirut Arab University — Faculty of Engineering — ECE Department</div></td></tr>
  <tr><td style="padding:32px 40px;color:#2d2d2d;font-size:15px;line-height:1.7;">
    <p style="margin:0 0 16px;">Dear ${t.name || t.id},</p>
    <p style="margin:0 0 16px;">We are pleased to inform you that your account for the <strong>FYP Management &amp; Grading System</strong> has been successfully created.</p>
    <p style="margin:0 0 20px;">Please find your login credentials below:</p>
    <div style="background:#f0f4ff;border-left:4px solid #0a1f44;border-radius:6px;padding:18px 24px;margin:0 0 20px;">
      <table cellpadding="0" cellspacing="0" style="width:100%;">
        <tr><td style="font-size:13px;color:#6b7280;font-weight:600;padding:5px 0;width:140px;">Supervisor ID</td><td style="font-size:15px;font-family:'Courier New',monospace;font-weight:700;color:#0a1f44;padding:5px 0;">${t.id}</td></tr>
        <tr><td style="font-size:13px;color:#6b7280;font-weight:600;padding:5px 0;border-top:1px solid #dde3f3;">Password</td><td style="font-size:15px;font-family:'Courier New',monospace;font-weight:700;color:#0a1f44;padding:5px 0;border-top:1px solid #dde3f3;">${t.password}</td></tr>
      </table>
    </div>
    <p style="margin:0 0 20px;color:#6b7280;font-size:13px;">For security purposes, this password has been auto-generated by the system. You are strongly advised to change it upon your first login.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
      <tr><td><a href="${APP_URL}" style="display:inline-block;background:#fff;color:#0a1f44;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:700;border:2px solid #0a1f44;">Open FYP Grading System</a></td></tr>
    </table>
    <p style="margin:0 0 12px;color:#6b7280;font-size:13px;">To access the FYP assessment rubrics, please use the button below:</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
      <tr><td><a href="https://baudom-my.sharepoint.com/:b:/g/personal/yousef_ajrah_bau_edu_lb/IQA0FxBsdn1JTbKFp9Hb_RRMAaH-tzBurxrjb6gd-c6AvyU?e=K5B6xq" style="display:inline-block;background:#fff;color:#0a1f44;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:700;border:2px solid #0a1f44;">FYP 1 &amp; 2 Rubrics</a></td></tr>
    </table>
    <p style="margin:0 0 8px;">Should you encounter any issues or have suggestions for improving the system, you are welcome to submit your feedback directly through the <strong>Feedback</strong> button available on the dashboard after logging in.</p>
    <p style="margin:0 0 4px;">Best regards,</p>
    <p style="margin:0 0 2px;font-weight:600;">ECE Department Administration</p>
    <p style="margin:0;color:#6b7280;font-size:13px;">Faculty of Engineering — Beirut Arab University</p>
  </td></tr>
  <tr><td style="border-top:1px solid #e5e7eb;padding:16px 40px;text-align:center;color:#9ca3af;font-size:11px;background:#f9fafb;">
    &copy; 2026 Beirut Arab University — Faculty of Engineering — ECE Department<br/>
    This is an automated message. Please do not reply directly to this email.
  </td></tr>
</table>
</td></tr></table>
</body></html>`
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

      case 'saveWeek14Date': {
        const [sessionToken, date] = args;
        const session = await verifySession(sessionToken);
        if (!session || !session.is_admin) return ok({ success: false, message: 'Unauthorized.' });
        await sql`INSERT INTO tw_config (config_key, config_value) VALUES ('week14_date', ${String(date || '')}) ON CONFLICT (config_key) DO UPDATE SET config_value = ${String(date || '')}`;
        return ok({ success: true });
      }

      case 'setTWLock': {
        const [sessionToken, locked] = args;
        const session = await verifySession(sessionToken);
        if (!session || !session.is_admin) return ok({ success: false, message: 'Unauthorized.' });
        await sql`INSERT INTO tw_config (config_key, config_value) VALUES ('tw_locked', ${locked ? 'true' : 'false'}) ON CONFLICT (config_key) DO UPDATE SET config_value = ${locked ? 'true' : 'false'}`;
        if (locked) {
          const [allProjects, allStudents, existingGrades] = await Promise.all([
            sql`SELECT * FROM projects`,
            sql`SELECT * FROM students`,
            sql`SELECT * FROM tw_grades WHERE grade_type = 'Individual'`,
          ]);
          const indRubric = await getIndividualRubric();
          const ts = new Date().toISOString();
          for (const proj of allProjects) {
            const projStudents = allStudents.filter(s => s.project_id === proj.project_id);
            const projGrades   = existingGrades.filter(g => g.project_id === proj.project_id);
            for (const student of projStudents) {
              for (const r of indRubric) {
                const hasGrade = projGrades.some(g => g.student_id === student.student_id && g.criterion === r.criterion);
                if (!hasGrade) {
                  const minGrade = Math.round(Number(r.maxGrade || 25) * 0.45 * 10) / 10;
                  await sql`INSERT INTO tw_grades (grade_id, project_id, student_id, criterion, grade, graded_by, grade_type, timestamp) VALUES (${uid('TG')}, ${proj.project_id}, ${student.student_id}, ${r.criterion}, ${minGrade}, ${'system'}, ${'Individual'}, ${ts})`;
                }
              }
            }
          }
        }
        return ok({ success: true, locked: !!locked });
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

        const twCfgG = await getTWConfig();
        const dateLocked = twCfgG.week14_date && (() => { const w = new Date(twCfgG.week14_date); w.setHours(23,59,59,999); return new Date() > w; })();
        const isLockedG  = twCfgG.tw_locked === 'true' || dateLocked;

        if (isLockedG) {
          const [projStudents, existingG] = await Promise.all([
            sql`SELECT * FROM students WHERE project_id = ${projectId}`,
            sql`SELECT * FROM tw_grades WHERE project_id = ${projectId} AND grade_type = 'Individual'`,
          ]);
          const indRubric = await getIndividualRubric();
          const ts = new Date().toISOString();
          for (const student of projStudents) {
            for (const r of indRubric) {
              const hasGrade = existingG.some(g => g.student_id === student.student_id && g.criterion === r.criterion);
              if (!hasGrade) {
                const minGrade = Math.round(Number(r.maxGrade || 25) * 0.45 * 10) / 10;
                await sql`INSERT INTO tw_grades (grade_id, project_id, student_id, criterion, grade, graded_by, grade_type, timestamp) VALUES (${uid('TG')}, ${projectId}, ${student.student_id}, ${r.criterion}, ${minGrade}, ${'system'}, ${'Individual'}, ${ts})`;
              }
            }
          }
        }

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
          gradedBy:   r.graded_by === 'system' ? 'Auto-filled (45% min)' : (r.supervisor_name || r.graded_by),
          isMe:       r.graded_by === session.supervisor_id,
        })));
      }

      case 'submitTeamworkGrades': {
        const [sessionToken, projectId, groupGrades, individualGrades] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, message: 'Session expired.' });
        const twCfg = await getTWConfig();
        if (twCfg.tw_locked === 'true') return ok({ success: false, message: 'Teamwork grading has been locked by the administrator.' });
        if (twCfg.week14_date) {
          const w14 = new Date(twCfg.week14_date); w14.setHours(23, 59, 59, 999);
          if (new Date() > w14) return ok({ success: false, message: 'Teamwork grades are locked after the Week 14 deadline and cannot be changed.' });
        }
        const gradedBy = session.supervisor_id;
        await sql`DELETE FROM tw_grades WHERE project_id = ${projectId}`;
        const ts = new Date().toISOString();
        for (const g of (individualGrades || [])) {
          await sql`INSERT INTO tw_grades (grade_id, project_id, student_id, criterion, grade, graded_by, grade_type, timestamp) VALUES (${uid('TG')}, ${projectId}, ${g.studentId}, ${g.criterion}, ${g.grade}, ${gradedBy}, 'Individual', ${ts})`;
        }
        return ok({ success: true });
      }

      case 'saveTeamworkDraft': {
        const [sessionToken, projectId, individualGrades] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, message: 'Session expired.' });
        const twCfg2 = await getTWConfig();
        if (twCfg2.tw_locked === 'true') return ok({ success: false, message: 'Teamwork grading has been locked by the administrator.' });
        if (twCfg2.week14_date) {
          const w14 = new Date(twCfg2.week14_date); w14.setHours(23, 59, 59, 999);
          if (new Date() > w14) return ok({ success: false, message: 'Teamwork grades are locked after the Week 14 deadline.' });
        }
        const gradedBy = session.supervisor_id;
        await sql`DELETE FROM tw_grades WHERE project_id = ${projectId}`;
        const ts = new Date().toISOString();
        for (const g of (individualGrades || [])) {
          if (g.grade === null || g.grade === undefined || isNaN(g.grade)) continue;
          await sql`INSERT INTO tw_grades (grade_id, project_id, student_id, criterion, grade, graded_by, grade_type, timestamp) VALUES (${uid('TG')}, ${projectId}, ${g.studentId}, ${g.criterion}, ${g.grade}, ${gradedBy}, 'Individual', ${ts})`;
        }
        return ok({ success: true });
      }

      case 'submitFeedback': {
        const [sessionToken, message] = args;
        const session = await verifySession(sessionToken);
        if (!session) return ok({ success: false, message: 'Session expired.' });
        const from = session.name || session.supervisor_id;
        const ts   = new Date().toISOString();
        // Always store in DB first so feedback is never lost
        await sql`CREATE TABLE IF NOT EXISTS feedback (
          id TEXT PRIMARY KEY, supervisor_id TEXT, supervisor_name TEXT,
          program TEXT, message TEXT, submitted_at TIMESTAMPTZ DEFAULT NOW(), is_read BOOLEAN DEFAULT FALSE
        )`;
        await sql`INSERT INTO feedback (id, supervisor_id, supervisor_name, program, message, submitted_at)
                  VALUES (${uid('FB')}, ${session.supervisor_id}, ${from}, ${session.program || ''}, ${String(message || '')}, ${ts})`;
        // Email notification — always to admin's personal email
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

        // Prevent supervisor from assigning themselves as an examiner
        const selfSupRow = await sql`SELECT email FROM supervisors WHERE supervisor_id = ${session.supervisor_id}`;
        const selfEmail  = selfSupRow[0] ? String(selfSupRow[0].email).toLowerCase() : '';
        if (selfEmail && (examiners || []).some(e => String(e.email).toLowerCase() === selfEmail))
          return ok({ success: false, message: 'You cannot assign yourself as an examiner.' });

        // Require at least one non-Industry examiner to ensure the Report is graded
        const hasInternal = (examiners || []).some(e => e.type === 'Inside University' || e.type === 'Outside the Program/University');
        if (!hasInternal)
          return ok({ success: false, message: 'At least one Internal examiner must be assigned to ensure the Report component is graded.' });

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
        const projectRows = await sql`SELECT title, type FROM projects WHERE project_id = ${projectId}`;
        const project = projectRows[0] || null;
        await Promise.all((assignments || []).map(async a => {
          const link = `${APP_URL}/examiner.html?token=${a.token}`;
          await sendEmail(
            a.email,
            `FYP Grading Assignment — ${project ? project.title : projectId}`,
            buildExaminerEmail({
              name:          a.name,
              projectTitle:  project ? project.title : projectId,
              examinerType:  a.type,
              projectType:   project ? project.type : '',
              reportLink:    a.type !== 'Industry' ? (a.reportLink || '') : '',
              gradingLink:   link,
            })
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
        const rows = await sql`SELECT e.*, p.title, p.type AS project_type FROM examiners e JOIN projects p ON p.project_id = e.project_id WHERE e.assignment_id = ${assignmentId}`;
        const e = rows[0];
        if (!e) return ok({ success: false, message: 'Examiner not found.' });
        const link = `${APP_URL}/examiner.html?token=${e.token}`;
        await sendEmail(
          e.examiner_email,
          `FYP Grading Assignment — ${e.title || assignmentId}`,
          buildExaminerEmail({
            name:         e.examiner_name,
            projectTitle: e.title || assignmentId,
            examinerType: e.examiner_type,
            projectType:  e.project_type || '',
            reportLink:   e.examiner_type !== 'Industry' ? (e.report_link || '') : '',
            gradingLink:  link,
          })
        );
        await sql`UPDATE examiners SET status = 'Invited' WHERE assignment_id = ${assignmentId} AND status = 'Assigned'`;
        return ok({ success: true });
      }

      case 'sendPendingExaminerEmails': {
        const [sessionToken, projectId] = args;
        if (!await verifySession(sessionToken)) return ok({ success: false, message: 'Session expired.' });
        const rows = await sql`
          SELECT e.*, p.title, p.type AS project_type
          FROM examiners e JOIN projects p ON p.project_id = e.project_id
          WHERE e.project_id = ${projectId} AND e.status = 'Assigned'`;
        if (!rows.length) return ok({ success: true, sent: 0 });
        await Promise.all(rows.map(async e => {
          const link = `${APP_URL}/examiner.html?token=${e.token}`;
          await sendEmail(
            e.examiner_email,
            `FYP Grading Assignment — ${e.title || projectId}`,
            buildExaminerEmail({
              name:         e.examiner_name,
              projectTitle: e.title || projectId,
              examinerType: e.examiner_type,
              projectType:  e.project_type || '',
              reportLink:   e.examiner_type !== 'Industry' ? (e.report_link || '') : '',
              gradingLink:  link,
            })
          );
          await sql`UPDATE examiners SET status = 'Invited' WHERE assignment_id = ${e.assignment_id} AND status = 'Assigned'`;
        }));
        return ok({ success: true, sent: rows.length });
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
          const buildExTable = (examList, criteria, category, sid) => {
            if (!examList.length || !criteria.length) return null;
            const exNames = examList.map(e => `${e.examiner_name || e.examiner_email} (${e.examiner_type})`);
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
            const twScore   = (indPct * supW) + (peerPct * peerW);

            const repTable  = buildExTable(repExaminers,  repCfg,  'Report',       sid);
            const presTable = buildExTable(presExaminers, presCfg, 'Presentation', sid);
            const repPct    = repTable  ? repTable.pct  : 0;
            const presPct   = presTable ? presTable.pct : 0;
            const final     = (twScore * twW) + (repPct * repW) + (presPct * presW);

            return {
              studentId: sid, studentName: student.student_name,
              twDetails, indPct: rnd(indPct), peerPct: rnd(peerPct), twScore: rnd(twScore),
              repTable, presTable,
              summary: { teamworkPct: rnd(twScore), reportPct: rnd(repPct), presPct: rnd(presPct), finalGrade: rnd(final), letterGrade: letterGrade(final) },
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
            if (!cp.length) return null;
            const avg2 = cp.reduce((a, b) => a + b, 0) / cp.length;
            return { pct: rnd(avg2), level: avg2 < 60 ? 1 : avg2 < 70 ? 2 : avg2 < 85 ? 3 : 4 };
          }
          abetByType[pt] = { abet5a: computeABET2('5a'), abet5b: computeABET2('5b'), abet2a: computeABET2('2a'), abet2b: computeABET2('2b'), abet7a: computeABET2('7a'), abet7b: computeABET2('7b') };
        });

        const now = new Date();
        return ok({ success: true, projects: projectDetails, statistics: statsByType, abet: abetByType,
          meta: { year: `${now.getFullYear()}–${now.getFullYear()+1}`, semester: cfg.semester || '', department: 'ECE',
            weights: { tw: Math.round(twW*100), report: Math.round(repW*100), pres: Math.round(presW*100) } } });
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
        let programName = '';
        if (!session.is_admin) programName = session.program || '';

        const projectIds = new Set(projects.map(p => p.project_id));
        const students   = allStudents.filter(s => projectIds.has(s.project_id));

        // Per-project completeness — grouped by FYP type
        const incompleteByType = { FYP1: [], FYP2: [] };
        projects.forEach(proj => {
          const pid      = proj.project_id;
          const projType = String(proj.type || 'FYP1');
          const key      = projType === 'FYP2' ? 'FYP2' : 'FYP1';
          const projStudents = allStudents.filter(s => s.project_id === pid);
          const missing = [];

          // a. All students submitted peer evaluations
          const peerSubmitters = new Set(peerEvals.filter(e => e.project_id === pid).map(e => e.evaluator_id));
          projStudents.forEach(s => {
            if (!peerSubmitters.has(s.student_id))
              missing.push(`Peer eval not submitted by ${s.student_name}`);
          });

          // b. Supervisor submitted teamwork grades
          if (!twGrades.some(g => g.project_id === pid))
            missing.push('Teamwork grades not submitted by supervisor');

          // c/d/e. Per examiner — required categories depend on examiner type
          const projExaminers = allExaminers.filter(e => e.project_id === pid);
          if (!projExaminers.length)
            missing.push('No examiners assigned yet');
          projExaminers.forEach(examiner => {
            const name  = examiner.examiner_name || examiner.examiner_email;
            const eType = examiner.examiner_type;
            if (examiner.status === 'Assigned') {
              missing.push(`${name} (${eType}) — invitation email not yet sent`);
              return; // no point checking grades if email was never sent
            }
            const eg      = exGrades.filter(g => g.assignment_id === examiner.assignment_id);
            const hasRep  = eg.some(g => g.category === 'Report');
            const hasPres = eg.some(g => g.category === 'Presentation');
            if (eType === 'Industry') {
              if (!hasPres) missing.push(`${name} (Industry) — Presentation grades missing`);
            } else {
              if (!hasRep)  missing.push(`${name} (${eType}) — Report grades missing`);
              if (!hasPres) missing.push(`${name} (${eType}) — Presentation grades missing`);
            }
          });

          if (missing.length) incompleteByType[key].push({ title: String(proj.title || pid), missing });
        });

        const completeTypes    = ['FYP1','FYP2'].filter(t => !incompleteByType[t].length);
        const incompleteOut    = Object.fromEntries(Object.entries(incompleteByType).filter(([,v]) => v.length > 0));

        if (!completeTypes.length)
          return ok({ success: false, incomplete: true, program: programName, incompleteByType: incompleteOut, message: 'No project type is fully graded yet.' });

        // Compute results only for complete types
        const completeIds      = new Set(projects.filter(p => completeTypes.includes(String(p.type||'FYP1'))).map(p => p.project_id));
        const completeStudents = students.filter(s => completeIds.has(s.project_id));

        const twW   = parseFloat(cfg.teamwork_weight     || 35) / 100;
        const peerW = parseFloat(cfg.peer_eval_weight    || 20) / 100;
        const supW  = parseFloat(cfg.supervisor_weight   || 80) / 100;
        const repW  = parseFloat(cfg.report_weight       || 35) / 100;
        const presW = parseFloat(cfg.presentation_weight || 30) / 100;

        const results = completeStudents.map(student => {
          const project = projects.find(p => p.project_id === student.project_id);
          const pt = project ? String(project.type || '') : '';

          const ind    = twGrades.filter(g => g.student_id === student.student_id && g.grade_type === 'Individual');
          const indMax = indRubric.reduce((s, r) => s + Number(r.maxGrade||25), 0) || 100;
          const indPct = pct(ind.reduce((s, g) => s + parseFloat(g.grade||0), 0), indMax);

          const peer      = peerEvals.filter(e => e.evaluated_id === student.student_id);
          const maxPeer   = peerCfg.reduce((s, q) => s + parseFloat(q.max_grade||10), 0);
          const peerCount = peerCfg.length || 1;
          const peerPct   = pct(peer.reduce((s, e) => s + parseFloat(e.grade||0), 0), maxPeer * (peer.length / peerCount));

          const twScore = (indPct * supW) + (peerPct * peerW);

          const projExCfg = exCfg.filter(c => !c.project_type || c.project_type === pt);
          const repCfg = projExCfg.filter(c => c.category === 'Report');
          const repG   = exGrades.filter(g => g.project_id === student.project_id && g.category === 'Report');
          const repPct = weightedPct(repG.map(g => ({ Criterion: g.criterion, Score: g.score })), repCfg.map(c => ({ CriterionName: c.criterion_name, MaxGrade: c.max_grade, Weight: c.weight })));

          const presCfg = projExCfg.filter(c => c.category === 'Presentation');
          const presG   = exGrades.filter(g => g.project_id === student.project_id && g.category === 'Presentation');
          const presPct = weightedPct(presG.map(g => ({ Criterion: g.criterion, Score: g.score })), presCfg.map(c => ({ CriterionName: c.criterion_name, MaxGrade: c.max_grade, Weight: c.weight })));

          const final = (twScore * twW) + (repPct * repW) + (presPct * presW);
          return {
            studentId: student.student_id, studentName: student.student_name,
            projectId: student.project_id, projectTitle: project ? project.title : '—', projectType: pt || '—',
            teamworkPct: rnd(twScore), reportPct: rnd(repPct), presPct: rnd(presPct),
            finalGrade: rnd(final), letterGrade: letterGrade(final),
          };
        });

        const abetByType = {};
        ['FYP1','FYP2'].forEach(pt => {
          if (!completeTypes.includes(pt)) return;
          const typeProjects = projects.filter(p => p.type === pt);
          if (!typeProjects.length) return;
          const typeIds = new Set(typeProjects.map(p => p.project_id));
          const tIndG = twGrades.filter(g => typeIds.has(g.project_id) && g.grade_type === 'Individual');
          const tExG  = exGrades.filter(g => typeIds.has(g.project_id));
          function computeABET(tag) {
            const critPcts = [];
            indRubric.filter(r => String(r.abetOutcome||'') === tag).forEach(c => {
              const gs = tIndG.filter(g => g.criterion === c.criterion);
              if (!gs.length) return;
              critPcts.push((gs.filter(g=>parseFloat(g.grade||0)>=0.7*c.maxGrade).length/gs.length)*100);
            });
            exCfg.filter(c => String(c.abet_outcome||'') === tag).forEach(c => {
              const cg = tExG.filter(g => g.criterion === c.criterion_name);
              if (!cg.length) return;
              critPcts.push((cg.filter(g=>parseFloat(g.score||0)>=0.7*parseFloat(c.max_grade||100)).length/cg.length)*100);
            });
            if (!critPcts.length) return null;
            const avg2 = critPcts.reduce((a,b)=>a+b,0)/critPcts.length;
            return { pct: rnd(avg2), level: avg2<60?1:avg2<70?2:avg2<85?3:4 };
          }
          abetByType[pt] = {
            abet5a: computeABET('5a'), abet5b: computeABET('5b'),
            abet2a: computeABET('2a'), abet2b: computeABET('2b'),
            abet7a: computeABET('7a'), abet7b: computeABET('7b'),
          };
        });

        const statsByType = {};
        ['FYP1','FYP2'].forEach(pt => {
          const gr = results.filter(r => r.projectType === pt);
          if (!gr.length) return;
          const mean = gr.reduce((s,r)=>s+r.finalGrade,0)/gr.length;
          const sd   = Math.sqrt(gr.reduce((s,r)=>s+Math.pow(r.finalGrade-mean,2),0)/gr.length);
          statsByType[pt] = { count: gr.length, mean: rnd(mean), sd: rnd(sd) };
        });

        return ok({ success: true, results, abetByType, statsByType, incompleteByType: incompleteOut, completeTypes });
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
