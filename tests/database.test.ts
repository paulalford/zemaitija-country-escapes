import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = new URL(process.env.MIGRATION_DATABASE_URL ?? "");
if (!(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname.endsWith("_dev"))) {
  throw new Error("Database integration tests require the localhost development database");
}
const pool = new Pool({ connectionString: url.toString(), max: 4 });
const ids = { unit: randomUUID(), guest: randomUUID(), booking: randomUUID(), hold: randomUUID(), admin: randomUUID() };
const today = new Date("2027-04-01T12:00:00Z");

async function fixture() {
  await pool.query("INSERT INTO accommodation_units(id,unit_key,capacity,enabled,config_version) VALUES ($1,$2,2,true,1)", [ids.unit, `test-${ids.unit}`]);
  await pool.query("INSERT INTO admin_users(id,external_subject,role,enabled) VALUES ($1,$2,'administrator',true)", [ids.admin, `test-${ids.admin}`]);
  await pool.query("INSERT INTO guests(id,email_ciphertext,preferred_locale,retention_state) VALUES ($1,$2,'en','SYNTHETIC')", [ids.guest, Buffer.from("synthetic")]);
  await pool.query(`INSERT INTO bookings(id,guest_id,unit_id,arrival_date,departure_date,guest_count,status,version,accepted_at,check_in_local_time,property_zone,scheduled_arrival_at,warning_at,balance_due_at,grace_ends_at)
    VALUES ($1,$2,$3,'2027-04-01','2027-04-10',1,'AWAITING_INITIAL_PAYMENT',1,$4,'15:00','Europe/Vilnius',$4,$4,$4,$4)`, [ids.booking, ids.guest, ids.unit, today]);
  await pool.query("INSERT INTO inventory_holds(id,booking_id,state,started_at,version) VALUES ($1,$2,'CREATING',$3,1)", [ids.hold, ids.booking, today]);
}
async function rollbackCase(fn: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try { await client.query("BEGIN"); await fn(client); }
  finally { await client.query("ROLLBACK"); client.release(); }
}
async function claim(c: PoolClient, owner: "hold" | "booking" | "operator_block", ownerId: string, start: string, end: string, released = false) {
  return c.query(`INSERT INTO inventory_claims(id,unit_id,arrival_date,departure_date,${owner}_id,released_at,version)
    VALUES ($1,$2,$3,$4,$5,$6,1)`, [randomUUID(), ids.unit, start, end, ownerId, released ? today : null]);
}

async function seedCapture(c: PoolClient, bookingId: string, obligationId: string) {
  const attempt = randomUUID(), reconciliation = randomUUID(), record = randomUUID();
  await c.query("INSERT INTO payment_attempts(id,booking_id,obligation_id,state,expected_cents,currency,version) VALUES ($1,$2,$3,'SUCCEEDED',10000,'EUR',1)", [attempt, bookingId, obligationId]);
  await c.query("INSERT INTO reconciliation_records(id,payment_attempt_id,checked_at,provider_state,evidence_kind,result) VALUES ($1,$2,$3,'succeeded','SYNTHETIC_TEST','VERIFIED')", [reconciliation, attempt, today]);
  await c.query("INSERT INTO payment_records(id,attempt_id,booking_id,obligation_id,stripe_payment_intent_id,captured_cents,currency,verified_at,allocation_state,reconciliation_id) VALUES ($1,$2,$3,$4,$5,10000,'EUR',$6,'ALLOCATED',$7)", [record, attempt, bookingId, obligationId, `pi_test_${record}`, today, reconciliation]);
  return record;
}

