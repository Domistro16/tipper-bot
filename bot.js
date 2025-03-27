import "dotenv/config";
import abi from "./abi.js";
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, time, EmbedBuilder, User } from 'discord.js';
import { ethers, formatUnits, parseUnits } from 'ethers';
import axios from "axios"
import crypto from 'crypto';
import { getPrivateKey } from "./manager.js";
import { storePrivateKey } from "./manager.js";
import { Wallet } from "ethers";
const algorithm = 'aes-256-cbc';

// Environment variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;      // Your bot’s application ID              
const BSC_RPC_URL = process.env.BSC_RPC_URL;
const BOT_PRIVATE_KEY = process.env.BOT_PRIVATE_KEY;
const TOKEN_DECIMALS = parseInt(process.env.TOKEN_DECIMALS) ?? 18;
const addresses = [process.env.MEMECOIN_ADDRESS || ''];


// Set up ethers provider for BSC
const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);

// Bot wallet (for droptip escrow)
const botWallet = new ethers.Wallet(BOT_PRIVATE_KEY, provider);



// In-memory stores
const droptips = new Map();     // Map droptip ID => droptip object
let nextDroptipId = 1;

async function hasSufficientGas(userWalletAddress, requiredGasWei) {
  const balanceWei = await provider.getBalance(userWalletAddress);
  return balanceWei > (requiredGasWei); // Use .gte() for BigNumber comparison
}

async function ensureGas(userWalletAddress, requiredGasWei) {
  const balanceWei = await provider.getBalance(userWalletAddress);
  
  if (balanceWei < requiredGasWei) { // Use .lt() to check if user needs gas
    const missingGas = requiredGasWei - (balanceWei);
    console.log(`User has insufficient gas. Sending subsidy of ${ethers.formatUnits(missingGas, "ether")} BNB...`);

    const botSigner = new ethers.Wallet(process.env.BOT_PRIVATE_KEY, provider); // Ensure botWallet is set correctly

    const subsidyTx = await botSigner.sendTransaction({
      to: userWalletAddress,
      value: missingGas
    });

    await subsidyTx.wait();
    console.log("Gas subsidy sent.");
  } else {
    console.log("User has sufficient gas; no subsidy needed.");
  }
}


function encryptPrivateKey(privateKey) {
  const salt = crypto.randomBytes(16);
  const secretKey = crypto.scryptSync(process.env.SECRET_KEY, salt, 32); // Derive 32-byte key
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { encryptedData: encrypted, iv: iv.toString('hex'), salt: salt.toString('hex') };
}

