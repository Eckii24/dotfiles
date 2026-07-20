export const TASK_SENTINEL_PREFIX = " [herdr:task-sentinel:v1:";

export type TaskDelivery = { prompt: string; marker: string };

/** Creates one literal, newline-free prompt plus its native-session correlation marker. */
export function createTaskDelivery(task: string, turnId: string): TaskDelivery {
	if (!task || /[\r\n]/.test(task)) throw new TaskDeliveryError("Task must be non-empty and newline-free.");
	if (!turnId || /[\r\n]/.test(turnId)) throw new TaskDeliveryError("turnId must be non-empty and newline-free.");
	const marker = `${TASK_SENTINEL_PREFIX}${turnId}]`;
	const prompt = `${task}${marker}`;
	if (/\r|\n/.test(marker) || !prompt.endsWith(marker) || count(prompt, marker) !== 1) throw new TaskDeliveryError("Task delivery marker must occur once as the terminal suffix.");
	return { prompt, marker };
}

export class TaskDeliveryError extends Error { constructor(message: string) { super(message); this.name = "TaskDeliveryError"; } }

function count(text: string, marker: string) { let total = 0; for (let at = text.indexOf(marker); at >= 0; at = text.indexOf(marker, at + marker.length)) total++; return total; }
