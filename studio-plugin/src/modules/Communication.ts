import { HttpService, MarketplaceService, RunService } from "@rbxts/services";
import State from "./State";
import Utils from "./Utils";
import UI from "./UI";
import QueryHandlers from "./handlers/QueryHandlers";
import PropertyHandlers from "./handlers/PropertyHandlers";
import InstanceHandlers from "./handlers/InstanceHandlers";
import ScriptHandlers from "./handlers/ScriptHandlers";
import MetadataHandlers from "./handlers/MetadataHandlers";
import TestHandlers from "./handlers/TestHandlers";
import BuildHandlers from "./handlers/BuildHandlers";
import AssetHandlers from "./handlers/AssetHandlers";
import CaptureHandlers from "./handlers/CaptureHandlers";
import InputHandlers from "./handlers/InputHandlers";
import RenderHandlers from "./handlers/RenderHandlers";
import { Connection, RequestPayload, PollResponse, StudioMismatchResponse } from "../types";

type Handler = (data: Record<string, unknown>) => unknown;
const STUDIO_INSTANCE_ID = (() => {
	const [ok, debugId] = pcall(() => game.GetDebugId(16));
	if (ok && type(debugId) === "string" && debugId.size() > 0) {
		return debugId;
	}
	return HttpService.GenerateGUID(false);
})();
let cachedPlaceName: string | undefined;
let attemptedPlaceNameLookup = false;

const routeMap: Record<string, Handler> = {

	"/api/file-tree": QueryHandlers.getFileTree,
	"/api/search-files": QueryHandlers.searchFiles,
	"/api/place-info": QueryHandlers.getPlaceInfo,
	"/api/services": QueryHandlers.getServices,
	"/api/search-objects": QueryHandlers.searchObjects,
	"/api/instance-properties": QueryHandlers.getInstanceProperties,
	"/api/instance-children": QueryHandlers.getInstanceChildren,
	"/api/search-by-property": QueryHandlers.searchByProperty,
	"/api/class-info": QueryHandlers.getClassInfo,
	"/api/project-structure": QueryHandlers.getProjectStructure,
	"/api/grep-scripts": QueryHandlers.grepScripts,

	"/api/set-property": PropertyHandlers.setProperty,
	"/api/mass-set-property": PropertyHandlers.massSetProperty,
	"/api/mass-get-property": PropertyHandlers.massGetProperty,
	"/api/set-calculated-property": PropertyHandlers.setCalculatedProperty,
	"/api/set-relative-property": PropertyHandlers.setRelativeProperty,

	"/api/create-object": InstanceHandlers.createObject,
	"/api/mass-create-objects": InstanceHandlers.massCreateObjects,
	"/api/mass-create-objects-with-properties": InstanceHandlers.massCreateObjectsWithProperties,
	"/api/delete-object": InstanceHandlers.deleteObject,
	"/api/smart-duplicate": InstanceHandlers.smartDuplicate,
	"/api/mass-duplicate": InstanceHandlers.massDuplicate,

	"/api/get-script-source": ScriptHandlers.getScriptSource,
	"/api/set-script-source": ScriptHandlers.setScriptSource,
	"/api/edit-script-lines": ScriptHandlers.editScriptLines,
	"/api/insert-script-lines": ScriptHandlers.insertScriptLines,
	"/api/delete-script-lines": ScriptHandlers.deleteScriptLines,

	"/api/get-attribute": MetadataHandlers.getAttribute,
	"/api/set-attribute": MetadataHandlers.setAttribute,
	"/api/get-attributes": MetadataHandlers.getAttributes,
	"/api/delete-attribute": MetadataHandlers.deleteAttribute,
	"/api/get-tags": MetadataHandlers.getTags,
	"/api/add-tag": MetadataHandlers.addTag,
	"/api/remove-tag": MetadataHandlers.removeTag,
	"/api/get-tagged": MetadataHandlers.getTagged,
	"/api/get-selection": MetadataHandlers.getSelection,
	"/api/execute-luau": MetadataHandlers.executeLuau,
	"/api/undo": MetadataHandlers.undo,
	"/api/redo": MetadataHandlers.redo,

	"/api/start-playtest": TestHandlers.startPlaytest,
	"/api/stop-playtest": TestHandlers.stopPlaytest,
	"/api/get-playtest-output": TestHandlers.getPlaytestOutput,
	"/api/character-navigation": TestHandlers.characterNavigation,

	"/api/export-build": BuildHandlers.exportBuild,
	"/api/import-build": BuildHandlers.importBuild,
	"/api/import-scene": BuildHandlers.importScene,
	"/api/search-materials": BuildHandlers.searchMaterials,

	"/api/insert-asset": AssetHandlers.insertAsset,
	"/api/preview-asset": AssetHandlers.previewAsset,

	"/api/capture-screenshot": CaptureHandlers.captureScreenshot,
	"/api/render-model-screenshot": RenderHandlers.renderModelScreenshot,

	"/api/simulate-mouse-input": InputHandlers.simulateMouseInput,
	"/api/simulate-keyboard-input": InputHandlers.simulateKeyboardInput,

	"/api/find-and-replace-in-scripts": ScriptHandlers.findAndReplaceInScripts,
};

