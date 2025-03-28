import "dotenv/config";
import abi from "./abi.js";
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, time, EmbedBuilder } from 'discord.js';
import { ethers, formatUnits, parseUnits } from 'ethers';
import { mnemonicToEntropy } from "bip39";
import axios from "axios"
import crypto from 'crypto';
const algorithm = 'aes-256-cbc';

// Environment variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;      // Your bot’s application ID
const GUILD_ID = process.env.GUILD_ID;        // For testing; use a specific guild ID                   
const BSC_RPC_URL = process.env.BSC_RPC_URL;
const MEMECOIN_ADDRESS = process.env.MEMECOIN_ADDRESS;
const BOT_PRIVATE_KEY = process.env.BOT_PRIVATE_KEY;
const TOKEN_DECIMALS = parseInt(process.env.TOKEN_DECIMALS) ?? 18;
const BOT_ADDRESS = process.env.BOT_ADDRESS
const secretKey = crypto.scryptSync(process.env.SECRET_KEY, 'salt', 32); // Derive 32-byte key



// Set up ethers provider for BSC
const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);



const tokenContract = new ethers.Contract(MEMECOIN_ADDRESS, abi, provider);

// Bot wallet (for droptip escrow)
const botWallet = new ethers.Wallet(BOT_PRIVATE_KEY, provider);



// In-memory stores
const droptips = new Map();     // Map droptip ID => droptip object
let nextDroptipId = 1;

function encryptPrivateKey(privateKey) {
  const iv = crypto.randomBytes(16);
  console.log(secretKey)
  const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { encryptedData: encrypted, iv: iv.toString('hex') };
}

