import 'dotenv/config';
import mysql from 'mysql2/promise';
import { gzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const requestedDatabase = 'Tranle_task_new';
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const outputDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/backups');
const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
let databaseName = requestedDatabase;
let outputPath;
const quoteIdentifier = (value) => `\`${String(value).replaceAll('`', '``')}\``;
const toSqlValue = (value) => {
  if (value === null || value === undefined) return 'NULL';
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  return connection.escape(value);
};

try {
  const [[database]] = await connection.query('SELECT DATABASE() AS name');
  if (String(database.name || '').toLowerCase() !== requestedDatabase.toLowerCase()) {
    throw new Error(`Refusing to back up unexpected database: ${database.name || '(none)'}`);
  }
  databaseName = database.name;
  outputPath = resolve(outputDirectory, `${databaseName}-${timestamp}.sql.gz`);

  await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  const [tables] = await connection.query('SHOW FULL TABLES');
  const tableNameColumn = Object.keys(tables[0] || {}).find((key) => key.startsWith('Tables_in_'));
  if (!tableNameColumn) throw new Error('No base tables found in target database.');

  const statements = [
    `-- Logical backup of ${databaseName}; restore only into an empty database.`,
    'SET FOREIGN_KEY_CHECKS=0;',
    `USE ${quoteIdentifier(databaseName)};`,
  ];
  let tableCount = 0;
  let rowCount = 0;

  for (const table of tables) {
    if (table.Table_type !== 'BASE TABLE') continue;
    const name = table[tableNameColumn];
    const [definition] = await connection.query(`SHOW CREATE TABLE ${quoteIdentifier(name)}`);
    statements.push(`${definition[0]['Create Table']};`);
    const [rows] = await connection.query(`SELECT * FROM ${quoteIdentifier(name)}`);
    if (rows.length) {
      const columns = Object.keys(rows[0]);
      const columnSql = columns.map(quoteIdentifier).join(',');
      for (let start = 0; start < rows.length; start += 100) {
        const values = rows.slice(start, start + 100).map((row) =>
          `(${columns.map((column) => toSqlValue(row[column])).join(',')})`,
        );
        statements.push(`INSERT INTO ${quoteIdentifier(name)} (${columnSql}) VALUES\n${values.join(',\n')};`);
      }
    }
    tableCount += 1;
    rowCount += rows.length;
  }

  statements.push('SET FOREIGN_KEY_CHECKS=1;');
  await connection.commit();
  await mkdir(outputDirectory, { recursive: true });
  const compressed = gzipSync(Buffer.from(`${statements.join('\n\n')}\n`, 'utf8'));
  await writeFile(outputPath, compressed, { flag: 'wx' });
  console.log(JSON.stringify({ database: databaseName, tables: tableCount, rows: rowCount, backup: outputPath, bytes: compressed.length }, null, 2));
} catch (error) {
  try { await connection.rollback(); } catch {}
  throw error;
} finally {
  await connection.end();
}
