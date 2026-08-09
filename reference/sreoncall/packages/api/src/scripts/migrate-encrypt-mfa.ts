/**
 * One-time migration: encrypt existing plaintext MFA TOTP secrets.
 *
 * Usage: npx tsx src/scripts/migrate-encrypt-mfa.ts
 *
 * This script finds all users with a totp_secret that is not already encrypted
 * (AES-256-GCM produces base64url strings) and encrypts them in place.
 */
import mongoose from 'mongoose';
import { User } from '../models/user.model';
import { encryptToken, decryptToken } from '../utils/encryption';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sreoncall?replicaSet=rs0';

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const users = await User.find({ 'mfa.totp_secret': { $exists: true, $ne: null } }).select('+mfa.totp_secret');
  console.log(`Found ${users.length} users with TOTP secrets`);

  let migrated = 0;
  let skipped = 0;

  for (const user of users) {
    const secret = user.mfa?.totp_secret;
    if (!secret) continue;

    // Check if already encrypted by trying to decrypt
    try {
      decryptToken(secret);
      // Successfully decrypted → already encrypted
      skipped++;
      continue;
    } catch {
      // Decryption failed → plaintext, needs encryption
    }

    user.mfa.totp_secret = encryptToken(secret);
    user.markModified('mfa');
    await user.save();
    migrated++;
  }

  console.log(`Migration complete: ${migrated} encrypted, ${skipped} already encrypted`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
