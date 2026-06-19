# Dekker Group — Field Service Management Platform

## Quick start (first time)

### 1. Configure environment
Copy the example env file and fill in your values:
```
server\.env.example  →  server\.env
```

Open `server\.env` and set:
- `DATABASE_URL` — your PostgreSQL connection string
- `JWT_SECRET` — any long random string (e.g. 64 random characters)
- `JWT_REFRESH_SECRET` — a different long random string

### 2. Create the database
Open pgAdmin (installed with PostgreSQL) or psql and run:
```sql
CREATE DATABASE dekker_group;
```

### 3. Install dependencies
Open a terminal in this folder and run:
```
npm install
cd server && npm install
cd ../client && npm install
```

### 4. Run database migrations
```
cd server
npm run migrate
```
This creates all tables and sets up job numbers starting at #1001.

### 5. Create your admin user
In psql or pgAdmin, run (replace the values):
```sql
INSERT INTO users (name, email, password_hash, role)
VALUES (
  'Kyle Dekker',
  'kyle@dekkergroup.co.nz',
  '$2a$12$REPLACE_WITH_BCRYPT_HASH',
  'admin'
);
```
> To generate a bcrypt hash, run in the server folder:
> `node -e "const b=require('bcryptjs'); b.hash('yourpassword',12).then(console.log)"`

### 6. Start the app
From the root folder:
```
npm run dev
```
- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

---

## Project structure

```
dekker-group/
├── client/          React frontend (Vite)
│   └── src/
│       ├── components/layout/   Sidebar, shell
│       ├── context/             Auth context
│       ├── lib/                 Axios API client
│       └── pages/               Login, Dashboard, (modules)
├── server/          Node.js + Express backend
│   └── src/
│       ├── controllers/         Request handlers
│       ├── db/                  PostgreSQL pool + migrations
│       ├── middleware/          JWT auth, role checks
│       ├── routes/              API route definitions
│       └── utils/               JWT helpers
└── package.json     Monorepo root
```

## Roles
| Role | Access |
|------|--------|
| `admin` | Full access, user management |
| `office` | Jobs, customers, quoting, invoicing, scheduling |
| `field_tech` | View assigned jobs, timesheets, schedule |

## NZ settings
- GST: 15%
- Currency: NZD (stored in cents as integers)
- Date format: DD/MM/YYYY
- Job numbers start at #1001
