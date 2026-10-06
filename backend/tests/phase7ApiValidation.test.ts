import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { contractRoutes } from '../routes/contracts.js';
import { documentRoutes } from '../routes/documents.js';
import { eventRoutes } from '../routes/events.js';
import { reportRoutes } from '../routes/reports.js';
import { adminRoutes } from '../routes/admin.js';

const admin = { id: 'admin-1', role: 'Admin', department: 'Operations', permissions: ['admin_panel'] };
const employee = { id: 'user-1', role: 'Employee', department: 'Operations', permissions: [] };

function appFor(router: express.Router, user = employee) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.user = user; next(); });
  app.use(router);
  return app;
}

describe('Phase 7 write API schemas', () => {
  it('rejects invalid event fields before writing', async () => {
    const db = { run: vi.fn() };
    await request(appFor(eventRoutes(db), admin))
      .post('/')
      .send({ title: '', date: '2026-01-01', isRecurringYearly: 'yes' })
      .expect(400);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('rejects document URLs that do not point to protected uploaded files', async () => {
    const db = { run: vi.fn(), get: vi.fn() };
    await request(appFor(documentRoutes(db)))
      .post('/')
      .send({ name: 'report.pdf', url: 'https://attacker.invalid/report.pdf', category: 'reports', linkedId: 'r1' })
      .expect(400);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('rejects incomplete or invalid contract and report payloads before DB access', async () => {
    const contractDb = { run: vi.fn(), get: vi.fn(), all: vi.fn() };
    await request(appFor(contractRoutes(contractDb)))
      .post('/')
      .send({ contractNumber: 'C-1', clientName: 'Client', contractName: 'Contract', preTaxValue: 'NaN' })
      .expect(400);
    expect(contractDb.get).not.toHaveBeenCalled();

    const reportDb = { run: vi.fn(), get: vi.fn(), all: vi.fn() };
    await request(appFor(reportRoutes(reportDb)))
      .post('/')
      .send({ id: 'report-1', title: '', status: 'Approved', content: '{}' })
      .expect(400);
    expect(reportDb.run).not.toHaveBeenCalled();
  });

  it('issues database confirmation tokens only for allowlisted destructive targets', async () => {
    const db = { run: vi.fn(), get: vi.fn(), all: vi.fn() };
    const router = adminRoutes(db, {});
    await request(appFor(router, admin)).post('/database/confirm').send({ action: 'delete-row', table: 'users; DROP TABLE users', id: 'u1' }).expect(400);
    const response = await request(appFor(router, admin)).post('/database/confirm').send({ action: 'import' }).expect(200);
    expect(response.body.token).toMatch(/^[a-f0-9]{64}$/);
    expect(db.run).not.toHaveBeenCalled();
  });
});
