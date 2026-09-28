/** A `.pem` file imported `with { type: "text" }`: its contents (#574). */
declare module "*.pem" {
	const text: string;
	export default text;
}
