// DFE session role, for the console to read.
//
// The embedded UI draws Save and Create Rule on the search page, and the server
// refuses a read-only session either one (dfe/middleware/role-claim). This tells
// the page which session it is, so it can leave out an action that would only
// answer 403. The server stays the control: this is a hint for drawing the page.
// shipped-dashboards mounts it, so api-app.ts carries no line for it.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import express from 'express';

import { requireDfeMode } from '@/dfe/middleware/admin-lockdown';
import { dfeRoleIsReadOnly } from '@/dfe/middleware/role-claim';

const router = express.Router();

// The session role is DFE's, so outside DFE mode it is not there at all.
router.use(requireDfeMode);

/**
 * GET /dfe/session
 *
 * Response:
 *   - role: string | null (the engine's `hyperdx_role`, null when it sent none)
 *   - readOnly: boolean (true for the engine's read-only `viewer` role)
 */
router.get('/session', (req, res) => {
  res.json({ role: req.dfeRole ?? null, readOnly: dfeRoleIsReadOnly(req) });
});

export default router;
