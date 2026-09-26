/**
 * Hero motion (#360): the race panel and the flow canvas. Both stop when
 * motion is paused or reduced, when the hero is off screen or the tab is
 * hidden. The race's verdicts come from the engine; its timings are the
 * illustrative ones in `landing.ts`.
 */

import { motionAllowed } from "./ui";

type RaceItem = Readonly<{
	agent: string;
	action: string;
	verdict: "allow" | "ask" | "deny";
	slow: number;
	fast: number;
}>;

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function q<T extends HTMLElement>(root: ParentNode, sel: string): T | null {
	return root.querySelector<T>(sel);
}

function initRace(heroVisible: () => boolean): void {
	const race = document.querySelector<HTMLElement>("[data-race]");
	if (!race) return;
	const items = JSON.parse(race.dataset.race ?? "[]") as readonly RaceItem[];
	const el = {
		agent: q(race, "[data-race-agent]"),
		action: q(race, "[data-race-action]"),
		slowT: q(race, "[data-race-slow-t]"),
		fastT: q(race, "[data-race-fast-t]"),
		slowFill: q(race, "[data-race-slow-fill]"),
		fastFill: q(race, "[data-race-fast-fill]"),
		status: q(race, "[data-race-status]"),
		stamp: q(race, "[data-race-stamp]"),
	};
	const thinking = race.dataset.thinking ?? "…";
	const HOLD = 1400;
	const LEAD = 250;
	let idx = 0;
	let item = items[0];
	let start = 0;
	let stamped = false;
	const reset = (now: number) => {
		item = items[idx++ % items.length];
		start = now;
		stamped = false;
		if (!item) return;
		if (el.agent) el.agent.textContent = `${item.agent} ›`;
		if (el.action) el.action.textContent = item.action;
		if (el.status) el.status.textContent = thinking;
		if (el.stamp) {
			el.stamp.className = `stamp v-${item.verdict}`;
			el.stamp.textContent = cap(item.verdict);
			el.stamp.style.opacity = "0";
		}
	};
	const frame = (now: number) => {
		if (item && motionAllowed() && heroVisible() && !document.hidden) {
			const t = now - start - LEAD;
			const fastDur = 140;
			const fastP = Math.min(1, Math.max(0, t / fastDur));
			const slowP = Math.min(1, Math.max(0, t / item.slow));
			if (el.fastFill) el.fastFill.style.width = `${fastP * 100}%`;
			if (el.slowFill) el.slowFill.style.width = `${slowP * 100}%`;
			if (el.fastT)
				el.fastT.textContent = `${Math.round(fastP * item.fast)} ms`;
			if (el.slowT) {
				el.slowT.textContent = `${Math.round(slowP * item.slow).toLocaleString("en-US")} ms`;
			}
			if (fastP >= 1 && !stamped && el.stamp) {
				stamped = true;
				el.stamp.style.opacity = "1";
				el.stamp.classList.add("pop");
			}
			if (slowP >= 1 && el.status) el.status.textContent = `→ ${item.verdict}`;
			if (t > item.slow + HOLD) reset(now);
		} else {
			// Paused: keep the clock still so the race resumes where it was.
			start += 16;
		}
		window.requestAnimationFrame(frame);
	};
	if (!motionAllowed()) return;
	reset(performance.now());
	window.requestAnimationFrame(frame);
}

type Particle = {
	x: number;
	y: number;
	v: number;
	kind: "allow" | "ask" | "deny";
	decided: boolean;
	life: number;
};

const COLORS = {
	allow: "#8FD19E",
	ask: "#F5C400",
	deny: "#E8543A",
	idle: "#6A5A50",
} as const;

function initFlow(heroVisible: () => boolean): void {
	const canvas = document.getElementById("flow") as HTMLCanvasElement | null;
	const ctx = canvas?.getContext("2d");
	if (!canvas || !ctx) return;
	let w = 0;
	let h = 0;
	let parts: Particle[] = [];
	const size = () => {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		w = canvas.clientWidth;
		h = canvas.clientHeight;
		canvas.width = w * dpr;
		canvas.height = h * dpr;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	};
	const gateX = () => w * (w < 700 ? 0.72 : 0.6);
	const spawn = () => {
		const r = Math.random();
		parts.push({
			x: -20,
			y: 30 + Math.random() * Math.max(0, h - 60),
			v: 1.1 + Math.random() * 1.6,
			kind: r < 0.7 ? "allow" : r < 0.88 ? "ask" : "deny",
			decided: false,
			life: 1,
		});
	};
	const draw = () => {
		ctx.clearRect(0, 0, w, h);
		const gx = gateX();
		ctx.strokeStyle = "rgba(243,242,238,.22)";
		ctx.setLineDash([3, 7]);
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(gx, 0);
		ctx.lineTo(gx, h);
		ctx.stroke();
		ctx.setLineDash([]);
		for (const p of parts) {
			ctx.globalAlpha = Math.max(0, p.life);
			ctx.strokeStyle = p.decided ? COLORS[p.kind] : COLORS.idle;
			ctx.lineWidth = 2;
			ctx.lineCap = "round";
			ctx.beginPath();
			ctx.moveTo(p.x - p.v * 9 * Math.sign(p.v || 1), p.y);
			ctx.lineTo(p.x, p.y);
			ctx.stroke();
			if (p.kind === "ask" && p.decided) {
				ctx.beginPath();
				ctx.arc(p.x, p.y, 4 + (1 - p.life) * 10, 0, Math.PI * 2);
				ctx.stroke();
			}
		}
		ctx.globalAlpha = 1;
	};
	const step = () => {
		const gx = gateX();
		for (const p of parts) {
			if (!p.decided && p.x >= gx) {
				p.decided = true;
				if (p.kind === "ask") p.v = 0;
				if (p.kind === "deny") p.v = -p.v * 0.8;
			}
			p.x += p.v;
			if (p.decided && p.kind !== "allow") {
				p.life -= p.kind === "ask" ? 0.012 : 0.018;
			}
		}
		parts = parts.filter((p) => p.life > 0 && p.x < w + 30 && p.x > -40);
	};
	size();
	window.addEventListener("resize", size);
	if (!motionAllowed()) {
		// One still frame: particles on both sides of the gate.
		for (let i = 0; i < 60; i++) {
			spawn();
			const p = parts[parts.length - 1];
			if (!p) continue;
			p.x = Math.random() * w;
			if (p.x > gateX()) {
				p.decided = true;
				if (p.kind === "deny") p.x = gateX() - Math.random() * 60;
				if (p.kind === "ask") p.x = gateX();
			}
		}
		draw();
		return;
	}
	for (let i = 0; i < 200; i++) {
		if (i % 5 === 0) spawn();
		step();
	}
	let tick = 0;
	const loop = () => {
		if (heroVisible() && !document.hidden && motionAllowed()) {
			if (++tick % 5 === 0) spawn();
			step();
			draw();
		}
		window.requestAnimationFrame(loop);
	};
	loop();
}

export function initMotion(): void {
	const hero = document.querySelector(".hero");
	let visible = true;
	if (hero) {
		new IntersectionObserver((entries) => {
			for (const e of entries) visible = e.isIntersecting;
		}).observe(hero);
	}
	const heroVisible = () => visible;
	initRace(heroVisible);
	initFlow(heroVisible);
}
