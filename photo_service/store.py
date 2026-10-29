import contextlib
import secrets
import sqlite3
import time
from pathlib import Path


class Store:
    def __init__(self, data_dir: Path, lease_seconds: int = 180, max_attempts: int = 3):
        data_dir.mkdir(parents=True, exist_ok=True)
        self.db = data_dir / "jobs.sqlite3"
        self.lease_seconds = lease_seconds
        self.max_attempts = max_attempts
        with self.connect() as con:
            con.execute("PRAGMA journal_mode=WAL")
            con.executescript("""
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, prompt TEXT NOT NULL,
                    width INTEGER NOT NULL, height INTEGER NOT NULL, seed INTEGER NOT NULL,
                    reference_path TEXT, output_path TEXT,
                    status TEXT NOT NULL DEFAULT 'queued', error_code TEXT,
                    created_at REAL NOT NULL, updated_at REAL NOT NULL,
                    lease_token TEXT, lease_expires REAL, attempts INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status, created_at);
                CREATE TABLE IF NOT EXISTS worker_status (
                    id INTEGER PRIMARY KEY CHECK(id=1), seen REAL NOT NULL, engine TEXT NOT NULL
                );
            """)

    @contextlib.contextmanager
    def connect(self):
        con = sqlite3.connect(self.db, timeout=15)
        con.row_factory = sqlite3.Row
        try:
            with con:
                yield con
        finally:
            con.close()

    def enqueue(self, job: dict, max_queue: int) -> bool:
        now = time.time()
        with self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            count = con.execute(
                "SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running')"
            ).fetchone()[0]
            if count >= max_queue:
                return False
            con.execute(
                """INSERT INTO jobs
                (id,prompt,width,height,seed,reference_path,created_at,updated_at)
                VALUES (:id,:prompt,:width,:height,:seed,:reference_path,:now,:now)""",
                {**job, "now": now},
            )
        return True

    def get(self, job_id: str) -> dict | None:
        with self.connect() as con:
            row = con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            return dict(row) if row else None

    def claim(self, engine: str) -> dict | None:
        now = time.time()
        with self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            con.execute(
                "INSERT OR REPLACE INTO worker_status VALUES (1,?,?)", (now, engine)
            )
            con.execute(
                """UPDATE jobs SET status=CASE WHEN attempts>=? THEN 'failed' ELSE 'queued' END,
                error_code=CASE WHEN attempts>=? THEN 'worker_lost' ELSE NULL END,
                lease_token=NULL, lease_expires=NULL, updated_at=?
                WHERE status='running' AND lease_expires<?""",
                (self.max_attempts, self.max_attempts, now, now),
            )
            row = con.execute(
                "SELECT * FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1"
            ).fetchone()
            if row is None:
                return None
            token = secrets.token_urlsafe(32)
            con.execute(
                """UPDATE jobs SET status='running',lease_token=?,lease_expires=?,
                updated_at=?,attempts=attempts+1 WHERE id=?""",
                (token, now + self.lease_seconds, now, row["id"]),
            )
            return {**dict(row), "lease_token": token}

    def lease_valid(self, job_id: str, token: str) -> bool:
        with self.connect() as con:
            return con.execute(
                """SELECT 1 FROM jobs WHERE id=? AND status='running'
                AND lease_token=? AND lease_expires>?""",
                (job_id, token, time.time()),
            ).fetchone() is not None

    def heartbeat(self, job_id: str, token: str) -> bool:
        now = time.time()
        with self.connect() as con:
            updated = con.execute(
                """UPDATE jobs SET lease_expires=?,updated_at=? WHERE id=?
                AND status='running' AND lease_token=? AND lease_expires>?""",
                (now + self.lease_seconds, now, job_id, token, now),
            ).rowcount
            if updated:
                con.execute("UPDATE worker_status SET seen=? WHERE id=1", (now,))
            return bool(updated)

    def finish(self, job_id: str, token: str, *, output_path=None, error_code=None) -> bool:
        now = time.time()
        with self.connect() as con:
            return bool(con.execute(
                """UPDATE jobs SET status=?,output_path=?,error_code=?,updated_at=?,
                lease_token=NULL,lease_expires=NULL WHERE id=? AND status='running'
                AND lease_token=? AND lease_expires>?""",
                ("failed" if error_code else "succeeded", output_path, error_code,
                 now, job_id, token, now),
            ).rowcount)

    def health(self) -> dict:
        with self.connect() as con:
            worker = con.execute("SELECT * FROM worker_status WHERE id=1").fetchone()
            queued = con.execute("SELECT COUNT(*) FROM jobs WHERE status='queued'").fetchone()[0]
        return {
            "status": "ok", "queued": queued,
            "worker_online": bool(worker and worker["seen"] > time.time() - 90),
            "engine": worker["engine"] if worker else None,
        }
