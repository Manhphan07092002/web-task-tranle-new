import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: '127.0.0.1', port: 3306, user: 'root', password: '',
  database: 'Tranle_task_new',
});

const [rows]: any = await conn.query(
  'SELECT name, isSystem, (SELECT COUNT(*) FROM users u WHERE u.role = roles.name) AS users FROM roles ORDER BY isSystem DESC, name'
);
for (const r of rows) {
  console.log(`${r.isSystem ? 'SYS' : 'CST'}  users=${String(r.users).padStart(3)}  ${r.name}`);
}
await conn.end();
