export type EventListener<TEvent> = (event: TEvent) => void;

export class EventBus<TEvent> {
	private readonly listeners = new Set<EventListener<TEvent>>();

	subscribe(listener: EventListener<TEvent>): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	emit(event: TEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}
