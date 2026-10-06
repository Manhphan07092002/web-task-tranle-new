import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';

const CreateContractLinkSchema = z.object({
  outputContractId: z.string().trim().min(1).max(191),
  inputContractId: z.string().trim().min(1).max(191),
  linkType: z.string().trim().min(1).max(50).optional(),
  description: z.string().max(2000).nullable().optional(),
}).refine((data) => data.outputContractId !== data.inputContractId, {
  path: ['inputContractId'], message: 'A contract cannot link to itself',
});

const UpdateContractLinkSchema = z.object({
  linkType: z.string().trim().min(1).max(50).optional(),
  description: z.string().max(2000).nullable().optional(),
}).refine((data) => data.linkType !== undefined || data.description !== undefined, {
  message: 'At least one field must be provided',
});

export function contractLinkRoutes(db: any) {
  const router = Router();

  const canViewAllContracts = (user: any) => {
    const permissions = user?.permissions || [];
    return permissions.includes('view_all_reports') || permissions.includes('director_feedback') ||
      permissions.includes('admin_panel') || permissions.includes('view_all_tasks');
  };

  const canViewContract = (contract: any, user: any) => Boolean(contract && user && (
    canViewAllContracts(user) || contract.createdBy === user.id ||
    (user.department && contract.department === user.department) || contract.docAccountantUserId === user.id
  ));

  async function getVisibleContract(contractId: string, user: any) {
    const contract = await db.get(
      'SELECT id, createdBy, department, docAccountantUserId FROM contracts WHERE id = ? AND (isDeleted IS NULL OR isDeleted = 0)',
      [contractId],
    );
    return canViewContract(contract, user) ? contract : null;
  }

  // Return links only when both linked contracts are in the caller's visible scope.
  router.get('/', async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const links = await db.all('SELECT * FROM contract_links ORDER BY createdAt DESC');
      if (canViewAllContracts(req.user)) return res.json(links);

      const visibleContracts = await db.all(
        `SELECT id FROM contracts WHERE (isDeleted IS NULL OR isDeleted = 0)
         AND (createdBy = ? OR department = ? OR docAccountantUserId = ?)`,
        [req.user.id, req.user.department || '', req.user.id],
      );
      const visibleIds = new Set(visibleContracts.map((contract: any) => contract.id));
      res.json(links.filter((link: any) => visibleIds.has(link.outputContractId) && visibleIds.has(link.inputContractId)));
    } catch (e) { res.status(500).json({ error: 'Failed to fetch contract links' }); }
  });

  router.post('/', validate(CreateContractLinkSchema), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const { outputContractId, inputContractId, linkType, description } = req.body;
    if (typeof outputContractId !== 'string' || !outputContractId || typeof inputContractId !== 'string' || !inputContractId) {
      return res.status(400).json({ error: 'outputContractId and inputContractId are required' });
    }
    if (outputContractId === inputContractId) return res.status(400).json({ error: 'Cannot link a contract to itself' });
    if (linkType !== undefined && (typeof linkType !== 'string' || linkType.length > 50)) return res.status(400).json({ error: 'Invalid linkType' });
    if (description !== undefined && description !== null && (typeof description !== 'string' || description.length > 2000)) return res.status(400).json({ error: 'Invalid description' });

    try {
      const outputContract = await getVisibleContract(outputContractId, user);
      const inputContract = await getVisibleContract(inputContractId, user);
      if (!outputContract || !inputContract) return res.status(404).json({ error: 'Contract not found' });

      const id = randomUUID();
      await db.run(
        'INSERT INTO contract_links (id, outputContractId, inputContractId, linkType, description, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, outputContractId, inputContractId, linkType || 'related', description || null, user.id, new Date().toISOString()],
      );
      res.status(201).json({ id });
    } catch (e: any) {
      if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Link already exists' });
      res.status(500).json({ error: 'Failed to create link' });
    }
  });

  router.put('/:id', validate(UpdateContractLinkSchema), async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const { linkType, description } = req.body;
    if (linkType !== undefined && (typeof linkType !== 'string' || linkType.length > 50)) return res.status(400).json({ error: 'Invalid linkType' });
    if (description !== undefined && description !== null && (typeof description !== 'string' || description.length > 2000)) return res.status(400).json({ error: 'Invalid description' });
    try {
      const link = await db.get('SELECT * FROM contract_links WHERE id = ?', [req.params.id]);
      if (!link) return res.status(404).json({ error: 'Link not found' });
      const [outputContract, inputContract] = await Promise.all([
        getVisibleContract(link.outputContractId, user),
        getVisibleContract(link.inputContractId, user),
      ]);
      if (!outputContract || !inputContract) return res.status(404).json({ error: 'Link not found' });

      await db.run(
        'UPDATE contract_links SET linkType = ?, description = ? WHERE id = ?',
        [linkType || 'related', description || null, req.params.id],
      );
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to update link' }); }
  });

  router.delete('/:id', async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const link = await db.get('SELECT * FROM contract_links WHERE id = ?', [req.params.id]);
      if (!link) return res.status(404).json({ error: 'Link not found' });
      const [outputContract, inputContract] = await Promise.all([
        getVisibleContract(link.outputContractId, user),
        getVisibleContract(link.inputContractId, user),
      ]);
      if (!outputContract || !inputContract) return res.status(404).json({ error: 'Link not found' });
      await db.run('DELETE FROM contract_links WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to delete link' }); }
  });

  return router;
}