describe("Milestone 5 PostgreSQL baseline", () => {
  beforeAll(fixture);
  afterAll(async () => {
    await pool.query("DELETE FROM payment_allocations WHERE obligation_id IN (SELECT id FROM payment_obligations WHERE booking_id=$1)", [ids.booking]);
    await pool.query("DELETE FROM inventory_claims WHERE unit_id=$1", [ids.unit]);
    await pool.query("DELETE FROM inventory_holds WHERE booking_id=$1", [ids.booking]);
    await pool.query("DELETE FROM payment_obligations WHERE booking_id=$1", [ids.booking]);
    await pool.query("DELETE FROM bookings WHERE id=$1", [ids.booking]);
    await pool.query("DELETE FROM guests WHERE id=$1", [ids.guest]);
    await pool.query("DELETE FROM admin_users WHERE id=$1", [ids.admin]);
    await pool.query("DELETE FROM accommodation_units WHERE id=$1", [ids.unit]);
    await pool.end();
  });

  it("has 28 model tables, foreign keys and the single inventory exclusion", async () => {
    const tables = await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
    expect(tables.rows[0].n).toBe(28);
    const constraints = await pool.query("SELECT contype, conname FROM pg_constraint WHERE conrelid='inventory_claims'::regclass");
    expect(constraints.rows.filter((r) => r.contype === "x").map((r) => r.conname)).toEqual(["inventory_claims_no_overlap"]);
    expect(constraints.rows.some((r) => r.contype === "f")).toBe(true);
    expect(constraints.rows.some((r) => r.contype === "c")).toBe(true);
    const essential = await pool.query("SELECT conname FROM pg_constraint WHERE conname IN ('price_snapshots_valid','payment_obligations_valid','provider_commands_valid','payment_allocations_budget')");
    expect(essential.rows.map((r) => r.conname).sort()).toEqual(["payment_allocations_budget", "payment_obligations_valid", "price_snapshots_valid", "provider_commands_valid"]);
    const indexes = await pool.query("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname IN ('payment_records_intent_key','provider_commands_due','notification_outbox_idempotency_key')");
    expect(indexes.rows).toHaveLength(3);
  });

  it("allows adjacent half-open ranges and rejects overlap across hold, booking and block", async () => rollbackCase(async (c) => {
    await claim(c, "hold", ids.hold, "2027-04-01", "2027-04-03");
    await claim(c, "booking", ids.booking, "2027-04-03", "2027-04-05");
    const block = randomUUID();
    await c.query("INSERT INTO operator_blocks(id,unit_id,arrival_date,departure_date,reason_code,created_by_admin_id) VALUES ($1,$2,'2027-04-04','2027-04-07','TEST',$3)", [block, ids.unit, ids.admin]);
    await expect(claim(c, "operator_block", block, "2027-04-04", "2027-04-07")).rejects.toMatchObject({ code: "23P01" });
  }));

  it("rejects a booking claim overlapping a hold claim", async () => rollbackCase(async (c) => {
    await claim(c, "hold", ids.hold, "2027-04-01", "2027-04-03");
    await expect(claim(c, "booking", ids.booking, "2027-04-02", "2027-04-04")).rejects.toMatchObject({ code: "23P01" });
  }));

  it("rejects a claim with a missing owner FK", async () => rollbackCase(async (c) => {
    await expect(claim(c, "hold", randomUUID(), "2027-04-01", "2027-04-03")).rejects.toMatchObject({ code: "23503" });
  }));

  it("does not let a released claim block a new claim", async () => rollbackCase(async (c) => {
    await claim(c, "hold", ids.hold, "2027-04-01", "2027-04-03", true);
    await claim(c, "booking", ids.booking, "2027-04-01", "2027-04-03");
  }));

  it("rejects invalid money and missing relational parents", async () => rollbackCase(async (c) => {
    await expect(c.query("INSERT INTO payment_obligations(id,booking_id,kind,amount_cents,due_at,currency) VALUES ($1,$2,'INITIAL',-1,$3,'EUR')", [randomUUID(), ids.booking, today])).rejects.toMatchObject({ code: "23514" });
  }));

  it("rejects direct SQL allocations exceeding an obligation", async () => rollbackCase(async (c) => {
    const obligation = randomUUID();
    await c.query("INSERT INTO payment_obligations(id,booking_id,kind,amount_cents,due_at,currency) VALUES ($1,$2,'INITIAL',100,$3,'EUR')", [obligation, ids.booking, today]);
    const records: string[] = [];
    for (let i = 0; i < 2; i++) {
      const attempt = randomUUID(), reconciliation = randomUUID(), record = randomUUID();
      await c.query("INSERT INTO payment_attempts(id,booking_id,obligation_id,state,expected_cents,currency,version) VALUES ($1,$2,$3,'SUCCEEDED',100,'EUR',1)", [attempt, ids.booking, obligation]);
      await c.query("INSERT INTO reconciliation_records(id,payment_attempt_id,checked_at,provider_state,evidence_kind,result) VALUES ($1,$2,$3,'succeeded','TEST','VERIFIED')", [reconciliation, attempt, today]);
      await c.query("INSERT INTO payment_records(id,attempt_id,booking_id,obligation_id,stripe_payment_intent_id,captured_cents,currency,verified_at,allocation_state,reconciliation_id) VALUES ($1,$2,$3,$4,$5,100,'EUR',$6,'ALLOCATED',$7)", [record, attempt, ids.booking, obligation, `pi_test_${record}`, today, reconciliation]);
      records.push(record);
    }
    await c.query("INSERT INTO payment_allocations(id,payment_record_id,obligation_id,amount_cents) VALUES ($1,$2,$3,60)", [randomUUID(), records[0], obligation]);
    await c.query("INSERT INTO payment_allocations(id,payment_record_id,obligation_id,amount_cents) VALUES ($1,$2,$3,60)", [randomUUID(), records[1], obligation]);
    await expect(c.query("SET CONSTRAINTS ALL IMMEDIATE")).rejects.toMatchObject({ code: "23514" });
  }));

  it("links refund attempts only to refund obligations while payment attempts retain their payment FK", async () => rollbackCase(async (c) => {
    const relationships = await c.query(`SELECT conrelid::regclass::text AS source_table, confrelid::regclass::text AS target_table
      FROM pg_constraint WHERE contype='f' AND conname IN
      ('refund_attempts_obligation_id_refund_obligations_id_fk','refund_attempts_obligation_id_payment_obligations_id_fk','payment_attempts_obligation_id_payment_obligations_id_fk')`);
    expect(relationships.rows).toEqual(expect.arrayContaining([
      { source_table: "refund_attempts", target_table: "refund_obligations" },
      { source_table: "payment_attempts", target_table: "payment_obligations" },
    ]));
    expect(relationships.rows).toHaveLength(2);

    const paymentObligation = randomUUID(), refundObligation = randomUUID();
    await c.query("INSERT INTO payment_obligations(id,booking_id,kind,amount_cents,due_at,currency) VALUES ($1,$2,'INITIAL',10000,$3,'EUR')", [paymentObligation, ids.booking, today]);
    const paymentRecord = await seedCapture(c, ids.booking, paymentObligation);
    await c.query("INSERT INTO refund_obligations(id,booking_id,source_payment_record_id,reason,amount_cents,business_key,currency) VALUES ($1,$2,$3,'SYNTHETIC_TEST',6000,$4,'EUR')", [refundObligation, ids.booking, paymentRecord, `refund-test-${refundObligation}`]);
    await c.query("INSERT INTO refund_attempts(id,obligation_id,payment_record_id,state,requested_cents,version) VALUES ($1,$2,$3,'REQUESTED',6000,1)", [randomUUID(), refundObligation, paymentRecord]);
    await c.query("SAVEPOINT invalid_refund_fk");
    await expect(c.query("INSERT INTO refund_attempts(id,obligation_id,payment_record_id,state,requested_cents,version) VALUES ($1,$2,$3,'REQUESTED',100,1)", [randomUUID(), paymentObligation, paymentRecord])).rejects.toMatchObject({ code: "23503" });
    await c.query("ROLLBACK TO SAVEPOINT invalid_refund_fk");
    await expect(c.query("INSERT INTO payment_attempts(id,booking_id,obligation_id,state,expected_cents,currency,version) VALUES ($1,$2,$3,'FAILED',100,'EUR',1)", [randomUUID(), ids.booking, randomUUID()])).rejects.toMatchObject({ code: "23503" });
  }));

  it("serializes two €60 allocations against one €100 obligation under READ COMMITTED", async () => {
    // Committed synthetic evidence is intentionally retained: payment records are append-only.
    const unit = randomUUID(), guest = randomUUID(), booking = randomUUID(), obligation = randomUUID();
    await pool.query("INSERT INTO accommodation_units(id,unit_key,capacity,enabled,config_version) VALUES ($1,$2,2,true,1)", [unit, `allocation-test-${unit}`]);
    await pool.query("INSERT INTO guests(id,email_ciphertext,preferred_locale,retention_state) VALUES ($1,$2,'en','SYNTHETIC')", [guest, Buffer.from("synthetic")]);
    await pool.query(`INSERT INTO bookings(id,guest_id,unit_id,arrival_date,departure_date,guest_count,status,version,accepted_at,check_in_local_time,property_zone,scheduled_arrival_at,warning_at,balance_due_at,grace_ends_at)
      VALUES ($1,$2,$3,'2027-04-01','2027-04-10',1,'AWAITING_INITIAL_PAYMENT',1,$4,'15:00','Europe/Vilnius',$4,$4,$4,$4)`, [booking, guest, unit, today]);
    await pool.query("INSERT INTO payment_obligations(id,booking_id,kind,amount_cents,due_at,currency) VALUES ($1,$2,'INITIAL',10000,$3,'EUR')", [obligation, booking, today]);
    const setup = await pool.connect();
    let records: string[];
    try {
      await setup.query("BEGIN");
      records = [await seedCapture(setup, booking, obligation), await seedCapture(setup, booking, obligation)];
      await setup.query("COMMIT");
    } catch (error) { await setup.query("ROLLBACK"); throw error; }
    finally { setup.release(); }

    const a = await pool.connect(), b = await pool.connect();
    try {
      await a.query("BEGIN ISOLATION LEVEL READ COMMITTED"); await b.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await a.query("SET LOCAL statement_timeout = '8s'"); await b.query("SET LOCAL statement_timeout = '8s'");
      await a.query("SET LOCAL lock_timeout = '5s'"); await b.query("SET LOCAL lock_timeout = '5s'");
      const bPid = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await a.query("INSERT INTO payment_allocations(id,payment_record_id,obligation_id,amount_cents) VALUES ($1,$2,$3,6000)", [randomUUID(), records[0], obligation]);
      const competing = b.query("INSERT INTO payment_allocations(id,payment_record_id,obligation_id,amount_cents) VALUES ($1,$2,$3,6000)", [randomUUID(), records[1], obligation]).then(() => null, (error: unknown) => error);
      let blocked = false;
      for (let i = 0; i < 40; i++) {
        const status = await pool.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [bPid]);
        if (status.rows[0]?.wait_event_type === "Lock") { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked).toBe(true);
      await a.query("COMMIT");
      const insertError = await competing;
      if (insertError) expect(insertError).toMatchObject({ code: "23514" });
      else await expect(b.query("COMMIT")).rejects.toMatchObject({ code: "23514" });
      const total = await pool.query("SELECT COALESCE(sum(amount_cents),0)::int AS cents, count(*)::int AS n FROM payment_allocations WHERE obligation_id=$1", [obligation]);
      expect(total.rows[0]).toEqual({ cents: 6000, n: 1 });
    } finally {
      await a.query("ROLLBACK").catch(() => {}); await b.query("ROLLBACK").catch(() => {});
      a.release(); b.release();
    }
  });

  it("serializes competing active inventory inserts", async () => {
    const a = await pool.connect(); const b = await pool.connect();
    try {
      await a.query("BEGIN"); await b.query("BEGIN");
      await claim(a, "hold", ids.hold, "2027-04-01", "2027-04-03");
      const competing = claim(b, "booking", ids.booking, "2027-04-02", "2027-04-04");
      await a.query("COMMIT");
      await expect(competing).rejects.toMatchObject({ code: "23P01" });
      await b.query("ROLLBACK");
    } finally { await a.query("ROLLBACK").catch(() => {}); await b.query("ROLLBACK").catch(() => {}); a.release(); b.release(); await pool.query("DELETE FROM inventory_claims WHERE unit_id=$1", [ids.unit]); }
  });
});
