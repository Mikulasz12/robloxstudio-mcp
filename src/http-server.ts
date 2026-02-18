import express from 'express';
import cors from 'cors';
import { RobloxStudioTools } from './tools/index.js';
import { BridgeService } from './bridge-service.js';

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

export function createHttpServer(tools: RobloxStudioTools, bridge: BridgeService) {
  const app = express();
  type ConnectionMode = 'direct' | 'proxying';
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

    // Keep backwards compatibility for older plugin builds that don't send identity.
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


    bridge.clearAllPendingRequests();
    pluginConnected = true;
    lastPluginActivity = Date.now();
    res.json({ success: true });
  });


  app.post('/disconnect', (req, res) => {
    const identity = enforceStudioBinding(req, res);
    if (!identity) return;

    pluginConnected = false;

    bridge.clearAllPendingRequests();
    if (!identity.studioInstanceId || boundStudioIdentity?.studioInstanceId === identity.studioInstanceId) {
      boundStudioIdentity = undefined;
    }
    res.json({ success: true });
  });


  app.get('/status', (req, res) => {
    res.json({
      pluginConnected: isPluginConnected(),
      mcpServerActive: isMCPServerActive(),
      connectionMode: getConnectionMode(),
      proxyInstanceCount: getProxyInstanceCount(),
      boundStudio: boundStudioIdentity ?? null,
      lastMCPActivity,
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


  app.post('/mcp/get_file_tree', async (req, res) => {
    try {
      const result = await tools.getFileTree(req.body.path);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });


  app.post('/mcp/search_files', async (req, res) => {
    try {
      const result = await tools.searchFiles(req.body.query, req.body.searchType);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });


  app.post('/mcp/get_place_info', async (req, res) => {
    try {
      const result = await tools.getPlaceInfo();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/get_services', async (req, res) => {
    try {
      const result = await tools.getServices(req.body.serviceName);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });


  app.post('/mcp/search_objects', async (req, res) => {
    try {
      const result = await tools.searchObjects(req.body.query, req.body.searchType, req.body.propertyName);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/get_instance_properties', async (req, res) => {
    try {
      const result = await tools.getInstanceProperties(req.body.instancePath);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/get_instance_children', async (req, res) => {
    try {
      const result = await tools.getInstanceChildren(req.body.instancePath);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/search_by_property', async (req, res) => {
    try {
      const result = await tools.searchByProperty(req.body.propertyName, req.body.propertyValue);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/get_class_info', async (req, res) => {
    try {
      const result = await tools.getClassInfo(req.body.className);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/mass_set_property', async (req, res) => {
    try {
      const result = await tools.massSetProperty(req.body.paths, req.body.propertyName, req.body.propertyValue);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/mass_get_property', async (req, res) => {
    try {
      const result = await tools.massGetProperty(req.body.paths, req.body.propertyName);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/create_object_with_properties', async (req, res) => {
    try {
      const result = await tools.createObjectWithProperties(req.body.className, req.body.parent, req.body.name, req.body.properties);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/mass_create_objects', async (req, res) => {
    try {
      const result = await tools.massCreateObjects(req.body.objects);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/mass_create_objects_with_properties', async (req, res) => {
    try {
      const result = await tools.massCreateObjectsWithProperties(req.body.objects);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/get_project_structure', async (req, res) => {
    try {
      const result = await tools.getProjectStructure(req.body.path, req.body.maxDepth, req.body.scriptsOnly);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });


  app.post('/mcp/get_script_source', async (req, res) => {
    try {
      const result = await tools.getScriptSource(req.body.instancePath, req.body.startLine, req.body.endLine);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/set_script_source', async (req, res) => {
    try {
      const result = await tools.setScriptSource(req.body.instancePath, req.body.source);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/get_selection', async (req, res) => {
    try {
      const result = await tools.getSelection();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/execute_luau', async (req, res) => {
    try {
      const result = await tools.executeLuau(req.body.code);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });


  app.post('/mcp/set_property', async (req, res) => {
    try {
      const result = await tools.setProperty(req.body.instancePath, req.body.propertyName, req.body.propertyValue);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });


  app.post('/mcp/create_object', async (req, res) => {
    try {
      const result = await tools.createObject(req.body.className, req.body.parent, req.body.name);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/delete_object', async (req, res) => {
    try {
      const result = await tools.deleteObject(req.body.instancePath);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });


  app.post('/mcp/smart_duplicate', async (req, res) => {
    try {
      const result = await tools.smartDuplicate(req.body.instancePath, req.body.count, req.body.options);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/mass_duplicate', async (req, res) => {
    try {
      const result = await tools.massDuplicate(req.body.duplications);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });


  app.post('/mcp/set_calculated_property', async (req, res) => {
    try {
      const result = await tools.setCalculatedProperty(req.body.paths, req.body.propertyName, req.body.formula, req.body.variables);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/set_relative_property', async (req, res) => {
    try {
      const result = await tools.setRelativeProperty(req.body.paths, req.body.propertyName, req.body.operation, req.body.value, req.body.component);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });


  app.post('/mcp/edit_script_lines', async (req, res) => {
    try {
      const result = await tools.editScriptLines(req.body.instancePath, req.body.startLine, req.body.endLine, req.body.newContent);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/insert_script_lines', async (req, res) => {
    try {
      const result = await tools.insertScriptLines(req.body.instancePath, req.body.afterLine, req.body.newContent);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/delete_script_lines', async (req, res) => {
    try {
      const result = await tools.deleteScriptLines(req.body.instancePath, req.body.startLine, req.body.endLine);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });


  app.post('/mcp/get_attribute', async (req, res) => {
    try {
      const result = await tools.getAttribute(req.body.instancePath, req.body.attributeName);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/set_attribute', async (req, res) => {
    try {
      const result = await tools.setAttribute(req.body.instancePath, req.body.attributeName, req.body.attributeValue, req.body.valueType);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/get_attributes', async (req, res) => {
    try {
      const result = await tools.getAttributes(req.body.instancePath);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/delete_attribute', async (req, res) => {
    try {
      const result = await tools.deleteAttribute(req.body.instancePath, req.body.attributeName);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });


  app.post('/mcp/get_tags', async (req, res) => {
    try {
      const result = await tools.getTags(req.body.instancePath);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/add_tag', async (req, res) => {
    try {
      const result = await tools.addTag(req.body.instancePath, req.body.tagName);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/remove_tag', async (req, res) => {
    try {
      const result = await tools.removeTag(req.body.instancePath, req.body.tagName);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/get_tagged', async (req, res) => {
    try {
      const result = await tools.getTagged(req.body.tagName);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/undo', async (_req, res) => {
    try {
      const result = await tools.undo();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/redo', async (_req, res) => {
    try {
      const result = await tools.redo();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });


  app.post('/mcp/start_playtest', async (req, res) => {
    try {
      const result = await tools.startPlaytest(req.body.mode);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/stop_playtest', async (req, res) => {
    try {
      const result = await tools.stopPlaytest();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/mcp/get_playtest_output', async (req, res) => {
    try {
      const result = await tools.getPlaytestOutput();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });


  (app as any).isPluginConnected = isPluginConnected;
  (app as any).setMCPServerActive = setMCPServerActive;
  (app as any).isMCPServerActive = isMCPServerActive;
  (app as any).trackMCPActivity = trackMCPActivity;
  (app as any).setConnectionMode = setConnectionMode;
  (app as any).getConnectionMode = getConnectionMode;

  return app;
}
