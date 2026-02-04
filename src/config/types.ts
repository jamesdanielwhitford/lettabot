/**
 * LettaBot Configuration Types
 * 
 * Two modes:
 * 1. Self-hosted: Uses baseUrl (e.g., http://localhost:8283), no API key
 * 2. Letta Cloud: Uses apiKey, optional BYOK providers
 * 
 * Agent modes:
 * 1. Single agent (legacy): Uses `agent` field
 * 2. Multi-agent: Uses `agents.list[]` with routing via `bindings[]`
 */

// =============================================================================
// Multi-Agent Configuration
// =============================================================================

/**
 * Agent definition for multi-agent mode
 */
export interface AgentConfig {
  /** Unique identifier (e.g., "home", "work") */
  id: string;
  /** Display name */
  name?: string;
  /** Is this the default agent? (receives unrouted messages) */
  default?: boolean;
  /** Working directory for this agent (required) */
  workspace: string;
  /** Model override (optional, falls back to agents.defaults.model) */
  model?: string;
  // Note: Skills are managed by Letta Code - no skills config here
}

/**
 * Default settings applied to all agents
 */
export interface AgentDefaults {
  /** Default model for all agents */
  model?: string;
}

/**
 * Multi-agent configuration
 */
export interface AgentsConfig {
  defaults?: AgentDefaults;
  list?: AgentConfig[];
}

/**
 * Binding for routing messages to agents
 * Priority: peer > accountId > channel > default agent
 */
export interface AgentBinding {
  /** Target agent ID */
  agentId: string;
  /** Match criteria */
  match: {
    /** Channel type: "telegram", "discord", "slack", etc. */
    channel: string;
    /** For multi-account channels (e.g., multiple Telegram bots) */
    accountId?: string;
    /** Specific chat/user routing */
    peer?: {
      kind: 'dm' | 'group';
      id: string;
    };
  };
}

// =============================================================================
// Channel Configurations (with multi-account support)
// =============================================================================

/** Common account settings for channels */
export interface ChannelAccountBase {
  /** Display name for this account */
  name?: string;
  /** DM access policy */
  dmPolicy?: 'pairing' | 'allowlist' | 'open';
  /** Allowed user IDs/usernames */
  allowedUsers?: string[];
}

/** Telegram account configuration */
export interface TelegramAccountConfig extends ChannelAccountBase {
  token: string;
}

export interface TelegramConfig extends ChannelAccountBase {
  enabled: boolean;
  /** Default account token (legacy single-account mode) */
  token?: string;
  /** Multi-account configuration */
  accounts?: Record<string, TelegramAccountConfig>;
}

/** Slack account configuration */
export interface SlackAccountConfig extends ChannelAccountBase {
  appToken: string;
  botToken: string;
}

export interface SlackConfig extends ChannelAccountBase {
  enabled: boolean;
  /** Default account tokens (legacy single-account mode) */
  appToken?: string;
  botToken?: string;
  /** Multi-account configuration */
  accounts?: Record<string, SlackAccountConfig>;
}

/** Discord account configuration */
export interface DiscordAccountConfig extends ChannelAccountBase {
  token: string;
}

export interface DiscordConfig extends ChannelAccountBase {
  enabled: boolean;
  /** Default account token (legacy single-account mode) */
  token?: string;
  /** Multi-account configuration */
  accounts?: Record<string, DiscordAccountConfig>;
}

/** WhatsApp account configuration */
export interface WhatsAppAccountConfig extends ChannelAccountBase {
  /** Session storage path */
  sessionPath?: string;
  /** Enable self-chat mode (only respond to messages from yourself) */
  selfChat?: boolean;
}

export interface WhatsAppConfig extends ChannelAccountBase {
  enabled: boolean;
  /** Session storage path (legacy single-account mode) */
  sessionPath?: string;
  selfChat?: boolean;
  /** Multi-account configuration */
  accounts?: Record<string, WhatsAppAccountConfig>;
}

/** Signal account configuration */
export interface SignalAccountConfig extends ChannelAccountBase {
  phone: string;
  selfChat?: boolean;
}

