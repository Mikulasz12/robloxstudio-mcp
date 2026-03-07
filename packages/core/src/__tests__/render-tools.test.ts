import fs from 'fs';
import os from 'os';
import path from 'path';
import { BridgeService } from '../bridge-service.js';
import { getAllTools } from '../tools/definitions.js';
import { RobloxStudioTools } from '../tools/index.js';

describe('Render tools', () => {
  test('tool definitions include object and legacy render tools', () => {
    const toolNames = getAllTools().map(tool => tool.name);

    expect(toolNames).toContain('render_object_screenshot');
    expect(toolNames).toContain('render_model_screenshot');
    expect(toolNames).toContain('batch_render_objects');
    expect(toolNames).toContain('batch_render_models');
  });

  test('renderObjectScreenshot writes a PNG when savePath is provided', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'robloxstudio-mcp-render-'));
    const savePath = path.join(tempDir, 'model.png');

    try {
      const renderPromise = tools.renderObjectScreenshot('game.Workspace.TestMeshPart', {
        cameraPreset: 'front',
        savePath,
        returnImage: false,
      });

      const pendingRequest = bridge.getPendingRequest();
      expect(pendingRequest?.request.endpoint).toBe('/api/render-model-screenshot');
      expect(pendingRequest?.request.data).toMatchObject({
        instancePath: 'game.Workspace.TestMeshPart',
        cameraPreset: 'front',
      });

      bridge.resolveRequest(pendingRequest!.requestId, {
        success: true,
        width: 1,
        height: 1,
        data: Buffer.from([255, 0, 0, 255]).toString('base64'),
        instancePath: 'game.Workspace.TestMeshPart',
        instanceName: 'TestMeshPart',
        cameraPreset: 'front',
      });

      const result = await renderPromise;
      expect(fs.existsSync(savePath)).toBe(true);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const payload = JSON.parse((result.content[0] as { text: string }).text);
      expect(payload).toMatchObject({
        success: true,
        instancePath: 'game.Workspace.TestMeshPart',
        instanceName: 'TestMeshPart',
        cameraPreset: 'front',
        savedPath: savePath,
        width: 1,
        height: 1,
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('renderObjectScreenshot writes a PNG into outputDir when provided', async () => {
    const bridge = new BridgeService();
    const tools = new RobloxStudioTools(bridge);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'robloxstudio-mcp-render-dir-'));
    const expectedPath = path.join(tempDir, 'TestMeshPart.png');

    try {
      const renderPromise = tools.renderObjectScreenshot('game.Workspace.TestMeshPart', {
        cameraPreset: 'icon',
        outputDir: tempDir,
        returnImage: false,
      });

      const pendingRequest = bridge.getPendingRequest();
      expect(pendingRequest?.request.endpoint).toBe('/api/render-model-screenshot');

      bridge.resolveRequest(pendingRequest!.requestId, {
        success: true,
        width: 1,
        height: 1,
        data: Buffer.from([0, 255, 0, 255]).toString('base64'),
        instancePath: 'game.Workspace.TestMeshPart',
        instanceName: 'TestMeshPart',
        cameraPreset: 'icon',
      });

      const result = await renderPromise;
      expect(fs.existsSync(expectedPath)).toBe(true);

      const payload = JSON.parse((result.content[0] as { text: string }).text);
      expect(payload).toMatchObject({
        success: true,
        instanceName: 'TestMeshPart',
        cameraPreset: 'icon',
        savedPath: expectedPath,
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
