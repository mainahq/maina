export interface CacheKeyInput {
	task: string;
	files?: string[];
	promptHash?: string;
	model?: string;
	extra?: string;
}

export function hashContent(content: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(content);
	return hasher.digest("hex");
}

export async function hashFile(path: string): Promise<string> {
	try {
		const file = Bun.file(path);
		const exists = await file.exists();
		if (!exists) {
			return "";
		}
		const content = await file.text();
		return hashContent(content);
	} catch {
		return "";
	}
}

export async function hashFiles(paths: string[]): Promise<string> {
	if (paths.length === 0) {
		return "";
	}
	const sorted = [...paths].sort();
	const hashes = await Promise.all(sorted.map((p) => hashFile(p)));
	const combined = hashes.join("");
	return hashContent(combined);
}

export async function buildCacheKey(input: CacheKeyInput): Promise<string> {
	const { task, files, promptHash = "", model = "", extra = "" } = input;
	const filesHash = files && files.length > 0 ? await hashFiles(files) : "";
	const combined = `${task}:${promptHash}:${model}:${filesHash}:${extra}`;
	return hashContent(combined);
}
