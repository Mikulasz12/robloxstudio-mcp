const CaptureService = game.GetService("CaptureService");
const AssetService = game.GetService("AssetService");

const MAX_TILE_SIZE = 1024;
const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64(buf: buffer): string {
	const len = buffer.len(buf);
	const parts: string[] = [];
	let i = 0;

	while (i + 2 < len) {
		const b0 = buffer.readu8(buf, i);
		const b1 = buffer.readu8(buf, i + 1);
		const b2 = buffer.readu8(buf, i + 2);
		const triplet = bit32.lshift(b0, 16) + bit32.lshift(b1, 8) + b2;
		parts.push(
			string.sub(BASE64_CHARS, bit32.rshift(triplet, 18) + 1, bit32.rshift(triplet, 18) + 1) +
			string.sub(BASE64_CHARS, bit32.band(bit32.rshift(triplet, 12), 63) + 1, bit32.band(bit32.rshift(triplet, 12), 63) + 1) +
			string.sub(BASE64_CHARS, bit32.band(bit32.rshift(triplet, 6), 63) + 1, bit32.band(bit32.rshift(triplet, 6), 63) + 1) +
			string.sub(BASE64_CHARS, bit32.band(triplet, 63) + 1, bit32.band(triplet, 63) + 1),
		);
		i += 3;
	}

	const remaining = len - i;
	if (remaining === 2) {
		const b0 = buffer.readu8(buf, i);
		const b1 = buffer.readu8(buf, i + 1);
		const triplet = bit32.lshift(b0, 16) + bit32.lshift(b1, 8);
		parts.push(
			string.sub(BASE64_CHARS, bit32.rshift(triplet, 18) + 1, bit32.rshift(triplet, 18) + 1) +
			string.sub(BASE64_CHARS, bit32.band(bit32.rshift(triplet, 12), 63) + 1, bit32.band(bit32.rshift(triplet, 12), 63) + 1) +
			string.sub(BASE64_CHARS, bit32.band(bit32.rshift(triplet, 6), 63) + 1, bit32.band(bit32.rshift(triplet, 6), 63) + 1) +
			"=",
		);
	} else if (remaining === 1) {
		const b0 = buffer.readu8(buf, i);
		const triplet = bit32.lshift(b0, 16);
		parts.push(
			string.sub(BASE64_CHARS, bit32.rshift(triplet, 18) + 1, bit32.rshift(triplet, 18) + 1) +
			string.sub(BASE64_CHARS, bit32.band(bit32.rshift(triplet, 12), 63) + 1, bit32.band(bit32.rshift(triplet, 12), 63) + 1) +
			"==",
		);
	}

	return parts.join("");
}

function readPixelsTiled(img: EditableImage, w: number, h: number): buffer {
	const BYTES_PER_PIXEL = 4;
	const fullBuf = buffer.create(w * h * BYTES_PER_PIXEL);
	const fullRowBytes = w * BYTES_PER_PIXEL;

	for (let ty = 0; ty < h; ty += MAX_TILE_SIZE) {
		const tileH = math.min(MAX_TILE_SIZE, h - ty);
		for (let tx = 0; tx < w; tx += MAX_TILE_SIZE) {
			const tileW = math.min(MAX_TILE_SIZE, w - tx);
			const tileBuf = img.ReadPixelsBuffer(new Vector2(tx, ty), new Vector2(tileW, tileH));
			const tileRowBytes = tileW * BYTES_PER_PIXEL;
			for (let row = 0; row < tileH; row++) {
				buffer.copy(fullBuf, (ty + row) * fullRowBytes + tx * BYTES_PER_PIXEL, tileBuf, row * tileRowBytes, tileRowBytes);
			}
		}
	}
	return fullBuf;
}

function captureScreenshotData(): unknown {
	let contentId: string | undefined;

	CaptureService.CaptureScreenshot((id: string) => {
		contentId = id;
	});

	const startTime = tick();
	while (contentId === undefined) {
		if (tick() - startTime > 10) {
			return {
				error: "Screenshot capture timed out. Ensure the Studio viewport is visible and you are in Edit mode (not Play mode). Known Roblox bug: capture may fail if viewport renders a solid color.",
			};
		}
		task.wait(0.1);
	}

	const [editableOk, editableResult] = pcall(() => {
		return AssetService.CreateEditableImageAsync(Content.fromUri(contentId!));
	});

	if (!editableOk) {
		return {
			error: `Failed to create EditableImage from screenshot. Enable EditableImage API: Game Settings > Security > 'Allow Mesh / Image APIs'. (${tostring(editableResult)})`,
		};
	}

	const editableImage = editableResult as EditableImage;
	const imgSize = editableImage.Size;
	const w = math.floor(imgSize.X);
	const h = math.floor(imgSize.Y);

	const [readOk, pixelBuffer] = pcall(() => {
		return readPixelsTiled(editableImage, w, h);
	});

	editableImage.Destroy();

	if (!readOk) {
		return { error: `Failed to read pixel data: ${tostring(pixelBuffer)}` };
	}

	const base64Data = encodeBase64(pixelBuffer as buffer);

	return { success: true, width: w, height: h, data: base64Data };
}

function captureScreenshot(): unknown {
	return captureScreenshotData();
}

export = {
	captureScreenshotData,
	captureScreenshot,
};
