/**
 * LettaBot Core - Handles agent communication
 * 
 * Single agent, single conversation - chat continues across all channels.
 */

import { createSession, resumeSession, type Session } from '@letta-ai/letta-code-sdk';
import { mkdirSync } from 'node:fs';
import type { ChannelAdapter } from '../channels/types.js';
import type { BotConfig, InboundMessage, TriggerContext } from './types.js';
import { Store } from './store.js';
import { updateAgentName } from '../tools/letta-api.js';
import { installSkillsToAgent } from '../skills/loader.js';
import { formatMessageEnvelope } from './formatter.js';
import { loadMemoryBlocks } from './memory.js';
import { SYSTEM_PROMPT } from './system-prompt.js';

export class LettaBot {
  private store: Store;
  private config: BotConfig;
  private channels: Map<string, ChannelAdapter> = new Map();
  private messageQueue: Array<{ msg: InboundMessage; adapter: ChannelAdapter }> = [];
  
  // Callback to trigger heartbeat (set by main.ts)
  public onTriggerHeartbeat?: () => Promise<void>;
  private processing = false;
  
  constructor(config: BotConfig) {
    this.config = config;
    
    // Ensure working directory exists
    mkdirSync(config.workingDir, { recursive: true });
    
    // Store in project root (same as main.ts reads for LETTA_AGENT_ID)
    this.store = new Store('lettabot-agent.json');
    
    console.log(`LettaBot initialized. Agent ID: ${this.store.agentId || '(new)'}`);
  }
  
  /**
   * Register a channel adapter
   */
  registerChannel(adapter: ChannelAdapter): void {
    adapter.onMessage = (msg) => this.handleMessage(msg, adapter);
    adapter.onCommand = (cmd) => this.handleCommand(cmd);
    this.channels.set(adapter.id, adapter);
    console.log(`Registered channel: ${adapter.name}`);
  }
  
  /**
   * Handle slash commands
   */
  private async handleCommand(command: string): Promise<string | null> {
    console.log(`[Command] Received: /${command}`);
    switch (command) {
      case 'status': {
        const info = this.store.getInfo();
        const lines = [
          `*Status*`,
          `Agent ID: \`${info.agentId || '(none)'}\``,
          `Created: ${info.createdAt || 'N/A'}`,
          `Last used: ${info.lastUsedAt || 'N/A'}`,
          `Channels: ${Array.from(this.channels.keys()).join(', ')}`,
        ];
        return lines.join('\n');
      }
      case 'heartbeat': {
        console.log('[Command] /heartbeat received');
        if (!this.onTriggerHeartbeat) {
          console.log('[Command] /heartbeat - no trigger callback configured');
          return '⚠️ Heartbeat service not configured';
        }
        console.log('[Command] /heartbeat - triggering heartbeat...');
        // Trigger heartbeat asynchronously
        this.onTriggerHeartbeat().catch(err => {
          console.error('[Heartbeat] Manual trigger failed:', err);
        });
        return '⏰ Heartbeat triggered (silent mode - check server logs)';
      }
      default:
        return null;
    }
  }
  
  /**
   * Start all registered channels
   */
  async start(): Promise<void> {
    const startPromises = Array.from(this.channels.entries()).map(async ([id, adapter]) => {
      try {
        console.log(`Starting channel: ${adapter.name}...`);
        await adapter.start();
        console.log(`Started channel: ${adapter.name}`);
      } catch (e) {
        console.error(`Failed to start channel ${id}:`, e);
      }
    });
    
    await Promise.all(startPromises);
  }
  
  /**
   * Stop all channels
   */
  async stop(): Promise<void> {
    for (const adapter of this.channels.values()) {
      try {
        await adapter.stop();
      } catch (e) {
        console.error(`Failed to stop channel ${adapter.id}:`, e);
      }
    }
  }
  
  /**
   * Queue incoming message for processing (prevents concurrent SDK sessions)
   */
  private async handleMessage(msg: InboundMessage, adapter: ChannelAdapter): Promise<void> {
    console.log(`[${msg.channel}] Message from ${msg.userId}: ${msg.text}`);
    
    // Add to queue
    this.messageQueue.push({ msg, adapter });
    
    // Process queue if not already processing
    if (!this.processing) {
      this.processQueue();
    }
  }
  