// Decrypt function
function decryptPrivateKey(encryptedData, iv, salt) {
  const secretKey = crypto.scryptSync(process.env.SECRET_KEY, Buffer.from(salt, 'hex'), 32);
  const decipher = crypto.createDecipheriv(algorithm, secretKey, Buffer.from(iv, 'hex'));
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Helper: get or create a user's wallet
async function getUserWallet(userId) {
  console.log(`Fetching wallet for user ID: ${userId}`);

  try {
    let key = await getPrivateKey(userId);
    const res = await axios.get(`http://localhost:800/api/wallets/${userId}`);
    const iv = res.data.iv
    const salt = res.data.s
    const wallet = new Wallet(decryptPrivateKey(key, iv, salt).toString(), provider);
    key = '';
    return wallet.address;
  } catch (err) {
    if (err) {
      console.log("Wallet not found, creating a new one...");
      
      const wallet = ethers.Wallet.createRandom().connect(provider);

      const enc = encryptPrivateKey(wallet.privateKey);

      const v = enc.encryptedData;
      const iv = enc.iv;
      const salt = enc.salt;
      try {
        console.log('trying...');
        await storePrivateKey(userId, v);
        await axios.post(`http://localhost:800/api/wallets/newWallet`, {
          userId,
          iv,
          salt,// Ensure valid structure
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
    const res = await axios.get(`http://localhost:800/api/droptips/${droptipId}`);
    console.log(`Droptip retrieved from API: ${JSON.stringify(res.data)}`);
    return res.data.droptip; // Assuming API returns { wallet: { address: "0x..." } }
  }catch(error){
    console.log(error);
  }
}

async function getKey(UserId) {
  console.log(`Fetching key for ID: ${UserId}`);
  try {
    const key = await getPrivateKey(UserId);
    const res = await axios.get(`http://localhost:800/api/wallets/${UserId}`);
    const iv = res.data.iv;
    const salt = res.data.s;
    console.log(`Retrieved`);
    const decryptedKey = decryptPrivateKey(key, iv, salt);
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
    const res = await axios.post(`http://localhost:800/api/droptips/updateDroptip`, formattedDroptip);
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
    const res = await axios.post(`http://tipper-bot.onrender.com/api/droptips/newDroptip/`, formattedDroptip);
    return res; // Assuming API returns { wallet: { address: "0x..." } }
  } catch (error) {
    console.log(error);
  }
}



function waitMinutes(minutes) {
  return new Promise(resolve => setTimeout(resolve, minutes * 60 * 1000));
}
async function setExpiryTimer(minutes, droptipId, MEMECOIN_ADDRESS) {
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

  droptips.set(droptipId, droptip);
}


/* ===============================
   SLASH COMMAND REGISTRATION
   =============================== */

const commands = [
  new SlashCommandBuilder()
    .setName('wallet')
    .setDescription('Display your wallet address and token balance.')
    .addNumberOption(option =>
      option.setName('token')
        .setDescription('Token to check')
        .setRequired(true)
        .addChoices(
          { name: 'Safubae', value: 0 }
        )),
  new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Get your deposit address to receive tokens.')
    .addNumberOption(option =>
      option.setName('token')
        .setDescription('Token to deposit to')
        .setRequired(true)
        .addChoices(
          { name: 'Safubae', value: 0 }
        )),
  new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Withdraw tokens externally (1% fee, excl. gas)')
    .addNumberOption(option =>
      option.setName('token')
        .setDescription('Token to withdraw')
        .setRequired(true)
        .addChoices(
          { name: 'Safubae', value: 0 }
        ))
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
    .setDescription('Tip another user tokens (1% fee, excl. gas)')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to tip')
        .setRequired(true))
    .addNumberOption(option =>
      option.setName('token')
        .setDescription('Token to tip')
        .setRequired(true)
        .addChoices(
          { name: 'Safubae', value: 0 }
        ))
    .addStringOption(option =>
      option.setName('amount')
        .setDescription('Amount of tokens to tip')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('droptip')
    .setDescription('Drop a tip that anyone can claim (1% fee, excl. gas)')
    .addNumberOption(option =>
      option.setName('token')
        .setDescription('Token to droptip')
        .setRequired(true)
        .addChoices(
          { name: 'Safubae', value: 0 }
      ))
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
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
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
  console.log(`Interaction received: ${interaction.id}`);
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;
    // /wallet - show wallet address and token balance
    if (commandName === 'wallet') {
      await interaction.reply({content: `Checking...`, flags: 'Ephemeral'});
      console.log(`Executing /wallet command for user: ${interaction.user.id}`)
      const token = interaction.options.getNumber('token');
      const MEMECOIN_ADDRESS = addresses[token];
      console.log(MEMECOIN_ADDRESS)
      const tokenContract = new ethers.Contract(MEMECOIN_ADDRESS, abi, provider);

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
          flags: 'Ephemeral'
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
      await interaction.reply({content: `Checking...`, flags: 'Ephemeral'});
      await interaction.editReply({content: `To deposit tokens, send them to your wallet address:\n**${wallet}**`, flags: 'Ephemeral'});
    }
    // /withdraw <amount> <destination>
    else if (commandName === 'withdraw') {
      await interaction.reply({ content: 'Withdrawing...', flags: 'Ephemeral' });
      const token = interaction.options.getNumber('token');
      const MEMECOIN_ADDRESS = addresses[token];
      const tokenContract = new ethers.Contract(MEMECOIN_ADDRESS, abi, provider);
      const amount = interaction.options.getString('amount');
      const destination = interaction.options.getString('destination');
      const key = await getKey(interaction.user.id);
      const signer = new ethers.Wallet(key, provider);
      const userTokenContract = new ethers.Contract(MEMECOIN_ADDRESS, abi, signer);

  
      const fee = 0.01 * parseFloat(amount);
      const feeBN = parseUnits(fee.toString(), TOKEN_DECIMALS);
      const totalAmount = parseUnits(amount, TOKEN_DECIMALS) + (feeBN);
  
      try {
          // Populate transaction to estimate gas
          const gasEstimate = await userTokenContract.transfer.estimateGas(botWallet.address, totalAmount);
          const feeData = await provider.getFeeData();
          const gasPrice = feeData.gasPrice;
          const gasCostWei = gasEstimate * (gasPrice);
          const gasCostBNB = ethers.formatUnits(gasCostWei, "ether");
  
          await interaction.editReply({ content: `This transaction will cost ${gasCostBNB} BNB in gas fees.`, flags: 'Ephemeral' });
  
          if (!(await hasSufficientGas(signer.address, gasCostWei))) {
              await ensureGas(signer.address, gasCostWei);
          }
  
          // Execute user transaction
          const tx = await userTokenContract.transfer(botWallet.address, totalAmount);
          await tx.wait();
  
          // Bot sends tokens to destination
          const botSigner = new ethers.Wallet(process.env.BOT_PRIVATE_KEY, provider);
          const bot = new ethers.Contract(MEMECOIN_ADDRESS, abi, botSigner);
          const mtx = await bot.transfer(destination, parseUnits(amount.toString(), TOKEN_DECIMALS));
  
          await mtx.wait();
          const fembed = new EmbedBuilder()
            .setTitle(`Withdrawal successful!`)
            .setDescription(
              `You just Sent ${amount} tokens to \`${destination}\`\nTransaction Hash: \`${tx.hash}\``
            );
          await interaction.editReply({
              content: '',
              embeds: [fembed],
              flags: 'Ephemeral'
          });
      } catch (err) {
          console.error(err);
          await interaction.editReply({ content: `Withdrawal failed: ${err.message}`, flags: 'Ephemeral' });
      }
  }
  
    // /tip <user> <amount>
    else if (commandName === 'tip') {
      await interaction.reply({content: 'Tipping...'});
      const targetUser = interaction.options.getUser('user');
      const token = interaction.options.getNumber('token');
      const MEMECOIN_ADDRESS = addresses[token];
      const amount = interaction.options.getString('amount');
      const fee = 0.01 * parseFloat(amount);
      const feeBN = parseUnits(fee.toString(), TOKEN_DECIMALS);
      const totalAmount = parseUnits(amount, TOKEN_DECIMALS) + (feeBN);
      const targetId = targetUser.id;
      if (targetId === interaction.user.id) {
        return interaction.editReply({content: "You cannot tip yourself.", flags: 'Ephemeral'});
      }
      if(amount < process.env.TIP_TOKENS ){
          await interaction.editReply({content: 'You can only tip a minimum of 1000 tokens', flags: 'Ephemeral'})
      }
      const senderKey = await getKey(interaction.user.id);
      const recipientWallet = await getUserWallet(targetId);
      const signer = new ethers.Wallet(senderKey, provider);
      const senderTokenContract = new ethers.Contract(MEMECOIN_ADDRESS, abi, signer);

      try {
        const gasEstimate = await senderTokenContract.transfer.estimateGas(botWallet.address, totalAmount);
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice;
        const gasCostWei = gasEstimate * (gasPrice);

        if (!(await hasSufficientGas(signer.address, gasCostWei))) {
            await ensureGas(signer.address, gasCostWei);
        }

        // Execute user transaction
        const tx = await senderTokenContract.transfer(botWallet.address, totalAmount);
        await tx.wait();

        const botSigner = new ethers.Wallet(process.env.BOT_PRIVATE_KEY, provider);
        const bot = new ethers.Contract(MEMECOIN_ADDRESS, abi, botSigner);
        const mtx = await bot.transfer(recipientWallet, totalAmount);

        await mtx.wait(); 


        const fembed = new EmbedBuilder()
            .setTitle(`${interaction.user.username} Tipped ${amount} $SAFUBAE tokens!`)
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
      await interaction.reply({content: 'Dropping a droptip...'});
      const token = interaction.options.getNumber('token');
      const MEMECOIN_ADDRESS = addresses[token];
      const amount = interaction.options.getString('amount');
      let time = interaction.options.getString('time').split('mn')[0];
      const fee = 0.01 * parseFloat(amount);
      const feeBN = parseUnits(fee.toString(), TOKEN_DECIMALS);

      if(amount < process.env.TIP_TOKENS ){
        await interaction.editReply({content: 'You can only tip a minimum of 1000 tokens', flags: 'Ephemeral'})
    }


      const totalAmount = parseUnits(amount, TOKEN_DECIMALS) + (feeBN);
  
     
      try {
          const droptipId = nextDroptipId++;
          let senderKey = await getKey(interaction.user.id);
          const signer = new ethers.Wallet(senderKey, provider);
          senderKey = ''
          const senderTokenContract = new ethers.Contract(MEMECOIN_ADDRESS, abi, signer);

          const gasEstimate = await senderTokenContract.transfer.estimateGas(botWallet.address, totalAmount);
          const feeData = await provider.getFeeData();
          const gasPrice = feeData.gasPrice;
          const gasCostWei = gasEstimate * (gasPrice);
          if (!(await hasSufficientGas(signer.address, gasCostWei))) {
              await ensureGas(signer.address, gasCostWei);
          }
          
          // Transfer total amount (including fee) to botWallet for escrow
          const escrowTx = await senderTokenContract.transfer(botWallet.address, totalAmount);
          await escrowTx.wait();

          let date = new Date();
          date.setMinutes(date.getMinutes() + parseInt(time));
          const expires = date.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit' });
    
      
  
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
                `⚠️ **WARNING**: Droptips may be lost if the bot restarts.` + 
                `DropTip by ${interaction.user.username} | Expires by <t:${expires}>`
            );
        const row = new ActionRowBuilder().addComponents(claimButton);
        
        await interaction.editReply({ 
            embeds: [embed],  // Use `embeds` instead of `components`
            components: [row]  // Keep only buttons in `components`
        });
         await setExpiryTimer(time, droptipId, MEMECOIN_ADDRESS); // Pass droptipId to correctly update the droptip on expiry
         const fembed = new EmbedBuilder()
            .setTitle(`Droptip of ${amount} $SAFUBAE tokens dropped!`)
            .setDescription(
                `Click to Collect\n\n` +
                `**Num. Attendees:** ${droptips.get(droptipId).attendees.length} members\n\n` +
                `**Each member Receives:**\n\n` +
                `⚠️ **WARNING**: Droptips may be lost if the bot restarts.` + 
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
