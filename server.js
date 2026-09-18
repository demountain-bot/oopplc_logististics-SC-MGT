const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'records.db');
const db = new Database(DB_PATH);

/* ── Schema ─────────────────────────────────────────────── */
db.exec(`
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY,
    date TEXT, estate TEXT, category TEXT, status TEXT,
    data TEXT NOT NULL,
    created_at TEXT, updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_records_date     ON records(date);
  CREATE INDEX IF NOT EXISTS idx_records_estate   ON records(estate);
  CREATE INDEX IF NOT EXISTS idx_records_category ON records(category);

  CREATE TABLE IF NOT EXISTS masterdata (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT, updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_masterdata_type ON masterdata(type);

  CREATE TABLE IF NOT EXISTS asset_handovers (
    id INTEGER PRIMARY KEY,
    type TEXT,
    date TEXT,
    staff_name TEXT,
    staff_phone TEXT,
    asset_type TEXT,
    registration_number TEXT,
    data TEXT NOT NULL,
    created_at TEXT, updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_handover_date ON asset_handovers(date);
  CREATE INDEX IF NOT EXISTS idx_handover_type ON asset_handovers(type);
`);

/* ── Middleware ─────────────────────────────────────────── */
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => res.json({ ok: true, db: DB_PATH }));

/* ═════════════════════════════════════════════════════════
   DAILY RECORDS
   ═════════════════════════════════════════════════════════ */
app.get('/api/records', (_req, res) => {
  try {
    const rows = db.prepare('SELECT data FROM records ORDER BY id DESC').all();
    res.json(rows.map(r => JSON.parse(r.data)));
  } catch (err) {
    console.error('GET /api/records:', err);
    res.status(500).json({ error: 'Failed to read records' });
  }
});

