#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer as createNodeHttpServer } from 'http';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import { createHttpServer, type BridgeHttpServer } from './http-server.js';
import { listenWithRetry } from './http-listener.js';
import { ProxyBridgeService } from './proxy-bridge-service.js';
import { attachSessionCloseHandler } from './streamable-session-lifecycle.js';
import { RobloxStudioTools } from './tools/index.js';
import { BridgeService } from './bridge-service.js';

const require = createRequire(import.meta.url);
const { version: VERSION } = require('../package.json');

class RobloxStudioMCPServer {
  private server: Server;
  private tools: RobloxStudioTools;
  private bridge: BridgeService;
  private bridgeMode: 'primary' | 'proxy' = 'primary';
  private httpApp?: BridgeHttpServer;
  private bridgeStatusInterval?: ReturnType<typeof setInterval>;
  private bridgeCleanupInterval?: ReturnType<typeof setInterval>;
  private proxyPromotionInterval?: ReturnType<typeof setInterval>;
  private isPromotionInFlight = false;
  private readonly streamableSessionServers = new Set<RobloxStudioMCPServer>();

  constructor(sharedBridge?: BridgeService) {
    this.server = new Server(
      {
        name: 'robloxstudio-mcp',
        version: VERSION,
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.bridge = sharedBridge ?? new BridgeService();
    this.tools = new RobloxStudioTools(this.bridge);
    this.setupResourceHandlers();
    this.setupToolHandlers();
  }

  private setupResourceHandlers() {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [],
      };
    });

    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      return {
        resourceTemplates: [],
      };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      throw new McpError(
        ErrorCode.InvalidParams,
        `This server does not expose readable resources: ${request.params.uri}`
      );
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [

          {
            name: 'get_file_tree',
            description: 'Get the Roblox instance hierarchy tree from Roblox Studio. Returns game instances (Parts, Scripts, Models, Folders, etc.) as a tree structure. NOTE: This operates on Roblox Studio instances, NOT local filesystem files.',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Roblox instance path to start from using dot notation (e.g., "game.Workspace", "game.ServerScriptService"). Defaults to game root if empty.',
                  default: ''
                }
              }
            }
          },
          {
            name: 'search_files',
            description: 'Search for Roblox instances by name, class type, or script content. NOTE: This searches Roblox Studio instances, NOT local filesystem files.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query - instance name, class type (e.g., "Script", "Part"), or Lua code pattern'
                },
                searchType: {
                  type: 'string',
                  enum: ['name', 'type', 'content'],
                  description: 'Type of search: "name" for instance names, "type" for class names, "content" for script source code',
                  default: 'name'
                }
              },
              required: ['query']
            }
          },

          {
            name: 'get_place_info',
            description: 'Get place ID, name, and game settings',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'get_services',
            description: 'Get available Roblox services and their children',
            inputSchema: {
              type: 'object',
              properties: {
                serviceName: {
                  type: 'string',
                  description: 'Optional specific service name to query'
                }
              }
            }
          },
          {
            name: 'search_objects',
            description: 'Find instances by name, class, or properties',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query'
                },
                searchType: {
                  type: 'string',
                  enum: ['name', 'class', 'property'],
                  description: 'Type of search to perform',
                  default: 'name'
                },
                propertyName: {
                  type: 'string',
                  description: 'Property name when searchType is "property"'
                }
              },
              required: ['query']
            }
          },

          {
            name: 'get_instance_properties',
            description: 'Get all properties of a specific Roblox instance in Studio',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: {
                  type: 'string',
                  description: 'Roblox instance path using dot notation (e.g., "game.Workspace.Part", "game.ServerScriptService.MainScript", "game.ReplicatedStorage.ModuleScript")'
                }
              },
              required: ['instancePath']
            }
          },
          {
            name: 'get_instance_children',
            description: 'Get child instances and their class types from a Roblox parent instance',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: {
                  type: 'string',
                  description: 'Roblox instance path using dot notation (e.g., "game.Workspace", "game.ServerScriptService")'
                }
              },
              required: ['instancePath']
            }
          },
          {
            name: 'search_by_property',
            description: 'Find objects with specific property values',
            inputSchema: {
              type: 'object',
              properties: {
                propertyName: {
                  type: 'string',
                  description: 'Name of the property to search'
                },
                propertyValue: {
                  type: 'string',
                  description: 'Value to search for'
                }
              },
              required: ['propertyName', 'propertyValue']
            }
          },
          {
            name: 'get_class_info',
            description: 'Get available properties/methods for Roblox classes',
            inputSchema: {
              type: 'object',
              properties: {
                className: {
                  type: 'string',
                  description: 'Roblox class name'
                }
              },
              required: ['className']
            }
          },

          {
            name: 'get_project_structure',
            description: 'Get complete game hierarchy. IMPORTANT: Use maxDepth parameter (default: 3) to explore deeper levels of the hierarchy. Set higher values like 5-10 for comprehensive exploration',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Optional path to start from (defaults to workspace root)',
                  default: ''
                },
                maxDepth: {
                  type: 'number',
                  description: 'Maximum depth to traverse (default: 3). RECOMMENDED: Use 5-10 for thorough exploration. Higher values provide more complete structure',
                  default: 3
                },
                scriptsOnly: {
                  type: 'boolean',
                  description: 'Show only scripts and script containers',
                  default: false
                }
              }
            }
          },

          {
            name: 'set_property',
            description: 'Set a property on any Roblox instance',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: {
                  type: 'string',
                  description: 'Path to the instance (e.g., "game.Workspace.Part")'
                },
                propertyName: {
                  type: 'string',
                  description: 'Name of the property to set'
                },
                propertyValue: {
                  description: 'Value to set the property to (any type)'
                }
              },
              required: ['instancePath', 'propertyName', 'propertyValue']
            }
          },
          {
            name: 'mass_set_property',
            description: 'Set the same property on multiple instances at once',
            inputSchema: {
              type: 'object',
              properties: {
                paths: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of instance paths to modify'
                },
                propertyName: {
                  type: 'string',
                  description: 'Name of the property to set'
                },
                propertyValue: {
                  description: 'Value to set the property to (any type)'
                }
              },
              required: ['paths', 'propertyName', 'propertyValue']
            }
          },
          {
            name: 'mass_get_property',
            description: 'Get the same property from multiple instances at once',
            inputSchema: {
              type: 'object',
              properties: {
                paths: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of instance paths to read from'
                },
                propertyName: {
                  type: 'string',
                  description: 'Name of the property to get'
                }
              },
              required: ['paths', 'propertyName']
            }
          },

          {
            name: 'create_object',
            description: 'Create a new Roblox object instance (basic, without properties)',
            inputSchema: {
              type: 'object',
              properties: {
                className: {
                  type: 'string',
                  description: 'Roblox class name (e.g., "Part", "Script", "Folder")'
                },
                parent: {
                  type: 'string',
                  description: 'Path to the parent instance (e.g., "game.Workspace")'
                },
                name: {
                  type: 'string',
                  description: 'Optional name for the new object'
                }
              },
              required: ['className', 'parent']
            }
          },
          {
            name: 'create_object_with_properties',
            description: 'Create a new Roblox object instance with initial properties',
            inputSchema: {
              type: 'object',
              properties: {
                className: {
                  type: 'string',
                  description: 'Roblox class name (e.g., "Part", "Script", "Folder")'
                },
                parent: {
                  type: 'string',
                  description: 'Path to the parent instance (e.g., "game.Workspace")'
                },
                name: {
                  type: 'string',
                  description: 'Optional name for the new object'
                },
                properties: {
                  type: 'object',
                  description: 'Properties to set on creation'
                }
              },
              required: ['className', 'parent']
            }
          },
          {
            name: 'mass_create_objects',
            description: 'Create multiple objects at once (basic, without properties)',
            inputSchema: {
              type: 'object',
              properties: {
                objects: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      className: {
                        type: 'string',
                        description: 'Roblox class name'
                      },
                      parent: {
                        type: 'string',
                        description: 'Path to the parent instance'
                      },
                      name: {
                        type: 'string',
                        description: 'Optional name for the object'
                      }
                    },
                    required: ['className', 'parent']
                  },
                  description: 'Array of objects to create'
                }
              },
              required: ['objects']
            }
          },
          {
            name: 'mass_create_objects_with_properties',
            description: 'Create multiple objects at once with initial properties',
            inputSchema: {
              type: 'object',
              properties: {
                objects: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      className: {
                        type: 'string',
                        description: 'Roblox class name'
                      },
                      parent: {
                        type: 'string',
                        description: 'Path to the parent instance'
                      },
                      name: {
                        type: 'string',
                        description: 'Optional name for the object'
                      },
                      properties: {
                        type: 'object',
                        description: 'Properties to set on creation'
                      }
                    },
                    required: ['className', 'parent']
                  },
                  description: 'Array of objects to create with properties'
                }
              },
              required: ['objects']
            }
          },
          {
            name: 'delete_object',
            description: 'Delete a Roblox object instance',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: {
                  type: 'string',
                  description: 'Path to the instance to delete'
                }
              },
              required: ['instancePath']
            }
          },

          {
            name: 'smart_duplicate',
            description: 'Smart duplication with automatic naming, positioning, and property variations',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: {
                  type: 'string',
                  description: 'Path to the instance to duplicate'
                },
                count: {
                  type: 'number',
                  description: 'Number of duplicates to create'
                },
                options: {
                  type: 'object',
                  properties: {
                    namePattern: {
                      type: 'string',
                      description: 'Name pattern with {n} placeholder (e.g., "Button{n}")'
                    },
                    positionOffset: {
                      type: 'array',
                      items: { type: 'number' },
                      minItems: 3,
                      maxItems: 3,
                      description: 'X, Y, Z offset per duplicate'
                    },
                    rotationOffset: {
                      type: 'array',
                      items: { type: 'number' },
                      minItems: 3,
                      maxItems: 3,
                      description: 'X, Y, Z rotation offset per duplicate'
                    },
                    scaleOffset: {
                      type: 'array',
                      items: { type: 'number' },
                      minItems: 3,
                      maxItems: 3,
                      description: 'X, Y, Z scale multiplier per duplicate'
                    },
                    propertyVariations: {
                      type: 'object',
                      description: 'Property name to array of values'
                    },
                    targetParents: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Different parent for each duplicate'
                    }
                  }
                }
              },
              required: ['instancePath', 'count']
            }
          },
          {
            name: 'mass_duplicate',
            description: 'Perform multiple smart duplications at once',
            inputSchema: {
              type: 'object',
              properties: {
                duplications: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      instancePath: {
                        type: 'string',
                        description: 'Path to the instance to duplicate'
                      },
                      count: {
                        type: 'number',
                        description: 'Number of duplicates to create'
                      },
                      options: {
                        type: 'object',
                        properties: {
                          namePattern: {
                            type: 'string',
                            description: 'Name pattern with {n} placeholder'
                          },
                          positionOffset: {
                            type: 'array',
                            items: { type: 'number' },
                            minItems: 3,
                            maxItems: 3,
                            description: 'X, Y, Z offset per duplicate'
                          },
                          rotationOffset: {
                            type: 'array',
                            items: { type: 'number' },
                            minItems: 3,
                            maxItems: 3,
                            description: 'X, Y, Z rotation offset per duplicate'
                          },
                          scaleOffset: {
                            type: 'array',
                            items: { type: 'number' },
                            minItems: 3,
                            maxItems: 3,
                            description: 'X, Y, Z scale multiplier per duplicate'
                          },
                          propertyVariations: {
                            type: 'object',
                            description: 'Property name to array of values'
                          },
                          targetParents: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Different parent for each duplicate'
                          }
                        }
                      }
                    },
                    required: ['instancePath', 'count']
                  },
                  description: 'Array of duplication operations'
                }
              },
              required: ['duplications']
            }
          },

          {
            name: 'set_calculated_property',
            description: 'Set properties using mathematical formulas and variables',
            inputSchema: {
              type: 'object',
              properties: {
                paths: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of instance paths to modify'
                },
                propertyName: {
                  type: 'string',
                  description: 'Name of the property to set'
                },
                formula: {
                  type: 'string',
                  description: 'Mathematical formula (e.g., "Position.magnitude * 2", "index * 50")'
                },
                variables: {
                  type: 'object',
                  description: 'Additional variables for the formula'
                }
              },
              required: ['paths', 'propertyName', 'formula']
            }
          },

          {
            name: 'set_relative_property',
            description: 'Modify properties relative to their current values',
            inputSchema: {
              type: 'object',
              properties: {
                paths: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of instance paths to modify'
                },
                propertyName: {
                  type: 'string',
                  description: 'Name of the property to modify'
                },
                operation: {
                  type: 'string',
                  enum: ['add', 'multiply', 'divide', 'subtract', 'power'],
                  description: 'Mathematical operation to perform'
                },
                value: {
                  description: 'Value to use in the operation'
                },
                component: {
                  type: 'string',
                  enum: ['X', 'Y', 'Z', 'XScale', 'XOffset', 'YScale', 'YOffset'],
                  description: 'For Vector3: X, Y, Z. For UDim2: XScale, XOffset, YScale, YOffset (value must be a number)'
                }
              },
              required: ['paths', 'propertyName', 'operation', 'value']
            }
          },

          {
            name: 'get_script_source',
            description: 'Get the source code of a Roblox script (LocalScript, Script, or ModuleScript). Returns both "source" (raw code) and "numberedSource" (with line numbers prefixed like "1: code"). Use numberedSource to accurately identify line numbers for editing. For large scripts (>1500 lines), use startLine/endLine to read specific sections.',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: {
                  type: 'string',
                  description: 'Roblox instance path to the script using dot notation (e.g., "game.ServerScriptService.MainScript", "game.StarterPlayer.StarterPlayerScripts.LocalScript")'
                },
                startLine: {
                  type: 'number',
                  description: 'Optional: Start line number (1-indexed). Use for reading specific sections of large scripts.'
                },
                endLine: {
                  type: 'number',
                  description: 'Optional: End line number (inclusive). Use for reading specific sections of large scripts.'
                }
              },
              required: ['instancePath']
            }
          },
          {
            name: 'set_script_source',
            description: 'Replace the entire source code of a Roblox script. Uses ScriptEditorService:UpdateSourceAsync (works with open editors). For partial edits, prefer edit_script_lines, insert_script_lines, or delete_script_lines.',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: {
                  type: 'string',
                  description: 'Roblox instance path to the script (e.g., "game.ServerScriptService.MainScript")'
                },
                source: {
                  type: 'string',
                  description: 'New source code for the script'
                }
              },
              required: ['instancePath', 'source']
            }
          },

          {
            name: 'edit_script_lines',
            description: 'Replace specific lines in a Roblox script without rewriting the entire source. IMPORTANT: Use the "numberedSource" field from get_script_source to identify the correct line numbers. Lines are 1-indexed and ranges are inclusive.',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: {
                  type: 'string',
                  description: 'Roblox instance path to the script (e.g., "game.ServerScriptService.MainScript")'
                },
                startLine: {
                  type: 'number',
                  description: 'First line to replace (1-indexed). Get this from the "numberedSource" field.'
                },
                endLine: {
                  type: 'number',
                  description: 'Last line to replace (inclusive). Get this from the "numberedSource" field.'
                },
                newContent: {
                  type: 'string',
                  description: 'New content to replace the specified lines (can be multiple lines separated by newlines)'
                }
              },
              required: ['instancePath', 'startLine', 'endLine', 'newContent']
            }
          },
          {
            name: 'insert_script_lines',
            description: 'Insert new lines into a Roblox script at a specific position. IMPORTANT: Use the "numberedSource" field from get_script_source to identify the correct line numbers.',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: {
                  type: 'string',
                  description: 'Roblox instance path to the script (e.g., "game.ServerScriptService.MainScript")'
                },
                afterLine: {
                  type: 'number',
                  description: 'Insert after this line number (0 = insert at very beginning, 1 = after first line). Get line numbers from "numberedSource".',
                  default: 0
                },
                newContent: {
                  type: 'string',
                  description: 'Content to insert (can be multiple lines separated by newlines)'
                }
              },
              required: ['instancePath', 'newContent']
            }
          },
          {
            name: 'delete_script_lines',
            description: 'Delete specific lines from a Roblox script. IMPORTANT: Use the "numberedSource" field from get_script_source to identify the correct line numbers.',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: {
                  type: 'string',
                  description: 'Roblox instance path to the script (e.g., "game.ServerScriptService.MainScript")'
                },
                startLine: {
                  type: 'number',
                  description: 'First line to delete (1-indexed). Get this from the "numberedSource" field.'
                },
                endLine: {
                  type: 'number',
                  description: 'Last line to delete (inclusive). Get this from the "numberedSource" field.'
                }
              },
              required: ['instancePath', 'startLine', 'endLine']
            }
          },

          {
            name: 'get_attribute',
            description: 'Get a single attribute value from a Roblox instance',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: {
                  type: 'string',
                  description: 'Roblox instance path using dot notation (e.g., "game.Workspace.Part", "game.ServerStorage.DataStore")'
                },
                attributeName: {
                  type: 'string',
                  description: 'Name of the attribute to get'
                }
              },
              required: ['instancePath', 'attributeName']
            }
          },
          {
            name: 'set_attribute',
            description: 'Set an attribute value on a Roblox instance. Supports string, number, boolean, Vector3, Color3, UDim2, and BrickColor.',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: {
                  type: 'string',
                  description: 'Roblox instance path using dot notation (e.g., "game.Workspace.Part")'
                },
                attributeName: {
                  type: 'string',
                  description: 'Name of the attribute to set'
                },
                attributeValue: {
                  description: 'Value to set. For Vector3: {X, Y, Z}, Color3: {R, G, B}, UDim2: {X: {Scale, Offset}, Y: {Scale, Offset}}'
                },
                valueType: {
                  type: 'string',
                  description: 'Optional type hint: "Vector3", "Color3", "UDim2", "BrickColor"'
                }
              },
              required: ['instancePath', 'attributeName', 'attributeValue']
            }
          },
          {
            name: 'get_attributes',
            description: 'Get all attributes on a Roblox instance',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: {
                  type: 'string',
                  description: 'Roblox instance path using dot notation (e.g., "game.Workspace.Part")'
                }
              },
              required: ['instancePath']
            }
          },
          {
            name: 'delete_attribute',
            description: 'Delete an attribute from a Roblox instance',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: {
                  type: 'string',
                  description: 'Roblox instance path using dot notation (e.g., "game.Workspace.Part")'
                },
                attributeName: {
                  type: 'string',
                  description: 'Name of the attribute to delete'
                }
              },
              required: ['instancePath', 'attributeName']
            }
          },

          {
            name: 'get_tags',
            description: 'Get all CollectionService tags on a Roblox instance',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: {
                  type: 'string',
                  description: 'Roblox instance path using dot notation (e.g., "game.Workspace.Part")'
                }
              },
              required: ['instancePath']
            }
          },
          {
            name: 'add_tag',
            description: 'Add a CollectionService tag to a Roblox instance',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: {
                  type: 'string',
                  description: 'Roblox instance path using dot notation (e.g., "game.Workspace.Part")'
                },
                tagName: {
                  type: 'string',
                  description: 'Name of the tag to add'
                }
              },
              required: ['instancePath', 'tagName']
            }
          },
          {
            name: 'remove_tag',
            description: 'Remove a CollectionService tag from a Roblox instance',
            inputSchema: {
              type: 'object',
              properties: {
                instancePath: {
                  type: 'string',
                  description: 'Roblox instance path using dot notation (e.g., "game.Workspace.Part")'
                },
                tagName: {
                  type: 'string',
                  description: 'Name of the tag to remove'
                }
              },
              required: ['instancePath', 'tagName']
            }
          },
          {
            name: 'get_tagged',
            description: 'Get all instances with a specific tag',
            inputSchema: {
              type: 'object',
              properties: {
                tagName: {
                  type: 'string',
                  description: 'Name of the tag to search for'
                }
              },
              required: ['tagName']
            }
          },
          {
            name: 'get_selection',
            description: 'Get all currently selected objects',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'execute_luau',
            description: 'Execute arbitrary Luau code in Roblox Studio and return the result. The code runs in the plugin context with access to game, workspace, and all services. Use print() or warn() to produce output. The return value of the code (if any) is captured. Useful for querying game state, running one-off operations, or testing logic.',
            inputSchema: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  description: 'Luau code to execute. Can use print() for output. The return value is captured.'
                }
              },
              required: ['code']
            }
          },

          {
            name: 'start_playtest',
            description: 'Start a play test session in Roblox Studio. Captures all output (print/warn/error) from LogService. Use get_playtest_output to poll for logs while running, then stop_playtest to end. Typical workflow: add print/warn statements to code, start playtest, poll output to observe behavior, stop, analyze logs, fix issues with set_script_source, and repeat until correct.',
            inputSchema: {
              type: 'object',
              properties: {
                mode: {
                  type: 'string',
                  enum: ['play', 'run'],
                  description: '"play" for Play Solo mode, "run" for Run mode'
                }
              },
              required: ['mode']
            }
          },
          {
            name: 'stop_playtest',
            description: 'Stop the running play test session and return all captured output. Call this after observing enough output via get_playtest_output, or when you need to make code changes before the next run.',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'get_playtest_output',
            description: 'Poll the output buffer without stopping the test. Returns isRunning, captured print/warn/error messages, and any test result. Call repeatedly to monitor a running session — useful for waiting on specific log output or checking if errors have occurred.',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'undo',
            description: 'Undo the last committed studio change via ChangeHistoryService.',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'redo',
            description: 'Redo the last undone studio change via ChangeHistoryService.',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const toolArgs: Record<string, unknown> =
        args && typeof args === 'object' && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};

      try {
        switch (name) {

          case 'get_file_tree':
            return await this.tools.getFileTree((toolArgs.path as string | undefined) || '');
          case 'search_files':
            return await this.tools.searchFiles(toolArgs.query as string, (toolArgs.searchType as string | undefined) || 'name');

          case 'get_place_info':
            return await this.tools.getPlaceInfo();
          case 'get_services':
            return await this.tools.getServices(toolArgs.serviceName as string | undefined);
          case 'search_objects':
            return await this.tools.searchObjects(
              toolArgs.query as string,
              (toolArgs.searchType as string | undefined) || 'name',
              toolArgs.propertyName as string | undefined
            );

          case 'get_instance_properties':
            return await this.tools.getInstanceProperties(toolArgs.instancePath as string);
          case 'get_instance_children':
            return await this.tools.getInstanceChildren(toolArgs.instancePath as string);
          case 'search_by_property':
            return await this.tools.searchByProperty(toolArgs.propertyName as string, toolArgs.propertyValue as string);
          case 'get_class_info':
            return await this.tools.getClassInfo(toolArgs.className as string);

          case 'get_project_structure':
            return await this.tools.getProjectStructure(
              toolArgs.path as string | undefined,
              toolArgs.maxDepth as number | undefined,
              toolArgs.scriptsOnly as boolean | undefined
            );

          case 'set_property':
            return await this.tools.setProperty(toolArgs.instancePath as string, toolArgs.propertyName as string, toolArgs.propertyValue);

          case 'mass_set_property':
            return await this.tools.massSetProperty(toolArgs.paths as string[], toolArgs.propertyName as string, toolArgs.propertyValue);
          case 'mass_get_property':
            return await this.tools.massGetProperty(toolArgs.paths as string[], toolArgs.propertyName as string);

          case 'create_object':
            return await this.tools.createObject(
              toolArgs.className as string,
              toolArgs.parent as string,
              toolArgs.name as string | undefined
            );
          case 'create_object_with_properties':
            return await this.tools.createObjectWithProperties(
              toolArgs.className as string,
              toolArgs.parent as string,
              toolArgs.name as string | undefined,
              toolArgs.properties as Record<string, unknown> | undefined
            );
          case 'mass_create_objects':
            return await this.tools.massCreateObjects(toolArgs.objects as Array<{ className: string; parent: string; name?: string }>);
          case 'mass_create_objects_with_properties':
            return await this.tools.massCreateObjectsWithProperties(toolArgs.objects as Array<{
              className: string;
              parent: string;
              name?: string;
              properties?: Record<string, unknown>;
            }>);
          case 'delete_object':
            return await this.tools.deleteObject(toolArgs.instancePath as string);

          case 'smart_duplicate':
            return await this.tools.smartDuplicate(
              toolArgs.instancePath as string,
              toolArgs.count as number,
              toolArgs.options as Parameters<RobloxStudioTools['smartDuplicate']>[2]
            );
          case 'mass_duplicate':
            return await this.tools.massDuplicate(
              toolArgs.duplications as Parameters<RobloxStudioTools['massDuplicate']>[0]
            );

          case 'set_calculated_property':
            return await this.tools.setCalculatedProperty(
              toolArgs.paths as string[],
              toolArgs.propertyName as string,
              toolArgs.formula as string,
              toolArgs.variables as Record<string, unknown> | undefined
            );

          case 'set_relative_property':
            return await this.tools.setRelativeProperty(
              toolArgs.paths as string[],
              toolArgs.propertyName as string,
              toolArgs.operation as Parameters<RobloxStudioTools['setRelativeProperty']>[2],
              toolArgs.value,
              toolArgs.component as Parameters<RobloxStudioTools['setRelativeProperty']>[4]
            );

          case 'get_script_source':
            return await this.tools.getScriptSource(
              toolArgs.instancePath as string,
              toolArgs.startLine as number | undefined,
              toolArgs.endLine as number | undefined
            );
          case 'set_script_source':
            return await this.tools.setScriptSource(toolArgs.instancePath as string, toolArgs.source as string);

          case 'edit_script_lines':
            return await this.tools.editScriptLines(
              toolArgs.instancePath as string,
              toolArgs.startLine as number,
              toolArgs.endLine as number,
              toolArgs.newContent as string
            );
          case 'insert_script_lines':
            return await this.tools.insertScriptLines(
              toolArgs.instancePath as string,
              toolArgs.afterLine as number,
              toolArgs.newContent as string
            );
          case 'delete_script_lines':
            return await this.tools.deleteScriptLines(
              toolArgs.instancePath as string,
              toolArgs.startLine as number,
              toolArgs.endLine as number
            );

          case 'get_attribute':
            return await this.tools.getAttribute(toolArgs.instancePath as string, toolArgs.attributeName as string);
          case 'set_attribute':
            return await this.tools.setAttribute(
              toolArgs.instancePath as string,
              toolArgs.attributeName as string,
              toolArgs.attributeValue,
              toolArgs.valueType as string | undefined
            );
          case 'get_attributes':
            return await this.tools.getAttributes(toolArgs.instancePath as string);
          case 'delete_attribute':
            return await this.tools.deleteAttribute(toolArgs.instancePath as string, toolArgs.attributeName as string);

          case 'get_tags':
            return await this.tools.getTags(toolArgs.instancePath as string);
          case 'add_tag':
            return await this.tools.addTag(toolArgs.instancePath as string, toolArgs.tagName as string);
          case 'remove_tag':
            return await this.tools.removeTag(toolArgs.instancePath as string, toolArgs.tagName as string);
          case 'get_tagged':
            return await this.tools.getTagged(toolArgs.tagName as string);

          case 'get_selection':
            return await this.tools.getSelection();

          case 'execute_luau':
            return await this.tools.executeLuau(toolArgs.code as string);

          case 'start_playtest':
            return await this.tools.startPlaytest(toolArgs.mode as string);
          case 'stop_playtest':
            return await this.tools.stopPlaytest();
          case 'get_playtest_output':
            return await this.tools.getPlaytestOutput();
          case 'undo':
            return await this.tools.undo();
          case 'redo':
            return await this.tools.redo();

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  private parseEnvNumber(name: string, fallback: number) {
    const raw = process.env[name];
    if (!raw) return fallback;

    const value = parseInt(raw, 10);
    return Number.isFinite(value) ? value : fallback;
  }

  private getTransportMode(): 'stdio' | 'streamable-http' {
    const argTransport = process.argv.find((arg) => arg.startsWith('--transport='));
    const argMode = argTransport ? argTransport.split('=')[1] : undefined;

    if (process.argv.includes('--streamable-http') || argMode === 'streamable-http' || argMode === 'http') {
      return 'streamable-http';
    }

    const envMode = process.env.MCP_TRANSPORT?.toLowerCase();
    if (envMode === 'streamable-http' || envMode === 'http') {
      return 'streamable-http';
    }

    return 'stdio';
  }

  private async setupBridgeServer() {
    const port = this.parseEnvNumber('ROBLOX_STUDIO_PORT', 58741);
    const maxPortAttempts = this.parseEnvNumber('ROBLOX_STUDIO_PORT_RETRY_COUNT', 1);
    const host = process.env.ROBLOX_STUDIO_HOST || '0.0.0.0';
    const httpServer = createHttpServer(this.tools, this.bridge);
    const httpApp = httpServer.app;
    const runtime = httpServer.runtime;
    this.httpApp = httpServer;
    this.bridgeMode = 'primary';

    try {
      const { port: boundPort } = await listenWithRetry(
        httpApp,
        host,
        port,
        maxPortAttempts,
        (message) => console.error(message)
      );
      console.error(`HTTP server listening on ${host}:${boundPort} for Studio plugin`);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'EADDRINUSE') {
        throw error;
      }

      const proxyHost = process.env.ROBLOX_STUDIO_PROXY_HOST || '127.0.0.1';
      const proxyBaseUrl = `http://${proxyHost}:${port}`;
      this.bridgeMode = 'proxy';
      this.bridge = new ProxyBridgeService(proxyBaseUrl);
      this.tools = new RobloxStudioTools(this.bridge);
      runtime.setConnectionMode('proxying');
      console.error(`Port ${port} is busy. Running in proxy mode via ${proxyBaseUrl}`);
    }

    return { host, port, maxPortAttempts };
  }

  private startPrimaryBridgeMonitoring(httpServer: BridgeHttpServer) {
    const runtime = httpServer.runtime;
    runtime.setMCPServerActive(true);
    runtime.setConnectionMode('direct');
    console.error('MCP server marked as active');
    console.error('Waiting for Studio plugin to connect...');

    if (this.bridgeStatusInterval) {
      clearInterval(this.bridgeStatusInterval);
    }
    this.bridgeStatusInterval = setInterval(() => {
      runtime.trackMCPActivity();
      const pluginConnected = runtime.isPluginConnected();
      const mcpActive = runtime.isMCPServerActive();

      if (pluginConnected && mcpActive) {
        return;
      } else if (pluginConnected && !mcpActive) {
        console.error('Studio plugin connected, but MCP server inactive');
      } else if (!pluginConnected && mcpActive) {
        console.error('MCP server active, waiting for Studio plugin...');
      } else {
        console.error('Waiting for connections...');
      }
    }, 5000);

    if (this.bridgeCleanupInterval) {
      clearInterval(this.bridgeCleanupInterval);
    }
    this.bridgeCleanupInterval = setInterval(() => {
      this.bridge.cleanupOldRequests();
    }, 5000);
  }

  private syncBridgeAcrossSessions(bridge: BridgeService) {
    this.bridge = bridge;
    this.tools = new RobloxStudioTools(bridge);
    for (const sessionServer of this.streamableSessionServers) {
      sessionServer.bridge = bridge;
      sessionServer.tools = new RobloxStudioTools(bridge);
    }
  }

  private getProxyPromotionIntervalMs() {
    const configured = this.parseEnvNumber('ROBLOX_STUDIO_PROXY_PROMOTION_INTERVAL_MS', 5000);
    return configured > 0 ? configured : 5000;
  }

  private startProxyPromotionMonitoring(host: string, port: number) {
    if (this.proxyPromotionInterval) {
      clearInterval(this.proxyPromotionInterval);
    }

    const intervalMs = this.getProxyPromotionIntervalMs();
    this.proxyPromotionInterval = setInterval(() => {
      void this.tryPromoteProxyToPrimary(host, port);
    }, intervalMs);
  }

  private async tryPromoteProxyToPrimary(host: string, port: number) {
    if (this.bridgeMode !== 'proxy' || this.isPromotionInFlight) {
      return;
    }

    this.isPromotionInFlight = true;
    try {
      const nextBridge = new BridgeService();
      const nextTools = new RobloxStudioTools(nextBridge);
      const nextHttpServer = createHttpServer(nextTools, nextBridge);
      const { port: boundPort } = await listenWithRetry(
        nextHttpServer.app,
        host,
        port,
        1,
        () => {
          return;
        }
      );

      this.syncBridgeAcrossSessions(nextBridge);
      this.httpApp = nextHttpServer;
      this.bridgeMode = 'primary';
      this.stopProxyPromotionMonitoring();
      this.startPrimaryBridgeMonitoring(nextHttpServer);
      console.error(`Proxy instance promoted to primary bridge on ${host}:${boundPort}`);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'EADDRINUSE') {
        console.error(`Failed to probe bridge promotion: ${err.message ?? String(error)}`);
      }
    } finally {
      this.isPromotionInFlight = false;
    }
  }

  private stopProxyPromotionMonitoring() {
    if (!this.proxyPromotionInterval) {
      return;
    }
    clearInterval(this.proxyPromotionInterval);
    this.proxyPromotionInterval = undefined;
  }

  async connectTransport(transport: Parameters<Server['connect']>[0]) {
    await this.server.connect(transport);
  }

  async close() {
    await this.server.close();
  }

  private async runStdioMode() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Roblox Studio MCP server running on stdio');
  }

  private async runStreamableHttpMode() {
    const mcpHost = process.env.MCP_HTTP_HOST || '127.0.0.1';
    const mcpPort = this.parseEnvNumber('MCP_HTTP_PORT', 59000);
    const mcpPath = process.env.MCP_HTTP_PATH || '/mcp';
    const mcpApp = createMcpExpressApp({ host: mcpHost });

    type SessionContext = {
      server: RobloxStudioMCPServer;
      transport: StreamableHTTPServerTransport;
    };

    const sessions = new Map<string, SessionContext>();

    mcpApp.all(mcpPath, async (req, res) => {
      if (this.bridgeMode === 'primary') {
        this.httpApp?.runtime.trackMCPActivity();
      }

      try {
        const sessionHeader = req.headers['mcp-session-id'];
        const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
        let context = sessionId ? sessions.get(sessionId) : undefined;

        if (!context) {
          if (sessionId) {
            res.status(404).json({
              jsonrpc: '2.0',
              error: {
                code: -32001,
                message: 'Session not found',
              },
              id: null,
            });
            return;
          }

          if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
            res.status(400).json({
              jsonrpc: '2.0',
              error: {
                code: -32000,
                message: 'Bad Request: No valid session ID provided',
              },
              id: null,
            });
            return;
          }

          const sessionServer = new RobloxStudioMCPServer(this.bridge);
          this.streamableSessionServers.add(sessionServer);
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: (createdSessionId) => {
              sessions.set(createdSessionId, contextForSession);
            },
          });

          const contextForSession: SessionContext = { server: sessionServer, transport };
          attachSessionCloseHandler(sessions, contextForSession);
          const previousOnClose = transport.onclose;
          transport.onclose = () => {
            this.streamableSessionServers.delete(sessionServer);
            previousOnClose?.();
          };

          transport.onerror = (error) => {
            console.error(`MCP streamable transport error: ${error.message}`);
          };

          await sessionServer.connectTransport(transport);
          context = contextForSession;
        }

        await context.transport.handleRequest(req, res, req.body);
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          });
        }
        console.error(`MCP HTTP request failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    const mcpHttpServer = createNodeHttpServer(mcpApp);
    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        mcpHttpServer.removeListener('listening', onListening);
        reject(error);
      };

      const onListening = () => {
        mcpHttpServer.removeListener('error', onError);
        resolve();
      };

      mcpHttpServer.once('error', onError);
      mcpHttpServer.once('listening', onListening);
      mcpHttpServer.listen(mcpPort, mcpHost);
    });

    console.error(`Roblox Studio MCP server running on streamable HTTP: http://${mcpHost}:${mcpPort}${mcpPath}`);
  }

  async run() {
    const { host, port } = await this.setupBridgeServer();
    const transportMode = this.getTransportMode();

    if (transportMode === 'streamable-http') {
      await this.runStreamableHttpMode();
    } else {
      await this.runStdioMode();
    }

    if (this.bridgeMode === 'primary' && this.httpApp) {
      this.startPrimaryBridgeMonitoring(this.httpApp);
    } else {
      console.error('Proxy mode active. Forwarding Studio tool requests to primary bridge instance.');
      this.startProxyPromotionMonitoring(host, port);
    }
  }
}

const server = new RobloxStudioMCPServer();
server.run().catch((error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});
