import "dotenv/config";
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
import { ethers } from 'ethers';

// Environment variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;      // Your bot’s application ID
const GUILD_ID = process.env.GUILD_ID;        // For testing; use a specific guild ID
const BSC_RPC_URL = process.env.BSC_RPC_URL;
const MEMECOIN_ADDRESS = process.env.MEMECOIN_ADDRESS;
const BOT_PRIVATE_KEY = process.env.BOT_PRIVATE_KEY;
const TOKEN_DECIMALS = process.env.TOKEN_DECIMALS || 18;

// Set up ethers provider for BSC
const provider = new ethers.providers.JsonRpcProvider(BSC_RPC_URL);

// Bot wallet (for droptip escrow)
const botWallet = new ethers.Wallet(BOT_PRIVATE_KEY, provider);

// Minimal ERC‑20 ABI for balance and transfer
const tokenAbi = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
];
const tokenContract = new ethers.Contract(MEMECOIN_ADDRESS, tokenAbi, provider);

// In-memory stores
const userWallets = new Map();  // Map Discord user ID => ethers wallet
const droptips = new Map();     // Map droptip ID => droptip object
let nextDroptipId = 1;

// Helper: get or create a user's wallet
function getUserWallet(userId) {
  if (userWallets.has(userId)) {
    return userWallets.get(userId);
  }
  const wallet = ethers.Wallet.createRandom().connect(provider);
  userWallets.set(userId, wallet);
  console.log(`Created wallet for user ${userId}: ${wallet.address}`);
  return wallet;
}

/* ===============================
   SLASH COMMAND REGISTRATION
   =============================== */

const commands = [
  new SlashCommandBuilder()
    .setName('wallet')
    .setDescription('Display your wallet address and token balance.'),
  new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Get your deposit address to receive tokens.'),
  new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Withdraw tokens to an external address.')
    .addStringOption(option =>
      option.setName('amount')
        .setDescription('Amount of tokens to withdraw')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('destination')
        .setDescription('Destination wallet address')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('tip')
    .setDescription('Tip another user tokens.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to tip')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('amount')
        .setDescription('Amount of tokens to tip')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('droptip')
    .setDescription('Drop a tip that anyone can claim.')
    .addStringOption(option =>
      option.setName('amount')
        .setDescription('Amount of tokens to droptip')
        .setRequired(true))
].map(command => command.toJSON());

// Register slash commands for a specific guild (for testing)
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
(async () => {
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();

/* ===============================
   DISCORD CLIENT SETUP
   =============================== */

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Listen for interactions (commands & buttons)
client.on('interactionCreate', async (interaction) => {
  // Slash Commands
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;
    // /wallet - show wallet address and token balance
    if (commandName === 'wallet') {
      const wallet = getUserWallet(interaction.user.id);
      let balance;
      try {
        balance = await tokenContract.balanceOf(wallet.address);
      } catch (err) {
        console.error(err);
        balance = ethers.BigNumber.from(0);
      }
      const formatted = ethers.utils.formatUnits(balance, TOKEN_DECIMALS);
      await interaction.reply(`Your wallet address is: \`${wallet.address}\`\nToken Balance: ${formatted}`);
    }
    // /deposit - show wallet deposit instructions
    else if (commandName === 'deposit') {
      const wallet = getUserWallet(interaction.user.id);
      await interaction.reply(`To deposit tokens, send them to your wallet address:\n**${wallet.address}**`);
    }
    // /withdraw <amount> <destination>
    else if (commandName === 'withdraw') {
      const amount = interaction.options.getString('amount');
      const destination = interaction.options.getString('destination');
      const wallet = getUserWallet(interaction.user.id);
      const userTokenContract = tokenContract.connect(wallet);
      try {
        const tx = await userTokenContract.transfer(destination, ethers.utils.parseUnits(amount, TOKEN_DECIMALS));
        await tx.wait();
        await interaction.reply(`Withdrawal successful!\nSent ${amount} tokens to \`${destination}\`\nTransaction Hash: \`${tx.hash}\``);
      } catch (err) {
        console.error(err);
        await interaction.reply(`Withdrawal failed: ${err.message}`);
      }
    }
    // /tip <user> <amount>
    else if (commandName === 'tip') {
      const targetUser = interaction.options.getUser('user');
      const amount = interaction.options.getString('amount');
      const targetId = targetUser.id;
      if (targetId === interaction.user.id) {
        return interaction.reply("You cannot tip yourself.");
      }
      const senderWallet = getUserWallet(interaction.user.id);
      const recipientWallet = getUserWallet(targetId);
      const senderTokenContract = tokenContract.connect(senderWallet);
      try {
        const tx = await senderTokenContract.transfer(recipientWallet.address, ethers.utils.parseUnits(amount, TOKEN_DECIMALS));
        await tx.wait();
        await interaction.reply(`You tipped ${amount} tokens to <@${targetId}>!\nTransaction Hash: \`${tx.hash}\``);
      } catch (err) {
        console.error(err);
        await interaction.reply(`Tip failed: ${err.message}`);
      }
    }
    // /droptip <amount>
    else if (commandName === 'droptip') {
      const amount = interaction.options.getString('amount');
      const senderWallet = getUserWallet(interaction.user.id);
      const senderTokenContract = tokenContract.connect(senderWallet);
      try {
        // Transfer tokens from sender to bot wallet (escrow)
        const tx = await senderTokenContract.transfer(botWallet.address, ethers.utils.parseUnits(amount, TOKEN_DECIMALS));
        await tx.wait();
        // Create droptip record
        const droptipId = nextDroptipId++;
        const droptip = {
          id: droptipId,
          senderId: interaction.user.id,
          amount: ethers.utils.parseUnits(amount, TOKEN_DECIMALS),
          claimed: false
        };
        droptips.set(droptipId, droptip);
        // Create a button for claiming the droptip
        const claimButton = new ButtonBuilder()
          .setCustomId(`claim_droptip_${droptipId}`)
          .setLabel("Claim Droptip")
          .setStyle(ButtonStyle.Primary);
        const row = new ActionRowBuilder().addComponents(claimButton);
        await interaction.reply({ content: `Droptip of ${amount} tokens dropped!\nAnyone can claim it by clicking the button below.`, components: [row] });
      } catch (err) {
        console.error(err);
        await interaction.reply(`Droptip failed: ${err.message}`);
      }
    }
  }
  // Button Interactions (for droptip claims)
  else if (interaction.isButton()) {
    const customId = interaction.customId;
    if (customId.startsWith("claim_droptip_")) {
      const droptipId = parseInt(customId.split("_")[2]);
      const droptip = droptips.get(droptipId);
      if (!droptip || droptip.claimed) {
        return interaction.reply({ content: "This droptip is no longer available.", ephemeral: true });
      }
      const claimerWallet = getUserWallet(interaction.user.id);
      const botTokenContract = tokenContract.connect(botWallet);
      try {
        const tx = await botTokenContract.transfer(claimerWallet.address, droptip.amount);
        await tx.wait();
        droptip.claimed = true;
        droptips.set(droptipId, droptip);
        await interaction.reply({ content: `You claimed ${ethers.utils.formatUnits(droptip.amount, TOKEN_DECIMALS)} tokens!\nTransaction Hash: \`${tx.hash}\`` });
      } catch (err) {
        console.error(err);
        await interaction.reply({ content: `Claim failed: ${err.message}`, ephemeral: true });
      }
    }
  }
});

// Log in to Discord
client.login(DISCORD_TOKEN);
