import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { User } from '../models/user.model';
import { Team } from '../models/team.model';
import { logger } from '../utils/logger';

const router = Router();

// ─── Helpers ───────────────────────────────────────────────

function scimError(status: number, detail: string) {
  return {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    status: String(status),
    detail,
  };
}

function userToScim(user: any, baseUrl: string) {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: user._id.toString(),
    externalId: user.external_id || user._id.toString(),
    userName: user.email,
    name: {
      formatted: user.name,
      givenName: user.name.split(' ')[0] || '',
      familyName: user.name.split(' ').slice(1).join(' ') || '',
    },
    emails: [
      {
        value: user.email,
        type: 'work',
        primary: true,
      },
    ],
    displayName: user.name,
    active: user.status === 'active',
    roles: (user.roles || []).map((r: string) => ({ value: r })),
    meta: {
      resourceType: 'User',
      created: user.createdAt?.toISOString(),
      lastModified: user.updatedAt?.toISOString(),
      location: `${baseUrl}/scim/v2/Users/${user._id}`,
    },
  };
}

function groupToScim(team: any, members: any[], baseUrl: string) {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
    id: team._id.toString(),
    displayName: team.name,
    members: members.map((m: any) => ({
      value: m._id.toString(),
      display: m.name || m.email,
      $ref: `${baseUrl}/scim/v2/Users/${m._id}`,
    })),
    meta: {
      resourceType: 'Group',
      created: team.created_at?.toISOString(),
      lastModified: team.updated_at?.toISOString(),
      location: `${baseUrl}/scim/v2/Groups/${team._id}`,
    },
  };
}

function getBaseUrl(req: Request): string {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

/**
 * Parse simple SCIM filter expressions.
 * Supports: userName eq "value", displayName eq "value", emails.value eq "value"
 */
function parseFilter(filter: string | undefined): Record<string, string> | null {
  if (!filter) return null;
  const match = filter.match(/^(\w+(?:\.\w+)?)\s+eq\s+"([^"]+)"$/i);
  if (!match) return null;
  return { attr: match[1], value: match[2] };
}

// ─── SCIM Service Provider Config ──────────────────────────

router.get('/ServiceProviderConfig', (_req: Request, res: Response) => {
  res.json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: 'https://docs.sreoncall.com/scim',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'Authentication using a bearer token.',
      },
    ],
  });
});

router.get('/ResourceTypes', (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);
  res.json([
    {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
      id: 'User',
      name: 'User',
      endpoint: '/scim/v2/Users',
      schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
      meta: { resourceType: 'ResourceType', location: `${baseUrl}/scim/v2/ResourceTypes/User` },
    },
    {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
      id: 'Group',
      name: 'Group',
      endpoint: '/scim/v2/Groups',
      schema: 'urn:ietf:params:scim:schemas:core:2.0:Group',
      meta: { resourceType: 'ResourceType', location: `${baseUrl}/scim/v2/ResourceTypes/Group` },
    },
  ]);
});

router.get('/Schemas', (_req: Request, res: Response) => {
  res.json([
    {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
      id: 'urn:ietf:params:scim:schemas:core:2.0:User',
      name: 'User',
    },
    {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
      id: 'urn:ietf:params:scim:schemas:core:2.0:Group',
      name: 'Group',
    },
  ]);
});

// ─── Users ─────────────────────────────────────────────────

// GET /scim/v2/Users — List / filter users
router.get('/Users', async (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);
  const startIndex = Math.max(1, parseInt(req.query.startIndex as string) || 1);
  const count = Math.min(200, Math.max(1, parseInt(req.query.count as string) || 100));
  const filter = parseFilter(req.query.filter as string);

  const query: any = { tenant_id: req.tenantId, status: { $ne: 'deleted' } };

  if (filter) {
    if (filter.attr === 'userName' || filter.attr === 'emails.value') {
      query.email = filter.value.toLowerCase();
    } else if (filter.attr === 'displayName') {
      query.name = filter.value;
    } else if (filter.attr === 'externalId') {
      query.external_id = filter.value;
    }
  }

  const total = await User.countDocuments(query);
  const users = await User.find(query)
    .skip(startIndex - 1)
    .limit(count)
    .sort({ createdAt: 1 });

  res.json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: total,
    startIndex,
    itemsPerPage: users.length,
    Resources: users.map((u) => userToScim(u, baseUrl)),
  });
});

