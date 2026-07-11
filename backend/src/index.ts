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
  await db.query(
    "INSERT INTO users (id, username, display_name, password_hash, role) VALUES ($1,$2,$3,$4,'admin') ON CONFLICT (username) DO NOTHING",
    [randomUUID(), config.bootstrapAdminUsername, config.bootstrapAdminUsername, await argon2.hash(config.bootstrapAdminPassword)],
  );
}
const app = await createApp({ config, db });
startRetentionJob(db);
await app.listen({ host: config.host, port: config.port });
