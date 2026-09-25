/**
 * Markdown templates are imported with `with { type: "text" }` so bunup
 * inlines them into the bundled CLI; the import yields the file contents.
 */
declare module "*.md" {
	const text: string;
	export default text;
}