function processRequest(request: RequestPayload): unknown {
	const endpoint = request.endpoint;
	const data = request.data ?? {};

	const handler = routeMap[endpoint];
	if (handler) {
		return handler(data as Record<string, unknown>);
	} else {
		return { error: `Unknown endpoint: ${endpoint}` };
	}
}

function getStudioIdentityPayload() {
	const placeId = tostring(game.PlaceId);

	if (!attemptedPlaceNameLookup) {
		attemptedPlaceNameLookup = true;

		if (game.PlaceId > 0) {
			const [ok, productInfo] = pcall(() => MarketplaceService.GetProductInfo(game.PlaceId));
			if (ok && type(productInfo.Name) === "string" && productInfo.Name.size() > 0) {
				cachedPlaceName = productInfo.Name;
			}
		}
	}

	return {
		studioInstanceId: STUDIO_INSTANCE_ID,
		placeId,
		placeName: cachedPlaceName ?? placeId,
	};
}

function getPollUrl(conn: Connection): string {
	const identity = getStudioIdentityPayload();
	const queryParts = [
		`studioInstanceId=${HttpService.UrlEncode(identity.studioInstanceId)}`,
		`placeId=${HttpService.UrlEncode(identity.placeId)}`,
	];
	if (identity.placeName !== undefined) {
		queryParts.push(`placeName=${HttpService.UrlEncode(identity.placeName)}`);
	}
	const query = queryParts.join("&");
	return `${conn.serverUrl}/poll?${query}`;
}

function sendResponse(conn: Connection, requestId: string, responseData: unknown) {
	const identity = getStudioIdentityPayload();
	pcall(() => {
		HttpService.RequestAsync({
			Url: `${conn.serverUrl}/response`,
			Method: "POST",
			Headers: { "Content-Type": "application/json" },
			Body: HttpService.JSONEncode({
				requestId,
				response: responseData,
				studioInstanceId: identity.studioInstanceId,
				placeId: identity.placeId,
				placeName: identity.placeName,
			}),
		});
	});
}

function parseMismatchResponse(body: string): StudioMismatchResponse | undefined {
	const [ok, parsed] = pcall(() => HttpService.JSONDecode(body) as StudioMismatchResponse);
	if (ok) return parsed;
	return undefined;
}

function applyStudioMismatchState(connIndex: number, body: string) {
	const conn = State.getConnection(connIndex);
	if (!conn) return;

	conn.lastHttpOk = true;
	const mismatch = parseMismatchResponse(body);
	const expectedPlace = mismatch?.expected?.placeName ?? mismatch?.expected?.placeId ?? "another Studio instance";
	const gotPlace = mismatch?.got?.placeName ?? mismatch?.got?.placeId ?? game.Name;

	if (connIndex === State.getActiveTabIndex()) {
		const el = UI.getElements();
		el.statusLabel.Text = "Connected to different Studio instance";
		el.statusLabel.TextColor3 = Color3.fromRGB(245, 158, 11);
		el.statusIndicator.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
		el.statusPulse.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
		el.statusText.Text = "MISMATCH";
		el.detailStatusLabel.Text = `Expected: ${expectedPlace}  Got: ${gotPlace}`;
		el.detailStatusLabel.TextColor3 = Color3.fromRGB(245, 158, 11);
		el.step1Dot.BackgroundColor3 = Color3.fromRGB(34, 197, 94);
		el.step1Label.Text = "HTTP server (OK)";
		el.step2Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
		el.step2Label.Text = "MCP bridge (instance mismatch)";
		el.step3Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
		el.step3Label.Text = "Commands (blocked)";
		el.troubleshootLabel.Text = "This bridge is bound to another Studio instance. Use the correct port for this project.";
		el.troubleshootLabel.Visible = true;
		conn.mcpWaitStartTime = undefined;
		UI.stopPulseAnimation();
	}
}

