import Utils from "../Utils";
import CaptureHandlers from "./CaptureHandlers";

const { getInstanceByPath } = Utils;
const Selection = game.GetService("Selection");
const Workspace = game.GetService("Workspace");

const RENDER_ORIGIN = new Vector3(100000, 100000, 100000);
const DEFAULT_PADDING = 1.35;
const DEFAULT_BACKDROP_COLOR = Color3.fromRGB(0, 255, 0);

type CameraPreset = "front" | "isometric" | "top" | "icon";

function getCameraPreset(rawPreset: unknown): CameraPreset {
	const preset = type(rawPreset) === "string" ? (rawPreset as string).lower() : "isometric";
	if (preset === "front" || preset === "top" || preset === "icon") {
		return preset;
	}
	return "isometric";
}

function getBackdropColor(rawColor: unknown): Color3 {
	if (!typeIs(rawColor, "table")) {
		return DEFAULT_BACKDROP_COLOR;
	}

	const values = rawColor as unknown[];
	const r = math.clamp((values[0] as number) ?? 0, 0, 255);
	const g = math.clamp((values[1] as number) ?? 255, 0, 255);
	const b = math.clamp((values[2] as number) ?? 0, 0, 255);
	return Color3.fromRGB(r, g, b);
}

function getCameraDirection(preset: CameraPreset): Vector3 {
	if (preset === "front") {
		return new Vector3(0, 0, 1);
	}
	if (preset === "top") {
		return new Vector3(0.05, 1, 0.05).Unit;
	}
	if (preset === "icon") {
		return new Vector3(-0.7, 0.35, 1).Unit;
	}
	return new Vector3(-1, 0.7, 1).Unit;
}

function collectBaseParts(root: Instance): BasePart[] {
	const parts: BasePart[] = [];
	if (root.IsA("BasePart")) {
		parts.push(root);
	}
	for (const desc of root.GetDescendants()) {
		if (desc.IsA("BasePart")) {
			parts.push(desc);
		}
	}
	return parts;
}

function createRenderableClone(target: Instance, stage: Model): Model | undefined {
	if (target.IsA("Model")) {
		const clone = target.Clone() as Model;
		clone.Parent = stage;
		clone.PivotTo(new CFrame(RENDER_ORIGIN));
		return clone;
	}

	if (target.IsA("BasePart")) {
		const wrapper = new Instance("Model");
		wrapper.Name = target.Name;
		wrapper.Parent = stage;

		const clone = target.Clone() as BasePart;
		clone.Parent = wrapper;
		clone.Position = RENDER_ORIGIN;
		return wrapper;
	}

	return undefined;
}

function styleBaseParts(parts: BasePart[]) {
	for (const part of parts) {
		part.Anchored = true;
		part.CanCollide = false;
		part.CanTouch = false;
		part.CanQuery = false;
		part.CastShadow = false;
	}
}

function createBackdrop(
	parent: Instance,
	focusPosition: Vector3,
	cameraDirection: Vector3,
	radius: number,
	cameraDistance: number,
	backdropColor: Color3,
	fieldOfView: number,
	aspectRatio: number,
) {
	const frustumDistance = cameraDistance + radius + 10;
	const backdropHeight = math.max(radius * 6, 2 * math.tan(math.rad(fieldOfView) / 2) * frustumDistance * 1.2);
	const backdropWidth = math.max(radius * 6, backdropHeight * aspectRatio);

	const backdrop = new Instance("Part");
	backdrop.Name = "_MCPRenderBackdrop";
	backdrop.Anchored = true;
	backdrop.CanCollide = false;
	backdrop.CanTouch = false;
	backdrop.CanQuery = false;
	backdrop.CastShadow = false;
	backdrop.Material = Enum.Material.SmoothPlastic;
	backdrop.Color = backdropColor;
	backdrop.Size = new Vector3(backdropWidth, backdropHeight, 1);
	backdrop.CFrame = CFrame.lookAt(
		focusPosition.sub(cameraDirection.mul(radius + 6)),
		focusPosition,
	);
	backdrop.Parent = parent;

	return backdrop;
}

