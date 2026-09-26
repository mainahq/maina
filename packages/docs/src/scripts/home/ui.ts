/**
 * Page-wide wiring for `/` (#360): the motion switch, analytics events,
 * copy buttons and the install tabs. Motion runs only when the visitor has
 * not asked for reduced motion and has not paused it.
 */

const PAUSED = "motion-paused";

const reducedMotion = (): boolean =>
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Whether animation may run right now. */
export const motionAllowed = (): boolean =>
	!reducedMotion() && !document.documentElement.classList.contains(PAUSED);

/** Pushes an event to the page's dataLayer, when a tag manager reads one. */
export function track(
	event: string,
	props: Record<string, unknown> = {},
): void {
	const w = window as unknown as { dataLayer?: unknown[] };
	w.dataLayer = w.dataLayer ?? [];
	w.dataLayer.push({ event, ...props });
}

function initMotionToggle(): void {
	const btn = document.getElementById("motion");
	if (!btn) return;
	if (reducedMotion()) {
		btn.hidden = true;
		return;
	}
	btn.addEventListener("click", () => {
		const paused = document.documentElement.classList.toggle(PAUSED);
		btn.setAttribute("aria-pressed", String(paused));
		btn.textContent = paused
			? (btn.dataset.play ?? "Play motion")
			: (btn.dataset.pause ?? "Pause motion");
		track("motion_toggle", { paused });
	});
}

function initCopyButtons(): void {
	for (const btn of document.querySelectorAll<HTMLButtonElement>(
		"[data-copy]",
	)) {
		btn.addEventListener("click", () => {
			const src = document.getElementById(btn.dataset.copy ?? "");
			const text = src?.textContent?.trim() ?? "";
			const label = btn.textContent;
			const done = (msg: string) => {
				btn.textContent = msg;
				window.setTimeout(() => {
					btn.textContent = label;
				}, 1600);
			};
			const select = () => {
				if (!src) return;
				const range = document.createRange();
				range.selectNodeContents(src);
				const sel = window.getSelection();
				sel?.removeAllRanges();
				sel?.addRange(range);
				done("Selected");
			};
			track("copy_command", { id: btn.dataset.copy });
			if (navigator.clipboard?.writeText) {
				navigator.clipboard
					.writeText(text)
					.then(() => done(btn.dataset.copied ?? "Copied"), select);
			} else {
				select();
			}
		});
	}
}

function initTabs(): void {
	const tabs = [
		...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
	];
	const select = (tab: HTMLButtonElement) => {
		for (const t of tabs) {
			const on = t === tab;
			t.setAttribute("aria-selected", String(on));
			t.tabIndex = on ? 0 : -1;
			const panel = document.getElementById(
				t.getAttribute("aria-controls") ?? "",
			);
			if (panel) panel.hidden = !on;
		}
	};
	tabs.forEach((tab, i) => {
		tab.addEventListener("click", () => select(tab));
		tab.addEventListener("keydown", (e) => {
			const step =
				e.key === "ArrowDown" || e.key === "ArrowRight"
					? 1
					: e.key === "ArrowUp" || e.key === "ArrowLeft"
						? -1
						: 0;
			if (step === 0) return;
			e.preventDefault();
			const next = tabs[(i + step + tabs.length) % tabs.length];
			if (next) {
				select(next);
				next.focus();
			}
		});
	});
}

function initEvents(): void {
	document.addEventListener("click", (e) => {
		const el = (e.target as Element | null)?.closest<HTMLElement>(
			"[data-event]",
		);
		if (el?.dataset.event) track(el.dataset.event);
	});
}

export function initUi(): void {
	initMotionToggle();
	initCopyButtons();
	initTabs();
	initEvents();
}
