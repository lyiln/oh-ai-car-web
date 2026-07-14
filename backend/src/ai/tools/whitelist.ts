import type { Database } from '../../db/index.js';
import type { ToolContext } from '../types.js';

export async function queryWhitelist(db: Database, ctx: ToolContext, q?: string) {
  if (ctx.user.role !== 'admin') {
    throw Object.assign(new Error('Administrator role required'), { statusCode: 403 });
  }
  const pattern = q?.trim() ? `%${q.trim()}%` : null;
  const result = await db.query<{
    id: string;
    plate: string;
    owner_name: string;
    building: string;
    category: string;
    parking_spot: string;
    valid_until: Date | null;
  }>(
    `SELECT e.id, e.plate, e.owner_name, e.building, e.category, e.parking_spot, e.valid_until
     FROM whitelist_entries e
     JOIN whitelist_imports i ON i.id = e.whitelist_id
     WHERE i.vehicle_id IS NULL AND i.is_snapshot = false
       AND ($1::text IS NULL OR e.plate ILIKE $1 OR e.owner_name ILIKE $1 OR e.building ILIKE $1)
     ORDER BY e.plate
     LIMIT 200`,
    [pattern],
  );
  return {
    count: result.rows.length,
    entries: result.rows.map((row) => ({
      id: row.id,
      plate: row.plate,
      ownerName: row.owner_name,
      building: row.building,
      category: row.category,
      parkingSpot: row.parking_spot,
      validUntil: row.valid_until ? row.valid_until.toISOString() : null,
    })),
  };
}