// GET /scim/v2/Users/:id
router.get('/Users/:id', async (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);

  if (!Types.ObjectId.isValid(req.params.id as string)) {
    res.status(404).json(scimError(404, 'User not found.'));
    return;
  }

  const user = await User.findOne({
    _id: req.params.id,
    tenant_id: req.tenantId,
    status: { $ne: 'deleted' },
  });

  if (!user) {
    res.status(404).json(scimError(404, 'User not found.'));
    return;
  }

  res.json(userToScim(user, baseUrl));
});

// POST /scim/v2/Users — Create user
router.post('/Users', async (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);
  const body = req.body;

  const email = (body.userName || body.emails?.[0]?.value || '').toLowerCase().trim();
  if (!email) {
    res.status(400).json(scimError(400, 'userName or emails[0].value is required.'));
    return;
  }

  // Check for existing user
  const existing = await User.findOne({ tenant_id: req.tenantId, email });
  if (existing) {
    if (existing.status === 'deleted') {
      // Reactivate
      existing.status = 'active';
      existing.name = body.name?.formatted || body.displayName || `${body.name?.givenName || ''} ${body.name?.familyName || ''}`.trim() || email;
      existing.source = 'scim';
      existing.deleted_at = undefined;
      if (body.externalId) (existing as any).external_id = body.externalId;
      await existing.save();
      res.status(200).json(userToScim(existing, baseUrl));
      return;
    }
    res.status(409).json(scimError(409, 'User already exists.'));
    return;
  }

  const name = body.name?.formatted || body.displayName || `${body.name?.givenName || ''} ${body.name?.familyName || ''}`.trim() || email;

  const user = await User.create({
    tenant_id: req.tenantId,
    email,
    email_verified: true,
    name,
    roles: body.roles?.map((r: any) => r.value) || ['agent'],
    status: body.active === false ? 'disabled' : 'active',
    source: 'scim',
    external_id: body.externalId,
  });

  logger.info('SCIM user created', { tenant_id: req.tenantId, user_id: user._id, email });
  res.status(201).json(userToScim(user, baseUrl));
});

// PUT /scim/v2/Users/:id — Replace user
router.put('/Users/:id', async (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);

  if (!Types.ObjectId.isValid(req.params.id as string)) {
    res.status(404).json(scimError(404, 'User not found.'));
    return;
  }

  const user = await User.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!user) {
    res.status(404).json(scimError(404, 'User not found.'));
    return;
  }

  const body = req.body;
  const email = (body.userName || body.emails?.[0]?.value || '').toLowerCase().trim();
  if (email) user.email = email;

  const name = body.name?.formatted || body.displayName || `${body.name?.givenName || ''} ${body.name?.familyName || ''}`.trim();
  if (name) user.name = name;

  if (body.active === false) {
    user.status = 'disabled';
  } else if (body.active === true) {
    user.status = 'active';
  }

  if (body.roles?.length) {
    user.roles = body.roles.map((r: any) => r.value);
  }

  if (body.externalId) (user as any).external_id = body.externalId;

  await user.save();
  logger.info('SCIM user replaced', { tenant_id: req.tenantId, user_id: user._id });
  res.json(userToScim(user, baseUrl));
});

// PATCH /scim/v2/Users/:id — Partial update
router.patch('/Users/:id', async (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);

  if (!Types.ObjectId.isValid(req.params.id as string)) {
    res.status(404).json(scimError(404, 'User not found.'));
    return;
  }

  const user = await User.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!user) {
    res.status(404).json(scimError(404, 'User not found.'));
    return;
  }

  const operations = req.body.Operations || req.body.operations || [];
  for (const op of operations) {
    const operation = (op.op || '').toLowerCase();
    const path = op.path || '';
    const value = op.value;

    if (operation === 'replace') {
      if (path === 'active' || (!path && typeof value?.active !== 'undefined')) {
        const active = path ? value : value.active;
        user.status = active === true || active === 'true' ? 'active' : 'disabled';
      }
      if (path === 'userName' || (!path && value?.userName)) {
        user.email = (path ? value : value.userName).toLowerCase().trim();
      }
      if (path === 'displayName' || (!path && value?.displayName)) {
        user.name = path ? value : value.displayName;
      }
      if (path === 'name.givenName' || path === 'name.familyName' || (!path && value?.name)) {
        const nameObj = path ? undefined : value.name;
        if (nameObj?.formatted) {
          user.name = nameObj.formatted;
        } else if (nameObj) {
          user.name = `${nameObj.givenName || ''} ${nameObj.familyName || ''}`.trim() || user.name;
        }
      }
      if (path === 'externalId' || (!path && value?.externalId)) {
        (user as any).external_id = path ? value : value.externalId;
      }
    } else if (operation === 'add') {
      if (path === 'roles' && Array.isArray(value)) {
        const newRoles = value.map((r: any) => r.value || r);
        user.roles = [...new Set([...user.roles, ...newRoles])];
      }
    } else if (operation === 'remove') {
      if (path === 'roles' && Array.isArray(value)) {
        const removeRoles = new Set(value.map((r: any) => r.value || r));
        user.roles = user.roles.filter((r) => !removeRoles.has(r));
        if (user.roles.length === 0) user.roles = ['agent'];
      }
    }
  }

  await user.save();
  logger.info('SCIM user patched', { tenant_id: req.tenantId, user_id: user._id });
  res.json(userToScim(user, baseUrl));
});

