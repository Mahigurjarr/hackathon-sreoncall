import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { rbac } from '../middleware/rbac.middleware';
import { auditMiddleware } from '../middleware/audit.middleware';
import { IngestionToken } from '../models/ingestion-token.model';
import * as svc from '../services/snmp-trapper.service';
import { logger } from '../utils/logger';

const router = Router();

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const registerSchema = z.object({
  name:       z.string().min(1).max(200),
  hostname:   z.string().min(1).max(253),
  version:    z.string().max(50).optional(),
  ip_address: z.string().max(45).optional(),
});

const heartbeatSchema = z.object({
  hostname:            z.string().min(1).max(253),
  version:             z.string().max(50),
  uptime_seconds:      z.number().int().min(0),
  trap_rate:           z.number().min(0),
  active_correlations: z.number().int().min(0),
  ip_address:          z.string().max(45),
  config_hash:         z.string().max(128),
});

// ─── Serializer ──────────────────────────────────────────────────────────────

function serialize(t: any) {
  return {
    id:                  t._id?.toString() ?? t.id,
    name:                t.name,
    hostname:            t.hostname,
    version:             t.version,
    status:              t.status,
    last_heartbeat_at:   t.last_heartbeat_at,
    uptime_seconds:      t.uptime_seconds,
    trap_rate:           t.trap_rate,
    active_correlations: t.active_correlations,
    ip_address:          t.ip_address,
    config_hash:         t.config_hash,
    ingestion_token_id:  t.ingestion_token_id?.toString() ?? null,
    created_by:          t.created_by?.toString() ?? null,
    created_at:          t.created_at,
    updated_at:          t.updated_at,
  };
}

// ─── Authenticated CRUD routes ───────────────────────────────────────────────

// GET /api/v1/snmp-trappers
router.get('/', rbac('snmp-trappers:read'), async (req: Request, res: Response) => {
  const docs = await svc.listTrappers(req.tenantId.toString());
  res.json({ data: docs.map(serialize) });
});

// GET /api/v1/snmp-trappers/install.sh
router.get('/install.sh', rbac('snmp-trappers:read'), (req: Request, res: Response) => {
  const tenantId = req.tenantId.toString();
  const apiBase = `https://${req.get('host') || 'app.sreoncall.com'}/api/v1`;

  const script = `#!/usr/bin/env bash
# ============================================================
# SREonCall SNMP Trapper Installer
# Downloads the SNMP trapper binary and configures it.
# ============================================================
set -euo pipefail

SRE_API_BASE="${apiBase}"
SRE_TENANT_ID="${tenantId}"
SRE_TOKEN="\${SRE_TOKEN:?ERROR: SRE_TOKEN is required. Create an ingestion token with traps:write scope.}"

INSTALL_DIR="/opt/sreoncall/snmp-trapper"
CONFIG_FILE="\$INSTALL_DIR/config.yaml"

echo ""
echo "  SREonCall SNMP Trapper Installer"
echo "  ================================="
echo "  Tenant:   \$SRE_TENANT_ID"
echo "  Endpoint: \$SRE_API_BASE"
echo ""

# ── Create directory ──
sudo mkdir -p "\$INSTALL_DIR"

# ── Download binary ──
ARCH=\$(uname -m)
OS=\$(uname -s | tr '[:upper:]' '[:lower:]')
echo "  Downloading snmp-trapper for \$OS/\$ARCH..."
curl -sSL "\$SRE_API_BASE/downloads/snmp-trapper-\$OS-\$ARCH" -o /tmp/snmp-trapper
sudo mv /tmp/snmp-trapper "\$INSTALL_DIR/snmp-trapper"
sudo chmod +x "\$INSTALL_DIR/snmp-trapper"

# ── Write config ──
echo "  Writing config..."
sudo tee "\$CONFIG_FILE" > /dev/null <<CFGEOF
# SREonCall SNMP Trapper Configuration
api_endpoint: \$SRE_API_BASE
tenant_id: \$SRE_TENANT_ID
auth_token: \$SRE_TOKEN
listen_address: "0.0.0.0:162"
heartbeat_interval: 60
log_level: info
CFGEOF

# ── Create systemd service ──
if command -v systemctl &>/dev/null; then
  echo "  Creating systemd service..."
  sudo tee /etc/systemd/system/sreoncall-snmp-trapper.service > /dev/null <<SVCEOF
[Unit]
Description=SREonCall SNMP Trapper
After=network.target

[Service]
Type=simple
ExecStart=\$INSTALL_DIR/snmp-trapper --config \$CONFIG_FILE
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
SVCEOF

  sudo systemctl daemon-reload
  sudo systemctl enable sreoncall-snmp-trapper
  sudo systemctl start sreoncall-snmp-trapper
  echo "  Service started!"
else
  echo "  No systemd found. Start manually: \$INSTALL_DIR/snmp-trapper --config \$CONFIG_FILE"
fi

echo ""
echo "  SNMP Trapper installed successfully."
echo "  Listening for traps on UDP port 162."
echo ""
`;

  res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="install.sh"');
  res.send(script);
});

