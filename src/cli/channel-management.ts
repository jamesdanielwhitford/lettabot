/**
 * Channel Management CLI
 * 
 * Ergonomic commands for adding, removing, and managing channels.
 * Follows the pattern from skills/sync.ts.
 */

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as p from '@clack/prompts';
import { loadConfig, saveConfig, resolveConfigPath } from '../config/index.js';
import type { LettaBotConfig, TelegramConfig, SlackConfig, DiscordConfig, WhatsAppConfig, SignalConfig } from '../config/types.js';

// Valid channel names
export const CHANNEL_NAMES = ['telegram', 'slack', 'discord', 'whatsapp', 'signal'] as const;
export type ChannelName = typeof CHANNEL_NAMES[number];

interface ChannelInfo {
  name: ChannelName;
  displayName: string;
  enabled: boolean;
  hint: string;
  details?: string;
}

/**
 * Get current status of all channels
 */
function getChannelStatus(): ChannelInfo[] {
  const config = loadConfig();
  const signalInstalled = spawnSync('which', ['signal-cli'], { stdio: 'pipe' }).status === 0;
  
  return [
    {
      name: 'telegram',
      displayName: 'Telegram',
      enabled: config.channels.telegram?.enabled || false,
      hint: 'Easiest to set up',
      details: config.channels.telegram?.enabled 
        ? `${config.channels.telegram.dmPolicy || 'pairing'} mode` 
        : undefined,
    },
    {
      name: 'slack',
      displayName: 'Slack',
      enabled: config.channels.slack?.enabled || false,
      hint: 'Socket Mode app',
      details: config.channels.slack?.enabled 
        ? config.channels.slack.allowedUsers?.length 
          ? `${config.channels.slack.allowedUsers.length} allowed users`
          : 'workspace access'
        : undefined,
    },
    {
      name: 'discord',
      displayName: 'Discord',
      enabled: config.channels.discord?.enabled || false,
      hint: 'Bot token + Message Content intent',
      details: config.channels.discord?.enabled 
        ? `${config.channels.discord.dmPolicy || 'pairing'} mode` 
        : undefined,
    },
    {
      name: 'whatsapp',
      displayName: 'WhatsApp',
      enabled: config.channels.whatsapp?.enabled || false,
      hint: 'QR code pairing',
      details: config.channels.whatsapp?.enabled 
        ? config.channels.whatsapp.selfChat !== false ? 'self-chat mode' : 'dedicated number'
        : undefined,
    },
    {
      name: 'signal',
      displayName: 'Signal',
      enabled: config.channels.signal?.enabled || false,
      hint: signalInstalled ? 'signal-cli daemon' : '⚠️ signal-cli not installed',
      details: config.channels.signal?.enabled 
        ? config.channels.signal.selfChat !== false ? 'self-chat mode' : 'dedicated number'
        : undefined,
    },
  ];
}

/**
 * List all channels and their status
 */
export async function listChannels(): Promise<void> {
  const channels = getChannelStatus();
  
  console.log('\n🔌 Channel Status\n');
  console.log('  Channel     Status      Details');
  console.log('  ──────────────────────────────────────────');
  
  for (const ch of channels) {
    const status = ch.enabled ? '✓ Enabled ' : '✗ Disabled';
    const details = ch.details || ch.hint;
    console.log(`  ${ch.displayName.padEnd(10)}  ${status}  ${details}`);
  }
  
  console.log('\n  Config: ' + resolveConfigPath());
  console.log('');
}

/**
 * Interactive channel management menu
 */
