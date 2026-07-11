import './load-env.js';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { Database } from './db/index.js';
import { startRetentionJob } from './retention.js';

const config = loadConfig();
const db = new Database(config.databaseUrl);
await db.migrate();
if (config.bootstrapAdminUsername && config.bootstrapAdminPassword) {
  const email = config.bootstrapAdminEmail?.trim().toLowerCase() || null;
  await db.query(
    "INSERT INTO users (id, username, display_name, password_hash, role, email) VALUES ($1,$2,$3,$4,'admin',$5) ON CONFLICT (username) DO UPDATE SET email=COALESCE(users.email, EXCLUDED.email)",
    [randomUUID(), config.bootstrapAdminUsername, config.bootstrapAdminUsername, await argon2.hash(config.bootstrapAdminPassword), email],
  );
}
const app = await createApp({ config, db });
startRetentionJob(db);
await app.listen({ host: config.host, port: config.port });