function getConnectionStatus(connIndex: number): string {
	const conn = State.getConnection(connIndex);
	if (!conn || !conn.isActive) return "disconnected";
	if (conn.consecutiveFailures >= conn.maxFailuresBeforeError) return "error";
	if (conn.lastHttpOk) return "connected";
	return "connecting";
}

function pollForRequests(connIndex: number) {
	const conn = State.getConnection(connIndex);
	if (!conn || !conn.isActive) return;
	if (conn.isPolling) return;

	conn.isPolling = true;

	const [success, result] = pcall(() => {
		return HttpService.RequestAsync({
			Url: getPollUrl(conn),
			Method: "GET",
			Headers: { "Content-Type": "application/json" },
		});
	});

	conn.isPolling = false;

	const ui = UI.getElements();
	UI.updateTabDot(connIndex);

	if (success && result.StatusCode === 409) {
		applyStudioMismatchState(connIndex, result.Body);
	} else if (success && (result.Success || result.StatusCode === 503)) {
		conn.consecutiveFailures = 0;
		conn.currentRetryDelay = 0.5;
		conn.lastSuccessfulConnection = tick();

		const data = HttpService.JSONDecode(result.Body) as PollResponse;
		const mcpConnected = data.mcpConnected === true;
		const isProxying = data.connectionMode === "proxying";
		const rawProxyInstanceCount = data.proxyInstanceCount;
		const proxyInstanceCount = math.max(1, math.floor(tonumber(rawProxyInstanceCount) ?? 1));
		const proxyInstanceLabel = proxyInstanceCount === 1 ? "1 instance" : `${proxyInstanceCount} instances`;
		conn.lastHttpOk = true;

		if (connIndex === State.getActiveTabIndex()) {
			const el = ui;
			el.step1Dot.BackgroundColor3 = Color3.fromRGB(34, 197, 94);
			el.step1Label.Text = "HTTP server (OK)";

			if (mcpConnected) {
				el.statusLabel.Text = "Connected";
				el.statusLabel.TextColor3 = Color3.fromRGB(34, 197, 94);
				el.statusIndicator.BackgroundColor3 = Color3.fromRGB(34, 197, 94);
				el.statusPulse.BackgroundColor3 = Color3.fromRGB(34, 197, 94);
				el.statusText.Text = "ONLINE";
				el.detailStatusLabel.Text = "HTTP: OK  MCP: OK";
				el.detailStatusLabel.TextColor3 = Color3.fromRGB(34, 197, 94);
				el.step2Dot.BackgroundColor3 = Color3.fromRGB(34, 197, 94);
				el.step2Label.Text = isProxying ? `MCP bridge (proxying ${proxyInstanceLabel})` : "MCP bridge (OK)";
				el.step3Dot.BackgroundColor3 = Color3.fromRGB(34, 197, 94);
				el.step3Label.Text = "Commands (OK)";
				conn.mcpWaitStartTime = undefined;
				el.troubleshootLabel.Visible = false;
				UI.stopPulseAnimation();
			} else if (!mcpConnected) {
				el.statusLabel.Text = "Waiting for MCP server";
				el.statusLabel.TextColor3 = Color3.fromRGB(245, 158, 11);
				el.statusIndicator.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
				el.statusPulse.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
				el.statusText.Text = "WAITING";
				el.detailStatusLabel.Text = "HTTP: OK  MCP: ...";
				el.detailStatusLabel.TextColor3 = Color3.fromRGB(245, 158, 11);
				el.step2Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
				el.step2Label.Text = "MCP bridge (waiting...)";
				el.step3Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
				el.step3Label.Text = "Commands (waiting...)";
				if (conn.mcpWaitStartTime === undefined) {
					conn.mcpWaitStartTime = tick();
				}
				const elapsed = tick() - (conn.mcpWaitStartTime ?? tick());
				el.troubleshootLabel.Visible = elapsed > 8;
				if (elapsed > 3 && elapsed % 5 < conn.pollInterval) {
					task.spawn(() => {
						const discovered = discoverPort();
						if (discovered !== undefined && discovered !== conn.port) {
							conn.port = discovered;
							conn.serverUrl = `http://localhost:${discovered}`;
							if (connIndex === State.getActiveTabIndex()) {
								UI.getElements().urlInput.Text = conn.serverUrl;
							}
						}
					});
				}
				UI.startPulseAnimation();
			}
		}

		if (data.request && mcpConnected) {
			task.spawn(() => {
				const [ok, response] = pcall(() => processRequest(data.request!));
				if (ok) {
					sendResponse(conn, data.requestId!, response);
				} else {
					sendResponse(conn, data.requestId!, { error: tostring(response) });
				}
			});
		}
	} else if (conn.isActive) {
		conn.consecutiveFailures++;

		if (conn.consecutiveFailures > 1) {
			conn.currentRetryDelay = math.min(
				conn.currentRetryDelay * conn.retryBackoffMultiplier,
				conn.maxRetryDelay,
			);
		}

		if (conn.consecutiveFailures === 5 || conn.consecutiveFailures % 20 === 0) {
			task.spawn(() => {
				const discovered = discoverPort();
				if (discovered !== undefined && discovered !== conn.port) {
					conn.port = discovered;
					conn.serverUrl = `http://localhost:${discovered}`;
					conn.consecutiveFailures = 0;
					conn.currentRetryDelay = 0.5;
					if (connIndex === State.getActiveTabIndex()) {
						UI.getElements().urlInput.Text = conn.serverUrl;
					}
				}
			});
		}

		if (connIndex === State.getActiveTabIndex()) {
			const el = ui;
			if (conn.consecutiveFailures >= conn.maxFailuresBeforeError) {
				el.statusLabel.Text = "Server unavailable";
				el.statusLabel.TextColor3 = Color3.fromRGB(239, 68, 68);
				el.statusIndicator.BackgroundColor3 = Color3.fromRGB(239, 68, 68);
				el.statusPulse.BackgroundColor3 = Color3.fromRGB(239, 68, 68);
				el.statusText.Text = "ERROR";
				el.detailStatusLabel.Text = "HTTP: X  MCP: X";
				el.detailStatusLabel.TextColor3 = Color3.fromRGB(239, 68, 68);
				el.step1Dot.BackgroundColor3 = Color3.fromRGB(239, 68, 68);
				el.step1Label.Text = "HTTP server (error)";
				el.step2Dot.BackgroundColor3 = Color3.fromRGB(239, 68, 68);
				el.step2Label.Text = "MCP bridge (error)";
				el.step3Dot.BackgroundColor3 = Color3.fromRGB(239, 68, 68);
				el.step3Label.Text = "Commands (error)";
				conn.mcpWaitStartTime = undefined;
				el.troubleshootLabel.Visible = false;
				UI.stopPulseAnimation();
			} else if (conn.consecutiveFailures > 5) {
				const waitTime = math.ceil(conn.currentRetryDelay);
				el.statusLabel.Text = `Retrying (${waitTime}s)`;
				el.statusLabel.TextColor3 = Color3.fromRGB(245, 158, 11);
				el.statusIndicator.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
				el.statusPulse.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
				el.statusText.Text = "RETRY";
				el.detailStatusLabel.Text = "HTTP: ...  MCP: ...";
				el.detailStatusLabel.TextColor3 = Color3.fromRGB(245, 158, 11);
				el.step1Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
				el.step1Label.Text = "HTTP server (retrying...)";
				el.step2Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
				el.step2Label.Text = "MCP bridge (retrying...)";
				el.step3Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
				el.step3Label.Text = "Commands (retrying...)";
				conn.mcpWaitStartTime = undefined;
				el.troubleshootLabel.Visible = false;
				UI.startPulseAnimation();
			} else if (conn.consecutiveFailures > 1) {
				el.statusLabel.Text = `Connecting (attempt ${conn.consecutiveFailures})`;
				el.statusLabel.TextColor3 = Color3.fromRGB(245, 158, 11);
				el.statusIndicator.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
				el.statusPulse.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
				el.statusText.Text = "CONNECTING";
				el.detailStatusLabel.Text = "HTTP: ...  MCP: ...";
				el.detailStatusLabel.TextColor3 = Color3.fromRGB(245, 158, 11);
				el.step1Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
				el.step1Label.Text = "HTTP server (connecting...)";
				el.step2Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
				el.step2Label.Text = "MCP bridge (connecting...)";
				el.step3Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
				el.step3Label.Text = "Commands (connecting...)";
				conn.mcpWaitStartTime = undefined;
				el.troubleshootLabel.Visible = false;
				UI.startPulseAnimation();
			}
		}
	}
}