// GET /api/v1/snmp-trappers/:id
router.get('/:id', rbac('snmp-trappers:read'), async (req: Request, res: Response) => {
  const doc = await svc.getTrapper(req.tenantId.toString(), req.params['id'] as string);
  res.json(serialize(doc));
});

// POST /api/v1/snmp-trappers
router.post('/', rbac('snmp-trappers:create'), auditMiddleware({ action: 'snmp_trapper.created', resourceType: 'snmp_trapper' }), async (req: Request, res: Response) => {
  const body = registerSchema.parse(req.body);
  const doc = await svc.registerTrapper(req.tenantId.toString(), req.userId.toString(), body);
  res.status(201).json(serialize(doc));
});

// DELETE /api/v1/snmp-trappers/:id
router.delete('/:id', rbac('snmp-trappers:delete'), auditMiddleware({ action: 'snmp_trapper.deleted', resourceType: 'snmp_trapper' }), async (req: Request, res: Response) => {
  await svc.deleteTrapper(req.tenantId.toString(), req.params['id'] as string);
  res.status(204).send();
});

export default router;

// ─── Public heartbeat router (token-auth, not session-auth) ──────────────────

export const snmpTrapperHeartbeatRouter = Router();

snmpTrapperHeartbeatRouter.post('/heartbeat', async (req: Request, res: Response) => {
  try {
    // Extract Bearer token from Authorization header
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ detail: 'Missing or invalid Authorization header' });
      return;
    }
    const rawToken = authHeader.slice(7);

    // Hash the token and look it up
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const token = await IngestionToken.findOne({ token_hash: tokenHash }).lean();

    if (!token) {
      res.status(401).json({ detail: 'Invalid token' });
      return;
    }

    // Check revocation
    if (token.revoked_at) {
      res.status(401).json({ detail: 'Token has been revoked' });
      return;
    }

    // Check expiration
    if (token.expires_at && token.expires_at < new Date()) {
      res.status(401).json({ detail: 'Token has expired' });
      return;
    }

    // Check scope
    if (!token.scopes.includes('traps:write')) {
      res.status(403).json({ detail: 'Token missing required scope: traps:write' });
      return;
    }

    // Validate request body
    const body = heartbeatSchema.parse(req.body);

    // Process heartbeat
    const doc = await svc.processHeartbeat(
      token.tenant_id.toString(),
      token._id.toString(),
      body,
    );

    // Update last_used_at on the token
    await IngestionToken.updateOne({ _id: token._id }, { $set: { last_used_at: new Date() } });

    res.json(serialize(doc));
  } catch (err: any) {
    if (err.name === 'ZodError') {
      res.status(400).json({ detail: 'Invalid request body', errors: err.errors });
      return;
    }
    logger.error('SNMP trapper heartbeat error', { error: err.message });
    res.status(500).json({ detail: 'Internal server error' });
  }
});
