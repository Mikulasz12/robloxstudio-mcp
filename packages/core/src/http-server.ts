import express from 'express';
import cors from 'cors';
import http from 'http';
import { RobloxStudioTools } from './tools/index.js';
import { BridgeService } from './bridge-service.js';

type ToolHandler = (tools: RobloxStudioTools, body: any) => Promise<any>;
type ConnectionMode = 'direct' | 'proxying';

interface StudioIdentity {
  studioInstanceId?: string;
  placeId?: string;
  placeName?: string;
}

interface BoundStudioIdentity {
  studioInstanceId: string;
  placeId?: string;
  placeName?: string;
}

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  get_file_tree: (tools, body) => tools.getFileTree(body.path),
  search_files: (tools, body) => tools.searchFiles(body.query, body.searchType),
  get_place_info: (tools) => tools.getPlaceInfo(),
  get_services: (tools, body) => tools.getServices(body.serviceName),
  search_objects: (tools, body) => tools.searchObjects(body.query, body.searchType, body.propertyName),
  get_instance_properties: (tools, body) => tools.getInstanceProperties(body.instancePath, body.excludeSource),
  get_instance_children: (tools, body) => tools.getInstanceChildren(body.instancePath),
  search_by_property: (tools, body) => tools.searchByProperty(body.propertyName, body.propertyValue),
  get_class_info: (tools, body) => tools.getClassInfo(body.className),
  get_project_structure: (tools, body) => tools.getProjectStructure(body.path, body.maxDepth, body.scriptsOnly),
  set_property: (tools, body) => tools.setProperty(body.instancePath, body.propertyName, body.propertyValue),
  mass_set_property: (tools, body) => tools.massSetProperty(body.paths, body.propertyName, body.propertyValue),
  mass_get_property: (tools, body) => tools.massGetProperty(body.paths, body.propertyName),
  create_object: (tools, body) => tools.createObject(body.className, body.parent, body.name, body.properties),
  create_object_with_properties: (tools, body) => tools.createObject(body.className, body.parent, body.name, body.properties),
  mass_create_objects: (tools, body) => tools.massCreateObjects(body.objects),
  mass_create_objects_with_properties: (tools, body) => tools.massCreateObjects(body.objects),
  delete_object: (tools, body) => tools.deleteObject(body.instancePath),
  smart_duplicate: (tools, body) => tools.smartDuplicate(body.instancePath, body.count, body.options),
  mass_duplicate: (tools, body) => tools.massDuplicate(body.duplications),
  set_calculated_property: (tools, body) => tools.setCalculatedProperty(body.paths, body.propertyName, body.formula, body.variables),
  set_relative_property: (tools, body) => tools.setRelativeProperty(body.paths, body.propertyName, body.operation, body.value, body.component),
  grep_scripts: (tools, body) => tools.grepScripts(body.pattern, {
    caseSensitive: body.caseSensitive,
    usePattern: body.usePattern,
    contextLines: body.contextLines,
    maxResults: body.maxResults,
    maxResultsPerScript: body.maxResultsPerScript,
    filesOnly: body.filesOnly,
    path: body.path,
    classFilter: body.classFilter,
  }),
  get_script_source: (tools, body) => tools.getScriptSource(body.instancePath, body.startLine, body.endLine),
  set_script_source: (tools, body) => tools.setScriptSource(body.instancePath, body.source),
  edit_script_lines: (tools, body) => tools.editScriptLines(body.instancePath, body.startLine, body.endLine, body.newContent),
  insert_script_lines: (tools, body) => tools.insertScriptLines(body.instancePath, body.afterLine, body.newContent),
  delete_script_lines: (tools, body) => tools.deleteScriptLines(body.instancePath, body.startLine, body.endLine),
  get_attribute: (tools, body) => tools.getAttribute(body.instancePath, body.attributeName),
  set_attribute: (tools, body) => tools.setAttribute(body.instancePath, body.attributeName, body.attributeValue, body.valueType),
  get_attributes: (tools, body) => tools.getAttributes(body.instancePath),
  delete_attribute: (tools, body) => tools.deleteAttribute(body.instancePath, body.attributeName),
  get_tags: (tools, body) => tools.getTags(body.instancePath),
  add_tag: (tools, body) => tools.addTag(body.instancePath, body.tagName),
  remove_tag: (tools, body) => tools.removeTag(body.instancePath, body.tagName),
  get_tagged: (tools, body) => tools.getTagged(body.tagName),
  get_selection: (tools) => tools.getSelection(),
  execute_luau: (tools, body) => tools.executeLuau(body.code),
  start_playtest: (tools, body) => tools.startPlaytest(body.mode),
  stop_playtest: (tools) => tools.stopPlaytest(),
  get_playtest_output: (tools) => tools.getPlaytestOutput(),
  export_build: (tools, body) => tools.exportBuild(body.instancePath, body.outputId, body.style),
  create_build: (tools, body) => tools.createBuild(body.id, body.style, body.palette, body.parts, body.bounds),
  generate_build: (tools, body) => tools.generateBuild(body.id, body.style, body.palette, body.code, body.seed),
  import_build: (tools, body) => tools.importBuild(body.buildData, body.targetPath, body.position),
  list_library: (tools, body) => tools.listLibrary(body.style),
  search_materials: (tools, body) => tools.searchMaterials(body.query, body.maxResults),
  get_build: (tools, body) => tools.getBuild(body.id),
  import_scene: (tools, body) => tools.importScene(body.sceneData, body.targetPath),
  undo: (tools) => tools.undo(),
  redo: (tools) => tools.redo(),
  search_assets: (tools, body) => tools.searchAssets(body.assetType, body.query, body.maxResults, body.sortBy, body.verifiedCreatorsOnly),
  get_asset_details: (tools, body) => tools.getAssetDetails(body.assetId),
  get_asset_thumbnail: (tools, body) => tools.getAssetThumbnail(body.assetId, body.size),
  insert_asset: (tools, body) => tools.insertAsset(body.assetId, body.parentPath, body.position),
  preview_asset: (tools, body) => tools.previewAsset(body.assetId, body.includeProperties, body.maxDepth),
  render_object_screenshot: (tools, body) => tools.renderObjectScreenshot(body.instancePath, {
    cameraPreset: body.cameraPreset,
    padding: body.padding,
    backdropColor: body.backdropColor,
    savePath: body.savePath,
    outputDir: body.outputDir,
    fileName: body.fileName,
    returnImage: body.returnImage,
  }),
  render_model_screenshot: (tools, body) => tools.renderModelScreenshot(body.instancePath, {
    cameraPreset: body.cameraPreset,
    padding: body.padding,
    backdropColor: body.backdropColor,
    savePath: body.savePath,
    outputDir: body.outputDir,
    fileName: body.fileName,
    returnImage: body.returnImage,
  }),
  batch_render_objects: (tools, body) => tools.batchRenderObjects(body.parentPath, body.outputDir, {
    recursive: body.recursive,
    cameraPreset: body.cameraPreset,
    padding: body.padding,
    backdropColor: body.backdropColor,
  }),
  batch_render_models: (tools, body) => tools.batchRenderModels(body.parentPath, body.outputDir, {
    recursive: body.recursive,
    cameraPreset: body.cameraPreset,
    padding: body.padding,
    backdropColor: body.backdropColor,
  }),
  capture_screenshot: (tools) => tools.captureScreenshot(),
};

