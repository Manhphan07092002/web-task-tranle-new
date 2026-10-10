// Script to run migrations 006 and 007
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

  console.log('Running migration 007...');
  const migration007 = fs.readFileSync(path.join(__dirname, 'migrations/007_warehouse_department.sql'), 'utf8');
  await conn.query(migration007);
  console.log('✓ Migration 007 completed');

  console.log('Running migration 008...');
  const migration008 = fs.readFileSync(path.join(__dirname, 'migrations/008_warehouse_assign.sql'), 'utf8');
  await conn.query(migration008);
  console.log('✓ Migration 008 completed');

  console.log('Running migration 009...');
  const migration009 = fs.readFileSync(path.join(__dirname, 'migrations/009_warehouse_counts.sql'), 'utf8');
  await conn.query(migration009);
  console.log('✓ Migration 009 completed');

  console.log('Running migration 010...');
  const migration010 = fs.readFileSync(path.join(__dirname, 'migrations/010_warehouse_transfer_scope.sql'), 'utf8');
  await conn.query(migration010);
  console.log('✓ Migration 010 completed');

  console.log('Running migration 011...');
  const migration011 = fs.readFileSync(path.join(__dirname, 'migrations/011_warehouse_locations.sql'), 'utf8');
  await conn.query(migration011);
  console.log('✓ Migration 011 completed');

  console.log('Running migration 012...');
  const migration012 = fs.readFileSync(path.join(__dirname, 'migrations/012_stock_inquiry.sql'), 'utf8');
  await conn.query(migration012);
  console.log('✓ Migration 012 completed');

  await conn.end();
  console.log('✓ All migrations executed successfully');
}

runMigrations().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
