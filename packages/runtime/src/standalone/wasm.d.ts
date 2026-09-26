/** A `.wasm` file imported `with { type: "file" }`: its path (#526). */
declare module "*.wasm" {
	const path: string;
	export default path;
}