function discoverPort(): number | undefined {
	let firstActivePort: number | undefined;
	for (let offset = 0; offset < 5; offset++) {
		const port = State.BASE_PORT + offset;
		const [success, result] = pcall(() => {
			return HttpService.RequestAsync({
				Url: `http://localhost:${port}/status`,
				Method: "GET",
				Headers: { "Content-Type": "application/json" },
			});
		});

		if (success && result.Success) {
			const [ok, data] = pcall(() =>
				HttpService.JSONDecode(result.Body) as { mcpServerActive: boolean; pluginConnected: boolean },
			);
			if (ok && data.mcpServerActive) {
				if (!data.pluginConnected) return port;
				if (firstActivePort === undefined) firstActivePort = port;
			}
		}
	}
	return firstActivePort;
}

function findActiveConnectionIndexByServerUrl(serverUrl: string, excludeIndex: number): number | undefined {
	for (let i = 0; i < State.getConnections().size(); i++) {
		if (i === excludeIndex) continue;
		const other = State.getConnections()[i];
		if (other && other.isActive && other.serverUrl === serverUrl) {
			return i;
		}
	}
	return undefined;
}

function applyDuplicateConnectionState(connIndex: number, duplicateIndex: number, serverUrl: string) {
	if (connIndex !== State.getActiveTabIndex()) return;

	const el = UI.getElements();
	el.statusLabel.Text = "Bridge already active in another tab";
	el.statusLabel.TextColor3 = Color3.fromRGB(245, 158, 11);
	el.statusIndicator.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
	el.statusPulse.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
	el.statusText.Text = "DUPLICATE";
	el.detailStatusLabel.Text = `URL: ${serverUrl}`;
	el.detailStatusLabel.TextColor3 = Color3.fromRGB(245, 158, 11);
	el.step1Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
	el.step1Label.Text = "HTTP server (duplicate tab)";
	el.step2Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
	el.step2Label.Text = "MCP bridge (already active)";
	el.step3Dot.BackgroundColor3 = Color3.fromRGB(245, 158, 11);
	el.step3Label.Text = "Commands (blocked)";
	el.troubleshootLabel.Text = `This bridge is already active in tab ${duplicateIndex + 1}. Use a different port for concurrent workflows.`;
	el.troubleshootLabel.Visible = true;
	UI.stopPulseAnimation();
}

