// Script to run migration 006 (department base tables/RBAC columns)
import mysql from 'mysql2/promise';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '123456',
    database: process.env.DB_NAME || 'Tranle_task_new',
    multipleStatements: true
  });

  console.log('Running migration 006...');
  const migration006 = fs.readFileSync(path.join(__dirname, 'migrations/006_department_system.sql'), 'utf8');
  await conn.query(migration006);
  console.log('✓ Migration 006 completed');

  await conn.end();
  console.log('✓ All migrations executed successfully');
}

runMigrations().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