// DELETE /scim/v2/Users/:id — Deactivate (soft delete)
router.delete('/Users/:id', async (req: Request, res: Response) => {
  if (!Types.ObjectId.isValid(req.params.id as string)) {
    res.status(404).json(scimError(404, 'User not found.'));
    return;
  }

  const user = await User.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!user) {
    res.status(404).json(scimError(404, 'User not found.'));
    return;
  }

  user.status = 'disabled';
  user.deleted_at = new Date();
  await user.save();

  logger.info('SCIM user deactivated', { tenant_id: req.tenantId, user_id: user._id });
  res.status(204).send();
});

// ─── Groups ────────────────────────────────────────────────

// GET /scim/v2/Groups — List / filter groups
router.get('/Groups', async (req: Request, res: Response) => {
  try {
    const baseUrl = getBaseUrl(req);
    const startIndex = Math.max(1, parseInt(req.query.startIndex as string) || 1);
    const count = Math.min(200, Math.max(1, parseInt(req.query.count as string) || 100));
    const filter = parseFilter(req.query.filter as string);

    const query: any = { tenant_id: req.tenantId };
    if (filter?.attr === 'displayName') {
      query.name = filter.value;
    }

    const total = await Team.countDocuments(query);
    const teams = await Team.find(query)
      .skip(startIndex - 1)
      .limit(count)
      .sort({ created_at: 1 });

    // Resolve members for each team — handle both ObjectId refs and embedded objects
    const extractMemberId = (m: any): string | null => {
      if (!m) return null;
      if (typeof m === 'string') return m;
      if (m._id) return m._id.toString();
      if (typeof m.toString === 'function' && /^[0-9a-f]{24}$/.test(m.toString())) return m.toString();
      // Embedded subdoc with user_id field
      if (m.user_id) return m.user_id.toString();
      return null;
    };

    const memberIds = [...new Set(
      teams.flatMap((t) => (t.members || []).map(extractMemberId).filter(Boolean))
    )] as string[];
    const members = memberIds.length > 0
      ? await User.find({ _id: { $in: memberIds } }).select('name email')
      : [];
    const memberMap = new Map(members.map((m) => [m._id.toString(), m]));

    res.json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: total,
      startIndex,
      itemsPerPage: teams.length,
      Resources: teams.map((t) => {
        const teamMembers = (t.members || [])
          .map((mid: any) => memberMap.get(extractMemberId(mid) || ''))
          .filter(Boolean);
        return groupToScim(t, teamMembers, baseUrl);
      }),
    });
  } catch (err: any) {
    logger.error('SCIM list groups error', { error: err.message, stack: err.stack });
    res.status(500).json(scimError(500, err.message || 'Internal error'));
  }
});

// GET /scim/v2/Groups/:id
router.get('/Groups/:id', async (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);

  if (!Types.ObjectId.isValid(req.params.id as string)) {
    res.status(404).json(scimError(404, 'Group not found.'));
    return;
  }

  const team = await Team.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!team) {
    res.status(404).json(scimError(404, 'Group not found.'));
    return;
  }

  const members = (team.members || []).length > 0
    ? await User.find({ _id: { $in: team.members } }).select('name email')
    : [];
  res.json(groupToScim(team, members, baseUrl));
});

