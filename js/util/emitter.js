/**
 * A named-event emitter.
 *
 * The whole app is wired this way: nothing reaches into another view's DOM. The
 * rack listens for pours and repaints; the header listens for moveCountChanged
 * and progressChanged. Input travels the other way as events too, so a view can
 * be dropped in on its own with a different controller behind it.
 *
 * EventTarget would work, but every payload would have to be boxed into a
 * CustomEvent detail. Plain callbacks with real arguments read better.
 */
export class Emitter {
	#listeners = new Map();

	/** Returns a function that removes the listener again. */
	on(name, handler) {
		let handlers = this.#listeners.get(name);
		if (handlers === undefined) {
			handlers = new Set();
			this.#listeners.set(name, handlers);
		}
		handlers.add(handler);
		return () => handlers.delete(handler);
	}

	off(name, handler) {
		this.#listeners.get(name)?.delete(handler);
	}

	emit(name, ...args) {
		const handlers = this.#listeners.get(name);
		if (handlers === undefined) return;
		// Copied so a handler may unsubscribe itself mid-emit.
		for (const handler of [...handlers]) handler(...args);
	}
}