export function createHttpServer(tools: RobloxStudioTools, bridge: BridgeService, allowedTools?: Set<string>) {
  const app = express();
  const LEGACY_PROXY_INSTANCE_ID = '__legacy_proxy_instance__';
  let pluginConnected = false;
  let mcpServerActive = false;
  let lastMCPActivity = 0;
  let mcpServerStartTime = 0;
  let lastPluginActivity = 0;
  let connectionMode: ConnectionMode = 'direct';
  let boundStudioIdentity: BoundStudioIdentity | undefined;
  const proxyInstanceIds = new Set<string>();

  const setMCPServerActive = (active: boolean) => {
    mcpServerActive = active;
    if (active) {
      mcpServerStartTime = Date.now();
      lastMCPActivity = Date.now();
    } else {
      mcpServerStartTime = 0;
      lastMCPActivity = 0;
    }
  };

  const trackMCPActivity = () => {
    if (mcpServerActive) {
      lastMCPActivity = Date.now();
    }
  };

  const isMCPServerActive = () => {
    if (!mcpServerActive) return false;
    const now = Date.now();
    const mcpRecent = (now - lastMCPActivity) < 15000;
    return mcpRecent;
  };

  const isPluginConnected = () => {
    return pluginConnected && (Date.now() - lastPluginActivity < 10000);
  };

  const getConnectionMode = () => connectionMode;

  const setConnectionMode = (mode: ConnectionMode) => {
    connectionMode = mode;
    if (mode === 'direct') {
      proxyInstanceIds.clear();
    }
  };

  const getProxyInstanceIdValue = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const trackProxyInstance = (proxyInstanceId?: string) => {
    if (connectionMode !== 'proxying') {
      return;
    }
    proxyInstanceIds.add(proxyInstanceId ?? LEGACY_PROXY_INSTANCE_ID);
  };

  const getProxyInstanceCount = () => {
    if (connectionMode !== 'proxying') {
      return 0;
    }
    return proxyInstanceIds.size > 0 ? proxyInstanceIds.size : 1;
  };

  const getIdentityValue = (value: unknown): string | undefined => {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const extractStudioIdentity = (req: express.Request): StudioIdentity => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const query = (req.query ?? {}) as Record<string, unknown>;

    const studioInstanceId = getIdentityValue(body.studioInstanceId) ?? getIdentityValue(query.studioInstanceId);
    const placeId = getIdentityValue(body.placeId) ?? getIdentityValue(query.placeId);
    const placeName = getIdentityValue(body.placeName) ?? getIdentityValue(query.placeName);

    return {
      studioInstanceId,
      placeId,
      placeName,
    };
  };

  const sendStudioMismatch = (res: express.Response, incoming: StudioIdentity) => {
    res.status(409).json({
      error: 'Studio instance mismatch',
      code: 'STUDIO_INSTANCE_MISMATCH',
      message: 'This MCP bridge is already bound to another Studio instance. Connect this plugin to the matching bridge port.',
      expected: boundStudioIdentity,
      got: incoming,
    });
  };

  const enforceStudioBinding = (req: express.Request, res: express.Response): StudioIdentity | null => {
    const incomingIdentity = extractStudioIdentity(req);
    const incomingId = incomingIdentity.studioInstanceId;

    // Keep backwards compatibility for plugin builds that do not send identity.
    if (!incomingId) {
      return incomingIdentity;
    }

    if (!boundStudioIdentity) {
      boundStudioIdentity = {
        studioInstanceId: incomingId,
        placeId: incomingIdentity.placeId,
        placeName: incomingIdentity.placeName,
      };
      return incomingIdentity;
    }

    if (boundStudioIdentity.studioInstanceId !== incomingId) {
      sendStudioMismatch(res, incomingIdentity);
      return null;
    }

    if (incomingIdentity.placeId) boundStudioIdentity.placeId = incomingIdentity.placeId;
    if (incomingIdentity.placeName) boundStudioIdentity.placeName = incomingIdentity.placeName;
    return incomingIdentity;
  };

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));


  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'robloxstudio-mcp',
      pluginConnected,
      mcpServerActive: isMCPServerActive(),
      connectionMode: getConnectionMode(),
      proxyInstanceCount: getProxyInstanceCount(),
      uptime: mcpServerActive ? Date.now() - mcpServerStartTime : 0
    });
  });


  app.post('/ready', (req, res) => {
    const identity = enforceStudioBinding(req, res);
    if (!identity) return;

    pluginConnected = true;
    lastPluginActivity = Date.now();
    res.json({ success: true });
  });


  app.post('/disconnect', (req, res) => {
    const identity = enforceStudioBinding(req, res);
    if (!identity) return;

    pluginConnected = false;
    if (!identity.studioInstanceId || boundStudioIdentity?.studioInstanceId === identity.studioInstanceId) {
      boundStudioIdentity = undefined;
    }
    bridge.clearAllPendingRequests();
    res.json({ success: true });
  });


  app.get('/status', (req, res) => {
    res.json({
      pluginConnected: isPluginConnected(),
      mcpServerActive: isMCPServerActive(),
      lastMCPActivity,
      connectionMode: getConnectionMode(),
      proxyInstanceCount: getProxyInstanceCount(),
      boundStudio: boundStudioIdentity ?? null,
      uptime: mcpServerActive ? Date.now() - mcpServerStartTime : 0
    });
  });


  app.get('/poll', (req, res) => {
    const identity = enforceStudioBinding(req, res);
    if (!identity) return;

    if (!pluginConnected) {
      pluginConnected = true;
    }
    lastPluginActivity = Date.now();

    if (!isMCPServerActive()) {
      res.status(503).json({
        error: 'MCP server not connected',
        pluginConnected: true,
        mcpConnected: false,
        connectionMode: getConnectionMode(),
        proxyInstanceCount: getProxyInstanceCount(),
        request: null
      });
      return;
    }

    const pendingRequest = bridge.getPendingRequest();
    if (pendingRequest) {
      res.json({
        request: pendingRequest.request,
        requestId: pendingRequest.requestId,
        mcpConnected: true,
        pluginConnected: true,
        connectionMode: getConnectionMode(),
        proxyInstanceCount: getProxyInstanceCount()
      });
    } else {
      res.json({
        request: null,
        mcpConnected: true,
        pluginConnected: true,
        connectionMode: getConnectionMode(),
        proxyInstanceCount: getProxyInstanceCount()
      });
    }
  });


  app.post('/response', (req, res) => {
    const identity = enforceStudioBinding(req, res);
    if (!identity) return;

    const { requestId, response, error } = req.body;

    if (error) {
      bridge.rejectRequest(requestId, error);
    } else {
      bridge.resolveRequest(requestId, response);
    }

    res.json({ success: true });
  });


  app.post('/proxy', async (req, res) => {
    const identity = enforceStudioBinding(req, res);
    if (!identity) return;

    const { endpoint, data, proxyInstanceId: rawProxyInstanceId } = req.body ?? {};
    const proxyInstanceId = getProxyInstanceIdValue(rawProxyInstanceId);

    if (typeof endpoint !== 'string' || endpoint.length === 0) {
      res.status(400).json({ error: 'endpoint is required' });
      return;
    }

    try {
      setConnectionMode('proxying');
      trackProxyInstance(proxyInstanceId);
      trackMCPActivity();
      const response = await bridge.sendRequest(endpoint, data);
      res.json({ response });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === 'Request timeout' ? 504 : 500;
      res.status(status).json({ error: message });
    }
  });


  app.use('/mcp/*', (req, res, next) => {
    trackMCPActivity();
    next();
  });

  // Register /mcp/* routes dynamically based on allowedTools
  for (const [toolName, handler] of Object.entries(TOOL_HANDLERS)) {
    if (allowedTools && !allowedTools.has(toolName)) continue;

    app.post(`/mcp/${toolName}`, async (req, res) => {
      try {
        const result = await handler(tools, req.body);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    });
  }


  (app as any).isPluginConnected = isPluginConnected;
  (app as any).setMCPServerActive = setMCPServerActive;
  (app as any).isMCPServerActive = isMCPServerActive;
  (app as any).trackMCPActivity = trackMCPActivity;
  (app as any).setConnectionMode = setConnectionMode;
  (app as any).getConnectionMode = getConnectionMode;

  return app;
}

/**
 * Attempt to bind an Express app to a port, using an explicit http.Server
 * so that EADDRINUSE errors are properly caught.
 */
export function listenWithRetry(
  app: express.Express,
  host: string,
  startPort: number,
  maxAttempts: number = 5
): Promise<{ server: http.Server; port: number }> {
  return new Promise(async (resolve, reject) => {
    for (let i = 0; i < maxAttempts; i++) {
      const port = startPort + i;
      try {
        const server = await bindPort(app, host, port);
        resolve({ server, port });
        return;
      } catch (err: any) {
        if (err.code === 'EADDRINUSE') {
          console.error(`Port ${port} in use, trying next...`);
          continue;
        }
        reject(err);
        return;
      }
    }
    reject(new Error(`All ports ${startPort}-${startPort + maxAttempts - 1} are in use. Stop some MCP server instances and retry.`));
  });
}

function bindPort(app: express.Express, host: string, port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('error', onError);
      reject(err);
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      resolve(server);
    });
  });
}