// Decrypt function
function decryptPrivateKey(encryptedData, iv) {
  const decipher = crypto.createDecipheriv(algorithm, secretKey, Buffer.from(iv, 'hex'));
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Helper: get or create a user's wallet
async function getUserWallet(userId) {
  console.log(`Fetching wallet for user ID: ${userId}`);

  try {
    const res = await axios.get(`http://tipper-server.onrender.com/api/wallets/${userId}`);
    console.log(`Wallet retrieved from API: ${JSON.stringify(res.data)}`);
    return res.data.wallet; // Assuming API returns { wallet: { address: "0x..." } }
  } catch (err) {
    if (err.response && err.response.status === 404) {
      console.log("Wallet not found, creating a new one...");
      
      const wallet = ethers.Wallet.createRandom().connect(provider);

      const enc = encryptPrivateKey(wallet.privateKey);

      const v = enc.encryptedData;
      const iv = enc.iv;
      try {
        console.log('trying...');
        await axios.post(`http://tipper-server.onrender.com/api/wallets/newWallet`, {
          userId,
          wallet: {v: v, iv: iv, wallet: wallet.address} // Ensure valid structure
        });
        console.log(`New wallet created and stored: ${wallet.address}`);
        return wallet.address;
      } catch (saveErr) {
        console.error(`Error saving new wallet: ${saveErr.message}`);
        return null; // Prevents further errors
      }
    } else {
      console.error(`Unexpected error fetching wallet: ${err.message}`);
      return null;
    }
  }
}
async function getDroptip(droptipId) {
  console.log(`Fetching droptip for Droptip ID: ${droptipId}`);

  try {
    const res = await axios.get(`http://tipper-server.onrender.com/api/droptips/${droptipId}`);
    console.log(`Droptip retrieved from API: ${JSON.stringify(res.data)}`);
    return res.data.droptip; // Assuming API returns { wallet: { address: "0x..." } }
  }catch(error){
    console.log(error);
  }
}

async function getKey(UserId) {
  console.log(`Fetching key for ID: ${UserId}`);

  try {
    const res = await axios.get(`http://tipper-server.onrender.com/api/wallets/privateKey/${UserId}`);
    console.log(`private key retrieved from API: ${JSON.stringify(res.data)}`);
    const decryptedKey = decryptPrivateKey(res.data.v, res.data.iv);
    return decryptedKey; 
  }catch(error){
    console.log(error);
  }
}

async function setDroptip(droptipId, droptip) {
  console.log(`Updating droptip for Droptip ID: ${droptipId}`);
  // Convert BigInt values to strings if needed
  const formattedDroptip = JSON.parse(JSON.stringify({
    droptipId,
    droptip 
  }, (key, value) => (typeof value === 'bigint' ? value.toString() : value)));
  try {
    const res = await axios.post(`http://tipper-server.onrender.com/api/droptips/updateDroptip`, formattedDroptip);
    console.log(`Droptip updated from API: ${JSON.stringify(res.data)}`);
    return res; // Assuming API returns { wallet: { address: "0x..." } }
  }catch(error){
    console.log(error);
  }
}

async function newDroptip(droptipId, droptip) {
  console.log(`Creating droptip for Droptip ID: ${droptipId}`);

  // Convert BigInt values to strings if needed
  const formattedDroptip = JSON.parse(JSON.stringify({ 
    droptipId, 
    droptip 
  }, (key, value) => (typeof value === 'bigint' ? value.toString() : value)));

  try {
    const res = await axios.post(`http://tipper-server.onrender.com/api/droptips/newDroptip/`, formattedDroptip);
    return res; // Assuming API returns { wallet: { address: "0x..." } }
  } catch (error) {
    console.log(error);
  }
}



function waitMinutes(minutes) {
  return new Promise(resolve => setTimeout(resolve, minutes * 60 * 1000));
}
async function setExpiryTimer(minutes, droptipId) {
  console.log(`Timer started for ${minutes} minutes for Droptip ID: ${droptipId}`);
  await waitMinutes(minutes);
  
  const droptip = droptips.get(droptipId);
  if (!droptip) return;

  const attendees = droptip.attendees;
  const signer = new ethers.Wallet(BOT_PRIVATE_KEY, provider);
  const botTokenContract = new ethers.Contract(MEMECOIN_ADDRESS, abi, signer);

  if (attendees.length > 0) {
    const bigAmount = BigInt(droptip.amount);
    const amountPerAttendee = bigAmount / BigInt(attendees.length);


// When transferring, convert it to a string:
for (const attendee of attendees) {
    try {
        const tx = await botTokenContract.transfer(attendee, amountPerAttendee.toString());
        await tx.wait();
        console.log(`Sent ${amountPerAttendee.toString()} tokens to ${attendee}`);
    } catch (err) {
        console.error(`Failed to send tokens to ${attendee}:`, err);
    }
}


      droptip.claimed = true;
      droptip.available = false;
  } else {
      droptip.claimed = false;
      droptip.available = false;
      const senderWallet = await getUserWallet(droptip.senderId);

      const tx = await botTokenContract.transfer(senderWallet, droptip.amount)
      await tx.wait();
      console.log(`Droptip ID ${droptipId} expired with no claims.`);
  }

  droptips.set(droptips, droptip);
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
        .addStringOption(option =>
            option.setName('time')
                .setDescription('Time for droptip to expire')
                .setRequired(true)
                .addChoices(
                    { name: '1 minute', value: '1' },
                    { name: '3 minutes', value: '3' },
                    { name: '5 minutes', value: '5' },
                    { name: '10 minutes', value: '10' },
                    { name: '15 minutes', value: '15' },
                    { name: '30 minutes', value: '30' }
                )
        )        
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
      console.log(`Executing /wallet command for user: ${interaction.user.id}`);
    
      await interaction.reply({content: `Checking...`, flags: 'Ephemeral'});
    
      try {
        const wallet = await getUserWallet(interaction.user.id);
        console.log(`Wallet Address Retrieved: ${wallet}`);
    
        let balance;
        try {
          balance = await tokenContract.balanceOf(wallet);
          console.log(`Wallet Balance Retrieved: ${balance.toString()}`);
        } catch (err) {
          console.error(`Error fetching token balance: ${err.message}`);
          balance = ethers.BigNumber.from(0);
        }
    
        const formatted = formatUnits(balance, TOKEN_DECIMALS);
        await interaction.editReply({
          content: `Your wallet address is: \`${wallet}\`\nToken Balance: ${formatted}`,
          ephemeral: true
        });
    
        console.log("Wallet command executed successfully");
      } catch (err) {
        console.error(`Error in /wallet command: ${err.message}`);
        await interaction.editReply({ content: "An error occurred while fetching your wallet.", flags: 'Ephemeral'});
      }
    }
    
    // /deposit - show wallet deposit instructions
    else if (commandName === 'deposit') {
      const wallet = await getUserWallet(interaction.user.id);
      await interaction.reply({content: `Checking...`, ephemeral: true});
      await interaction.editReply({content: `To deposit tokens, send them to your wallet address:\n**${wallet}**`, ephemeral: true});
    }
    // /withdraw <amount> <destination>
    else if (commandName === 'withdraw') {
      const amount = interaction.options.getString('amount');
      const destination = interaction.options.getString('destination');
      const key = await getKey(interaction.user.id);
      const signer = new ethers.Wallet(key, provider);
      const userTokenContract = new ethers.Contract(MEMECOIN_ADDRESS, abi, signer);
      await interaction.reply({content: 'Withdrawing...', flags: 'Ephemeral'});
      try {
        const estimation = await userTokenContract.estimateGas.transfer(destination, 100);
        const tx = await userTokenContract.transfer(destination, parseUnits(amount, TOKEN_DECIMALS));
        await tx.wait();
        await interaction.editReply({content: `Withdrawal successful!\nSent ${amount} tokens to \`${destination}\`\nTransaction Hash: \`${tx.hash}\``, flags: 'Ephemeral'});
      } catch (err) {
        console.error(err);
        await interaction.editReply({content: `Withdrawal failed: ${err.message}`, flags: 'Ephemeral'});
      }
    }
    // /tip <user> <amount>
    else if (commandName === 'tip') {
      const targetUser = interaction.options.getUser('user');
      const amount = interaction.options.getString('amount');
      const fee = 0.01 * parseFloat(amount);
      const targetId = targetUser.id;
      await interaction.reply({content: 'Tipping...'});
      if (targetId === interaction.user.id) {
        return interaction.editReply({content: "You cannot tip yourself.", flags: 'Ephemeral'});
      }
      const senderWallet = await getUserWallet(interaction.user.id);
      const senderKey = await getKey(interaction.user.id);
      const recipientWallet = await getUserWallet(targetId);
      const signer = new ethers.Wallet(senderKey, provider);
      const senderTokenContract = new ethers.Contract(MEMECOIN_ADDRESS, abi, signer);
      try {
        const tx = await senderTokenContract.transfer(recipientWallet, parseUnits(amount.toString(), TOKEN_DECIMALS));
        const ftx = await senderTokenContract.transfer(botWallet.address, parseUnits(fee.toString(), TOKEN_DECIMALS));
        await tx.wait();
        await ftx.wait();
        const fembed = new EmbedBuilder()
            .setTitle(`${interaction.user.name} Tipped ${amount} $SAFUBAE tokens to <@${targetId}>!`)
            .setDescription(
              'Transaction Hash: ' + tx.hash + '\n\n' +
              `Lucky you, <@${targetId}>! You just received a tip of ${amount} $SAFUBAE tokens from ${interaction.user.username}!`
            );
        
        await interaction.editReply({content: ``, embeds: [fembed]});
      } catch (err) {
        console.error(err);
        await interaction.editReply({content: `Tip failed. You may have an insufficient balance or not enough funds to cover the gas fees`, flags: 'Ephemeral'});
      }
    }
    // /droptip <amount>
    else if (commandName === 'droptip') {
      const amount = interaction.options.getString('amount');
      let time = interaction.options.getString('time').split('mn')[0];
  
      let date = new Date();
      date.setMinutes(date.getMinutes() + parseInt(time));
      const expires = date.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit' });
  
      await interaction.reply({content: 'Dropping a droptip...'});
  
      try {
          const droptipId = nextDroptipId++;
          const fee = 0.01 * parseFloat(amount);
          const totalAmount = parseFloat(amount) + fee;
  
          const senderKey = await getKey(interaction.user.id);
          const signer = new ethers.Wallet(senderKey, provider);
          const senderTokenContract = new ethers.Contract(MEMECOIN_ADDRESS, abi, signer);
  
          // Transfer total amount (including fee) to botWallet for escrow
          const escrowTx = await senderTokenContract.transfer(botWallet.address, parseUnits(totalAmount.toString(), TOKEN_DECIMALS));
          await escrowTx.wait();
  
          const droptip = {
              id: droptipId,
              senderId: interaction.user.id,
              amount: parseUnits(amount, TOKEN_DECIMALS),
              claimed: false,
              time: `${time} minutes`,
              attendees: [],
              available: true,
              expires
          };
          droptips.set(droptipId, droptip);
          const claimButton = new ButtonBuilder()
            .setCustomId(`claim_droptip_${droptipId}`) // Correct
            .setLabel("Collect")
            .setStyle(ButtonStyle.Primary);
          
            const embed = new EmbedBuilder()
            .setTitle(`Droptip of ${amount} $SAFUBAE tokens dropped!`)
            .setDescription(
                `Click to Collect\n\n` +
                `**Num. Attendees:** ${droptips.get(droptipId).attendees.length} members\n\n` +
                `**Each member Receives:**\n\n` +
                `DropTip by ${interaction.user.username} | Expires by <t:${expires}>`
            );
        
        const row = new ActionRowBuilder().addComponents(claimButton);
        
        await interaction.editReply({ 
            embeds: [embed],  // Use `embeds` instead of `components`
            components: [row]  // Keep only buttons in `components`
        });
         await setExpiryTimer(time, droptipId); // Pass droptipId to correctly update the droptip on expiry

         const fembed = new EmbedBuilder()
            .setTitle(`Droptip of ${amount} $SAFUBAE tokens dropped!`)
            .setDescription(
                `Click to Collect\n\n` +
                `**Num. Attendees:** ${droptips.get(droptipId).attendees.length} members\n\n` +
                `**Each member Receives:**\n\n` +
                `DropTip by ${interaction.user.username} | Expired`
            );
        
          await interaction.editReply({ 
            content: '', // Remove the previous message content
            embeds: [fembed],  // Use `embeds` instead of `components`
        });
      } catch (err) {
          console.error(err);
          await interaction.editReply(`Droptip failed: ${err.message}`);
      }
  }
}
 // Button Interactions (for droptip claims)
 else if (interaction.isButton()) {
  await interaction.deferReply({ flags: 'Ephemeral' }); // Defer reply immediately

  if (interaction.user.bot) {
    return interaction.reply({content: "Bots cannot collect DropTips.", flags: 'Ephemeral'});
}

  const customId = interaction.customId;
  console.log(`Button interaction: ${customId}`);

  if (customId.startsWith("claim_droptip_")) {
      const droptipId = parseInt(customId.split("_")[2]);
      const droptip = droptips.get(droptipId);

      console.log('Fetched droptip');

      if (!droptip || !droptip.available) {
          return interaction.editReply({ content: "This droptip is no longer available.", flags: 'Ephemeral' });
      }
      const claimerWallet = await getUserWallet(interaction.user.id);
      if (droptips.get(droptipId).attendees.includes(claimerWallet)) {
        return interaction.reply("You have already collected this DropTip.");
    }
      droptip.attendees.push(claimerWallet);
      droptips.set(droptipId, droptip);

      return interaction.editReply({ content: "You have successfully participated in this droptip. Wait for the tip to be shared when the time expires.", flags: 'Ephemeral'});
  }
}});
// Log in to Discord
client.login(DISCORD_TOKEN);