export async function interactiveChannelMenu(): Promise<void> {
  p.intro('🔌 Channel Management');
  
  const channels = getChannelStatus();
  const enabledCount = channels.filter(c => c.enabled).length;
  
  // Show current status
  const statusLines = channels.map(ch => {
    const status = ch.enabled ? '✓' : '✗';
    const details = ch.enabled && ch.details ? ` (${ch.details})` : '';
    return `  ${status} ${ch.displayName}${details}`;
  });
  
  p.note(statusLines.join('\n'), `${enabledCount} of ${channels.length} channels enabled`);
  
  const action = await p.select({
    message: 'What would you like to do?',
    options: [
      { value: 'add', label: 'Add a channel', hint: 'Set up a new integration' },
      { value: 'remove', label: 'Remove a channel', hint: 'Disable and clear config' },
      { value: 'toggle', label: 'Enable/disable a channel', hint: 'Quick toggle' },
      { value: 'edit', label: 'Edit channel settings', hint: 'Update existing config' },
      { value: 'exit', label: 'Exit', hint: '' },
    ],
  });
  
  if (p.isCancel(action) || action === 'exit') {
    p.outro('');
    return;
  }
  
  switch (action) {
    case 'add': {
      const disabled = channels.filter(c => !c.enabled);
      if (disabled.length === 0) {
        p.log.info('All channels are already enabled.');
        return interactiveChannelMenu();
      }
      
      const channel = await p.select({
        message: 'Which channel would you like to add?',
        options: disabled.map(c => ({
          value: c.name,
          label: c.displayName,
          hint: c.hint,
        })),
      });
      
      if (!p.isCancel(channel)) {
        await addChannel(channel as ChannelName);
      }
      break;
    }
    
    case 'remove': {
      const enabled = channels.filter(c => c.enabled);
      if (enabled.length === 0) {
        p.log.info('No channels are enabled.');
        return interactiveChannelMenu();
      }
      
      const channel = await p.select({
        message: 'Which channel would you like to remove?',
        options: enabled.map(c => ({
          value: c.name,
          label: c.displayName,
          hint: c.details || '',
        })),
      });
      
      if (!p.isCancel(channel)) {
        await removeChannel(channel as ChannelName);
      }
      break;
    }
    
    case 'toggle': {
      const channel = await p.select({
        message: 'Which channel would you like to toggle?',
        options: channels.map(c => ({
          value: c.name,
          label: `${c.enabled ? '✓' : '✗'} ${c.displayName}`,
          hint: c.enabled ? 'Click to disable' : 'Click to enable',
        })),
      });
      
      if (!p.isCancel(channel)) {
        const ch = channels.find(c => c.name === channel)!;
        await toggleChannel(channel as ChannelName, !ch.enabled);
      }
      break;
    }
    
    case 'edit': {
      const enabled = channels.filter(c => c.enabled);
      if (enabled.length === 0) {
        p.log.info('No channels are enabled. Add a channel first.');
        return interactiveChannelMenu();
      }
      
      const channel = await p.select({
        message: 'Which channel would you like to edit?',
        options: enabled.map(c => ({
          value: c.name,
          label: c.displayName,
          hint: c.details || '',
        })),
      });
      
      if (!p.isCancel(channel)) {
        await addChannel(channel as ChannelName); // Re-run setup to edit
      }
      break;
    }
  }
  
  p.outro('');
}

/**
 * Add/setup a specific channel
 */
export async function addChannel(channelName?: string): Promise<void> {
  if (!channelName) {
    p.intro('🔌 Add Channel');
    
    const channels = getChannelStatus();
    const disabled = channels.filter(c => !c.enabled);
    
    if (disabled.length === 0) {
      p.log.info('All channels are already enabled.');
      p.outro('');
      return;
    }
    
    const channel = await p.select({
      message: 'Which channel would you like to add?',
      options: disabled.map(c => ({
        value: c.name,
        label: c.displayName,
        hint: c.hint,
      })),
    });
    
    if (p.isCancel(channel)) {
      p.cancel('Cancelled');
      return;
    }
    
    channelName = channel as string;
  }
  
  if (!CHANNEL_NAMES.includes(channelName as ChannelName)) {
    console.error(`Unknown channel: ${channelName}`);
    console.error(`Valid channels: ${CHANNEL_NAMES.join(', ')}`);
    process.exit(1);
  }
  
  const config = loadConfig();
  
  switch (channelName) {
    case 'telegram':
      await setupTelegram(config);
      break;
    case 'slack':
      await setupSlack(config);
      break;
    case 'discord':
      await setupDiscord(config);
      break;
    case 'whatsapp':
      await setupWhatsApp(config);
      break;
    case 'signal':
      await setupSignal(config);
      break;
  }
  
  // Save config
  saveConfig(config);
  p.log.success(`Configuration saved to ${resolveConfigPath()}`);
}

