import 'dotenv/config';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
import { buildPlan } from './plan.mjs';

const apply = process.argv.includes('--apply');
const data = JSON.parse(readFileSync(new URL('./personnel.json', import.meta.url), 'utf8'));
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; run from backend or provide environment variables.');
const db = await mysql.createConnection(process.env.DATABASE_URL);
let locked = false;
try {
  const [[lock]] = await db.query("SELECT GET_LOCK('tranle_tasks_schema_migrations',30) AS acquired");
  if (Number(lock.acquired) !== 1) throw new Error('Cannot acquire migration lock');
  locked = true;
  const [users] = await db.query('SELECT * FROM users');
  const [departments] = await db.query('SELECT * FROM departments');
  const plan = buildPlan(data, users, departments);
  const roleCounts = Object.fromEntries(['Admin', 'Director', 'Deputy Director', 'Manager', 'Employee'].map(role => [role, plan.records.filter(r => r.role === role).length]));
  const levelCounts = Object.fromEntries([99, 40, 30, 20, 10].map(lv => [String(lv), plan.records.filter(r => r.managementLevel === lv).length]));
  const summary = { employees: plan.records.length, assignments: data.employee_assignments.length, existing: plan.records.filter(r => r.existing).length, newActiveAccounts: plan.records.filter(r => !r.existing).length, departments: plan.departments.length, unassigned: plan.records.filter(r => !r.assignments.length).length, roleCounts, levelCounts };
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...summary }, null, 2));
  if (apply) {
    const DEFAULT_PASSWORD = process.env.PERSONNEL_DEFAULT_PASSWORD || 'Tranle@2026';
    const defaultHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    console.log('[SECURITY] New personnel accounts will use default password. Force change after first login.');
    const [availableRoles] = await db.query("SELECT name, managementLevel FROM roles WHERE name IN ('Admin','Director','Deputy Director','Manager','Employee')");
    const roleLevel = new Map(availableRoles.map(role => [role.name, Number(role.managementLevel ?? 10)]));
    // Chuẩn hóa đúng CSDL thực tế: roles phải có managementLevel (backend migration v12).
    // Tự vá nếu import chạy trước backend boot.
    const [roleCols] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='roles'");
    if (!new Set(roleCols.map(c => c.COLUMN_NAME)).has('managementLevel')) {
      await db.query('ALTER TABLE roles ADD COLUMN `managementLevel` INT NOT NULL DEFAULT 10');
      await db.query(`UPDATE roles SET managementLevel = CASE name WHEN 'Admin' THEN 99 WHEN 'Director' THEN 40 WHEN 'Deputy Director' THEN 30 WHEN 'Manager' THEN 20 ELSE 10 END WHERE name IN ('Admin','Director','Deputy Director','Manager','Employee')`);
      const [refreshed] = await db.query("SELECT name, managementLevel FROM roles WHERE name IN ('Admin','Director','Deputy Director','Manager','Employee')");
      for (const role of refreshed) roleLevel.set(role.name, Number(role.managementLevel ?? 10));
    }
    // Seed Deputy còn thiếu cho DB cũ (backend seed + migration v12 đã làm cho DB mới)
    if (!roleLevel.has('Deputy Director')) {
      await db.query(`INSERT IGNORE INTO roles (id, name, description, color, permissions, managementLevel, isSystem) VALUES (?,?,?,?,?,?,1)`,
        ['role-deputy', 'Deputy Director', 'Phó Giám đốc — Hỗ trợ Giám đốc, điều phối các phòng ban được giao quản lý.', '#3b82f6',
         JSON.stringify(['view_all_reports', 'director_feedback', 'view_all_tasks', 'manage_dept_tasks', 'join_meetings', 'approve_dept_revenue']), 30]);
      roleLevel.set('Deputy Director', 30);
    }
    const missingRoles = [...new Set(plan.records.map(record => record.role))].filter(role => !roleLevel.has(role));
    if (missingRoles.length) throw new Error(`Required system roles are missing: ${missingRoles.join(', ')}`);
    // MySQL DDL commits implicitly. Each schema operation is restart-safe.
    // Giữ đúng CSDL thực tế backend/db_mysql.ts users DDL + thêm 2 cột hiển thị của bộ nhân sự.
    const [columns] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users'");
    const known = new Set(columns.map(c => c.COLUMN_NAME));
    for (const [name, type] of Object.entries({employeeCode:'VARCHAR(80) NULL',jobTitle:'VARCHAR(255) NULL',branchLabel:'VARCHAR(191) NULL',assignmentStatus:'VARCHAR(100) NULL',managementLevel:'INT NOT NULL DEFAULT 10',primaryDepartmentId:'VARCHAR(191) NULL',lockedUntil:'DATETIME NULL',failedLogins:'INT NOT NULL DEFAULT 0'})) {
      if (!known.has(name)) await db.query(`ALTER TABLE users ADD COLUMN \`${name}\` ${type}`);
    }
    await db.query(`CREATE TABLE IF NOT EXISTS user_assignments (
      id VARCHAR(191) PRIMARY KEY, userId VARCHAR(191) NOT NULL,
      departmentId VARCHAR(191) NOT NULL, title VARCHAR(255) NOT NULL,
      isPrimary TINYINT NOT NULL DEFAULT 0, confirmationStatus VARCHAR(100) NOT NULL,
      effectiveFrom DATE NULL, note TEXT,
      INDEX idx_assignment_user (userId), INDEX idx_assignment_dept (departmentId),
      CONSTRAINT fk_tle_assignment_user FOREIGN KEY (userId) REFERENCES users(id),
      CONSTRAINT fk_tle_assignment_department FOREIGN KEY (departmentId) REFERENCES departments(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await db.beginTransaction();
    try {
      // Check again after acquiring row locks. Preserve old IDs and existing security settings.
      const [currentUsers] = await db.query('SELECT * FROM users FOR UPDATE');
      const [currentDepts] = await db.query('SELECT * FROM departments FOR UPDATE');
      const current = buildPlan(data, currentUsers, currentDepts);
      for (const d of current.departments) await db.query(
        'INSERT INTO departments(id,name,description,color,managerId) VALUES (?,?,?,?,NULL) ON DUPLICATE KEY UPDATE name=VALUES(name)',
        [d.dbId,d.name,'Cơ cấu người dùng xác nhận; nhập nhân sự 07/10/2026','#16385f']);
      for (const r of current.records) {
        const e=r.employee;
        const level = Number.isSafeInteger(Number(roleLevel.get(r.role))) ? Number(roleLevel.get(r.role)) : (r.managementLevel ?? 10);
        const primaryDeptId = r.primaryDepartmentId ?? null;
        const fields=[e.full_name,e.email,r.department,e.phone,e.date_of_birth,e.gender==='male'?'Nam':e.gender==='female'?'Nữ':null,e.id,e.current_title,e.branch,r.status];
        if (r.existing) {
          const prevLevel = Number(r.existing.managementLevel ?? 10);
          const authChanged = r.existing.email !== e.email || r.existing.department !== r.department || r.existing.role !== r.role || prevLevel !== level || (r.existing.primaryDepartmentId ?? null) !== primaryDeptId;
          await db.query('UPDATE users SET name=?,email=?,department=?,phone=?,dob=?,gender=?,employeeCode=?,jobTitle=?,branchLabel=?,assignmentStatus=?,role=?,managementLevel=?,primaryDepartmentId=?,tokenVersion=tokenVersion+? WHERE id=?',[...fields,r.role,level,primaryDeptId,authChanged?1:0,r.id]);
          if (r.existing.email !== e.email) await db.query('DELETE FROM password_reset_tokens WHERE userId=? AND usedAt IS NULL',[r.id]);
        } else {
          await db.query(`INSERT INTO users (name,email,department,phone,dob,gender,employeeCode,jobTitle,branchLabel,assignmentStatus,id,role,managementLevel,primaryDepartmentId,avatar,password,isLocked,preferences)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,0,'{}')`,[...fields,r.id,r.role,level,primaryDeptId,'https://i.pravatar.cc/150?u='+encodeURIComponent(r.id),defaultHash]);
        }
        for (const a of r.assignments) {
          const dep=current.departments.find(d=>d.id===a.department_id);
          await db.query(`INSERT INTO user_assignments(id,userId,departmentId,title,isPrimary,confirmationStatus,effectiveFrom,note)
            VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE userId=VALUES(userId),departmentId=VALUES(departmentId),title=VALUES(title),isPrimary=VALUES(isPrimary),confirmationStatus=VALUES(confirmationStatus),note=VALUES(note)`,
            [`tle-${a.id}`,r.id,dep.dbId,a.title,a.is_primary?1:0,a.status,a.effective_from,a.note]);
        }
      }
      for (const d of current.departments) {
        // Set known heads; never erase an existing head when source has no confirmed head.
        if (d.head_employee_id) {
          const head=current.records.find(r=>r.employee.id===d.head_employee_id);
          if (!head) throw new Error('Missing department head');
          await db.query('UPDATE departments SET managerId=? WHERE id=?',[head.id,d.dbId]);
        }
      }
      await db.commit();
      console.log('Personnel import committed. Roles/levels (99/40/30/20/10) + primaryDepartmentId synchronized; default password applied to new accounts; existing passwords, lock states, account IDs and task/project IDs preserved.');
    } catch (e) { await db.rollback(); throw e; }
  }
} finally {
  if (locked) await db.query("SELECT RELEASE_LOCK('tranle_tasks_schema_migrations')");
  await db.end();
}