// POST /scim/v2/Groups — Create group (maps to Team)
router.post('/Groups', async (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);
  const body = req.body;

  if (!body.displayName) {
    res.status(400).json(scimError(400, 'displayName is required.'));
    return;
  }

  // Check for existing team with same name
  const existing = await Team.findOne({ tenant_id: req.tenantId, name: body.displayName });
  if (existing) {
    res.status(409).json(scimError(409, 'Group already exists.'));
    return;
  }

  // Resolve member IDs
  const memberIds: Types.ObjectId[] = [];
  if (body.members?.length) {
    for (const m of body.members) {
      if (Types.ObjectId.isValid(m.value)) {
        memberIds.push(new Types.ObjectId(m.value));
      }
    }
  }

  // For created_by, use the first member or create a system reference
  const firstAdmin = await User.findOne({
    tenant_id: req.tenantId,
    roles: { $in: ['platform_admin', 'tenant_admin'] },
    status: 'active',
  });

  const team = await Team.create({
    tenant_id: req.tenantId,
    name: body.displayName,
    description: `SCIM-provisioned group`,
    members: memberIds,
    created_by: firstAdmin?._id || memberIds[0] || req.tenantId,
  });

  const members = await User.find({ _id: { $in: memberIds } }).select('name email');
  logger.info('SCIM group created', { tenant_id: req.tenantId, team_id: team._id });
  res.status(201).json(groupToScim(team, members, baseUrl));
});

// PUT /scim/v2/Groups/:id — Replace group
router.put('/Groups/:id', async (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);

  if (!Types.ObjectId.isValid(req.params.id as string)) {
    res.status(404).json(scimError(404, 'Group not found.'));
    return;
  }

  const team = await Team.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!team) {
    res.status(404).json(scimError(404, 'Group not found.'));
    return;
  }

  const body = req.body;
  if (body.displayName) team.name = body.displayName;

  if (body.members) {
    team.members = body.members
      .filter((m: any) => Types.ObjectId.isValid(m.value))
      .map((m: any) => new Types.ObjectId(m.value));
  }

  await team.save();
  const members = await User.find({ _id: { $in: team.members } }).select('name email');
  logger.info('SCIM group replaced', { tenant_id: req.tenantId, team_id: team._id });
  res.json(groupToScim(team, members, baseUrl));
});

// PATCH /scim/v2/Groups/:id — Partial update (member add/remove)
router.patch('/Groups/:id', async (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);

  if (!Types.ObjectId.isValid(req.params.id as string)) {
    res.status(404).json(scimError(404, 'Group not found.'));
    return;
  }

  const team = await Team.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!team) {
    res.status(404).json(scimError(404, 'Group not found.'));
    return;
  }

  const operations = req.body.Operations || req.body.operations || [];
  for (const op of operations) {
    const operation = (op.op || '').toLowerCase();
    const path = op.path || '';
    const value = op.value;

    if (operation === 'replace') {
      if (path === 'displayName' || (!path && value?.displayName)) {
        team.name = path ? value : value.displayName;
      }
      if (path === 'members') {
        team.members = (Array.isArray(value) ? value : [])
          .filter((m: any) => Types.ObjectId.isValid(m.value))
          .map((m: any) => new Types.ObjectId(m.value));
      }
    } else if (operation === 'add') {
      if (path === 'members' && Array.isArray(value)) {
        const existing = new Set(team.members.map((m) => m.toString()));
        for (const m of value) {
          if (Types.ObjectId.isValid(m.value) && !existing.has(m.value)) {
            team.members.push(new Types.ObjectId(m.value));
          }
        }
      }
    } else if (operation === 'remove') {
      if (path?.startsWith('members[')) {
        // path format: members[value eq "userId"]
        const idMatch = path.match(/members\[value\s+eq\s+"([^"]+)"\]/i);
        if (idMatch) {
          const removeId = idMatch[1];
          team.members = team.members.filter((m) => m.toString() !== removeId);
        }
      } else if (path === 'members' && Array.isArray(value)) {
        const removeSet = new Set(value.map((m: any) => m.value));
        team.members = team.members.filter((m) => !removeSet.has(m.toString()));
      }
    }
  }

  await team.save();
  const members = await User.find({ _id: { $in: team.members } }).select('name email');
  logger.info('SCIM group patched', { tenant_id: req.tenantId, team_id: team._id });
  res.json(groupToScim(team, members, baseUrl));
});

// DELETE /scim/v2/Groups/:id
router.delete('/Groups/:id', async (req: Request, res: Response) => {
  if (!Types.ObjectId.isValid(req.params.id as string)) {
    res.status(404).json(scimError(404, 'Group not found.'));
    return;
  }

  const team = await Team.findOneAndDelete({ _id: req.params.id, tenant_id: req.tenantId });
  if (!team) {
    res.status(404).json(scimError(404, 'Group not found.'));
    return;
  }

  logger.info('SCIM group deleted', { tenant_id: req.tenantId, team_id: team._id });
  res.status(204).send();
});

export default router;