function renderModelScreenshot(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	if (!instancePath) {
		return { error: "instancePath is required" };
	}

	const target = getInstanceByPath(instancePath);
	if (!target) {
		return { error: `Instance not found: ${instancePath}` };
	}

	if (!target.IsA("Model") && !target.IsA("BasePart")) {
		return { error: "Target instance must be a Model or BasePart" };
	}

	const currentCamera = Workspace.CurrentCamera;
	if (!currentCamera) {
		return { error: "Workspace.CurrentCamera is not available" };
	}

	const cameraPreset = getCameraPreset(requestData.cameraPreset);
	const padding = math.max((requestData.padding as number) ?? DEFAULT_PADDING, 1);
	const backdropColor = getBackdropColor(requestData.backdropColor);
	const previousSelection = Selection.Get();
	const previousCameraType = currentCamera.CameraType;
	const previousCameraCFrame = currentCamera.CFrame;
	const previousCameraFocus = currentCamera.Focus;
	const previousFieldOfView = currentCamera.FieldOfView;
	const previousCameraSubject = currentCamera.CameraSubject;

	let stage: Model | undefined;

	const [ok, result] = pcall(() => {
		stage = new Instance("Model");
		stage.Name = "_MCPRenderStage";
		stage.Parent = Workspace;

		const renderRoot = createRenderableClone(target, stage);
		if (!renderRoot) {
			return { error: "Failed to clone render target" };
		}

		const baseParts = collectBaseParts(renderRoot);
		if (baseParts.size() === 0) {
			return { error: "Target does not contain any BaseParts to render" };
		}

		styleBaseParts(baseParts);

		const [boundingBoxCFrame, boundingBoxSize] = renderRoot.GetBoundingBox();
		const focusPosition = boundingBoxCFrame.Position;
		const radius = math.max(boundingBoxSize.Magnitude / 2, 2);
		const fieldOfView = currentCamera.FieldOfView > 0 ? currentCamera.FieldOfView : 70;
		const aspectRatio = currentCamera.ViewportSize.Y > 0
			? currentCamera.ViewportSize.X / currentCamera.ViewportSize.Y
			: 16 / 9;
		const cameraDirection = getCameraDirection(cameraPreset);
		const cameraDistance = math.max(12, (radius * padding) / math.tan(math.rad(fieldOfView) / 2));

		createBackdrop(
			stage,
			focusPosition,
			cameraDirection,
			radius,
			cameraDistance,
			backdropColor,
			fieldOfView,
			aspectRatio,
		);

		pcall(() => {
			Selection.Set([] as Instance[]);
		});

		currentCamera.CameraType = Enum.CameraType.Scriptable;
		currentCamera.FieldOfView = fieldOfView;
		currentCamera.CFrame = CFrame.lookAt(
			focusPosition.add(cameraDirection.mul(cameraDistance)),
			focusPosition,
		);
		currentCamera.Focus = new CFrame(focusPosition);

		task.wait();
		task.wait(0.15);

		const captureResult = CaptureHandlers.captureScreenshotData() as Record<string, unknown>;
		if (captureResult.error !== undefined) {
			return captureResult;
		}

		captureResult.instancePath = instancePath;
		captureResult.instanceName = target.Name;
		captureResult.cameraPreset = cameraPreset;
		return captureResult;
	});

	pcall(() => {
		currentCamera.CameraType = previousCameraType;
		currentCamera.CFrame = previousCameraCFrame;
		currentCamera.Focus = previousCameraFocus;
		currentCamera.FieldOfView = previousFieldOfView;
		if (previousCameraSubject) {
			currentCamera.CameraSubject = previousCameraSubject;
		}
	});

	pcall(() => {
		Selection.Set(previousSelection);
	});

	if (stage) {
		pcall(() => {
			stage!.Destroy();
		});
	}

	if (!ok) {
		return { error: `Failed to render model screenshot: ${tostring(result)}` };
	}

	return result;
}

export = {
	renderModelScreenshot,
};
