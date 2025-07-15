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
import { z } from 'zod';

const execAsync = promisify(exec);

const DockerPortArgsSchema = z.object({
  container: z.string(),
});

const DockerLogsArgsSchema = z.object({
  container: z.string(),
  tail: z.number().optional(),
});

const DockerInspectArgsSchema = z.object({
  container: z.string(),
});

const DockerStatsArgsSchema = z.object({
  no_stream: z.boolean().optional(),
});

const DockerDeleteArgsSchema = z.object({
  container: z.string(),
  force: z.boolean().optional(),
});



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
        {
          name: 'docker_delete',
          description: 'Delete a Docker container',
          inputSchema: {
            type: 'object',
            properties: {
              container: {
                type: 'string',
                description: 'Container name or ID',
              },
              force: {
                type: 'boolean',
                description: 'Force remove running container (default: false)',
                default: false,
              },
            },
            required: ['container'],
          },
        }
      ];

      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'docker_ps':
            return await this.dockerPs();

          case 'docker_ps_all':
            return await this.dockerPsAll();

          case 'docker_port': {
            const validatedArgs = DockerPortArgsSchema.parse(args);
            return await this.dockerPort(validatedArgs.container);
          }

          case 'docker_logs': {
            const validatedArgs = DockerLogsArgsSchema.parse(args);
            return await this.dockerLogs(
              validatedArgs.container,
              validatedArgs.tail || 100
            );
          }

          case 'docker_inspect': {
            const validatedArgs = DockerInspectArgsSchema.parse(args);
            return await this.dockerInspect(validatedArgs.container);
          }

          case 'docker_stats': {
            const validatedArgs = DockerStatsArgsSchema.parse(args);
            return await this.dockerStats(validatedArgs.no_stream !== false);
          }

          case 'docker_images':
            return await this.dockerImages();

          case 'docker_delete': {
            const validatedArgs = DockerDeleteArgsSchema.parse(args);
            return await this.dockerDelete(
              validatedArgs.container,
              validatedArgs.force || false
            );
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid arguments for ${name}: ${error.message}`
          );
        }
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

  private async dockerDelete(container: string, force: boolean): Promise<CallToolResult> {
    const command = force ? `docker rm -f ${container}` : `docker rm ${container}`;
    await execAsync(command);
    return {
      content: [
        {
          type: 'text',
          text: `Container ${container} deleted successfully`,
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