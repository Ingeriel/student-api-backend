const test = require('node:test');
const assert = require('node:assert');

// Run the handler without Atlas: stub the connection and the model's database calls.
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: async () => {} };
process.env.WRITE_KEY = 'secret';

const handler = require('../api/index.js');
const Attendance = require('mongoose').models.Attendance;

async function call(req) {
  const out = {};
  const res = {
    setHeader() {},
    status(code) { out.status = code; return res; },
    json(body) { out.body = body; return res; },
    end() { return res; },
  };
  await handler({ method: 'GET', headers: {}, query: {}, ...req }, res);
  return out;
}

const keyed = { 'x-api-key': 'secret' };
const student = { studentName: ' Ana Cruz ', section: 'CS3A', subjectName: 'Database Management Systems' };

test('uses the daily_attendance collection', () => {
  assert.strictEqual(Attendance.collection.name, 'daily_attendance');
});

test('GET lists records without a key', async () => {
  Attendance.find = () => ({ sort: () => ({ lean: async () => [{ studentName: 'A' }] }) });
  const r = await call({});
  assert.deepStrictEqual([r.status, r.body], [200, [{ studentName: 'A' }]]);
});

test('writes need the key, and are off when WRITE_KEY is unset', async () => {
  assert.strictEqual((await call({ method: 'POST', body: student })).status, 401);
  delete process.env.WRITE_KEY;
  assert.strictEqual((await call({ method: 'POST', body: student, headers: keyed })).status, 503);
  process.env.WRITE_KEY = 'secret';
});

test('POST validates, trims, rejects duplicates and ignores extra fields', async () => {
  Attendance.exists = async () => null;
  Attendance.prototype.save = async function () { return this; };

  assert.strictEqual((await call({ method: 'POST', headers: keyed, body: { section: 'X' } })).status, 400);

  const ok = await call({ method: 'POST', headers: keyed, body: { ...student, isAdmin: true } });
  assert.strictEqual(ok.status, 201);
  assert.strictEqual(ok.body.studentName, 'Ana Cruz');
  assert.strictEqual(ok.body.attendance.length, 0);
  assert.strictEqual(ok.body.isAdmin, undefined);

  Attendance.exists = async () => ({ _id: 1 });
  assert.strictEqual((await call({ method: 'POST', headers: keyed, body: student })).status, 409);
});

test('PATCH sets a status for a day, adding the day if needed, and rejects bad input', async () => {
  const id = '6ad01ef93599be5ced5ce003';
  const calls = [];
  const queue = []; // what each findOneAndUpdate call should return, in order
  Attendance.findOneAndUpdate = (filter, update, options) => {
    calls.push({ filter, update, options });
    return { lean: async () => (queue.length ? queue.shift() : null) };
  };
  const patch = (query, body) => call({ method: 'PATCH', headers: keyed, query, body });

  // The day is already listed: the first call updates it.
  queue.push({ _id: id });
  let r = await patch({ id }, { date: '2026-10-08', status: 'late' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(calls[0].update, { $set: { 'attendance.$.status': 'late' } });
  assert.strictEqual(calls[0].filter['attendance.date'].toISOString(), '2026-10-08T00:00:00.000Z');
  assert.strictEqual(calls[0].options.returnDocument, 'after');

  // A new day: the first call finds nothing, the second pushes it, and the status defaults to present.
  calls.length = 0;
  queue.push(null, { _id: id });
  r = await patch({ id }, { date: '2026-10-15' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[1].update.$push.attendance.status, 'present');
  assert.strictEqual(calls[1].update.$push.attendance.date.toISOString(), '2026-10-15T00:00:00.000Z');

  // Unknown student.
  queue.length = 0;
  assert.strictEqual((await patch({ id }, { date: '2026-10-15' })).status, 404);

  // Bad input never reaches the database.
  calls.length = 0;
  for (const [q, body] of [
    [{ id }, { date: '2026-02-30' }],
    [{ id }, { date: 'today' }],
    [{ id: 'nope' }, { date: '2026-10-08' }],
    [{ id }, { date: '2026-10-08', status: 'sleeping' }],
  ]) {
    assert.strictEqual((await patch(q, body)).status, 400);
  }
  assert.strictEqual(calls.length, 0);
});

test('other methods are refused', async () => {
  assert.strictEqual((await call({ method: 'DELETE', headers: keyed })).status, 405);
});