function activatePlugin(connIndex?: number) {
	const idx = connIndex ?? State.getActiveTabIndex();
	const conn = State.getConnection(idx);
	if (!conn) return;

	const ui = UI.getElements();

	if (idx === State.getActiveTabIndex()) {
		conn.serverUrl = ui.urlInput.Text;
		const [portStr] = conn.serverUrl.match(":(%d+)$");
		if (portStr) conn.port = tonumber(portStr) ?? conn.port;
	}

	const duplicateConnectionIndex = findActiveConnectionIndexByServerUrl(conn.serverUrl, idx);
	if (duplicateConnectionIndex !== undefined) {
		conn.isActive = false;
		conn.consecutiveFailures = 0;
		conn.currentRetryDelay = 0.5;
		applyDuplicateConnectionState(idx, duplicateConnectionIndex, conn.serverUrl);
		UI.updateTabDot(idx);
		return;
	}

	conn.isActive = true;
	conn.consecutiveFailures = 0;
	conn.currentRetryDelay = 0.5;
	ui.screenGui.Enabled = true;
	if (idx === State.getActiveTabIndex()) {
		UI.updateUIState();
	}
	UI.updateTabDot(idx);

	const defaultBaseUrl = `http://localhost:${State.BASE_PORT}`;
	const shouldAutoDiscover = conn.serverUrl === defaultBaseUrl;
	task.spawn(() => {
		if (shouldAutoDiscover) {
			const discoveredPort = discoverPort();
			if (discoveredPort !== undefined) {
				const discoveredUrl = `http://localhost:${discoveredPort}`;
				const duplicateIndex = findActiveConnectionIndexByServerUrl(discoveredUrl, idx);
				if (duplicateIndex === undefined) {
					conn.port = discoveredPort;
					conn.serverUrl = discoveredUrl;
					if (idx === State.getActiveTabIndex()) {
						ui.urlInput.Text = conn.serverUrl;
					}
				}
			}
		}

		if (!conn.heartbeatConnection) {
			conn.heartbeatConnection = RunService.Heartbeat.Connect(() => {
				const now = tick();
				const currentInterval = conn.consecutiveFailures > 5 ? conn.currentRetryDelay : conn.pollInterval;
				if (now - conn.lastPoll > currentInterval) {
					conn.lastPoll = now;
					pollForRequests(idx);
				}
			});
		}

		pcall(() => {
			const identity = getStudioIdentityPayload();
			HttpService.RequestAsync({
				Url: `${conn.serverUrl}/ready`,
				Method: "POST",
				Headers: { "Content-Type": "application/json" },
				Body: HttpService.JSONEncode({
					pluginReady: true,
					timestamp: tick(),
					studioInstanceId: identity.studioInstanceId,
					placeId: identity.placeId,
					placeName: identity.placeName,
				}),
			});
		});
	});
}

