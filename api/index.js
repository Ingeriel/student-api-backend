const mongoose = require('mongoose');
const connectToDatabase = require('../db');

const STATUSES = ['present', 'late', 'absent'];

// One entry per class day: { date: <UTC midnight>, status: 'present' | 'late' | 'absent' }.
const entry = new mongoose.Schema({ date: Date, status: String }, { _id: false });

const schema = new mongoose.Schema(
  {
    studentName: { type: String, required: true, trim: true, maxlength: 100 },
    section: { type: String, required: true, trim: true, maxlength: 50 },
    subjectName: { type: String, required: true, trim: true, maxlength: 100 },
    attendance: [entry],
  },
  { versionKey: false } // the existing documents have no __v
);

// The 3rd argument pins the collection; without it Mongoose would use "attendances".
const Attendance =
  mongoose.models.Attendance || mongoose.model('Attendance', schema, 'daily_attendance');

// Dates are stored as UTC midnight, like the existing documents. Rejects "2026-02-30".
function toDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (req.method !== 'GET') {
    // shortcut: one shared key and no rate limit; move to real logins if more than one teacher uses this.
    if (!process.env.WRITE_KEY) {
      return res.status(503).json({ error: 'Writes are off: set WRITE_KEY on the server' });
    }
    if (req.headers['x-api-key'] !== process.env.WRITE_KEY) {
      return res.status(401).json({ error: 'Wrong or missing teacher key' });
    }
  }

  try {
    await connectToDatabase();

    if (req.method === 'GET') {
      // shortcut: no pagination, fine for a class roster; add limit/skip past a few thousand rows.
      const rows = await Attendance.find().sort({ section: 1, studentName: 1 }).lean();
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
      const { studentName, section, subjectName } = req.body || {};
      const doc = new Attendance({ studentName, section, subjectName });
      await doc.validate();
      const { studentName: n, section: s, subjectName: j } = doc;
      if (await Attendance.exists({ studentName: n, section: s, subjectName: j })) {
        return res.status(409).json({ error: 'That student is already listed for this section and subject' });
      }
      await doc.save();
      return res.status(201).json(doc);
    }

    // PATCH /api?id=<_id> with { "date": "YYYY-MM-DD", "status": "present" | "late" | "absent" }
    // sets that student's status for the day (status defaults to "present"). Safe to repeat.
    const { date, status = 'present' } = req.body || {};
    const day = toDay(date);
    const id = req.query.id;
    if (!day || !STATUSES.includes(status) || !mongoose.isObjectIdOrHexString(id)) {
      return res.status(400).json({
        error: 'Need ?id=<student id>, a date like 2026-10-08 and a status of present, late or absent',
      });
    }
    const after = { returnDocument: 'after' };
    const setStatus = () =>
      Attendance.findOneAndUpdate(
        { _id: id, 'attendance.date': day },
        { $set: { 'attendance.$.status': status } },
        after
      ).lean();
    const addDay = () =>
      Attendance.findOneAndUpdate(
        { _id: id, 'attendance.date': { $ne: day } },
        { $push: { attendance: { date: day, status } } },
        after
      ).lean();
    // The last setStatus covers another request adding the same day between the first two calls.
    const updated = (await setStatus()) || (await addDay()) || (await setStatus());
    return updated
      ? res.status(200).json(updated)
      : res.status(404).json({ error: 'Student not found' });
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: 'Database error' });
  }
};