app.post('/api/records', (req, res) => {
  try {
    const record = req.body;
    if (!record || !record.id) return res.status(400).json({ error: 'Record must include an id' });

    const now = new Date().toISOString();
    record.createdAt = record.createdAt || now;
    record.updatedAt = now;

    db.prepare(`
      INSERT OR REPLACE INTO records
        (id, date, estate, category, status, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id, record.date || '', record.estate || '', record.category || '',
      record.status || '', JSON.stringify(record), record.createdAt, record.updatedAt
    );

    const rows = db.prepare('SELECT data FROM records ORDER BY id DESC').all();
    res.status(201).json({ records: rows.map(r => JSON.parse(r.data)) });
  } catch (err) {
    console.error('POST /api/records:', err);
    res.status(500).json({ error: 'Failed to save record' });
  }
});

app.put('/api/records/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const record = req.body;
    if (!record) return res.status(400).json({ error: 'Missing body' });

    record.id = id;
    record.updatedAt = new Date().toISOString();

    const existing = db.prepare('SELECT created_at FROM records WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Record not found' });
    record.createdAt = record.createdAt || existing.created_at;

    db.prepare(`
      UPDATE records SET date = ?, estate = ?, category = ?, status = ?,
        data = ?, updated_at = ? WHERE id = ?
    `).run(
      record.date || '', record.estate || '', record.category || '',
      record.status || '', JSON.stringify(record), record.updatedAt, id
    );

    const rows = db.prepare('SELECT data FROM records ORDER BY id DESC').all();
    res.json({ records: rows.map(r => JSON.parse(r.data)) });
  } catch (err) {
    console.error('PUT /api/records:', err);
    res.status(500).json({ error: 'Failed to update record' });
  }
});

app.delete('/api/records/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = db.prepare('DELETE FROM records WHERE id = ?').run(id);
    const rows = db.prepare('SELECT data FROM records ORDER BY id DESC').all();
    res.json({ deleted: result.changes, records: rows.map(r => JSON.parse(r.data)) });
  } catch (err) {
    console.error('DELETE /api/records:', err);
    res.status(500).json({ error: 'Failed to delete record' });
  }
});

/* ═════════════════════════════════════════════════════════
   MASTER DATA  (shared)
   ═════════════════════════════════════════════════════════ */
app.get('/api/masterdata', (_req, res) => {
  try {
    const rows = db.prepare('SELECT id, type, data, created_at, updated_at FROM masterdata ORDER BY id DESC').all();
    res.json(rows.map(r => ({
      id: r.id,
      type: r.type,
      data: JSON.parse(r.data),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    })));
  } catch (err) {
    console.error('GET /api/masterdata:', err);
    res.status(500).json({ error: 'Failed to read master data' });
  }
});

app.post('/api/masterdata', (req, res) => {
  try {
    const rec = req.body;
    if (!rec || !rec.id || !rec.type) return res.status(400).json({ error: 'Missing id or type' });

    const now = new Date().toISOString();
    const createdAt = rec.createdAt || now;
    const updatedAt = now;

    db.prepare(`
      INSERT OR REPLACE INTO masterdata (id, type, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(rec.id, rec.type, JSON.stringify(rec.data || {}), createdAt, updatedAt);

    const rows = db.prepare('SELECT id, type, data, created_at, updated_at FROM masterdata ORDER BY id DESC').all();
    res.status(201).json({
      records: rows.map(r => ({ id: r.id, type: r.type, data: JSON.parse(r.data), createdAt: r.created_at, updatedAt: r.updated_at }))
    });
  } catch (err) {
    console.error('POST /api/masterdata:', err);
    res.status(500).json({ error: 'Failed to save master data' });
  }
});

app.put('/api/masterdata/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const rec = req.body;
    if (!rec) return res.status(400).json({ error: 'Missing body' });

    const existing = db.prepare('SELECT created_at FROM masterdata WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE masterdata SET type = ?, data = ?, updated_at = ? WHERE id = ?
    `).run(rec.type, JSON.stringify(rec.data || {}), now, id);

    const rows = db.prepare('SELECT id, type, data, created_at, updated_at FROM masterdata ORDER BY id DESC').all();
    res.json({
      records: rows.map(r => ({ id: r.id, type: r.type, data: JSON.parse(r.data), createdAt: r.created_at, updatedAt: r.updated_at }))
    });
  } catch (err) {
    console.error('PUT /api/masterdata:', err);
    res.status(500).json({ error: 'Failed to update master data' });
  }
});

app.delete('/api/masterdata/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = db.prepare('DELETE FROM masterdata WHERE id = ?').run(id);
    const rows = db.prepare('SELECT id, type, data, created_at, updated_at FROM masterdata ORDER BY id DESC').all();
    res.json({
      deleted: result.changes,
      records: rows.map(r => ({ id: r.id, type: r.type, data: JSON.parse(r.data), createdAt: r.created_at, updatedAt: r.updated_at }))
    });
  } catch (err) {
    console.error('DELETE /api/masterdata:', err);
    res.status(500).json({ error: 'Failed to delete master data' });
  }
});

/* ═════════════════════════════════════════════════════════
   ASSET HANDOVER / RETRIEVAL
   ═════════════════════════════════════════════════════════ */
app.get('/api/asset-handovers', (_req, res) => {
  try {
    const rows = db.prepare('SELECT data FROM asset_handovers ORDER BY id DESC').all();
    res.json(rows.map(r => JSON.parse(r.data)));
  } catch (err) {
    console.error('GET /api/asset-handovers:', err);
    res.status(500).json({ error: 'Failed to read handover records' });
  }
});

app.post('/api/asset-handovers', (req, res) => {
  try {
    const rec = req.body;
    if (!rec || !rec.id) return res.status(400).json({ error: 'Record must include an id' });

    const now = new Date().toISOString();
    rec.createdAt = rec.createdAt || now;
    rec.updatedAt = now;

    db.prepare(`
      INSERT OR REPLACE INTO asset_handovers
        (id, type, date, staff_name, staff_phone, asset_type, registration_number, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rec.id, rec.type || '', rec.date || '', rec.staffName || '',
      rec.staffPhone || '', rec.assetType || '', rec.registrationNumber || '',
      JSON.stringify(rec), rec.createdAt, rec.updatedAt
    );

    const rows = db.prepare('SELECT data FROM asset_handovers ORDER BY id DESC').all();
    res.status(201).json({ records: rows.map(r => JSON.parse(r.data)) });
  } catch (err) {
    console.error('POST /api/asset-handovers:', err);
    res.status(500).json({ error: 'Failed to save handover' });
  }
});

app.put('/api/asset-handovers/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const rec = req.body;
    if (!rec) return res.status(400).json({ error: 'Missing body' });

    rec.id = id;
    rec.updatedAt = new Date().toISOString();

    const existing = db.prepare('SELECT created_at FROM asset_handovers WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    rec.createdAt = rec.createdAt || existing.created_at;

    db.prepare(`
      UPDATE asset_handovers
      SET type = ?, date = ?, staff_name = ?, staff_phone = ?,
          asset_type = ?, registration_number = ?, data = ?, updated_at = ?
      WHERE id = ?
    `).run(
      rec.type || '', rec.date || '', rec.staffName || '', rec.staffPhone || '',
      rec.assetType || '', rec.registrationNumber || '', JSON.stringify(rec),
      rec.updatedAt, id
    );

    const rows = db.prepare('SELECT data FROM asset_handovers ORDER BY id DESC').all();
    res.json({ records: rows.map(r => JSON.parse(r.data)) });
  } catch (err) {
    console.error('PUT /api/asset-handovers:', err);
    res.status(500).json({ error: 'Failed to update handover' });
  }
});

app.delete('/api/asset-handovers/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = db.prepare('DELETE FROM asset_handovers WHERE id = ?').run(id);
    const rows = db.prepare('SELECT data FROM asset_handovers ORDER BY id DESC').all();
    res.json({ deleted: result.changes, records: rows.map(r => JSON.parse(r.data)) });
  } catch (err) {
    console.error('DELETE /api/asset-handovers:', err);
    res.status(500).json({ error: 'Failed to delete handover' });
  }
});

/* ── SPA fallback ───────────────────────────────────────── */
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).end();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`OOPPLC API listening on port ${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});