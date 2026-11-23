import { cubicOut } from 'svelte/easing';

/** true when the user asked the OS to minimize motion */
export function reducedMotion(): boolean {
	return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface PopParams {
	duration?: number;
	start?: number;
	y?: number;
}

/**
 * Dialog entrance/exit: fade + slight rise + scale.
 * A single transform interpolation keeps every intermediate frame smooth —
 * no crossfade of separate properties that could look disjointed mid-flight.
 */
export function pop(_node: Element, opts: PopParams = {}) {
	const duration = opts.duration ?? (reducedMotion() ? 0 : 200);
	const start = opts.start ?? 0.96;
	const y = opts.y ?? 10;
	return {
		duration,
		easing: cubicOut,
		css: (t: number) => `opacity: ${t}; transform: translateY(${(1 - t) * y}px) scale(${start + (1 - start) * t});`
	};
}
