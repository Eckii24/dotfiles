import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { RootRunSnapshot, RunTreeNode, RunTreeRow } from "../run-model.js";
import { SubagentRunStore } from "../run-store.js";
import { buildActiveRunsWidgetLines, resolveWidgetLineWidth } from "./widget.js";

const WIDGET_KEY = "subagent-active-runs";
const MODAL_RESERVATION_KEY = "subagent-modal-reservation";
const DEFAULT_RECENT_LIMIT = 8;

export class SubagentUIController {
	private selectedNodeId: string | undefined;
	private uiContext: ExtensionContext | undefined;
	private widgetSuspensionDepth = 0;
	private modalReservationRows = 0;
	private lastWidgetSignature: string | undefined;
	private readonly unsubscribe: () => void;

	constructor(private readonly store: SubagentRunStore) {
		this.unsubscribe = this.store.subscribe(() => this.refreshWidget());
	}

	attachContext(ctx: ExtensionContext): void {
		this.uiContext = ctx;
		this.refreshModalReservation();
		this.refreshWidget(true);
	}

	dispose(): void {
		this.unsubscribe();
		this.clearModalReservation();
		this.clearWidget();
	}

	clearWidget(): void {
		this.lastWidgetSignature = undefined;
		this.uiContext?.ui.setWidget(WIDGET_KEY, undefined);
	}

	suspendWidget(): void {
		this.widgetSuspensionDepth++;
		if (this.widgetSuspensionDepth === 1) this.clearWidget();
	}

	resumeWidget(): void {
		if (this.widgetSuspensionDepth === 0) return;
		this.widgetSuspensionDepth--;
		if (this.widgetSuspensionDepth === 0) this.refreshWidget(true);
	}

	reserveModalArea(rows: number): void {
		this.modalReservationRows = Math.max(0, rows);
		this.refreshModalReservation();
	}

	clearModalReservation(): void {
		if (this.modalReservationRows === 0 && this.uiContext) {
			this.uiContext.ui.setWidget(MODAL_RESERVATION_KEY, undefined);
			return;
		}
		this.modalReservationRows = 0;
		this.uiContext?.ui.setWidget(MODAL_RESERVATION_KEY, undefined);
	}

	getActiveRuns(): RootRunSnapshot[] {
		return this.store.getActiveRootRuns();
	}

	getRecentRuns(limit?: number): RootRunSnapshot[] {
		return this.store.getRecentRootRuns(limit);
	}

	getRun(runId: string): RootRunSnapshot | undefined {
		return this.store.getRootRun(runId);
	}

	getVisibleForest(limit = DEFAULT_RECENT_LIMIT): RunTreeNode[] {
		return this.store.getVisibleRunForest(limit);
	}

	getVisibleRows(limit = DEFAULT_RECENT_LIMIT): RunTreeRow[] {
		return this.store.getVisibleRunRows(limit);
	}

	getNode(nodeId: string | undefined, limit = DEFAULT_RECENT_LIMIT): RunTreeNode | undefined {
		return nodeId ? this.store.getVisibleRunNode(nodeId, limit) : undefined;
	}

	getAnyNode(nodeId: string | undefined): RunTreeNode | undefined {
		return nodeId ? this.store.getAnyRunNode(nodeId) : undefined;
	}

	subscribe(listener: () => void): () => void {
		return this.store.subscribe(listener);
	}

	getSelectedNodeId(): string | undefined {
		return this.selectedNodeId;
	}

	setSelectedNodeId(nodeId: string | undefined): void {
		this.selectedNodeId = nodeId;
	}

	private refreshWidget(force = false): void {
		if (!this.uiContext?.hasUI || this.widgetSuspensionDepth > 0) return;
		const forest = this.store.getActiveRunForest();
		const lines = buildActiveRunsWidgetLines(forest, this.uiContext.ui.theme, {
			maxWidth: resolveWidgetLineWidth(),
		});
		if (lines.length === 0) {
			if (force || this.lastWidgetSignature !== undefined) this.clearWidget();
			return;
		}
		const signature = lines.join("\n");
		if (!force && signature === this.lastWidgetSignature) return;
		this.lastWidgetSignature = signature;
		this.uiContext.ui.setWidget(WIDGET_KEY, lines);
	}

	private refreshModalReservation(): void {
		if (!this.uiContext?.hasUI) return;
		if (this.modalReservationRows <= 0) {
			this.uiContext.ui.setWidget(MODAL_RESERVATION_KEY, undefined);
			return;
		}
		this.uiContext.ui.setWidget(
			MODAL_RESERVATION_KEY,
			Array.from({ length: this.modalReservationRows }, () => this.uiContext!.ui.theme.fg("dim", " ")),
		);
	}
}
