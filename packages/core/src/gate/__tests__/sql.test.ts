/**
 * SQL classification: which statements destroy data (`db.destructive`).
 * Strings, quoted identifiers and comments are tokens, so a keyword inside
 * them never counts.
 */

import { describe, expect, test } from "bun:test";
import { analyzeSql, isDestructiveSql } from "../parsers/sql";

describe("isDestructiveSql", () => {
	const destructive = [
		"DROP TABLE users",
		"drop table if exists users cascade;",
		"DROP DATABASE shop",
		"DROP SCHEMA raw CASCADE",
		"TRUNCATE orders",
		"truncate table events restart identity",
		"DELETE FROM users",
		"DELETE FROM users;",
		"delete from ds.events where true",
		"DELETE FROM users WHERE 1=1",
		"UPDATE users SET admin = true",
		"ALTER TABLE users DROP COLUMN email",
		"WITH x AS (SELECT 1) DELETE FROM users",
		"SELECT 1; DROP TABLE users",
		"/* cleanup */ DROP TABLE tmp",
		"-- note\nTRUNCATE audit_log",
		"drop   table   `orders`",
		'DROP TABLE "Users"',
	];
	for (const sql of destructive) {
		test(`destructive: ${JSON.stringify(sql)}`, () => {
			expect(isDestructiveSql(sql)).toBe(true);
		});
	}

	const safe = [
		"SELECT * FROM users",
		"SELECT 'DROP TABLE users'",
		"-- DROP TABLE users\nSELECT 1",
		"/* TRUNCATE x */ SELECT 1",
		"DELETE FROM sessions WHERE expires_at < now()",
		"UPDATE users SET name = 'x' WHERE id = 1",
		"INSERT INTO t VALUES (1)",
		"CREATE TABLE t (id int)",
		'SELECT "drop" FROM t',
		"SHOW TABLES",
		"",
	];
	for (const sql of safe) {
		test(`safe: ${JSON.stringify(sql)}`, () => {
			expect(isDestructiveSql(sql)).toBe(false);
		});
	}
});

describe("analyzeSql", () => {
	test("splits statements and names each verb", () => {
		expect(analyzeSql("SELECT 1; DROP TABLE t; -- x")).toEqual([
			{ verb: "SELECT", destructive: false },
			{ verb: "DROP", destructive: true },
		]);
	});

	test("a semicolon inside a string does not split", () => {
		expect(analyzeSql("SELECT 'a; DROP TABLE t'")).toEqual([
			{ verb: "SELECT", destructive: false },
		]);
	});
});
