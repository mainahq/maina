/**
 * Error ID — generates short, unique, user-quotable identifiers for errors.
 *
 * IDs are 6-8 chars, base32-encoded (no ambiguous chars O/0/I/l).
 * Same error class + message produces the same ID (deterministic).
 */

// Base32 alphabet without ambiguous chars (O, 0, I, l)
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

/**
 * Generate a short error ID from an error's class name and message.
 * Deterministic: same input → same ID.
 */
export function generateErrorId(error: Error): string {
	const input = `${error.constructor.name}:${error.message}`;
	const hash = djb2Hash(input);
	return `ERR-${encodeBase32(hash, 6)}`;
}

/**
 * Generate error ID from arbitrary string (for non-Error cases).
 */
export function generateErrorIdFromString(message: string): string {
	const hash = djb2Hash(message);
	return `ERR-${encodeBase32(hash, 6)}`;
}

/**
 * Format an error for CLI stderr output with error ID.
 */
export function formatErrorForCli(error: Error): string {
	const id = generateErrorId(error);
	return `Error ${id}. ${error.message}\nReport at github.com/mainahq/maina/issues (include this ID).`;
}

/**
 * Format an error for MCP tool response with error ID.
 */
export function formatErrorForMcp(error: Error): {
	error: string;
	error_id: string;
} {
	return {
		error: error.message,
		error_id: generateErrorId(error),
	};
}

/**
 * DJB2 hash — fast, deterministic string hash.
 * Returns a 32-bit unsigned integer.
 */
function djb2Hash(str: string): number {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
	}
	return hash;
}

/**
 * Encode a number in our safe base32 alphabet.
 */
function encodeBase32(num: number, length: number): string {
	let result = "";
	let n = num;
	for (let i = 0; i < length; i++) {
		result = ALPHABET[n % ALPHABET.length] + result;
		n = Math.floor(n / ALPHABET.length);
	}
	return result;
}