/**
 * Remove/disable a channel
 */
export async function removeChannel(channelName?: string): Promise<void> {
  if (!channelName) {
    console.error('Usage: lettabot channels remove <channel>');
    console.error(`Valid channels: ${CHANNEL_NAMES.join(', ')}`);
    process.exit(1);
  }
  
  if (!CHANNEL_NAMES.includes(channelName as ChannelName)) {
    console.error(`Unknown channel: ${channelName}`);
    console.error(`Valid channels: ${CHANNEL_NAMES.join(', ')}`);
    process.exit(1);
  }
  
  const config = loadConfig();
  const channelConfig = config.channels[channelName as ChannelName];
  
  if (!channelConfig?.enabled) {
    console.log(`${channelName} is already disabled.`);
    return;
  }
  
  const confirmed = await p.confirm({
    message: `Remove ${channelName}? This will disable the channel.`,
    initialValue: false,
  });
  
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel('Cancelled');
    return;
  }
  
  // Disable the channel
  if (config.channels[channelName as ChannelName]) {
    (config.channels[channelName as ChannelName] as any).enabled = false;
  }
  
  saveConfig(config);
  p.log.success(`${channelName} disabled`);
}

/**
 * Quick enable/disable toggle
 */
export async function toggleChannel(channelName?: string, enable?: boolean): Promise<void> {
  if (!channelName) {
    console.error('Usage: lettabot channels enable|disable <channel>');
    console.error(`Valid channels: ${CHANNEL_NAMES.join(', ')}`);
    process.exit(1);
  }
  
  if (!CHANNEL_NAMES.includes(channelName as ChannelName)) {
    console.error(`Unknown channel: ${channelName}`);
    console.error(`Valid channels: ${CHANNEL_NAMES.join(', ')}`);
    process.exit(1);
  }
  
  const config = loadConfig();
  const channelConfig = config.channels[channelName as ChannelName];
  
  // If trying to enable but no config exists, run full setup
  if (enable && (!channelConfig || !hasRequiredConfig(channelName as ChannelName, channelConfig))) {
    console.log(`${channelName} is not configured. Running setup...`);
    return addChannel(channelName);
  }
  
  if (channelConfig) {
    (channelConfig as any).enabled = enable;
    saveConfig(config);
    console.log(`✓ ${channelName} ${enable ? 'enabled' : 'disabled'}`);
  }
}

/**
 * Check if a channel has required configuration
 */
function hasRequiredConfig(channel: ChannelName, config: any): boolean {
  if (!config) return false;
  
  switch (channel) {
    case 'telegram':
      return !!config.token;
    case 'slack':
      return !!config.appToken && !!config.botToken;
    case 'discord':
      return !!config.token;
    case 'whatsapp':
      return true; // No token needed, uses QR code
    case 'signal':
      return !!config.phone;
    default:
      return false;
  }
}

// ============================================================================
// Individual Channel Setup Functions
// ============================================================================

