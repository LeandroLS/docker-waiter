#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  Tool,
  CallToolResult
} from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface DockerPortArgs {
  container: string;
}

interface DockerLogsArgs {
  container: string;
  tail?: number;
}

interface DockerInspectArgs {
  container: string;
}

interface DockerStatsArgs {
  no_stream?: boolean;
}

type ToolArgs = DockerPortArgs | DockerLogsArgs | DockerInspectArgs | DockerStatsArgs | Record<string, never>;

class DockerMcpServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'docker-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    // Listar ferramentas disponíveis
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = [
        {
          name: 'docker_ps',
          description: 'List running Docker containers',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'docker_ps_all',
          description: 'List all Docker containers (running and stopped)',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'docker_port',
          description: 'Show mapped ports for a container',
          inputSchema: {
            type: 'object',
            properties: {
              container: {
                type: 'string',
                description: 'Container name or ID',
              },
            },
            required: ['container'],
          },
        },
        {
          name: 'docker_logs',
          description: 'Get logs from a container',
          inputSchema: {
            type: 'object',
            properties: {
              container: {
                type: 'string',
                description: 'Container name or ID',
              },
              tail: {
                type: 'number',
                description: 'Number of lines from the end (default: 100)',
                default: 100,
              },
            },
            required: ['container'],
          },
        },
        {
          name: 'docker_inspect',
          description: 'Show detailed information about a container',
          inputSchema: {
            type: 'object',
            properties: {
              container: {
                type: 'string',
                description: 'Container name or ID',
              },
            },
            required: ['container'],
          },
        },
        {
          name: 'docker_stats',
          description: 'Show container resource usage statistics',
          inputSchema: {
            type: 'object',
            properties: {
              no_stream: {
                type: 'boolean',
                description: 'Do not stream continuously (default: true)',
                default: true,
              },
            },
          },
        },
        {
          name: 'docker_images',
          description: 'List available Docker images',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ];

      return { tools };
    });

    // Executar ferramentas
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'docker_ps':
            return await this.dockerPs();

          case 'docker_ps_all':
            return await this.dockerPsAll();

          case 'docker_port':
            return await this.dockerPort((args as DockerPortArgs).container);

          case 'docker_logs':
            return await this.dockerLogs(
              (args as DockerLogsArgs).container,
              (args as DockerLogsArgs).tail || 100
            );

          case 'docker_inspect':
            return await this.dockerInspect((args as DockerInspectArgs).container);

          case 'docker_stats':
            return await this.dockerStats((args as DockerStatsArgs).no_stream !== false);

          case 'docker_images':
            return await this.dockerImages();

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing ${name}: ${errorMessage}`
        );
      }
    });
  }

  private async dockerPs(): Promise<CallToolResult> {
    const { stdout } = await execAsync('docker ps --format "table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"');
    return {
      content: [
        {
          type: 'text',
          text: stdout,
        },
      ],
    };
  }

  private async dockerPsAll(): Promise<CallToolResult> {
    const { stdout } = await execAsync('docker ps -a --format "table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"');
    return {
      content: [
        {
          type: 'text',
          text: stdout,
        },
      ],
    };
  }

  private async dockerPort(container: string): Promise<CallToolResult> {
    const { stdout } = await execAsync(`docker port ${container}`);
    return {
      content: [
        {
          type: 'text',
          text: stdout || 'No ports mapped',
        },
      ],
    };
  }

  private async dockerLogs(container: string, tail: number): Promise<CallToolResult> {
    const { stdout } = await execAsync(`docker logs --tail ${tail} ${container}`);
    return {
      content: [
        {
          type: 'text',
          text: stdout,
        },
      ],
    };
  }

  private async dockerInspect(container: string): Promise<CallToolResult> {
    const { stdout } = await execAsync(`docker inspect ${container}`);
    const data = JSON.parse(stdout);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private async dockerStats(noStream: boolean): Promise<CallToolResult> {
    const command = noStream ? 'docker stats --no-stream' : 'docker stats';
    const { stdout } = await execAsync(command);
    return {
      content: [
        {
          type: 'text',
          text: stdout,
        },
      ],
    };
  }

  private async dockerImages(): Promise<CallToolResult> {
    const { stdout } = await execAsync('docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.CreatedAt}}\t{{.Size}}"');
    return {
      content: [
        {
          type: 'text',
          text: stdout,
        },
      ],
    };
  }

  public async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Docker MCP Server running on stdio');
  }
}

const server = new DockerMcpServer();
server.run().catch(console.error);