  /**
   * Process messages one at a time
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.messageQueue.length === 0) return;
    
    this.processing = true;
    
    while (this.messageQueue.length > 0) {
      const { msg, adapter } = this.messageQueue.shift()!;
      try {
        await this.processMessage(msg, adapter);
      } catch (error) {
        console.error('[Queue] Error processing message:', error);
      }
    }
    
    this.processing = false;
  }
  
  /**
   * Process a single message
   */
  private async processMessage(msg: InboundMessage, adapter: ChannelAdapter): Promise<void> {
    
    // Track last message target for heartbeat delivery
    this.store.lastMessageTarget = {
      channel: msg.channel,
      chatId: msg.chatId,
      messageId: msg.messageId,
      updatedAt: new Date().toISOString(),
    };
    
    // Start typing indicator
    await adapter.sendTypingIndicator(msg.chatId);
    
    // Create or resume session
    let session: Session;
    // Base options for all sessions (model only included for new agents)
    const baseOptions = {
      permissionMode: 'bypassPermissions' as const,
      allowedTools: this.config.allowedTools,
      cwd: this.config.workingDir,
      systemPrompt: SYSTEM_PROMPT,
    };
    

    
    try {
      if (this.store.agentId) {
        process.env.LETTA_AGENT_ID = this.store.agentId;
        // Don't pass model when resuming - agent already has its model configured
        session = resumeSession(this.store.agentId, baseOptions);
      } else {
        // Only pass model when creating a new agent
        session = createSession({ ...baseOptions, model: this.config.model, memory: loadMemoryBlocks(this.config.agentName) });
      }
      
      // Initialize session with timeout
      const initTimeoutMs = 30000;
      const withTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
        let timeoutId: NodeJS.Timeout;
        const timeoutPromise = new Promise<T>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`${label} timed out after ${initTimeoutMs}ms`));
          }, initTimeoutMs);
        });
        try {
          return await Promise.race([promise, timeoutPromise]);
        } finally {
          clearTimeout(timeoutId!);
        }
      };

      const initInfo = await withTimeout(session.initialize(), 'Session initialize');
      console.log('[Bot] Session initialized:', initInfo);

      // Send message to agent with metadata envelope
      const formattedMessage = formatMessageEnvelope(msg);
      console.log(`[Bot] Formatted message: ${formattedMessage.slice(0, 200)}`);
      try {
        await withTimeout(session.send(formattedMessage), 'Session send');
      } catch (sendError) {
        console.error('[Bot] Error in session.send():', sendError);
        throw sendError;
      }
      
      // Stream response
      let response = '';
      let lastUpdate = Date.now();
      let messageId: string | null = null;
      let sentAnyMessage = false; // Track if we've sent at least one message
      
      // Keep typing indicator alive
      const typingInterval = setInterval(() => {
        adapter.sendTypingIndicator(msg.chatId).catch(() => {});
      }, 4000);
      
      try {
        for await (const streamMsg of session.stream()) {
          // When a tool is called, finalize current message and start fresh for next turn
          if (streamMsg.type === 'tool_call') {
            if (response.length > 0) {
              // Send/finalize the current message before tool execution
              try {
                if (messageId) {
                  await adapter.editMessage(msg.chatId, messageId, response);
                } else {
                  await adapter.sendMessage({ chatId: msg.chatId, text: response, threadId: msg.threadId });
                }
                sentAnyMessage = true;
              } catch {
                // Ignore send errors
              }
              // Reset for next turn - new message bubble
              response = '';
              messageId = null;
              lastUpdate = Date.now();
            }
          }
          
          if (streamMsg.type === 'assistant') {
            response += streamMsg.content;
            
            // Stream updates only for channels that support editing (Telegram, Slack)
            const canEdit = adapter.supportsEditing?.() ?? true;
            if (canEdit && Date.now() - lastUpdate > 500 && response.length > 0) {
              try {
                if (messageId) {
                  await adapter.editMessage(msg.chatId, messageId, response);
                } else {
                  const result = await adapter.sendMessage({ chatId: msg.chatId, text: response, threadId: msg.threadId });
                  messageId = result.messageId;
                }
              } catch {
                // Ignore edit errors
              }
              lastUpdate = Date.now();
            }
          }
          
          if (streamMsg.type === 'result') {
            // Save agent ID and attach ignore tool (only on first message)
            if (session.agentId && session.agentId !== this.store.agentId) {
              const isNewAgent = !this.store.agentId;
              // Save agent ID along with the current server URL
              const currentBaseUrl = process.env.LETTA_BASE_URL || 'https://api.letta.com';
              this.store.setAgent(session.agentId, currentBaseUrl);
              console.log('Saved agent ID:', session.agentId, 'on server:', currentBaseUrl);
              
              // Setup new agents: set name, install skills
              if (isNewAgent) {
                if (this.config.agentName) {
                  updateAgentName(session.agentId, this.config.agentName).catch(() => {});
                }
                installSkillsToAgent(session.agentId);
              }
            }
            break;
          }
        }
      } finally {
        clearInterval(typingInterval);
      }
      
      console.log(`[Bot] Stream complete. Response length: ${response.length}`);
      console.log(`[Bot] Response preview: ${response.slice(0, 100)}...`);
      
      // Send final response
      if (response) {
        console.log(`[Bot] Sending final response (messageId=${messageId})`);
        try {
          if (messageId) {
            await adapter.editMessage(msg.chatId, messageId, response);
            console.log('[Bot] Edited existing message');
          } else {
            await adapter.sendMessage({ chatId: msg.chatId, text: response, threadId: msg.threadId });
            console.log('[Bot] Sent new message');
          }
        } catch (sendError) {
          console.error('[Bot] Error sending final message:', sendError);
          // If we already sent a streamed message, don't duplicate — the user already saw it.
          if (!messageId) {
            await adapter.sendMessage({ chatId: msg.chatId, text: response, threadId: msg.threadId });
          }
        }
      } else if (!sentAnyMessage) {
        // Only show "no response" if we haven't sent any messages at all
        console.log('[Bot] No response from agent, sending placeholder');
        await adapter.sendMessage({ chatId: msg.chatId, text: '(No response from agent)', threadId: msg.threadId });
      }
      
    } catch (error) {
      console.error('[Bot] Error processing message:', error);
      if (error instanceof Error) {
        console.error('[Bot] Error stack:', error.stack);
      }
      await adapter.sendMessage({
        chatId: msg.chatId,
        text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        threadId: msg.threadId,
      });
    } finally {
      console.log('[Bot] Closing session');
      session!?.close();
    }
  }
  
  /**
   * Send a message to the agent (for cron jobs, webhooks, etc.)
   * 
   * In silent mode (heartbeats, cron), the agent's text response is NOT auto-delivered.
   * The agent must use `lettabot-message` CLI via Bash to send messages explicitly.
   * 
   * @param text - The prompt/message to send
   * @param context - Optional trigger context (for logging/tracking)
   * @returns The agent's response text
   */
  async sendToAgent(
    text: string,
    _context?: TriggerContext
  ): Promise<string> {
    // Base options (model only for new agents)
    const baseOptions = {
      permissionMode: 'bypassPermissions' as const,
      allowedTools: this.config.allowedTools,
      cwd: this.config.workingDir,
      systemPrompt: SYSTEM_PROMPT,
    };
    
    let session: Session;
    if (this.store.agentId) {
      // Don't pass model when resuming - agent already has its model configured
      session = resumeSession(this.store.agentId, baseOptions);
    } else {
      // Only pass model when creating a new agent
      session = createSession({ ...baseOptions, model: this.config.model, memory: loadMemoryBlocks(this.config.agentName) });
    }
    
    try {
      await session.send(text);
      
      let response = '';
      let hadToolCall = false;
      for await (const msg of session.stream()) {
        // Track tool calls to know when to add separators between assistant turns
        if (msg.type === 'tool_call' || msg.type === 'tool_result') {
          hadToolCall = true;
        }
        
        if (msg.type === 'assistant') {
          // Add separator between assistant turns (after tool calls)
          if (hadToolCall && response.length > 0) {
            response += '\n\n';
            hadToolCall = false;
          }
          response += msg.content;
        }
        
        if (msg.type === 'result') {
          if (session.agentId && session.agentId !== this.store.agentId) {
            const currentBaseUrl = process.env.LETTA_BASE_URL || 'https://api.letta.com';
            this.store.setAgent(session.agentId, currentBaseUrl);
          }
          break;
        }
      }
      
      return response;
    } finally {
      session.close();
    }
  }
  
  /**
   * Deliver a message to a specific channel
   */
  async deliverToChannel(channelId: string, chatId: string, text: string): Promise<void> {
    const adapter = this.channels.get(channelId);
    if (!adapter) {
      console.error(`Channel not found: ${channelId}`);
      return;
    }
    await adapter.sendMessage({ chatId, text });
  }
  
  /**
   * Get bot status
   */
  getStatus(): { agentId: string | null; channels: string[] } {
    return {
      agentId: this.store.agentId,
      channels: Array.from(this.channels.keys()),
    };
  }
  
  
  /**
   * Reset agent (clear memory)
   */
  reset(): void {
    this.store.reset();
    console.log('Agent reset');
  }
  
  /**
   * Get the last message target (for heartbeat delivery)
   */
  getLastMessageTarget(): { channel: string; chatId: string } | null {
    return this.store.lastMessageTarget || null;
  }
}
