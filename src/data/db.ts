import "dotenv/config";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import Database from "better-sqlite3";

/**
 * The owner's data store.
 *
 * This is the half of the system that never goes on-chain. Fitness records live
 * here encrypted at the field level, and buyers only ever receive aggregates
 * computed from them (Phase 6.3) — so a buyer who pays for a cohort insight
 * still never sees an individual's data, and neither does anyone reading the
 * ledger.
 */

const ALGORITHM = "aes-256-gcm";
/** 96-bit nonce is the size AES-GCM is specified for. */
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/** Named so a row records *which* key encrypted it, not the key itself. */
export const DEFAULT_KEY_REF = "owner-master-key";

export type QueryStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "paid"
  | "delivered"
  /** Paid, delivered, audited on HCS and rated on the ReputationRegistry. */
  | "completed";

export interface UserRow {
  id: number;
  encrypted_fitness_data: string;
  encryption_key_ref: string;
}

export interface QueryRow {
  id: number;
  buyer_agent_id: string;
  criteria: string;
  price: number;
  status: QueryStatus;
  tx_hash: string | null;
  /** Serial of the HTS receipt NFT minted for this sale, once there is one. */
  receipt_serial: string | null;
  created_at: string;
}

/**
 * Derives the encryption key from `DATA_ENCRYPTION_KEY`.
 *
 * scrypt with a fixed salt keeps the demo reproducible across restarts — a
 * production system would use a per-record salt and a real KMS, which is what
 * `encryption_key_ref` is there to point at.
 */
function deriveKey(keyRef: string): Buffer {
  const secret = process.env.DATA_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "Missing environment variable DATA_ENCRYPTION_KEY — set a passphrase in .env (any string; it never leaves this machine).",
    );
  }
  return scryptSync(secret, keyRef, KEY_LENGTH);
}

/**
 * Encrypts one field.
 *
 * Output is `iv:authTag:ciphertext`, all base64. The tag is what makes this
 * tamper-evident: altering the stored ciphertext makes decryption throw rather
 * than quietly returning wrong data.
 */
export function encryptField(plaintext: string, keyRef: string = DEFAULT_KEY_REF): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(keyRef), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/** Reverses {@link encryptField}. Throws if the value was altered. */
export function decryptField(payload: string, keyRef: string = DEFAULT_KEY_REF): string {
  const [ivPart, tagPart, dataPart] = payload.split(":");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("Malformed encrypted value — expected iv:authTag:ciphertext");
  }

  const authTag = Buffer.from(tagPart, "base64");
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Malformed auth tag (${authTag.length} bytes, expected ${AUTH_TAG_LENGTH})`);
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    deriveKey(keyRef),
    Buffer.from(ivPart, "base64"),
  );
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export const DEFAULT_DB_PATH = process.env.DATA_DB_PATH ?? "fitness-data.db";

/**
 * Opens the database and creates the schema if it is not there yet.
 *
 * Pass `":memory:"` for tests.
 */
export function openDatabase(path: string = DEFAULT_DB_PATH): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      encrypted_fitness_data TEXT NOT NULL,
      encryption_key_ref     TEXT NOT NULL DEFAULT '${DEFAULT_KEY_REF}'
    );

    CREATE TABLE IF NOT EXISTS queries (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_agent_id TEXT    NOT NULL,
      criteria       TEXT    NOT NULL,
      price          REAL    NOT NULL,
      status         TEXT    NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','accepted','declined','paid','delivered','completed')),
      tx_hash        TEXT,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_queries_buyer ON queries (buyer_agent_id);
  `);

  // Migration: receipt_serial arrived after databases already existed, and
  // CREATE TABLE IF NOT EXISTS will not touch an existing table. ALTER is
  // additive, so — unlike the Phase 7.3 CHECK change — nothing is reseeded.
  const columns = db.prepare("PRAGMA table_info(queries)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "receipt_serial")) {
    db.exec("ALTER TABLE queries ADD COLUMN receipt_serial TEXT");
  }

  return db;
}

/** Records the receipt NFT minted for a completed sale. */
export function setQueryReceipt(
  db: Database.Database,
  id: number,
  receiptSerial: string,
): void {
  db.prepare("UPDATE queries SET receipt_serial = ? WHERE id = ?").run(receiptSerial, id);
}

/** Stores one user's fitness record, encrypting it on the way in. */
export function insertUser(
  db: Database.Database,
  fitnessData: object,
  keyRef: string = DEFAULT_KEY_REF,
): number {
  const result = db
    .prepare(
      "INSERT INTO users (encrypted_fitness_data, encryption_key_ref) VALUES (?, ?)",
    )
    .run(encryptField(JSON.stringify(fitnessData), keyRef), keyRef);
  return Number(result.lastInsertRowid);
}

/** Reads one user's record back, decrypting with the key the row names. */
export function getUserData<T = unknown>(
  db: Database.Database,
  id: number,
): T | undefined {
  const row = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(id) as UserRow | undefined;
  if (!row) return undefined;
  return JSON.parse(
    decryptField(row.encrypted_fitness_data, row.encryption_key_ref),
  ) as T;
}

/** Records a buyer's request so the negotiation leaves an auditable trail. */
export function insertQuery(
  db: Database.Database,
  buyerAgentId: string,
  criteria: object,
  price: number,
  status: QueryStatus = "pending",
): number {
  const result = db
    .prepare(
      "INSERT INTO queries (buyer_agent_id, criteria, price, status) VALUES (?, ?, ?, ?)",
    )
    .run(buyerAgentId, JSON.stringify(criteria), price, status);
  return Number(result.lastInsertRowid);
}

/** Advances a query's status, attaching the payment transaction once there is one. */
export function updateQueryStatus(
  db: Database.Database,
  id: number,
  status: QueryStatus,
  txHash?: string,
): void {
  db.prepare("UPDATE queries SET status = ?, tx_hash = COALESCE(?, tx_hash) WHERE id = ?").run(
    status,
    txHash ?? null,
    id,
  );
}
