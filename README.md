# Student API backend

Vercel serverless API for the lab attendance system. It reads and writes
`LabAttendanceDB_Longakit.daily_attendance` on MongoDB Atlas. The database name is set in
`db.js`, so it does not depend on what the connection string contains.

Each document is one student: `{ studentName, section, subjectName, attendance: [{ date, status }] }`.
`date` is the class day at UTC midnight and `status` is `present`, `late` or `absent`.

## Environment variables

Set these in Vercel: Project, Settings, Environment Variables. Redeploy afterwards.

| Name | Value |
| --- | --- |
| `MONGODB_URI` | Atlas connection string (`mongodb+srv://...`) for a database user that can read and write `LabAttendanceDB_Longakit` |
| `WRITE_KEY` | A password of your choice. The teacher types it into the frontend to add students and record attendance. If it is not set, the API is read-only. |

## Endpoints (`/api`)

| Method | What it does | Needs `x-api-key`? |
| --- | --- | --- |
| `GET` | All students with their attendance | No |
| `POST` | Add a student: `{ "studentName", "section", "subjectName" }` | Yes |
| `PATCH ?id=<_id>` | Set a day's status: `{ "date": "YYYY-MM-DD", "status": "present" }`. Status is `present`, `late` or `absent` (default `present`). Safe to repeat. | Yes |

Run the tests with `npm test` (no database needed).

Live API: https://student-api-backend-sooty.vercel.app/api
