export function buildPlan(data, users, departments) {
  const codes = new Set(); const emails = new Set(); const claimed = new Set();
  const deptMap = new Map(data.departments.map(d => {
    const found = departments.filter(x => x.name === d.name);
    if (found.length > 1) throw new Error(`Duplicate department: ${d.name}`);
    const dbId = found[0]?.id ?? `tle-dept-${d.id.toLowerCase()}`;
    if (!found.length && departments.some(x=>x.id===dbId)) throw new Error(`Department ID collision: ${dbId}`);
    return [d.id, { ...d, dbId }];
  }));
  const records = data.employees.map(e => {
    if (!e.email || codes.has(e.id) || emails.has(e.email.toLowerCase())) throw new Error('Duplicate or missing employee code/email');
    codes.add(e.id); emails.add(e.email.toLowerCase());
    const byCode = users.filter(u => u.employeeCode === e.id);
    const byEmail = users.filter(u => String(u.email).trim().toLowerCase() === e.email.toLowerCase());
    const byName = users.filter(u => String(u.name).trim() === e.full_name);
    if ([byCode, byEmail, byName].some(a => a.length > 1)) throw new Error(`Ambiguous account: ${e.full_name}`);
    const candidates = new Map([...byCode, ...byEmail, ...byName].map(u => [u.id, u]));
    if (candidates.size > 1) throw new Error(`Email/name/code match different accounts: ${e.full_name}`);
    const existing = [...candidates.values()][0];
    const id = existing?.id ?? `tle-nv${e.id.split('.').at(-1)}`;
    if (claimed.has(id) || (!existing && users.some(u => u.id === id))) throw new Error(`Account ID collision: ${id}`);
    claimed.add(id);
    const assignments = data.employee_assignments.filter(a => a.employee_id === e.id);
    const primary = assignments.filter(a => a.is_primary);
    if (primary.length > 1) throw new Error(`Multiple primary assignments: ${e.full_name}`);
    for (const a of assignments) if (!deptMap.has(a.department_id)) throw new Error('Unknown department');
    const headedDepartments = data.departments.filter(d => d.head_employee_id === e.id);
    const role = headedDepartments.some(d => d.id === 'BGD')
      ? 'Director'
      : headedDepartments.length ? 'Manager' : 'Employee';
    if (existing?.role === 'Admin' && role !== 'Admin') {
      throw new Error(`Refusing to downgrade Admin account matched to ${e.full_name}`);
    }
    return { employee: e, id, existing, assignments, role, department: primary.length ? deptMap.get(primary[0].department_id).name : (existing?.department ?? ''), status: primary[0]?.status ?? 'Chưa xác định' };
  });
  for (const a of data.employee_assignments) if (!codes.has(a.employee_id)) throw new Error('Unknown employee assignment');
  return { departments: [...deptMap.values()], records };
}
