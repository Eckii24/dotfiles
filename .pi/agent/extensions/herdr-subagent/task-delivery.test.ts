import { expect, test } from "bun:test";
import { createTaskDelivery, TaskDeliveryError } from "./task-delivery.js";

test("builds direct one-line prompt with one terminal turn sentinel", () => {
	const delivery = createTaskDelivery("Map API boundaries.", "turn-id");
	expect(delivery).toEqual({
		prompt: "Map API boundaries. [herdr:task-sentinel:v1:turn-id]",
		marker: " [herdr:task-sentinel:v1:turn-id]",
	});
});

test("rejects empty or newline-bearing task and turn ID", () => {
	for (const [task, turnId] of [["", "turn"], ["one\ntwo", "turn"], ["task", "turn\nid"]]) {
		expect(() => createTaskDelivery(task, turnId)).toThrow(TaskDeliveryError);
	}
});