export interface SignalConfig extends ChannelAccountBase {
  enabled: boolean;
  /** Phone number (legacy single-account mode) */
  phone?: string;
  selfChat?: boolean;
  /** Multi-account configuration */
  accounts?: Record<string, SignalAccountConfig>;
}

// =============================================================================
// Main Configuration
// =============================================================================

export interface LettaBotConfig {
  // Server connection
  server: {
    // 'cloud' (api.letta.com) or 'selfhosted'
    mode: 'cloud' | 'selfhosted';
    // Only for selfhosted mode
    baseUrl?: string;
    // Only for cloud mode
    apiKey?: string;
  };

  // ===================
  // Multi-agent mode (new)
  // ===================
  /** Multi-agent configuration */
  agents?: AgentsConfig;
  /** Routing rules: map channel/account/peer to agents */
  bindings?: AgentBinding[];

  // ===================
  // Single-agent mode (legacy, backwards compatible)
  // ===================
  /** Legacy single agent configuration */
  agent?: {
    id?: string;
    name: string;
    model: string;
  };

  // BYOK providers (cloud mode only)
  providers?: ProviderConfig[];

  // Channel configurations (now with multi-account support)
  channels: {
    telegram?: TelegramConfig;
    slack?: SlackConfig;
    whatsapp?: WhatsAppConfig;
    signal?: SignalConfig;
    discord?: DiscordConfig;
  };

  // Features
  features?: {
    cron?: boolean;
    heartbeat?: {
      enabled: boolean;
      intervalMin?: number;
      /** Target for heartbeat messages (e.g., "telegram:123456") */
      target?: string;
      /** Custom prompt for heartbeat */
      prompt?: string;
    };
  };

  // Integrations (Google Workspace, etc.)
  integrations?: {
    google?: GoogleConfig;
  };

  // Transcription (voice messages)
  transcription?: TranscriptionConfig;

  // Attachment handling
  attachments?: {
    maxMB?: number;
    maxAgeDays?: number;
  };
}

// =============================================================================
// Normalized Configuration (after processing)
// =============================================================================

/**
 * Normalized config with guaranteed multi-agent structure
 * This is what the runtime uses after config normalization
 */
export interface NormalizedConfig extends Omit<LettaBotConfig, 'agent'> {
  agents: {
    defaults: AgentDefaults;
    list: AgentConfig[];
  };
  bindings: AgentBinding[];
}

// =============================================================================
// Other Types
// =============================================================================

export interface TranscriptionConfig {
  provider: 'openai';  // Only OpenAI supported currently
  apiKey?: string;     // Falls back to OPENAI_API_KEY env var
  model?: string;      // Defaults to 'whisper-1'
}

export interface ProviderConfig {
  id: string;           // e.g., 'anthropic', 'openai'
  name: string;         // e.g., 'lc-anthropic'
  type: string;         // e.g., 'anthropic', 'openai'
  apiKey: string;
}

export interface GoogleConfig {
  enabled: boolean;
  account?: string;
  services?: string[];  // e.g., ['gmail', 'calendar', 'drive', 'contacts', 'docs', 'sheets']
}

// Default config
export const DEFAULT_CONFIG: LettaBotConfig = {
  server: {
    mode: 'cloud',
  },
  agent: {
    name: 'LettaBot',
    model: 'zai/glm-4.7', // Free model default
  },
  channels: {},
};

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if config uses multi-agent mode
 */
export function isMultiAgentConfig(config: LettaBotConfig): boolean {
  return !!(config.agents?.list && config.agents.list.length > 0);
}

/**
 * Get the default agent ID from config
 */
export function getDefaultAgentId(config: LettaBotConfig | NormalizedConfig): string {
  if ('agents' in config && config.agents?.list) {
    const defaultAgent = config.agents.list.find(a => a.default);
    if (defaultAgent) return defaultAgent.id;
    if (config.agents.list.length > 0) return config.agents.list[0].id;
  }
  return 'main';
}