function deactivatePlugin(connIndex?: number) {
	const idx = connIndex ?? State.getActiveTabIndex();
	const conn = State.getConnection(idx);
	if (!conn) return;

	conn.isActive = false;

	if (idx === State.getActiveTabIndex()) UI.updateUIState();
	UI.updateTabDot(idx);

	pcall(() => {
		const identity = getStudioIdentityPayload();
		HttpService.RequestAsync({
			Url: `${conn.serverUrl}/disconnect`,
			Method: "POST",
			Headers: { "Content-Type": "application/json" },
			Body: HttpService.JSONEncode({
				timestamp: tick(),
				studioInstanceId: identity.studioInstanceId,
				placeId: identity.placeId,
				placeName: identity.placeName,
			}),
		});
	});

	if (conn.heartbeatConnection) {
		conn.heartbeatConnection.Disconnect();
		conn.heartbeatConnection = undefined;
	}

	conn.consecutiveFailures = 0;
	conn.currentRetryDelay = 0.5;
}

function deactivateAll() {
	for (let i = 0; i < State.getConnections().size(); i++) {
		if (State.getConnections()[i].isActive) {
			deactivatePlugin(i);
		}
	}
}

function checkForUpdates() {
	task.spawn(() => {
		const [success, result] = pcall(() => {
			return HttpService.RequestAsync({
				Url: "https://registry.npmjs.org/robloxstudio-mcp/latest",
				Method: "GET",
				Headers: { Accept: "application/json" },
			});
		});

		if (success && result.Success) {
			const [ok, data] = pcall(() => HttpService.JSONDecode(result.Body) as { version?: string });
			if (ok && data?.version) {
				const latestVersion = data.version;
				if (Utils.compareVersions(State.CURRENT_VERSION, latestVersion) < 0) {
					const ui = UI.getElements();
					ui.updateBannerText.Text = `v${latestVersion} available - github.com/boshyxd/robloxstudio-mcp`;
					ui.updateBanner.Visible = true;
					ui.contentFrame.Position = new UDim2(0, 8, 0, 92);
					ui.contentFrame.Size = new UDim2(1, -16, 1, -100);
				}
			}
		}
	});
}

export = {
	getConnectionStatus,
	activatePlugin,
	deactivatePlugin,
	deactivateAll,
	checkForUpdates,
};