async function setupTelegram(config: LettaBotConfig): Promise<void> {
  const existing = config.channels.telegram;
  
  p.note(
    '1. Message @BotFather on Telegram\n' +
    '2. Send /newbot and follow prompts\n' +
    '3. Copy the bot token',
    'Telegram Setup'
  );
  
  const token = await p.text({
    message: 'Telegram Bot Token',
    placeholder: '123456:ABC-DEF...',
    initialValue: existing?.token || '',
  });
  
  if (p.isCancel(token)) {
    p.cancel('Cancelled');
    process.exit(0);
  }
  
  // DM Policy
  const dmPolicy = await p.select({
    message: 'Who can message the bot?',
    options: [
      { value: 'pairing', label: 'Pairing (recommended)', hint: 'Requires CLI approval' },
      { value: 'allowlist', label: 'Allowlist only', hint: 'Specific user IDs' },
      { value: 'open', label: 'Open', hint: 'Anyone (not recommended)' },
    ],
    initialValue: existing?.dmPolicy || 'pairing',
  });
  
  if (p.isCancel(dmPolicy)) {
    p.cancel('Cancelled');
    process.exit(0);
  }
  
  let allowedUsers: string[] | undefined;
  
  if (dmPolicy === 'pairing') {
    p.log.info('Users will get a code. Approve with: lettabot pairing approve telegram CODE');
  } else if (dmPolicy === 'allowlist') {
    const users = await p.text({
      message: 'Allowed Telegram user IDs (comma-separated)',
      placeholder: '123456789,987654321',
      initialValue: existing?.allowedUsers?.join(',') || '',
    });
    if (!p.isCancel(users) && users) {
      allowedUsers = users.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  
  config.channels.telegram = {
    enabled: true,
    token: token || undefined,
    dmPolicy: dmPolicy as 'pairing' | 'allowlist' | 'open',
    allowedUsers,
  };
}

async function setupSlack(config: LettaBotConfig): Promise<void> {
  const existing = config.channels.slack;
  const hasExistingTokens = existing?.appToken || existing?.botToken;
  
  p.note(
    'Requires two tokens from api.slack.com/apps:\n' +
    '  • App Token (xapp-...) - Socket Mode\n' +
    '  • Bot Token (xoxb-...) - Bot permissions',
    'Slack Requirements'
  );
  
  const wizardChoice = await p.select({
    message: 'Slack setup',
    options: [
      { value: 'wizard', label: 'Guided setup', hint: 'Step-by-step instructions with validation' },
      { value: 'manual', label: 'Manual entry', hint: 'I already have tokens' },
    ],
    initialValue: hasExistingTokens ? 'manual' : 'wizard',
  });
  
  if (p.isCancel(wizardChoice)) {
    p.cancel('Cancelled');
    process.exit(0);
  }
  
  if (wizardChoice === 'wizard') {
    const { runSlackWizard } = await import('../setup/slack-wizard.js');
    const result = await runSlackWizard({
      appToken: existing?.appToken,
      botToken: existing?.botToken,
      allowedUsers: existing?.allowedUsers,
    });
    
    if (result) {
      config.channels.slack = {
        enabled: true,
        appToken: result.appToken,
        botToken: result.botToken,
        allowedUsers: result.allowedUsers,
      };
    }
  } else {
    const { validateSlackTokens, stepAccessControl, validateAppToken, validateBotToken } = await import('../setup/slack-wizard.js');
    
    p.note(
      'Get tokens from api.slack.com/apps:\n' +
      '• Enable Socket Mode → App-Level Token (xapp-...)\n' +
      '• Install App → Bot User OAuth Token (xoxb-...)\n\n' +
      'See docs/slack-setup.md for detailed instructions',
      'Slack Setup'
    );
    
    const appToken = await p.text({
      message: 'Slack App Token (xapp-...)',
      initialValue: existing?.appToken || '',
      validate: validateAppToken,
    });
    
    if (p.isCancel(appToken)) {
      p.cancel('Cancelled');
      process.exit(0);
    }
    
    const botToken = await p.text({
      message: 'Slack Bot Token (xoxb-...)',
      initialValue: existing?.botToken || '',
      validate: validateBotToken,
    });
    
    if (p.isCancel(botToken)) {
      p.cancel('Cancelled');
      process.exit(0);
    }
    
    // Validate tokens
    if (appToken && botToken) {
      await validateSlackTokens(appToken, botToken);
    }
    
    const allowedUsers = await stepAccessControl(existing?.allowedUsers);
    
    config.channels.slack = {
      enabled: true,
      appToken: appToken || undefined,
      botToken: botToken || undefined,
      allowedUsers,
    };
  }
}

async function setupDiscord(config: LettaBotConfig): Promise<void> {
  const existing = config.channels.discord;
  
  p.note(
    '1. Go to discord.com/developers/applications\n' +
    '2. Click "New Application" (or select existing)\n' +
    '3. Go to "Bot" → Copy the Bot Token\n' +
    '4. Enable "Message Content Intent" (under Privileged Gateway Intents)\n' +
    '5. Go to "OAuth2" → "URL Generator"\n' +
    '   • Scopes: bot\n' +
    '   • Permissions: Send Messages, Read Message History, View Channels\n' +
    '6. Copy the generated URL and open it to invite the bot to your server',
    'Discord Setup'
  );
  
  const token = await p.text({
    message: 'Discord Bot Token',
    placeholder: 'Bot → Reset Token → Copy',
    initialValue: existing?.token || '',
  });
  
  if (p.isCancel(token)) {
    p.cancel('Cancelled');
    process.exit(0);
  }
  
  // Try to show invite URL
  if (token) {
    try {
      const appId = Buffer.from(token.split('.')[0], 'base64').toString();
      if (/^\d+$/.test(appId)) {
        const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${appId}&permissions=68608&scope=bot`;
        p.log.info(`Invite URL: ${inviteUrl}`);
        p.log.message('Open this URL in your browser to add the bot to your server.');
      }
    } catch {
      // Token parsing failed
    }
  }
  
  // DM Policy
  const dmPolicy = await p.select({
    message: 'Who can message the bot?',
    options: [
      { value: 'pairing', label: 'Pairing (recommended)', hint: 'Requires CLI approval' },
      { value: 'allowlist', label: 'Allowlist only', hint: 'Specific user IDs' },
      { value: 'open', label: 'Open', hint: 'Anyone (not recommended)' },
    ],
    initialValue: existing?.dmPolicy || 'pairing',
  });
  
  if (p.isCancel(dmPolicy)) {
    p.cancel('Cancelled');
    process.exit(0);
  }
  
  let allowedUsers: string[] | undefined;
  
  if (dmPolicy === 'pairing') {
    p.log.info('Users will get a code. Approve with: lettabot pairing approve discord CODE');
  } else if (dmPolicy === 'allowlist') {
    const users = await p.text({
      message: 'Allowed Discord user IDs (comma-separated)',
      placeholder: '123456789012345678,987654321098765432',
      initialValue: existing?.allowedUsers?.join(',') || '',
    });
    if (!p.isCancel(users) && users) {
      allowedUsers = users.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  
  config.channels.discord = {
    enabled: true,
    token: token || undefined,
    dmPolicy: dmPolicy as 'pairing' | 'allowlist' | 'open',
    allowedUsers,
  };
}

async function setupWhatsApp(config: LettaBotConfig): Promise<void> {
  const existing = config.channels.whatsapp;
  
  p.note(
    'QR code will appear on first run - scan with your phone.\n' +
    'Phone: Settings → Linked Devices → Link a Device\n\n' +
    '⚠️  Security: Links as a full device to your WhatsApp account.\n' +
    'Can see ALL messages, not just ones sent to the bot.\n' +
    'Consider using a dedicated number for better isolation.',
    'WhatsApp'
  );
  
  const selfChat = await p.select({
    message: 'Whose number is this?',
    options: [
      { value: 'personal', label: 'My personal number (recommended)', hint: 'SAFE: Only "Message Yourself" chat' },
      { value: 'dedicated', label: 'Dedicated bot number', hint: 'Bot responds to anyone who messages' },
    ],
    initialValue: existing?.selfChat !== false ? 'personal' : 'dedicated',
  });
  
  if (p.isCancel(selfChat)) {
    p.cancel('Cancelled');
    process.exit(0);
  }
  
  const isSelfChat = selfChat === 'personal';
  
  if (!isSelfChat) {
    p.log.warn('Dedicated number mode: Bot will respond to ALL incoming messages.');
    p.log.warn('Only use this if this number is EXCLUSIVELY for the bot.');
  }
  
  let dmPolicy: 'pairing' | 'allowlist' | 'open' = 'pairing';
  let allowedUsers: string[] | undefined;
  
  // Dedicated numbers need allowlist
  if (!isSelfChat) {
    dmPolicy = 'allowlist';
    const users = await p.text({
      message: 'Allowed phone numbers (comma-separated, with +)',
      placeholder: '+15551234567,+15559876543',
      initialValue: existing?.allowedUsers?.join(',') || '',
    });
    if (!p.isCancel(users) && users) {
      allowedUsers = users.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (!allowedUsers?.length) {
      p.log.warn('No allowed numbers set. Bot will reject all messages until you add numbers to lettabot.yaml');
    }
  }
  
  config.channels.whatsapp = {
    enabled: true,
    selfChat: isSelfChat,
    dmPolicy,
    allowedUsers,
  };
  
  p.log.info('Run "lettabot server" to see the QR code and complete pairing.');
}

async function setupSignal(config: LettaBotConfig): Promise<void> {
  const existing = config.channels.signal;
  
  // Check if signal-cli is installed
  const signalInstalled = spawnSync('which', ['signal-cli'], { stdio: 'pipe' }).status === 0;
  
  if (!signalInstalled) {
    p.log.warn('signal-cli is not installed.');
    p.log.info('Install with: brew install signal-cli');
    
    const continueAnyway = await p.confirm({
      message: 'Continue setup anyway?',
      initialValue: false,
    });
    
    if (p.isCancel(continueAnyway) || !continueAnyway) {
      p.cancel('Cancelled');
      process.exit(0);
    }
  }
  
  p.note(
    'See docs/signal-setup.md for detailed instructions.\n' +
    'Requires signal-cli registered with your phone number.\n\n' +
    '⚠️  Security: Has full access to your Signal account.\n' +
    'Can see all messages and send as you.',
    'Signal Setup'
  );
  
  const phone = await p.text({
    message: 'Signal phone number',
    placeholder: '+1XXXXXXXXXX',
    initialValue: existing?.phone || '',
  });
  
  if (p.isCancel(phone)) {
    p.cancel('Cancelled');
    process.exit(0);
  }
  
  const selfChat = await p.select({
    message: 'Whose number is this?',
    options: [
      { value: 'personal', label: 'My personal number (recommended)', hint: 'SAFE: Only "Note to Self" chat' },
      { value: 'dedicated', label: 'Dedicated bot number', hint: 'Bot responds to anyone who messages' },
    ],
    initialValue: existing?.selfChat !== false ? 'personal' : 'dedicated',
  });
  
  if (p.isCancel(selfChat)) {
    p.cancel('Cancelled');
    process.exit(0);
  }
  
  const isSelfChat = selfChat === 'personal';
  
  if (!isSelfChat) {
    p.log.warn('Dedicated number mode: Bot will respond to ALL incoming messages.');
    p.log.warn('Only use this if this number is EXCLUSIVELY for the bot.');
  }
  
  let dmPolicy: 'pairing' | 'allowlist' | 'open' = 'pairing';
  let allowedUsers: string[] | undefined;
  
  // Dedicated numbers need allowlist
  if (!isSelfChat) {
    dmPolicy = 'allowlist';
    const users = await p.text({
      message: 'Allowed phone numbers (comma-separated, with +)',
      placeholder: '+15551234567,+15559876543',
      initialValue: existing?.allowedUsers?.join(',') || '',
    });
    if (!p.isCancel(users) && users) {
      allowedUsers = users.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (!allowedUsers?.length) {
      p.log.warn('No allowed numbers set. Bot will reject all messages until you add numbers to lettabot.yaml');
    }
  }
  
  config.channels.signal = {
    enabled: true,
    phone: phone || undefined,
    selfChat: isSelfChat,
    dmPolicy,
    allowedUsers,
  };
}

// ============================================================================
// Main Command Handler
// ============================================================================

export async function channelManagementCommand(subCommand?: string, channelName?: string): Promise<void> {
  switch (subCommand) {
    case 'list':
    case 'ls':
      await listChannels();
      break;
      
    case 'add':
      await addChannel(channelName);
      break;
      
    case 'remove':
    case 'rm':
      await removeChannel(channelName);
      break;
      
    case 'enable':
      await toggleChannel(channelName, true);
      break;
      
    case 'disable':
      await toggleChannel(channelName, false);
      break;
      
    default:
      // No subcommand = interactive menu
      await interactiveChannelMenu();
      break;
  }
}
