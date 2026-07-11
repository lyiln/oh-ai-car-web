import '../load-env.js';
import { loadConfig } from '../config.js';
import { Database } from './index.js';

const db = new Database(loadConfig().databaseUrl);
try { await db.migrate(); console.log('Database migrations applied'); }
finally { await db.close(); }
